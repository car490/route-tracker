import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../shared/supabase'
import Modal from '../../shared/components/Modal'
import {
  SOLO_DEFAULTS,
  SOLO_LIMITS,
  toDepartureOption,
  validateSoloSettings,
  findSoloWarnings,
} from './soloSetup'

// Sets which departures an Announce Solo sign runs and when it may start one
// by itself (announce_devices.candidate_departure_ids, match_window_before_min,
// match_window_after_min, terminus_radius_m). Was SQL only until 2026-10-03
// (docs/SOLO-COMMISSIONING.md). The running sign picks a change up by itself
// (its hourly re-read and Realtime row updates) — no visit to the bus needed.
// The departures list is the company's own (RLS company_all); the server also
// refuses another company's departure ids
// (supabase/migration_announce_device_candidate_company_check.sql).
export default function SoloSetupModal({ device, onClose, onSaved }) {
  const [options, setOptions] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [chosen, setChosen] = useState(device.candidate_departure_ids ?? [])
  const [settings, setSettings] = useState({
    beforeMin: device.match_window_before_min ?? SOLO_DEFAULTS.beforeMin,
    afterMin:  device.match_window_after_min ?? SOLO_DEFAULTS.afterMin,
    radiusM:   device.terminus_radius_m ?? SOLO_DEFAULTS.radiusM,
  })
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('timetable_departures')
      .select('id, departure_time, days_of_week, school_term_time, timetable:timetables(name, route:routes(id, service_code, destination), timetable_stops(sequence, stop:stops(id, name, lat, lon)))')
      .order('departure_time')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setLoadError(error.message); return }
        const list = (data ?? []).map(toDepartureOption)
        list.sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { numeric: true }))
        setOptions(list)
      })
    return () => { cancelled = true }
  }, [])

  const errors = validateSoloSettings(settings)
  const warnings = useMemo(
    () => (options && errors.length === 0 ? findSoloWarnings(chosen, options, settings) : []),
    [options, chosen, settings, errors.length],
  )
  // A warning needs a tick before saving; a change to the choice asks again.
  const blocked = !options || errors.length > 0 || (warnings.length > 0 && !acknowledged)

  function toggle(id) {
    setAcknowledged(false)
    setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]))
  }

  function setField(key, value) {
    setAcknowledged(false)
    setSettings(s => ({ ...s, [key]: value }))
  }

  async function handleSave() {
    if (blocked) return
    setSaving(true); setSaveError('')
    const known = new Set(options.map(o => o.id))
    const { error } = await supabase
      .from('announce_devices')
      .update({
        candidate_departure_ids: chosen.filter(id => known.has(id)),
        match_window_before_min: Number(settings.beforeMin),
        match_window_after_min:  Number(settings.afterMin),
        terminus_radius_m:       Number(settings.radiusM),
      })
      .eq('id', device.id)
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    onSaved()
  }

  const numberField = (key, label) => (
    <div className="form-group" style={{ flex: 1 }}>
      <label className="form-label" htmlFor={`solo-${key}`}>{label}</label>
      <input
        id={`solo-${key}`}
        className="form-input"
        type="number"
        inputMode="numeric"
        step="1"
        min={SOLO_LIMITS[key].min}
        max={SOLO_LIMITS[key].max}
        value={settings[key]}
        onChange={e => setField(key, e.target.value)}
      />
    </div>
  )

  return (
    <Modal
      wide
      title={`Solo set-up — ${device.label || device.vehicles?.registration || device.id}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={blocked || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {loadError && <div className="error-msg">Could not load departures: {loadError}</div>}
      {saveError && <div className="error-msg">Not saved: {saveError}</div>}

      <p style={{ marginTop: 0, fontSize: 14 }}>
        The sign starts one of these departures by itself when the bus is near its first stop at about
        its departure time. Only choose departures this bus runs, on routes no other service starts or
        ends on. The sign picks up a change within the hour, with no visit to the bus.
      </p>

      <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
        <legend className="form-label">Departures this sign runs</legend>
        {!options && !loadError && <div className="empty-state">Loading departures…</div>}
        {options && options.length === 0 && <div className="empty-state">No departures in your timetables yet.</div>}
        {options && options.length > 0 && (
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {options.map(o => (
              <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={chosen.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>
                  {o.label}
                  {o.firstStop && (
                    <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 13 }}>
                      From {o.firstStop.name}{o.lastStop ? ` to ${o.lastStop.name}` : ''}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {numberField('beforeMin', 'Minutes before the departure time')}
        {numberField('afterMin', 'Minutes after the departure time')}
        {numberField('radiusM', 'Distance from the first stop (metres)')}
      </div>
      <p style={{ marginTop: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Defaults: {SOLO_DEFAULTS.beforeMin} minutes before, {SOLO_DEFAULTS.afterMin} minutes after,{' '}
        {SOLO_DEFAULTS.radiusM} metres.
      </p>

      {errors.map(e => <div key={e} className="error-msg">{e}</div>)}

      {warnings.length > 0 && (
        <div className="warning-msg" role="alert">
          <strong>Check before saving:</strong>
          <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
            {warnings.map(w => <li key={w}>{w}</li>)}
          </ul>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
            <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
            I have checked these and want to save anyway
          </label>
        </div>
      )}
    </Modal>
  )
}
