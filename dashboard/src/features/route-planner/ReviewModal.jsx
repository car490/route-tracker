import { Fragment } from 'react'
import { S } from './constants'
import { fmtDist, fmtDur, stopColor, timeToMinutes, minutesToTime, buildSegAfterMap } from './utils'

function applyAutoFill(depTime, baseStops, routeResult) {
  if (!depTime) return baseStops
  const baseMins = timeToMinutes(depTime)
  const segs = routeResult?.segments ?? []

  let cumMins = 0
  const minsById = {}
  baseStops
    .filter(s => s.lat != null && s.lon != null)
    .forEach((s, i) => {
      minsById[s._id] = baseMins + cumMins
      if (segs[i] && !segs[i].error) cumMins += Math.round(segs[i].duration / 60)
    })

  return baseStops.map(s => {
    if (s.stop_type !== 'timing_point' || minsById[s._id] == null) return s
    return { ...s, time_std: minutesToTime(minsById[s._id]) }
  })
}

export default function ReviewModal({
  modalStops, setModalStops,
  routeResult,
  confirmCode, confirmName, confirmJTypes, confirmTt,
  vehicleType, vehicle,
  warnings,
  autoDepTime, setAutoDepTime,
  saving, saveError,
  onClose, onSave,
}) {
  const segAfterStop = buildSegAfterMap(modalStops, routeResult?.segments)

  function updateModalStop(i, field, value) {
    setModalStops(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', width: '100%', maxWidth: 540, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', padding: 24 }}>

        <h2 style={{ fontFamily: 'Oswald', fontSize: 20, fontWeight: 700, color: 'var(--navy-brand)', margin: '0 0 16px' }}>
          Review Route
        </h2>

        <div style={{ marginBottom: 16 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 6 }}>Route</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {confirmCode && <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 18, color: 'var(--navy-brand)' }}>{confirmCode}</span>}
            {confirmName && <span style={{ fontSize: 14, color: 'var(--text)' }}>{confirmName}</span>}
            {confirmJTypes.map(jt => (
              <span key={jt} style={{ fontSize: 10, fontFamily: 'Oswald', fontWeight: 700, background: 'var(--navy-brand)', color: '#fff', borderRadius: 8, padding: '1px 7px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{jt}</span>
            ))}
          </div>
          {confirmTt && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{confirmTt}</div>}
          {vehicleType.length > 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {vehicleType.join(', ')}
              {vehicle && ` — H ${vehicle.height_metres}m · W ${vehicle.width_metres}m · L ${vehicle.length_metres}m`}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
            <span style={S.sectionLabel}>Stops ({modalStops.length})</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Departs</span>
              <input
                type="time"
                className="form-input"
                style={{ width: 95, height: 26, fontSize: 12, padding: '1px 4px' }}
                value={autoDepTime}
                title="Enter departure time to auto-fill timing points"
                onChange={e => {
                  setAutoDepTime(e.target.value)
                  if (e.target.value) setModalStops(prev => applyAutoFill(e.target.value, prev, routeResult))
                }}
              />
            </div>
          </div>

          {modalStops.map((s, i) => {
            const color    = stopColor(i, modalStops.length)
            const segAfter = segAfterStop[s._id]
            return (
              <Fragment key={s._id}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Oswald', fontWeight: 700, fontSize: 10, flexShrink: 0, marginTop: 1 }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: s.stop_type === 'timing_point' ? 5 : 0 }}>
                      {s.name}
                    </div>
                    {s.stop_type === 'timing_point' ? (
                      <div>
                        <input type="time" className="form-input"
                          style={{ fontSize: 11, height: 24, padding: '1px 3px', width: '100%' }}
                          value={s.time_std}
                          onChange={e => updateModalStop(i, 'time_std', e.target.value)}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Oswald', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>via</div>
                    )}
                  </div>
                </div>
                {i < modalStops.length - 1 && segAfter && !segAfter.error && (
                  <div style={{ paddingLeft: 30, fontSize: 11, fontFamily: 'Oswald', fontWeight: 700, color: 'var(--text-muted)', display: 'flex', gap: 5, marginBottom: 6 }}>
                    <span>↓</span>
                    <span>{fmtDur(segAfter.duration)}</span>
                    <span style={{ fontWeight: 400, fontSize: 10 }}>·</span>
                    <span style={{ fontWeight: 400 }}>{fmtDist(segAfter.distance)}</span>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>

        {routeResult && !routeResult.error && (
          <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--bg)', borderRadius: 6, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 20, color: 'var(--navy-brand)' }}>
              {fmtDist(routeResult.distance)}
            </span>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              {fmtDur(routeResult.duration)}
            </span>
            {warnings.map((w, idx) => (
              <div key={idx} style={{ fontSize: 12, color: '#d69e2e', display: 'flex', gap: 4 }}>
                <span>⚠</span><span>{w.message ?? `Routing warning (code ${w.code})`}</span>
              </div>
            ))}
          </div>
        )}

        {saveError && <div className="error-msg" style={{ marginBottom: 12 }}>{saveError}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Back to edit
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => onSave(modalStops)}>
            {saving ? 'Saving…' : 'Save Route'}
          </button>
        </div>
      </div>
    </div>
  )
}
