import { useState, useEffect } from 'react'
import Papa from 'papaparse'
import { supabase } from '../../shared/supabase'

const BUCKET  = 'company-logos'
const VOL_URL = 'https://assets.publishing.service.gov.uk/media/65f1e3e68a2f410012b1e3e8/vol-public-service-vehicle-operator-licences.csv'

const EMPTY_FIELDS = {
  operator_licence_number: '',
  companies_house_number:  '',
  name:           '',
  trading_name:   '',
  address_line_1: '',
  address_line_2: '',
  city:           '',
  postcode:       '',
}

// Best-effort parse of a single address string into structured fields.
// UK addresses are typically: Line1, Line2?, Town, Postcode
function parseAddress(raw) {
  if (!raw) return {}
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean)
  const ukPostcode = /^[A-Z]{1,2}\d[0-9A-Z]?\s?\d[A-Z]{2}$/i
  let postcode = '', city = '', line1 = '', line2 = ''
  if (parts.length && ukPostcode.test(parts[parts.length - 1])) postcode = parts.pop()
  if (parts.length) city    = parts.pop()
  if (parts.length) line1   = parts.shift()
  if (parts.length) line2   = parts.join(', ')
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
      .select('operator_licence_number, companies_house_number, name, trading_name, address_line_1, address_line_2, city, postcode')
      .eq('id', companyId)
      .single()
      .then(({ data }) => {
        if (data) {
          setFields({
            operator_licence_number: data.operator_licence_number ?? '',
            companies_house_number:  data.companies_house_number  ?? '',
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

    try {
      const res = await fetch(VOL_URL, { cache: 'no-cache' })
      const csv = await res.text()
      Papa.parse(csv, {
        header: true,
        complete: ({ data }) => {
          const match = data.find(
            row => row['LicenceNumber']?.toUpperCase() === fields.operator_licence_number.trim().toUpperCase()
          )
          if (!match) {
            setLookupError('Licence number not found in DVSA dataset')
            setLooking(false)
            return
          }
          const addr = parseAddress(match['CorrespondenceAddress'])
          setFields(f => ({
            ...f,
            // Only overwrite name if it's blank — user may have set it manually
            name:         f.name.trim() ? f.name : (match['TradingName'] ?? ''),
            trading_name: match['TradingName'] ?? '',
            ...addr,
          }))
          setLicenceStatus(match['LicenceStatus'] ?? null)
          setLooking(false)
        },
        error: () => {
          setLookupError('Failed to parse DVSA dataset')
          setLooking(false)
        },
      })
    } catch {
      setLookupError('Failed to fetch DVSA dataset')
      setLooking(false)
    }
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
              <label className="form-label">Licence number</label>
              <div className="form-row-inline">
                <input
                  className="form-input"
                  value={fields.operator_licence_number}
                  onChange={set('operator_licence_number')}
                  placeholder="e.g. PB1234567"
                  style={{ flex: 1 }}
                />
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
              {licenceStatus && (
                <div style={{ marginTop: 8 }}>
                  <span className={`badge ${licenceStatus === 'Valid' ? 'badge-green' : 'badge-amber'}`}>
                    {licenceStatus}
                  </span>
                </div>
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
            <div className="form-group">
              <label className="form-label">Companies House number</label>
              <input className="form-input" value={fields.companies_house_number}
                onChange={set('companies_house_number')} placeholder="8-character number (optional)" maxLength={8} />
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
