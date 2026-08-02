import { useCallback, useEffect, useState } from 'react'

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Products and categories for this business (online CRUD). Cached in
          RxDB for offline POS.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add product</CardTitle>
            <CardDescription>Default price in IDR minor units (rupiah).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
            <Button type="button" disabled={busy || !name} onClick={() => void addProduct()}>
              Create product
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Category name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
            />
            <Button type="button" disabled={busy || !catName} onClick={() => void addCategory()}>
              Create category
            </Button>
            <ul className="text-sm text-muted-foreground">
              {categories.map((c) => (
                <li key={c.id}>• {c.name}</li>
              ))}
              {categories.length === 0 ? <li>No categories yet</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products ({products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">SKU</th>
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{p.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{p.sku ?? '—'}</td>
                    <td className="py-2 pr-3">{formatIDR(p.price_minor ?? 0)}</td>
                    <td className="py-2">{p.is_active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-muted-foreground">
                      No products — add one to start selling.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
