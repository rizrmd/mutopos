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
        <CardHeader className="space-y-3 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center bg-primary text-primary-foreground">
              <Smartphone className="size-5" />
            </div>
            <div>
              <div className="text-base font-bold">MutoPOS</div>
              <div className="text-xs text-muted-foreground">
                Sign in with phone OTP
              </div>
            </div>
          </div>
          <CardTitle className="text-lg">Sign in</CardTitle>
          <CardDescription>
            E.164 phone. Dev stub code is returned in the response (default{' '}
            <code className="bg-muted px-1">000000</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-5 pt-0">
          {step === 'phone' ? (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold" htmlFor="phone">
                  Phone (E.164)
                </label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+6281234567890"
                  autoComplete="tel"
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold" htmlFor="name">
                  Display name (optional)
                </label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Owner name"
                  className="h-10"
                />
              </div>
              <Button
                className="h-10 w-full font-semibold"
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
                Code sent to <strong className="text-foreground">{phone}</strong>
                {devCode ? (
                  <>
                    {' '}
                    · stub{' '}
                    <code className="bg-muted px-1 font-semibold">{devCode}</code>
                  </>
                ) : null}
              </p>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold" htmlFor="code">
                  OTP code
                </label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                  className="h-10 tracking-widest"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-1"
                  disabled={busy}
                  onClick={() => setStep('phone')}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="h-10 flex-1 font-semibold"
                  disabled={busy || !code}
                  onClick={() => void onVerify()}
                >
                  {busy ? 'Verifying…' : 'Verify & enter'}
                </Button>
              </div>
            </>
          )}
          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
