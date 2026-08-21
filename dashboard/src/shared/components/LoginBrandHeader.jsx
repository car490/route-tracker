// Shown pre-auth (Login/ResetPassword), before we know which operator's
// employee is signing in — so this is the generic PCV Dashboard wordmark,
// not any specific company's name. Per-operator branding (ThemeProvider.jsx)
// only applies once signed in.
export function LoginBrandHeader() {
  return (
    <div className="login-brand">
      <div className="login-brand-name">PCV Dashboard</div>
      <div className="login-brand-sub">From PCV Technologies</div>
    </div>
  )
}
