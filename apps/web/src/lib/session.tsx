import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  api,
  type Membership,
  type Outlet,
  type Staff,
  type TenantHeaders,
  type User,
} from '@/lib/api'
import { getOrCreateDeviceKey } from '@/lib/db'
import { startOutboxWorker, stopOutboxWorker } from '@/lib/outbox'

const STORAGE_KEY = 'mutopos.session.v1'

type StoredSession = {
  token: string
  user: User
  memberships: Membership[]
  businessId?: string
  outletId?: string
  staffId?: string
}

type SessionContextValue = {
  ready: boolean
  token: string | null
  user: User | null
  memberships: Membership[]
  businessId: string | null
  outletId: string | null
  staffId: string | null
  outlets: Outlet[]
  staff: Staff[]
  deviceKey: string | null
  tenant: TenantHeaders | null
  setBusinessId: (id: string) => void
  setOutletId: (id: string) => void
  setStaffId: (id: string) => void
  loginWithOTP: (
    phone: string,
    code: string,
    displayName?: string,
  ) => Promise<void>
  requestOTP: (phone: string) => Promise<{ dev_code?: string }>
  logout: () => Promise<void>
  refreshTenantData: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function loadStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

function saveStored(s: StoredSession | null) {
  if (!s) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [businessId, setBusinessIdState] = useState<string | null>(null)
  const [outletId, setOutletIdState] = useState<string | null>(null)
  const [staffId, setStaffIdState] = useState<string | null>(null)
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [deviceKey, setDeviceKey] = useState<string | null>(null)

  const persist = useCallback(
    (partial: Partial<StoredSession> & { token: string; user: User }) => {
      const next: StoredSession = {
        token: partial.token,
        user: partial.user,
        memberships: partial.memberships ?? memberships,
        businessId: partial.businessId ?? businessId ?? undefined,
        outletId: partial.outletId ?? outletId ?? undefined,
        staffId: partial.staffId ?? staffId ?? undefined,
      }
      saveStored(next)
    },
    [memberships, businessId, outletId, staffId],
  )

  const tenant = useMemo<TenantHeaders | null>(() => {
    if (!token || !businessId) return null
    return {
      token,
      businessId,
      outletId,
      staffId,
      deviceKey,
    }
  }, [token, businessId, outletId, staffId, deviceKey])

  const refreshTenantData = useCallback(async () => {
    if (!token || !businessId) return
    const t: TenantHeaders = {
      token,
      businessId,
      outletId,
      staffId,
      deviceKey,
    }
    const [o, s] = await Promise.all([api.listOutlets(t), api.listStaff(t)])
    setOutlets(o.outlets)
    setStaff(s.staff)
    if (!outletId && o.outlets[0]) {
      setOutletIdState(o.outlets[0].id)
    }
    if (!staffId && s.staff[0]) {
      setStaffIdState(s.staff[0].id)
    }
    if (deviceKey) {
      try {
        await api.registerDevice(t, {
          device_key: deviceKey,
          label: 'Web POS',
          outlet_id: outletId ?? o.outlets[0]?.id,
        })
      } catch {
        // non-fatal
      }
    }
  }, [token, businessId, outletId, staffId, deviceKey])

  useEffect(() => {
    void (async () => {
      // Always leave the loading gate, even if RxDB or /me fails.
      try {
        const key = await getOrCreateDeviceKey()
        setDeviceKey(key)
        const stored = loadStored()
        if (stored?.token) {
          try {
            const me = await api.me(stored.token)
            setToken(stored.token)
            setUser(me.user)
            setMemberships(me.memberships)
            const biz =
              stored.businessId &&
              me.memberships.some((m) => m.business_id === stored.businessId)
                ? stored.businessId
                : me.memberships[0]?.business_id
            setBusinessIdState(biz ?? null)
            setOutletIdState(stored.outletId ?? null)
            setStaffIdState(stored.staffId ?? null)
            saveStored({
              token: stored.token,
              user: me.user,
              memberships: me.memberships,
              businessId: biz,
              outletId: stored.outletId,
              staffId: stored.staffId,
            })
          } catch {
            saveStored(null)
          }
        }
      } catch (err) {
        console.error('[mutopos] session bootstrap failed', err)
      } finally {
        setReady(true)
      }
    })()
  }, [])

  useEffect(() => {
    if (token && businessId) {
      void refreshTenantData()
    }
  }, [token, businessId, refreshTenantData])

  useEffect(() => {
    startOutboxWorker(() => {
      if (!token || !businessId) return null
      return {
        token,
        businessId,
        outletId,
        staffId,
        deviceKey,
      }
    })
    return () => stopOutboxWorker()
  }, [token, businessId, outletId, staffId, deviceKey])

  const requestOTP = useCallback(async (phone: string) => {
    const res = await api.requestOTP(phone)
    return { dev_code: res.dev_code }
  }, [])

  const loginWithOTP = useCallback(
    async (phone: string, code: string, displayName?: string) => {
      const res = await api.verifyOTP(phone, code, displayName)
      const me = await api.me(res.access_token)
      const biz =
        res.bootstrap?.business_id ?? me.memberships[0]?.business_id ?? null
      setToken(res.access_token)
      setUser(res.user)
      setMemberships(me.memberships)
      setBusinessIdState(biz)
      if (res.bootstrap?.outlet_id) setOutletIdState(res.bootstrap.outlet_id)
      if (res.bootstrap?.staff_id) setStaffIdState(res.bootstrap.staff_id)
      saveStored({
        token: res.access_token,
        user: res.user,
        memberships: me.memberships,
        businessId: biz ?? undefined,
        outletId: res.bootstrap?.outlet_id,
        staffId: res.bootstrap?.staff_id,
      })
    },
    [],
  )

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.logout(token)
      } catch {
        /* ignore */
      }
    }
    setToken(null)
    setUser(null)
    setMemberships([])
    setBusinessIdState(null)
    setOutletIdState(null)
    setStaffIdState(null)
    setOutlets([])
    setStaff([])
    saveStored(null)
  }, [token])

  const setBusinessId = useCallback(
    (id: string) => {
      setBusinessIdState(id)
      setOutletIdState(null)
      setStaffIdState(null)
      if (token && user) {
        persist({
          token,
          user,
          memberships,
          businessId: id,
          outletId: undefined,
          staffId: undefined,
        })
      }
    },
    [token, user, memberships, persist],
  )

  const setOutletId = useCallback(
    (id: string) => {
      setOutletIdState(id)
      if (token && user) {
        persist({ token, user, memberships, businessId: businessId ?? undefined, outletId: id, staffId: staffId ?? undefined })
      }
    },
    [token, user, memberships, businessId, staffId, persist],
  )

  const setStaffId = useCallback(
    (id: string) => {
      setStaffIdState(id)
      if (token && user) {
        persist({ token, user, memberships, businessId: businessId ?? undefined, outletId: outletId ?? undefined, staffId: id })
      }
    },
    [token, user, memberships, businessId, outletId, persist],
  )

  const value: SessionContextValue = {
    ready,
    token,
    user,
    memberships,
    businessId,
    outletId,
    staffId,
    outlets,
    staff,
    deviceKey,
    tenant,
    setBusinessId,
    setOutletId,
    setStaffId,
    loginWithOTP,
    requestOTP,
    logout,
    refreshTenantData,
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside provider')
  return ctx
}
