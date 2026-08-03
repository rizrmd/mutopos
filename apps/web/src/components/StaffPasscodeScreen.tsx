/**
 * Square-style team passcode clock-in.
 * Step 1: pick team member (grid of tiles)
 * Step 2: numeric PIN pad + filled dots
 *
 * The web version also accepted a hardware keyboard through a `window`
 * `keydown` listener. Lynx has no `window` and no key events, so the on-screen
 * pad is the only input — which is what the touch hosts actually use.
 */
import { useCallback, useEffect, useMemo, useState } from '@lynx-js/react'

import { Icon } from '@/components/ui/Icon'
import { ApiError, type Staff } from '@/lib/api'
import { cn } from '@/lib/utils'

const TINT_COUNT = 6
const PIN_LEN = 4
const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

type Props = {
  open: boolean
  staff: Staff[]
  businessName?: string
  /** Pre-select a team member (e.g. chip tap). */
  initialStaffId?: string | null
  /** Called after a successful PIN verify — parent should call session.loginAsStaff. */
  onVerify: (staffId: string, pin: string) => Promise<void>
  onClose?: () => void
  /** When true, dismiss is hidden (gate until someone clocks in). */
  required?: boolean
}

export function StaffPasscodeScreen({
  open,
  staff,
  businessName,
  initialStaffId,
  onVerify,
  onClose,
  required = false,
}: Props) {
  const floor = useMemo(() => {
    const active = staff.filter((s) => s.status === 'active')
    const cashiers = active.filter((s) => s.role === 'cashier')
    return cashiers.length > 0 ? cashiers : active
  }, [staff])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)

  // Reset / preselect when opened
  useEffect(() => {
    if (!open) return
    setPin('')
    setError(null)
    setBusy(false)
    if (initialStaffId && floor.some((s) => s.id === initialStaffId)) {
      setSelectedId(initialStaffId)
    } else {
      setSelectedId(null)
    }
  }, [open, initialStaffId, floor])

  const selected = floor.find((s) => s.id === selectedId) ?? null
  const selectedTint = Math.max(
    0,
    floor.findIndex((x) => x.id === selectedId),
  )

  const submit = useCallback(
    async (code: string) => {
      'background only'
      if (!selectedId || busy) return
      setBusy(true)
      setError(null)
      try {
        await onVerify(selectedId, code)
        setPin('')
      } catch (e) {
        setShake(true)
        setTimeout(() => setShake(false), 400)
        setPin('')
        if (e instanceof ApiError) {
          if (e.code === 'pin_not_set') {
            setError('No passcode set for this person. Ask an owner to set one.')
          } else if (e.code === 'invalid_credentials') {
            setError('Incorrect passcode')
          } else {
            setError(e.message)
          }
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        setBusy(false)
      }
    },
    [selectedId, busy, onVerify],
  )

  const pushDigit = useCallback(
    (d: string) => {
      'background only'
      if (busy || !selectedId) return
      setError(null)
      setPin((prev) => {
        if (prev.length >= PIN_LEN) return prev
        const next = prev + d
        if (next.length === PIN_LEN) {
          // auto-submit after last digit (Square behavior)
          setTimeout(() => void submit(next), 0)
        }
        return next
      })
    },
    [busy, selectedId, submit],
  )

  const backspace = useCallback(() => {
    'background only'
    if (busy) return
    setError(null)
    setPin((p) => p.slice(0, -1))
  }, [busy])

  if (!open) return null

  return (
    <view className="mp-lock">
      {/* Top bar */}
      <view className="mp-lock__bar">
        <view className="mp-lock__brand">
          <Icon name="lock" size={16} color="rgba(255,255,255,0.55)" />
          <text className="mp-lock__brand-text">
            {businessName?.trim() || 'MutoPOS'}
          </text>
        </view>
        {!required && onClose ? (
          <view
            className="mp-lock__close"
            accessibility-label="Close"
            bindtap={() => {
              'background only'
              onClose()
            }}
          >
            <Icon name="x" size={20} color="rgba(255,255,255,0.55)" />
          </view>
        ) : (
          <view className="mp-lock__close" />
        )}
      </view>

      <scroll-view scroll-orientation="vertical" className="mp-lock__body">
        <view className="mp-lock__inner">
          {!selected ? (
            <>
              <text className="mp-lock__h1">Who&apos;s clocking in?</text>
              <text className="mp-lock__hint">
                Select your name, then enter your 4-digit passcode.
              </text>
              <view className="mp-lock__grid">
                {floor.map((s, i) => (
                  <view
                    key={s.id}
                    className="mp-lock__tile"
                    bindtap={() => {
                      'background only'
                      setSelectedId(s.id)
                      setPin('')
                      setError(null)
                    }}
                  >
                    <view
                      className={cn(
                        'mp-lock__tile-avatar',
                        `mp-ltint-${i % TINT_COUNT}`,
                      )}
                    >
                      <text
                        className={cn(
                          'mp-lock__tile-initials',
                          `mp-ltint-${i % TINT_COUNT}-text`,
                        )}
                      >
                        {initials(s.display_name)}
                      </text>
                    </view>
                    <text className="mp-lock__tile-name">
                      {s.display_name}
                    </text>
                    <text className="mp-lock__tile-role">
                      {s.role.toUpperCase()}
                      {s.has_pin === false ? ' · NO PIN' : ''}
                    </text>
                  </view>
                ))}
              </view>
              {floor.length === 0 ? (
                <text className="mp-lock__empty">
                  No active team members. Add staff in the admin console.
                </text>
              ) : null}
            </>
          ) : (
            <view className="mp-pin">
              <text
                className="mp-pin__back"
                bindtap={() => {
                  'background only'
                  setSelectedId(null)
                  setPin('')
                  setError(null)
                }}
              >
                ← All team members
              </text>

              <view
                className={cn(
                  'mp-pin__avatar',
                  `mp-ltint-${selectedTint % TINT_COUNT}`,
                )}
              >
                <text
                  className={cn(
                    'mp-pin__initials',
                    `mp-ltint-${selectedTint % TINT_COUNT}-text`,
                  )}
                >
                  {initials(selected.display_name)}
                </text>
              </view>
              <text className="mp-pin__name">{selected.display_name}</text>
              <text className="mp-pin__prompt">Enter passcode</text>

              {/* PIN dots */}
              <view className={cn('mp-pin__dots', shake && 'is-shaking')}>
                {Array.from({ length: PIN_LEN }).map((_, i) => (
                  <view
                    key={i}
                    className={cn('mp-pin__dot', i < pin.length && 'is-filled')}
                  />
                ))}
              </view>
              <text className="mp-pin__status">
                {error ?? (busy ? 'Checking…' : ' ')}
              </text>

              {/* Numeric pad — Square-like 3×4 */}
              <view className="mp-pad">
                {PAD_KEYS.map((key, i) => {
                  if (key === '') {
                    return <view key={`spacer-${i}`} className="mp-pad__spacer" />
                  }
                  if (key === 'del') {
                    return (
                      <view
                        key="del"
                        className={cn('mp-pad__key', busy && 'is-disabled')}
                        accessibility-label="Delete"
                        bindtap={() => {
                          'background only'
                          backspace()
                        }}
                      >
                        <Icon
                          name="delete"
                          size={20}
                          color="rgba(255,255,255,0.8)"
                        />
                      </view>
                    )
                  }
                  return (
                    <view
                      key={key}
                      className={cn('mp-pad__key', busy && 'is-disabled')}
                      bindtap={() => {
                        'background only'
                        pushDigit(key)
                      }}
                    >
                      <text className="mp-pad__key-text mp-num">{key}</text>
                    </view>
                  )
                })}
              </view>

              <text className="mp-pin__footnote">
                Ask an owner if you need a passcode reset.
              </text>
            </view>
          )}
        </view>
      </scroll-view>
    </view>
  )
}
