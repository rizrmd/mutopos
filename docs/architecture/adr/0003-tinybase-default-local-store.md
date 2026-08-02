# ADR 0003: TinyBase as default client local store

- **Status:** Accepted  
- **Date:** 2026-08-02  
- **Deciders:** MutoPOS task migration (local-first → [TinyBase](https://tinybase.org/))  
- **Supersedes:** [ADR 0002](./0002-rxdb-default-local-store.md) (RxDB default)

## Context

MutoPOS already committed to offline-first POS with a **custom outbox → Go API → Postgres** path ([ADR 0001](./0001-offline-first-custom-outbox.md)). Client local storage previously defaulted to **RxDB** (ADR 0002) for reactive documents over IndexedDB (Dexie storage).

We want a lighter, explicit reactive store that:

- Persists to **IndexedDB** (and other media if needed later)  
- Models tabular POS data (outbox, products, sales, meta) without a heavy document-DB plugin surface  
- Keeps **domain/UI off vendor APIs** via a thin repository module  
- Does **not** adopt vendor Postgres-sync (PowerSync, Electric, etc.)

[TinyBase](https://tinybase.org/) is an in-memory reactive store with first-class **tables + values**, listeners, and optional persisters including IndexedDB.

## Decision

1. **TinyBase is the default** client local store for MutoPOS.
2. Persistence: **`createIndexedDbPersister`** (`tinybase/persisters/persister-indexed-db`) with auto-save; in-memory fallback if IDB fails.
3. Tables: `outbox`, `products`, `sales`, `meta` (same logical collections as before).
4. All feature code uses **repository helpers** in `apps/web/src/lib/db.ts` (and outbox worker in `outbox.ts`); pages do not import TinyBase APIs directly.
5. Sync remains **custom outbox → Go** only; TinyBase is storage + reactivity, not the conflict engine.
6. ADR 0002 is **superseded** (historical: RxDB was the prior default).

## Consequences

### Positive

- Smaller dependency graph vs RxDB + plugins + RxJS.  
- Simple table/row mental model matches outbox and sale docs.  
- Built-in listeners power outbox badge / multi-observer UI without ad-hoc buses.  
- IndexedDB persister is official and small to wire.

### Negative / tradeoffs

- No RxDB-style Mango query engine — filtering/sorting is app-side (acceptable at POS scale).  
- Schema is conventional (TypeScript types + repository), not JSON-schema validated at write.  
- Existing browser data under the old RxDB/Dexie DB name is **not** auto-migrated; users re-cache catalog after deploy (device key may rotate if only in old IDB).

### Alternatives considered

| Option | Outcome |
|--------|---------|
| Stay on RxDB | Rejected for this migration; heavier stack than needed |
| Dexie only | Possible; more DIY reactivity |
| TinyBase (default) | **Accepted** |
| Vendor sync client DB | Rejected with ADR 0001 |

## References

- https://tinybase.org/  
- [Local store guide](../local-store.md)  
- [ADR 0001 — custom outbox](./0001-offline-first-custom-outbox.md)  
- [ADR 0002 — RxDB (superseded)](./0002-rxdb-default-local-store.md)  
