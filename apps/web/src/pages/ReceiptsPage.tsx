import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api, formatIDR, type Sale } from '@/lib/api'
import { getDb } from '@/lib/db'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const TINTS = [
  'bg-emerald-700',
  'bg-rose-700',
  'bg-amber-600',
  'bg-sky-700',
  'bg-violet-700',
]

export function ReceiptsPage() {
  const { tenant, businessId } = useSession()
  const [sales, setSales] = useState<Sale[]>([])
  const [localPending, setLocalPending] = useState<
    Array<{ id: string; totalMinor: number; synced: boolean; createdAt: number }>
  >([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant || !businessId) return
    try {
      const res = await api.listSales(tenant)
      setSales(res.sales)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    const db = await getDb()
    const local = await db.sales
      .find({ selector: { businessId }, sort: [{ createdAt: 'desc' }] })
      .exec()
    setLocalPending(
      local.map((d) => ({
        id: d.clientSaleId,
        totalMinor: d.totalMinor,
        synced: d.synced,
        createdAt: d.createdAt,
      })),
    )
  }, [tenant, businessId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Receipts</h1>
        <p className="text-sm text-muted-foreground">
          Server sales and local tickets (auto-synced).
        </p>
      </div>

      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Server sales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-2">
          {sales.map((s, i) => (
            <Link
              key={s.id}
              to={`/receipts/${s.id}`}
              className="flex items-center gap-3 border border-border px-3 py-2.5 text-sm transition hover:bg-muted"
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center text-[10px] font-bold text-white',
                  TINTS[i % TINTS.length],
                )}
              >
                {(s.receipt_no ?? s.id).slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {s.receipt_no ?? s.id.slice(0, 8)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.status} · {s.completed_at ?? s.created_at}
                </div>
              </div>
              <div className="font-bold tabular-nums">
                {formatIDR(s.total_minor)}
              </div>
            </Link>
          ))}
          {sales.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No server sales yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Local tickets</CardTitle>
          <CardDescription>
            Offline sales sync automatically when online.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <ul className="space-y-2 text-sm">
            {localPending.map((s, i) => (
              <li
                key={s.id}
                className="flex items-center gap-3 border border-border px-3 py-2.5"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center text-[10px] font-bold text-white',
                    TINTS[i % TINTS.length],
                  )}
                >
                  {s.id.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{s.id.slice(0, 8)}…</div>
                  <div className="text-xs font-medium">
                    {s.synced ? (
                      <span className="text-emerald-800">Synced</span>
                    ) : (
                      <span className="text-amber-800">Pending sync</span>
                    )}
                  </div>
                </div>
                <span className="font-bold tabular-nums">
                  {formatIDR(s.totalMinor)}
                </span>
              </li>
            ))}
            {localPending.length === 0 ? (
              <li className="py-6 text-center text-muted-foreground">
                No local sales cached.
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

export function ReceiptDetailPage() {
  const { id } = useParams()
  const { tenant } = useSession()
  const [sale, setSale] = useState<Sale | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant || !id) return
    void api
      .getSale(tenant, id)
      .then(setSale)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [tenant, id])

  if (error) {
    return <p className="font-medium text-destructive">{error}</p>
  }
  if (!sale) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button variant="outline" size="sm" asChild>
        <Link to="/receipts">← Back</Link>
      </Button>
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle>
            Receipt {sale.receipt_no ?? sale.id.slice(0, 8)}
          </CardTitle>
          <CardDescription>
            {sale.status} · {sale.completed_at ?? sale.created_at}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-2 text-sm">
          <ul className="space-y-2">
            {(sale.lines ?? []).map((l, i) => (
              <li key={l.id ?? i} className="flex justify-between gap-3">
                <span className="flex gap-2">
                  <span className="w-4 text-xs font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="font-medium">
                    {l.name_snapshot} × {l.qty}
                  </span>
                </span>
                <span className="font-bold tabular-nums">
                  {formatIDR(l.line_total_minor)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatIDR(sale.total_minor)}</span>
          </div>
          <div className="text-muted-foreground">
            Payments:{' '}
            {(sale.payments ?? [])
              .map((p) => `${p.method} ${formatIDR(p.amount_minor)}`)
              .join(', ') || '—'}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
