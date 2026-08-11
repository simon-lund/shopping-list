import { timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Guarded health check, for uptime monitors and for answering "is it the app
 * or the database?" without opening a shell.
 *
 * Disabled entirely until HEALTH_TOKEN is set — an unauthenticated endpoint
 * that reports which integrations are configured is a reconnaissance gift.
 */
function authorized(request: Request): boolean {
  const expected = process.env.HEALTH_TOKEN;
  if (!expected) return false;

  // Bearer header preferred; ?token= is there for monitors that can't send
  // custom headers, at the cost of the token landing in access logs.
  const header = request.headers.get("authorization");
  const given = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : (new URL(request.url).searchParams.get("token") ?? "");

  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!process.env.HEALTH_TOKEN) {
    return Response.json(
      { error: "health endpoint disabled: HEALTH_TOKEN is not set" },
      { status: 404, headers: NO_STORE },
    );
  }

  if (!authorized(request)) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  // Counting rows proves the connection *and* that the schema exists, rather
  // than just that the process is alive.
  const started = Date.now();
  let database: Record<string, unknown>;
  try {
    const rows = await query<{ lists: string; items: string }>(
      "select (select count(*) from lists)::text as lists, (select count(*) from items)::text as items",
    );
    database = {
      ok: true,
      latencyMs: Date.now() - started,
      lists: Number(rows[0].lists),
      items: Number(rows[0].items),
    };
  } catch (error) {
    database = {
      ok: false,
      latencyMs: Date.now() - started,
      error: (error as Error).message?.slice(0, 200) ?? "unknown error",
    };
  }

  // The worker owns the WhatsApp socket, so its own heartbeat is the only
  // honest answer to "is the bot actually linked".
  let worker: Record<string, unknown> = { reporting: false };
  try {
    const rows = await query<{
      connected: boolean;
      detail: Record<string, unknown>;
      age: string;
    }>(
      `select connected, detail, extract(epoch from now() - updated_at)::text as age
       from worker_status where id = 'baileys'`,
    );
    if (rows[0]) {
      const age = Math.round(Number(rows[0].age));
      // Heartbeats are every 60s; treat silence as down rather than trusting
      // the last thing it said before it died.
      const stale = age > 150;
      const detail = rows[0].detail as {
        number?: string;
        allowedGroups?: string[];
        seenGroups?: { id: string; name: string | null; allowed: boolean }[];
      };
      const seen = detail.seenGroups ?? [];

      worker = {
        reporting: true,
        connected: rows[0].connected && !stale,
        secondsSinceHeartbeat: age,
        ...(stale ? { note: "no heartbeat — worker stopped or cannot reach the app" } : {}),
        // Last four digits only: enough to confirm which account is linked,
        // without putting a phone number behind a single token.
        number: detail.number ? `…${detail.number.slice(-4)}` : null,
        groupsSeen: seen.length,
        groupsAllowed: seen.filter((group) => group.allowed).length,
        // Group ids and names are private metadata, so they are off by default.
        // Turn HEALTH_SHOW_GROUPS on while setting the allowlist up, then off.
        ...(process.env.HEALTH_SHOW_GROUPS === "true"
          ? { seenGroups: seen }
          : seen.length
            ? { hint: "set HEALTH_SHOW_GROUPS=true to list group ids here" }
            : {}),
      };
    }
  } catch {
    // Database already reported as down above; nothing to add.
  }

  const bot = {
    // Booleans only — never echo the values back.
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
    publicUrl: Boolean(process.env.PUBLIC_URL),
    whatsappCloud: Boolean(
      process.env.WHATSAPP_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_APP_SECRET,
    ),
    baileys: Boolean(process.env.BOT_SHARED_SECRET),
  };

  return Response.json(
    {
      status: database.ok ? "ok" : "degraded",
      uptimeSeconds: Math.round(process.uptime()),
      database,
      bot,
      worker,
    },
    // 503 so a monitor actually alarms when the database is unreachable.
    { status: database.ok ? 200 : 503, headers: NO_STORE },
  );
}
