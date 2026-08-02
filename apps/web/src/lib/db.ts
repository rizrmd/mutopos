import {
  createRxDatabase,
  addRxPlugin,
  type RxCollection,
  type RxDatabase,
  type RxDocument,
} from 'rxdb'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder'
import { RxDBUpdatePlugin } from 'rxdb/plugins/update'
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv'

addRxPlugin(RxDBQueryBuilderPlugin)
addRxPlugin(RxDBUpdatePlugin)

export type OutboxDoc = {
  id: string
  type: string
  payload: string
  createdAt: number
  status: 'pending' | 'in_flight' | 'sent' | 'failed'
  attempts: number
  lastError?: string
  businessId: string
  resultJson?: string
}

export type LocalProductDoc = {
  id: string
  businessId: string
  name: string
  sku?: string
  priceMinor: number
  isActive: boolean
  updatedAt: number
}

export type LocalSaleDoc = {
  id: string
  businessId: string
  outletId: string
  clientSaleId: string
  status: string
  totalMinor: number
  receiptNo?: string
  serverId?: string
  linesJson: string
  createdAt: number
  synced: boolean
}

export type MetaDoc = {
  id: string
  value: string
}

type Collections = {
  outbox: RxCollection<OutboxDoc>
  products: RxCollection<LocalProductDoc>
  sales: RxCollection<LocalSaleDoc>
  meta: RxCollection<MetaDoc>
}

export type MutoDatabase = RxDatabase<Collections>
export type OutboxDocument = RxDocument<OutboxDoc>

let dbPromise: Promise<MutoDatabase> | null = null

// Indexed number fields need multipleOf (RxDB SC35); indexed strings need maxLength (SC34).
const tsNumber = {
  type: 'number' as const,
  multipleOf: 1,
  minimum: 0,
  maximum: 9007199254740991,
}

const outboxSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 64 },
    type: { type: 'string', maxLength: 64 },
    payload: { type: 'string' },
    createdAt: tsNumber,
    status: { type: 'string', maxLength: 32 },
    attempts: {
      type: 'number' as const,
      multipleOf: 1,
      minimum: 0,
      maximum: 1_000_000,
    },
    lastError: { type: 'string' },
    businessId: { type: 'string', maxLength: 64 },
    resultJson: { type: 'string' },
  },
  required: ['id', 'type', 'payload', 'createdAt', 'status', 'attempts', 'businessId'],
  indexes: ['status', 'createdAt', 'businessId'],
} as const

const productSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 64 },
    businessId: { type: 'string', maxLength: 64 },
    name: { type: 'string' },
    sku: { type: 'string' },
    priceMinor: { type: 'number' },
    isActive: { type: 'boolean' },
    updatedAt: tsNumber,
  },
  required: ['id', 'businessId', 'name', 'priceMinor', 'isActive', 'updatedAt'],
  indexes: ['businessId'],
} as const

const saleSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 64 },
    businessId: { type: 'string', maxLength: 64 },
    outletId: { type: 'string' },
    clientSaleId: { type: 'string', maxLength: 64 },
    status: { type: 'string', maxLength: 32 },
    totalMinor: { type: 'number' },
    receiptNo: { type: 'string' },
    serverId: { type: 'string' },
    linesJson: { type: 'string' },
    createdAt: tsNumber,
    synced: { type: 'boolean' },
  },
  required: [
    'id',
    'businessId',
    'outletId',
    'clientSaleId',
    'status',
    'totalMinor',
    'linesJson',
    'createdAt',
    'synced',
  ],
  indexes: ['businessId', 'clientSaleId', 'createdAt'],
} as const

const metaSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 64 },
    value: { type: 'string' },
  },
  required: ['id', 'value'],
} as const

