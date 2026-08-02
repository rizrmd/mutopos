import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { Minus, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  api,
  formatIDR,
  type Category,
  type Product,
} from '@/lib/api'
import { cacheProducts, enqueueOutbox, getDb } from '@/lib/db'
import { flushOutbox } from '@/lib/outbox'
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

/** High-contrast tile fills (mid tone + dark text — not washed pastel) */
const TILES = [
  'bg-[var(--tile-6)]',
  'bg-[var(--tile-1)]',
  'bg-[var(--tile-9)]',
  'bg-[var(--tile-7)]',
  'bg-[var(--tile-3)]',
  'bg-[var(--tile-8)]',
  'bg-[var(--tile-5)]',
  'bg-[var(--tile-2)]',
  'bg-[var(--tile-10)]',
  'bg-[var(--tile-4)]',
]

const TICKET_TINTS = [
  'bg-emerald-700',
  'bg-rose-700',
  'bg-amber-600',
  'bg-sky-700',
  'bg-violet-700',
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
  const [tickets, setTickets] = useState<LocalTicket[]>([])

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
        api
          .listCategories(tenant)
          .catch(() => ({ categories: [] as Category[] })),
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

  // Refresh tickets when outbox may have synced
  useEffect(() => {
    const t = setInterval(() => void loadTickets(), 4000)
    return () => clearInterval(t)
  }, [loadTickets])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart],
  )
  const total = subtotal

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
      color: string
    }> = [
      {
        id: 'all',
        name: 'All items',
        count: products.length,
        color: TILES[0],
      },
    ]
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order)
    sorted.forEach((c, i) => {
      tiles.push({
        id: c.id,
        name: c.name,
        count: categoryCounts.get(c.id) ?? 0,
        color: TILES[(i + 1) % TILES.length],
      })
    })
    const uncat = categoryCounts.get('__uncategorized') ?? 0
    if (uncat > 0 || categories.length === 0) {
      tiles.push({
        id: '__uncategorized',
        name: categories.length === 0 ? 'Menu' : 'Other',
        count: uncat || products.length,
        color: TILES[3],
      })
    }
    return tiles
  }, [categories, categoryCounts, products.length])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (selectedCategory === 'all') {
        // all
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

  /**
   * Seamless checkout: always persist locally, try online when available,
   * otherwise outbox — worker flushes automatically (no Force/Sync buttons).
   */
  async function checkout() {
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

      let receiptLabel = clientSaleId.slice(0, 8)
      const online = typeof navigator === 'undefined' ? true : navigator.onLine

      if (online) {
        try {
          const sale = await api.completeSaleOnline(tenant, payload)
          const local = await db.sales.findOne(clientSaleId).exec()
          if (local) {
            await local.patch({
              synced: true,
              serverId: sale.id,
              receiptNo: sale.receipt_no ?? undefined,
            })
          }
          receiptLabel = sale.receipt_no ?? sale.id.slice(0, 8)
          setMessage(`Sale complete · ${receiptLabel} · ${formatIDR(sale.total_minor)}`)
        } catch {
          // Fall through to outbox — seamless offline path
          await enqueueOutbox({
            id: uuidv4(),
            type: 'sale.complete',
            payload,
            businessId,
          })
          setMessage(`Sale saved · will sync · ${formatIDR(total)}`)
          void flushOutbox(() => tenant)
        }
      } else {
        await enqueueOutbox({
          id: uuidv4(),
          type: 'sale.complete',
          payload,
          businessId,
        })
        setMessage(`Sale saved offline · ${formatIDR(total)}`)
      }

      setCart([])
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
          {/* Category tiles — square, contrast fills */}
          <div className="pos-scroll border-b border-border px-3 py-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {categoryTiles.map((tile) => {
                const active = selectedCategory === tile.id
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => setSelectedCategory(tile.id)}
                    className={cn(
                      'px-3 py-3 text-left transition-colors',
                      tile.color,
                      active
                        ? 'outline outline-2 outline-offset-[-2px] outline-foreground'
                        : 'hover:brightness-95',
                    )}
                  >
                    <div className="text-sm font-bold text-[var(--tile-fg)]">
                      {tile.name}
                    </div>
                    <div className="mt-1 text-xs font-medium text-[var(--tile-muted)]">
                      {tile.count} item{tile.count === 1 ? '' : 's'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Product grid */}
          <div className="pos-scroll min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {filteredProducts.map((p) => {
                const inCart = cart.find((l) => l.productId === p.id)
                return (
                  <div
                    key={p.id}
                    className="relative flex flex-col border border-border bg-card p-3 transition hover:border-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      className="flex flex-1 flex-col text-left"
                    >
                      <div className="pr-8 text-sm font-semibold leading-snug text-foreground">
                        {p.name}
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground/70">
                        {formatIDR(p.price_minor ?? 0)}
                      </div>
                      {p.sku ? (
                        <div className="mt-auto pt-2 text-[11px] text-muted-foreground">
                          {p.sku}
                        </div>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      aria-label={`Add ${p.name}`}
                      onClick={() => addToCart(p)}
                      className="absolute right-2 top-2 flex size-7 items-center justify-center border border-border bg-background text-foreground transition hover:bg-foreground hover:text-background"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    {inCart ? (
                      <div className="absolute bottom-2 right-2 flex items-center gap-0 border border-border bg-background text-xs font-bold">
                        <button
                          type="button"
                          className="flex size-6 items-center justify-center hover:bg-muted"
                          onClick={() => changeQty(p.id, -1)}
                        >
                          <Minus className="size-3" />
                        </button>
                        <span className="min-w-5 text-center">{inCart.qty}</span>
                        <button
                          type="button"
                          className="flex size-6 items-center justify-center hover:bg-muted"
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
                  No products. Add some in Catalog.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Right ticket — Vita-style order panel */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card xl:w-[22rem]">
          <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{outletName}</div>
              <div className="truncate text-xs text-muted-foreground">
                {staffName}
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 text-muted-foreground"
              title="Clear cart"
              onClick={clearCart}
              disabled={cart.length === 0}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div className="pos-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {cart.length === 0 ? (
              <div className="flex h-full items-center justify-center py-10 text-center text-sm text-muted-foreground">
                Ticket empty — tap products
              </div>
            ) : (
              <ul className="space-y-3">
                {cart.map((l, idx) => (
                  <li key={l.productId} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold leading-snug">
                            {l.name}
                          </span>
                          <span className="shrink-0 font-bold tabular-nums">
                            {formatIDR(l.unitPrice * l.qty)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatIDR(l.unitPrice)} each</span>
                          <div className="flex items-center border border-border">
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center hover:bg-muted"
                              onClick={() => changeQty(l.productId, -1)}
                            >
                              <Minus className="size-3" />
                            </button>
                            <span className="w-6 text-center font-bold text-foreground">
                              {l.qty}
                            </span>
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center hover:bg-muted"
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

          <div className="space-y-2 border-t border-border px-3 py-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium text-foreground">
                {formatIDR(subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{formatIDR(total)}</span>
            </div>

            {message ? (
              <p className="text-xs font-medium text-primary" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="text-xs font-medium text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              type="button"
              className="h-11 w-full text-sm font-bold"
              disabled={busy || cart.length === 0 || !outletId}
              onClick={() => void checkout()}
            >
              {busy ? 'Processing…' : 'Fire orders'}
            </Button>
            {!outletId ? (
              <p className="text-[11px] font-medium text-amber-800">
                Select an outlet to checkout.
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {/* Bottom tickets */}
      <footer className="shrink-0 border-t border-border bg-card px-2 py-2">
        <div className="pos-scroll flex gap-2 overflow-x-auto">
          {tickets.length === 0 ? (
            <div className="flex h-12 items-center px-2 text-xs text-muted-foreground">
              Recent tickets appear here
            </div>
          ) : (
            tickets.map((t, i) => (
              <div
                key={t.id}
                className="flex h-12 min-w-[10.5rem] items-center gap-2 border border-border bg-background px-2"
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center text-[10px] font-bold text-white',
                    TICKET_TINTS[i % TICKET_TINTS.length],
                  )}
                >
                  {t.id.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-xs font-semibold">
                    {staffName.split(' ')[0] ?? 'Sale'}
                  </div>
                  <div className="text-[10px] font-medium">
                    <span className="text-muted-foreground">
                      {t.lineCount} item{t.lineCount === 1 ? '' : 's'}
                    </span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <span
                      className={
                        t.synced ? 'text-emerald-800' : 'text-amber-800'
                      }
                    >
                      {t.synced ? 'Synced' : 'Pending'}
                    </span>
                  </div>
                </div>
                <div className="text-right leading-tight">
                  <div className="text-[10px] tabular-nums text-muted-foreground">
                    {formatElapsed(t.createdAt)}
                  </div>
                  <div className="text-[10px] font-bold tabular-nums">
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
