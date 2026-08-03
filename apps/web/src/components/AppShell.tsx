import { useCallback, useEffect, useMemo, useState } from '@lynx-js/react'
import { Outlet, useLocation, useNavigate } from 'react-router'

import { StaffPasscodeScreen } from '@/components/StaffPasscodeScreen'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { subscribeOutbox, type OutboxStats } from '@/lib/outbox'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const nav: Array<{
  to: string
  label: string
  icon: IconName
  end?: boolean
}> = [
  { to: '/', label: 'Checkout', end: true, icon: 'shopping-bag' },
  { to: '/catalog', label: 'Items', icon: 'package' },
  { to: '/receipts', label: 'Transactions', icon: 'receipt' },
]

const TINT_COUNT = 6

function initials(name: string | null | undefined, fallback = '?') {
  if (!name?.trim()) return fallback
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`
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
    loginAsStaff,
    lockStaff,
    logout,
  } = useSession()
  const [stats, setStats] = useState<OutboxStats | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  /** Passcode overlay — required when no staff clocked in. */
  const [passcodeOpen, setPasscodeOpen] = useState(false)
  const [passcodeTarget, setPasscodeTarget] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => subscribeOutbox(setStats), [])

  // Gate POS until a team member clocks in with passcode
  useEffect(() => {
    if (!staffId) {
      setPasscodeOpen(true)
      setPasscodeTarget(null)
    }
  }, [staffId])

  const openPasscode = useCallback((staffTarget?: string | null) => {
    'background only'
    setPasscodeTarget(staffTarget ?? null)
    setPasscodeOpen(true)
  }, [])

  const onStaffVerify = useCallback(
    async (id: string, pin: string) => {
      'background only'
      await loginAsStaff(id, pin)
      setPasscodeOpen(false)
      setPasscodeTarget(null)
    },
    [loginAsStaff],
  )

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
  const isCatalog = location.pathname.startsWith('/catalog')

  const accountName =
    user?.display_name?.trim() || user?.phone_e164 || 'Account'
  const accountInitials = initials(user?.display_name ?? user?.phone_e164, 'U')

  const pageTitle = isPos ? 'Checkout' : isCatalog ? 'Items' : 'Transactions'
  const pageSubtitle = isPos
    ? 'Sell items'
    : isCatalog
      ? 'Products & categories'
      : 'Sales history'

  const outletName =
    outlets.find((o) => o.id === outletId)?.name ?? 'No outlet selected'
  const online = stats?.online !== false
  const activeStaffName =
    staff.find((s) => s.id === staffId)?.display_name ?? null

  const isActiveRoute = (to: string, end?: boolean) =>
    end ? location.pathname === to : location.pathname.startsWith(to)

  return (
    <view className="mp-shell">
      {/* Left sidebar — Square-style navigation rail */}
      <view className={cn('mp-side', !sidebarOpen && 'is-collapsed')}>
        <view className="mp-side__brandrow">
          <view
            className="mp-side__collapse"
            bindtap={() => {
              'background only'
              setSidebarOpen(false)
            }}
            accessibility-label="Collapse sidebar"
          >
            <Icon name="menu" size={16} />
          </view>
          <view className="mp-fill">
            <text className="mp-side__biz mp-truncate">{businessName}</text>
            <text className="mp-side__outlet mp-truncate">{outletName}</text>
          </view>
        </view>

        <view className="mp-side__scoperow">
          <view>
            <text className="mp-side__scope-title">Business</text>
            <text className="mp-side__scope-sub">Scope &amp; outlet</text>
          </view>
          <view
            className="mp-side__scope-toggle"
            accessibility-label="Business and outlet"
            bindtap={() => {
              'background only'
              setScopeOpen((v) => !v)
            }}
          >
            <Icon name="plus" size={14} />
          </view>
        </view>

        {scopeOpen ? (
          <view className="mp-scope">
            <text className="mp-label">BUSINESS</text>
            {memberships.map((m) => (
              <view
                key={m.business_id}
                className={cn(
                  'mp-scope__option',
                  m.business_id === businessId && 'is-active',
                )}
                bindtap={() => {
                  'background only'
                  setBusinessId(m.business_id)
                }}
              >
                <text className="mp-scope__option-text mp-truncate">
                  {m.business_name}
                </text>
              </view>
            ))}
            <text className="mp-label">OUTLET</text>
            {outlets.length === 0 ? (
              <text className="mp-scope__empty">No outlets loaded yet.</text>
            ) : null}
            {outlets.map((o) => (
              <view
                key={o.id}
                className={cn(
                  'mp-scope__option',
                  o.id === outletId && 'is-active',
                )}
                bindtap={() => {
                  'background only'
                  setOutletId(o.id)
                }}
              >
                <text className="mp-scope__option-text mp-truncate">
                  {o.name}
                </text>
              </view>
            ))}
          </view>
        ) : null}

        <scroll-view scroll-orientation="vertical" className="mp-nav">
          <view className="mp-nav__list">
            {nav.map(({ to, label, icon, end }) => {
              const active = isActiveRoute(to, end)
              return (
                <view
                  key={to}
                  className={cn('mp-nav__item', active && 'is-active')}
                  bindtap={() => {
                    'background only'
                    navigate(to)
                  }}
                >
                  <view className="mp-nav__rail" />
                  <view className="mp-nav__icon">
                    <Icon
                      name={icon}
                      size={16}
                      color={active ? '#fcfcfd' : '#6a7385'}
                    />
                  </view>
                  <view className="mp-fill">
                    <text className="mp-nav__label mp-truncate">{label}</text>
                  </view>
                </view>
              )
            })}
          </view>
        </scroll-view>

        <view className="mp-side__footer">
          <text className="mp-side__wordmark">
            Muto<text className="mp-side__wordmark-dim">POS</text>
          </text>
          <view className="mp-side__status">
            {(stats?.pending ?? 0) > 0 ? (
              <Badge variant="warning" label={`Outbox ${stats?.pending}`} />
            ) : (
              <Badge variant="secondary" label="Synced" />
            )}
            {online ? (
              <Badge variant="success" label="Online">
                <Icon name="wifi" size={11} color="#05713f" />
              </Badge>
            ) : (
              <Badge variant="warning" label="Offline">
                <Icon name="wifi-off" size={11} color="#6b3a05" />
              </Badge>
            )}
          </view>
        </view>
      </view>

      {/* Main column */}
      <view className="mp-main">
        <view className="mp-header">
          {!sidebarOpen ? (
            <Button
              size="icon"
              variant="ghost"
              onTap={() => setSidebarOpen(true)}
            >
              <Icon name="menu" size={16} />
            </Button>
          ) : null}

          <view style={{ flexShrink: '0', minWidth: '0' }}>
            <text className="mp-header__title mp-truncate">{pageTitle}</text>
            <text className="mp-header__sub mp-truncate">{pageSubtitle}</text>
          </view>

          {/* Team chips — passcode required to switch (Square-style) */}
          <scroll-view
            scroll-orientation="horizontal"
            className="mp-header__team"
          >
            <view className="mp-header__team-row">
              {floorStaff.map((s, i) => {
                const active = s.id === staffId
                return (
                  <view
                    key={s.id}
                    className={cn('mp-chip', active && 'is-active')}
                    bindtap={() => {
                      'background only'
                      if (active) return
                      openPasscode(s.id)
                    }}
                  >
                    <view
                      className={cn('mp-avatar', `mp-tint-${i % TINT_COUNT}`)}
                    >
                      <text
                        className={cn(
                          'mp-avatar__text',
                          `mp-tint-${i % TINT_COUNT}-text`,
                        )}
                      >
                        {initials(s.display_name).slice(0, 1)}
                      </text>
                    </view>
                    <text className="mp-chip__text">
                      {shortName(s.display_name)}
                    </text>
                    {active ? <Icon name="lock" size={12} /> : null}
                  </view>
                )
              })}
              {staffId ? (
                <Button
                  size="sm"
                  variant="outline"
                  label="Lock"
                  onTap={() => {
                    lockStaff()
                    openPasscode(null)
                  }}
                >
                  <Icon name="lock" size={14} />
                </Button>
              ) : (
                <Button
                  size="sm"
                  label="Clock in"
                  onTap={() => openPasscode(null)}
                />
              )}
            </view>
          </scroll-view>

          <view className="mp-header__right">
            {isPos ? (
              searchOpen ? (
                <view className="mp-search">
                  <Icon name="search" size={14} />
                  {/* Uncontrolled by design — see components/ui/TextField. */}
                  <input
                    className="mp-search__input"
                    default-value={search}
                    placeholder="Search items…"
                    bindinput={(e) => {
                      'background only'
                      setSearch(e.detail.value)
                    }}
                  />
                  <view
                    accessibility-label="Close search"
                    bindtap={() => {
                      'background only'
                      setSearch('')
                      setSearchOpen(false)
                    }}
                  >
                    <Icon name="x" size={14} />
                  </view>
                </view>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  onTap={() => setSearchOpen(true)}
                >
                  <Icon name="search" size={16} />
                </Button>
              )
            ) : null}

            <view
              className="mp-account"
              bindtap={() => {
                'background only'
                void logout()
              }}
            >
              <view>
                <text className="mp-account__name">{accountName}</text>
                <text className="mp-account__role">
                  {activeStaffName
                    ? `Cashier · ${shortName(activeStaffName)}`
                    : 'Owner account'}
                </text>
              </view>
              <view className="mp-account__avatar">
                <text className="mp-account__avatar-text">
                  {accountInitials.slice(0, 1)}
                </text>
              </view>
            </view>
          </view>
        </view>

        <view className="mp-content">
          {isPos ? (
            <Outlet context={{ search, setSearch }} />
          ) : (
            <scroll-view
              scroll-orientation="vertical"
              className="mp-content__scroll"
            >
              <view className="mp-content__pad">
                <Outlet context={{ search, setSearch }} />
              </view>
            </scroll-view>
          )}
        </view>
      </view>

      <StaffPasscodeScreen
        open={passcodeOpen}
        staff={staff}
        businessName={businessName}
        initialStaffId={passcodeTarget}
        required={!staffId}
        onVerify={onStaffVerify}
        onClose={
          staffId
            ? () => {
                setPasscodeOpen(false)
                setPasscodeTarget(null)
              }
            : undefined
        }
      />
    </view>
  )
}
