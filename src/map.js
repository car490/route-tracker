let _map = null;
let _posMarker = null;
let _routeLine = null;
const _stopMarkers = [];

function stopStyle(state) {
  if (state === 'past')    return { radius: 5, color: '#4db848', fillColor: '#4db848', fillOpacity: 0.55, weight: 1 };
  if (state === 'missed')  return { radius: 5, color: '#f97316', fillColor: '#f97316', fillOpacity: 0.8,  weight: 1 };
  if (state === 'current') return { radius: 8, color: '#4db848', fillColor: '#ffffff', fillOpacity: 1,    weight: 2 };
  return                          { radius: 5, color: '#1e3d72', fillColor: '#ffffff', fillOpacity: 1,    weight: 2 };
}

async function fetchRoadGeometry(stops) {
  const key = `route-geo:${stops.length}:${stops[0].lat}:${stops[stops.length - 1].lat}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const coords = stops.map(s => `${s.lon},${s.lat}`).join(';');
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code === 'Ok') {
      const latLngs = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      try { localStorage.setItem(key, JSON.stringify(latLngs)); } catch (_) {}
      return latLngs;
    }
  } catch (_) {}
  return null;
}

export async function initMap(stops) {
  if (_map) { _map.remove(); _map = null; }
  _stopMarkers.length = 0;

  _map = L.map('map-view', { zoomControl: true, attributionControl: true });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(_map);

  // Straight-line route shown immediately; upgraded to road geometry once fetched
  _routeLine = L.polyline(stops.map(s => [s.lat, s.lon]), {
    color: '#4db848', weight: 3, opacity: 0.85,
  }).addTo(_map);

  stops.forEach(stop => {
    const m = L.circleMarker([stop.lat, stop.lon], stopStyle('future'))
      .bindTooltip(stop.name, { direction: 'top' })
      .addTo(_map);
    m.on('click', () => _map.setView([stop.lat, stop.lon], Math.max(_map.getZoom(), 15)));
    _stopMarkers.push(m);
  });

  _posMarker = L.circleMarker([stops[0].lat, stops[0].lon], {
    radius: 9, color: '#ffffff', fillColor: '#4db848', fillOpacity: 1, weight: 3,
  }).addTo(_map);

  // Default view: full route
  _map.fitBounds(L.featureGroup(_stopMarkers).getBounds(), { padding: [30, 30] });

  // Upgrade to road-snapped geometry in the background
  fetchRoadGeometry(stops).then(coords => {
    if (coords && _map) _routeLine.setLatLngs(coords);
  });
}

export function updateMapPosition(lat, lon, nextStopIndex, arrivals) {
  if (!_map) return;
  _posMarker.setLatLng([lat, lon]);
  _stopMarkers.forEach((m, i) => {
    if      (arrivals[i] === 'missed')    m.setStyle(stopStyle('missed'));
    else if (arrivals[i] instanceof Date) m.setStyle(stopStyle('past'));
    else if (i === nextStopIndex)         m.setStyle(stopStyle('current'));
    else                                  m.setStyle(stopStyle('future'));
  });
  // No auto-pan — driver can pan freely; marker stays visible on route
}

export function centreOnPosition(lat, lon) {
  if (_map) _map.setView([lat, lon], Math.max(_map.getZoom(), 15), { animate: true });
}

export function invalidateSize() {
  if (_map) _map.invalidateSize();
}
