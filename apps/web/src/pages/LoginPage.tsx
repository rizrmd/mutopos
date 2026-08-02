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
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-4">
      {/* Soft daytime wash behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 20% 20%, var(--pastel-3), transparent), radial-gradient(ellipse 50% 40% at 80% 30%, var(--pastel-8), transparent), radial-gradient(ellipse 40% 50% at 50% 90%, var(--pastel-1), transparent)',
        }}
      />

      <Card className="relative w-full max-w-md rounded-2xl border-border/80 shadow-lg shadow-foreground/5">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Smartphone className="size-5" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">
                Muto<span className="font-normal text-muted-foreground"> POS</span>
              </div>
              <div className="text-xs text-muted-foreground">
                A modern way to run hospitality from front to back
              </div>
            </div>
          </div>
          <CardTitle className="text-xl">Sign in</CardTitle>
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
                  className="h-11 rounded-xl"
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
                  className="h-11 rounded-xl"
                />
              </div>
              <Button
                className="h-11 w-full rounded-xl text-sm font-semibold"
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
                    · stub code{' '}
                    <code className="rounded-md bg-muted px-1.5 py-0.5">
                      {devCode}
                    </code>
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
                  className="h-11 rounded-xl tracking-widest"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 rounded-xl"
                  disabled={busy}
                  onClick={() => setStep('phone')}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="h-11 flex-1 rounded-xl font-semibold"
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
