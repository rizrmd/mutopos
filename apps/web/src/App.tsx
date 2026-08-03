import type { ReactNode } from '@lynx-js/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router'

import { AppShell } from '@/components/AppShell'
import { SessionProvider, useSession } from '@/lib/session'
import { CatalogPage } from '@/pages/CatalogPage'
import { LoginPage } from '@/pages/LoginPage'
import { POSPage } from '@/pages/POSPage'
import { ReceiptDetailPage, ReceiptsPage } from '@/pages/ReceiptsPage'

function BootScreen() {
  return (
    <view className="mp-boot">
      <view className="mp-boot__mark">
        <text className="mp-boot__mark-text">M</text>
      </view>
      <text className="mp-boot__text">Loading MutoPOS…</text>
    </view>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, token } = useSession()
  if (!ready) return <BootScreen />
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { ready, token } = useSession()
  if (!ready) return <BootScreen />
  if (token) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * There is no browser history in Lynx, so routing runs on `MemoryRouter`
 * (`BrowserRouter` needs `window.history`) from `react-router` — the DOM-free
 * package. `<Link>` / `<NavLink>` do not exist either; navigation goes through
 * `useNavigate` on a tappable `<view>`.
 */
export function App() {
  return (
    <SessionProvider>
      <MemoryRouter>
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
      </MemoryRouter>
    </SessionProvider>
  )
}
