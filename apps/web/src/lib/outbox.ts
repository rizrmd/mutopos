import { api, type TenantHeaders } from '@/lib/api'
import {
  findLocalSaleByClientId,
  listOutboxDocs,
  listPendingOutbox,
  patchLocalSale,
  patchOutbox,
  subscribeTable,
  TABLES,
  type OutboxDoc,
} from '@/lib/db'
import { isOnline, isTransportError, subscribeOnline } from '@/lib/net'

export type OutboxStats = {
  pending: number
  failed: number
  inFlight: number
  lastSyncAt?: number
  lastError?: string
  online: boolean
}

type Listener = (s: OutboxStats) => void

let workerTimer: ReturnType<typeof setInterval> | null = null
let onlineUnsub: (() => void) | null = null
let running = false
let lastError: string | undefined
let lastSyncAt: number | undefined
const listeners = new Set<Listener>()
let tableUnsub: (() => void) | null = null

export function subscribeOutbox(fn: Listener): () => void {
  'background only'
  listeners.add(fn)
  void emitStats()
  // Reactivity: re-emit when outbox table changes (TinyBase listener).
  if (!tableUnsub) {
    tableUnsub = subscribeTable(TABLES.outbox, () => {
      void emitStats()
    })
  }
  return () => {
    listeners.delete(fn)
  }
}

async function emitStats() {
  'background only'
  const stats = await getOutboxStats()
  for (const fn of listeners) fn(stats)
}

export async function getOutboxStats(): Promise<OutboxStats> {
  'background only'
  try {
    const all = await listOutboxDocs()
    const pending = all.filter((d) => d.status === 'pending').length
    const failed = all.filter((d) => d.status === 'failed').length
    const inFlight = all.filter((d) => d.status === 'in_flight').length
    return {
      pending,
      failed,
      inFlight,
      lastSyncAt,
      lastError,
      online: isOnline(),
    }
  } catch {
    return {
      pending: 0,
      failed: 0,
      inFlight: 0,
      lastError,
      lastSyncAt,
      online: isOnline(),
    }
  }
}

export function startOutboxWorker(getTenant: () => TenantHeaders | null) {
  'background only'
  if (workerTimer) return
  const tick = () => {
    void flushOutbox(getTenant)
  }
  // Seamless background sync — no manual Sync button needed.
  workerTimer = setInterval(tick, 1500)
  // There is no `window` 'online' event in Lynx; connectivity is inferred from
  // API traffic, so flush as soon as reachability comes back.
  onlineUnsub = subscribeOnline((online) => {
    if (online) tick()
  })
  tick()
}

export function stopOutboxWorker() {
  'background only'
  if (workerTimer) {
    clearInterval(workerTimer)
    workerTimer = null
  }
  if (onlineUnsub) {
    onlineUnsub()
    onlineUnsub = null
  }
}

export async function flushOutbox(
  getTenant: () => TenantHeaders | null,
): Promise<void> {
  'background only'
  if (running) return
  const tenant = getTenant()
  if (!tenant?.token || !tenant.businessId) {
    await emitStats()
    return
  }

  running = true
  try {
    const pending = await listPendingOutbox(tenant.businessId)

    if (pending.length === 0) {
      // Nothing to push, so nothing would otherwise touch the network — probe
      // so the shell's Online badge recovers once the API comes back.
      if (!isOnline()) await api.health()
      await emitStats()
      return
    }

    for (const data of pending) {
      if (data.attempts >= 8 && data.status === 'failed') continue

      await patchOutbox(data.id, {
        status: 'in_flight',
        attempts: data.attempts + 1,
      })
      await emitStats()

      try {
        const payload = JSON.parse(data.payload) as unknown
        const res = await api.pushCommand(tenant, {
          command_id: data.id,
          command_type: data.type,
          command_version: 1,
          payload,
        })
        if (res.status === 'applied' || res.idempotent_replay) {
          await patchOutbox(data.id, {
            status: 'sent',
            lastError: '',
            resultJson: JSON.stringify(res.result ?? res),
          })
          // mark local sale synced if sale.complete
          if (
            data.type === 'sale.complete' &&
            payload &&
            typeof payload === 'object'
          ) {
            const p = payload as { client_sale_id?: string }
            if (p.client_sale_id) {
              const sale = await findLocalSaleByClientId(p.client_sale_id)
              if (sale) {
                const result = (res.result ?? {}) as {
                  id?: string
                  receipt_no?: string
                }
                await patchLocalSale(sale.id, {
                  synced: true,
                  status: 'completed',
                  serverId: result.id,
                  receiptNo: result.receipt_no,
                })
              }
            }
          }
          lastSyncAt = Date.now()
          lastError = undefined
        } else if (res.status === 'rejected') {
          await patchOutbox(data.id, {
            status: 'failed',
            lastError: res.message ?? res.error ?? 'rejected',
          })
          lastError = res.message ?? res.error
        } else {
          await patchOutbox(data.id, {
            status: 'pending',
            lastError: 'unexpected status',
          })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const status =
          e && typeof e === 'object' && 'status' in e
            ? Number((e as { status: number }).status)
            : 0
        // 4xx permanent domain errors → failed; network/5xx → pending retry.
        await patchOutbox(data.id, {
          status: status >= 400 && status < 500 ? 'failed' : 'pending',
          lastError: msg,
        })
        lastError = msg
        // The API is unreachable — stop hammering it until the next tick.
        if (isTransportError(e)) break
      }
      await emitStats()
    }
  } finally {
    running = false
    await emitStats()
  }
}

export type { OutboxDoc }
