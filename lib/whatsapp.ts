import { createHmac, timingSafeEqual } from "node:crypto";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v23.0";
// Overridable so tests (and proxies) can point somewhere other than Meta.
const API_BASE = process.env.WHATSAPP_API_BASE || "https://graph.facebook.com";

import type { GroupMessage } from "@/lib/bot";

/**
 * Meta signs every webhook with the app secret. Without this check anyone who
 * finds the URL can post messages as your group.
 */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}

function pickString(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Pulls group text messages out of a webhook body.
 *
 * Meta's group webhook shape isn't publicly documented, so the group id is read
 * from every field it plausibly lands in. Anything without a group id is
 * skipped — this bot only works in groups, and treating a 1:1 message as a
 * group would leak one person's list into another's.
 */
export function extractGroupMessages(body: unknown): GroupMessage[] {
  const found: GroupMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return found;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      if (!value) continue;

      const messages = value.messages;
      if (!Array.isArray(messages)) continue;

      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      for (const raw of messages) {
        const message = raw as Record<string, any>;
        if (message.type !== "text") continue;

        const text = message.text?.body;
        const id = message.id;
        if (typeof text !== "string" || typeof id !== "string") continue;

        const groupId = pickString(
          message.group_id,
          message.group?.id,
          message.recipient_group_id,
          value.group_id,
          (value.metadata as Record<string, unknown> | undefined)?.group_id,
        );
        if (!groupId) continue;

        const from = typeof message.from === "string" ? message.from : "";
        const contact = contacts.find(
          (c) => (c as { wa_id?: string })?.wa_id === from,
        ) as { profile?: { name?: string } } | undefined;

        found.push({
          id,
          groupId,
          sender: pickString(contact?.profile?.name, from) ?? "Someone",
          text,
        });
      }
    }
  }

  return found;
}

/** Posts a message back into the group. Failures are logged, never thrown. */
export async function sendToGroup(groupId: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error("whatsapp: WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID unset");
    return;
  }

  const response = await fetch(
    `${API_BASE}/${API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "group",
        to: groupId,
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    console.error(`whatsapp: send failed ${response.status}`, await response.text());
  }
}
