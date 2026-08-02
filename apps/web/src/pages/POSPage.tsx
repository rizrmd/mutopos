import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  Minus,
  Plus,
  Receipt,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  api,
  formatIDR,
  type Category,
  type Product,
} from '@/lib/api'
import { cacheProducts, enqueueOutbox, getDb } from '@/lib/db'
import { flushOutbox, subscribeOutbox, type OutboxStats } from '@/lib/outbox'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

type CartLine = {
  productId: string
  name: string
  unitPrice: number
  qty: number
}

type LocalTicket = {
  id: string
  totalMinor: number
  synced: boolean
  createdAt: number
  lineCount: number
}

type OutletCtx = { search: string; setSearch: (v: string) => void }

const PASTELS = [
  'bg-[var(--pastel-6)]',
  'bg-[var(--pastel-1)]',
  'bg-[var(--pastel-9)]',
  'bg-[var(--pastel-7)]',
  'bg-[var(--pastel-3)]',
  'bg-[var(--pastel-8)]',
  'bg-[var(--pastel-5)]',
  'bg-[var(--pastel-2)]',
  'bg-[var(--pastel-10)]',
  'bg-[var(--pastel-4)]',
]

const TICKET_TINTS = [
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-400',
  'bg-sky-500',
  'bg-violet-500',
]

