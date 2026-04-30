const el = (id) => document.getElementById(id);

const fmtTime = (d) =>
  d instanceof Date && isFinite(d)
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--:--';

const fmtDelta = (m) => {
  if (m === null || m === undefined) return '—';
  const sign = m >= 0 ? '+' : '-';
  return `${sign}${Math.abs(m).toFixed(0)}m`;
};

const fmtDistance = (m) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

const fmtSpeed = (mps) => `${(mps * 3.6).toFixed(1)} km/h`;

function updateStopList({ schedule, arrivals, nextStopIndex }) {
  const container = el('stop-list');
  container.innerHTML = '';

  schedule.forEach((stop, i) => {
    const row = document.createElement('div');
    const state = i < nextStopIndex ? 'past' : i === nextStopIndex ? 'current' : 'future';
    row.className = `stop-row stop-${state}`;
    const missed = arrivals[i] === 'missed';
    const actualText = arrivals[i] instanceof Date ? fmtTime(arrivals[i]) : missed ? '--:--' : '—';
    row.innerHTML =
      `<span class="sl-name">${stop.name}</span>` +
      `<span class="sl-sched">${stop.time}</span>` +
      `<span class="sl-actual${missed ? ' sl-missed' : ''}">${actualText}</span>`;
    container.appendChild(row);
    if (state === 'current') row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

export function updateUi({ timing, nextStopIndex, schedule, speedMps, distanceToNextM, arrivals }) {
  el('status-card').className = `status-${timing.status}`;
  el('status-label').textContent = timing.status.replace('-', ' ').toUpperCase();
  el('sched-time').textContent = fmtTime(timing.scheduledTime);
  el('eta-time').textContent = fmtTime(timing.eta);
  el('delta').textContent = fmtDelta(timing.minutesDifference);
  el('distance').textContent = fmtDistance(distanceToNextM);
  el('speed').textContent = fmtSpeed(speedMps);

  const next = schedule[nextStopIndex] ?? null;
  const current = nextStopIndex > 0 ? schedule[nextStopIndex - 1] : null;

  el('next-stop').textContent = next ? next.name : 'End of route';
  el('next-stop-label').textContent = next ? next.name : 'End of route';
  el('current-stop').textContent = current ? current.name : '—';

  const progress =
    schedule.length > 1 ? nextStopIndex / (schedule.length - 1) : 0;
  el('progress-fill').style.width = `${Math.min(progress * 100, 100)}%`;

  updateStopList({ schedule, arrivals, nextStopIndex });
}
