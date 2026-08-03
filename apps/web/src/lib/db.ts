import { createStore, type Content, type Store } from 'tinybase'
import { createCustomPersister, type Persister } from 'tinybase/persisters'

import { getItem, setItem, storageBackend } from '@/lib/storage'
import { uuidv4 } from '@/lib/uuid'

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

/** TinyBase table ids (tabular local store). */
export const TABLES = {
  outbox: 'outbox',
  products: 'products',
  sales: 'sales',
  meta: 'meta',
} as const

const DEVICE_KEY_FALLBACK = 'mutopos.device_key'
const STORAGE_KEY = 'mutopos.tinybase.v1'

let store: Store | null = null
let persister: Persister | null = null
let initPromise: Promise<Store> | null = null

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (v == null) return fallback
  return String(v)
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) {
    return Number(v)
  }
  return fallback
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (v === 1 || v === '1' || v === 'true') return true
  if (v === 0 || v === '0' || v === 'false') return false
  return fallback
}

function rowToOutbox(id: string, row: Record<string, unknown>): OutboxDoc {
  const status = asString(row['status'], 'pending') as OutboxDoc['status']
  return {
    id,
    type: asString(row['type']),
    payload: asString(row['payload'], '{}'),
    createdAt: asNumber(row['createdAt']),
    status:
      status === 'in_flight' ||
      status === 'sent' ||
      status === 'failed' ||
      status === 'pending'
        ? status
        : 'pending',
    attempts: asNumber(row['attempts']),
    lastError: asString(row['lastError']) || undefined,
    businessId: asString(row['businessId']),
    resultJson: asString(row['resultJson']) || undefined,
  }
}

function rowToSale(id: string, row: Record<string, unknown>): LocalSaleDoc {
  return {
    id,
    businessId: asString(row['businessId']),
    outletId: asString(row['outletId']),
    clientSaleId: asString(row['clientSaleId'], id),
    status: asString(row['status'], 'completed'),
    totalMinor: asNumber(row['totalMinor']),
    receiptNo: asString(row['receiptNo']) || undefined,
    serverId: asString(row['serverId']) || undefined,
    linesJson: asString(row['linesJson'], '[]'),
    createdAt: asNumber(row['createdAt']),
    synced: asBool(row['synced']),
  }
}

function rowToProduct(
  id: string,
  row: Record<string, unknown>,
): LocalProductDoc {
  return {
    id,
    businessId: asString(row['businessId']),
    name: asString(row['name']),
    sku: asString(row['sku']) || undefined,
    priceMinor: asNumber(row['priceMinor']),
    isActive: asBool(row['isActive'], true),
    updatedAt: asNumber(row['updatedAt']),
  }
}

/**
 * TinyBase persister backed by the Lynx host key/value store.
 *
 * The IndexedDB persister is a browser-only package, so the whole store is
 * serialised to one JSON blob instead. That is fine at POS scale (a cached
 * catalog plus a short outbox), and writes are debounced by TinyBase's own
 * auto-save scheduling.
 */
function createLynxPersister(s: Store): Persister {
  return createCustomPersister(
    s,
    // getPersisted
    async () => {
      'background only'
      const raw = await getItem(STORAGE_KEY)
      if (!raw) return undefined
      try {
        const parsed = JSON.parse(raw) as Content
        if (!Array.isArray(parsed) || parsed.length < 2) return undefined
        return parsed
      } catch (err) {
        console.error('[mutopos] corrupt local store; starting empty', err)
        return undefined
      }
    },
    // setPersisted
    async (getContent) => {
      'background only'
      await setItem(STORAGE_KEY, JSON.stringify(getContent()))
    },
    // addPersisterListener — nothing else writes this key, so no change feed.
    () => undefined,
    // delPersisterListener
    () => undefined,
    (err) => console.error('[mutopos] persister error', err),
  )
}

/**
 * Open the TinyBase store and load it from host storage (auto-save enabled).
 * Safe to call many times; concurrent callers share one init promise.
 */
