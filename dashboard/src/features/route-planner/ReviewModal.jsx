import { Fragment } from 'react'
import { S } from './constants'
import { fmtDist, fmtDur, stopColor, buildSegAfterMap, timeToMinutes, minutesToTime, getScheduledMin, totalScheduledDuration } from './utils'

export default function ReviewModal({
  modalStops, setModalStops,
  routeResult,
  confirmCode, confirmName, confirmJTypes, confirmTt,
  vehicleType, vehicle,
  warnings,
  isNewTimetable, newTtName, setNewTtName,
  saving, saveError,
  onClose, onSave,
}) {
  const segAfterStop = buildSegAfterMap(modalStops, routeResult?.segments)

  function updateModalStop(i, field, value) {
    setModalStops(prev => {
      const updated = prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s)
      if (field !== 'time_std' || !value) return updated
      const baseMins = timeToMinutes(value)
      if (baseMins == null) return updated
      const segsMap = buildSegAfterMap(updated, routeResult?.segments)
      let cumSecs = 0
      for (let j = i; j < updated.length - 1; j++) {
        const seg = segsMap[updated[j]._id]
        if (seg && !seg.error) cumSecs += seg.duration
        const next = updated[j + 1]
        if (next.stop_type === 'timing_point')
          updated[j + 1] = { ...next, time_std: minutesToTime(baseMins + Math.round(cumSecs / 60)) }
      }
      return updated
    })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', width: '100%', maxWidth: 540, maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', padding: 24 }}>

        <h2 style={{ fontFamily: 'Oswald', fontSize: 20, fontWeight: 700, color: 'var(--navy-brand)', margin: '0 0 16px', flexShrink: 0 }}>
          Review Route
        </h2>

        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 6 }}>Route</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {confirmCode && <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 18, color: 'var(--navy-brand)', flexShrink: 0 }}>{confirmCode}</span>}
            {isNewTimetable
              ? <input type="text" className="form-input" style={{ fontSize: 14, flex: 1, minWidth: 0 }}
                  value={newTtName} onChange={e => setNewTtName(e.target.value)} />
              : confirmName && <span style={{ fontSize: 14, color: 'var(--text)' }}>{confirmName}</span>
            }
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

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
          <div style={{ marginBottom: 8, flexShrink: 0 }}>
            <span style={S.sectionLabel}>Stops ({modalStops.length})</span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {modalStops.map((s, i) => {
              const color       = stopColor(i, modalStops.length)
              const segAfter    = segAfterStop[s._id]
              const scheduledMin = getScheduledMin(s, modalStops[i + 1])
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
                      <span>{scheduledMin != null ? `${scheduledMin} min` : fmtDur(segAfter.duration)}</span>
                      <span style={{ fontWeight: 400, fontSize: 10 }}>·</span>
                      <span style={{ fontWeight: 400 }}>{fmtDist(segAfter.distance)}</span>
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>

        {routeResult && !routeResult.error && (
          <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--bg)', borderRadius: 6, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <span style={{ fontFamily: 'Oswald', fontWeight: 700, fontSize: 20, color: 'var(--navy-brand)' }}>
              {fmtDist(routeResult.distance)}
            </span>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              {fmtDur(totalScheduledDuration(modalStops, segAfterStop))}
            </span>
            {warnings.map((w, idx) => (
              <div key={idx} style={{ fontSize: 12, color: '#d69e2e', display: 'flex', gap: 4 }}>
                <span>⚠</span><span>{w.message ?? `Routing warning (code ${w.code})`}</span>
              </div>
            ))}
          </div>
        )}

        {saveError && <div className="error-msg" style={{ marginBottom: 12, flexShrink: 0 }}>{saveError}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Back to edit
          </button>
          <button className="btn btn-primary" disabled={saving || (isNewTimetable && !newTtName.trim())} onClick={() => onSave(modalStops)}>
            {saving ? 'Saving…' : 'Save Route'}
          </button>
        </div>
      </div>
    </div>
  )
}
