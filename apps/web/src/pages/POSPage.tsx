import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  Banknote,
  CreditCard,
  Minus,
  MoreHorizontal,
  Percent,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  api,
  formatMoney,
  type Category,
  type Product,
} from '@/lib/api'
import {
  cacheCatalog,
  enqueueOutbox,
  getLocalCatalog,
  insertLocalSale,
  listLocalSales,
  patchLocalSale,
} from '@/lib/db'
import { flushOutbox } from '@/lib/outbox'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

type CartLine = {
  productId: string
  name: string
  unitPrice: number
  qty: number
}

type RecentSale = {
  id: string
  totalMinor: number
  synced: boolean
  createdAt: number
  lineCount: number
  receiptLabel: string
}

type OutletCtx = { search: string; setSearch: (v: string) => void }

type Tender = 'cash' | 'card' | 'other'

const TENDER_OPTIONS: Array<{
  id: Tender
  label: string
  hint: string
  icon: typeof Banknote
}> = [
  { id: 'cash', label: 'Cash', hint: 'Notes & coins', icon: Banknote },
  { id: 'card', label: 'Card', hint: 'Debit / credit', icon: CreditCard },
  { id: 'other', label: 'Other', hint: 'Transfer / QR / custom', icon: MoreHorizontal },
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
  const [recent, setRecent] = useState<RecentSale[]>([])
  const [seededOnce, setSeededOnce] = useState(false)
  const [seedHint, setSeedHint] = useState<string | null>(null)
  const [discountMinor, setDiscountMinor] = useState(0)
  const [tenderOpen, setTenderOpen] = useState(false)
  const [selectedTender, setSelectedTender] = useState<Tender>('cash')

  const staffName =
    staff.find((s) => s.id === staffId)?.display_name ?? 'Not clocked in'
  const outletName =
    outlets.find((o) => o.id === outletId)?.name ?? 'No outlet'

  const loadRecent = useCallback(async () => {
    if (!businessId) return
    const local = await listLocalSales(businessId, { limit: 8 })
    setRecent(
      local.map((d) => {
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
          receiptLabel: d.receiptNo?.trim() || d.clientSaleId.slice(0, 8),
        }
      }),
    )
  }, [businessId])

  const applyCatalog = useCallback(
    (list: Product[], cats: Category[], pickDefaultCategory: boolean) => {
      const activeProducts = list.filter((p) => p.is_active)
      const activeCats = cats.filter((c) => c.is_active)
      setProducts(activeProducts)
      setCategories(activeCats)
      if (!pickDefaultCategory) return
      setSelectedCategory('all')
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

    await loadRecent()

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
          setSeedHint('Loading sample catalog…')
          await api.seedDemo(tenant)
          setSeededOnce(true)
          await refreshTenantData()
          ;[res, cats] = await Promise.all([
            api.listProducts(tenant),
            api.listCategories(tenant),
          ])
          if (res.products.length > 0) {
            setSeedHint(null)
          } else {
            setSeedHint(
              'Sample catalog empty — add products in Items, or retry seed.',
            )
          }
        } catch (e) {
          setSeededOnce(true)
          setSeedHint(
            e instanceof Error
              ? `Could not seed catalog: ${e.message}`
              : 'Could not seed catalog — is the API running?',
          )
        }
      }

      applyCatalog(res.products, cats.categories, true)
      await cacheCatalog(businessId, res.products, cats.categories)
      if (res.products.length > 0) setSeedHint(null)
    } catch {
      if (!hadLocal) {
        setSeedHint(
          'No cached items and server unreachable. Connect once to sync the catalog.',
        )
      }
    }
  }, [
    tenant,
    businessId,
    loadRecent,
    seededOnce,
    refreshTenantData,
    applyCatalog,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => void loadRecent(), 5000)
    return () => clearInterval(t)
  }, [loadRecent])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart],
  )
  const taxRate = currency === 'USD' ? 0.0525 : 0
  const taxable = Math.max(0, subtotal - discountMinor)
  const tax = useMemo(
    () => Math.round(taxable * taxRate),
    [taxable, taxRate],
  )
  const total = taxable + tax
  const itemCount = useMemo(
    () => cart.reduce((s, l) => s + l.qty, 0),
    [cart],
  )

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      const key = p.category_id ?? '__uncategorized'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [products])

  const categoryChips = useMemo(() => {
    const chips: Array<{ id: string; name: string; count: number }> = [
      { id: 'all', name: 'All items', count: products.length },
    ]
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order)
    for (const c of sorted) {
      chips.push({
        id: c.id,
        name: c.name,
        count: categoryCounts.get(c.id) ?? 0,
      })
    }
    const uncat = categoryCounts.get('__uncategorized') ?? 0
    if (uncat > 0) {
      chips.push({ id: '__uncategorized', name: 'Uncategorized', count: uncat })
    }
    return chips
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
    setMessage(null)
    setError(null)
    setTenderOpen(false)
  }

  function applyQuickDiscount() {
    if (subtotal <= 0) return
    const ten = Math.round(subtotal * 0.1)
    setDiscountMinor((d) => (d > 0 ? 0 : ten))
  }

  function openTender() {
    if (!tenant || !businessId || !outletId) {
      setError('Select a business and outlet first (+ in the sidebar).')
      return
    }
    if (cart.length === 0) return
    setError(null)
    setMessage(null)
    setSelectedTender('cash')
    setTenderOpen(true)
  }

  async function completeWithTender(method: Tender) {
    if (!tenant || !businessId || !outletId) {
      setError('Select a business and outlet first')
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
      payments: [{ method, amount_minor: total }],
      subtotal_minor: subtotal,
      discount_minor: discountMinor,
      tax_minor: tax,
      total_minor: total,
      currency_code: currency,
    }

    try {
      await insertLocalSale({
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
          await patchLocalSale(clientSaleId, {
            synced: true,
            serverId: sale.id,
            receiptNo: sale.receipt_no ?? undefined,
          })
          receiptLabel = sale.receipt_no ?? sale.id.slice(0, 8)
          setMessage(
            `Sale complete · ${receiptLabel} · ${money(sale.total_minor)} · ${method}`,
          )
        } catch {
          await enqueueOutbox({
            id: uuidv4(),
            type: 'sale.complete',
            payload,
            businessId,
          })
          setMessage(`Sale saved · will sync · ${money(total)} · ${method}`)
          void flushOutbox(() => tenant)
        }
      } else {
        await enqueueOutbox({
          id: uuidv4(),
          type: 'sale.complete',
          payload,
          businessId,
        })
        setMessage(`Sale saved offline · ${money(total)} · ${method}`)
      }

      setCart([])
      setDiscountMinor(0)
      setTenderOpen(false)
      await loadRecent()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div className="relative flex h-full min-h-0">
      {/* Item library — Square-style grid */}
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        {/* Category chips */}
        <div className="shrink-0 border-b border-border/70 bg-card px-3 py-2.5">
          <div className="pos-scroll flex gap-2 overflow-x-auto pb-0.5">
            {categoryChips.map((chip) => {
              const active = selectedCategory === chip.id
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedCategory(chip.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 border-2 px-3 py-2 text-[13px] font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-foreground/25 hover:bg-muted/60',
                  )}
                >
                  {chip.name}
                  <span
                    className={cn(
                      'tabular-nums text-[11px] font-medium',
                      active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {chip.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Product grid */}
        <div className="pos-scroll min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filteredProducts.map((p) => {
              const inCart = cart.find((l) => l.productId === p.id)
              const qty = inCart?.qty ?? 0
              const selected = qty > 0
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  data-selected={selected ? 'true' : undefined}
                  className={cn(
                    'relative flex min-h-[5.75rem] flex-col items-start border-2 bg-card p-3 text-left shadow-sm transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  {selected ? (
                    <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-foreground">
                      {qty}
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      'pr-8 text-[13px] font-semibold leading-snug',
                      selected ? 'text-foreground' : 'text-foreground',
                    )}
                  >
                    {p.name}
                  </div>
                  <div
                    className={cn(
                      'mt-auto pt-2 text-[13px] font-semibold tabular-nums',
                      selected ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {money(p.price_minor ?? 0)}
                  </div>
                  {p.sku ? (
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
                      {p.sku}
                    </div>
                  ) : null}
                </button>
              )
            })}
            {filteredProducts.length === 0 ? (
              <div className="col-span-full flex flex-col items-center gap-3 py-14 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  {seedHint ??
                    (search.trim()
                      ? 'No items match your search.'
                      : 'No items in this category. Add products under Items, or load a sample catalog.')}
                </p>
                {!search.trim() ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-none"
                    disabled={busy}
                    onClick={() => {
                      setSeededOnce(false)
                      setSeedHint(null)
                      void load()
                    }}
                  >
                    Load sample catalog
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Recent sales — real history, not kitchen stations */}
        <footer className="shrink-0 border-t border-border bg-card px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recent sales
            </span>
            <span className="text-[11px] text-muted-foreground">
              {recent.length === 0 ? 'None yet' : `${recent.length} latest`}
            </span>
          </div>
          <div className="pos-scroll flex gap-2 overflow-x-auto">
            {recent.length === 0 ? (
              <div className="flex h-12 items-center text-[12px] text-muted-foreground">
                Completed sales appear here with amount and sync status.
              </div>
            ) : (
              recent.map((s) => (
                <div
                  key={s.id}
                  className="flex h-12 min-w-[10.5rem] items-center gap-2.5 border border-border bg-background px-2.5"
                >
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[12px] font-semibold tabular-nums">
                      {money(s.totalMinor)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="truncate">{s.receiptLabel}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{formatTime(s.createdAt)}</span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-semibold',
                      s.synced ? 'text-emerald-700' : 'text-amber-700',
                    )}
                  >
                    {s.synced ? 'Synced' : 'Pending'}
                  </span>
                </div>
              ))
            )}
          </div>
        </footer>
      </section>

      {/* Current sale — Square ticket panel */}
      <aside className="flex w-[20rem] shrink-0 flex-col border-l border-border bg-ticket xl:w-[22rem]">
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Current sale
            </div>
            <div className="mt-0.5 truncate text-[15px] font-semibold tracking-tight">
              {outletName}
            </div>
            <div className="truncate text-[12px] text-muted-foreground">
              {staffName}
              {itemCount > 0
                ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}`
                : ''}
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground"
            title="Clear sale"
            onClick={clearCart}
            disabled={cart.length === 0}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>

        <div className="pos-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-12 text-center">
              <p className="text-sm font-medium text-foreground/80">
                Sale is empty
              </p>
              <p className="text-[12px] text-muted-foreground">
                Tap items on the left to add them.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/80">
              {cart.map((l) => (
                <li key={l.productId} className="py-3 first:pt-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold leading-snug">
                        {l.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                        {money(l.unitPrice)} each
                      </div>
                    </div>
                    <span className="shrink-0 text-[13px] font-bold tabular-nums">
                      {money(l.unitPrice * l.qty)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Decrease ${l.name}`}
                      className="flex size-8 items-center justify-center border border-border text-muted-foreground hover:bg-muted"
                      onClick={() => changeQty(l.productId, -1)}
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold tabular-nums">
                      {l.qty}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase ${l.name}`}
                      className="flex size-8 items-center justify-center border border-border text-muted-foreground hover:bg-muted"
                      onClick={() => changeQty(l.productId, 1)}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border">
          <div className="flex items-center border-b border-border/70 px-4 py-2.5">
            <button
              type="button"
              onClick={applyQuickDiscount}
              disabled={cart.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors',
                discountMinor > 0
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
                cart.length === 0 && 'opacity-40',
              )}
            >
              <Percent className="size-3.5" />
              {discountMinor > 0
                ? `10% off (−${money(discountMinor)})`
                : 'Apply 10% discount'}
            </button>
          </div>

          <div className="space-y-1.5 px-4 py-3">
            <div className="flex justify-between text-[12px] text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium text-foreground">
                {money(Math.max(0, subtotal - discountMinor))}
              </span>
            </div>
            {taxRate > 0 ? (
              <div className="flex justify-between text-[12px] text-muted-foreground">
                <span>Tax {(taxRate * 100).toFixed(2)}%</span>
                <span className="tabular-nums font-medium text-foreground">
                  {money(tax)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between pt-0.5 text-[17px] font-bold">
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
              className="h-12 w-full rounded-none text-[15px] font-bold tracking-tight"
              disabled={busy || cart.length === 0 || !outletId}
              onClick={openTender}
            >
              {busy
                ? 'Processing…'
                : cart.length === 0
                  ? 'Charge'
                  : `Charge ${money(total)}`}
            </Button>
            {!outletId ? (
              <p className="mt-2 text-center text-[11px] font-medium text-amber-800">
                Choose an outlet with + next to Menus / Business in the sidebar.
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      {/* Tender sheet — Square-like payment method step */}
      {tenderOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-stretch justify-end bg-foreground/40"
          role="dialog"
          aria-modal="true"
          aria-label="Choose payment method"
        >
          <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl sm:w-[22rem]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment
                </div>
                <div className="text-lg font-bold tabular-nums">
                  {money(total)}
                </div>
              </div>
              <button
                type="button"
                className="flex size-9 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setTenderOpen(false)}
                aria-label="Close payment"
                disabled={busy}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              <p className="mb-3 text-sm text-muted-foreground">
                How is the customer paying?
              </p>
              {TENDER_OPTIONS.map(({ id, label, hint, icon: Icon }) => {
                const active = selectedTender === id
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => setSelectedTender(id)}
                    className={cn(
                      'flex w-full items-center gap-3 border-2 px-3 py-3.5 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-foreground/20 hover:bg-muted/40',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-10 items-center justify-center',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">
                        {label}
                      </span>
                      <span className="block text-[12px] text-muted-foreground">
                        {hint}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="border-t border-border p-4">
              <Button
                type="button"
                className="h-12 w-full rounded-none text-[15px] font-bold"
                disabled={busy}
                onClick={() => void completeWithTender(selectedTender)}
              >
                {busy
                  ? 'Completing…'
                  : `Complete ${TENDER_OPTIONS.find((t) => t.id === selectedTender)?.label ?? ''} payment`}
              </Button>
              <button
                type="button"
                className="mt-2 w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => setTenderOpen(false)}
              >
                Back to sale
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