export async function getStore(): Promise<Store> {
  'background only'
  if (store) return store
  if (!initPromise) {
    initPromise = (async () => {
      const s = createStore()
      try {
        const p = createLynxPersister(s)
        await p.load()
        await p.startAutoSave()
        persister = p
      } catch (err) {
        console.error(
          '[mutopos] local persistence unavailable; in-memory only',
          err,
        )
      }
      store = s
      return s
    })().catch((err) => {
      initPromise = null
      store = null
      persister = null
      throw err
    })
  }
  return initPromise
}

/** @deprecated Prefer typed repository helpers; kept for gradual migration. */
export async function getDb(): Promise<Store> {
  return getStore()
}

export function getStoreSync(): Store | null {
  return store
}

/** Subscribe to any change on a table; returns unsubscribe. */
export function subscribeTable(
  tableId: string,
  listener: () => void,
): () => void {
  let listenerId: string | undefined
  let cancelled = false
  if (store) {
    listenerId = store.addTableListener(tableId, listener)
  } else {
    void getStore().then((s) => {
      if (cancelled) return
      listenerId = s.addTableListener(tableId, listener)
      listener()
    })
  }
  return () => {
    cancelled = true
    if (listenerId && store) store.delListener(listenerId)
  }
}

export async function getOrCreateDeviceKey(): Promise<string> {
  'background only'
  try {
    const s = await getStore()
    const existing = s.getCell(TABLES.meta, 'device_key', 'value')
    if (typeof existing === 'string' && existing) return existing
    const key = uuidv4()
    s.setRow(TABLES.meta, 'device_key', { value: key })
    try {
      await setItem(DEVICE_KEY_FALLBACK, key)
    } catch {
      /* ignore */
    }
    return key
  } catch (err) {
    console.error(
      '[mutopos] TinyBase unavailable; using raw storage device key',
      err,
    )
    try {
      const cached = await getItem(DEVICE_KEY_FALLBACK)
      if (cached) return cached
      const key = uuidv4()
      await setItem(DEVICE_KEY_FALLBACK, key)
      return key
    } catch {
      return uuidv4()
    }
  }
}

export async function enqueueOutbox(entry: {
  id: string
  type: string
  payload: unknown
  businessId: string
}): Promise<void> {
  'background only'
  const s = await getStore()
  s.setRow(TABLES.outbox, entry.id, {
    type: entry.type,
    payload: JSON.stringify(entry.payload),
    createdAt: Date.now(),
    status: 'pending',
    attempts: 0,
    lastError: '',
    businessId: entry.businessId,
    resultJson: '',
  })
}

export async function listOutboxDocs(): Promise<OutboxDoc[]> {
  'background only'
  const s = await getStore()
  const table = s.getTable(TABLES.outbox)
  return Object.entries(table).map(([id, row]) =>
    rowToOutbox(id, row as Record<string, unknown>),
  )
}

