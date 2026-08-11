# Shopping list

A shared shopping list for a group of people. Create a list, send the link to
everyone, and you all tick things off the same list.

No accounts and no login — whoever has the link can edit the list. The URL
contains a random 8-character code, so it is not guessable, but it is also not
a secret: treat it like a shared Google Doc link.

## What it does

- Create a named list, get a shareable link
- Add items, tick them off, remove them, clear everything that's done
- Everyone's screen refreshes every 4 seconds, so the list stays in sync
- Remembers the lists you've opened (in your browser, via `localStorage`)
- Works on a phone, and still works with JavaScript disabled

## Stack

- Next.js 16 (App Router, server actions) — no client-side state to manage
- Postgres via `pg`, plain SQL, no ORM
- Two tables, created automatically on first run — there is no migration step

## Deploying on Dokploy

1. In Dokploy, create a new **Compose** service and point it at this repository.
2. Set an environment variable `POSTGRES_PASSWORD` to something random.
3. Deploy. Compose builds the app image and starts Postgres alongside it.
4. Attach your domain to the `app` service on port `3000`.

Postgres data lives in the `db-data` volume, so it survives redeploys. To back
it up: `docker compose exec db pg_dump -U shopping shopping > backup.sql`.

If you'd rather use a Postgres you already run, delete the `db` service from
`docker-compose.yml` and point `DATABASE_URL` at your existing database.

## Running it locally

```bash
# Postgres in a container
docker run -d --name shopping-db -p 5432:5432 \
  -e POSTGRES_USER=shopping -e POSTGRES_PASSWORD=shopping -e POSTGRES_DB=shopping \
  postgres:17-alpine

cp .env.example .env.local
npm install
npm run dev
```

Then open http://localhost:3000.

Or run the whole thing the way it runs in production:

```bash
POSTGRES_PASSWORD=dev docker compose up --build
```

## Layout

```
app/actions.ts        every write: create list, add / toggle / delete / clear items
app/page.tsx          home — create a list, see the ones you've opened
app/l/[slug]/page.tsx the list itself
app/l/[slug]/client.tsx  the two bits that need the browser: polling and share
lib/db.ts             connection pool, schema, reads
```

## Things it deliberately doesn't do

No auth, no per-person attribution, no quantities, no undo, no websockets. If
you want any of those, the whole app is about 300 lines — the place to start is
`lib/db.ts` for the schema and `app/actions.ts` for the writes.
