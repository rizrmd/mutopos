import { useState } from '@lynx-js/react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { TextField } from '@/components/ui/TextField'
import { useSession } from '@/lib/session'

export function LoginPage() {
  const { requestOTP, loginWithOTP } = useSession()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [devCode, setDevCode] = useState<string | undefined>()
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onRequest() {
    'background only'
    setError(null)
    setBusy(true)
    try {
      const res = await requestOTP(phone)
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
      await loginWithOTP(phone, code, displayName || undefined)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <view className="mp-login">
      <Card className="mp-login__card">
        <CardHeader
          title="Sign in"
          description="Enter your phone in E.164 format (e.g. +6281234567890)."
        >
          <view className="mp-login__brandrow">
            <view className="mp-login__mark">
              <Icon name="smartphone" size={20} color="#fcfcfd" />
            </view>
            <view>
              <text className="mp-login__brand">MutoPOS</text>
              <text className="mp-login__brand-sub">
                Sign in with phone OTP
              </text>
            </view>
          </view>
        </CardHeader>
        <CardContent>
          {step === 'phone' ? (
            <>
              <TextField
                label="Phone (E.164)"
                value={phone}
                onChangeText={setPhone}
                placeholder="+6281234567890"
                type="tel"
              />
              <TextField
                label="Display name (optional)"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
              />
              <Button
                block
                label={busy ? 'Sending…' : 'Send OTP'}
                disabled={busy || phone.length < 8}
                onTap={() => void onRequest()}
              />
            </>
          ) : (
            <>
              <text className="mp-login__note">
                Code sent to {phone}
                {devCode ? ' · stub ' : ''}
                {devCode ? (
                  <text className="mp-login__code">{devCode}</text>
                ) : null}
              </text>
              <TextField
                label="OTP code"
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                type="number"
                maxLength={6}
                onConfirm={() => void onVerify()}
              />
              <view className="mp-login__actions">
                <Button
                  className="mp-fill"
                  variant="outline"
                  label="Back"
                  disabled={busy}
                  onTap={() => setStep('phone')}
                />
                <Button
                  className="mp-fill"
                  label={busy ? 'Verifying…' : 'Verify & enter'}
                  disabled={busy || !code}
                  onTap={() => void onVerify()}
                />
              </view>
            </>
          )}
          {error ? <text className="mp-error-text">{error}</text> : null}
        </CardContent>
      </Card>
    </view>
  )
}
