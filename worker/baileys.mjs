/**
 * Unofficial WhatsApp transport.
 *
 * Runs a real WhatsApp account through Baileys, so the bot can sit in a group
 * you already have — no Official Business Account, no 8-person cap, no
 * migrating anyone. The trade is that this is against WhatsApp's terms and the
 * number can be banned, so pair a spare SIM, not your own.
 *
 * All it does is shuttle messages: group text goes to the app's /api/bot
 * endpoint, and whatever comes back gets posted to the group. The list logic
 * lives in the app.
 */
import { rm } from "node:fs/promises";
import {
  DisconnectReason,
  isJidGroup,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const APP_URL = (process.env.APP_URL || "http://app:3000").replace(/\/$/, "");
const SECRET = process.env.BOT_SHARED_SECRET;
const AUTH_DIR = process.env.BAILEYS_AUTH_DIR || "/data/auth";

/**
 * Comma-separated group JIDs the bot is allowed to act in.
 *
 * Deny by default: an account can be added to any group by anyone in it, and
 * without this the bot would start answering — and sending every message to
 * the model — in groups nobody meant to include. Unlisted groups are logged
 * once so you can copy the JID in, then ignored.
 */
export function parseAllowList(raw) {
  return (raw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

/** Accepts the full JID or just the numeric part, since people paste both. */
export function isAllowed(jid, allowList) {
  if (!allowList.length) return false;
  // Group JIDs only, so a bare numeric entry can never also match a DM from
  // the same number.
  if (!jid.endsWith("@g.us")) return false;
  const local = jid.slice(0, -"@g.us".length);
  return allowList.some((entry) => entry === jid || entry === local);
}

const ALLOW_LIST = parseAllowList(process.env.ALLOWED_GROUPS);
const announced = new Set();

/**
 * Number to pair with, digits only including country code (no +, spaces or
 * dashes). The worker prints an 8-character code to link with; there is no QR
 * path, since scanning one requires a second screen the operator may not have.
 */
export function normalisePairNumber(raw) {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

const PAIR_NUMBER = normalisePairNumber(process.env.BAILEYS_PAIR_NUMBER);

/**
 * Optional prefix a message must start with to be looked at.
 *
 * Unset, every text message in an allowed group goes to the model. Set, only
 * messages beginning with it do — everything else is dropped here, before any
 * network call, so ordinary conversation never leaves the server and costs
 * nothing.
 */
const TRIGGER = (process.env.BOT_TRIGGER ?? "").trim().toLowerCase();

/** Longer messages are conversation, not a shopping request. */
const MAX_CHARS = Number(process.env.BOT_MAX_CHARS ?? 500) || 500;

/** Returns the message with the trigger stripped, or null if it doesn't match. */
export function applyTrigger(text, trigger) {
  if (!trigger) return text;
  const trimmed = text.trimStart();
  if (!trimmed.toLowerCase().startsWith(trigger)) return null;
  const rest = trimmed.slice(trigger.length).trim();
  return rest || null;
}

// Set when the bot runs on your own number, so your own messages count.
const INCLUDE_OWN = process.env.BAILEYS_INCLUDE_OWN_MESSAGES === "true";

// Ids of messages this worker sent, so they are never treated as input.
// Bounded: only recent sends can come back on the stream.
const sentIds = new Set();

/**
 * Reconnect delay, backing off to a minute.
 *
 * A rejected session used to exit the process, and the container's restart
 * policy turned that into a login attempt every few seconds — which is both
 * useless and the sort of traffic that gets a number flagged.
 */
export function reconnectDelayMs(attempt) {
  return Math.min(60_000, 3_000 * 2 ** Math.max(0, attempt - 1));
}

let attempts = 0;
let connected = false;

/** Groups seen this run, so the health endpoint can list them for the allowlist. */
const groups = new Map();

/**
 * Tell the app how the socket is doing. Only the worker knows whether the
 * account is linked, and container logs are an awkward place to have to look.
 */
async function reportStatus() {
  try {
    await fetch(`${APP_URL}/api/bot/status`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": SECRET },
      body: JSON.stringify({
        connected,
        detail: {
          number: PAIR_NUMBER,
          trigger: TRIGGER || null,
          maxChars: MAX_CHARS,
          allowedGroups: ALLOW_LIST,
          seenGroups: [...groups.values()],
        },
      }),
    });
  } catch (error) {
    console.error("baileys: could not report status", error.message);
  }
}

setInterval(reportStatus, 60_000).unref?.();

function rememberSent(id) {
  if (!id) return;
  sentIds.add(id);
  if (sentIds.size > 200) sentIds.delete(sentIds.values().next().value);
}

/**
 * Pulls a group text message out of a Baileys message, or returns null if it
 * isn't one we should act on. Exported so it can be tested without a socket.
 */
export function toGroupMessage(
  raw,
  { includeOwn = false, sentIds, trigger = "", maxChars = 500 } = {},
) {
  const jid = raw?.key?.remoteJid;
  if (!jid || !isJidGroup(jid)) return null; // 1:1 chats are ignored

  if (raw.key.fromMe) {
    // When the bot runs on your own number, your messages arrive as fromMe —
    // ignoring them all would mean the bot answered everyone except you. So
    // skip only what the bot itself sent, tracked by message id, which is what
    // actually prevents a reply loop.
    if (!includeOwn) return null;
    if (sentIds?.has(raw.key.id)) return null;
  }

  // Text only. A photo or video caption is usually chatter about the picture,
  // and skipping media keeps both cost and what gets sent onward down. Media
  // itself is never downloaded either way.
  const raw_text = raw.message?.conversation ?? raw.message?.extendedTextMessage?.text;
  if (typeof raw_text !== "string" || !raw_text.trim()) return null;
  if (raw_text.length > maxChars) return null;

  const text = applyTrigger(raw_text, trigger);
  if (!text) return null;

  const id = raw.key.id;
  if (!id) return null;

  return {
    id,
    groupId: jid,
    // participant is the group member's JID; pushName is their display name.
    sender:
      raw.pushName ||
      (raw.key.fromMe ? "You" : raw.key.participant?.split("@")[0]) ||
      "Someone",
    text,
  };
}

async function askApp(message) {
  const response = await fetch(`${APP_URL}/api/bot`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-secret": SECRET },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    console.error(`baileys: /api/bot returned ${response.status}`);
    return null;
  }
  const { reply } = await response.json();
  return reply ?? null;
}

async function start() {
  if (!SECRET) {
    console.error("baileys: BOT_SHARED_SECRET is not set");
    process.exit(1);
  }

  if (!PAIR_NUMBER) {
    console.error(
      "baileys: BAILEYS_PAIR_NUMBER is not set (digits only, with country code)",
    );
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({
    auth: state,
    syncFullHistory: false,
    // Renders the list link as a preview card. Baileys builds it client-side
    // via the optional link-preview-js dependency, so this worker must be able
    // to reach PUBLIC_URL itself.
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on("creds.update", saveCreds);

  // The socket has to settle before WhatsApp will issue a code, hence the wait.
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PAIR_NUMBER);
        console.log(
          `\nbaileys: pairing code for +${PAIR_NUMBER}: ${code}\n` +
            "Enter it NOW in WhatsApp -> Linked devices -> Link a device ->\n" +
            "\"Link with phone number instead\". It expires in about two\n" +
            "minutes; after that a new code is issued automatically.\n",
        );
      } catch (error) {
        console.error("baileys: could not request a pairing code", error);
      }
    }, 4000);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      attempts = 0;
      connected = true;
      console.log("baileys: connected");
      reportStatus();
    }
    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      connected = false;
      attempts += 1;
      reportStatus();
      const wait = reconnectDelayMs(attempts);

      if (status === DisconnectReason.loggedOut) {
        // The stored credentials will never work again — whether the pairing
        // never completed or the device was logged out from the phone. Keeping
        // them just fails forever, so clear them and pair afresh.
        console.error(
          "baileys: session rejected, clearing credentials and starting a new pairing",
        );
        rm(AUTH_DIR, { recursive: true, force: true })
          .catch((error) => console.error("baileys: could not clear", AUTH_DIR, error))
          .finally(() => setTimeout(start, wait));
        return;
      }

      console.warn(
        `baileys: disconnected (${status}), reconnecting in ${Math.round(wait / 1000)}s`,
      );
      setTimeout(start, wait);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return; // skip history sync replays

    for (const raw of messages) {
      const message = toGroupMessage(raw, {
        includeOwn: INCLUDE_OWN,
        sentIds,
        trigger: TRIGGER,
        maxChars: MAX_CHARS,
      });
      if (!message) continue;

      const permitted = isAllowed(message.groupId, ALLOW_LIST);

      // Say something the first time each group turns up, so the JID can be
      // read out of the logs and pasted into ALLOWED_GROUPS.
      if (!announced.has(message.groupId)) {
        announced.add(message.groupId);
        let name = "";
        try {
          name = (await sock.groupMetadata(message.groupId))?.subject ?? "";
        } catch {
          // Metadata is a nicety; the JID is the part that matters.
        }
        groups.set(message.groupId, {
          id: message.groupId,
          name: name || null,
          allowed: permitted,
        });
        reportStatus();
        console.log(
          permitted
            ? `baileys: active in ${message.groupId}${name ? ` (${name})` : ""}`
            : `baileys: ignoring ${message.groupId}${name ? ` (${name})` : ""} — add it to ALLOWED_GROUPS to enable`,
        );
      }

      if (!permitted) continue;

      try {
        const reply = await askApp(message);
        if (reply) {
          const sent = await sock.sendMessage(message.groupId, { text: reply });
          rememberSent(sent?.key?.id);
        }
      } catch (error) {
        console.error("baileys: failed to handle message", message.id, error);
      }
    }
  });
}

// Only connect when run directly, so tests can import toGroupMessage.
if (process.argv[1]?.endsWith("baileys.mjs")) {
  start().catch((error) => {
    console.error("baileys: failed to start", error);
    process.exit(1);
  });
}
