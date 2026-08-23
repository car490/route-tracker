import { S } from './constants'
import RouteReviewSummary from './RouteReviewSummary'

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
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', width: '100%', maxWidth: 540, maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', padding: 24 }}>

        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy-brand)', margin: '0 0 16px', flexShrink: 0 }}>
          Review Route
        </h2>

        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 6 }}>Route</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {confirmCode && <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--navy-brand)', flexShrink: 0 }}>{confirmCode}</span>}
            {isNewTimetable
              ? <input type="text" className="form-input" style={{ fontSize: 14, flex: 1, minWidth: 0 }}
                  value={newTtName} onChange={e => setNewTtName(e.target.value)} />
              : confirmName && <span style={{ fontSize: 14, color: 'var(--text)' }}>{confirmName}</span>
            }
            {confirmJTypes.map(jt => (
              <span key={jt} style={{ fontSize: 10, fontWeight: 700, background: 'var(--navy-brand)', color: '#fff', borderRadius: 8, padding: '1px 7px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{jt}</span>
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

        <RouteReviewSummary stops={modalStops} setStops={setModalStops} routeResult={routeResult} warnings={warnings} />

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
