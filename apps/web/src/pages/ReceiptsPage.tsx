import { useCallback, useEffect, useState } from '@lynx-js/react'
import { useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { api, type Sale } from '@/lib/api'
import { listLocalSales } from '@/lib/db'
import { formatMoney, formatStamp } from '@/lib/format'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const MARK_COUNT = 5

export function ReceiptsPage() {
  const { tenant, businessId, memberships } = useSession()
  const navigate = useNavigate()
  const currency =
    memberships.find((m) => m.business_id === businessId)?.currency_code ??
    'USD'
  const money = (n: number) => formatMoney(n, currency)
  const [sales, setSales] = useState<Sale[]>([])
  const [localPending, setLocalPending] = useState<
    Array<{ id: string; totalMinor: number; synced: boolean; createdAt: number }>
  >([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    'background only'
    if (!tenant || !businessId) return
    try {
      const res = await api.listSales(tenant)
      setSales(res.sales)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    const local = await listLocalSales(businessId)
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
    <view className="mp-page">
      <view>
        <text className="mp-title">Transactions</text>
        <text className="mp-subtitle">
          Completed sales from the server and local device cache.
        </text>
      </view>

      {error ? <text className="mp-error-text">{error}</text> : null}

      <Card>
        <CardHeader title="Synced sales" />
        <CardContent>
          <view className="mp-list">
            {sales.map((s, i) => (
              <view
                key={s.id}
                className="mp-list__row"
                bindtap={() => {
                  'background only'
                  navigate(`/receipts/${s.id}`)
                }}
              >
                <view
                  className={cn('mp-list__mark', `mp-mark-${i % MARK_COUNT}`)}
                >
                  <text className="mp-list__mark-text">
                    {(s.receipt_no ?? s.id).slice(0, 2).toUpperCase()}
                  </text>
                </view>
                <view className="mp-fill">
                  <text className="mp-list__title mp-truncate">
                    {s.receipt_no ?? s.id.slice(0, 8)}
                  </text>
                  <text className="mp-list__sub mp-truncate">
                    {s.status} · {formatStamp(s.completed_at ?? s.created_at)}
                  </text>
                </view>
                <text className="mp-list__amount mp-num">
                  {money(s.total_minor)}
                </text>
              </view>
            ))}
            {sales.length === 0 ? (
              <text className="mp-list__empty">No server sales yet.</text>
            ) : null}
          </view>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="On this device"
          description="Offline sales sync automatically when the device is online."
        />
        <CardContent>
          <view className="mp-list">
            {localPending.map((s, i) => (
              <view key={s.id} className="mp-list__row">
                <view
                  className={cn('mp-list__mark', `mp-mark-${i % MARK_COUNT}`)}
                >
                  <text className="mp-list__mark-text">
                    {s.id.slice(0, 2).toUpperCase()}
                  </text>
                </view>
                <view className="mp-fill">
                  <text className="mp-list__title mp-truncate">
                    {s.id.slice(0, 8)}…
                  </text>
                  <text
                    className={cn(
                      'mp-product__state',
                      !s.synced && 'is-inactive',
                    )}
                  >
                    {s.synced ? 'Synced' : 'Pending sync'}
                  </text>
                </view>
                <text className="mp-list__amount mp-num">
                  {money(s.totalMinor)}
                </text>
              </view>
            ))}
            {localPending.length === 0 ? (
              <text className="mp-list__empty">No local sales cached.</text>
            ) : null}
          </view>
        </CardContent>
      </Card>
    </view>
  )
}

export function ReceiptDetailPage() {
  const { id } = useParams()
  const { tenant } = useSession()
  const navigate = useNavigate()
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
    return <text className="mp-error-text">{error}</text>
  }
  if (!sale) {
    return <text className="mp-subtitle">Loading…</text>
  }

  const money = (n: number) => formatMoney(n, sale.currency_code || 'USD')
  const payments =
    (sale.payments ?? [])
      .map((p) => `${p.method} ${money(p.amount_minor)}`)
      .join(', ') || '—'

  return (
    <view className="mp-page">
      <Button
        size="sm"
        variant="outline"
        label="Back"
        onTap={() => navigate('/receipts')}
      >
        <Icon name="arrow-left" size={14} />
      </Button>
      <Card>
        <CardHeader
          title={`Receipt ${sale.receipt_no ?? sale.id.slice(0, 8)}`}
          description={`${sale.status} · ${formatStamp(
            sale.completed_at ?? sale.created_at,
          )}`}
        />
        <CardContent>
          {(sale.lines ?? []).map((l, i) => (
            <view key={l.id ?? String(i)} className="mp-receipt__line">
              <view className="mp-row">
                <text className="mp-receipt__index mp-num">{i + 1}</text>
                <text className="mp-receipt__name">
                  {l.name_snapshot} × {l.qty}
                </text>
              </view>
              <text className="mp-receipt__amount mp-num">
                {money(l.line_total_minor)}
              </text>
            </view>
          ))}
          <view className="mp-receipt__total">
            <text className="mp-receipt__total-text">Total</text>
            <text className="mp-receipt__total-text mp-num">
              {money(sale.total_minor)}
            </text>
          </view>
          <text className="mp-receipt__payments">Payments: {payments}</text>
        </CardContent>
      </Card>
    </view>
  )
}
