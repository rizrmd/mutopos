/**
 * Money and time formatting without `Intl`.
 *
 * PrimJS ships no (or a heavily trimmed) ECMA-402, so `Intl.NumberFormat` and
 * `Date#toLocaleTimeString` cannot be relied on. These helpers reproduce the
 * two formats MutoPOS actually renders: `id-ID` rupiah and `en-US` dollars.
 */

function groupThousands(n: number, separator: string): string {
  const s = Math.abs(n).toFixed(0)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += separator
    out += s[i]
  }
  return n < 0 ? `-${out}` : out
}

/** Format money. USD minor = cents; IDR minor = whole rupiah. */
export function formatMoney(minor: number, currency = 'IDR'): string {
  const value = Number.isFinite(minor) ? minor : 0
  const code = (currency || 'IDR').toUpperCase()

  if (code === 'USD') {
    const negative = value < 0
    const cents = Math.round(Math.abs(value))
    const whole = Math.floor(cents / 100)
    const frac = (cents % 100).toString().padStart(2, '0')
    return `${negative ? '-' : ''}$${groupThousands(whole, ',')}.${frac}`
  }

  if (code === 'IDR') {
    return `Rp${groupThousands(Math.round(value), '.')}`
  }

  // Unknown currency: no minor-unit assumption, just a readable grouped amount.
  return `${code} ${groupThousands(Math.round(value), ',')}`
}

/** @deprecated prefer formatMoney(minor, currency) */
export function formatIDR(minor: number): string {
  return formatMoney(minor, 'IDR')
}

/** `h:mm AM/PM`, matching the old `toLocaleTimeString` output on the POS. */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const hours24 = d.getHours()
  const suffix = hours24 < 12 ? 'AM' : 'PM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const minutes = d.getMinutes().toString().padStart(2, '0')
  return `${hours12}:${minutes} ${suffix}`
}

/** Compact `YYYY-MM-DD HH:mm` for receipt timestamps coming back as ISO text. */
export function formatStamp(value: string | null | undefined): string {
  if (!value) return '—'
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return value
  const d = new Date(ms)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}
