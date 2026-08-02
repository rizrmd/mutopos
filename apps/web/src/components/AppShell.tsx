import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutGrid,
  Menu,
  Receipt,
  Search,
  ShoppingCart,
} from 'lucide-react'

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

  const isPos = location.pathname === '/'
  const pending = stats?.pending ?? 0

  // Logged-in account identity (Vita: "David Ross") — not the selected staff chip.
  const accountName =
    user?.display_name?.trim() || user?.phone_e164 || 'Account'
  const accountInitials = initials(user?.display_name ?? user?.phone_e164, 'U')

  // Staff picker only when there is a real choice (avoids duplicate "Owner" badge).
  const showStaffPicker = staff.length > 1

  const pageTitle = isPos
    ? 'Menu'
    : location.pathname.startsWith('/catalog')
      ? 'Catalog'
      : 'Receipts'
  const pageSubtitle = isPos
    ? 'Items · tap to order'
    : location.pathname.startsWith('/catalog')
      ? 'Products & categories'
      : 'Sales history'

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      {/* Left sidebar */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150',
          sidebarOpen ? 'w-56' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            className="p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
            aria-label="Collapse sidebar"
          >
            <Menu className="size-4" />
          </button>
          <div className="min-w-0 truncate text-sm font-semibold">
            {businessName}
          </div>
        </div>

        <div className="space-y-2 border-b border-border p-3">
          <select
            className="h-9 w-full border border-border bg-background px-2 text-sm font-medium text-foreground"
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
          <select
            className="h-9 w-full border border-border bg-background px-2 text-sm font-medium text-foreground"
            value={outletId ?? ''}
            onChange={(e) => setOutletId(e.target.value)}
            aria-label="Outlet"
          >
            <option value="" disabled>
              Outlet…
            </option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 pos-scroll">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border px-3 py-3">
          <div className="text-sm font-semibold">MutoPOS</div>
          {pending > 0 ? (
            <p className="mt-1 text-xs font-medium text-amber-800">
              Syncing {pending} change{pending === 1 ? '' : 's'}…
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Synced</p>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Vita-style header:
          [title + subtitle] | [staff chips centered when multi] | [search] [account] [sign out]
          Account = logged-in user only — never re-renders selected staff as a second badge.
        */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
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
            <div className="truncate text-sm font-semibold leading-tight">
              {pageTitle}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {pageSubtitle}
            </div>
          </div>

          {/* Staff chips — only when switching between people is useful */}
          <div className="hidden min-w-0 flex-1 items-center justify-center gap-1.5 overflow-x-auto md:flex pos-scroll">
            {showStaffPicker
              ? staff.map((s, i) => {
                  const active = s.id === staffId
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStaffId(s.id)}
                      className={cn(
                        'ui-pill inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'border-violet-200 bg-violet-50 text-violet-900'
                          : 'border-transparent bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'ui-avatar flex size-5 items-center justify-center text-[10px] font-semibold',
                          avatarTints[i % avatarTints.length],
                        )}
                      >
                        {initials(s.display_name)}
                      </span>
                      {s.display_name}
                    </button>
                  )
                })
              : null}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {isPos ? (
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="h-9 w-40 border-border bg-muted/40 pl-8 text-sm lg:w-52"
                />
              </div>
            ) : null}

            {/* Account identity only — not selected staff */}
            <div className="ui-pill hidden items-center gap-2 border border-border bg-background px-2.5 py-1 sm:flex">
              <div className="text-right leading-tight">
                <div className="text-xs font-semibold">{accountName}</div>
                <div className="text-[10px] text-muted-foreground">Signed in</div>
              </div>
              <span className="ui-avatar flex size-8 items-center justify-center bg-violet-100 text-xs font-semibold text-violet-800">
                {accountInitials}
              </span>
            </div>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground"
              onClick={() => void logout()}
            >
              Sign out
            </Button>
          </div>
        </header>

        <main
          className={cn(
            'min-h-0 flex-1',
            isPos ? 'overflow-hidden' : 'overflow-y-auto pos-scroll p-4 md:p-5',
          )}
        >
          <Outlet context={{ search, setSearch }} />
        </main>
      </div>
    </div>
  )
}
