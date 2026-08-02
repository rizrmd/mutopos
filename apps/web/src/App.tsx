import { Store, Smartphone, WifiOff, Database } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const pillars = [
  {
    icon: Store,
    title: 'Multi-tenant Business',
    body: 'Outlets, staff/roles, catalog, and transaksi scoped by business_id.',
  },
  {
    icon: Smartphone,
    title: 'Owner login via WhatsApp',
    body: 'E.164 phone + OTP (server-side). UI auth screens come next.',
  },
  {
    icon: WifiOff,
    title: 'Offline-first (later)',
    body: 'RxDB local store + custom outbox → Go API. Not PowerSync/Electric.',
  },
  {
    icon: Database,
    title: 'Go + Postgres domain',
    body: 'Authoritative stock, sales, and idempotent command_receipts.',
  },
]

export default function App() {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
              M
            </span>
            MutoPOS
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" type="button">
              Docs
            </Button>
            <Button size="sm" type="button">
              Sign in (soon)
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <section className="mb-10 space-y-3">
          <p className="text-sm font-medium text-primary">Scaffold shell</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Offline-first POS for multi-outlet F&amp;B and retail
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Vite + React + shadcn/ui web shell. Domain API lives in{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              apps/api
            </code>
            . Client RxDB/outbox is a later phase — this app is the UI host.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button">Open POS (stub)</Button>
            <Button variant="outline" type="button" asChild>
              <a href="http://127.0.0.1:8080/v1/meta" target="_blank" rel="noreferrer">
                API /v1/meta
              </a>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {pillars.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="space-y-1">
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription>{body}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </section>
      </main>
    </div>
  )
}
