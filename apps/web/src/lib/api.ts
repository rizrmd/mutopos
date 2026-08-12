import { markReachable, markUnreachable } from '@/lib/net'

/**
 * Absolute API origin.
 *
 * Priority:
 * 1. `__API_BASE__` from `MUTOPOS_API_BASE` or public sandbox origin at build time
 *    (LynxExplorer / device — including Fural `https://$FURAL_SANDBOX_DOMAIN`)
 * 2. `lynx.__globalProps.mutoposApiBase` injected by the web shell (`location.origin`)
 * 3. Fallback `http://127.0.0.1:8080` for local simulators
 *
 * Empty build-time base + same-origin proxy works for the browser shell; native
 * LynxExplorer needs an absolute origin reachable from the phone (public HTTPS
 * when the dev server is a remote Fural sandbox, LAN IP when on the same Wi‑Fi).
 */
function resolveApiBase(): string {
  const baked = (typeof __API_BASE__ === 'string' ? __API_BASE__ : '').replace(
    /\/+$/,
    '',
  )
  if (baked) return baked
  try {
    const lynx = (
      globalThis as unknown as {
        lynx?: { __globalProps?: { mutoposApiBase?: string } }
      }
    ).lynx
    const fromHost = lynx?.__globalProps?.mutoposApiBase
    if (typeof fromHost === 'string' && fromHost) {
      return fromHost.replace(/\/+$/, '')
    }
  } catch {
    /* host has no globalProps yet */
  }
  return 'http://127.0.0.1:8080'
}

export type Membership = {
  business_id: string
  business_name: string
  role: string
  currency_code: string
  timezone: string
}

export type User = {
  id: string
  phone_e164: string
  display_name?: string | null
}

export type Product = {
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
}

export type Outlet = {
  id: string
  name: string
  code?: string | null
  is_active: boolean
}

export type Staff = {
  id: string
  display_name: string
  role: string
  status: string
  /** True when a passcode is configured (PIN never returned). */
  has_pin?: boolean
}

export type Category = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

export type Sale = {
  id: string
  outlet_id: string
  staff_id?: string | null
  status: string
  client_sale_id: string
  receipt_no?: string | null
  subtotal_minor: number
  discount_minor: number
  tax_minor: number
  total_minor: number
  currency_code: string
  note?: string | null
  completed_at?: string | null
  created_at: string
  lines?: SaleLine[]
  payments?: Payment[]
}

export type SaleLine = {
  id?: string
  product_id?: string | null
  line_no?: number
  sku_snapshot?: string | null
  name_snapshot: string
  qty: number
  unit_price_minor: number
  discount_minor?: number
  line_total_minor: number
}

