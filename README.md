# MutoPOS

Offline-first multi-tenant POS (point of sale).

| Layer | Stack | Role |
|-------|--------|------|
| **Client** | Vite + React + shadcn/ui (`apps/web`) | POS UI; later: RxDB + custom outbox |
| **API** | Go + PostgreSQL (`apps/api`) | Auth, domain rules, authoritative writes |
| **Docs** | [`docs/`](./docs/) | Architecture (offline/outbox) + SaaS ERD |

**Not in scope for this scaffold:** Docker / docker-compose, full WhatsApp OTP flow, RxDB offline client.

## Repository layout

```
mutopos/
  apps/
    api/          Go HTTP API + SQL migrations (ERD)
    web/          Vite React TypeScript + shadcn shell
  docs/
    architecture/ Offline-first + custom outbox ADRs
    erd.md        Multi-tenant Business, WA login, catalog, transaksi
  README.md       This file
```

## Prerequisites

| Tool | Notes |
|------|--------|
| **Go** 1.22+ | API (`apps/api`) |
| **Node.js** 20+ / npm | Web (`apps/web`) |
| **PostgreSQL** 14+ | Any local or hosted instance — **no Docker required** |

Create a database (examples):

```bash
# if you have a local Postgres superuser
createdb mutopos
# or
psql postgres -c "CREATE DATABASE mutopos;"
```

Hosted options (Supabase, Neon, RDS, managed Postgres, etc.) work the same: set `DATABASE_URL`.

## Environment

Root and API share the same Postgres URL pattern:

```bash
# from repo root
cp .env.example .env
# and/or
cp apps/api/.env.example apps/api/.env
```

Sample `DATABASE_URL`:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mutopos?sslmode=disable
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | Postgres connection string |
| `HTTP_ADDR` | `:8080` | API listen address |
| `APP_ENV` | `development` | Environment label |
| `AUTO_MIGRATE` | `true` | Run SQL migrations on API start |

## Run: Postgres

1. Start or use an existing Postgres server (local install, package manager, or cloud).
2. Create database `mutopos` (or any name you prefer).
3. Set `DATABASE_URL` to match user, password, host, port, and DB name.
4. Confirm connectivity:

```bash
psql "$DATABASE_URL" -c 'SELECT version();'
```

This monorepo intentionally **does not** ship `docker-compose.yml` or Dockerfiles.

## Run: API

```bash
cd apps/api
cp .env.example .env   # set DATABASE_URL
go run ./cmd/api -migrate   # optional: migrate only
go run ./cmd/api            # listen on :8080 (auto-migrates by default)
```

Build binary:

```bash
cd apps/api
CGO_ENABLED=0 go build -o bin/api ./cmd/api
./bin/api
```

| Endpoint | Purpose |
|----------|---------|
| `GET /healthz` | Process liveness |
| `GET /readyz` | Postgres ready |
| `GET /v1/meta` | Scaffold metadata |

Schema is defined in [`apps/api/migrations/001_init.sql`](./apps/api/migrations/001_init.sql) and follows [`docs/erd.md`](./docs/erd.md):

- Platform: `users` (E.164), `auth_challenges`, `sessions`
- Tenant: `businesses`, `business_members`, `outlets`, `staff`, `staff_outlets`
- Catalog: `categories`, `products`, `product_prices`, `stock_levels`
- Sales: `sales`, `sale_lines`, `payments`
- Sync support: `devices`, `command_receipts`, `sync_pull_cursors`

## Run: Web

```bash
cd apps/web
npm install
npm run dev
```

Open http://127.0.0.1:5173

Production build:

```bash
cd apps/web
npm run build
npm run preview
```

Dev proxy: requests to `/api/*` are forwarded to `http://127.0.0.1:8080/*` (see `apps/web/vite.config.ts`).

## Architecture pointers

- [Architecture overview](./docs/architecture/overview.md) — client → outbox → Go → Postgres  
- [ADR 0001](./docs/architecture/adr/0001-offline-first-custom-outbox.md) — custom outbox, **not** PowerSync/Electric  
- [ADR 0002](./docs/architecture/adr/0002-rxdb-default-local-store.md) — RxDB default local store  
- [ERD](./docs/erd.md) — multi-tenant model + WA owner login  

## Next phases (out of this scaffold)

1. WhatsApp OTP login + sessions  
2. Tenant-scoped domain HTTP APIs  
3. Idempotent outbox command handlers  
4. Client RxDB repositories + outbox worker  

## License

Private / unlicensed unless stated otherwise.
