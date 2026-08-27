// Testing-mode stop-schedule time shift — shared between the driver PWA
// (DEBUG "use current time" checkbox in main.js) and Announce Lite's
// standalone autopilot (announceStandaloneAutopilot.js's testing_mode
// fallback match). Slides every stop's HH:MM by the same delta so the real
// gaps between stops — and therefore on-time/late/ETA logic downstream in
// engine.js/gps.js/ui.js, all of which only ever read stop.time — still
// behave meaningfully when a journey is started far outside its real
// scheduled hours. Display-only: does not touch what gets uploaded to
// journey_stop_times, so a test run's real arrived_at/departed_at
// timestamps still get compared against the DB's real departure_time —
// expected to show as wildly early/late in the ops dashboard, not a bug.

export function shiftStopTimes(stops, deltaMinutes) {
  return stops.map(stop => {
    const [h, m] = stop.time.split(':').map(Number);
    const shifted = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
    const nh = String(Math.floor(shifted / 60)).padStart(2, '0');
    const nm = String(shifted % 60).padStart(2, '0');
    return { ...stop, time: `${nh}:${nm}` };
  });
}

export function minutesFromNow(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) - (h * 60 + m);
}
