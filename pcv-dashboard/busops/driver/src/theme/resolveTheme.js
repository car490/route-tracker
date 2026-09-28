// driver/src/theme/resolveTheme.js
//
// Pure: turns the driver's display setting (auto / light / dark), the time and
// where the vehicle is into the theme to paint. Auto is light between sunrise
// and sunset and dark otherwise: light text on dark washes out in daylight
// glare, and a bright screen at night dazzles the driver and reflects in the
// windscreen (docs/DECISIONS.md "Driver PWA display theme").

import { sunTimes } from './sunTimes.js';

// Used until the first GPS fix arrives (duty card and picker screens run
// before tracking starts). Central England: anywhere in the UK is within
// about 30 minutes of its sunrise/sunset, and the live fix corrects it as
// soon as tracking begins. Deliberately a constant, not a stored last-known
// position, so no location is ever written to the device for this feature.
export const DEFAULT_LOCATION = Object.freeze({ lat: 53.0, lon: -1.5 });

function usableLocation(location) {
  return location && Number.isFinite(location.lat) && Number.isFinite(location.lon)
    ? location
    : DEFAULT_LOCATION;
}

export function resolveTheme({ preference, now = new Date(), location = null }) {
  if (preference === 'light' || preference === 'dark') return preference;

  const { sunrise, sunset, polar } = sunTimes(now, usableLocation(location));
  if (polar) return polar === 'day' ? 'light' : 'dark';
  const t = now.getTime();
  return t >= sunrise.getTime() && t < sunset.getTime() ? 'light' : 'dark';
}