export async function getDb(): Promise<MutoDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const storage = wrappedValidateAjvStorage({
        storage: getRxStorageDexie(),
      })
      // Do not set ignoreDuplicate: true — it is only allowed with the
      // RxDB dev-mode plugin (DB9) and breaks production/preview builds.
      const db = await createRxDatabase<Collections>({
        name: 'mutopos',
        storage,
      })
      if (!db.outbox) {
        await db.addCollections({
          outbox: { schema: outboxSchema },
          products: { schema: productSchema },
          sales: { schema: saleSchema },
          meta: { schema: metaSchema },
        })
      }
      return db
    })().catch((err) => {
      // Allow a later retry after a failed first open (e.g. transient IDB).
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

function randomDeviceKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `dev-${Date.now()}`
}

/** localStorage fallback when RxDB/IndexedDB is unavailable. */
const DEVICE_KEY_LS = 'mutopos.device_key'

export async function getOrCreateDeviceKey(): Promise<string> {
  try {
    const db = await getDb()
    const existing = await db.meta.findOne('device_key').exec()
    if (existing) return existing.value
    const key = randomDeviceKey()
    await db.meta.insert({ id: 'device_key', value: key })
    try {
      localStorage.setItem(DEVICE_KEY_LS, key)
    } catch {
      /* ignore */
    }
    return key
  } catch (err) {
    console.error('[mutopos] RxDB unavailable; using localStorage device key', err)
    try {
      const cached = localStorage.getItem(DEVICE_KEY_LS)
      if (cached) return cached
      const key = randomDeviceKey()
      localStorage.setItem(DEVICE_KEY_LS, key)
      return key
    } catch {
      return randomDeviceKey()
    }
  }
}

export async function enqueueOutbox(entry: {
  id: string
  type: string
  payload: unknown
  businessId: string
}): Promise<void> {
  const db = await getDb()
  await db.outbox.insert({
    id: entry.id,
    type: entry.type,
    payload: JSON.stringify(entry.payload),
    createdAt: Date.now(),
    status: 'pending',
    attempts: 0,
    businessId: entry.businessId,
  })
}

export async function cacheProducts(
  businessId: string,
  products: Array<{
    id: string
    name: string
    sku?: string | null
    price_minor?: number | null
    is_active: boolean
  }>,
): Promise<void> {
  const db = await getDb()
  for (const p of products) {
    const doc = {
      id: p.id,
      businessId,
      name: p.name,
      sku: p.sku ?? undefined,
      priceMinor: p.price_minor ?? 0,
      isActive: p.is_active,
      updatedAt: Date.now(),
    }
    const existing = await db.products.findOne(p.id).exec()
    if (existing) {
      await existing.patch(doc)
    } else {
      await db.products.insert(doc)
    }
  }
}

/** Full catalog snapshot (products + categories) for offline-first POS paint. */
export type CatalogSnapshot = {
  products: Array<{
    id: string
    category_id?: string | null
    sku?: string | null
    barcode?: string | null
    name: string
    description?: string | null
    unit?: string | null
    track_stock: boolean
    is_active: boolean
    price_minor?: number | null
    currency_code?: string | null
  }>
  categories: Array<{
    id: string
    name: string
    sort_order: number
    is_active: boolean
  }>
  updatedAt: number
}

function catalogMetaId(businessId: string) {
  return `catalog:${businessId}`
}

export async function cacheCatalog(
  businessId: string,
  products: CatalogSnapshot['products'],
  categories: CatalogSnapshot['categories'],
): Promise<void> {
  const db = await getDb()
  const value = JSON.stringify({
    products,
    categories,
    updatedAt: Date.now(),
  } satisfies CatalogSnapshot)
  const id = catalogMetaId(businessId)
  const existing = await db.meta.findOne(id).exec()
  if (existing) {
    await existing.patch({ value })
  } else {
    await db.meta.insert({ id, value })
  }
  // Keep product collection in sync for queries / legacy readers.
  await cacheProducts(businessId, products)
}

export async function getLocalCatalog(
  businessId: string,
): Promise<CatalogSnapshot | null> {
  try {
    const db = await getDb()
    const snap = await db.meta.findOne(catalogMetaId(businessId)).exec()
    if (snap?.value) {
      try {
        const parsed = JSON.parse(snap.value) as CatalogSnapshot
        if (Array.isArray(parsed.products)) {
          return {
            products: parsed.products,
            categories: Array.isArray(parsed.categories)
              ? parsed.categories
              : [],
            updatedAt: parsed.updatedAt ?? 0,
          }
        }
      } catch {
        /* fall through to products collection */
      }
    }

    // Fallback: products collection only (older caches without categories).
    const local = await db.products
      .find({ selector: { businessId } })
      .exec()
    if (local.length === 0) return null
    return {
      products: local.map((d) => ({
        id: d.id,
        name: d.name,
        sku: d.sku,
        price_minor: d.priceMinor,
        track_stock: true,
        is_active: d.isActive,
        category_id: null,
      })),
      categories: [],
      updatedAt: 0,
    }
  } catch (err) {
    console.error('[mutopos] getLocalCatalog failed', err)
    return null
  }
}
