import { useState } from 'react'
import { supabase } from '../../shared/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setLoading(false)
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError('Enter your email first, then click Forgot password')
      setInfo('')
      return
    }

    setError('')
    setInfo('')
    setSendingReset(true)

    const redirectTo = `${window.location.origin}/reset-password`
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    if (err) {
      setError(err.message)
    } else {
      setInfo('Reset email sent. Open the link from your email on this device/browser.')
    }

    setSendingReset(false)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-name">Phil Haines Coaches</div>
          <div className="login-brand-sub">Operations Dashboard</div>
        </div>
        {info && <div style={{ marginBottom: 12, color: 'var(--green-dark)', fontSize: 13 }}>{info}</div>}
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
            disabled={sendingReset}
            onClick={handleForgotPassword}
          >
            {sendingReset ? 'Sending reset…' : 'Forgot password'}
          </button>
        </form>
      </div>
    </div>
  )
}
