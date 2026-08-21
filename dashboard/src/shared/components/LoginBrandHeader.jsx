// Shown pre-auth (Login/ResetPassword), before we know which operator's
// employee is signing in — so this is the generic CoachMate wordmark, not
// any specific company's name. Per-operator branding (ThemeProvider.jsx)
// only applies once signed in.
export function LoginBrandHeader() {
  return (
    <div className="login-brand">
      <div className="login-brand-name">CoachMate</div>
      <div className="login-brand-sub">Operations Dashboard</div>
    </div>
  )
}
