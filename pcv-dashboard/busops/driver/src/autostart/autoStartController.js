// driver/src/autostart/autoStartController.js
//
// The Driver's automatic mode (owner-approved 2026-09-27): while no journey
// is running, check the device's GPS every 5 seconds; when the vehicle is at
// the first stop of a departure that runs today, inside its time window,
// offer it with a 10 second countdown (Start now / Change service / Not
// now) and then start it by itself.
//
// Matching is shared/scheduleAutopilot.js, the same code and the same
// defaults as an Announce Solo device, so both surfaces pick departures the
// same way. Unlike Solo there is a driver in the cab, which is what makes
// matching against every departure (not a per-vehicle list) safe: a wrong
// guess at a shared stop is one tap to correct.
//
// All effects are injected (timers, GPS, clock, overlay, the actual start)
// so the flow is tested end to end without a browser. main.js supplies the
// real ones and does the journey start itself (onStart), exactly as the
// manual picker's Start button does.

import { findScheduleMatch, findTestingScheduleMatch, isRunningOn } from '../../../shared/scheduleAutopilot.js';
import { autoStartReducer, initialAutoStartState } from './autoStartState.js';

export const MATCH_CONFIG = Object.freeze({ terminusRadiusM: 150, matchWindowBeforeMin: 15, matchWindowAfterMin: 30 });
const POLL_MS = 5000;
const TICK_MS = 1000;

// One GPS reading for the idle check, or null if there isn't one (denied,
// timed out, no geolocation): that tick is simply skipped. Same options as
// Announce Solo's idle poll.
export function getBrowserPosition(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve) => {
    if (!geolocation) { resolve(null); return; }
    geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
  });
}

function localDay(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function initAutoStart({
  loadCandidates,
  getPosition,
  now = () => new Date(),
  ui,
  onStart,
  onChange = () => {},
  // Only look for a match while this returns true. main.js passes "the
  // waiting (no duty) screen is showing", so an offer can never appear over
  // a picker, the vehicle setup screen or a running journey, whichever path
  // led there.
  isActive = () => true,
  testing = false,
  config = MATCH_CONFIG,
  setInterval: setIntervalFn = globalThis.setInterval.bind(globalThis),
  clearInterval: clearIntervalFn = globalThis.clearInterval.bind(globalThis),
}) {
  let state = initialAutoStartState();
  let data = null;
  let day = null;
  let pollTimer = null;
  let tickTimer = null;
  let polling = false;

  const dispatch = (event) => { state = autoStartReducer(state, event); };

  function stopTicker() {
    if (tickTimer !== null) clearIntervalFn(tickTimer);
    tickTimer = null;
  }

  async function begin() {
    stopTicker();
    const { candidate, shiftMinutes } = state;
    ui.showStarting(candidate);
    try {
      await onStart(candidate, { shiftMinutes });
      dispatch({ type: 'started' });
      ui.hide();
    } catch {
      dispatch({ type: 'startFailed' });
      ui.showError(`Couldn't start ${candidate.serviceCode} ${candidate.departureTime}. Choose the service yourself.`);
    }
  }

  async function tick() {
    dispatch({ type: 'tick' });
    if (state.phase === 'starting') return begin();
    ui.updateCountdown(state.secondsLeft);
  }

  ui.bind({
    onStartNow: () => startNow(),
    onCancel: () => {
      stopTicker();
      dispatch({ type: 'cancel' });
      ui.hide();
    },
    onChange: () => {
      const { candidate } = state;
      stopTicker();
      dispatch({ type: 'change' });
      ui.hide();
      onChange(candidate);
    },
  });

  async function startNow() {
    dispatch({ type: 'startNow' });
    if (state.phase === 'starting') await begin();
  }

  async function poll() {
    if (state.phase !== 'watching' || polling || !isActive()) return;
    polling = true;
    try {
      const clock = now();
      if (day !== null && localDay(clock) !== day) {
        dispatch({ type: 'newDay' });
        data = null; // the timetable may have changed overnight
      }
      day = localDay(clock);

      if (!data) {
        try { data = await loadCandidates(); } catch { return; } // offline, nothing cached: try next tick
      }
      const position = await getPosition();
      if (!position || state.phase !== 'watching' || !isActive()) return;

      const candidates = data.candidates.filter((c) => isRunningOn(c, clock, data.termDateRanges));
      const params = { candidates, lat: position.lat, lon: position.lon, now: clock, ...config };
      let candidate = findScheduleMatch(params);
      let shiftMinutes = 0;
      // Testing only (?debug): the first stop at any time of day, with the
      // timetable shifted to now; the same fallback a Solo device in
      // testing_mode uses. Never reached on a live device.
      if (!candidate && testing) {
        const t = findTestingScheduleMatch(params);
        if (t) ({ candidate, shiftMinutes } = t);
      }
      if (!candidate) return;

      dispatch({ type: 'match', candidate, shiftMinutes });
      if (state.phase !== 'countdown') return; // dismissed earlier today
      ui.showCountdown(candidate, state.secondsLeft);
      tickTimer = setIntervalFn(tick, TICK_MS);
    } finally {
      polling = false;
    }
  }

  return {
    async start() {
      if (pollTimer === null) pollTimer = setIntervalFn(poll, POLL_MS);
    },
    stop() {
      if (pollTimer !== null) clearIntervalFn(pollTimer);
      pollTimer = null;
      stopTicker();
      ui.hide();
    },
    poll,
    startNow,
    resume() { dispatch({ type: 'resume' }); },
    journeyEnded() { dispatch({ type: 'journeyEnded' }); },
    getState() { return state; },
  };
}
