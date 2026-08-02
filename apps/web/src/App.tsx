import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/AppShell'
import { SessionProvider, useSession } from '@/lib/session'
import { CatalogPage } from '@/pages/CatalogPage'
import { LoginPage } from '@/pages/LoginPage'
import { POSPage } from '@/pages/POSPage'
import { ReceiptDetailPage, ReceiptsPage } from '@/pages/ReceiptsPage'

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, token } = useSession()
  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (!token) return <Navigate to="/login" replace />
  return children
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { ready, token } = useSession()
  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (token) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <LoginPage />
              </PublicOnly>
            }
          />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<POSPage />} />
            <Route path="catalog" element={<CatalogPage />} />
            <Route path="receipts" element={<ReceiptsPage />} />
            <Route path="receipts/:id" element={<ReceiptDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
