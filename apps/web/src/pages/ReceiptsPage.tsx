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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
        <p className="text-sm text-muted-foreground">
          Server sales plus local RxDB sale documents (synced flag).
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server sales</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {sales.map((s) => (
              <Link
                key={s.id}
                to={`/receipts/${s.id}`}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-accent/40"
              >
                <div>
                  <div className="font-medium">
                    {s.receipt_no ?? s.id.slice(0, 8)}
                  </div>
                  <div className="text-muted-foreground">
                    {s.status} · {s.completed_at ?? s.created_at}
                  </div>
                </div>
                <div className="font-semibold">{formatIDR(s.total_minor)}</div>
              </Link>
            ))}
            {sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No server sales yet.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Local sales (RxDB)</CardTitle>
          <CardDescription>Includes offline / outbox-pending tickets.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {localPending.map((s) => (
              <li
                key={s.id}
                className="flex justify-between rounded-lg border px-3 py-2"
              >
                <span>
                  {s.id.slice(0, 8)}… ·{' '}
                  {s.synced ? (
                    <span className="text-primary">synced</span>
                  ) : (
                    <span className="text-amber-700">pending sync</span>
                  )}
                </span>
                <span>{formatIDR(s.totalMinor)}</span>
              </li>
            ))}
            {localPending.length === 0 ? (
              <li className="text-muted-foreground">No local sales cached.</li>
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
    return <p className="text-destructive">{error}</p>
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
        <CardHeader>
          <CardTitle>Receipt {sale.receipt_no ?? sale.id.slice(0, 8)}</CardTitle>
          <CardDescription>
            {sale.status} · {sale.completed_at ?? sale.created_at}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-1">
            {(sale.lines ?? []).map((l, i) => (
              <li key={l.id ?? i} className="flex justify-between">
                <span>
                  {l.name_snapshot} × {l.qty}
                </span>
                <span>{formatIDR(l.line_total_minor)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t pt-2 font-semibold flex justify-between">
            <span>Total</span>
            <span>{formatIDR(sale.total_minor)}</span>
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
