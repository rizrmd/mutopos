import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, Plus, Search, Wifi, WifiOff, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { subscribeOutbox, type OutboxStats } from '@/lib/outbox'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const nav = [
  {
    to: '/',
    label: 'À la carte',
    end: true,
    tint: 'bg-emerald-100 text-emerald-800',
    letter: 'À',
  },
  {
    to: '/catalog',
    label: 'Catalog',
    tint: 'bg-violet-100 text-violet-800',
    letter: 'C',
  },
  {
    to: '/receipts',
    label: 'Receipts',
    tint: 'bg-sky-100 text-sky-800',
    letter: 'R',
  },
]

const avatarTints = [
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-amber-100 text-amber-900',
  'bg-rose-100 text-rose-800',
  'bg-emerald-100 text-emerald-800',
  'bg-orange-100 text-orange-900',
]

function initials(name: string | null | undefined, fallback = '?') {
  if (!name?.trim()) return fallback
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const location = useLocation()

  useEffect(() => subscribeOutbox(setStats), [])

  const businessName = useMemo(
    () =>
      memberships.find((m) => m.business_id === businessId)?.business_name ??
      'MutoPOS',
    [memberships, businessId],
  )

  const floorStaff = useMemo(() => {
    const cashiers = staff.filter((s) => s.role === 'cashier')
    if (cashiers.length > 0) return cashiers
    return staff
  }, [staff])

  const isPos = location.pathname === '/'
  const clockLabel = useMemo(
    () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    [location.pathname],
  )

  const accountName =
    user?.display_name?.trim() || user?.phone_e164 || 'Account'
  const accountInitials = initials(user?.display_name ?? user?.phone_e164, 'U')

  const pageTitle = isPos
    ? 'À la carte'
    : location.pathname.startsWith('/catalog')
      ? 'Catalog'
      : 'Receipts'
  const pageSubtitle = isPos
    ? 'Items'
    : location.pathname.startsWith('/catalog')
      ? 'Products & categories'
      : 'Sales history'

  const outletName =
    outlets.find((o) => o.id === outletId)?.name ?? 'All rooms'
  const online = stats?.online !== false

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      {/* Left sidebar — Vita menus rail */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200',
          sidebarOpen ? 'w-[15rem]' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <div className="flex items-start gap-2.5 px-3.5 pb-3 pt-4">
          <button
            type="button"
            className="mt-0.5 rounded-none p-1 text-muted-foreground hover:bg-muted"
            onClick={() => setSidebarOpen(false)}
            aria-label="Collapse sidebar"
          >
            <Menu className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-tight">
              {businessName}
            </div>
            <div className="text-[11px] text-muted-foreground">Inventory</div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 pb-2 pt-1">
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-foreground">Menus</div>
            <div className="text-[11px] text-muted-foreground">
              {nav.length} menus
            </div>
          </div>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-none border border-border text-muted-foreground hover:bg-muted"
            aria-label="Add menu"
            title="Business / outlet scope"
            onClick={() => setScopeOpen((v) => !v)}
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {scopeOpen ? (
          <div className="mx-2 mb-2 space-y-2 rounded-none border border-border bg-card p-2.5">
            <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Business
            </label>
            <select
              className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs"
              value={businessId ?? ''}
              onChange={(e) => setBusinessId(e.target.value)}
              aria-label="Business"
            >
              {memberships.map((m) => (
                <option key={m.business_id} value={m.business_id}>
                  {m.business_name}
                </option>
              ))}
            </select>
            <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Outlet
            </label>
            <select
              className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs"
              value={outletId ?? ''}
              onChange={(e) => setOutletId(e.target.value)}
              aria-label="Outlet"
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
        ) : null}

        <nav className="flex-1 space-y-1.5 overflow-y-auto px-2 pos-scroll">
          {nav.map(({ to, label, tint, letter, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-2.5 rounded-none px-2.5 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-emerald-100/90 font-semibold text-emerald-950 shadow-sm ring-2 ring-emerald-500/55'
                    : 'hover:bg-muted/70',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-1 bg-emerald-600"
                    />
                  ) : null}
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-none text-xs font-semibold',
                      tint,
                      isActive && 'ring-1 ring-emerald-600/30',
                    )}
                  >
                    {letter}
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div
                      className={cn(
                        'truncate text-[13px]',
                        isActive ? 'font-bold' : 'font-medium',
                      )}
                    >
                      {label}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      {to === '/' ? (
                        <>
                          <span
                            className={cn(
                              'size-1.5 rounded-none',
                              online ? 'bg-emerald-500' : 'bg-amber-500',
                            )}
                          />
                          <span
                            className={
                              online ? 'text-emerald-700' : 'text-amber-700'
                            }
                          >
                            {online ? 'Online' : 'Offline'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="size-1.5 rounded-none bg-muted-foreground/40" />
                          <span>Offline</span>
                        </>
                      )}
                      <span className="text-muted-foreground/50">→</span>
                      <span className="truncate">{outletName}</span>
                    </div>
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-border px-4 py-4">
          <div className="text-sm font-semibold tracking-tight">
            Muto<span className="font-normal text-muted-foreground"> POS</span>
          </div>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            Help · Support · Legal
          </p>
          <div className="mt-2.5 flex items-center gap-1.5">
            {(stats?.pending ?? 0) > 0 ? (
              <Badge variant="warning" className="text-[10px]">
                Outbox {stats?.pending}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                Synced
              </Badge>
            )}
            {stats?.online === false ? (
              <Badge variant="warning" className="gap-1 text-[10px]">
                <WifiOff className="size-3" /> Offline
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1 text-[10px]">
                <Wifi className="size-3" /> Live
              </Badge>
            )}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[3.25rem] shrink-0 items-center gap-3 border-b border-border bg-card px-4">
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

          <div className="min-w-0 shrink-0">
            <div className="truncate text-[15px] font-semibold leading-tight tracking-tight">
              {pageTitle}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {pageSubtitle}
            </div>
          </div>

          {/* Staff chips — compact Vita style */}
          <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto md:flex pos-scroll">
            {floorStaff.map((s, i) => {
              const active = s.id === staffId
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStaffId(s.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-none py-1 pl-1 pr-2.5 text-xs transition-colors',
                    active
                      ? 'bg-violet-200 font-bold text-violet-950 shadow-sm ring-2 ring-violet-500/60'
                      : 'bg-transparent font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-none text-[10px] font-semibold',
                      avatarTints[i % avatarTints.length],
                      active && 'ring-1 ring-violet-600/40',
                    )}
                  >
                    {initials(s.display_name).slice(0, 1)}
                  </span>
                  {shortName(s.display_name)}
                </button>
              )
            })}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {isPos ? (
              searchOpen ? (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onBlur={() => {
                      if (!search) setSearchOpen(false)
                    }}
                    placeholder="Search items…"
                    className="h-9 w-44 rounded-none border-border bg-muted/40 pl-8 pr-8 text-sm"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setSearch('')
                      setSearchOpen(false)
                    }}
                    aria-label="Close search"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9 rounded-none text-muted-foreground"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search items"
                >
                  <Search className="size-4" />
                </Button>
              )
            ) : null}

            <button
              type="button"
              onClick={() => void logout()}
              className="hidden items-center gap-2 rounded-none py-1 pl-2 pr-1 sm:flex"
              title="Sign out"
            >
              <div className="text-right leading-tight">
                <div className="text-xs font-semibold">{accountName}</div>
                <div className="text-[10px] text-muted-foreground">
                  Clocked in {clockLabel}
                </div>
              </div>
              <span className="flex size-8 items-center justify-center rounded-none bg-violet-100 text-xs font-semibold text-violet-800">
                {accountInitials.slice(0, 1)}
              </span>
            </button>
          </div>
        </header>

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
