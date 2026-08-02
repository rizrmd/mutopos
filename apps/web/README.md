# MutoPOS Web (`apps/web`)

Vite + React + TypeScript + **shadcn/ui** (Tailwind v4) shell for the POS client.

Offline store (RxDB) and custom outbox are **not** wired in this scaffold — see [`docs/architecture/`](../../docs/architecture/).

## Requirements

- Node.js 20+ (scaffold uses Node 24 / npm)

## Quick start

```bash
cd apps/web
npm install
npm run dev
```

Open http://127.0.0.1:5173

Build:

```bash
npm run build
npm run preview
```

## shadcn/ui

Configured via [`components.json`](./components.json). Path alias `@/*` → `src/*`.

Add components (example):

```bash
npx shadcn@latest add input dialog
```

Scaffold includes `Button` and `Card` under `src/components/ui/`.

## Dev proxy

Vite proxies `/api/*` → `http://127.0.0.1:8080/*` so the UI can call the Go API without CORS during local development.
