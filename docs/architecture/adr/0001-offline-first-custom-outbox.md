# ADR 0001: Offline-first POS with custom outbox to Go/Postgres

- **Status:** Accepted  
- **Date:** 2026-08-02  
- **Deciders:** MutoPOS room / lobby (confirmed for implementation docs)

## Context

MutoPOS must support cashiers who sell with intermittent or no network. Options considered for moving data between client and server:

1. **Vendor Postgres-sync** (PowerSync, ElectricSQL, and similar) — replicate or stream rows from Postgres into a client store with product-specific protocols and often paid/hosted components.
2. **Custom application sync** — client writes pending commands to a local **outbox**; a worker POSTs them to a **Go API**; Go applies domain rules and writes **Postgres**. Pull/delta can later be defined as ordinary API endpoints.
3. **Online-only** — reject offline POS (not acceptable for target environments).

We also need a clear answer to: *who owns conflicts?* Client libraries with “magic merge” can hide business rules that belong in inventory and sales domain logic.

## Decision

1. MutoPOS is **offline-first** on the client for core POS flows.
2. **Domain authority and conflict resolution** live in **Go + Postgres**, not in client DB merge plugins or vendor sync engines.
3. Sync client → server uses a **custom outbox**:
   - Local mutations enqueue durable outbox records.
   - When online, the client pushes outbox entries to the **Go API**.
   - Go validates, applies, resolves conflicts, and persists to **Postgres**.
   - Client updates local state from API responses (and future pull/snapshot endpoints as needed).
4. We **do not** adopt **PowerSync**, **ElectricSQL**, or other **vendor Postgres-sync** products as the recommended or default sync path.
5. Avoid **vendor sync lock-in**: transport and storage choices on the client must remain replaceable; the contract is our HTTP/command API, not a third-party replication wire format.

## Consequences

### Positive

- Full control over sales/inventory rules and conflict policy in one place (Go).
- No dependency on a sync vendor’s pricing, protocol, or Postgres extensions for the core path.
- Clear mental model: outbox = “commands not yet accepted by the server.”
- Works with any client local store (TinyBase default; see ADR 0003) as long as outbox is durable.

### Negative / tradeoffs

- We own reliability: retries, idempotency keys, backoff, partial failure, schema evolution of commands.
- Pull/reconcile and multi-device catch-up must be designed as product features, not freebies from a sync product.
- More application code than plugging a vendor sync SDK.

### Explicit non-goals of this ADR

- Specifying every command schema or HTTP route (see [outbox-sync.md](../outbox-sync.md) for the pattern).
- Choosing the client store vendor (see [ADR 0003](./0003-tinybase-default-local-store.md); historical [ADR 0002](./0002-rxdb-default-local-store.md)).

## Alternatives rejected

| Alternative | Why rejected |
|-------------|--------------|
| PowerSync | Vendor Postgres-sync lock-in; conflict/domain logic split; not needed for our outbox model |
| ElectricSQL | Same class: Postgres-centric sync product; lock-in and authority blur |
| Other “magic” client↔Postgres sync | Same principles |
| Online-only POS | Fails offline/intermittent retail requirement |

## References

- [Architecture overview](../overview.md)
- [Outbox & sync](../outbox-sync.md)
