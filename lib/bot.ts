import { revalidatePath } from "next/cache";
import { getItems, newListId, query } from "@/lib/db";
import { interpret, type Action } from "@/lib/interpret";

/**
 * A message from any chat transport. Nothing below this line knows or cares
 * whether it arrived via Meta's Cloud API or a Baileys socket.
 */
export type GroupMessage = {
  id: string;
  groupId: string;
  sender: string;
  text: string;
};

/** Returns false if this message was already handled (WhatsApp retries). */
async function claimMessage(id: string): Promise<boolean> {
  const rows = await query(
    "insert into seen_messages (id) values ($1) on conflict do nothing returning id",
    [id],
  );
  return rows.length > 0;
}

/** Every group gets exactly one list, created the first time the bot sees it. */
async function listForChat(groupId: string): Promise<string> {
  const existing = await query<{ list_id: string }>(
    "select list_id from chats where id = $1",
    [groupId],
  );
  if (existing[0]) return existing[0].list_id;

  const listId = newListId();
  await query("insert into lists (id, name) values ($1, $2)", [
    listId,
    "Shopping list",
  ]);
  await query(
    "insert into chats (id, list_id) values ($1, $2) on conflict (id) do nothing",
    [groupId, listId],
  );

  // Lost the race with a concurrent message — use whichever row won.
  const row = await query<{ list_id: string }>(
    "select list_id from chats where id = $1",
    [groupId],
  );
  return row[0]?.list_id ?? listId;
}

/** Matches loosely, so "got the milk" ticks off "oat milk". */
async function findItem(listId: string, text: string) {
  const rows = await query<{ id: string; text: string }>(
    `select id::text, text from items
     where list_id = $1 and (lower(text) = lower($2) or text ilike '%' || $2 || '%')
     order by lower(text) = lower($2) desc, done asc
     limit 1`,
    [listId, text],
  );
  return rows[0];
}

function listUrl(listId: string): string {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") ?? "";
  return `${base}/l/${listId}`;
}

async function apply(
  listId: string,
  actions: Action[],
  sender: string,
): Promise<string | null> {
  const added: string[] = [];
  const ticked: string[] = [];
  const removed: string[] = [];
  let show = false;
  let cleared = 0;

  for (const action of actions) {
    const item = action.item?.trim();

    if (action.kind === "add" && item) {
      await query(
        "insert into items (list_id, text, added_by) values ($1, $2, $3)",
        [listId, item.slice(0, 200), sender.slice(0, 80)],
      );
      added.push(item);
    } else if (action.kind === "done" && item) {
      const match = await findItem(listId, item);
      if (match) {
        await query("update items set done = true where id = $1", [match.id]);
        ticked.push(match.text);
      }
    } else if (action.kind === "remove" && item) {
      const match = await findItem(listId, item);
      if (match) {
        await query("delete from items where id = $1", [match.id]);
        removed.push(match.text);
      }
    } else if (action.kind === "clear_done") {
      const gone = await query<{ id: string }>(
        "delete from items where list_id = $1 and done returning id",
        [listId],
      );
      cleared = gone.length;
    } else if (action.kind === "show") {
      show = true;
    }
  }

  const lines: string[] = [];
  if (added.length) lines.push(`Added ${added.join(", ")}.`);
  if (ticked.length) lines.push(`Ticked off ${ticked.join(", ")}.`);
  if (removed.length) lines.push(`Removed ${removed.join(", ")}.`);
  if (cleared) lines.push(`Cleared ${cleared} bought item${cleared === 1 ? "" : "s"}.`);

  if (show) {
    const items = await getItems(listId);
    const todo = items.filter((i) => !i.done);
    lines.push(
      todo.length
        ? `Still to buy:\n${todo.map((i) => `• ${i.text}`).join("\n")}`
        : "Nothing on the list.",
    );
  }

  if (!lines.length) return null;
  return `${lines.join("\n")}\n${listUrl(listId)}`;
}

/**
 * Interprets one group message and updates the list.
 *
 * Returns the text to post back into the group, or null when there is nothing
 * to say — which is most messages. Sending is the caller's job, so the same
 * logic serves both transports. Never throws: a failure here must not make a
 * webhook retry.
 */
export async function handleMessage(message: GroupMessage): Promise<string | null> {
  try {
    if (!(await claimMessage(message.id))) return null;

    const actions = await interpret(message.text, message.sender);
    if (!actions.length) return null;

    const listId = await listForChat(message.groupId);
    const reply = await apply(listId, actions, message.sender);
    if (reply) revalidatePath(`/l/${listId}`);
    return reply;
  } catch (error) {
    console.error("bot: failed to handle message", message.id, error);
    return null;
  }
}
