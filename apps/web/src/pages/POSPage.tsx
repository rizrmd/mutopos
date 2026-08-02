import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  FileText,
  Minus,
  Percent,
  Plus,
  Printer,
  Share2,
  Trash2,
} from 'lucide-react'

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

/** Vita daytime pastel chart — solid tile fills */
const PASTELS = [
  'bg-[#f5d9c8]', // peach
  'bg-[#d4e4f7]', // soft blue
  'bg-[#e8dff5]', // lavender
  'bg-[#f5d0d8]', // blush
  'bg-[#d4ebe3]', // mint
  'bg-[#e8dff0]', // lilac
  'bg-[#f5e0c8]', // sand
  'bg-[#d8e4f0]', // steel blue
  'bg-[#f0e0d8]', // warm grey-peach
  'bg-[#dde8f0]', // cool grey
]

const TICKET_TINTS = [
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-400',
  'bg-sky-500',
  'bg-violet-500',
]

const STATIONS = ['Kitchen', 'Bar 1', 'Bar 2', 'Kitchen'] as const

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
  const [discountMinor, setDiscountMinor] = useState(0)
  const [extraAmountMinor, setExtraAmountMinor] = useState(0)
  const [, setTick] = useState(0)

  const staffName =
    staff.find((s) => s.id === staffId)?.display_name ?? 'Unassigned'
  const outletName =
    outlets.find((o) => o.id === outletId)?.name ?? 'Table'

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

    await loadTickets()

    if (!tenant) return
    try {
      let [res, cats] = await Promise.all([
        api.listProducts(tenant),
        api
          .listCategories(tenant)
          .catch(() => ({ categories: [] as Category[] })),
      ])

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

  // Live timer for open tickets
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart],
  )
  const taxRate = currency === 'USD' ? 0.0525 : 0
  const taxable = Math.max(0, subtotal - discountMinor + extraAmountMinor)
  const tax = useMemo(
    () => Math.round(taxable * taxRate),
    [taxable, taxRate],
  )
  const total = taxable + tax

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
    setDiscountMinor(0)
    setExtraAmountMinor(0)
    setMessage(null)
    setError(null)
  }

  function applyQuickDiscount() {
    if (subtotal <= 0) return
    const ten = Math.round(subtotal * 0.1)
    setDiscountMinor((d) => (d > 0 ? 0 : ten))
  }

  function applyAddAmount() {
    setExtraAmountMinor((a) => a + 100)
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
      discount_minor: discountMinor,
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
      setDiscountMinor(0)
      setExtraAmountMinor(0)
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
    <div className="flex h-full min-h-0">
      {/* Center: categories + products + table dock */}
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        {/* Category tiles — large rounded-rect board (not pills) */}
        <div className="shrink-0 px-3.5 pb-2 pt-3">
          <div className="grid grid-cols-2 gap-[15px] sm:grid-cols-3 lg:grid-cols-4">
            {categoryTiles.map((tile) => {
              const active = selectedCategory === tile.id
              return (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => setSelectedCategory(tile.id)}
                  className={cn(
                    'min-h-[4.75rem] rounded-[14px] px-4 py-3.5 text-left transition-all',
                    tile.pastel,
                    active
                      ? 'shadow-sm ring-2 ring-foreground/12'
                      : 'hover:brightness-[0.97]',
                  )}
                >
                  <div className="text-[15px] font-semibold tracking-tight text-foreground/90">
                    {tile.name}
                  </div>
                  <div className="mt-1.5 text-[12px] text-foreground/50">
                    {tile.count} item{tile.count === 1 ? '' : 's'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Product grid — dense 4-col, + top-right / − bottom-right */}
        <div className="pos-scroll min-h-0 flex-1 overflow-y-auto px-3.5 pb-2 pt-1">
          <div className="grid grid-cols-2 gap-[15px] sm:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map((p) => {
              const inCart = cart.find((l) => l.productId === p.id)
              const qty = inCart?.qty ?? 0
              return (
                <div
                  key={p.id}
                  className={cn(
                    'relative flex min-h-[5.5rem] flex-col rounded-[14px] border bg-card px-3 py-2.5 shadow-sm transition',
                    qty > 0
                      ? 'border-primary/25 ring-1 ring-primary/10'
                      : 'border-border hover:border-foreground/10',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className="flex flex-1 flex-col pr-7 text-left"
                  >
                    <div className="text-[13px] font-semibold leading-snug text-foreground">
                      {p.name}
                    </div>
                    <div className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                      {money(p.price_minor ?? 0)}
                    </div>
                    <div className="mt-auto flex items-center gap-1 pt-2 text-[10px] text-muted-foreground/65">
                      <span>Orders</span>
                      <span className="tracking-tight">→</span>
                      <span>Kitchen</span>
                    </div>
                  </button>

                  {/* + always top-right */}
                  <button
                    type="button"
                    aria-label={`Add ${p.name}`}
                    onClick={() => addToCart(p)}
                    className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-3.5 stroke-[2.5]" />
                  </button>

                  {/* − always bottom-right (Vita stepper layout) */}
                  <button
                    type="button"
                    aria-label={`Remove ${p.name}`}
                    disabled={qty === 0}
                    onClick={() => changeQty(p.id, -1)}
                    className={cn(
                      'absolute bottom-2 right-2 flex size-6 items-center justify-center rounded-md transition',
                      qty > 0
                        ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        : 'text-muted-foreground/30',
                    )}
                  >
                    <Minus className="size-3.5 stroke-[2.5]" />
                  </button>
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

        {/* Open tickets dock — under center only (not under ticket panel) */}
        <footer className="shrink-0 border-t border-border/60 bg-card/60 px-3 py-2">
          <div className="pos-scroll flex gap-2 overflow-x-auto">
            {tickets.length === 0 ? (
              <div className="flex h-[3.25rem] items-center px-1 text-[11px] text-muted-foreground">
                Open tickets appear here after you fire orders
              </div>
            ) : (
              tickets.map((t, i) => {
                const station = STATIONS[i % STATIONS.length]
                const ready = t.synced
                return (
                  <div
                    key={t.id}
                    className="flex h-[3.25rem] min-w-[13.5rem] items-center gap-2 rounded-xl border border-border bg-card px-2 shadow-sm"
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white',
                        TICKET_TINTS[i % TICKET_TINTS.length],
                      )}
                    >
                      {t.label}
                    </span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-semibold">
                          {t.staffName.split(' ')[0] ?? 'Sale'}
                          {t.staffName.includes(' ')
                            ? ` ${t.staffName.split(' ').slice(-1)[0]?.[0]}.`
                            : ''}
                        </span>
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                            ready
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-sky-50 text-sky-700',
                          )}
                        >
                          {ready ? '✓ Ready' : '◌ In progress'}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>
                          {t.lineCount} item{t.lineCount === 1 ? '' : 's'}
                        </span>
                        <span className="text-muted-foreground/40">→</span>
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={cn(
                              'size-1.5 rounded-sm',
                              station.startsWith('Kitchen')
                                ? 'bg-blue-500'
                                : 'bg-violet-400',
                            )}
                          />
                          {station}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right leading-tight">
                      <div className="text-[11px] font-semibold tabular-nums text-foreground">
                        {formatElapsed(t.createdAt)}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </footer>
      </section>

      {/* Right order ticket — Vita check panel */}
      <aside className="flex w-[19.5rem] shrink-0 flex-col border-l border-border bg-ticket xl:w-[21rem]">
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-tight">
              {outletName}
            </div>
            <div className="truncate text-[12px] text-muted-foreground">
              {staffName}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              title="Share"
              disabled={cart.length === 0}
            >
              <Share2 className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              title="Print"
              disabled={cart.length === 0}
            >
              <Printer className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              title="Note"
              disabled={cart.length === 0}
            >
              <FileText className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              title="Clear cart"
              onClick={clearCart}
              disabled={cart.length === 0}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="pos-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center py-10 text-center text-sm text-muted-foreground">
              Ticket empty — tap products
            </div>
          ) : (
            <ul className="space-y-3.5">
              {cart.map((l, idx) => {
                const course = `P${(idx % 3) + 1}`
                return (
                  <li key={l.productId} className="text-[13px]">
                    <div className="flex items-start gap-2">
                      <span className="w-3 shrink-0 pt-0.5 text-[12px] font-semibold text-muted-foreground">
                        {l.qty}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5 font-medium leading-snug">
                            <span className="truncate">{l.name}</span>
                            <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
                              {course}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {money(l.unitPrice * l.qty)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            <span className="font-medium text-foreground/70">
                              With
                            </span>{' '}
                            —
                          </span>
                          <span>
                            <span className="font-medium text-foreground/70">
                              Remove
                            </span>{' '}
                            —
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground">
                            {money(l.unitPrice)} each
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                              onClick={() => changeQty(l.productId, -1)}
                            >
                              <Minus className="size-3" />
                            </button>
                            <span className="w-5 text-center text-xs font-semibold">
                              {l.qty}
                            </span>
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                              onClick={() => changeQty(l.productId, 1)}
                            >
                              <Plus className="size-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border">
          {/* Discount / Add amount row */}
          <div className="flex items-center gap-4 border-b border-border/70 px-4 py-2.5">
            <button
              type="button"
              onClick={applyQuickDiscount}
              disabled={cart.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors',
                discountMinor > 0
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
                cart.length === 0 && 'opacity-40',
              )}
            >
              <Percent className="size-3.5" />
              Discount
              {discountMinor > 0 ? (
                <span className="tabular-nums">−{money(discountMinor)}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={applyAddAmount}
              disabled={cart.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                cart.length === 0 && 'opacity-40',
              )}
            >
              <span className="grid grid-cols-2 gap-px">
                <span className="size-1 rounded-[1px] bg-current" />
                <span className="size-1 rounded-[1px] bg-current" />
                <span className="size-1 rounded-[1px] bg-current" />
                <span className="size-1 rounded-[1px] bg-current" />
              </span>
              Add amount
              {extraAmountMinor > 0 ? (
                <span className="tabular-nums text-foreground">
                  +{money(extraAmountMinor)}
                </span>
              ) : null}
            </button>
          </div>

          <div className="space-y-1.5 px-4 py-3">
            {taxRate > 0 ? (
              <div className="flex justify-between text-[12px] text-muted-foreground">
                <span>Tax {(taxRate * 100).toFixed(2)}%</span>
                <span className="tabular-nums font-medium text-foreground">
                  {money(tax)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between text-[12px] text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium text-foreground">
                {money(Math.max(0, subtotal - discountMinor + extraAmountMinor))}
              </span>
            </div>
            <div className="flex justify-between text-[15px] font-bold">
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
          </div>

          <div className="px-4 pb-4">
            <Button
              type="button"
              className="h-11 w-full rounded-full text-sm font-semibold"
              disabled={busy || cart.length === 0 || !outletId}
              onClick={() => void checkout()}
            >
              {busy ? 'Processing…' : 'Fire orders'}
            </Button>
            {!outletId ? (
              <p className="mt-2 text-center text-[11px] font-medium text-amber-800">
                Tap + on Menus to select an outlet.
              </p>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  )
}
