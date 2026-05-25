import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../supabase'
import { useCurrentEmployee } from '../hooks/useCurrentEmployee'
import LogoUploadModal from '../../features/company/LogoUploadModal'

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
      { to: '/routes',     label: 'Routes & Timetables' },
      { to: '/overview',   label: 'Overview' },
      { to: '/live',       label: 'Live Tracking' },
    ],
  },
]

const MORE_PATHS = ['/journeys', '/routes', '/overview', '/live']
const CAN_EDIT_LOGO = ['super_user', 'ops_manager']
const BUCKET = 'company-logos'

export default function Layout({ session }) {
  const location = useLocation()
  const moreIsActive = MORE_PATHS.some(p => location.pathname.startsWith(p))
  const [moreOpen, setMoreOpen] = useState(moreIsActive)
  const [logoModalOpen, setLogoModalOpen] = useState(false)
  const [logoPathOverride, setLogoPathOverride] = useState(undefined)

  const employee = useCurrentEmployee(session.user.id)
  const canEditLogo = employee && CAN_EDIT_LOGO.includes(employee.role)

  // Use override after upload/delete; fall back to DB value while loading
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
          {NAV.map((item) =>
            item.section === 'More' ? (
              <div key="More" className="sidebar-section">
                <button
                  className={`sidebar-section-toggle${moreIsActive ? ' sidebar-section-toggle--active' : ''}`}
                  onClick={() => setMoreOpen(o => !o)}
                >
                  <span>More</span>
                  <span className={`sidebar-section-chevron${moreOpen ? ' open' : ''}`}>›</span>
                </button>
                {moreOpen && item.items.map(({ to, label, end }) => (
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
            ) : item.section ? (
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
          {employee?.role && (
            <div className="sidebar-role">{employee.role.replace('_', ' ')}</div>
          )}
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

      {logoModalOpen && employee && (
        <LogoUploadModal
          companyId={employee.company_id}
          currentLogoPath={logoPath}
          onClose={() => setLogoModalOpen(false)}
          onSaved={handleLogoSaved}
        />
      )}
    </div>
  )
}
