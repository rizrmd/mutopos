# MutoPOS documentation

Architecture and design decisions for **MutoPOS** — an offline-first point-of-sale system.

Domain authority and conflict resolution live in **Go + Postgres**. The browser/PWA client stores data locally (default: **[TinyBase](https://tinybase.org/)**), applies optimistic UI updates, and pushes changes through a **custom outbox** to the Go API. We deliberately avoid vendor Postgres-sync products (PowerSync, ElectricSQL, etc.).

## Documentation map

| Doc | Purpose |
|-----|---------|
| [erd.md](./erd.md) | **SaaS ERD** — Business tenant, WA login, outlet/staff, catalog, transaksi, outbox support |
| [architecture/overview.md](./architecture/overview.md) | High-level system shape: client, Go API, Postgres, offline boundary |
| [architecture/local-store.md](./architecture/local-store.md) | Client local store: **TinyBase default**, adapter/repository pattern |
| [architecture/outbox-sync.md](./architecture/outbox-sync.md) | Custom outbox, push path to Go, conflict ownership |
| [architecture/adr/](./architecture/adr/) | Architecture Decision Records |

## Key decisions (lobby-confirmed)

1. **Offline-first POS** — cashiers can sell when the network is down; server remains source of truth after sync.
2. **Custom outbox** — client → Go API → Postgres. **Not** PowerSync / ElectricSQL / vendor Postgres-sync.
3. **Default local store: TinyBase** — reactive tables for cart, stock lines, multi-observer UI ([ADR 0003](./architecture/adr/0003-tinybase-default-local-store.md)).
4. **Thin adapter/repository** above TinyBase so domain code is not glued to store APIs.
5. **Multi-tenant Business** with owner login via **WhatsApp E.164** OTP/magic login (see [ERD](./erd.md)).

## ADRs

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./architecture/adr/0001-offline-first-custom-outbox.md) | Offline-first POS with custom outbox to Go/Postgres | Accepted |
| [0002](./architecture/adr/0002-rxdb-default-local-store.md) | RxDB as default client local store | Superseded by 0003 |
| [0003](./architecture/adr/0003-tinybase-default-local-store.md) | TinyBase as default client local store | Accepted |

## Reading order

1. [overview.md](./architecture/overview.md) — system context  
2. [ADR 0001](./architecture/adr/0001-offline-first-custom-outbox.md) — why custom outbox, not vendor sync  
3. [local-store.md](./architecture/local-store.md) + [ADR 0003](./architecture/adr/0003-tinybase-default-local-store.md) — client storage  
4. [outbox-sync.md](./architecture/outbox-sync.md) — push path and conflicts  
5. [erd.md](./erd.md) — entities, keys, multi-tenant isolation, Mermaid ER diagram  

## Non-goals (for this doc set)

- Implementation of the Go API or schema migrations  
- Choosing a full frontend framework stack beyond local-store constraints  
- Using PowerSync, ElectricSQL, or similar as the sync path
