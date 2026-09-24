import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './shared/supabase'
import Layout from './shared/components/Layout'
import Login from './features/auth/Login'
import ResetPassword from './features/auth/ResetPassword'
import Overview from './features/overview/Overview'
import EmployeesPage from './features/employees/EmployeesPage'
import VehiclesPage from './features/vehicles/VehiclesPage'
import AnnounceDeviceLinkPage from './features/vehicles/AnnounceDeviceLinkPage'
import RoutesPage from './features/routes/RoutesPage'
import JourneysPage from './features/journeys/JourneysPage'
import SchedulePage from './features/schedule/SchedulePage'
import DutyCardsPage from './features/journeys/DutyCardsPage'
import MobileJourneysPage from './features/journeys/MobileJourneysPage'
import LiveTracking from './features/tracking/LiveTracking'
import RoutePlannerPage from './features/route-planner/RoutePlannerPage'
import BrandingPage from './features/settings/BrandingPage'

function Protected({ session, children }) {
  const location = useLocation()
  // Remember where they were going, so a bookmarked page (e.g. the phone
  // journeys page) comes back after login instead of the desktop home page.
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    let mounted = true

    async function bootstrapAuth() {
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      const type = url.searchParams.get('type')

      // Supabase recovery links can arrive with a one-time code in query params.
      if (code && type === 'recovery') {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error && mounted) {
          setSession(data.session)
        }
        url.search = ''
        window.history.replaceState({}, document.title, `${url.pathname}${url.hash}`)
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (mounted) {
        setSession(session)
      }
    }

    bootstrapAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') navigate('/reset-password')
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
    // Subscribe to auth changes once per mount; re-running on a new `navigate`
    // identity would tear down and re-create the Supabase auth listener.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) {
    return <div className="app-loading">Loading…</div>
  }

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to={location.state?.from ?? '/'} replace /> : <Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/m/journeys"
        element={
          <Protected session={session}>
            <MobileJourneysPage />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected session={session}>
            <Layout session={session} />
          </Protected>
        }
      >
        <Route index element={<SchedulePage />} />
        <Route path="overview" element={<Overview />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="announce-devices" element={<AnnounceDeviceLinkPage />} />
        <Route path="journeys" element={<JourneysPage />} />
        <Route path="duty-cards" element={<DutyCardsPage />} />
        <Route path="route-planner" element={<RoutePlannerPage />} />
        <Route path="live" element={<LiveTracking />} />
        <Route path="settings/branding" element={<BrandingPage session={session} />} />
      </Route>
    </Routes>
  )
}
