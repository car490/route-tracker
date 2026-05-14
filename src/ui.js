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

let _onStopJump = null;
export function setOnStopJump(fn) { _onStopJump = fn; }

function arrivalStatusClass(stop, actualDate) {
  const [h, m] = stop.time.split(':').map(Number);
  const scheduled = new Date(actualDate);
  scheduled.setHours(h, m, 0, 0);
  const diffMin = (actualDate - scheduled) / 60000;
  if (diffMin > 2) return 'sl-late';
  if (diffMin < -2) return 'sl-early';
  return 'sl-ontime';
}

function updateStopList({ schedule, arrivals, nextStopIndex }) {
  const container = el('stop-list');
  container.innerHTML = '';
  let currentRow = null;

  schedule.forEach((stop, i) => {
    const row = document.createElement('div');
    const state = i < nextStopIndex ? 'past' : i === nextStopIndex ? 'current' : 'future';
    row.className = `stop-row stop-${state}`;
    const arrived = arrivals[i] instanceof Date;
    const missed = arrivals[i] === 'missed';
    const actualText = arrived ? fmtTime(arrivals[i]) : missed ? '--:--' : '—';
    const actualClass = arrived ? arrivalStatusClass(stop, arrivals[i]) : missed ? 'sl-missed' : '';

    row.innerHTML =
      `<span class="sl-name">${stop.name}</span>` +
      `<span class="sl-sched">${stop.time}</span>` +
      `<span class="sl-actual${actualClass ? ' ' + actualClass : ''}">${actualText}</span>` +
      (state === 'future' ? `<button class="sl-jump" data-idx="${i}" title="Start from here">⏭</button>` : '<span></span>');

    if (state === 'current') currentRow = row;
    container.appendChild(row);
  });

  if (currentRow) currentRow.scrollIntoView({ block: 'center', behavior: 'smooth' });

  if (_onStopJump) {
    container.querySelectorAll('.sl-jump').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _onStopJump(parseInt(btn.dataset.idx, 10));
      });
    });
  }
}

export function renderLog(entries) {
  const container = el('log-view');
  container.innerHTML = '';
  if (entries.length === 0) {
    container.innerHTML = '<div class="log-empty">No events yet</div>';
    return;
  }
  entries.forEach(({ t, category, message }) => {
    const row = document.createElement('div');
    row.className = `log-row log-${category}`;
    row.innerHTML = `<span class="log-time">${t}</span><span class="log-msg">${message}</span>`;
    container.appendChild(row);
  });
}

export function updateUi({ timing, nextStopIndex, schedule, speedMps, distanceToNextM, arrivals, earlyWait, atStop }) {
  const banner = el('early-wait-banner');
  if (earlyWait) {
    el('ewb-time').textContent = fmtTime(earlyWait.scheduledTime);
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  if (atStop) {
    el('status-card').className = 'status-at-stop';
    el('status-label').textContent = 'AT STOP';
  } else {
    el('status-card').className = `status-${timing.status}`;
    el('status-label').textContent = timing.status.replace('-', ' ').toUpperCase();
  }
  el('sched-time').textContent = fmtTime(timing.scheduledTime);
  el('eta-time').textContent = fmtTime(timing.eta);
  el('delta').textContent = fmtDelta(timing.minutesDifference);
  el('distance').textContent = fmtDistance(distanceToNextM);
  el('speed').textContent = fmtSpeed(speedMps);

  const next = schedule[nextStopIndex] ?? null;
  const nextAfter = schedule[nextStopIndex + 1] ?? null;

  el('next-stop').textContent = next ? next.name : 'End of route';
  el('next-stop-label').textContent = nextAfter ? `${nextAfter.name} at ${nextAfter.time}` : 'End of route';

  const progress = schedule.length > 1 ? nextStopIndex / (schedule.length - 1) : 0;
  el('progress-fill').style.width = `${Math.min(progress * 100, 100)}%`;

  updateStopList({ schedule, arrivals, nextStopIndex });
}
