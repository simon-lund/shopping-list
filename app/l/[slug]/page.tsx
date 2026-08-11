import { notFound } from "next/navigation";
import Link from "next/link";
import { addItem, clearDone, deleteItem, toggleItem } from "@/app/actions";
import { getItems, getList } from "@/lib/db";
import { LiveList, ShareButton } from "./client";

export const dynamic = "force-dynamic";

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
