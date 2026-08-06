import { useRef, useState } from '@lynx-js/react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { TextField } from '@/components/ui/TextField'
import {
  formatPhoneDisplay,
  isPlausibleIdPhone,
  toE164Id,
  toNationalDigits,
} from '@/lib/phone'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * Phone row with a fixed +62 prefix. National digits live in state; free-form
 * paste/type (08… / 62… / +62…) is normalized via `toNationalDigits`.
 */
function PhoneField({
  national,
  onChangeNational,
}: {
  national: string
  onChangeNational: (value: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const lastReported = useRef(national)
  const generation = useRef(0)

  if (national !== lastReported.current) {
    lastReported.current = national
    generation.current += 1
  }

  return (
    <view className="mp-field">
      <text className="mp-field__label">Phone number</text>
      <view className={cn('mp-phone', focused && 'is-focused')}>
        <view className="mp-phone__prefix">
          <text className="mp-phone__prefix-text">+62</text>
        </view>
        <input
          key={`p${generation.current}`}
          className="mp-phone__control"
          default-value={national}
          type="tel"
          placeholder="81234567890"
          bindinput={(e) => {
            'background only'
            const raw = e.detail.value
            const next = toNationalDigits(raw)
            // Keep lastReported as the raw field text so a cleaned national
            // value from the parent remounts the input (Lynx default-value).
            lastReported.current = raw
            onChangeNational(next)
          }}
          bindfocus={() => {
            'background only'
            setFocused(true)
          }}
          bindblur={() => {
            'background only'
            setFocused(false)
          }}
        />
      </view>
      <text className="mp-phone__hint">
        You can type 08…, 62…, or +62… — we’ll fix the format.
      </text>
    </view>
  )
}

export function LoginPage() {
  const { requestOTP, loginWithOTP } = useSession()
  const navigate = useNavigate()
  /** National digits only; UI shows a fixed +62 prefix. */
  const [national, setNational] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | undefined>()
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const phoneE164 = toE164Id(national)

  async function onRequest() {
    'background only'
    setError(null)
    setBusy(true)
    try {
      const res = await requestOTP(phoneE164)
      setDevCode(res.dev_code)
      if (res.dev_code) setCode(res.dev_code)
      setStep('otp')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onVerify() {
    'background only'
    setError(null)
    setBusy(true)
    try {
      await loginWithOTP(phoneE164, code)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <view className="mp-login">
      <view className="mp-login__inner">
        {/* Brand hero — stacked mark + wordmark (no side-by-side collision) */}
        <view className="mp-login__hero">
          <view className="mp-login__mark">
            <text className="mp-login__mark-letter">M</text>
          </view>
          <text className="mp-login__brand">MutoPOS</text>
          <text className="mp-login__tagline">
            Checkout for your store · works offline
          </text>
        </view>

        {/* Form card */}
        <view className="mp-login__card">
          <view className="mp-login__card-head">
            <text className="mp-login__step-title">
              {step === 'phone' ? 'Sign in' : 'Enter the code'}
            </text>
            <text className="mp-login__step-desc">
              {step === 'phone'
                ? 'Enter your phone number. We’ll send a short code to sign you in.'
                : `We sent a 6-digit code to ${formatPhoneDisplay(phoneE164)}.`}
            </text>
          </view>

          <view className="mp-login__card-body">
            {step === 'phone' ? (
              <>
                <PhoneField
                  national={national}
                  onChangeNational={setNational}
                />
                <view className="mp-login__cta">
                  <Button
                    block
                    size="lg"
                    label={busy ? 'Sending…' : 'Send code'}
                    disabled={busy || !isPlausibleIdPhone(national)}
                    onTap={() => void onRequest()}
                  />
                </view>
              </>
            ) : (
              <>
                {devCode ? (
                  <view className="mp-login__dev-code">
                    <Icon name="lock" size={14} color="#05713f" />
                    <view className="mp-login__dev-code-text">
                      <text className="mp-login__dev-code-label">
                        Test code
                      </text>
                      <text className="mp-login__dev-code-value mp-num">
                        {devCode}
                      </text>
                    </view>
                  </view>
                ) : null}

                <TextField
                  label="Code"
                  value={code}
                  onChangeText={setCode}
                  placeholder="000000"
                  type="number"
                  maxLength={6}
                  onConfirm={() => void onVerify()}
                />

                <view className="mp-login__cta">
                  <view className="mp-login__actions">
                    <Button
                      className="mp-fill"
                      size="lg"
                      variant="outline"
                      label="Back"
                      disabled={busy}
                      onTap={() => {
                        'background only'
                        setStep('phone')
                        setError(null)
                      }}
                    />
                    <Button
                      className="mp-fill"
                      size="lg"
                      label={busy ? 'Checking…' : 'Continue'}
                      disabled={busy || !code}
                      onTap={() => void onVerify()}
                    />
                  </view>
                </view>
              </>
            )}

            {error ? (
              <view className="mp-login__error">
                <text className="mp-login__error-text">{error}</text>
              </view>
            ) : null}
          </view>
        </view>

        <text className="mp-login__footnote">
          Sign in with your phone number
        </text>
      </view>
    </view>
  )
}
