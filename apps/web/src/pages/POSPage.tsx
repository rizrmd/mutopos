import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { ShoppingCart, Wifi, WifiOff } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api, formatIDR, type Product } from '@/lib/api'
import { cacheProducts, enqueueOutbox, getDb } from '@/lib/db'
import { flushOutbox, subscribeOutbox, type OutboxStats } from '@/lib/outbox'
import { useSession } from '@/lib/session'

type CartLine = {
  productId: string
  name: string
  unitPrice: number
  qty: number
}

export function POSPage() {
  const { tenant, businessId, outletId, staffId } = useSession()
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forceOffline, setForceOffline] = useState(false)
  const [stats, setStats] = useState<OutboxStats | null>(null)

  useEffect(() => subscribeOutbox(setStats), [])

  const load = useCallback(async () => {
    if (!tenant || !businessId) return
    try {
      const res = await api.listProducts(tenant)
      setProducts(res.products.filter((p) => p.is_active))
      await cacheProducts(businessId, res.products)
    } catch {
      // offline: load from RxDB
      const db = await getDb()
      const local = await db.products
        .find({ selector: { businessId, isActive: true } })
        .exec()
      setProducts(
        local.map((d) => ({
          id: d.id,
          name: d.name,
          sku: d.sku,
          price_minor: d.priceMinor,
          track_stock: true,
          is_active: d.isActive,
        })),
      )
    }
  }, [tenant, businessId])

  useEffect(() => {
    void load()
  }, [load])

  const total = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart],
  )

  function addToCart(p: Product) {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: next[i].qty + 1 }
        return next
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unitPrice: p.price_minor ?? 0,
          qty: 1,
        },
      ]
    })
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.productId === productId ? { ...l, qty: l.qty + delta } : l,
        )
        .filter((l) => l.qty > 0),
    )
  }

  async function checkout(mode: 'online' | 'outbox') {
    if (!tenant || !businessId || !outletId) {
      setError('Select business and outlet first')
      return
    }
    if (cart.length === 0) return
    setBusy(true)
    setError(null)
    setMessage(null)
    const clientSaleId = uuidv4()
    const lines = cart.map((l) => ({
      product_id: l.productId,
      name_snapshot: l.name,
      qty: l.qty,
      unit_price_minor: l.unitPrice,
      discount_minor: 0,
      line_total_minor: l.unitPrice * l.qty,
    }))
    const payload = {
      client_sale_id: clientSaleId,
      outlet_id: outletId,
      staff_id: staffId ?? undefined,
      lines,
      payments: [{ method: 'cash', amount_minor: total }],
      subtotal_minor: total,
      discount_minor: 0,
      tax_minor: 0,
      total_minor: total,
      currency_code: 'IDR',
    }

    try {
      const db = await getDb()
      await db.sales.insert({
        id: clientSaleId,
        businessId,
        outletId,
        clientSaleId,
        status: 'completed',
        totalMinor: total,
        linesJson: JSON.stringify(lines),
        createdAt: Date.now(),
        synced: false,
      })

      const useOutbox =
        mode === 'outbox' || forceOffline || !navigator.onLine

      if (useOutbox) {
        const commandId = uuidv4()
        await enqueueOutbox({
          id: commandId,
          type: 'sale.complete',
          payload,
          businessId,
        })
        setMessage(
          `Sale saved offline (client ${clientSaleId.slice(0, 8)}…). Outbox will push when online.`,
        )
        setCart([])
        if (!forceOffline && navigator.onLine) {
          await flushOutbox(() => tenant)
          setMessage('Sale enqueued and sync attempted via outbox.')
        }
      } else {
        const sale = await api.completeSaleOnline(tenant, payload)
        const local = await db.sales.findOne(clientSaleId).exec()
        if (local) {
          await local.patch({
            synced: true,
            serverId: sale.id,
            receiptNo: sale.receipt_no ?? undefined,
          })
        }
        setMessage(
          `Sale completed online · receipt ${sale.receipt_no ?? sale.id.slice(0, 8)} · ${formatIDR(sale.total_minor)}`,
        )
        setCart([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">POS</h1>
          <p className="text-sm text-muted-foreground">
            Ring sales online or via RxDB outbox (offline / local-first).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stats?.online && !forceOffline ? (
            <Badge variant="success" className="gap-1">
              <Wifi className="size-3" /> Online
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <WifiOff className="size-3" /> Offline path
            </Badge>
          )}
          <Badge variant="secondary">
            Outbox pending: {stats?.pending ?? 0}
            {(stats?.failed ?? 0) > 0 ? ` · failed ${stats?.failed}` : ''}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant={forceOffline ? 'default' : 'outline'}
            onClick={() => setForceOffline((v) => !v)}
          >
            {forceOffline ? 'Force outbox ON' : 'Force outbox'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void flushOutbox(() => tenant)}
          >
            Sync now
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Products</CardTitle>
            <CardDescription>Tap to add to cart</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  className="rounded-lg border bg-card p-3 text-left shadow-sm transition hover:border-primary hover:bg-accent/40"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatIDR(p.price_minor ?? 0)}
                  </div>
                </button>
              ))}
              {products.length === 0 ? (
                <p className="text-sm text-muted-foreground col-span-full">
                  No products. Add some in Catalog first.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="size-4" /> Cart
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cart.map((l) => (
              <div
                key={l.productId}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-muted-foreground">
                    {formatIDR(l.unitPrice)} × {l.qty}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() => changeQty(l.productId, -1)}
                  >
                    −
                  </Button>
                  <span className="w-6 text-center">{l.qty}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() => changeQty(l.productId, 1)}
                  >
                    +
                  </Button>
                </div>
              </div>
            ))}
            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cart is empty</p>
            ) : null}
            <div className="border-t pt-3 text-lg font-semibold">
              Total {formatIDR(total)}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                disabled={busy || cart.length === 0 || !outletId}
                onClick={() => void checkout('online')}
              >
                Complete sale (online)
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || cart.length === 0 || !outletId}
                onClick={() => void checkout('outbox')}
              >
                Complete via outbox
              </Button>
            </div>
            {message ? (
              <p className="text-sm text-primary" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {stats?.lastError ? (
              <p className="text-xs text-muted-foreground">
                Last sync error: {stats.lastError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
