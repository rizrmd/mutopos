import { NavLink, Outlet } from 'react-router-dom'
import { LayoutGrid, Receipt, ShoppingCart, Store } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/session'
import { subscribeOutbox, type OutboxStats } from '@/lib/outbox'
import { useEffect, useState } from 'react'

const nav = [
  { to: '/', label: 'POS', icon: ShoppingCart, end: true },
  { to: '/catalog', label: 'Catalog', icon: LayoutGrid },
  { to: '/receipts', label: 'Receipts', icon: Receipt },
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

  useEffect(() => subscribeOutbox(setStats), [])

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
              M
            </span>
            MutoPOS
          </div>
          <nav className="flex flex-1 flex-wrap items-center gap-1">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            {(stats?.pending ?? 0) > 0 ? (
              <Badge variant="warning">Outbox {stats?.pending}</Badge>
            ) : (
              <Badge variant="secondary">Outbox clear</Badge>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 border-t px-4 py-2 text-sm">
          <Store className="size-4 text-muted-foreground" />
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Business</span>
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={businessId ?? ''}
              onChange={(e) => setBusinessId(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.business_id} value={m.business_id}>
                  {m.business_name} ({m.role})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Outlet</span>
            <select
              className="h-8 rounded-md border bg-background px-2"
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
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">Staff</span>
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={staffId ?? ''}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="" disabled>
                Select staff
              </option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted-foreground">
            {user?.phone_e164}
            {user?.display_name ? ` · ${user.display_name}` : ''}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
