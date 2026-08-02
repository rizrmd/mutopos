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
import { api, formatIDR, type Category, type Product } from '@/lib/api'
import { cacheProducts } from '@/lib/db'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const PASTELS = [
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
  const { tenant, businessId } = useSession()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [price, setPrice] = useState('10000')
  const [catName, setCatName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!tenant) return
    const [p, c] = await Promise.all([
      api.listProducts(tenant),
      api.listCategories(tenant),
    ])
    setProducts(p.products)
    setCategories(c.categories)
    if (businessId) {
      await cacheProducts(businessId, p.products)
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Menus, categories and products — cached in RxDB for offline POS.
        </p>
      </div>

      {/* Category pastel chips */}
      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {categories.map((c, i) => (
            <span
              key={c.id}
              className={cn(
                'rounded-2xl px-3 py-2 text-sm font-medium',
                PASTELS[i % PASTELS.length],
              )}
            >
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Add product</CardTitle>
            <CardDescription>
              Default price in IDR minor units (rupiah).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-xl"
            />
            <Input
              placeholder="SKU (optional)"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="h-10 rounded-xl"
            />
            <Input
              placeholder="Price (IDR)"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-10 rounded-xl"
            />
            <Button
              type="button"
              className="rounded-xl"
              disabled={busy || !name}
              onClick={() => void addProduct()}
            >
              <Plus className="size-4" />
              Create product
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Add category</CardTitle>
            <CardDescription>
              Categories become pastel tiles on the POS menu.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Category name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              className="h-10 rounded-xl"
            />
            <Button
              type="button"
              className="rounded-xl"
              disabled={busy || !catName}
              onClick={() => void addCategory()}
            >
              <Plus className="size-4" />
              Create category
            </Button>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-primary" />
                  {c.name}
                </li>
              ))}
              {categories.length === 0 ? <li>No categories yet</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">
            Products ({products.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-border bg-card p-3 shadow-sm"
              >
                <div className="font-medium">{p.name}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {formatIDR(p.price_minor ?? 0)}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{p.sku ?? 'No SKU'}</span>
                  <span
                    className={
                      p.is_active ? 'text-emerald-700' : 'text-amber-700'
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
