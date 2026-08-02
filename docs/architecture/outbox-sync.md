# Outbox and sync path

## Goal

Move client-side POS mutations to the **authoritative** system (**Go API → Postgres**) reliably, without vendor Postgres-sync products.

This is the application-level counterpart to [ADR 0001](./adr/0001-offline-first-custom-outbox.md).

## Not in scope as product sync

Do **not** use as the recommended path:

- **PowerSync**  
- **ElectricSQL**  
- Other **vendor Postgres-sync / logical replication-to-client** stacks  

Reasons: lock-in, blurred conflict ownership, and mismatch with “commands + domain rules in Go.”

## High-level flow

```
[User action: add line / pay / adjust]
        │
        ▼
[Domain use-case]
  • validate locally (best-effort)
  • write optimistic local state (RxDB via repository)
  • append OutboxEntry (durable)
        │
        ▼
[Outbox worker]  (online only / backoff)
  • load pending entries (FIFO or priority)
  • POST /api/...  with idempotency key = entry id
        │
        ├─ success → mark outbox sent; apply server payload to local store
        ├─ 4xx domain reject → mark failed / compensate local optimistic state
        └─ 5xx / network → leave pending; retry with backoff
```

Pull (server → client) is separate: snapshots or deltas via normal Go endpoints when the product needs multi-device refresh. Pull is **not** a substitute for outbox push of local commands.

## Outbox entry (conceptual)

| Field | Purpose |
|-------|---------|
| `id` | Client-generated UUID; **idempotency key** on the server |
| `type` | Command name (`sale.line.add`, `sale.complete`, …) |
| `payload` | Opaque JSON for that command version |
| `createdAt` | Ordering / debug |
| `status` | `pending` \| `in_flight` \| `sent` \| `failed` |
| `attempts` | Retry count |
| `lastError` | Optional diagnostics |

Persist outbox in the **same local store** as cart data (RxDB collection by default) so a crash does not drop unpaid or unsynced work.

## Push path (client → Go)

1. **Enqueue** happens in the same unit of work as the optimistic local write when possible.  
2. **Worker** runs when `navigator.onLine` (or equivalent) and auth is valid.  
3. **One entry at a time** (or small batches if the API is designed for it)—prefer simplicity first.  
4. **Idempotency:** Go must treat `id` (or explicit `Idempotency-Key`) as unique; re-sending after timeout must not double-apply a sale.  
5. **Response handling:**  
   - Accepted → update local entities with server ids/versions; mark outbox sent.  
   - Conflict / business rule failure → apply server’s decision (reject line, adjust stock view, surface message); do not silently leave divergent cart.  
6. **Auth:** tokens refresh without dropping the outbox; failed auth pauses the worker, does not delete entries.

## Conflict ownership (Go + Postgres)

| Concern | Owner |
|---------|--------|
| “Is this stock available after concurrent sales?” | Go + Postgres |
| “May this price / discount apply?” | Go (policy) |
| “Did this payment already complete?” | Go (idempotency) |
| “What does the cashier see offline?” | Client optimistic + last known cache |
| “What is the system of record after sync?” | Postgres via Go |

Client may use versions / etags if the API provides them; **merge policy is server-defined**, not “last write wins in IndexedDB.”

## Client responsibilities after server response

- Replace provisional ids with server ids when returned.  
- Reconcile stock lines from server payload or a follow-up pull.  
- Surface user-visible errors for permanent failures (payment declined, SKU blocked).  
- Keep **sent** outbox rows for a retention window (debug) or prune—product choice; do not lose **pending**.

## Failure modes (brief)

| Failure | Behavior |
|---------|----------|
| Offline for hours | Local POS continues; outbox grows; push on reconnect |
| App killed mid-flight | Entry stays `pending` or `in_flight` with timeout → retry; server idempotency protects double apply |
| Schema command v1 vs v2 | Version field on entry; Go supports or rejects clearly |
| Partial multi-command sale | Prefer single command for “complete sale” or explicit saga; document command boundaries in API design |

## Relation to RxDB

RxDB holds outbox documents and reactive “pending sync” badges in the UI. It is **storage + reactivity**, not the conflict engine. See [local-store.md](./local-store.md).

## Checklist for implementers

- [ ] Outbox durable before acknowledging local success for critical actions  
- [ ] Idempotent Go handlers  
- [ ] No PowerSync/Electric in the critical path  
- [ ] Repositories abstract storage  
- [ ] Conflict/error UX defined for rejected optimistic sales  

## Related

- [ADR 0001](./adr/0001-offline-first-custom-outbox.md)  
- [Overview](./overview.md)  
- [Local store](./local-store.md)  
