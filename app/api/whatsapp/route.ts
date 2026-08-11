import { after } from "next/server";
import { handleMessage } from "@/lib/bot";
import { extractGroupMessages, verifySignature } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** Meta's one-time webhook verification handshake. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (
    params.get("hub.mode") === "subscribe" &&
    verifyToken &&
    params.get("hub.verify_token") === verifyToken
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: Request) {
  // The signature is over the exact bytes, so read the body as text first.
  const raw = await request.text();

  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("bad signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Interpreting a message takes a second or two; Meta redelivers if we take
  // too long to answer. Acknowledge now, do the work after the response.
  for (const message of extractGroupMessages(body)) {
    after(() => handleMessage(message));
  }

  return new Response("ok", { status: 200 });
}
