# Client local store

## Decision summary

| Choice | Value |
|--------|--------|
| **Default** | **[TinyBase](https://tinybase.org/)** (IndexedDB persister) |
| **Previous default** | RxDB (see [ADR 0002](./adr/0002-rxdb-default-local-store.md), superseded) |
| **Access pattern** | Thin **adapter / repository** — domain never imports TinyBase APIs |
| **Sync** | Custom outbox → Go API → Postgres ([outbox-sync.md](./outbox-sync.md)); **not** PowerSync / ElectricSQL |

See [ADR 0003](./adr/0003-tinybase-default-local-store.md) for the formal decision.

## Why a local store at all?

Offline-first POS needs durable client state:

- Open cart and line items  
- Cached product / price / stock snapshots for the counter  
- Device session and UI prefs  
- **Outbox** of commands not yet accepted by the server  

The UI must update instantly when that state changes (multiple observers: cart drawer, line editor, stock badge, payment panel).

## TinyBase (default)

### Fit for MutoPOS

- **Reactive tables** — listeners on `outbox` / `sales` / `products` without a separate event bus for every collection.  
- **Tabular model** — sales drafts, catalog rows, outbox entries map to TinyBase tables and rows.  
- **Persistence** — official IndexedDB persister (`createIndexedDbPersister`); optional localStorage / other backends later.  
- **Light surface** — no document-DB plugin stack; filtering stays in repository helpers at POS data volumes.

### Responsibilities of the TinyBase layer

- Table layout and cell typing conventions  
- Load + auto-save via IndexedDB persister  
- Listeners exposed **through** repositories (e.g. outbox stats subscription)  
- Persistence of outbox rows and local sales  

### What TinyBase does **not** own

- Final inventory truth after multi-device sales  
- Conflict resolution between cashiers  
- Authorization and pricing rules that must be enforced server-side  

Those belong in **Go + Postgres**.

## Thin adapter / repository layer

### Principle

```
UI / domain use-cases
        │
        ▼
  CartRepository, StockRepository, OutboxRepository  (ports)
        │
        ▼
  apps/web/src/lib/db.ts  (only module that imports 'tinybase')
```

### Rules

1. Feature and domain modules depend on **helpers / interfaces**, not `Store` from TinyBase (except infrastructure).  
2. Mapping between domain types and table cells happens in the repository.  
3. Subscriptions return domain-friendly callbacks (e.g. `subscribeOutbox`), not raw listener ids, where practical.  
4. Swapping storage backends should touch **repository + wiring**, not every screen.  
5. Outbox is just another repository surface: `enqueueOutbox`, `listPendingOutbox`, `patchOutbox`.

### Why this matters

ADR 0001 rejects vendor **sync** lock-in. The adapter pattern rejects **storage API** lock-in. Together they keep MutoPOS portable without giving up a strong default (TinyBase).

## Suggested tables (implementation)

| Table | Role |
|-------|------|
| `products` | Cached catalog lines for queries / fallback |
| `sales` | Local completed / pending tickets |
| `outbox` | Pending commands for Go API |
| `meta` | Device id, catalog JSON snapshot (`catalog:{businessId}`), schema notes |

Exact cell shapes live in `apps/web/src/lib/db.ts`.

## Anti-patterns

- Calling `store.getTable` / TinyBase listeners from React components without a repository  
- Using PowerSync/Electric (or any vendor Postgres replication to client) as “the sync”  
- Treating local stock numbers as final after multi-device activity without server reconcile  
- Duplicating domain validation only on the client and skipping Go checks  

## Related

- [SaaS ERD — server tables and client collection mapping](../erd.md)  
- [ADR 0003 — TinyBase default](./adr/0003-tinybase-default-local-store.md)  
- [Outbox & sync](./outbox-sync.md)  
- [Overview](./overview.md)  
