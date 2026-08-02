import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { Minus, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  api,
  formatMoney,
  type Category,
  type Product,
} from '@/lib/api'
import { cacheCatalog, enqueueOutbox, getDb, getLocalCatalog } from '@/lib/db'
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
  staffName: string
  label: string
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
  const {
    tenant,
    businessId,
    outletId,
    staffId,
    outlets,
    staff,
    memberships,
    refreshTenantData,
  } = useSession()
  const outletCtx = useOutletContext<OutletCtx | undefined>()
  const search = outletCtx?.search ?? ''

  const currency =
    memberships.find((m) => m.business_id === businessId)?.currency_code ??
    'USD'

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
  const [seededOnce, setSeededOnce] = useState(false)
  const [seedHint, setSeedHint] = useState<string | null>(null)

  const staffName =
    staff.find((s) => s.id === staffId)?.display_name ?? 'Unassigned'
  const outletName =
    outlets.find((o) => o.id === outletId)?.name ?? 'Select outlet'

  const loadTickets = useCallback(async () => {
    if (!businessId) return
    const db = await getDb()
    const local = await db.sales
      .find({ selector: { businessId }, sort: [{ createdAt: 'desc' }] })
      .exec()
    setTickets(
      local.slice(0, 12).map((d, i) => {
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
          staffName,
          label: `T${8 + (i % 3)}`,
        }
      }),
    )
  }, [businessId, staffName])

  const applyCatalog = useCallback(
    (list: Product[], cats: Category[], pickDefaultCategory: boolean) => {
      const activeProducts = list.filter((p) => p.is_active)
      const activeCats = cats.filter((c) => c.is_active)
      setProducts(activeProducts)
      setCategories(activeCats)
      if (!pickDefaultCategory) return
      // Prefer "all" when products lack categories (legacy local cache).
      const hasCategoryIds = activeProducts.some((p) => p.category_id)
      if (!hasCategoryIds || activeCats.length === 0) {
        setSelectedCategory('all')
        return
      }
      const oysters = activeCats.find(
        (c) => c.name.toLowerCase() === 'oysters',
      )
      if (oysters) setSelectedCategory(oysters.id)
      else setSelectedCategory(activeCats[0].id)
    },
    [],
  )

  const load = useCallback(async () => {
    if (!businessId) return

    // 1) Offline-first: paint from RxDB/meta immediately (no network wait).
    let hadLocal = false
    try {
      const local = await getLocalCatalog(businessId)
      if (local && local.products.length > 0) {
        hadLocal = true
        applyCatalog(local.products, local.categories, true)
        setSeedHint(null)
      }
    } catch (err) {
      console.warn('[mutopos] local catalog read failed', err)
    }

    // Tickets are always local.
    await loadTickets()

    // 2) Revalidate from API when tenant headers exist (online path).
    if (!tenant) return
    try {
      let [res, cats] = await Promise.all([
        api.listProducts(tenant),
        api
          .listCategories(tenant)
          .catch(() => ({ categories: [] as Category[] })),
      ])

      // Empty / thin catalog and nothing local → pull Vita demo (online only).
      const needsDemo =
        !seededOnce &&
        !hadLocal &&
        (cats.categories.length === 0 || res.products.length < 5)
      if (needsDemo) {
        try {
          setSeedHint('Loading demo menu…')
          const seeded = await api.seedDemo(tenant)
          setSeededOnce(true)
          await refreshTenantData()
          ;[res, cats] = await Promise.all([
            api.listProducts(tenant),
            api.listCategories(tenant),
          ])
          if (seeded.demo?.catalog_seeded || res.products.length > 0) {
            setSeedHint(null)
          } else {
            setSeedHint(
              'Demo already applied or API missing /v1/demo/seed — restart API and refresh.',
            )
          }
        } catch (e) {
          setSeededOnce(true)
          setSeedHint(
            e instanceof Error
              ? `Demo seed failed: ${e.message}`
              : 'Demo seed failed — is the API on the latest build?',
          )
        }
      }

      applyCatalog(res.products, cats.categories, true)
      await cacheCatalog(businessId, res.products, cats.categories)
      if (res.products.length > 0) setSeedHint(null)
    } catch {
      // Network failed — local paint already applied above (or still empty).
      if (!hadLocal) {
        setSeedHint(
          'No cached catalog and server unreachable. Connect once to sync products.',
        )
      }
    }
  }, [
    tenant,
    businessId,
    loadTickets,
    seededOnce,
    refreshTenantData,
    applyCatalog,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => void loadTickets(), 4000)
    return () => clearInterval(t)
  }, [loadTickets])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart],
  )
  const taxRate = currency === 'USD' ? 0.0525 : 0
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
    }> = []
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order)
    sorted.forEach((c, i) => {
      tiles.push({
        id: c.id,
        name: c.name,
        count: categoryCounts.get(c.id) ?? 0,
        pastel: PASTELS[i % PASTELS.length],
      })
    })
    // Only add "All" / uncategorized when needed
    if (tiles.length === 0) {
      tiles.push({
        id: 'all',
        name: 'All items',
        count: products.length,
        pastel: PASTELS[0],
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

  function money(n: number) {
    return formatMoney(n, currency)
  }

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
      tax_minor: tax,
      total_minor: total,
      currency_code: currency,
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
          setMessage(
            `Sale complete · ${receiptLabel} · ${money(sale.total_minor)}`,
          )
        } catch {
          await enqueueOutbox({
            id: uuidv4(),
            type: 'sale.complete',
            payload,
            businessId,
          })
          setMessage(`Sale saved · will sync · ${money(total)}`)
          void flushOutbox(() => tenant)
        }
      } else {
        await enqueueOutbox({
          id: uuidv4(),
          type: 'sale.complete',
          payload,
          businessId,
        })
        setMessage(`Sale saved offline · ${money(total)}`)
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
          {/* Category tiles — Vita pastel grid */}
          <div className="pos-scroll border-b border-border px-4 py-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {categoryTiles.map((tile) => {
                const active = selectedCategory === tile.id
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => setSelectedCategory(tile.id)}
                    className={cn(
                      'rounded-2xl px-4 py-3.5 text-left transition-all',
                      tile.pastel,
                      active
                        ? 'scale-[1.01] shadow-sm ring-2 ring-foreground/10'
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
                        {money(p.price_minor ?? 0)}
                      </div>
                      <div className="mt-auto pt-2 text-[10px] text-muted-foreground/70">
                        Orders → Kitchen
                      </div>
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
                <div className="col-span-full flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    {seedHint ??
                      'No products. Demo seed runs automatically, or add items in Catalog.'}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={busy}
                    onClick={() => {
                      setSeededOnce(false)
                      setSeedHint(null)
                      void load()
                    }}
                  >
                    Load demo menu
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* Right order ticket */}
        <aside className="flex w-[20rem] shrink-0 flex-col border-l border-border bg-ticket xl:w-[22rem]">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">
                {outletName}
              </div>
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

          <div className="pos-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
                          <span className="font-medium leading-snug">
                            {l.name}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {money(l.unitPrice * l.qty)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{money(l.unitPrice)} each</span>
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

          <div className="space-y-2 border-t border-border px-4 py-3">
            {tax > 0 ? (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Tax {(taxRate * 100).toFixed(2)}%</span>
                <span className="tabular-nums font-medium text-foreground">
                  {money(tax)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium text-foreground">
                {money(subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{money(total)}</span>
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
              className="h-11 w-full rounded-xl text-sm font-bold"
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

      {/* Bottom open tickets strip */}
      <footer className="shrink-0 border-t border-border bg-card px-3 py-2">
        <div className="pos-scroll flex gap-2 overflow-x-auto">
          {tickets.length === 0 ? (
            <div className="flex h-14 items-center px-2 text-xs text-muted-foreground">
              Open tickets appear here after you fire orders
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
                  {t.label}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-xs font-semibold">
                    {t.staffName.split(' ')[0] ?? 'Sale'}
                  </div>
                  <div className="text-[10px] font-medium text-muted-foreground">
                    {t.lineCount} item{t.lineCount === 1 ? '' : 's'}
                    <span className="mx-1">·</span>
                    <span
                      className={
                        t.synced ? 'text-emerald-700' : 'text-amber-700'
                      }
                    >
                      {t.synced ? 'Ready' : 'Pending'}
                    </span>
                  </div>
                </div>
                <div className="text-right leading-tight">
                  <div className="text-[10px] tabular-nums text-muted-foreground">
                    {formatElapsed(t.createdAt)}
                  </div>
                  <div className="text-[10px] font-bold tabular-nums">
                    {money(t.totalMinor)}
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
