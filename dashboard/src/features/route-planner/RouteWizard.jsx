import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../shared/supabase'
import { getCompanyId, getCompanyLocation } from '../../shared/company'
import { useJourneyTypes } from '../../shared/hooks/useJourneyTypes'
import { DIRECTIONS, SINGLE_JOURNEY_DIRECTIONS, SCHOOL_TYPE_RE, S } from './constants'
import { fmtDist, fmtDur, stopColor, getScheduledMin } from './utils'
import { useStopsBuilder } from './useStopsBuilder'
import { saveRouteTimetableStops } from './saveRouteTimetableStops'
import RouteDetailsForm from './RouteDetailsForm'
import RouteReviewSummary from './RouteReviewSummary'
import PlannerMap from './PlannerMap'
import DeparturesCard from './DeparturesCard'
import WizardModal from '../../shared/components/WizardModal'

const TOTAL_STEPS = 4

// Guided Route → Stops → Timetable → Departures flow.
// Pass `existingRoute` to add a new timetable to a route that already exists — Step 1
// is skipped and the flow starts straight at Stops, since the route details are already known.
export default function RouteWizard({ existingRoute, onFinish, onCancel }) {
  const { journeyTypes, bodsTypes } = useJourneyTypes()
  const [step, setStep] = useState(existingRoute ? 2 : 1)
  const [hqLocation, setHqLocation] = useState(null)

  useEffect(() => { getCompanyLocation().then(setHqLocation) }, [])

  // ── Step 1: Route ──────────────────────────────────────────────────────────────
  const [newCode,         setNewCode]         = useState('')
  const [newName,         setNewName]         = useState('')
  const [newJourneyTypes, setNewJourneyTypes] = useState([])
  const [vehicleType,     setVehicleType]     = useState([])
  const [singleJourney,   setSingleJourney]   = useState(false)
  const [newOrigin,       setNewOrigin]       = useState('')
  const [newDestination,  setNewDestination]  = useState('')
  const [newServiceReg,   setNewServiceReg]   = useState('')

  const activeJTypes    = existingRoute ? (existingRoute.journey_type ?? []) : newJourneyTypes
  const isBodsRoute     = activeJTypes.some(jt => bodsTypes.has(jt))
  const isSchoolRoute   = activeJTypes.some(jt => SCHOOL_TYPE_RE.test(jt))
  const isExcursionRoute = activeJTypes.includes('Excursion')
  const routeReady      = newCode.trim().length > 0 && newJourneyTypes.length > 0

  // ── Step 2: Stops ───────────────────────────────────────────────────────────────
  const {
    stops, setStops,
    routing, routeResult, warnings, segAfterStop, totalDurationSec,
    pinDropMode, setPinDropMode,
    showSearch, setShowSearch, searchQuery, setSearchQuery, searchResults, searching,
    naptanPending, setNaptanPending, checkingNaptan,
    editStopId, editStopName, setEditStopName,
    fitKey,
    commitStop, handleAddStop, handleMapPinDrop, closeSearch,
    moveStop, removeStop, removeStopById, updateStop,
    startEditName, commitEditName,
  } = useStopsBuilder(vehicleType)

  // ── Step 3: Timetable & Review ──────────────────────────────────────────────────
  const [newTtName,    setNewTtName]    = useState('')
  const [newDirection, setNewDirection] = useState(singleJourney ? 'Morning' : 'Outbound')
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState('')
  const [resolvedRouteId,     setResolvedRouteId]     = useState(existingRoute?.id ?? null)
  const [resolvedTimetableId, setResolvedTimetableId] = useState(null)

  useEffect(() => {
    if (step === 3 && stops.length >= 2 && !newTtName) {
      setNewTtName(`${stops[0].name} to ${stops[stops.length - 1].name}`)
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 4: Departures ──────────────────────────────────────────────────────────
  const [depMode,       setDepMode]       = useState(isExcursionRoute ? 'oneoff' : 'recurring')
  const [departures,    setDepartures]    = useState([])
  const [siblingTts,    setSiblingTts]    = useState([])
  const [drivers,       setDrivers]       = useState([])
  const [vehicles,      setVehicles]      = useState([])
  const [oneOff, setOneOff] = useState({ departure_time: '', date: '', vehicle_journey_code: '', driver_id: '', vehicle_id: '' })
  const [finishing,    setFinishing]    = useState(false)
  const [finishError,  setFinishError]  = useState('')

  useEffect(() => {
    if (step !== 4 || !resolvedRouteId) return
    supabase.from('employees').select('id, name').order('name').then(({ data }) => setDrivers(data ?? []))
    supabase.from('vehicles').select('id, registration').order('registration').then(({ data }) => setVehicles(data ?? []))
    supabase.from('timetables').select('id').eq('route_id', resolvedRouteId).then(({ data }) => {
      const tts = data ?? []
      setSiblingTts(tts)
      supabase.from('timetable_departures').select('id', { count: 'exact', head: true })
        .in('timetable_id', tts.map(t => t.id))
        .then(({ count }) => setOneOff(o => ({ ...o, vehicle_journey_code: o.vehicle_journey_code || `VJ${(count ?? 0) + 1}` })))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function handleSaveTimetable() {
    setSaving(true); setSaveError('')
    const { routeId: rId, timetableId: tId, error } = await saveRouteTimetableStops({
      routeId:     existingRoute ? existingRoute.id : '__new__',
      timetableId: '__new__',
      newRouteFields: {
        code: newCode, name: newName, journeyTypes: newJourneyTypes,
        singleJourney, isBodsRoute,
        origin: newOrigin, destination: newDestination, serviceReg: newServiceReg,
      },
      newTtName, newDirection,
      stopsToSave: stops,
    })
    setSaving(false)
    if (error) { setSaveError(error); return }
    setResolvedRouteId(rId)
    setResolvedTimetableId(tId)
    setStep(4)
  }

  async function finishOneOff() {
    setFinishing(true); setFinishError('')
    const localDate = new Date(`${oneOff.date}T00:00:00`)
    const jsDow = localDate.getDay() // 0 = Sunday
    const isoDow = jsDow === 0 ? 7 : jsDow // days_of_week: 1 = Mon … 7 = Sun

    const { data: depRow, error: depErr } = await supabase.from('timetable_departures').insert({
      timetable_id:         resolvedTimetableId,
      departure_time:       oneOff.departure_time,
      days_of_week:         [isoDow],
      vehicle_journey_code: oneOff.vehicle_journey_code,
      valid_from:            oneOff.date,
      valid_to:              oneOff.date,
    }).select('id').single()
    if (depErr) { setFinishError(depErr.message); setFinishing(false); return }

    const company_id = await getCompanyId()
    const { error: journeyErr } = await supabase.from('journeys').insert({
      company_id,
      timetable_departure_id: depRow.id,
      journey_date:           oneOff.date,
      driver_id:               oneOff.driver_id  || null,
      vehicle_id:              oneOff.vehicle_id || null,
    })
    setFinishing(false)
    if (journeyErr) { setFinishError(journeyErr.message); return }
    onFinish()
  }

  const directionOptions = singleJourney ? SINGLE_JOURNEY_DIRECTIONS : DIRECTIONS

  // ── Render ──────────────────────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <WizardModal title="New route" step={1} totalSteps={TOTAL_STEPS}
        footer={<>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!routeReady} onClick={() => setStep(2)}>Next</button>
        </>}
      >
        <RouteDetailsForm
          journeyTypes={journeyTypes}
          isBodsRoute={isBodsRoute}
          newCode={newCode} setNewCode={setNewCode}
          newJourneyTypes={newJourneyTypes} setNewJourneyTypes={setNewJourneyTypes}
          vehicleType={vehicleType} setVehicleType={setVehicleType}
          singleJourney={singleJourney} setSingleJourney={setSingleJourney}
          newName={newName} setNewName={setNewName}
          newOrigin={newOrigin} setNewOrigin={setNewOrigin}
          newDestination={newDestination} setNewDestination={setNewDestination}
          newServiceReg={newServiceReg} setNewServiceReg={setNewServiceReg}
        />
      </WizardModal>
    )
  }

  if (step === 2) {
    return (
      <WizardModal title={existingRoute ? `${existingRoute.service_code} — New timetable` : 'New route'} step={2} totalSteps={TOTAL_STEPS} fullBleed
        footer={<>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          {!existingRoute && <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>}
        </>}
      >
        <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0 }}>

          {/* Stops list + add controls */}
          <div style={{ width: 300, minWidth: 300, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={S.sectionLabel}>Stops{stops.length > 0 ? ` · ${stops.length}` : ''}</span>
              {routing && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Routing…</span>}
            </div>

            {stops.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                Drop a pin on the map or search for a stop or address below.
              </p>
            )}

            <div style={{ flex: '1 1 0', overflowY: 'auto', minHeight: 0 }}>
              {stops.map((s, i) => {
                const color = stopColor(i, stops.length)
                const isEditing = editStopId === s._id
                const segAfter = segAfterStop[s._id]
                const scheduledMin = getScheduledMin(s, stops[i + 1])
                return (
                  <Fragment key={s._id}>
                    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8, marginBottom: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 3 }}>
                        <span style={{ fontWeight: 700, fontSize: 10, color, width: 14, flexShrink: 0, textAlign: 'right' }}>
                          {i + 1}
                        </span>
                        {isEditing ? (
                          <input autoFocus className="form-input"
                            style={{ flex: 1, fontSize: 12, height: 24, padding: '1px 5px', marginLeft: 3, marginRight: 2 }}
                            value={editStopName}
                            onChange={e => setEditStopName(e.target.value)}
                            onBlur={() => commitEditName(i)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEditName(i) }
                            }}
                          />
                        ) : (
                          <span
                            style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.3, paddingLeft: 5, paddingRight: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
                            title={`${s.name} — click to rename`}
                            onClick={() => startEditName(s)}
                          >{s.name}</span>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ padding: '1px 4px', minWidth: 0, lineHeight: 1 }}
                          onClick={() => moveStop(i, -1)} disabled={i === 0} title="Move up">↑</button>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '1px 4px', minWidth: 0, lineHeight: 1 }}
                          onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} title="Move down">↓</button>
                        <button className="btn btn-danger btn-sm" style={{ padding: '1px 5px', minWidth: 0, lineHeight: 1 }}
                          onClick={() => removeStop(i)} title="Remove">×</button>
                      </div>
                      <div style={{ paddingLeft: 19 }}>
                        <select name="stop_type" className="form-select"
                          style={{ fontSize: 12, height: 26, padding: '2px 6px', width: '100%', marginBottom: 3 }}
                          value={s.stop_type} onChange={e => updateStop(i, 'stop_type', e.target.value)}>
                          <option value="timing_point">Timing point</option>
                          <option value="routing_point">Routing point</option>
                        </select>
                        {s.stop_type === 'timing_point' && (
                          <input type="time" className="form-input"
                            style={{ fontSize: 11, height: 24, padding: '1px 3px', width: '100%' }}
                            value={s.time_std} onChange={e => updateStop(i, 'time_std', e.target.value)} />
                        )}
                      </div>
                    </div>
                    {i < stops.length - 1 && segAfter && !segAfter.error && (
                      <div style={{ paddingLeft: 22, marginBottom: 2, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span>↓</span>
                        <span>{scheduledMin != null ? `${scheduledMin} min` : fmtDur(segAfter.duration)}</span>
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>

            <div style={{ marginTop: stops.length ? 8 : 0 }}>
              {checkingNaptan && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0 4px' }}>
                  Checking for nearby bus stops…
                </div>
              )}
              {naptanPending && (
                <div style={{ background: 'var(--bg)', border: '1px solid var(--navy-brand)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-brand)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Bus stop {Math.round(naptanPending.naptan.distance_m)}m away
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 2 }}>
                    {naptanPending.naptan.common_name}
                  </div>
                  {(naptanPending.naptan.indicator || naptanPending.naptan.locality_name) && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {[naptanPending.naptan.indicator, naptanPending.naptan.locality_name].filter(Boolean).join(', ')}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                      onClick={() => {
                        const { naptan } = naptanPending
                        const stopName = naptan.indicator ? `${naptan.common_name} (${naptan.indicator})` : naptan.common_name
                        commitStop(stopName, naptan.lat, naptan.lon, null, naptan.atco_code)
                        setNaptanPending(null)
                      }}
                    >Use bus stop</button>
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
                      onClick={() => {
                        const { original } = naptanPending
                        commitStop(original.name, original.lat, original.lon)
                        setNaptanPending(null)
                      }}
                    >Use location</button>
                  </div>
                </div>
              )}

              {!showSearch && !naptanPending && !checkingNaptan && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={`btn btn-sm ${pinDropMode ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }}
                    onClick={() => setPinDropMode(p => !p)}>
                    {pinDropMode ? 'Pinning…' : 'Drop pin'}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
                    onClick={() => { setShowSearch(true); setPinDropMode(false) }}>
                    Search
                  </button>
                </div>
              )}

              {showSearch && (
                <div>
                  <input name="stop_search" autoFocus className="form-input" style={{ marginBottom: 5 }}
                    placeholder="Search stops or address…" value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)} />
                  {searching && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 0 4px' }}>Searching…</div>}
                  {searchResults.map((r, idx) => (
                    <div key={idx} onMouseDown={e => { e.preventDefault(); handleAddStop(r) }} style={{
                      padding: '5px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13,
                      display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg)', marginBottom: 2,
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: r.source === 'stop' ? 'var(--green)' : 'var(--navy-brand)', textTransform: 'uppercase', minWidth: 28 }}>
                        {r.source === 'stop' ? 'Stop' : 'Addr'}
                      </span>
                      <span style={{ flex: 1, lineHeight: 1.3 }}>{r.name}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 5 }}>
                    <button className="btn btn-ghost btn-sm" onClick={closeSearch}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {routeResult && !routeResult.error && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy-brand)' }}>{fmtDist(routeResult.distance)}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 10 }}>{fmtDur(totalDurationSec)}</span>
                {warnings.map((w, idx) => (
                  <div key={idx} style={{ fontSize: 12, color: '#d69e2e', display: 'flex', gap: 4, marginTop: 4 }}>
                    <span>⚠</span><span>{w.message ?? `Routing warning (code ${w.code})`}</span>
                  </div>
                ))}
              </div>
            )}

            <button className="btn btn-primary btn-sm" style={{ marginTop: 14, width: '100%' }}
              disabled={stops.length < 2} onClick={() => setStep(3)}
            >
              {stops.length < 2 ? 'Add at least 2 stops to continue' : 'Next: Timetable & Review →'}
            </button>
          </div>

          {/* Map */}
          <div style={{ flex: 1, minWidth: 0, position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            {pinDropMode && (
              <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(30,61,114,0.88)', color: '#fff', padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 500, pointerEvents: 'none', zIndex: 1000, whiteSpace: 'nowrap' }}>
                Click the map to place a stop
              </div>
            )}
            <PlannerMap
              stops={stops}
              routeGeometry={routeResult?.geometry ?? null}
              pinDropMode={pinDropMode}
              onMapClick={handleMapPinDrop}
              onRemoveStop={removeStopById}
              fitKey={fitKey}
              hqLocation={hqLocation}
            />
          </div>
        </div>
      </WizardModal>
    )
  }

  if (step === 3) {
    return (
      <WizardModal title="Timetable & review" step={3} totalSteps={TOTAL_STEPS}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setStep(2)} disabled={saving}>Back</button>
          <button className="btn btn-primary" disabled={saving || !newTtName.trim()} onClick={handleSaveTimetable}>
            {saving ? 'Saving…' : 'Save & Continue'}
          </button>
        </>}
      >
        <div style={{ marginBottom: 16, flexShrink: 0, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Timetable name</div>
            <input type="text" className="form-input" value={newTtName} onChange={e => setNewTtName(e.target.value)} />
          </div>
          <div>
            <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Direction</div>
            <select className="form-select" value={newDirection} onChange={e => setNewDirection(e.target.value)}>
              {directionOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <RouteReviewSummary stops={stops} setStops={setStops} routeResult={routeResult} warnings={warnings} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
          {fmtDur(totalDurationSec)} total
        </div>

        {saveError && <div className="error-msg">{saveError}</div>}
      </WizardModal>
    )
  }

  // step === 4
  return (
    <WizardModal title="Departures" step={4} totalSteps={TOTAL_STEPS}
      footer={<>
        <button className="btn btn-primary"
          disabled={depMode === 'oneoff' && (finishing || !oneOff.date || !oneOff.departure_time || !oneOff.vehicle_journey_code.trim())}
          onClick={depMode === 'oneoff' ? finishOneOff : onFinish}
        >
          {depMode === 'oneoff' ? (finishing ? 'Finishing…' : 'Finish') : 'Finish'}
        </button>
      </>}
    >
      {!isExcursionRoute && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button className={`btn btn-sm ${depMode === 'recurring' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }}
            onClick={() => setDepMode('recurring')}>Recurring service</button>
          <button className={`btn btn-sm ${depMode === 'oneoff' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }}
            onClick={() => setDepMode('oneoff')}>One-off / excursion</button>
        </div>
      )}

      {depMode === 'recurring' ? (
        resolvedTimetableId && (
          <DeparturesCard
            timetableId={resolvedTimetableId}
            timetables={siblingTts}
            departures={departures}
            setDepartures={setDepartures}
            isSchoolRoute={isSchoolRoute}
          />
        )
      ) : (
        <div className="card" style={{ padding: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
            Runs once, on a single date — books an actual journey with this timetable, ready to assign a driver and vehicle.
          </p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Date</div>
              <input type="date" className="form-input" value={oneOff.date}
                onChange={e => setOneOff(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Departure Time</div>
              <input type="time" className="form-input" value={oneOff.departure_time}
                onChange={e => setOneOff(f => ({ ...f, departure_time: e.target.value }))} required />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Journey Code (VJC)</div>
            <input className="form-input" value={oneOff.vehicle_journey_code}
              onChange={e => setOneOff(f => ({ ...f, vehicle_journey_code: e.target.value }))} required />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Driver <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
              <select className="form-select" value={oneOff.driver_id} onChange={e => setOneOff(f => ({ ...f, driver_id: e.target.value }))}>
                <option value="">—</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.sectionLabel, marginBottom: 3 }}>Vehicle <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
              <select className="form-select" value={oneOff.vehicle_id} onChange={e => setOneOff(f => ({ ...f, vehicle_id: e.target.value }))}>
                <option value="">—</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
              </select>
            </div>
          </div>
          {finishError && <div className="error-msg">{finishError}</div>}
        </div>
      )}
    </WizardModal>
  )
}
