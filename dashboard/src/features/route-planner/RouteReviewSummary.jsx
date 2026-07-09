import { Fragment } from 'react'
import { S } from './constants'
import { fmtDist, fmtDur, stopColor, buildSegAfterMap, timeToMinutes, minutesToTime, getScheduledMin, totalScheduledDuration } from './utils'

// Stop list (with editable timing-point times) + distance/duration/warnings summary.
// Shared by ReviewModal (Route Planner's "Finish & Review" flow) and RouteWizard's
// Timetable/Review step, so the two review views can't visually drift apart.
export default function RouteReviewSummary({ stops, setStops, routeResult, warnings }) {
  const segAfterStop = buildSegAfterMap(stops, routeResult?.segments)

  function updateStopTime(i, value) {
    setStops(prev => {
      const updated = prev.map((s, idx) => idx === i ? { ...s, time_std: value } : s)
      if (!value) return updated
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
    <>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
        <div style={{ marginBottom: 8, flexShrink: 0 }}>
          <span style={S.sectionLabel}>Stops ({stops.length})</span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {stops.map((s, i) => {
            const color        = stopColor(i, stops.length, s.stop_type)
            const segAfter     = segAfterStop[s._id]
            const scheduledMin = getScheduledMin(s, stops[i + 1])
            return (
              <Fragment key={s._id}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10, flexShrink: 0, marginTop: 1 }}>
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
                          onChange={e => updateStopTime(i, e.target.value)}
                        />
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>via</div>
                    )}
                  </div>
                </div>
                {i < stops.length - 1 && segAfter && !segAfter.error && (
                  <div style={{ paddingLeft: 30, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'flex', gap: 5, marginBottom: 6 }}>
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
          <span style={{ fontWeight: 700, fontSize: 20, color: 'var(--navy-brand)' }}>
            {fmtDist(routeResult.distance)}
          </span>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {fmtDur(totalScheduledDuration(stops, segAfterStop))}
          </span>
          {warnings.map((w, idx) => (
            <div key={idx} style={{ fontSize: 12, color: '#d69e2e', display: 'flex', gap: 4 }}>
              <span>⚠</span><span>{w.message ?? `Routing warning (code ${w.code})`}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
