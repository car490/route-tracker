import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './shared/supabase'
import Layout from './shared/components/Layout'
import Login from './features/auth/Login'
import Overview from './features/overview/Overview'
import DriversPage from './features/staff/DriversPage'
import VehiclesPage from './features/vehicles/VehiclesPage'
import RoutesPage from './features/routes/RoutesPage'
import JourneysPage from './features/journeys/JourneysPage'
import SchedulePage from './features/schedule/SchedulePage'
import DutyCardsPage from './features/journeys/DutyCardsPage'
import LiveTracking from './features/tracking/LiveTracking'
import ExcursionsPage from './features/excursions/ExcursionsPage'
import RoutePlannerPage from './features/route-planner/RoutePlannerPage'

function Protected({ session, children }) {
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="app-loading">Loading…</div>
  }

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
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
        <Route path="drivers" element={<DriversPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="journeys" element={<JourneysPage />} />
        <Route path="duty-cards" element={<DutyCardsPage />} />
        <Route path="excursions" element={<ExcursionsPage />} />
        <Route path="route-planner" element={<RoutePlannerPage />} />
        <Route path="live" element={<LiveTracking />} />
      </Route>
    </Routes>
  )
}
