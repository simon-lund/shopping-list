import { timingSafeEqual } from "node:crypto";
import { getItems, newListId, query } from "@/lib/db";
import { listVersion } from "@/lib/version";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.BOT_SHARED_SECRET;
  const given = request.headers.get("x-bot-secret");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Wins exactly once per group, so a restart doesn't re-introduce the bot. */
async function claimIntro(groupId: string): Promise<boolean> {
  const rows = await query(
    "insert into group_intros (group_id) values ($1) on conflict do nothing returning group_id",
    [groupId],
  );
  return rows.length > 0;
}

async function listForChat(groupId: string): Promise<string> {
  const existing = await query<{ list_id: string }>(
    "select list_id from chats where id = $1",
    [groupId],
  );
  if (existing[0]) return existing[0].list_id;

  const listId = newListId();
  await query("insert into lists (id, name) values ($1, $2)", [listId, "Shopping list"]);
  await query(
    "insert into chats (id, list_id) values ($1, $2) on conflict (id) do nothing",
    [groupId, listId],
  );
  const row = await query<{ list_id: string }>(
    "select list_id from chats where id = $1",
    [groupId],
  );
  return row[0]?.list_id ?? listId;
}

/**
 * The one-off "hello, this is what I do" a group gets when the bot is switched
 * on there. Worth saying out loud: with a trigger configured, nobody else in
 * the group has any way to know the bot exists or how to reach it.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { groupId?: string; trigger?: string | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.groupId) {
    return Response.json({ error: "groupId is required" }, { status: 400 });
  }

  if (!(await claimIntro(body.groupId))) return Response.json({ intro: null });

  const listId = await listForChat(body.groupId);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? "";
  const url = `${base}/l/${listId}?v=${listVersion(await getItems(listId))}`;
  const trigger = body.trigger?.trim();

  // Say plainly what is and isn't read. Without a trigger every message does
  // go to a model, and "normal chat I ignore" would imply otherwise — the
  // group should be able to tell which of the two setups it is in.
  const lines = [
    "Hi — I keep this group's shopping list.",
    "",
    trigger
      ? `I only read messages starting with "${trigger}".\n` +
        "Everything else here is ignored and never sent anywhere.\n" +
        "\n" +
        `  ${trigger} apples, milk, 6x eggs\n` +
        `  ${trigger} got the milk\n` +
        `  ${trigger} actually didn't get the milk\n` +
        `  ${trigger} forget the apples\n` +
        `  ${trigger} what do we still need?\n` +
        `  ${trigger} clear the bought stuff`
      : "Just say what you need and I'll keep up:\n" +
        "\n" +
        "  apples, milk, 6x eggs\n" +
        "  got the milk\n" +
        "  actually didn't get the milk\n" +
        "  forget the apples\n" +
        "  what do we still need?\n" +
        "  clear the bought stuff\n" +
        "\n" +
        "To spot those, every message here is read by an AI.\n" +
        "I only reply when I've actually changed something.",
    "",
    `The list: ${url}`,
  ];

  return Response.json({ intro: lines.join("\n") });
}
