import { useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId } from '../../shared/company'
import Modal from '../../shared/components/Modal'

// Same origin the driver PWA duty-card links use (DutyCardsPage.jsx) — the
// Announce app is a sibling static page under the same deploy
// (busops/announce/onboard.html, served alongside busops/driver/index.html
// by both server.js locally and GitHub Pages in production).
const PWA_BASE = import.meta.env.DEV ? 'http://localhost:8080' : 'https://car490.github.io/route-tracker'

const EMPTY = { vehicle_id: '', label: '' }

export default function AnnounceDeviceLinkPage() {
  const [devices, setDevices] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add'
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [linkDevice, setLinkDevice] = useState(null) // device row currently showing its install link
  const [link, setLink] = useState(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: deviceRows }, { data: vehicleRows }] = await Promise.all([
      supabase.from('announce_devices').select('*, vehicles(registration)').order('created_at'),
      supabase.from('vehicles').select('id, registration').order('registration'),
    ])
    setDevices(deviceRows ?? [])
    setVehicles(vehicleRows ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() { setForm(EMPTY); setError(''); setModal('add') }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const company_id = await getCompanyId()
    const { data, error: err } = await supabase
      .from('announce_devices')
      .insert({ company_id, vehicle_id: form.vehicle_id || null, label: form.label || null })
      .select()
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(null)
    load()
    generateLink(data)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this Announce device? Its install link will stop working.')) return
    await supabase.from('announce_devices').delete().eq('id', id)
    load()
  }

  // Standalone autopilot only — lets a device matched well outside its
  // normal match window (device deliberately driven to the terminus at an
  // odd hour to test) start anyway, with its stop schedule shifted to now.
  // See scheduleAutopilot.js's findTestingScheduleMatch. Off by default so
  // a live device never takes this path.
  async function toggleTestingMode(device) {
    const testing_mode = !device.testing_mode
    setDevices(ds => ds.map(d => d.id === device.id ? { ...d, testing_mode } : d))
    const { error: err } = await supabase.from('announce_devices').update({ testing_mode }).eq('id', device.id)
    if (err) load() // revert the optimistic flip on failure by re-reading the real row
  }

  // Stateless (no exp claim, see api/sign-announce-token.js) — safe to
  // re-mint on demand any time an installer needs the link again, same
  // on-demand-regeneration pattern as DutyCardsPage.jsx's generateToken().
  async function generateLink(device) {
    setLinkDevice(device)
    setLink(null)
    setLinkError(null)
    setCopied(false)
    setLinkLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/sign-announce-token', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          device_id:  device.id,
          company_id: device.company_id,
          vehicle_id: device.vehicle_id,
        }),
      })
      const data = await res.json()
      if (!res.ok) setLinkError(data.error ?? 'Signing failed')
      // NOT ?announce-token= — that param is already the Standard tier's
      // /sign-feed WebSocket relay secret (onboard.js's connectSignFeed()).
      // ?announce-device-token= is the distinct Lite-tier device JWT param
      // (doc's own standalone-commissioning naming, reused here for paired
      // mode too — see busops/announce/src/announceLiteSetup.js).
      else if (data.token) setLink(`${PWA_BASE}/announce/onboard.html?announce-device-token=${data.token}`)
      else setLinkError('No token returned')
    } catch (err) {
      setLinkError(`fetch failed: ${err.message}`)
    }
    setLinkLoading(false)
  }

  function copyLink() {
    if (!link) return
    navigator.clipboard.writeText(link)
    setCopied(true)
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Announce Lite Devices</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Device</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : devices.length === 0 ? (
            <div className="empty-state">No Announce Lite devices yet. Add one to get started.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>Testing</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id}>
                    <td>{d.label || '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{d.vehicles?.registration ?? '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {d.link_state === 'linked' ? 'Linked to driver device' : 'Standalone'}
                    </td>
                    <td>
                      {d.link_state !== 'linked' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                          <input type="checkbox" checked={!!d.testing_mode} onChange={() => toggleTestingMode(d)} />
                          Testing mode
                        </label>
                      )}
                    </td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => generateLink(d)}>Get Install Link</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal === 'add' && (
        <Modal
          title="Add Announce Device"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Vehicle</label>
              <select
                className="form-select"
                value={form.vehicle_id}
                onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}
                required
                autoFocus
              >
                <option value="" disabled>Select a vehicle…</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">
                Label{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                className="form-input"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Front tablet"
              />
            </div>
          </form>
        </Modal>
      )}

      {linkDevice && (
        <Modal title={`Install Link — ${linkDevice.label || linkDevice.id}`} onClose={() => setLinkDevice(null)}>
          {linkLoading && <div className="empty-state">Generating link…</div>}
          {linkError && <div className="error-msg">{linkError}</div>}
          {link && (
            <div className="form-group">
              <label className="form-label">
                Open this URL once in the tablet's kiosk browser — it registers the device permanently
              </label>
              <input className="form-input" readOnly value={link} onFocus={e => e.target.select()} />
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={copyLink}>
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
