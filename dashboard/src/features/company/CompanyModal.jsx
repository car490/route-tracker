import { useState, useEffect } from 'react'
import { supabase } from '../../shared/supabase'

const BUCKET = 'company-logos'

const LICENCE_STATUS = {
  lsts_valid:       { label: 'Valid',       badge: 'badge-green' },
  lsts_curtailed:   { label: 'Curtailed',   badge: 'badge-amber' },
  lsts_suspended:   { label: 'Suspended',   badge: 'badge-amber' },
  lsts_revoked:     { label: 'Revoked',     badge: 'badge-red'   },
  lsts_surrendered: { label: 'Surrendered', badge: 'badge-red'   },
  lsts_expired:     { label: 'Expired',     badge: 'badge-red'   },
}

const TRAFFIC_AREAS = [
  'North East of England',
  'North West of England',
  'East of England',
  'West Midlands',
  'West of England',
  'London and the South East of England',
  'Wales',
  'Scotland',
]

const EMPTY_FIELDS = {
  operator_licence_number: '',
  traffic_area:            '',
  companies_house_number:  '',
  name:           '',
  trading_name:   '',
  address_line_1: '',
  address_line_2: '',
  city:           '',
  postcode:       '',
  vehicles_authorised: '',
}

// DVSA CorrespondenceAddress format: "LOCALITY STREET   TOWN  GB AB1 2CD"
// Fields are separated by 2+ spaces; postcode and "GB" country code are appended.
function parseAddress(raw) {
  if (!raw) return {}

  let str = raw.trim()
  let postcode = ''

  const pm = str.match(/\b([A-Z]{1,2}\d[0-9A-Z]?\s?\d[A-Z]{2})\b/i)
  if (pm) {
    postcode = pm[1].replace(/\s+/, ' ').trim()
    str = str.replace(pm[0], '').trim()
  }

  str = str.replace(/\bGB\b/g, '').trim()

  // Split on 2+ spaces — the DVSA file uses multiple spaces as field delimiters
  const parts = str.split(/\s{2,}/).map(p => p.trim()).filter(Boolean)

  let line1 = '', line2 = '', city = ''
  if (parts.length >= 3) {
    city  = parts[parts.length - 1]
    line2 = parts[parts.length - 2]
    line1 = parts.slice(0, -2).join(', ')
  } else if (parts.length === 2) {
    city  = parts[1]
    line1 = parts[0]
  } else if (parts.length === 1) {
    line1 = parts[0]
  }

  return { address_line_1: line1, address_line_2: line2, city, postcode }
}

