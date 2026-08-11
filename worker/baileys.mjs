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
import {
  DisconnectReason,
  isJidGroup,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

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
 * dashes). Set it and the worker prints an 8-character code to link with
 * instead of a QR — the only workable route when the phone you would scan
 * with is the phone being linked, or when the logs are all you can reach.
 */
export function normalisePairNumber(raw) {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

const PAIR_NUMBER = normalisePairNumber(process.env.BAILEYS_PAIR_NUMBER);

/**
 * Pulls a group text message out of a Baileys message, or returns null if it
 * isn't one we should act on. Exported so it can be tested without a socket.
 */
export function toGroupMessage(raw) {
  const jid = raw?.key?.remoteJid;
  if (!jid || !isJidGroup(jid)) return null; // 1:1 chats are ignored
  if (raw.key.fromMe) return null; // don't react to our own replies

  const text =
    raw.message?.conversation ??
    raw.message?.extendedTextMessage?.text ??
    raw.message?.imageMessage?.caption ??
    raw.message?.videoMessage?.caption;
  if (typeof text !== "string" || !text.trim()) return null;

  const id = raw.key.id;
  if (!id) return null;

  return {
    id,
    groupId: jid,
    // participant is the group member's JID; pushName is their display name.
    sender: raw.pushName || raw.key.participant?.split("@")[0] || "Someone",
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
  if (PAIR_NUMBER && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PAIR_NUMBER);
        console.log(
          `\nbaileys: pairing code for +${PAIR_NUMBER}: ${code}\n` +
            "Enter it in WhatsApp -> Linked devices -> Link a device ->\n" +
            "\"Link with phone number instead\". It expires in a few minutes.\n",
        );
      } catch (error) {
        console.error("baileys: could not request a pairing code", error);
      }
    }, 4000);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    // Suppress the QR when pairing by code, so the logs stay readable.
    if (qr && !PAIR_NUMBER) {
      console.log("\nScan this with WhatsApp → Linked devices:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") console.log("baileys: connected");
    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        console.error("baileys: logged out — delete the auth dir and re-pair");
        process.exit(1);
      }
      console.warn(`baileys: disconnected (${status}), reconnecting`);
      setTimeout(start, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return; // skip history sync replays

    for (const raw of messages) {
      const message = toGroupMessage(raw);
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
        console.log(
          permitted
            ? `baileys: active in ${message.groupId}${name ? ` (${name})` : ""}`
            : `baileys: ignoring ${message.groupId}${name ? ` (${name})` : ""} — add it to ALLOWED_GROUPS to enable`,
        );
      }

      if (!permitted) continue;

      try {
        const reply = await askApp(message);
        if (reply) await sock.sendMessage(message.groupId, { text: reply });
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
