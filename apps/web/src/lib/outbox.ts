import { api, type TenantHeaders } from '@/lib/api'
import { getDb, type OutboxDoc } from '@/lib/db'

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

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn)
  void emitStats()
  return () => listeners.delete(fn)
}

async function emitStats() {
  const stats = await getOutboxStats()
  for (const fn of listeners) fn(stats)
}

export async function getOutboxStats(): Promise<OutboxStats> {
  try {
    const db = await getDb()
    const all = await db.outbox.find().exec()
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
  workerTimer = setInterval(tick, 2500)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', tick)
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
    const db = await getDb()
    const pending = await db.outbox
      .find({
        selector: {
          status: { $in: ['pending', 'failed'] },
          businessId: tenant.businessId,
        },
        sort: [{ createdAt: 'asc' }],
      })
      .exec()

    for (const doc of pending) {
      const data = doc.toJSON() as OutboxDoc
      if (data.attempts >= 8 && data.status === 'failed') continue

      await doc.patch({
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
          await doc.patch({
            status: 'sent',
            lastError: '',
            resultJson: JSON.stringify(res.result ?? res),
          })
          // mark local sale synced if sale.complete
          if (data.type === 'sale.complete' && payload && typeof payload === 'object') {
            const p = payload as { client_sale_id?: string }
            if (p.client_sale_id) {
              const sale = await db.sales
                .findOne({ selector: { clientSaleId: p.client_sale_id } })
                .exec()
              if (sale) {
                const result = (res.result ?? {}) as {
                  id?: string
                  receipt_no?: string
                }
                await sale.patch({
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
          await doc.patch({
            status: 'failed',
            lastError: res.message ?? res.error ?? 'rejected',
          })
          lastError = res.message ?? res.error
        } else {
          await doc.patch({
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
        await doc.patch({
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
