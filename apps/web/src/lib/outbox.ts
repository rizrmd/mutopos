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
let running = false
let lastError: string | undefined
let lastSyncAt: number | undefined
const listeners = new Set<Listener>()
let tableUnsub: (() => void) | null = null

export function subscribeOutbox(fn: Listener): () => void {
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
  const stats = await getOutboxStats()
  for (const fn of listeners) fn(stats)
}

export async function getOutboxStats(): Promise<OutboxStats> {
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
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    }
  } catch {
    return {
      pending: 0,
      failed: 0,
      inFlight: 0,
      lastError,
      lastSyncAt,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    }
  }
}

export function startOutboxWorker(getTenant: () => TenantHeaders | null) {
  if (workerTimer) return
  const tick = () => {
    void flushOutbox(getTenant)
  }
  // Seamless background sync — no manual Sync button needed
  workerTimer = setInterval(tick, 1500)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', tick)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick()
    })
  }
  tick()
}

export function stopOutboxWorker() {
  if (workerTimer) {
    clearInterval(workerTimer)
    workerTimer = null
  }
}

export async function flushOutbox(
  getTenant: () => TenantHeaders | null,
): Promise<void> {
  if (running) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await emitStats()
    return
  }
  const tenant = getTenant()
  if (!tenant?.token || !tenant.businessId) {
    await emitStats()
    return
  }

  running = true
  try {
    const pending = await listPendingOutbox(tenant.businessId)

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
          if (data.type === 'sale.complete' && payload && typeof payload === 'object') {
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
        // 4xx permanent domain errors → failed; network/5xx → pending retry
        await patchOutbox(data.id, {
          status: status >= 400 && status < 500 ? 'failed' : 'pending',
          lastError: msg,
        })
        lastError = msg
      }
      await emitStats()
    }
  } finally {
    running = false
    await emitStats()
  }
}

export type { OutboxDoc }
