import { createHash } from "node:crypto";
import type { Item } from "@/lib/db";

/**
 * A short fingerprint of a list's current contents.
 *
 * Chat clients cache link previews per URL, so both the shared link and the
 * card image carry this. Same contents means the same URL and nothing is
 * re-fetched; any change produces a new URL and a fresh card.
 */
export function listVersion(items: Item[]): string {
  const state = items.map((item) => `${item.id}:${item.done}`).join(",");
  return createHash("sha1").update(state).digest("hex").slice(0, 6);
}
