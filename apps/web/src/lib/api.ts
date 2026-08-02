const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

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

async function parse<T>(res: Response): Promise<T> {
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
      obj.message ?? res.statusText,
    )
  }
  return data as T
}

function tenantHeaders(t: TenantHeaders): HeadersInit {
  const h: Record<string, string> = {
    Authorization: `Bearer ${t.token}`,
    'X-Business-Id': t.businessId,
  }
  if (t.outletId) h['X-Outlet-Id'] = t.outletId
  if (t.staffId) h['X-Staff-Id'] = t.staffId
  if (t.deviceKey) h['X-Device-Key'] = t.deviceKey
  return h
}

export const api = {
  async requestOTP(phone_e164: string) {
    const res = await fetch(`${API_BASE}/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_e164 }),
    })
    return parse<{
      challenge_id: string
      phone_e164: string
      dev_code?: string
      stub?: boolean
      expires_at: string
    }>(res)
  },

  async verifyOTP(phone_e164: string, code: string, display_name?: string) {
    const res = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_e164, code, display_name }),
    })
    return parse<{
      access_token: string
      expires_at: string
      user: User
      bootstrap?: {
        business_id: string
        outlet_id: string
        staff_id: string
        name: string
      } | null
    }>(res)
  },

  async me(token: string) {
    const res = await fetch(`${API_BASE}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return parse<{ user: User; memberships: Membership[] }>(res)
  },

  async logout(token: string) {
    await fetch(`${API_BASE}/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async listOutlets(t: TenantHeaders) {
    const res = await fetch(`${API_BASE}/v1/outlets`, {
      headers: tenantHeaders(t),
    })
    return parse<{ outlets: Outlet[] }>(res)
  },

  async listStaff(t: TenantHeaders) {
    const res = await fetch(`${API_BASE}/v1/staff`, {
      headers: tenantHeaders(t),
    })
    return parse<{ staff: Staff[] }>(res)
  },

  async listCategories(t: TenantHeaders) {
    const res = await fetch(`${API_BASE}/v1/categories`, {
      headers: tenantHeaders(t),
    })
    return parse<{ categories: Category[] }>(res)
  },

  async createCategory(t: TenantHeaders, name: string) {
    const res = await fetch(`${API_BASE}/v1/categories`, {
      method: 'POST',
      headers: { ...tenantHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return parse<{ id: string; name: string }>(res)
  },

  async listProducts(t: TenantHeaders) {
    const res = await fetch(`${API_BASE}/v1/products`, {
      headers: tenantHeaders(t),
    })
    return parse<{ products: Product[] }>(res)
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
    const res = await fetch(`${API_BASE}/v1/products`, {
      method: 'POST',
      headers: { ...tenantHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return parse<{ id: string; name: string; price_minor?: number }>(res)
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
    const res = await fetch(`${API_BASE}/v1/products/${id}`, {
      method: 'PATCH',
      headers: { ...tenantHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return parse<{ id: string; ok: boolean }>(res)
  },

  async listSales(t: TenantHeaders) {
    const res = await fetch(`${API_BASE}/v1/sales`, {
      headers: tenantHeaders(t),
    })
    return parse<{ sales: Sale[] }>(res)
  },

  async getSale(t: TenantHeaders, id: string) {
    const res = await fetch(`${API_BASE}/v1/sales/${id}`, {
      headers: tenantHeaders(t),
    })
    return parse<Sale>(res)
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
    const res = await fetch(`${API_BASE}/v1/sales/complete`, {
      method: 'POST',
      headers: { ...tenantHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return parse<Sale>(res)
  },

  async registerDevice(
    t: TenantHeaders,
    body: { device_key: string; label?: string; outlet_id?: string },
  ) {
    const res = await fetch(`${API_BASE}/v1/devices`, {
      method: 'POST',
      headers: { ...tenantHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return parse<{ id: string; device_key: string }>(res)
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
    const res = await fetch(`${API_BASE}/v1/commands`, {
      method: 'POST',
      headers: { ...tenantHeaders(t), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return parse<{
      command_id: string
      status: string
      result?: unknown
      idempotent_replay?: boolean
      error?: string
      message?: string
    }>(res)
  },
}

export function formatIDR(minor: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(minor)
}
