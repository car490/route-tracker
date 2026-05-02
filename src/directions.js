let _lastFetchedStopIndex = -1;
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

function setHtml(html) {
  const el = document.getElementById('directions-view');
  if (el) el.innerHTML = html;
}

export async function updateDirections(lat, lon, nextStopIndex, schedule) {
  if (lat == null) {
    setHtml('<div class="dir-empty">Waiting for GPS signal…</div>');
    return;
  }

  const nextStop = schedule[nextStopIndex];
  if (!nextStop) {
    setHtml('<div class="dir-empty">No next stop</div>');
    return;
  }

  const now = Date.now();
  const stopChanged = nextStopIndex !== _lastFetchedStopIndex;
  if (!stopChanged && now - _lastFetchTime < REFRESH_MS) return;

  _lastFetchedStopIndex = nextStopIndex;
  _lastFetchTime = now;

  setHtml('<div class="dir-loading">Fetching directions…</div>');

  const steps = await fetchSteps(lat, lon, nextStop.lat, nextStop.lon);
  if (!steps) {
    setHtml(
      `<div class="dir-empty">Directions unavailable<br>Head to <strong>${nextStop.name}</strong></div>`
    );
    return;
  }

  const header = `<div class="dir-destination">To: <strong>${nextStop.name}</strong></div>`;
  const rows = steps.map(step => {
    const icon = maneuverIcon(step.maneuver.type, step.maneuver.modifier);
    const road = step.name || (step.maneuver.type === 'arrive' ? nextStop.name : 'Continue');
    const dist = step.distance > 0
      ? `<span class="dir-dist">${formatDist(step.distance)}</span>`
      : '';
    return `<div class="dir-step">
      <span class="dir-icon">${icon}</span>
      <span class="dir-road">${road}</span>
      ${dist}
    </div>`;
  }).join('');

  setHtml(header + `<div class="dir-steps">${rows}</div>`);
}
