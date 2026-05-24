import { Outlet, NavLink } from 'react-router-dom'
import { supabase } from '../supabase'

const NAV = [
  { to: '/',              label: 'Schedule',           end: true },
  { to: '/duty-cards',    label: 'Duty Cards' },
  { to: '/route-planner', label: 'Route Planner' },
  {
    section: 'Company',
    items: [
      { to: '/employees', label: 'Employees' },
      { to: '/vehicles',  label: 'Vehicles' },
    ],
  },
  {
    section: 'More',
    items: [
      { to: '/journeys',   label: 'Daily Journeys' },
      { to: '/excursions', label: 'Excursions' },
      { to: '/routes',     label: 'Routes & Timetables' },
      { to: '/overview',   label: 'Overview' },
      { to: '/live',       label: 'Live Tracking' },
    ],
  },
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
          {NAV.map((item) =>
            item.section ? (
              <div key={item.section} className="sidebar-section">
                <div className="sidebar-section-label">{item.section}</div>
                {item.items.map(({ to, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => `sidebar-child${isActive ? ' active' : ''}`}
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => isActive ? 'active' : undefined}
              >
                {item.label}
              </NavLink>
            )
          )}
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-user">{session.user.email}</div>
          <button className="btn-signout" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.5, marginTop: 8 }}>v2.0 · build 12</div>
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
