import { useCallback, useEffect, useState } from '@lynx-js/react'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { TextField } from '@/components/ui/TextField'
import { api, type Category, type Product } from '@/lib/api'
import { cacheCatalog, getLocalCatalog } from '@/lib/db'
import { formatMoney } from '@/lib/format'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const TILE_COUNT = 8

export function CatalogPage() {
  const { tenant, businessId, memberships } = useSession()
  const currency =
    memberships.find((m) => m.business_id === businessId)?.currency_code ??
    'USD'
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [price, setPrice] = useState('1295')
  const [catName, setCatName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    'background only'
    let hadLocal = false
    // Offline-first: show cached catalog before network.
    if (businessId) {
      try {
        const local = await getLocalCatalog(businessId)
        if (local && local.products.length > 0) {
          hadLocal = true
          setProducts(local.products)
          setCategories(local.categories)
        }
      } catch {
        /* ignore local read errors */
      }
    }

    if (!tenant) return
    try {
      const [p, c] = await Promise.all([
        api.listProducts(tenant),
        api.listCategories(tenant),
      ])
      setProducts(p.products)
      setCategories(c.categories)
      if (businessId) {
        await cacheCatalog(businessId, p.products, c.categories)
      }
      setError(null)
    } catch (e) {
      // Keep local list if present; only surface error when empty.
      if (!hadLocal) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }, [tenant, businessId])

  useEffect(() => {
    void load().catch((e) => setError(String(e)))
  }, [load])

  async function addProduct() {
    'background only'
    if (!tenant || !name) return
    setBusy(true)
    setError(null)
    try {
      await api.createProduct(tenant, {
        name,
        sku: sku || undefined,
        price_minor: Number(price) || 0,
        unit: 'pcs',
      })
      setName('')
      setSku('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function addCategory() {
    'background only'
    if (!tenant || !catName) return
    setBusy(true)
    try {
      await api.createCategory(tenant, catName)
      setCatName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <view className="mp-page">
      <view>
        <text className="mp-title">Items</text>
        <text className="mp-subtitle">
          Products and categories available at checkout.
        </text>
      </view>

      {categories.length > 0 ? (
        <view className="mp-chipwrap">
          {categories.map((c, i) => (
            <view
              key={c.id}
              className={cn('mp-tag', `mp-pastel-${i % TILE_COUNT}`)}
            >
              <text className="mp-tag__text">{c.name}</text>
            </view>
          ))}
        </view>
      ) : null}

      <view className="mp-grid2">
        <Card>
          <CardHeader
            title="Add product"
            description={`Price in ${
              currency === 'USD' ? 'cents (e.g. 1295 = $12.95)' : 'minor units'
            }.`}
          />
          <CardContent>
            <TextField
              placeholder="Name"
              value={name}
              onChangeText={setName}
            />
            <TextField
              placeholder="SKU (optional)"
              value={sku}
              onChangeText={setSku}
            />
            <TextField
              placeholder="Price"
              type="number"
              value={price}
              onChangeText={setPrice}
            />
            <Button
              label="Create product"
              disabled={busy || !name}
              onTap={() => void addProduct()}
            >
              <Icon name="plus" size={16} color="#fcfcfd" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Add category"
            description="Shown as filters on the checkout library."
          />
          <CardContent>
            <TextField
              placeholder="Category name"
              value={catName}
              onChangeText={setCatName}
            />
            <Button
              label="Create category"
              disabled={busy || !catName}
              onTap={() => void addCategory()}
            >
              <Icon name="plus" size={16} color="#fcfcfd" />
            </Button>
            <view className="mp-list">
              {categories.map((c) => (
                <text key={c.id} className="mp-bullet">
                  · {c.name}
                </text>
              ))}
              {categories.length === 0 ? (
                <text className="mp-bullet">No categories yet</text>
              ) : null}
            </view>
          </CardContent>
        </Card>
      </view>

      {error ? <text className="mp-error-text">{error}</text> : null}

      <Card>
        <CardHeader title={`Products (${products.length})`} />
        <CardContent>
          {products.length > 0 ? (
            <view className="mp-grid3">
              {products.map((p) => (
                <view key={p.id} className="mp-product">
                  <text className="mp-product__name">{p.name}</text>
                  <text className="mp-product__price mp-num">
                    {formatMoney(p.price_minor ?? 0, currency)}
                  </text>
                  <view className="mp-product__meta">
                    <text className="mp-product__sku mp-truncate">
                      {p.sku ?? 'No SKU'}
                    </text>
                    <text
                      className={cn(
                        'mp-product__state',
                        !p.is_active && 'is-inactive',
                      )}
                    >
                      {p.is_active ? 'Active' : 'Inactive'}
                    </text>
                  </view>
                </view>
              ))}
            </view>
          ) : (
            <text className="mp-list__empty">
              No products — add one to start selling.
            </text>
          )}
        </CardContent>
      </Card>
    </view>
  )
}
