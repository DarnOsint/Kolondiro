import { useEffect, lazy, Suspense } from 'react'
import { useNotifications } from './hooks/useNotifications'
import { ToastProvider } from './context/ToastContext'
import AppShell from './components/AppShell'
import NotificationToast from './components/NotificationToast'
import ErrorBoundary from './components/ErrorBoundary'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/auth/Login'

// ── Lazy page chunks — each loads only when first navigated to ─────────────
// POS is the most used — its own chunk for fastest first load
const POS = lazy(() => import('./pages/pos/POS'))
// KDS screens — grouped together (all small, all kitchen staff)
const KitchenKDS = lazy(() => import('./pages/kds/KitchenKDS'))
const BarKDS = lazy(() => import('./pages/kds/BarKDS'))
const GrillerKDS = lazy(() => import('./pages/kds/GrillerKDS'))
const MixologistKDS = lazy(() => import('./pages/kds/MixologistKDS'))
// Management — managers only
const Management = lazy(() => import('./pages/management/Management'))
// Executive — owner only
const Executive = lazy(() => import('./pages/executive/Executive'))
const CVDashboard = lazy(() => import('./pages/cv/CVDashboard'))
// Accounting suite
const Accounting = lazy(() => import('./pages/accounting/Accounting'))
const Debtors = lazy(() => import('./pages/accounting/Debtors'))
// Reports & analytics — heaviest chunk (recharts)
const Reports = lazy(() => import('./pages/reports/Reports'))
const Analytics = lazy(() => import('./pages/analytics/Analytics'))
// Back office
const BackOffice = lazy(() => import('./pages/backoffice/BackOffice'))
const QRTableCards = lazy(() => import('./pages/backoffice/QRTableCards'))
// Rooms
const RoomManagement = lazy(() => import('./pages/rooms/RoomManagement'))
// Misc
const SupervisorDashboard = lazy(() => import('./pages/supervisor/SupervisorDashboard'))
const ApartmentDashboard = lazy(() => import('./pages/apartment/ApartmentDashboard'))
const MonthEnd = lazy(() => import('./pages/monthend/MonthEnd'))
const GamesMasterPage = lazy(() => import('./pages/games/GamesMasterPage'))
const ShishaAttendantPage = lazy(() => import('./pages/shisha/ShishaAttendantPage'))
// Public customer pages
const TableView = lazy(() => import('./pages/customer/TableView'))
const ReceiptView = lazy(() => import('./pages/customer/ReceiptView'))
const ZoneMenuView = lazy(() => import('./pages/customer/ZoneMenuView'))
import type { Role } from './types'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    // AppShell's <main> is the scroll container — window.scrollTo has no effect
    const main = document.getElementById('main-scroll')
    if (main) {
      main.scrollTop = 0
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [pathname])
  return null
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()

  // Still loading, or user is set but profile hasn't been fetched yet
  // (the brief window after signInWithPassword resolves but before fetchProfile completes)
  if (loading || (user && !profile))
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  if (!user) return <Navigate to="/login" />

  return <>{children}</>
}

function RoleGuard({ children, allowed }: { children: React.ReactNode; allowed: Role[] }) {
  const { user, profile, loading } = useAuth()
  if (loading || (user && !profile))
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )
  if (!profile) return <Navigate to="/login" />
  if (!allowed.includes(profile.role as Role)) return <Navigate to="/dashboard" />
  return <>{children}</>
}

function RoleRoute() {
  const { user, profile, loading } = useAuth()
  if (loading || (user && !profile))
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )
  if (!profile) return <Navigate to="/login" />
  if (profile.role === 'owner') return <Navigate to="/executive" />
  if (profile.role === 'executive') return <Navigate to="/executive" />
  if (profile.role === 'manager') return <Navigate to="/management" />
  if (profile.role === 'accountant') return <Navigate to="/accounting" />
  if (profile.role === 'waitron') return <Navigate to="/pos" />
  if (profile.role === 'kitchen') return <Navigate to="/kds/kitchen" />
  if (profile.role === 'bar') return <Navigate to="/kds/bar" />
  if (profile.role === 'griller') return <Navigate to="/kds/griller" />
  if (profile.role === 'mixologist') return <Navigate to="/kds/mixologist" />
  if (profile.role === 'apartment_manager') return <Navigate to="/apartment" />
  if (profile.role === 'auditor') return <Navigate to="/accounting" />
  if (profile.role === 'games_master') return <Navigate to="/games" />
  if (profile.role === 'shisha_attendant') return <Navigate to="/shisha" />
  if (profile.role === 'supervisor') return <Navigate to="/supervisor" />
  return <Navigate to="/login" />
}

