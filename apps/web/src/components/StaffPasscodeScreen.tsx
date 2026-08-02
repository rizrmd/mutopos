/**
 * Square-style team passcode clock-in.
 * Step 1: pick team member (grid of tiles)
 * Step 2: numeric PIN pad + filled dots
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Delete, Lock, X } from 'lucide-react'

import { ApiError, type Staff } from '@/lib/api'
import { cn } from '@/lib/utils'

const avatarTints = [
  'bg-sky-200 text-sky-900',
  'bg-violet-200 text-violet-900',
  'bg-amber-200 text-amber-950',
  'bg-rose-200 text-rose-900',
  'bg-emerald-200 text-emerald-900',
  'bg-orange-200 text-orange-950',
]

const PIN_LEN = 4

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

type Props = {
  open: boolean
  staff: Staff[]
  businessName?: string
  /** Pre-select a team member (e.g. chip click). */
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

  const submit = useCallback(
    async (code: string) => {
      if (!selectedId || busy) return
      setBusy(true)
      setError(null)
      try {
        await onVerify(selectedId, code)
        setPin('')
      } catch (e) {
        setShake(true)
        window.setTimeout(() => setShake(false), 400)
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
      if (busy || !selectedId) return
      setError(null)
      setPin((prev) => {
        if (prev.length >= PIN_LEN) return prev
        const next = prev + d
        if (next.length === PIN_LEN) {
          // auto-submit after last digit (Square behavior)
          queueMicrotask(() => void submit(next))
        }
        return next
      })
    },
    [busy, selectedId, submit],
  )

  const backspace = useCallback(() => {
    if (busy) return
    setError(null)
    setPin((p) => p.slice(0, -1))
  }, [busy])

  // Hardware keyboard support on PIN step
  useEffect(() => {
    if (!open || !selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        pushDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        backspace()
      } else if (e.key === 'Escape' && !required && onClose) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, selectedId, pushDigit, backspace, required, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[oklch(0.22_0.02_265)] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Team passcode"
    >
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Lock className="size-4" aria-hidden />
          <span className="font-medium tracking-wide">
            {businessName?.trim() || 'MutoPOS'}
          </span>
        </div>
        {!required && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        ) : (
          <div className="size-10" />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        {!selected ? (
          <>
            <h1 className="mb-2 text-center text-2xl font-semibold tracking-tight">
              Who&apos;s clocking in?
            </h1>
            <p className="mb-8 max-w-md text-center text-sm text-white/55">
              Select your name, then enter your passcode — like Square Team
              passcodes.
            </p>
            <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {floor.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id)
                    setPin('')
                    setError(null)
                  }}
                  className="flex flex-col items-center gap-3 border border-white/10 bg-white/5 p-5 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
                >
                  <span
                    className={cn(
                      'flex size-16 items-center justify-center text-xl font-bold',
                      avatarTints[i % avatarTints.length],
                    )}
                  >
                    {initials(s.display_name)}
                  </span>
                  <span className="text-center text-sm font-semibold leading-tight">
                    {s.display_name}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-white/40">
                    {s.role}
                    {s.has_pin === false ? ' · no pin' : ''}
                  </span>
                </button>
              ))}
            </div>
            {floor.length === 0 ? (
              <p className="mt-6 text-sm text-white/50">
                No active team members. Add staff in the admin console.
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex w-full max-w-sm flex-col items-center">
            <button
              type="button"
              className="mb-6 text-sm text-white/50 hover:text-white"
              onClick={() => {
                setSelectedId(null)
                setPin('')
                setError(null)
              }}
            >
              ← All team members
            </button>

            <span
              className={cn(
                'mb-3 flex size-20 items-center justify-center text-2xl font-bold',
                avatarTints[
                  Math.max(
                    0,
                    floor.findIndex((x) => x.id === selected.id),
                  ) % avatarTints.length
                ],
              )}
            >
              {initials(selected.display_name)}
            </span>
            <h1 className="mb-1 text-center text-xl font-semibold">
              {selected.display_name}
            </h1>
            <p className="mb-8 text-sm text-white/50">Enter passcode</p>

            {/* PIN dots */}
            <div
              className={cn(
                'mb-3 flex items-center gap-3',
                shake && 'animate-[shake_0.35s_ease-in-out]',
              )}
              aria-live="polite"
            >
              {Array.from({ length: PIN_LEN }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'size-3.5 border-2 transition-colors',
                    i < pin.length
                      ? 'border-white bg-white'
                      : 'border-white/35 bg-transparent',
                  )}
                />
              ))}
            </div>
            <div className="mb-6 min-h-5 text-center text-sm text-rose-300">
              {error ?? (busy ? 'Checking…' : '\u00a0')}
            </div>

            {/* Numeric pad — Square-like 3×4 */}
            <div className="grid w-full grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(
                (key) => {
                  if (key === '') {
                    return <div key="spacer" />
                  }
                  if (key === 'del') {
                    return (
                      <button
                        key="del"
                        type="button"
                        disabled={busy}
                        onClick={backspace}
                        className="flex h-16 items-center justify-center bg-white/5 text-white/80 transition-colors hover:bg-white/12 active:bg-white/20 disabled:opacity-40"
                        aria-label="Delete"
                      >
                        <Delete className="size-5" />
                      </button>
                    )
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={busy}
                      onClick={() => pushDigit(key)}
                      className="h-16 text-2xl font-medium tabular-nums bg-white/5 transition-colors hover:bg-white/12 active:bg-white/20 disabled:opacity-40"
                    >
                      {key}
                    </button>
                  )
                },
              )}
            </div>

            <p className="mt-8 text-center text-[11px] text-white/35">
              Demo passcode for sample cashiers: 1234
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  )
}
