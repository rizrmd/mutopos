# MutoPOS Web (`apps/web`)

Vite + React + TypeScript + shadcn/ui + **RxDB** custom outbox client.

## Run

```bash
cd apps/web
npm install
npm run dev      # http://127.0.0.1:5173
npm run build
```

API must be running on `:8080` (or set `VITE_API_BASE` to a full API origin). Dev proxy: `/api` → `http://127.0.0.1:8080`.

## Features

| Screen | Path | Notes |
|--------|------|--------|
| Login | `/login` | WA OTP stub |
| POS | `/` | Online sale + outbox sale |
| Catalog | `/catalog` | Product/category CRUD; caches to RxDB |
| Receipts | `/receipts` | Server list + local RxDB sales |

## Offline / outbox

See root [README — Offline outbox](../../README.md#offline-outbox-rxdb--go).

- `src/lib/db.ts` — RxDB (Dexie storage): `outbox`, `products`, `sales`, `meta`
- `src/lib/outbox.ts` — worker pushes `POST /v1/commands`
- POS **Force outbox** / offline → local write then sync