export type Payment = {
  id?: string
  method: string
  amount_minor: number
  reference?: string | null
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export type TenantHeaders = {
  token: string
  businessId: string
  outletId?: string | null
  staffId?: string | null
  deviceKey?: string | null
}

type RequestOptions = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/**
 * Single entry point to Lynx's fetch.
 *
 * Two reasons this exists rather than calling `fetch` at each call site:
 * connectivity has to be inferred here (see `lib/net`), and Lynx's fetch
 * silently swallows unhandled rejections, so every failure must be caught and
 * re-thrown as something typed.
 */
async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  'background only'
  let res: Response
  try {
    const base = resolveApiBase()
    const url = path.startsWith('http')
      ? path
      : `${base}${path.startsWith('/') ? path : `/${path}`}`
    res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
    })
  } catch (err) {
    markUnreachable()
    throw new ApiError(
      0,
      'network_error',
      err instanceof Error ? err.message : 'Network unreachable',
    )
  }

  markReachable()

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { message: text }
  }
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; message?: string }
    throw new ApiError(
      res.status,
      obj.error ?? 'error',
      obj.message ?? `HTTP ${res.status}`,
    )
  }
  return data as T
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function tenantHeaders(t: TenantHeaders): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${t.token}`,
    'X-Business-Id': t.businessId,
  }
  if (t.outletId) h['X-Outlet-Id'] = t.outletId
  if (t.staffId) h['X-Staff-Id'] = t.staffId
  if (t.deviceKey) h['X-Device-Key'] = t.deviceKey
  return h
}

function tenantJson(t: TenantHeaders): Record<string, string> {
  return { ...tenantHeaders(t), ...JSON_HEADERS }
}

export const api = {
  /**
   * Cheap unauthenticated reachability probe.
   *
   * Nothing else re-checks the API once it goes away: without
   * `navigator.onLine` the only connectivity signal is traffic, and an idle
   * register with an empty outbox generates none. The outbox worker calls this
   * so the Online/Offline badge recovers on its own.
   */
  async health(): Promise<boolean> {
    'background only'
    try {
      await request<unknown>('/healthz')
      return true
    } catch (err) {
      // A reachable server answering 4xx/5xx still counts as online; only a
      // transport failure means offline, and `request` already recorded it.
      return err instanceof ApiError && err.status > 0
    }
  },

  async requestOTP(phone_e164: string) {
    'background only'
    return request<{
      challenge_id: string
      phone_e164: string
      dev_code?: string
      stub?: boolean
      expires_at: string
    }>('/v1/auth/otp/request', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phone_e164 }),
    })
  },

  async verifyOTP(phone_e164: string, code: string, display_name?: string) {
    'background only'
    return request<{
      access_token: string
      expires_at: string
      user: User
      bootstrap?: {
        business_id: string
        outlet_id: string
        staff_id: string
        name: string
      } | null
    }>('/v1/auth/otp/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ phone_e164, code, display_name }),
    })
  },

  async me(token: string) {
    'background only'
    return request<{ user: User; memberships: Membership[] }>('/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async logout(token: string) {
    'background only'
    await request<unknown>('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async listOutlets(t: TenantHeaders) {
    'background only'
    return request<{ outlets: Outlet[] }>('/v1/outlets', {
      headers: tenantHeaders(t),
    })
  },

  async listStaff(t: TenantHeaders) {
    'background only'
    return request<{ staff: Staff[] }>('/v1/staff', {
      headers: tenantHeaders(t),
    })
  },

  /** Square-style team passcode clock-in. */
  async staffLogin(t: TenantHeaders, staff_id: string, pin: string) {
    'background only'
    return request<{
      ok: boolean
      staff_id: string
      display_name: string
      role: string
    }>('/v1/staff/login', {
      method: 'POST',
      headers: tenantJson(t),
      body: JSON.stringify({ staff_id, pin }),
    })
  },

  async setStaffPin(
    t: TenantHeaders,
    staffId: string,
    pin: string,
    current_pin?: string,
  ) {
    'background only'
    return request<{ ok: boolean; id: string; has_pin: boolean }>(
      `/v1/staff/${staffId}/pin`,
      {
        method: 'POST',
        headers: tenantJson(t),
        body: JSON.stringify({
          pin,
          ...(current_pin ? { current_pin } : {}),
        }),
      },
    )
  },

  async listCategories(t: TenantHeaders) {
    'background only'
    return request<{ categories: Category[] }>('/v1/categories', {
      headers: tenantHeaders(t),
    })
  },

  async createCategory(t: TenantHeaders, name: string) {
    'background only'
    return request<{ id: string; name: string }>('/v1/categories', {
      method: 'POST',
      headers: tenantJson(t),
      body: JSON.stringify({ name }),
    })
  },

  async listProducts(t: TenantHeaders) {
    'background only'
    return request<{ products: Product[] }>('/v1/products', {
      headers: tenantHeaders(t),
    })
  },

  async createProduct(
    t: TenantHeaders,
    body: {
      name: string
      sku?: string
      price_minor: number
      category_id?: string
      unit?: string
    },
  ) {
    'background only'
    return request<{ id: string; name: string; price_minor?: number }>(
      '/v1/products',
      {
        method: 'POST',
        headers: tenantJson(t),
        body: JSON.stringify(body),
      },
    )
  },

  async patchProduct(
    t: TenantHeaders,
    id: string,
    body: Partial<{
      name: string
      price_minor: number
      is_active: boolean
      sku: string
    }>,
  ) {
    'background only'
    return request<{ id: string; ok: boolean }>(`/v1/products/${id}`, {
      method: 'PATCH',
      headers: tenantJson(t),
      body: JSON.stringify(body),
    })
  },

  async listSales(t: TenantHeaders) {
    'background only'
    return request<{ sales: Sale[] }>('/v1/sales', {
      headers: tenantHeaders(t),
    })
  },

  async getSale(t: TenantHeaders, id: string) {
    'background only'
    return request<Sale>(`/v1/sales/${id}`, { headers: tenantHeaders(t) })
  },

  async completeSaleOnline(
    t: TenantHeaders,
    body: {
      client_sale_id: string
      outlet_id: string
      staff_id?: string
      lines: SaleLine[]
      payments: Payment[]
      subtotal_minor: number
      total_minor: number
      currency_code?: string
      note?: string
    },
  ) {
    'background only'
    return request<Sale>('/v1/sales/complete', {
      method: 'POST',
      headers: tenantJson(t),
      body: JSON.stringify(body),
    })
  },

  async registerDevice(
    t: TenantHeaders,
    body: { device_key: string; label?: string; outlet_id?: string },
  ) {
    'background only'
    return request<{ id: string; device_key: string }>('/v1/devices', {
      method: 'POST',
      headers: tenantJson(t),
      body: JSON.stringify(body),
    })
  },

  async pushCommand(
    t: TenantHeaders,
    body: {
      command_id: string
      command_type: string
      command_version?: number
      payload: unknown
    },
  ) {
    'background only'
    return request<{
      command_id: string
      status: string
      result?: unknown
      idempotent_replay?: boolean
      error?: string
      message?: string
    }>('/v1/commands', {
      method: 'POST',
      headers: tenantJson(t),
      body: JSON.stringify(body),
    })
  },

  /** Fill the daytime demo catalog + floor staff when the tenant is empty. */
  async seedDemo(t: TenantHeaders) {
    'background only'
    return request<{
      ok: boolean
      demo?: {
        catalog_seeded?: boolean
        staff_added?: number
        business?: string
      }
    }>('/v1/demo/seed', {
      method: 'POST',
      headers: tenantHeaders(t),
    })
  },
}

export { formatIDR, formatMoney } from '@/lib/format'
