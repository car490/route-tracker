import { TYPE_DEFAULTS, S } from './constants'

// Route metadata fields shared by RoutePlannerPage's inline "new route" card and
// RouteWizard's Step 1 — code, journey types, vehicle type, name, and (when the
// journey type requires it) BODS origin/destination/registration fields.
export default function RouteDetailsForm({
  journeyTypes, isBodsRoute,
  newCode, setNewCode,
  newJourneyTypes, setNewJourneyTypes,
  vehicleType, setVehicleType,
  singleJourney, setSingleJourney,
  newName, setNewName,
  newOrigin, setNewOrigin,
  newDestination, setNewDestination,
  newServiceReg, setNewServiceReg,
  autoFocus = true,
}) {
  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Code</div>
        <input name="service_code" className="form-input" style={{ textTransform: 'uppercase', fontSize: 12 }}
          placeholder="S125S" autoFocus={autoFocus} value={newCode}
          onChange={e => setNewCode(e.target.value.toUpperCase())} />
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ ...S.sectionLabel, marginBottom: 4 }}>Journey Types</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {journeyTypes.map(jt => {
            const on = newJourneyTypes.includes(jt)
            return (
              <button key={jt} type="button" onClick={() => setNewJourneyTypes(on ? [] : [jt])}
                style={{
                  padding: '3px 9px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'inherit', lineHeight: 1.5,
                  border: `1px solid ${on ? 'var(--navy-brand)' : 'var(--border)'}`,
                  background: on ? 'var(--navy-brand)' : 'transparent',
                  color: on ? '#fff' : 'var(--text-muted)',
                }}
              >{jt}</button>
            )
          })}
        </div>
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ ...S.sectionLabel, marginBottom: 4 }}>Vehicle Type</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.keys(TYPE_DEFAULTS).map(vt => {
            const on = vehicleType.includes(vt)
            return (
              <button key={vt} type="button"
                onClick={() => setVehicleType(prev => on ? prev.filter(x => x !== vt) : [...prev, vt])}
                style={{
                  padding: '3px 9px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'inherit', lineHeight: 1.5,
                  border: `1px solid ${on ? 'var(--navy-brand)' : 'var(--border)'}`,
                  background: on ? 'var(--navy-brand)' : 'transparent',
                  color: on ? '#fff' : 'var(--text-muted)',
                }}
              >{vt}</button>
            )
          })}
        </div>
      </div>
      <div style={{ marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
          <input type="checkbox" checked={singleJourney} onChange={e => setSingleJourney(e.target.checked)} />
          <span style={{ fontSize: 12, color: 'var(--text)' }}>One journey each way</span>
        </label>
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ ...S.sectionLabel, marginBottom: 3 }}>
          Name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </div>
        <input name="route_name" className="form-input" style={{ fontSize: 12 }} placeholder="e.g. Sleaford – Cranwell"
          value={newName} onChange={e => setNewName(e.target.value)} />
      </div>
      {isBodsRoute && (<>
        <div style={{ marginBottom: 6 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Origin</div>
          <input className="form-input" style={{ fontSize: 12 }} placeholder="e.g. Spalding"
            value={newOrigin} onChange={e => setNewOrigin(e.target.value)} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Destination</div>
          <input className="form-input" style={{ fontSize: 12 }} placeholder="e.g. Boston"
            value={newDestination} onChange={e => setNewDestination(e.target.value)} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Registration No.
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>(optional)</span>
          </div>
          <input className="form-input" style={{ fontSize: 12 }} placeholder="e.g. PC0006014:1"
            value={newServiceReg} onChange={e => setNewServiceReg(e.target.value)} />
        </div>
      </>)}
    </>
  )
}
