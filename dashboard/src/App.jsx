import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import DriversPage from './pages/DriversPage'
import VehiclesPage from './pages/VehiclesPage'
import RoutesPage from './pages/RoutesPage'
import JourneysPage from './pages/JourneysPage'
import LiveTracking from './pages/LiveTracking'

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
        <Route index element={<Overview />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="journeys" element={<JourneysPage />} />
        <Route path="live" element={<LiveTracking />} />
      </Route>
    </Routes>
  )
}
