import { randomBytes } from "node:crypto";
import { Pool } from "pg";

// Reuse the pool across hot reloads in dev.
const globalForDb = globalThis as unknown as {
  pool?: Pool;
  schemaReady?: Promise<void>;
};

/**
 * Two ways to point at Postgres:
 *
 * - `DATABASE_URL`, convenient for local work and hosted providers that hand
 *   you a URL. Beware that `/`, `#` and `?` in a password make the URL
 *   unparseable unless percent-encoded.
 * - The standard `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` / `PGPORT`
 *   variables, which `pg` reads on its own. No escaping rules, so any password
 *   works as typed. This is what docker-compose.yml uses.
 */
function getPool(): Pool {
  if (!globalForDb.pool) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      globalForDb.pool = new Pool({ connectionString, max: 5 });
    } else if (process.env.PGHOST || process.env.PGUSER) {
      globalForDb.pool = new Pool({ max: 5 });
    } else {
      throw new Error(
        "No database configured: set DATABASE_URL, or PGHOST/PGUSER/PGPASSWORD/PGDATABASE",
      );
    }
  }
  return globalForDb.pool;
}

const SCHEMA = `
  create table if not exists lists (
    id text primary key,
    name text not null,
    created_at timestamptz not null default now()
  );

  create table if not exists items (
    id bigserial primary key,
    list_id text not null references lists(id) on delete cascade,
    text text not null,
    done boolean not null default false,
    created_at timestamptz not null default now()
  );

  create index if not exists items_list_id_idx on items (list_id);

  -- Who added an item. Null for anything added from the web UI.
  alter table items add column if not exists added_by text;

  -- Maps a WhatsApp group to the list the bot keeps for it.
  create table if not exists chats (
    id text primary key,
    list_id text not null references lists(id) on delete cascade,
    created_at timestamptz not null default now()
  );

  -- Latest heartbeat from the Baileys worker, so /api/health can report
  -- whether it is actually connected rather than merely configured.
  create table if not exists worker_status (
    id text primary key,
    connected boolean not null,
    detail jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );

  -- WhatsApp redelivers webhooks; without this, retries duplicate items.
  create table if not exists seen_messages (
    id text primary key,
    seen_at timestamptz not null default now()
  );
`;

/** Creates the tables on first use, so there is no migration step to run. */
function ensureSchema(): Promise<void> {
  if (!globalForDb.schemaReady) {
    globalForDb.schemaReady = getPool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((err) => {
        // Let the next request retry instead of caching the failure.
        globalForDb.schemaReady = undefined;
        throw err;
      });
  }
  return globalForDb.schemaReady;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

// No l/I/0/O so codes stay readable when typed by hand.
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export function newListId(): string {
  return Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export type List = { id: string; name: string };
export type Item = { id: string; text: string; done: boolean; added_by: string | null };

export async function getList(id: string): Promise<List | null> {
  const rows = await query<List>("select id, name from lists where id = $1", [id]);
  return rows[0] ?? null;
}

export async function getItems(listId: string): Promise<Item[]> {
  return query<Item>(
    "select id::text, text, done, added_by from items where list_id = $1 order by done asc, created_at asc",
    [listId],
  );
}
