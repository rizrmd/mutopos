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

const outboxSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 64 },
    type: { type: 'string' },
    payload: { type: 'string' },
    createdAt: { type: 'number' },
    status: { type: 'string' },
    attempts: { type: 'number' },
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
    updatedAt: { type: 'number' },
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
    status: { type: 'string' },
    totalMinor: { type: 'number' },
    receiptNo: { type: 'string' },
    serverId: { type: 'string' },
    linesJson: { type: 'string' },
    createdAt: { type: 'number' },
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
      const db = await createRxDatabase<Collections>({
        name: 'mutopos',
        storage,
        ignoreDuplicate: true,
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
    })()
  }
  return dbPromise
}

export async function getOrCreateDeviceKey(): Promise<string> {
  const db = await getDb()
  const existing = await db.meta.findOne('device_key').exec()
  if (existing) return existing.value
  const key =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Date.now()}`
  await db.meta.insert({ id: 'device_key', value: key })
  return key
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
