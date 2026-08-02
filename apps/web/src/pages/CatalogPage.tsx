import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api, formatMoney, type Category, type Product } from '@/lib/api'
import { cacheCatalog, getLocalCatalog } from '@/lib/db'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const TILES = [
  'bg-[var(--pastel-6)]',
  'bg-[var(--pastel-1)]',
  'bg-[var(--pastel-9)]',
  'bg-[var(--pastel-7)]',
  'bg-[var(--pastel-3)]',
  'bg-[var(--pastel-8)]',
  'bg-[var(--pastel-5)]',
  'bg-[var(--pastel-2)]',
]

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
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Categories and products for this business.
        </p>
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {categories.map((c, i) => (
            <span
              key={c.id}
              className={cn(
                'rounded-xl px-3 py-2 text-sm font-semibold text-foreground/90',
                TILES[i % TILES.length],
              )}
            >
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Add product</CardTitle>
            <CardDescription>
              Price in {currency === 'USD' ? 'cents (e.g. 1295 = $12.95)' : 'minor units'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-2">
            <Input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="SKU (optional)"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
            <Input
              placeholder="Price (IDR)"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <Button
              type="button"
              disabled={busy || !name}
              onClick={() => void addProduct()}
            >
              <Plus className="size-4" />
              Create product
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Add category</CardTitle>
            <CardDescription>Shown as tiles on the POS menu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-2">
            <Input
              placeholder="Category name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
            />
            <Button
              type="button"
              disabled={busy || !catName}
              onClick={() => void addCategory()}
            >
              <Plus className="size-4" />
              Create category
            </Button>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {categories.map((c) => (
                <li key={c.id}>· {c.name}</li>
              ))}
              {categories.length === 0 ? <li>No categories yet</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>

      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">
            Products ({products.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <div
                key={p.id}
                className="border border-border bg-card p-3"
              >
                <div className="font-semibold">{p.name}</div>
                <div className="mt-0.5 text-sm text-foreground/70">
                  {formatMoney(p.price_minor ?? 0, currency)}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] font-medium">
                  <span className="text-muted-foreground">
                    {p.sku ?? 'No SKU'}
                  </span>
                  <span
                    className={
                      p.is_active ? 'text-emerald-800' : 'text-amber-800'
                    }
                  >
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
            {products.length === 0 ? (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                No products — add one to start selling.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
