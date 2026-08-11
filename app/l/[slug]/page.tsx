import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { addItem, clearDone, deleteItem, toggleItem } from "@/app/actions";
import { getItems, getList } from "@/lib/db";
import { listVersion } from "@/lib/version";
import { LiveList, ShareButton } from "./client";

export const dynamic = "force-dynamic";

/** Drives the chat link preview, alongside the card route. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const list = await getList(slug);
  if (!list) return { title: "Shopping list" };

  const items = await getItems(slug);
  const todo = items.filter((item) => !item.done);
  const preview = todo.slice(0, 6).map((item) => item.text);
  const description = todo.length
    ? `${preview.join(", ")}${todo.length > preview.length ? `, +${todo.length - preview.length} more` : ""}`
    : "Nothing left to buy.";

  // The version makes the image URL change whenever the list does, so chat
  // clients fetch a fresh card instead of reusing the cached one.
  const image = {
    url: `/l/${slug}/card?v=${listVersion(items)}`,
    width: 1200,
    height: 630,
  };

  return {
    title: list.name,
    description,
    openGraph: { title: list.name, description, type: "website", images: [image] },
  };
}

export default async function ListPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const list = await getList(slug);
  if (!list) notFound();

  const items = await getItems(slug);
  const doneCount = items.filter((item) => item.done).length;

  return (
    <>
      <LiveList id={list.id} name={list.name} />

      <h1>{list.name}</h1>
      <p className="muted">
        {items.length - doneCount} to buy
        {doneCount > 0 && ` · ${doneCount} done`}
      </p>

      <form action={addItem} className="row" style={{ marginTop: "1rem" }}>
        <input type="hidden" name="listId" value={list.id} />
        <input
          name="text"
          type="text"
          placeholder="Add an item"
          maxLength={200}
          autoComplete="off"
          aria-label="Add an item"
        />
        <button className="btn" type="submit">
          Add
        </button>
      </form>

      <ul className="items">
        {items.length === 0 && <li className="empty">Nothing on the list yet.</li>}
        {items.map((item) => (
          <li key={item.id} className={item.done ? "done" : undefined}>
            <form action={toggleItem} style={{ display: "contents" }}>
              <input type="hidden" name="listId" value={list.id} />
              <input type="hidden" name="id" value={item.id} />
              <button
                className="toggle"
                type="submit"
                aria-label={`Mark ${item.text} as ${item.done ? "not bought" : "bought"}`}
              >
                <span className="box" aria-hidden="true">
                  {item.done ? "✓" : ""}
                </span>
                <span className="label">{item.text}</span>
                {item.added_by && <span className="by">{item.added_by}</span>}
              </button>
              <button
                className="remove"
                type="submit"
                formAction={deleteItem}
                aria-label={`Remove ${item.text}`}
              >
                ×
              </button>
            </form>
          </li>
        ))}
      </ul>

      <div className="footer">
        <ShareButton />
        {doneCount > 0 && (
          <form action={clearDone}>
            <input type="hidden" name="listId" value={list.id} />
            <button className="link" type="submit">
              Clear {doneCount} done
            </button>
          </form>
        )}
      </div>

      <p className="muted" style={{ marginTop: "2rem" }}>
        <Link href="/">All lists</Link>
      </p>
    </>
  );
}
