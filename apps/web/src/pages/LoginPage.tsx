import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Smartphone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSession } from '@/lib/session'

export function LoginPage() {
  const { requestOTP, loginWithOTP } = useSession()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('+628')
  const [code, setCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [devCode, setDevCode] = useState<string | undefined>()
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onRequest() {
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
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Smartphone className="size-5" />
          </div>
          <CardTitle>Sign in to MutoPOS</CardTitle>
          <CardDescription>
            WhatsApp OTP stub — enter E.164 phone. In development the code is
            returned in the response (default <code>000000</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'phone' ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="phone">
                  Phone (E.164)
                </label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+6281234567890"
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="name">
                  Display name (optional)
                </label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Owner name"
                />
              </div>
              <Button
                className="w-full"
                type="button"
                disabled={busy || phone.length < 8}
                onClick={() => void onRequest()}
              >
                {busy ? 'Sending…' : 'Send OTP'}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Code sent to <strong>{phone}</strong>
                {devCode ? (
                  <>
                    {' '}
                    · stub code <code className="rounded bg-muted px-1">{devCode}</code>
                  </>
                ) : null}
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="code">
                  OTP code
                </label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => setStep('phone')}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={busy || !code}
                  onClick={() => void onVerify()}
                >
                  {busy ? 'Verifying…' : 'Verify & enter'}
                </Button>
              </div>
            </>
          )}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
