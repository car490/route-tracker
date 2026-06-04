import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../shared/supabase'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setError(err.message)
      setLoading(false)
    } else {
      navigate('/')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-name">Phil Haines Coaches</div>
          <div className="login-brand-sub">Operations Dashboard</div>
        </div>
        <p style={{ marginBottom: 20, color: 'var(--text-secondary, #666)' }}>
          Choose a new password for your account.
        </p>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="password">New password</label>
            <input
              id="password"
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoFocus
              minLength={8}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              className="form-input"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={loading}
          >
            {loading ? 'Updating…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
