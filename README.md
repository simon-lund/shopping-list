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

## Configuration

The app reads exactly one environment variable:

| Variable       | Example                                            |
| -------------- | -------------------------------------------------- |
| `DATABASE_URL` | `postgres://shopping:secret@db-host:5432/shopping` |

That connection string already contains the user, password, host, port and
database name, so there are no separate `DB_USER` / `DB_PASSWORD` variables.
Nothing else is configurable.

> **Watch out:** if your password contains `@`, `/`, `:`, `?` or `#`, it has to
> be percent-encoded inside the URL or the string won't parse. The easiest fix
> is to use a password with only letters and digits.

## Deploying on Dokploy

Use Dokploy's own Postgres service — it manages the credentials, gives you a
volume that survives redeploys, and has backups built into the UI. You create
two services in one project: a **database** and an **application**.

### Before you start

- Dokploy installed on the server, with ports 80 and 443 open
- A DNS `A` record for your domain pointing at the server's IP

### 1. Create the project

Dashboard → **Create Project** → name it `shopping-list` → **Create**.

### 2. Create the Postgres database

Inside the project: **Create Service → Database → PostgreSQL**, and fill in:

| Field             | Value             |
| ----------------- | ----------------- |
| Name              | `shopping-db`     |
| Docker Image      | `postgres:17-alpine` |
| Database Name     | `shopping`        |
| Database User     | `shopping`        |
| Database Password | generate a random one — **letters and digits only** (see the warning above) |

Click **Create**, then **Deploy** and wait for it to come up.

Now open the database's **Internal Credentials** and copy the internal host —
it's the service's app name, something like `shopping-db-a1b2c3`. Don't guess
it, copy it. That host only resolves inside the project's Docker network, which
is exactly what you want: the database is never exposed to the internet. Leave
**External Port** empty.

### 3. Create the application

In the same project: **Create Service → Application** → name it `shopping-app`.

On the **General** tab:

- **Source**: GitHub (or Git) → this repository → branch `main`
- **Build Type**: **Dockerfile**, path `./Dockerfile`

Build Type matters — pick Dockerfile, not Nixpacks. The Dockerfile in this repo
builds Next.js in standalone mode, which is what keeps the image small.

### 4. Point the app at the database

On the application's **Environment** tab, add one variable, using the internal
host from step 2 and the password you chose:

```
DATABASE_URL=postgres://shopping:YOUR_PASSWORD@shopping-db-a1b2c3:5432/shopping
```

Save.

### 5. Add your domain

On the application's **Domains** tab → **Add Domain**:

| Field                | Value              |
| -------------------- | ------------------ |
| Host                 | `list.example.com` |
| Container Port       | `3000`             |
| HTTPS                | on                 |
| Certificate Provider | Let's Encrypt      |

### 6. Deploy

Hit **Deploy** and watch the **Deployments** tab. On the first request Traefik
fetches the certificate, and the app creates its two tables automatically —
there is no migration step to run.

Optionally turn on **Auto Deploy** on the application so pushes to `main` ship
themselves, and **Backups** on the database.

### If the build fails with `getaddrinfo EAI_AGAIN`

That's the classic Next.js-on-Dokploy error: the app tried to reach the
database while the image was still building, when the internal hostname doesn't
resolve yet. **This app doesn't do that** — nothing touches the database at
build time, and `npm run build` succeeds with `DATABASE_URL` unset entirely. If
you ever see that error here, it means a new page is querying the database
during prerendering; add `export const dynamic = "force-dynamic"` to it.

## Deploying with Docker Compose instead

If you'd rather have one self-contained stack — on Dokploy as a **Compose**
service, or on any box with Docker — `docker-compose.yml` runs the app and
Postgres together:

```bash
POSTGRES_PASSWORD=$(openssl rand -hex 16) docker compose up -d --build
```

Here you own the Postgres container, which is the only reason
`POSTGRES_PASSWORD` exists: the repo ships no real password, and the compose
file falls back to `shopping` for local development. The app itself still only
reads `DATABASE_URL`, which compose assembles for it.

Data lives in the `db-data` volume and survives redeploys. Back it up with:

```bash
docker compose exec db pg_dump -U shopping shopping > backup.sql
```

To use a Postgres you already run, delete the `db` service from
`docker-compose.yml` and set `DATABASE_URL` yourself.

### Adding a domain to the Compose stack later

Compose stacks route through Traefik, which can only see containers on
Dokploy's own network. Attach the `app` service to **both** networks — the
default one, so it can still reach `db`, and `dokploy-network`, so Traefik can
reach it:

```yaml
services:
  app:
    networks: [default, dokploy-network]

networks:
  dokploy-network:
    external: true
```

Keeping `default` in that list is the part people miss. Attaching `app` to
`dokploy-network` alone takes it off the compose network and it can no longer
resolve `db`, so the site comes up and every page 500s.

Note that this makes the file Dokploy-specific: plain `docker compose up` then
needs `docker network create dokploy-network` first. That's why it isn't in the
file already.

## Viewing it without a domain

Two options, no DNS required.

**The published port.** `docker-compose.yml` already maps port 3000 to the
host, so the app is reachable at `http://SERVER_IP:3000` as soon as the stack
is up — just open that port in your firewall. Nothing to configure.

**A free generated domain.** On the service's **Domains** tab → **Create
Domain** → click the 🎲 dice icon next to the Host field. Dokploy generates a
`{appName}.{ip}.traefik.me` host that resolves to your server's IP. For a
Compose stack, point it at the `app` service on container port `3000`. These
are HTTP-only unless you add your own certificate.

Both are plain HTTP, which has one visible effect on this app: browsers only
expose the clipboard API on HTTPS or localhost, so the **Share this list**
button can't copy. It falls back to displaying the URL as text for you to copy
by hand. Adding, ticking, deleting and syncing all work normally over HTTP.

Also worth knowing: a published port stays reachable at `SERVER_IP:3000` even
after you attach a domain, and this app has no login. If that bothers you,
drop the `ports:` block from `docker-compose.yml` once Traefik is routing to
it — Traefik reaches the container over the Docker network, not the host port.

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
