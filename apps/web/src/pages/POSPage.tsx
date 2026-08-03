import { useCallback, useEffect, useMemo, useState } from '@lynx-js/react'
import { useOutletContext } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { api, type Category, type Product } from '@/lib/api'
import {
  cacheCatalog,
  enqueueOutbox,
  getLocalCatalog,
  insertLocalSale,
  listLocalSales,
  patchLocalSale,
} from '@/lib/db'
import { formatMoney, formatTime } from '@/lib/format'
import { isOnline } from '@/lib/net'
import { flushOutbox } from '@/lib/outbox'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import { uuidv4 } from '@/lib/uuid'

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
  icon: IconName
}> = [
  { id: 'cash', label: 'Cash', hint: 'Notes & coins', icon: 'banknote' },
  { id: 'card', label: 'Card', hint: 'Debit / credit', icon: 'credit-card' },
  {
    id: 'other',
    label: 'Other',
    hint: 'Transfer / QR / custom',
    icon: 'more-horizontal',
  },
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
    'background only'
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
      'background only'
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
    'background only'
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
  const tax = useMemo(() => Math.round(taxable * taxRate), [taxable, taxRate])
  const total = taxable + tax
  const itemCount = useMemo(() => cart.reduce((s, l) => s + l.qty, 0), [cart])

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
    'background only'
    setCart((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i]!, qty: next[i]!.qty + 1 }
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
    'background only'
    setCart((prev) =>
      prev
        .map((l) =>
          l.productId === productId ? { ...l, qty: l.qty + delta } : l,
        )
        .filter((l) => l.qty > 0),
    )
  }

  function clearCart() {
    'background only'
    setCart([])
    setDiscountMinor(0)
    setMessage(null)
    setError(null)
    setTenderOpen(false)
  }

  function applyQuickDiscount() {
    'background only'
    if (subtotal <= 0) return
    const ten = Math.round(subtotal * 0.1)
    setDiscountMinor((d) => (d > 0 ? 0 : ten))
  }

  function openTender() {
    'background only'
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
    'background only'
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

      if (isOnline()) {
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

  const chargeLabel = busy
    ? 'Processing…'
    : cart.length === 0
      ? 'Charge'
      : `Charge ${money(total)}`

  return (
    <view className="mp-pos">
      {/* Item library — Square-style grid */}
      <view className="mp-pos__library">
        {/* Category chips */}
        <scroll-view scroll-orientation="horizontal" className="mp-cats">
          <view className="mp-cats__row">
            {categoryChips.map((chip) => {
              const active = selectedCategory === chip.id
              return (
                <view
                  key={chip.id}
                  className={cn('mp-cat', active && 'is-active')}
                  bindtap={() => {
                    'background only'
                    setSelectedCategory(chip.id)
                  }}
                >
                  <text className="mp-cat__name">{chip.name}</text>
                  <text className="mp-cat__count mp-num">{chip.count}</text>
                </view>
              )
            })}
          </view>
        </scroll-view>

        {/* Product grid */}
        <scroll-view scroll-orientation="vertical" className="mp-items">
          {filteredProducts.length > 0 ? (
            <view className="mp-items__grid">
              {filteredProducts.map((p) => {
                const inCart = cart.find((l) => l.productId === p.id)
                const qty = inCart?.qty ?? 0
                const selected = qty > 0
                return (
                  <view
                    key={p.id}
                    className={cn('mp-item', selected && 'is-selected')}
                    bindtap={() => {
                      'background only'
                      addToCart(p)
                    }}
                  >
                    {selected ? (
                      <view className="mp-item__qty">
                        <text className="mp-item__qty-text mp-num">{qty}</text>
                      </view>
                    ) : null}
                    <text className="mp-item__name">{p.name}</text>
                    <text className="mp-item__price mp-num">
                      {money(p.price_minor ?? 0)}
                    </text>
                    {p.sku ? (
                      <text className="mp-item__sku mp-truncate">{p.sku}</text>
                    ) : null}
                  </view>
                )
              })}
            </view>
          ) : (
            <view className="mp-items__empty">
              <text className="mp-items__empty-text">
                {seedHint ??
                  (search.trim()
                    ? 'No items match your search.'
                    : 'No items in this category. Add products under Items, or load a sample catalog.')}
              </text>
              {!search.trim() ? (
                <Button
                  size="sm"
                  variant="outline"
                  label="Load sample catalog"
                  disabled={busy}
                  onTap={() => {
                    setSeededOnce(false)
                    setSeedHint(null)
                    void load()
                  }}
                />
              ) : null}
            </view>
          )}
        </scroll-view>

        {/* Recent sales — real history, not kitchen stations */}
        <view className="mp-recent">
          <view className="mp-recent__head">
            <text className="mp-label">RECENT SALES</text>
            <text className="mp-recent__meta">
              {recent.length === 0 ? 'None yet' : `${recent.length} latest`}
            </text>
          </view>
          <scroll-view
            scroll-orientation="horizontal"
            className="mp-recent__strip"
          >
            <view className="mp-recent__row">
              {recent.length === 0 ? (
                <text className="mp-recent__empty">
                  Completed sales appear here with amount and sync status.
                </text>
              ) : (
                recent.map((s) => (
                  <view key={s.id} className="mp-recent__card">
                    <view className="mp-fill">
                      <text className="mp-recent__total mp-num mp-truncate">
                        {money(s.totalMinor)}
                      </text>
                      <text className="mp-recent__sub mp-truncate">
                        {s.receiptLabel} · {formatTime(s.createdAt)}
                      </text>
                    </view>
                    <text
                      className={cn(
                        'mp-recent__flag',
                        s.synced && 'is-synced',
                      )}
                    >
                      {s.synced ? 'Synced' : 'Pending'}
                    </text>
                  </view>
                ))
              )}
            </view>
          </scroll-view>
        </view>
      </view>

      {/* Current sale — Square ticket panel */}
      <view className="mp-ticket">
        <view className="mp-ticket__head">
          <view className="mp-fill">
            <text className="mp-label">CURRENT SALE</text>
            <text className="mp-ticket__outlet mp-truncate">{outletName}</text>
            <text className="mp-ticket__staff mp-truncate">
              {staffName}
              {itemCount > 0
                ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}`
                : ''}
            </text>
          </view>
          <Button
            size="icon"
            variant="ghost"
            disabled={cart.length === 0}
            onTap={clearCart}
          >
            <Icon name="trash" size={16} />
          </Button>
        </view>

        <scroll-view scroll-orientation="vertical" className="mp-ticket__lines">
          {cart.length === 0 ? (
            <view className="mp-ticket__empty">
              <text className="mp-ticket__empty-title">Sale is empty</text>
              <text className="mp-ticket__empty-sub">
                Tap items on the left to add them.
              </text>
            </view>
          ) : (
            <view className="mp-ticket__lines-pad">
              {cart.map((l) => (
                <view key={l.productId} className="mp-line">
                  <view className="mp-line__top">
                    <view className="mp-fill">
                      <text className="mp-line__name mp-truncate">
                        {l.name}
                      </text>
                      <text className="mp-line__unit mp-num">
                        {money(l.unitPrice)} each
                      </text>
                    </view>
                    <text className="mp-line__total mp-num">
                      {money(l.unitPrice * l.qty)}
                    </text>
                  </view>
                  <view className="mp-line__stepper">
                    <view
                      className="mp-line__step"
                      accessibility-label={`Decrease ${l.name}`}
                      bindtap={() => {
                        'background only'
                        changeQty(l.productId, -1)
                      }}
                    >
                      <Icon name="minus" size={14} />
                    </view>
                    <text className="mp-line__qty mp-num">{l.qty}</text>
                    <view
                      className="mp-line__step"
                      accessibility-label={`Increase ${l.name}`}
                      bindtap={() => {
                        'background only'
                        changeQty(l.productId, 1)
                      }}
                    >
                      <Icon name="plus" size={14} />
                    </view>
                  </view>
                </view>
              ))}
            </view>
          )}
        </scroll-view>

        <view className="mp-ticket__foot">
          <view
            className={cn(
              'mp-discount',
              discountMinor > 0 && 'is-on',
              cart.length === 0 && 'is-disabled',
            )}
            bindtap={() => {
              'background only'
              if (cart.length === 0) return
              applyQuickDiscount()
            }}
          >
            <Icon
              name="percent"
              size={14}
              color={discountMinor > 0 ? '#2563eb' : '#6a7385'}
            />
            <text className="mp-discount__text">
              {discountMinor > 0
                ? `10% off (−${money(discountMinor)})`
                : 'Apply 10% discount'}
            </text>
          </view>

          <view className="mp-totals">
            <view className="mp-totals__row">
              <text className="mp-totals__label">Subtotal</text>
              <text className="mp-totals__value mp-num">
                {money(Math.max(0, subtotal - discountMinor))}
              </text>
            </view>
            {taxRate > 0 ? (
              <view className="mp-totals__row">
                <text className="mp-totals__label">
                  Tax {(taxRate * 100).toFixed(2)}%
                </text>
                <text className="mp-totals__value mp-num">{money(tax)}</text>
              </view>
            ) : null}
            <view className="mp-totals__row">
              <text className="mp-totals__grand-label">Total</text>
              <text className="mp-totals__grand-value mp-num">
                {money(total)}
              </text>
            </view>

            {message ? <text className="mp-ok-text">{message}</text> : null}
            {error ? <text className="mp-error-text">{error}</text> : null}
          </view>

          <view className="mp-charge">
            <Button
              size="lg"
              block
              label={chargeLabel}
              disabled={busy || cart.length === 0 || !outletId}
              onTap={openTender}
            />
            {!outletId ? (
              <text className="mp-charge__warn">
                Choose an outlet with + next to Business in the sidebar.
              </text>
            ) : null}
          </view>
        </view>
      </view>

      {/* Tender sheet — Square-like payment method step */}
      {tenderOpen ? (
        <view className="mp-tender">
          <view className="mp-tender__panel">
            <view className="mp-tender__head">
              <view>
                <text className="mp-label">PAYMENT</text>
                <text className="mp-tender__amount mp-num">{money(total)}</text>
              </view>
              <view
                className="mp-tender__close"
                accessibility-label="Close payment"
                bindtap={() => {
                  'background only'
                  if (busy) return
                  setTenderOpen(false)
                }}
              >
                <Icon name="x" size={20} />
              </view>
            </view>

            <scroll-view
              scroll-orientation="vertical"
              className="mp-tender__body"
            >
              <view className="mp-tender__body-pad">
                <text className="mp-tender__prompt">
                  How is the customer paying?
                </text>
                {TENDER_OPTIONS.map(({ id, label, hint, icon }) => {
                  const active = selectedTender === id
                  return (
                    <view
                      key={id}
                      className={cn('mp-tender__option', active && 'is-active')}
                      bindtap={() => {
                        'background only'
                        if (busy) return
                        setSelectedTender(id)
                      }}
                    >
                      <view className="mp-tender__option-icon">
                        <Icon
                          name={icon}
                          size={20}
                          color={active ? '#fcfcfd' : '#6a7385'}
                        />
                      </view>
                      <view className="mp-fill">
                        <text className="mp-tender__option-label">{label}</text>
                        <text className="mp-tender__option-hint">{hint}</text>
                      </view>
                    </view>
                  )
                })}
              </view>
            </scroll-view>

            <view className="mp-tender__foot">
              <Button
                size="lg"
                block
                disabled={busy}
                label={
                  busy
                    ? 'Completing…'
                    : `Complete ${
                        TENDER_OPTIONS.find((t) => t.id === selectedTender)
                          ?.label ?? ''
                      } payment`
                }
                onTap={() => void completeWithTender(selectedTender)}
              />
              <text
                className="mp-tender__back"
                bindtap={() => {
                  'background only'
                  if (busy) return
                  setTenderOpen(false)
                }}
              >
                Back to sale
              </text>
            </view>
          </view>
        </view>
      ) : null}
    </view>
  )
}