export function POSPage() {
  const { tenant, businessId, outletId, staffId, outlets, staff } =
    useSession()
  const outletCtx = useOutletContext<OutletCtx | undefined>()
  const search = outletCtx?.search ?? ''

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>(
    'all',
  )
  const [cart, setCart] = useState<CartLine[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forceOffline, setForceOffline] = useState(false)
  const [stats, setStats] = useState<OutboxStats | null>(null)
  const [tickets, setTickets] = useState<LocalTicket[]>([])
  const [taxRate] = useState(0) // IDR sales tax optional; keep 0 unless configured

  useEffect(() => subscribeOutbox(setStats), [])

  const loadTickets = useCallback(async () => {
    if (!businessId) return
    const db = await getDb()
    const local = await db.sales
      .find({ selector: { businessId }, sort: [{ createdAt: 'desc' }] })
      .exec()
    setTickets(
      local.slice(0, 12).map((d) => {
        let lineCount = 0
        try {
          lineCount = (JSON.parse(d.linesJson) as unknown[]).length
        } catch {
          lineCount = 0
        }
        return {
          id: d.clientSaleId,
          totalMinor: d.totalMinor,
          synced: d.synced,
          createdAt: d.createdAt,
          lineCount,
        }
      }),
    )
  }, [businessId])

  const load = useCallback(async () => {
    if (!tenant || !businessId) return
    try {
      const [res, cats] = await Promise.all([
        api.listProducts(tenant),
        api.listCategories(tenant).catch(() => ({ categories: [] as Category[] })),
      ])
      setProducts(res.products.filter((p) => p.is_active))
      setCategories(cats.categories.filter((c) => c.is_active))
      await cacheProducts(businessId, res.products)
    } catch {
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
          category_id: null,
        })),
      )
    }
    await loadTickets()
  }, [tenant, businessId, loadTickets])

  useEffect(() => {
    void load()
  }, [load])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart],
  )
  const tax = useMemo(() => Math.round(subtotal * taxRate), [subtotal, taxRate])
  const total = subtotal + tax

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      const key = p.category_id ?? '__uncategorized'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [products])

  const categoryTiles = useMemo(() => {
    const tiles: Array<{
      id: string
      name: string
      count: number
      pastel: string
    }> = [
      {
        id: 'all',
        name: 'All items',
        count: products.length,
        pastel: PASTELS[0],
      },
    ]
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order)
    sorted.forEach((c, i) => {
      tiles.push({
        id: c.id,
        name: c.name,
        count: categoryCounts.get(c.id) ?? 0,
        pastel: PASTELS[(i + 1) % PASTELS.length],
      })
    })
    const uncat = categoryCounts.get('__uncategorized') ?? 0
    if (uncat > 0 || categories.length === 0) {
      tiles.push({
        id: '__uncategorized',
        name: categories.length === 0 ? 'Menu' : 'Uncategorized',
        count: uncat || products.length,
        pastel: PASTELS[3],
      })
    }
    return tiles
  }, [categories, categoryCounts, products.length])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (selectedCategory === 'all') {
        // show all
      } else if (selectedCategory === '__uncategorized') {
        if (p.category_id) return false
      } else if (p.category_id !== selectedCategory) {
        return false
      }
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [products, selectedCategory, search])

  const outletName =
    outlets.find((o) => o.id === outletId)?.name ?? 'Select outlet'
  const staffName =
    staff.find((s) => s.id === staffId)?.display_name ?? 'Unassigned'

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
    setMessage(null)
    setError(null)
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

  function clearCart() {
    setCart([])
    setMessage(null)
    setError(null)
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
      subtotal_minor: subtotal,
      discount_minor: 0,
      tax_minor: tax,
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
          `Sale saved offline (ticket ${clientSaleId.slice(0, 6).toUpperCase()}). Outbox will push when online.`,
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
          `Sale completed · receipt ${sale.receipt_no ?? sale.id.slice(0, 8)} · ${formatIDR(sale.total_minor)}`,
        )
        setCart([])
      }
      await loadTickets()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function formatElapsed(ts: number) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Center: categories + products */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
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
              className="h-7 rounded-full text-xs"
              onClick={() => setForceOffline((v) => !v)}
            >
              {forceOffline ? 'Force outbox ON' : 'Force outbox'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-xs"
              onClick={() => void flushOutbox(() => tenant)}
            >
              Sync now
            </Button>
          </div>

          {/* Category tiles */}
          <div className="pos-scroll overflow-x-auto border-b border-border px-4 py-3">
            <div className="grid min-w-[28rem] grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-4">
              {categoryTiles.map((tile) => {
                const active = selectedCategory === tile.id
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => setSelectedCategory(tile.id)}
                    className={cn(
                      'rounded-2xl px-4 py-3 text-left transition-all',
                      tile.pastel,
                      active
                        ? 'ring-2 ring-foreground/15 shadow-sm scale-[1.01]'
                        : 'hover:brightness-[0.98]',
                    )}
                  >
                    <div className="text-sm font-semibold text-foreground/90">
                      {tile.name}
                    </div>
                    <div className="mt-1 text-xs text-foreground/55">
                      {tile.count} item{tile.count === 1 ? '' : 's'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Product grid */}
          <div className="pos-scroll min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {filteredProducts.map((p) => {
                const inCart = cart.find((l) => l.productId === p.id)
                return (
                  <div
                    key={p.id}
                    className="group relative flex flex-col rounded-2xl border border-border bg-card p-3 shadow-sm transition hover:border-primary/30 hover:shadow"
                  >
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      className="flex flex-1 flex-col text-left"
                    >
                      <div className="pr-8 text-sm font-semibold leading-snug">
                        {p.name}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatIDR(p.price_minor ?? 0)}
                      </div>
                      {p.sku ? (
                        <div className="mt-auto pt-2 text-[10px] text-muted-foreground/80">
                          {p.sku}
                        </div>
                      ) : (
                        <div className="mt-auto pt-2 text-[10px] text-muted-foreground/60">
                          Orders → Kitchen
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Add ${p.name}`}
                      onClick={() => addToCart(p)}
                      className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:border-primary hover:bg-primary hover:text-primary-foreground"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    {inCart ? (
                      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold">
                        <button
                          type="button"
                          className="flex size-5 items-center justify-center rounded-full hover:bg-card"
                          onClick={() => changeQty(p.id, -1)}
                        >
                          <Minus className="size-3" />
                        </button>
                        <span className="min-w-4 text-center">{inCart.qty}</span>
                        <button
                          type="button"
                          className="flex size-5 items-center justify-center rounded-full hover:bg-card"
                          onClick={() => changeQty(p.id, 1)}
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {filteredProducts.length === 0 ? (
                <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
                  No products match. Add items in Catalog or clear filters.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Right: order ticket */}
        <aside className="flex w-[20rem] shrink-0 flex-col border-l border-border bg-ticket xl:w-[22rem]">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <div className="text-base font-semibold">
                {outletName}
              </div>
              <div className="text-xs text-muted-foreground">{staffName}</div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground"
                title="Clear cart"
                onClick={clearCart}
                disabled={cart.length === 0}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="pos-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <Receipt className="size-8 opacity-40" />
                <p>Ticket is empty</p>
                <p className="text-xs">Tap products to add lines</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {cart.map((l, idx) => (
                  <li key={l.productId} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="w-4 shrink-0 text-xs font-medium text-muted-foreground">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium leading-snug">
                            {l.name}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {formatIDR(l.unitPrice * l.qty)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatIDR(l.unitPrice)} each</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center rounded-md border border-border hover:bg-muted"
                              onClick={() => changeQty(l.productId, -1)}
                            >
                              <Minus className="size-3" />
                            </button>
                            <span className="w-5 text-center font-semibold text-foreground">
                              {l.qty}
                            </span>
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center rounded-md border border-border hover:bg-muted"
                              onClick={() => changeQty(l.productId, 1)}
                            >
                              <Plus className="size-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border px-4 py-3 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tax {taxRate > 0 ? `${(taxRate * 100).toFixed(1)}%` : '—'}</span>
              <span className="tabular-nums">{formatIDR(tax)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatIDR(subtotal)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatIDR(total)}</span>
            </div>

            {message ? (
              <p className="text-xs text-primary" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {stats?.lastError ? (
              <p className="text-[10px] text-muted-foreground">
                Last sync error: {stats.lastError}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl text-xs"
                disabled={busy || cart.length === 0 || !outletId}
                onClick={() => void checkout('outbox')}
              >
                Via outbox
              </Button>
              <Button
                type="button"
                className="h-10 rounded-xl bg-primary text-sm font-semibold shadow-sm"
                disabled={busy || cart.length === 0 || !outletId}
                onClick={() => void checkout('online')}
              >
                Fire orders
              </Button>
            </div>
            {!outletId ? (
              <p className="text-[11px] text-amber-700">
                Select an outlet in the sidebar to checkout.
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {/* Bottom open tickets strip */}
      <footer className="shrink-0 border-t border-border bg-card/90 px-3 py-2">
        <div className="pos-scroll flex gap-2 overflow-x-auto">
          {tickets.length === 0 ? (
            <div className="flex h-14 items-center px-2 text-xs text-muted-foreground">
              No recent tickets — completed sales appear here
            </div>
          ) : (
            tickets.map((t, i) => (
              <div
                key={t.id}
                className="flex h-14 min-w-[11rem] items-center gap-2 rounded-xl border border-border bg-background px-2.5 shadow-sm"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white',
                    TICKET_TINTS[i % TICKET_TINTS.length],
                  )}
                >
                  {t.id.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-xs font-semibold">
                    {staffName.split(' ')[0] ?? 'Sale'}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>
                      {t.lineCount} item{t.lineCount === 1 ? '' : 's'}
                    </span>
                    <span>·</span>
                    <span
                      className={
                        t.synced ? 'text-emerald-700' : 'text-amber-700'
                      }
                    >
                      {t.synced ? 'Ready' : 'In progress'}
                    </span>
                  </div>
                </div>
                <div className="text-right leading-tight">
                  <div className="text-[10px] font-medium tabular-nums text-muted-foreground">
                    {formatElapsed(t.createdAt)}
                  </div>
                  <div className="text-[10px] font-semibold tabular-nums">
                    {formatIDR(t.totalMinor)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </footer>
    </div>
  )
}
