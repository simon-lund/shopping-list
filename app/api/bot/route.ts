import { timingSafeEqual } from "node:crypto";
import { handleMessage, type GroupMessage } from "@/lib/bot";

export const dynamic = "force-dynamic";

/**
 * Transport-neutral entry point, used by the Baileys worker.
 *
 * The worker owns the WhatsApp socket and does the sending, so this returns
 * the reply text rather than posting it anywhere. Not reachable from the
 * internet in the shipped compose file — no port is published for it — but it
 * still requires a shared secret, because "internal only" tends not to stay
 * true.
 */
function authorized(request: Request): boolean {
  const secret = process.env.BOT_SHARED_SECRET;
  const given = request.headers.get("x-bot-secret");
  if (!secret || !given) return false;

  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let message: Partial<GroupMessage>;
  try {
    message = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const { id, groupId, sender, text } = message;
  if (!id || !groupId || !sender || typeof text !== "string") {
    return Response.json(
      { error: "id, groupId, sender and text are required" },
      { status: 400 },
    );
  }

  const reply = await handleMessage({ id, groupId, sender, text });
  return Response.json({ reply });
}