export async function listPendingOutbox(
  businessId: string,
): Promise<OutboxDoc[]> {
  'background only'
  const all = await listOutboxDocs()
  return all
    .filter(
      (d) =>
        d.businessId === businessId &&
        (d.status === 'pending' || d.status === 'failed'),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function patchOutbox(
  id: string,
  patch: Partial<
    Pick<
      OutboxDoc,
      'status' | 'attempts' | 'lastError' | 'resultJson' | 'payload' | 'type'
    >
  >,
): Promise<void> {
  'background only'
  const s = await getStore()
  if (!s.hasRow(TABLES.outbox, id)) return
  const cells: Record<string, string | number | boolean> = {}
  if (patch.status !== undefined) cells['status'] = patch.status
  if (patch.attempts !== undefined) cells['attempts'] = patch.attempts
  if (patch.lastError !== undefined) cells['lastError'] = patch.lastError
  if (patch.resultJson !== undefined) cells['resultJson'] = patch.resultJson
  if (patch.payload !== undefined) cells['payload'] = patch.payload
  if (patch.type !== undefined) cells['type'] = patch.type
  if (Object.keys(cells).length) s.setPartialRow(TABLES.outbox, id, cells)
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
  'background only'
  const s = await getStore()
  const now = Date.now()
  for (const p of products) {
    s.setRow(TABLES.products, p.id, {
      businessId,
      name: p.name,
      sku: p.sku ?? '',
      priceMinor: p.price_minor ?? 0,
      isActive: p.is_active,
      updatedAt: now,
    })
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
  'background only'
  const s = await getStore()
  const value = JSON.stringify({
    products,
    categories,
    updatedAt: Date.now(),
  } satisfies CatalogSnapshot)
  s.setRow(TABLES.meta, catalogMetaId(businessId), { value })
  await cacheProducts(businessId, products)
}

export async function getLocalCatalog(
  businessId: string,
): Promise<CatalogSnapshot | null> {
  'background only'
  try {
    const s = await getStore()
    const snap = s.getCell(TABLES.meta, catalogMetaId(businessId), 'value')
    if (typeof snap === 'string' && snap) {
      try {
        const parsed = JSON.parse(snap) as CatalogSnapshot
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
        /* fall through to products table */
      }
    }

    const table = s.getTable(TABLES.products)
    const local = Object.entries(table)
      .map(([id, row]) => rowToProduct(id, row as Record<string, unknown>))
      .filter((d) => d.businessId === businessId)
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

export async function insertLocalSale(
  sale: Omit<LocalSaleDoc, 'receiptNo' | 'serverId'> & {
    receiptNo?: string
    serverId?: string
  },
): Promise<void> {
  'background only'
  const s = await getStore()
  s.setRow(TABLES.sales, sale.id, {
    businessId: sale.businessId,
    outletId: sale.outletId,
    clientSaleId: sale.clientSaleId,
    status: sale.status,
    totalMinor: sale.totalMinor,
    receiptNo: sale.receiptNo ?? '',
    serverId: sale.serverId ?? '',
    linesJson: sale.linesJson,
    createdAt: sale.createdAt,
    synced: sale.synced,
  })
}

export async function patchLocalSale(
  id: string,
  patch: Partial<
    Pick<
      LocalSaleDoc,
      'synced' | 'status' | 'serverId' | 'receiptNo' | 'totalMinor' | 'linesJson'
    >
  >,
): Promise<void> {
  'background only'
  const s = await getStore()
  if (!s.hasRow(TABLES.sales, id)) return
  const cells: Record<string, string | number | boolean> = {}
  if (patch.synced !== undefined) cells['synced'] = patch.synced
  if (patch.status !== undefined) cells['status'] = patch.status
  if (patch.serverId !== undefined) cells['serverId'] = patch.serverId
  if (patch.receiptNo !== undefined) cells['receiptNo'] = patch.receiptNo
  if (patch.totalMinor !== undefined) cells['totalMinor'] = patch.totalMinor
  if (patch.linesJson !== undefined) cells['linesJson'] = patch.linesJson
  if (Object.keys(cells).length) s.setPartialRow(TABLES.sales, id, cells)
}

export async function findLocalSaleByClientId(
  clientSaleId: string,
): Promise<LocalSaleDoc | null> {
  'background only'
  const s = await getStore()
  // Prefer row id === clientSaleId (how we insert).
  if (s.hasRow(TABLES.sales, clientSaleId)) {
    const row = s.getRow(TABLES.sales, clientSaleId)
    return rowToSale(clientSaleId, row as Record<string, unknown>)
  }
  const table = s.getTable(TABLES.sales)
  for (const [id, row] of Object.entries(table)) {
    const doc = rowToSale(id, row as Record<string, unknown>)
    if (doc.clientSaleId === clientSaleId) return doc
  }
  return null
}

export async function listLocalSales(
  businessId: string,
  opts?: { limit?: number },
): Promise<LocalSaleDoc[]> {
  'background only'
  const s = await getStore()
  const table = s.getTable(TABLES.sales)
  const list = Object.entries(table)
    .map(([id, row]) => rowToSale(id, row as Record<string, unknown>))
    .filter((d) => d.businessId === businessId)
    .sort((a, b) => b.createdAt - a.createdAt)
  if (opts?.limit != null) return list.slice(0, opts.limit)
  return list
}

/** Which host storage the local store landed on ('native' | 'session' | 'memory'). */
export { storageBackend }

/** Test / teardown helper — stops auto-save and drops in-memory refs. */
export async function destroyStore(): Promise<void> {
  'background only'
  if (persister) {
    try {
      await persister.destroy()
    } catch {
      /* ignore */
    }
  }
  persister = null
  store = null
  initPromise = null
}
