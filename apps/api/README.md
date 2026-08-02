# MutoPOS API (`apps/api`)

Go HTTP API + PostgreSQL. System of record for multi-tenant POS (see [`docs/erd.md`](../../docs/erd.md)).

## Requirements

- Go 1.22+ (scaffold developed with Go 1.24)
- PostgreSQL 14+ reachable via `DATABASE_URL`

**No Docker** in this scaffold — point `DATABASE_URL` at any local or hosted Postgres.

## Quick start

```bash
cd apps/api
cp .env.example .env
# edit DATABASE_URL to your Postgres

# create database once (example with psql):
# psql "$DATABASE_URL" -c 'SELECT 1'  # or create DB first:
# createdb mutopos   # or: psql postgres -c "CREATE DATABASE mutopos;"

# migrate only
go run ./cmd/api -migrate

# run API (auto-migrates when AUTO_MIGRATE=true)
go run ./cmd/api
```

Health:

- `GET /healthz` — process up
- `GET /readyz` — Postgres reachable
- `GET /v1/meta` — scaffold metadata

## Migrations

SQL lives in [`migrations/`](./migrations/) and is embedded into the binary.

| File | Purpose |
|------|---------|
| `001_init.sql` | Full initial ERD: users/WA auth, businesses, outlets, staff, catalog, sales, devices, command_receipts |

Applied versions are recorded in `schema_migrations`.

## Layout

```
apps/api/
  cmd/api/           entrypoint
  internal/config/   env loading
  internal/db/       pool + migrate runner
  internal/httpapi/  HTTP routes
  migrations/        SQL + embed.go
```

## Next (not in scaffold)

- WhatsApp OTP login handlers
- Tenant-scoped domain APIs
- Idempotent outbox command apply (`command_receipts`)
