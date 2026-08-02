# MutoPOS API (`apps/api`)

Go HTTP API + PostgreSQL. System of record for multi-tenant POS (see [`docs/erd.md`](../../docs/erd.md)).

## Requirements

- Go 1.22+
- PostgreSQL 14+ reachable via `DATABASE_URL`

**No Docker** — point `DATABASE_URL` at any local or hosted Postgres.

## Quick start

```bash
cd apps/api
cp .env.example .env
# edit DATABASE_URL

go run ./cmd/api -migrate   # optional
go run ./cmd/api            # :8080, AUTO_MIGRATE=true by default
```

```bash
CGO_ENABLED=0 go build -o bin/api ./cmd/api
go test ./...
```

## Auth (WhatsApp OTP stub)

1. `POST /v1/auth/otp/request` `{ "phone_e164": "+628…" }`  
2. `POST /v1/auth/otp/verify` `{ "phone_e164", "code", "display_name?" }` → `access_token`  
3. Subsequent calls: `Authorization: Bearer <token>`  
4. Tenant routes: `X-Business-Id: <uuid>` (+ optional outlet/staff/device headers)

In development, response includes `dev_code` (default `OTP_STUB_CODE=000000`). No real WA provider.

First login with no memberships **bootstraps** a business, main outlet, and owner staff profile.

## Domain routes

All tenant routes require auth + `X-Business-Id`.

| Method | Path | Notes |
|--------|------|--------|
| GET/POST | `/v1/businesses` | Memberships / create |
| GET/POST | `/v1/outlets` | List / create |
| PATCH | `/v1/outlets/{id}` | Update |
| GET/POST | `/v1/staff` | List / create |
| GET/POST | `/v1/categories` | Catalog |
| GET/POST/PATCH | `/v1/products` | Catalog + default price |
| GET | `/v1/sales`, `/v1/sales/{id}` | History / detail |
| POST | `/v1/sales/complete` | Online complete sale |
| POST | `/v1/devices` | Register client device key |
| POST | `/v1/commands` | **Outbox push** (idempotent `command_id`) |
| GET | `/v1/commands/{id}` | Command receipt |

### Outbox command types

| `command_type` | Payload | Effect |
|----------------|---------|--------|
| `sale.complete` | Same shape as online complete sale | Inserts sale/lines/payments; stock decrement; receipt |
| `catalog.product.upsert` | `{ name, sku?, price_minor?, id? }` | Product upsert |

Idempotency: `command_receipts.command_id` + sales `UNIQUE (business_id, client_sale_id)`.

## Layout

```
apps/api/
  cmd/api/              entrypoint
  internal/config/      env
  internal/authutil/    phone normalize, token/OTP hash
  internal/db/          pool + migrate
  internal/httpapi/     routes + domain handlers
  migrations/           001_init.sql (ERD)
```

## Env

See [`.env.example`](./.env.example) and root [`README.md`](../../README.md).
