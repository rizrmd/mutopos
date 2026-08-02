# Client local store

## Decision summary

| Choice | Value |
|--------|--------|
| **Default** | **RxDB** |
| **Alternative** | Dexie (thinner IndexedDB; more DIY reactivity) |
| **Access pattern** | Thin **adapter / repository** — domain never imports RxDB/Dexie APIs |
| **Sync** | Custom outbox → Go API → Postgres ([outbox-sync.md](./outbox-sync.md)); **not** PowerSync / ElectricSQL |

See [ADR 0002](./adr/0002-rxdb-default-local-store.md) for the formal decision.

## Why a local store at all?

Offline-first POS needs durable client state:

- Open cart and line items  
- Cached product / price / stock snapshots for the counter  
- Device session and UI prefs  
- **Outbox** of commands not yet accepted by the server  

The UI must update instantly when that state changes (multiple observers: cart drawer, line editor, stock badge, payment panel).

## RxDB (default)

### Fit for MutoPOS

- **Reactive queries** — subscribe to cart documents, stock rows, outbox counts; multi-observer UI without manual event buses for every collection.  
- **Document model** — sales drafts, line items, catalog docs map naturally.  
- **Storage adapters** — IndexedDB in browser/PWA (and other adapters if we add shells later).  
- **Plugins** — use only what we need (e.g. migration helpers). Do **not** treat RxDB replication-to-Postgres-vendor as the product sync architecture.

### Responsibilities of the RxDB layer

- Collection schemas and migrations  
- Indexes for SKU, open-sale id, outbox status  
- Observable streams exposed **through** repositories (e.g. `watchCart(saleId)`)  
- Persistence of outbox documents  

### What RxDB does **not** own

- Final inventory truth after multi-device sales  
- Conflict resolution between cashiers  
- Authorization and pricing rules that must be enforced server-side  

Those belong in **Go + Postgres**.

## Dexie (alternative)

Dexie is a thin, mature IndexedDB wrapper.

| Dimension | RxDB (default) | Dexie (alternative) |
|-----------|----------------|---------------------|
| Reactive multi-observer DX | First-class observables / reactive query model | DIY (`liveQuery`, or push into app store) |
| Bundle / surface area | Heavier | Lighter, more control |
| Document + schema tooling | Richer schema/plugin ecosystem | Schema via Dexie versioning; simpler mental model |
| Lock-in risk | Medium if used without adapters | Lower surface, still needs adapters for swap |
| Offline POS fitness | Excellent for live cart/stock | Excellent storage; reactivity costs engineering time |
| Vendor Postgres-sync | Avoid as product path either way | Same — custom outbox only |

**When to pick Dexie:** hard bundle budgets, team already invested in Dexie, or deliberate minimalism—accepting that cart/stock multi-observer wiring is your problem.

**When to stay on RxDB:** default path for MutoPOS POS UI reactivity.

## Thin adapter / repository layer

### Principle

```
UI / domain use-cases
        │
        ▼
  CartRepository, StockRepository, OutboxRepository  (ports)
        │
        ▼
  RxDBCartRepository / …  (adapters — only place that imports 'rxdb')
```

### Rules

1. Feature and domain modules depend on **interfaces** (or plain module ports), not `RxDatabase` / Dexie `Table`.  
2. Mapping between domain types and storage documents happens in the adapter.  
3. Observable subscriptions return domain-friendly streams (or app-level signals), not raw RxDB query objects, where practical.  
4. Swapping RxDB → Dexie (or reverse) should touch **adapters + wiring**, not every screen.  
5. Outbox is just another repository: `enqueue`, `listPending`, `markSent`, `markFailed`.

### Why this matters

ADR 0001 rejects vendor **sync** lock-in. The adapter pattern rejects **storage API** lock-in. Together they keep MutoPOS portable without giving up a strong default (RxDB).

## Suggested collections (illustrative)

Names are guidance, not a frozen schema:

| Collection | Role |
|------------|------|
| `products` / `stock_lines` | Cached catalog + quantities for UI |
| `sales` / `cart_lines` | Open and recent local sales drafts |
| `outbox` | Pending commands for Go API |
| `meta` | Last pull cursor, device id, schema version |

Exact schemas live with implementation; this doc only anchors the architecture.

## Anti-patterns

- Calling `collection.find().$` from React/Vue components without a repository  
- Using PowerSync/Electric (or RxDB vendor replication to Postgres) as “the sync”  
- Treating local stock numbers as final after multi-device activity without server reconcile  
- Duplicating domain validation only on the client and skipping Go checks  

## Related

- [SaaS ERD — server tables and client collection mapping](../erd.md)  
- [ADR 0002 — RxDB default](./adr/0002-rxdb-default-local-store.md)  
- [Outbox & sync](./outbox-sync.md)  
- [Overview](./overview.md)  
