import { Outlet, NavLink } from 'react-router-dom'
import { supabase } from '../supabase'
import { useCurrentEmployee } from '../hooks/useCurrentEmployee'
import CompanyModal from '../../features/company/CompanyModal'
import { useState } from 'react'

/* ── Inline SVG icon set ───────────────────────────────────── */
function Icon({ children }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

const NavIcons = {
  schedule: (
    <Icon>
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </Icon>
  ),
  live: (
    <Icon>
      <circle cx="12" cy="12" r="2"/>
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
    </Icon>
  ),
  duties: (
    <Icon>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      <line x1="9" y1="12" x2="15" y2="12"/>
      <line x1="9" y1="16" x2="13" y2="16"/>
    </Icon>
  ),
  planner: (
    <Icon>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
      <line x1="8" y1="2" x2="8" y2="18"/>
      <line x1="16" y1="6" x2="16" y2="22"/>
    </Icon>
  ),
  drivers: (
    <Icon>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </Icon>
  ),
  vehicles: (
    <Icon>
      <rect x="1" y="3" width="15" height="13" rx="1"/>
      <path d="M16 8h4l3 3v5h-7V8z"/>
      <circle cx="5.5" cy="18.5" r="2.5"/>
      <circle cx="18.5" cy="18.5" r="2.5"/>
    </Icon>
  ),
  routes: (
    <Icon>
      <line x1="6" y1="3" x2="6" y2="15"/>
      <circle cx="18" cy="6" r="3"/>
      <circle cx="6" cy="18" r="3"/>
      <path d="M18 9a9 9 0 0 1-9 9"/>
    </Icon>
  ),
  journeys: (
    <Icon>
      <line x1="8" y1="6" x2="21" y2="6"/>
      <line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/>
      <line x1="3" y1="18" x2="3.01" y2="18"/>
    </Icon>
  ),
  overview: (
    <Icon>
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </Icon>
  ),
}

const NAV = [
  { to: '/',              label: 'Schedule',         end: true, icon: 'schedule' },
  { to: '/live',          label: 'Live Tracking',    icon: 'live' },
  { to: '/duty-cards',    label: 'Duty Cards',       icon: 'duties' },
  { to: '/route-planner', label: 'Route Planner',    icon: 'planner' },
  { divider: true },
  { to: '/employees',     label: 'Drivers',          icon: 'drivers' },
  { to: '/vehicles',      label: 'Vehicles',         icon: 'vehicles' },
  { divider: true },
  { to: '/routes',        label: 'Routes',           icon: 'routes' },
  { to: '/journeys',      label: 'Daily Journeys',   icon: 'journeys' },
  { to: '/overview',      label: 'Overview',         icon: 'overview' },
]

const CAN_EDIT_LOGO = ['super_user', 'ops_manager']
const BUCKET = 'company-logos'

export default function Layout({ session }) {
  const [logoModalOpen, setLogoModalOpen] = useState(false)
  const [logoPathOverride, setLogoPathOverride] = useState(undefined)

  const employee = useCurrentEmployee(session.user.id)
  const canEditLogo = employee && CAN_EDIT_LOGO.includes(employee.access_level)

  const logoPath = logoPathOverride !== undefined
    ? logoPathOverride
    : employee?.companies?.logo_path ?? null

  const logoUrl = logoPath
    ? supabase.storage.from(BUCKET).getPublicUrl(logoPath).data.publicUrl
    : null

  function handleLogoSaved(newPath) {
    setLogoPathOverride(newPath)
    setLogoModalOpen(false)
  }

  return (
    <div className="layout">
      <nav className="sidebar">
        <div
          className={`sidebar-brand${canEditLogo ? ' sidebar-brand--editable' : ''}`}
          onClick={() => canEditLogo && setLogoModalOpen(true)}
          title={canEditLogo ? 'Click to update logo' : undefined}
        >
          <div className="sidebar-logo-wrap">
            {logoUrl
              ? <img src={logoUrl} alt="Company logo" className="sidebar-logo" />
              : <div className="sidebar-logo-placeholder">
                  {canEditLogo ? 'Add logo' : ''}
                </div>
            }
            {canEditLogo && (
              <div className="sidebar-logo-edit">
                {logoUrl ? 'Change logo' : 'Add logo'}
              </div>
            )}
          </div>
          <div className="sidebar-brand-sub">Operations</div>
        </div>

        <div className="sidebar-nav">
          {NAV.map((item, i) =>
            item.divider ? (
              <div key={`divider-${i}`} className="sidebar-divider" />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => isActive ? 'active' : undefined}
              >
                {NavIcons[item.icon]}
                {item.label}
              </NavLink>
            )
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">{session.user.email}</div>
          {employee?.access_level && (
            <div className="sidebar-role">{employee.access_level.replace(/_/g, ' ')}</div>
          )}
          <button className="btn-signout" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
          <div className="sidebar-coachmate">
            <span className="cm-coach">COACH</span><span className="cm-mate">Mate</span>
          </div>
        </div>
      </nav>

      <main className="main">
        <div className="page">
          <Outlet />
        </div>
      </main>

      {logoModalOpen && employee && (
        <CompanyModal
          companyId={employee.company_id}
          currentLogoPath={logoPath}
          onClose={() => setLogoModalOpen(false)}
          onSaved={handleLogoSaved}
        />
      )}
    </div>
  )
}