const EB = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <ErrorBoundary title={title}>{children}</ErrorBoundary>
)

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Suspense
        fallback={
          <div className="min-h-screen bg-gray-950 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-500 text-sm">Loading...</p>
            </div>
          </div>
        }
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <RoleRoute />
              </PrivateRoute>
            }
          />

          <Route
            path="/executive"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner']}>
                  <EB title="Dashboard error">
                    <Executive />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/management"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager']}>
                  <EB title="Management error">
                    <Management />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/accounting"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'accountant', 'auditor']}>
                  <EB title="Accounting error">
                    <Accounting />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/backoffice"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager']}>
                  <EB title="Back office error">
                    <BackOffice />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/backoffice/qr-cards"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'executive'] as Role[]}>
                  <EB title="QR cards error">
                    <QRTableCards />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/pos"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'waitron']}>
                  <EB title="POS error">
                    <POS />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/kds/kitchen"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'kitchen']}>
                  <EB title="Kitchen display error">
                    <KitchenKDS />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/kds/bar"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'bar']}>
                  <EB title="Bar display error">
                    <BarKDS />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/kds/mixologist"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'mixologist']}>
                  <EB title="Mixologist display error">
                    <MixologistKDS />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/kds/griller"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'griller']}>
                  <EB title="Grill display error">
                    <GrillerKDS />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/rooms"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager']}>
                  <EB title="Room management error">
                    <RoomManagement />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/debtors"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'accountant', 'auditor']}>
                  <EB title="Debtors error">
                    <Debtors onBack={() => window.history.back()} />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'accountant', 'auditor']}>
                  <EB title="Reports error">
                    <Reports />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'accountant', 'auditor']}>
                  <EB title="Analytics error">
                    <Analytics />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/cv"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager']}>
                  <EB title="CV Dashboard error">
                    <CVDashboard />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/supervisor"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'supervisor'] as Role[]}>
                  <SupervisorDashboard />
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/apartment"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'apartment_manager']}>
                  <EB title="Apartment dashboard error">
                    <ApartmentDashboard />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />

          <Route
            path="/month-end"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'accountant', 'auditor']}>
                  <EB title="Month End error">
                    <MonthEnd />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />

          <Route
            path="/games"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'games_master'] as Role[]}>
                  <EB title="Games error">
                    <GamesMasterPage />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/shisha"
            element={
              <PrivateRoute>
                <RoleGuard allowed={['owner', 'manager', 'shisha_attendant'] as Role[]}>
                  <EB title="Shisha error">
                    <ShishaAttendantPage />
                  </EB>
                </RoleGuard>
              </PrivateRoute>
            }
          />

          {/* Public customer routes */}
          <Route
            path="/table/:tableId"
            element={
              <EB title="Order page error">
                <TableView />
              </EB>
            }
          />
          <Route
            path="/zone/:zoneId"
            element={
              <EB title="Menu page error">
                <ZoneMenuView />
              </EB>
            }
          />
          <Route
            path="/zone-menu/:zoneId"
            element={
              <EB title="Menu page error">
                <ZoneMenuView />
              </EB>
            }
          />
          <Route
            path="/receipt/:orderId"
            element={
              <EB title="Receipt error">
                <ReceiptView />
              </EB>
            }
          />

          <Route path="/" element={<Navigate to="/dashboard" />} />
        </Routes>
      </Suspense>
    </>
  )
}

function AppInner() {
  const { profile } = useAuth()
  const { toasts, dismiss } = useNotifications(profile)
  return (
    <ToastProvider>
      <NotificationToast toasts={toasts} onDismiss={dismiss} />
      <AppShell>
        <AppRoutes />
      </AppShell>
    </ToastProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