export default function CompanyModal({ companyId, currentLogoPath, onClose, onSaved }) {
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  // Logo state
  const [file, setFile]               = useState(null)
  const [preview, setPreview]         = useState(null)
  const [removeLogo, setRemoveLogo]   = useState(false)

  // DVSA lookup state
  const [looking, setLooking]         = useState(false)
  const [lookupError, setLookupError] = useState(null)
  const [licenceStatus, setLicenceStatus] = useState(null)

  // Company fields
  const [fields, setFields] = useState(EMPTY_FIELDS)

  useEffect(() => {
    supabase
      .from('companies')
      .select('operator_licence_number, traffic_area, companies_house_number, name, trading_name, address_line_1, address_line_2, city, postcode, vehicles_authorised')
      .eq('id', companyId)
      .single()
      .then(({ data }) => {
        if (data) {
          setFields({
            operator_licence_number: data.operator_licence_number ?? '',
            traffic_area:            data.traffic_area            ?? '',
            companies_house_number:  data.companies_house_number  ?? '',
            vehicles_authorised:     data.vehicles_authorised     ?? '',
            name:           data.name           ?? '',
            trading_name:   data.trading_name   ?? '',
            address_line_1: data.address_line_1 ?? '',
            address_line_2: data.address_line_2 ?? '',
            city:           data.city           ?? '',
            postcode:       data.postcode       ?? '',
          })
        }
        setLoading(false)
      })
  }, [companyId])

  const set = key => e => setFields(f => ({ ...f, [key]: e.target.value }))

  const displayUrl = preview
    ? preview
    : removeLogo || !currentLogoPath
      ? null
      : supabase.storage.from(BUCKET).getPublicUrl(currentLogoPath).data.publicUrl

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setRemoveLogo(false)
  }

  async function handleLookup() {
    if (!fields.operator_licence_number.trim()) return
    setLooking(true)
    setLookupError(null)
    setLicenceStatus(null)

    if (!fields.traffic_area) {
      setLookupError('Select a traffic area before looking up')
      setLooking(false)
      return
    }

    const { data, error: fnErr } = await supabase.functions.invoke('dvsa-vol-lookup', {
      body: { licence_number: fields.operator_licence_number, traffic_area: fields.traffic_area },
    })

    if (fnErr || data?.error) {
      setLookupError(data?.error ?? fnErr.message)
      setLooking(false)
      return
    }

    const addr = parseAddress(data.correspondence_address)
    setFields(f => ({
      ...f,
      name:                f.name.trim() ? f.name : data.operator_name,
      trading_name:        data.operator_name,
      traffic_area:        data.geographic_region || f.traffic_area,
      vehicles_authorised: data.number_of_vehicles_authorised ?? '',
      ...addr,
    }))
    setLicenceStatus(data.licence_status ?? null)
    setLooking(false)
  }

  async function handleSave() {
    if (!fields.name.trim())                     { setError('Registered name is required'); return }
    if (!fields.operator_licence_number.trim())  { setError('Operator licence number is required'); return }
    setSaving(true)
    setError(null)

    let newLogoPath = removeLogo ? null : currentLogoPath

    if (file) {
      const ext        = file.name.split('.').pop().toLowerCase()
      const uploadPath = `${companyId}/logo.${ext}`
      if (currentLogoPath && currentLogoPath !== uploadPath) {
        await supabase.storage.from(BUCKET).remove([currentLogoPath])
      }
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET).upload(uploadPath, file, { upsert: true, contentType: file.type })
      if (uploadErr) { setError(uploadErr.message); setSaving(false); return }
      newLogoPath = uploadPath
    } else if (removeLogo && currentLogoPath) {
      const { error: removeErr } = await supabase.storage.from(BUCKET).remove([currentLogoPath])
      if (removeErr) { setError(removeErr.message); setSaving(false); return }
    }

    const { error: updateErr } = await supabase
      .from('companies')
      .update({
        ...fields,
        companies_house_number:  fields.companies_house_number.trim()  || null,
        trading_name:            fields.trading_name.trim()            || null,
        address_line_2:          fields.address_line_2.trim()          || null,
        vehicles_authorised:     fields.vehicles_authorised !== '' ? Number(fields.vehicles_authorised) : null,
        logo_path: newLogoPath,
      })
      .eq('id', companyId)

    if (updateErr) { setError(updateErr.message); setSaving(false); return }
    setSaving(false)
    onSaved(newLogoPath)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-card modal-card--wide">
        <div className="modal-header">Company Settings</div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : (<>

            <div className="form-section-label">Logo</div>
            {displayUrl && (
              <div className="form-group">
                <img src={displayUrl} alt="Logo" className="logo-modal-preview" />
              </div>
            )}
            <div className="form-row-inline">
              <div style={{ flex: 1 }}>
                <label className="form-label">{displayUrl ? 'Replace image' : 'Upload image'}</label>
                <input type="file" accept="image/*" onChange={handleFileChange} className="form-input" />
              </div>
              {currentLogoPath && !file && !removeLogo && (
                <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-end' }}
                  onClick={() => setRemoveLogo(true)} disabled={saving}>
                  Remove
                </button>
              )}
              {removeLogo && (
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }}
                  onClick={() => setRemoveLogo(false)}>
                  Undo
                </button>
              )}
            </div>

            <div className="form-section-label">Operator Licence (DVSA)</div>
            <div className="form-group">
              <label className="form-label">Traffic area</label>
              <select className="form-select" value={fields.traffic_area} onChange={set('traffic_area')}>
                <option value="">Select traffic area…</option>
                {TRAFFIC_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Licence number</label>
              <div className="form-row-inline">
                <input
                  className="form-input"
                  value={fields.operator_licence_number}
                  onChange={set('operator_licence_number')}
                  placeholder="e.g. PB1234567"
                  style={{ flex: 1 }}
                />
                {licenceStatus && (() => {
                  const s = LICENCE_STATUS[licenceStatus] ?? { label: licenceStatus, badge: 'badge-gray' }
                  return <span className={`badge ${s.badge}`} style={{ alignSelf: 'center' }}>{s.label}</span>
                })()}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleLookup}
                  disabled={!fields.operator_licence_number.trim() || looking}
                >
                  {looking ? 'Looking up…' : 'Look up'}
                </button>
              </div>
              {lookupError && (
                <div className="error-msg" style={{ marginTop: 8, marginBottom: 0 }}>{lookupError}</div>
              )}
            </div>

            <div className="form-section-label">Details</div>
            <div className="form-group">
              <label className="form-label">Registered name</label>
              <input className="form-input" value={fields.name} onChange={set('name')} />
            </div>
            <div className="form-group">
              <label className="form-label">Trading name</label>
              <input className="form-input" value={fields.trading_name} onChange={set('trading_name')}
                placeholder="If different from registered name" />
            </div>
            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label">Companies House number</label>
                <input className="form-input" value={fields.companies_house_number}
                  onChange={set('companies_house_number')} placeholder="Optional" maxLength={8} />
              </div>
              <div className="form-group">
                <label className="form-label">Vehicles authorised</label>
                <input className="form-input" value={fields.vehicles_authorised}
                  onChange={set('vehicles_authorised')} type="number" min={0} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Address line 1</label>
              <input className="form-input" value={fields.address_line_1} onChange={set('address_line_1')} />
            </div>
            <div className="form-group">
              <label className="form-label">Address line 2</label>
              <input className="form-input" value={fields.address_line_2} onChange={set('address_line_2')} />
            </div>
            <div className="form-row-grid">
              <div className="form-group">
                <label className="form-label">City</label>
                <input className="form-input" value={fields.city} onChange={set('city')} />
              </div>
              <div className="form-group">
                <label className="form-label">Postcode</label>
                <input className="form-input" value={fields.postcode} onChange={set('postcode')} />
              </div>
            </div>

          </>)}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
