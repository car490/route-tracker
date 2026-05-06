import { Outlet, NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const NAV = [
  { to: '/',         label: 'Overview',             end: true },
  { to: '/routes',   label: 'Routes & Timetables' },
  { to: '/drivers',  label: 'Drivers' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/journeys', label: 'Daily Journeys' },
  { to: '/live',     label: 'Live Tracking' },
]

export default function Layout({ session }) {
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-name">Phil Haines Coaches</div>
          <div className="sidebar-brand-sub">Operations</div>
        </div>
        <div className="sidebar-nav">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => isActive ? 'active' : undefined}
            >
              {label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-user">{session.user.email}</div>
          <button className="btn-signout" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="main">
        <div className="page">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
