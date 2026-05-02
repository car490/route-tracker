let _schedule = null;
let _fromIndex = 0;
let _prevNextStopIndex = -1;
let _lastFetchedFrom = -1;
let _lastFetchTime = 0;
const REFRESH_MS = 60_000;

function maneuverIcon(type, modifier) {
  if (type === 'depart') return '▶';
  if (type === 'arrive') return '⏹';
  if (type === 'roundabout' || type === 'rotary') return '↻';
  switch (modifier) {
    case 'uturn':        return '↩';
    case 'sharp left':   return '↙';
    case 'left':         return '←';
    case 'slight left':  return '↖';
    case 'straight':     return '⬆';
    case 'slight right': return '↗';
    case 'right':        return '→';
    case 'sharp right':  return '↘';
    default:             return '⬆';
  }
}

function formatDist(metres) {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(1)} km`
    : `${Math.round(metres)} m`;
}

async function fetchSteps(fromLat, fromLon, toLat, toLon) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLon},${fromLat};${toLon},${toLat}?steps=true&overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok') return null;
    return data.routes[0].legs[0].steps;
  } catch (_) {
    return null;
  }
}

function setStepsHtml(html) {
  const el = document.getElementById('dir-steps-area');
  if (el) el.innerHTML = html;
}

export function initDirections(schedule, initialFromIndex) {
  _schedule = schedule;
  _fromIndex = initialFromIndex;
  _prevNextStopIndex = initialFromIndex;

  const container = document.getElementById('directions-view');
  if (!container) return;

  container.innerHTML = `
    <div class="dir-select-row">
      <span class="dir-select-label">FROM</span>
      <select id="dir-from-select" class="dir-from-select"></select>
    </div>
    <div id="dir-steps-area"></div>
  `;

  const sel = document.getElementById('dir-from-select');
  schedule.forEach((stop, i) => {
    if (i >= schedule.length - 1) return;
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${stop.time}  ${stop.name}`;
    sel.appendChild(opt);
  });
  sel.value = _fromIndex;

  sel.addEventListener('change', () => {
    _fromIndex = parseInt(sel.value, 10);
    _lastFetchedFrom = -1;
    fetchAndRender();
  });
}

// Called on every GPS update — advances the selector when the driver reaches a new stop
export function syncCurrentStop(nextStopIndex) {
  if (!_schedule || nextStopIndex === _prevNextStopIndex) return;
  _prevNextStopIndex = nextStopIndex;

  const newFrom = Math.max(nextStopIndex - 1, 0);
  _fromIndex = newFrom;
  _lastFetchedFrom = -1;

  const sel = document.getElementById('dir-from-select');
  if (sel) sel.value = newFrom;
}

async function fetchAndRender() {
  if (!_schedule) return;

  const fromStop = _schedule[_fromIndex];
  const toStop   = _schedule[_fromIndex + 1];

  if (!fromStop || !toStop) {
    setStepsHtml('<div class="dir-empty">No next stop</div>');
    return;
  }

  const now = Date.now();
  if (_fromIndex === _lastFetchedFrom && now - _lastFetchTime < REFRESH_MS) return;

  _lastFetchedFrom = _fromIndex;
  _lastFetchTime = now;

  setStepsHtml('<div class="dir-loading">Fetching directions…</div>');

  const steps = await fetchSteps(fromStop.lat, fromStop.lon, toStop.lat, toStop.lon);
  if (!steps) {
    setStepsHtml(
      `<div class="dir-empty">Directions unavailable<br>Head to <strong>${toStop.name}</strong></div>`
    );
    return;
  }

  const header = `<div class="dir-destination">To: <strong>${toStop.name}</strong></div>`;
  const rows = steps.map(step => {
    const icon = maneuverIcon(step.maneuver.type, step.maneuver.modifier);
    const road = step.name || (step.maneuver.type === 'arrive' ? toStop.name : 'Continue');
    const dist = step.distance > 0
      ? `<span class="dir-dist">${formatDist(step.distance)}</span>`
      : '';
    return `<div class="dir-step">
      <span class="dir-icon">${icon}</span>
      <span class="dir-road">${road}</span>
      ${dist}
    </div>`;
  }).join('');

  setStepsHtml(header + `<div class="dir-steps-list">${rows}</div>`);
}

export function updateDirections() {
  fetchAndRender();
}
