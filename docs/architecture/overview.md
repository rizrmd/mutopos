# MutoPOS architecture overview

## Purpose

MutoPOS is a **point-of-sale (POS)** product that must keep working when connectivity is poor or offline. Cashiers add items to a cart, adjust stock-visible lines, and complete sales without waiting on the network. When connectivity returns, changes are pushed to the server; the **server decides** what is valid and how conflicts resolve.

## System shape

```
┌─────────────────────────────────────────────────────────────┐
│  Client (browser / PWA / Electron shell)                    │
│                                                             │
│  UI (cart, stock, multi-observer)                           │
│       │                                                     │
│       ▼                                                     │
│  Domain services / use-cases                                │
│       │                                                     │
│       ▼                                                     │
│  Repository / adapter layer  ◄── thin; hides store vendor   │
│       │                                                     │
│       ▼                                                     │
│  Local store (default: TinyBase)  +  Outbox table           │
│       │                                                     │
│       │  push when online                                   │
│       ▼                                                     │
│  Sync worker (outbox → HTTP)                                │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS / JSON (or similar)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Go API                                                     │
│  • Auth, validation, domain rules                           │
│  • Conflict resolution & authoritative writes               │
│  • Idempotent command apply (outbox client ids)             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Postgres (source of truth)                                 │
└─────────────────────────────────────────────────────────────┘
```

## Layers

| Layer | Responsibility | Authority |
|-------|----------------|-----------|
| **UI** | Reactive views: live cart, stock lines, multiple observers | Display only |
| **Domain (client)** | Local use-cases, optimistic writes, enqueue outbox events | Provisional |
| **Local store** | Persist documents offline; power reactive queries | Local only |
| **Outbox + sync worker** | Reliable push of pending commands to Go | Delivery |
| **Go API** | Validate, apply business rules, resolve conflicts | **Authoritative** |
| **Postgres** | Durable system of record | **Authoritative storage** |

## Offline-first principles

1. **Read/write locally first** — UI never blocks on the network for core POS actions.
2. **Provisional vs committed** — client state is optimistic until the Go API accepts it.
3. **Server wins on conflict** — Go + Postgres own final truth; client merges or rewrites from server responses / pull snapshots.
4. **No vendor Postgres-sync** — we do not pipe Postgres change streams through PowerSync, ElectricSQL, or similar into the client. Sync is **application-level**: custom outbox + API contracts.
5. **Adapter isolation** — domain code talks to repositories, not TinyBase APIs directly.

## Why not client-only truth?

POS data (inventory, prices, multi-device cashiers, refunds) must not diverge permanently across devices. Local storage optimizes **latency and availability**; **correctness and multi-device consistency** stay on the server.

## Related docs

- [SaaS ERD (entities, multi-tenant, outbox tables)](../erd.md)
- [ADR 0001 — Offline-first + custom outbox](./adr/0001-offline-first-custom-outbox.md)
- [Local store (TinyBase default)](./local-store.md)
- [Outbox & sync path](./outbox-sync.md)
- [ADR 0003 — TinyBase default](./adr/0003-tinybase-default-local-store.md)
- [ADR 0002 — RxDB (superseded)](./adr/0002-rxdb-default-local-store.md)
