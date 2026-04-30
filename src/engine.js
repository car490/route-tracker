/**
 * Pure timing engine — no side effects, no I/O.
 *
 * @param {Object} params
 * @param {Date}   params.now
 * @param {number} params.currentDistanceM  - metres to next stop
 * @param {number} params.speedMps          - current speed in m/s
 * @param {{name: string, time: string}} params.nextStop - stop with "HH:MM" time
 * @param {number} [params.lateAllowanceMin=2]
 * @returns {{status: string, eta: Date|null, minutesDifference: number|null, scheduledTime: Date, nextStopName: string}}
 */
export function computeTiming({
  now,
  currentDistanceM,
  speedMps,
  nextStop,
  lateAllowanceMin = 2,
}) {
  const [h, m] = nextStop.time.split(':').map(Number);
  const scheduledTime = new Date(now);
  scheduledTime.setHours(h, m, 0, 0);

  let eta = null;
  let minutesDifference = null;

  if (speedMps > 0) {
    const secondsToStop = currentDistanceM / speedMps;
    eta = new Date(now.getTime() + secondsToStop * 1000);
    minutesDifference = (eta.getTime() - scheduledTime.getTime()) / 60000;
  }

  let status = 'on-time';
  if (minutesDifference !== null) {
    if (minutesDifference > lateAllowanceMin) {
      status = 'late';
    } else if (minutesDifference < -lateAllowanceMin) {
      status = 'early';
    }
  }

  return { status, eta, minutesDifference, scheduledTime, nextStopName: nextStop.name };
}
