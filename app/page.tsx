import { createList } from "./actions";
import RecentLists from "./recent-lists";

export default function HomePage() {
  return (
    <>
      <h1>Shopping list</h1>
      <p className="muted">
        Make a list, share the link with your group. No accounts, no apps.
      </p>

      <form action={createList} className="card">
        <label htmlFor="name" className="muted">
          List name
        </label>
        <div className="row" style={{ marginTop: "0.5rem" }}>
          <input
            id="name"
            name="name"
            type="text"
            placeholder="Groceries"
            maxLength={80}
            autoComplete="off"
          />
          <button className="btn" type="submit">
            Create
          </button>
        </div>
      </form>

      <RecentLists />
    </>
  );
}
