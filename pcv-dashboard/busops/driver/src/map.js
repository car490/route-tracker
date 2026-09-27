let _map = null;
let _posMarker = null;
let _routeLine = null;
const _stopMarkers = [];

// Map colours come from the light palette in style.css whichever display
// theme is showing: the OpenStreetMap tiles are light in both, so these are
// tuned to read against the map, not against the page. Leaflet takes colour
// strings, not CSS variables, hence literals here (tests/driverPalette.test.js
// checks every one is a light-palette value).
const MAP_COLOURS = {
  onTime: '#154F3E', // --on-time: stops already served
  early:  '#6E3B0B', // --early: stops missed
  ink:    '#1C2333', // --text: stops still to come, and the vehicle itself
  route:  '#1D4ED8', // --focus: the route line, distinct from every stop state
  paper:  '#FFFFFF', // --surface
};

function stopStyle(state) {
  if (state === 'past')    return { radius: 5, color: MAP_COLOURS.onTime, fillColor: MAP_COLOURS.onTime, fillOpacity: 0.6, weight: 1 };
  if (state === 'missed')  return { radius: 5, color: MAP_COLOURS.early,  fillColor: MAP_COLOURS.early,  fillOpacity: 0.85, weight: 1 };
  if (state === 'current') return { radius: 8, color: MAP_COLOURS.onTime, fillColor: MAP_COLOURS.paper,  fillOpacity: 1,    weight: 3 };
  return                          { radius: 5, color: MAP_COLOURS.ink,    fillColor: MAP_COLOURS.paper,  fillOpacity: 1,    weight: 2 };
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

// Called once the map tab is visible so fitBounds has a real container size
export function initMap(stops) {
  if (_map) { _map.remove(); _map = null; }
  _stopMarkers.length = 0;

  _map = L.map('map-view', { zoomControl: true, attributionControl: true });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(_map);

  _routeLine = L.polyline(stops.map(s => [s.lat, s.lon]), {
    color: MAP_COLOURS.route, weight: 5, opacity: 0.85,
  }).addTo(_map);

  stops.forEach(stop => {
    const m = L.circleMarker([stop.lat, stop.lon], stopStyle('future'))
      .bindTooltip(stop.name, { direction: 'top' })
      .addTo(_map);
    m.on('click', () => _map.setView([stop.lat, stop.lon], Math.max(_map.getZoom(), 15)));
    _stopMarkers.push(m);
  });

  _posMarker = L.circleMarker([stops[0].lat, stops[0].lon], {
    radius: 9, color: MAP_COLOURS.paper, fillColor: MAP_COLOURS.ink, fillOpacity: 1, weight: 3,
  }).addTo(_map);

  // Container is visible — fitBounds works correctly here
  _map.fitBounds(L.featureGroup(_stopMarkers).getBounds(), { padding: [30, 30] });

  // Upgrade to road-snapped geometry in background
  fetchRoadGeometry(stops).then(coords => {
    if (coords && _map) _routeLine.setLatLngs(coords);
  });
}

export function updateMapPosition(lat, lon, nextStopIndex, stopStates) {
  if (!_map) return;
  _posMarker.setLatLng([lat, lon]);
  _stopMarkers.forEach((m, i) => {
    const status  = stopStates[i]?.status;
    const visited = status === 'arrived' || status === 'departed';
    const missed  = status === 'skipped_signal' || status === 'skipped_detour' || status === 'not_tracked';
    if      (missed)               m.setStyle(stopStyle('missed'));
    else if (visited)              m.setStyle(stopStyle('past'));
    else if (i === nextStopIndex)  m.setStyle(stopStyle('current'));
    else                           m.setStyle(stopStyle('future'));
  });
}

export function invalidateSize() {
  if (_map) _map.invalidateSize();
}
