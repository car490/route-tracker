// driver/src/theme/sunTimes.js
//
// Pure sunrise/sunset calculation (NOAA's simplified solar position
// algorithm, the same one behind the NOAA solar calculator). Runs entirely on
// the device: no network call, no lookup table, so Auto theme switching works
// offline mid-route. Accurate to about a minute at UK latitudes, which is far
// tighter than a light/dark switch needs.
//
// Sunrise/sunset here means the upper limb of the sun on the horizon with
// standard refraction (zenith 90.833 degrees), the published definition.

const RAD = Math.PI / 180;
const ZENITH = 90.833;
const DAY_MS = 86400000;

function julianDay(ms) {
  return ms / DAY_MS + 2440587.5;
}

// Returns { sunrise: Date, sunset: Date, polar: null } for the UTC calendar
// day containing `date`, or { sunrise: null, sunset: null, polar: 'day' |
// 'night' } when the sun never sets or never rises that day.
export function sunTimes(date, { lat, lon }) {
  const d = new Date(date);
  const midnightUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // Solar position evaluated at local solar noon is plenty for rise/set.
  const noonMs = midnightUtc + DAY_MS / 2 - (lon / 360) * DAY_MS;
  const t = (julianDay(noonMs) - 2451545) / 36525;

  const meanLong = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + centre;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));

  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTimeMin =
    4 / RAD *
    (y * Math.sin(2 * meanLong * RAD) -
      2 * ecc * Math.sin(meanAnom * RAD) +
      4 * ecc * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * ecc * ecc * Math.sin(2 * meanAnom * RAD));

  const cosHa =
    Math.cos(ZENITH * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) -
    Math.tan(lat * RAD) * Math.tan(decl);
  if (cosHa > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (cosHa < -1) return { sunrise: null, sunset: null, polar: 'day' };

  const haMin = (Math.acos(cosHa) / RAD) * 4;
  const solarNoonMin = 720 - 4 * lon - eqTimeMin;
  return {
    sunrise: new Date(midnightUtc + (solarNoonMin - haMin) * 60000),
    sunset: new Date(midnightUtc + (solarNoonMin + haMin) * 60000),
    polar: null,
  };
}
