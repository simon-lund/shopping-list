import { timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Heartbeat from the Baileys worker.
 *
 * The worker holds the WhatsApp socket, so only it knows whether the account
 * is actually linked. It reports that here and /api/health passes it on —
 * otherwise the only way to tell a paired bot from an unpaired one is to read
 * container logs.
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

  let body: { connected?: boolean; detail?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  await query(
    `insert into worker_status (id, connected, detail, updated_at)
     values ('baileys', $1, $2::jsonb, now())
     on conflict (id) do update
       set connected = excluded.connected,
           detail = excluded.detail,
           updated_at = now()`,
    [Boolean(body.connected), JSON.stringify(body.detail ?? {})],
  );

  return Response.json({ ok: true });
}
