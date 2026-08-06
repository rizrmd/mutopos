/**
 * Indonesian phone helpers for login.
 *
 * Free-form input (08… / 62… / +62… / bare national) is normalized to national
 * digits, then E.164 (+62…) for the API. The login field is a plain tel input.
 */

/** Digits only, no leading +. */
function digitsOnly(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c >= '0' && c <= '9') out += c
  }
  return out
}

/**
 * Turn free-form input into national digits (no country code, no leading 0).
 *
 * Adaptive cases:
 * - `0856123…`   → `856123…`
 * - `62856123…`  → `856123…`  (62 + mobile 8…)
 * - `+62856123…` → `856123…`
 * - `856123…`    → `856123…`
 *
 * Country code is stripped only when followed by a mobile leading 8, so typing
 * `62` mid-entry does not wipe the field.
 */
export function toNationalDigits(raw: string): string {
  let d = digitsOnly(raw)
  // 62856… / 62812… → drop country code; keep bare 62 until more digits arrive
  if (d.startsWith('62') && d.length > 2 && d[2] === '8') {
    d = d.slice(2)
  }
  if (d.startsWith('0')) {
    d = d.slice(1)
  }
  return d
}

/** E.164 for Indonesia from national digits or free-form input. */
export function toE164Id(raw: string): string {
  const national = toNationalDigits(raw)
  if (!national) return ''
  return `+62${national}`
}

/** True when the number is long enough to request a code. */
export function isPlausibleIdPhone(raw: string): boolean {
  const national = toNationalDigits(raw)
  // ID mobile is typically 9–13 digits after country code (e.g. 812… / 856…).
  return national.length >= 8 && national.length <= 13
}

/** Friendly display of E.164 for copy (“we sent a code to …”). */
export function formatPhoneDisplay(e164: string): string {
  if (!e164) return ''
  if (e164.startsWith('+62')) {
    return `+62 ${e164.slice(3)}`
  }
  return e164
}
