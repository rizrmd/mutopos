# ADR 0002: RxDB as default client local store

- **Status:** Superseded by [ADR 0003](./0003-tinybase-default-local-store.md)  
- **Date:** 2026-08-02  
- **Deciders:** MutoPOS room / lobby (confirmed for implementation docs)  
- **Note:** Historical decision. Client local store default is now **TinyBase**.

## Context

The MutoPOS client needs a durable local database for:

- Cart and open sales  
- Stock / product lines visible at the counter  
- Settings and cached catalogs  
- **Outbox** entries pending push to Go  

POS UI is highly **reactive**: multiple widgets must re-render when cart lines, quantities, or stock change (multi-observer). Two realistic IndexedDB-oriented options:

| Option | Character |
|--------|-----------|
| **RxDB** | Document DB over storage adapters; **reactive** query observables; plugins for replication (we will **not** use vendor Postgres replication plugins as the product path) |
| **Dexie** | Thin IndexedDB wrapper; excellent control and small surface; reactivity is DIY (liveQuery / external stores) |

We must also **mitigate lock-in**: whatever we pick should sit behind a **repository/adapter** so domain code is not sprinkled with vendor APIs.

## Decision

1. **RxDB is the default** client local store for MutoPOS.
2. Primary reason: **reactive POS UX** — live cart, stock lines, multi-observer subscriptions with less glue than hand-rolled Dexie + signal/store wiring.
3. **Dexie remains a documented alternative** for teams that prioritize minimal bundle and maximal control, accepting more work for reactive multi-observer UI.
4. All domain and UI data access goes through a **thin adapter / repository layer**; RxDB types and collections stay inside infrastructure modules.
5. RxDB’s own replication plugins toward Postgres-sync vendors are **out of scope** for the product path. Sync remains the **custom outbox → Go API** path ([ADR 0001](./0001-offline-first-custom-outbox.md)).

## Consequences

### Positive

- Strong fit for live cart and stock UIs.  
- Schema/collections model maps cleanly to POS documents.  
- Observables reduce ad-hoc “notify every screen” code.

### Negative / tradeoffs

- Larger dependency surface than Dexie.  
- Team must still learn RxDB constraints (schema, migrations, storage adapters).  
- Risk of leaking RxDB APIs into domain if adapter discipline is weak — mitigated by convention and reviews.

### Dexie alternative (when to consider)

- Extreme bundle size constraints  
- Preference for imperative IndexedDB control  
- Willingness to own reactivity (e.g. Dexie `liveQuery` + app state)  

Switching is feasible **only if** repositories abstract storage; do not call RxDB from feature modules.

## Alternatives considered

| Option | Outcome |
|--------|---------|
| RxDB (default) | **Accepted** |
| Dexie | Alternative; document tradeoffs in [local-store.md](../local-store.md) |
| raw IndexedDB | Too low-level for product velocity |
| LocalStorage / memory only | Not durable enough for offline POS |
| Vendor sync-bundled client DB only | Rejected with ADR 0001 |

## References

- [Local store guide](../local-store.md)
- [Overview](../overview.md)
