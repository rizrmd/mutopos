import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutGrid,
  Menu,
  Receipt,
  Search,
  ShoppingCart,
  Wifi,
  WifiOff,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { subscribeOutbox, type OutboxStats } from '@/lib/outbox'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/', label: 'POS', icon: ShoppingCart, end: true },
  { to: '/catalog', label: 'Catalog', icon: LayoutGrid },
  { to: '/receipts', label: 'Receipts', icon: Receipt },
]

function initials(name: string | null | undefined, fallback = '?') {
  if (!name?.trim()) return fallback
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const avatarTints = [
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-amber-100 text-amber-900',
  'bg-rose-100 text-rose-800',
  'bg-emerald-100 text-emerald-800',
  'bg-orange-100 text-orange-900',
]

export function AppShell() {
  const {
    user,
    memberships,
    businessId,
    outletId,
    staffId,
    outlets,
    staff,
    setBusinessId,
    setOutletId,
    setStaffId,
    logout,
  } = useSession()
  const [stats, setStats] = useState<OutboxStats | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')
  const location = useLocation()

  useEffect(() => subscribeOutbox(setStats), [])

  const businessName = useMemo(
    () =>
      memberships.find((m) => m.business_id === businessId)?.business_name ??
      'MutoPOS',
    [memberships, businessId],
  )

  const activeStaff = staff.find((s) => s.id === staffId)
  const clockLabel = useMemo(() => {
    const d = new Date()
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }, [location.pathname])

  const isPos = location.pathname === '/'

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      {/* Left sidebar — Vita menus rail */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200',
          sidebarOpen ? 'w-[15.5rem]' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <div className="flex items-start gap-2 border-b border-border px-4 py-4">
          <button
            type="button"
            className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-muted"
            onClick={() => setSidebarOpen(false)}
            aria-label="Collapse sidebar"
          >
            <Menu className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">
              {businessName}
            </div>
            <div className="text-xs text-muted-foreground">Inventory · POS</div>
          </div>
        </div>

        <div className="border-b border-border px-3 py-3 space-y-2">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Business
          </label>
          <select
            className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            value={businessId ?? ''}
            onChange={(e) => setBusinessId(e.target.value)}
          >
            {memberships.map((m) => (
              <option key={m.business_id} value={m.business_id}>
                {m.business_name}
              </option>
            ))}
          </select>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Outlet
          </label>
          <select
            className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            value={outletId ?? ''}
            onChange={(e) => setOutletId(e.target.value)}
          >
            <option value="" disabled>
              Select outlet
            </option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Menus
          </span>
          <span className="text-xs text-muted-foreground">{nav.length} areas</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pos-scroll">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100'
                    : 'text-sidebar-foreground/80 hover:bg-muted',
                )
              }
            >
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-lg text-xs font-semibold',
                  to === '/'
                    ? 'bg-emerald-100 text-emerald-800'
                    : to === '/catalog'
                      ? 'bg-violet-100 text-violet-800'
                      : 'bg-sky-100 text-sky-800',
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="flex-1">{label}</span>
              {to === '/' ? (
                <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Online
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-border px-4 py-4">
          <div className="text-sm font-semibold tracking-tight">
            Muto<span className="font-normal text-muted-foreground"> POS</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Offline-first hospitality POS · RxDB outbox
          </p>
          <div className="mt-3 flex items-center gap-2">
            {(stats?.pending ?? 0) > 0 ? (
              <Badge variant="warning" className="text-[10px]">
                Outbox {stats?.pending}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                Outbox clear
              </Badge>
            )}
            {stats?.online ? (
              <Badge variant="success" className="gap-1 text-[10px]">
                <Wifi className="size-3" /> Live
              </Badge>
            ) : (
              <Badge variant="warning" className="gap-1 text-[10px]">
                <WifiOff className="size-3" /> Offline
              </Badge>
            )}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur">
          {!sidebarOpen ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu className="size-4" />
            </Button>
          ) : null}

          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {isPos ? 'À la carte' : location.pathname === '/catalog' ? 'Catalog' : 'Receipts'}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {isPos ? 'Items · tap to order' : 'Manage your business'}
            </div>
          </div>

          {/* Staff chips */}
          <div className="ml-2 hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto md:flex pos-scroll">
            {staff.map((s, i) => {
              const active = s.id === staffId
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStaffId(s.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-violet-200 bg-violet-50 text-violet-900'
                      : 'border-transparent bg-muted/80 text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold',
                      avatarTints[i % avatarTints.length],
                    )}
                  >
                    {initials(s.display_name)}
                  </span>
                  {s.display_name}
                </button>
              )
            })}
            {staff.length === 0 ? (
              <span className="text-xs text-muted-foreground">No staff yet</span>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {isPos ? (
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items…"
                  className="h-9 w-44 rounded-full border-border bg-muted/50 pl-8 text-sm lg:w-56"
                  data-pos-search
                />
              </div>
            ) : null}

            <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 sm:flex">
              <div className="text-right leading-tight">
                <div className="text-xs font-semibold">
                  {activeStaff?.display_name ??
                    user?.display_name ??
                    user?.phone_e164 ??
                    'Staff'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Clocked in {clockLabel}
                </div>
              </div>
              <span className="flex size-8 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-800">
                {initials(
                  activeStaff?.display_name ?? user?.display_name,
                  'U',
                )}
              </span>
            </div>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => void logout()}
            >
              Sign out
            </Button>
          </div>
        </header>

        {/* Page body — full height for POS */}
        <main
          className={cn(
            'min-h-0 flex-1',
            isPos ? 'overflow-hidden' : 'overflow-y-auto pos-scroll p-4 md:p-6',
          )}
        >
          <Outlet context={{ search, setSearch }} />
        </main>
      </div>
    </div>
  )
}
