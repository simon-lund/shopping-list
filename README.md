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

`docker-compose.yml` builds that string for you, so when you deploy with
compose you never set `DATABASE_URL` by hand. It reads two variables of its
own instead:

| Variable            | Used for                                              |
| ------------------- | ----------------------------------------------------- |
| `POSTGRES_PASSWORD` | the password compose gives its Postgres container      |
| `DOMAIN`            | the hostname Traefik routes, e.g. `list.example.com`   |

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

### Putting the Compose stack on a domain

Set `DOMAIN` in the service's environment and redeploy:

```
DOMAIN=list.example.com
```

That's all — `docker-compose.yml` already carries the Traefik labels and the
`dokploy-network` attachment. **Don't also add the domain in Dokploy's Domains
tab**; for compose stacks that path is unreliable and produces a Traefik
`404 page not found` — it has shipped a malformed `Host` rule
([#3161](https://github.com/Dokploy/dokploy/issues/3161)), skipped generating
the config entirely ([#4324](https://github.com/Dokploy/dokploy/issues/4324)),
and left containers off `dokploy-network`
([#3435](https://github.com/Dokploy/dokploy/issues/3435)). Declaring the labels
in the compose file avoids all three.

Two details in that file are load-bearing if you edit it:

- `app` is on **both** `default` and `dokploy-network`. Dropping `default`
  takes it off the compose network, and it can no longer resolve `db` — the
  site loads and every page 500s.
- `traefik.docker.network=dokploy-network` tells Traefik which of the two
  addresses to route to. Without it, it may pick the wrong one.

### TLS behind the Cloudflare proxy

Let's Encrypt works behind Cloudflare's proxy, including renewals. The HTTP-01
challenge [follows redirects up to 10 deep and does not validate certificates
when it lands on HTTPS](https://letsencrypt.org/docs/challenge-types/), so
Cloudflare's HTTP→HTTPS redirect doesn't stop it.

The one case that deadlocks is the **first** issuance with SSL/TLS mode set to
**Full (strict)**: Cloudflare refuses to talk to an origin without a valid
certificate, and the origin can't obtain one until the challenge gets through.
Break the loop by setting the DNS record to **DNS only** (grey cloud) for the
first issuance, then turn the proxy back on. Renewals from then on are fine,
because by then the origin has a valid certificate for Cloudflare to accept.

Whatever you do, don't use SSL mode **Flexible**: Cloudflare would call the
origin on port 80, the compose file's HTTP router would redirect it back to
HTTPS, and you'd get `ERR_TOO_MANY_REDIRECTS`.

### Optional: a Cloudflare origin certificate instead

Only worth it if you'd rather not depend on the redirect chain at renewal
time, or you want to stop worrying about ACME rate limits. It's free, lasts 15
years and never renews. Trade-off: it's trusted *only* by Cloudflare, so
reaching the server directly shows a certificate warning.

**1. Create the certificate.** Cloudflare → **SSL/TLS → Origin Server →
Create Certificate**. Accept the generated private key, list the hostnames
`example.com` and `*.example.com`, choose 15 years. Copy both PEM blocks — the
key is shown only once.

**2. Install it on the server.** Traefik watches
`/etc/dokploy/traefik/dynamic` and hot-reloads it, and that directory is
mounted at the same path inside the container, so no restart and no
`traefik.yml` edits are needed:

```bash
sudo mkdir -p /etc/dokploy/traefik/dynamic/certs
sudo nano /etc/dokploy/traefik/dynamic/certs/origin.crt   # paste the certificate
sudo nano /etc/dokploy/traefik/dynamic/certs/origin.key   # paste the private key
sudo chmod 600 /etc/dokploy/traefik/dynamic/certs/origin.key

sudo tee /etc/dokploy/traefik/dynamic/origin-cert.yml >/dev/null <<'YAML'
tls:
  certificates:
    - certFile: /etc/dokploy/traefik/dynamic/certs/origin.crt
      keyFile: /etc/dokploy/traefik/dynamic/certs/origin.key
YAML
```

**3. Swap the router label** in `docker-compose.yml` from
`tls.certresolver=letsencrypt` to plain `tls=true`, so Traefik serves this
certificate instead of requesting one over ACME. Install the certificate
*before* redeploying — otherwise Traefik falls back to its self-signed default
and Cloudflare answers 526.

**4. Redeploy**, then set Cloudflare **SSL/TLS → Overview** to
**Full (strict)** and enable **Always Use HTTPS**.

> **The proxy only hides your server if nothing else exposes it.** This stack
> publishes port 3000 on the host, so `http://SERVER_IP:3000` still reaches the
> app in the clear, around Cloudflare. Once the domain works, drop the `ports:`
> block from `docker-compose.yml` — Traefik reaches the container over the
> Docker network and doesn't need it.

Because the network is declared external, plain `docker compose up` outside
Dokploy needs it to exist first:

```bash
docker network create dokploy-network
```

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
