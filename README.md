# MutoPOS

Offline-first multi-tenant POS (point of sale).

| Layer | Stack | Role |
|-------|--------|------|
| **Client** | Vite + React + shadcn/ui + **RxDB** (`apps/web`) | POS UI, local store, **custom outbox** |
| **API** | Go + PostgreSQL (`apps/api`) | Auth, domain rules, authoritative writes, `command_receipts` |
| **Docs** | [`docs/`](./docs/) | Architecture (offline/outbox) + SaaS ERD |

**No Docker** in this monorepo — set `DATABASE_URL` to any local or hosted Postgres.

## Repository layout

```
mutopos/
  apps/
    api/          Go HTTP API + SQL migrations (ERD)
    web/          Vite React TypeScript + shadcn + RxDB outbox
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
createdb mutopos
# or
psql postgres -c "CREATE DATABASE mutopos;"
```

Hosted options (Supabase, Neon, RDS, managed Postgres, etc.) work the same: set `DATABASE_URL`.

## Environment

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | Postgres connection string |
| `HTTP_ADDR` | `:8080` | API listen address |
| `APP_ENV` | `development` | `development` exposes OTP `dev_code` in responses |
| `AUTO_MIGRATE` | `true` | Run SQL migrations on API start |
| `SESSION_SECRET` | dev default | Salts session / OTP hashes |
| `OTP_STUB_CODE` | `000000` | Fixed WhatsApp OTP for the stub (empty = still uses stub, logs code) |
| `VITE_API_BASE` | `/api` | Web → API base (dev proxy rewrites `/api` → `:8080`) |

Sample:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mutopos?sslmode=disable
HTTP_ADDR=:8080
APP_ENV=development
AUTO_MIGRATE=true
SESSION_SECRET=change-me
OTP_STUB_CODE=000000
```

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

Build:

```bash
cd apps/api
CGO_ENABLED=0 go build -o bin/api ./cmd/api
./bin/api
```

Tests:

```bash
cd apps/api && go test ./...
```

### Main API surface

| Area | Endpoints |
|------|-----------|
| Health | `GET /healthz`, `GET /readyz`, `GET /v1/meta` |
| Auth (WA OTP stub) | `POST /v1/auth/otp/request`, `POST /v1/auth/otp/verify`, `POST /v1/auth/logout`, `GET /v1/me` |
| Business | `GET/POST /v1/businesses`, `GET /v1/businesses/{id}` |
| Outlet / staff | `GET/POST /v1/outlets`, `PATCH /v1/outlets/{id}`, `GET/POST /v1/staff` |
| Catalog | `GET/POST /v1/categories`, `GET/POST/PATCH /v1/products` |
| Sales | `GET /v1/sales`, `GET /v1/sales/{id}`, `POST /v1/sales/complete` |
| Outbox push | `POST /v1/devices`, `POST /v1/commands`, `GET /v1/commands/{id}` |

**Auth:** Bearer session token from OTP verify.  
**Tenant:** send `X-Business-Id` (required for domain routes). Optional: `X-Outlet-Id`, `X-Staff-Id`, `X-Device-Key`.

**OTP stub:** no real WhatsApp provider. In `development` (or when `OTP_STUB_CODE` is set), `otp/request` returns `dev_code` (default `000000`). First successful login bootstraps a Business, Main Outlet, and owner staff row.

Schema: [`apps/api/migrations/001_init.sql`](./apps/api/migrations/001_init.sql) ↔ [`docs/erd.md`](./docs/erd.md).

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

Dev proxy: `/api/*` → `http://127.0.0.1:8080/*` (`apps/web/vite.config.ts`).

### Web flows

1. **Login** — phone E.164 + OTP stub  
2. **Tenant context** — business / outlet / staff selectors in the shell  
3. **Catalog** — create categories & products (cached into RxDB)  
4. **POS** — cart → complete **online** (`POST /v1/sales/complete`) or **via outbox**  
5. **Receipts** — server list/detail + local RxDB sale docs  

## Offline outbox (RxDB → Go)

Aligns with [outbox-sync.md](./docs/architecture/outbox-sync.md) and ADR 0001 (custom outbox — **not** PowerSync/Electric).

```
User completes sale (Force outbox / offline)
        │
        ▼
RxDB: sales doc (synced=false) + outbox entry
  id = command_id (UUID, idempotency key)
  type = sale.complete
  payload = sale JSON
  status = pending
        │
        ▼
Outbox worker (every ~2.5s + on online)
  POST /api/v1/commands
  Authorization + X-Business-Id + X-Outlet-Id + X-Device-Key
        │
        ├─ applied / replay → outbox status=sent; local sale.synced=true
        ├─ 4xx rejected     → status=failed
        └─ network / 5xx    → leave pending; retry
```

Server stores each `command_id` in **`command_receipts`** and returns the same body on retry (no double apply). `sale.complete` is also idempotent on `(business_id, client_sale_id)`.

**Demo offline-then-sync**

1. Start API + web; login; add a product.  
2. On POS, enable **Force outbox**, complete a sale → pending badge increases.  
3. Click **Sync now** (or wait for the worker) → pending clears; sale appears under Receipts.  
4. Repeat the same command id (worker / server) → `idempotent_replay: true`.

Local collections (IndexedDB via Dexie storage): `outbox`, `products`, `sales`, `meta` (device key).

## Architecture pointers

- [Architecture overview](./docs/architecture/overview.md)  
- [ADR 0001](./docs/architecture/adr/0001-offline-first-custom-outbox.md) — custom outbox  
- [ADR 0002](./docs/architecture/adr/0002-rxdb-default-local-store.md) — RxDB default  
- [ERD](./docs/erd.md) — multi-tenant model + WA owner login  

## License

Private / unlicensed unless stated otherwise.
