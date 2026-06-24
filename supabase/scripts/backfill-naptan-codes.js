// One-off backfill: match existing `stops` rows to naptan_stops by proximity,
// then set naptan_code for clean matches.
//
// Dry run (2026-06-23) showed existing stop coordinates already sit within
// 0.0-0.1m of the surveyed NAPTAN position, so this only tags naptan_code -
// it does not touch lat/lon.
//
// Usage:
//   node backfill-naptan-codes.js                 -> dry run, prints proposed matches only
//   node backfill-naptan-codes.js --apply          -> writes naptan_code for clean matches
//
// Env required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY   (needed for --apply; dry run works with anon key too)

const SEARCH_RADIUS_M = 100;

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY for dry run).');
  process.exit(1);
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const stops = await sb('/stops?select=id,name,lat,lon,naptan_code,is_depot&is_depot=eq.false&order=name');

  const claimed = new Map(); // atco_code -> stop name, to flag collisions
  const rows = [];

  for (const stop of stops) {
    const matches = await sb('/rpc/naptan_near_point', {
      method: 'POST',
      body: JSON.stringify({ p_lat: stop.lat, p_lon: stop.lon, p_radius_m: SEARCH_RADIUS_M }),
    });

    const best = matches[0];
    rows.push({ stop, best, collision: false });

    if (best) {
      if (claimed.has(best.atco_code)) {
        rows.find(r => r.stop.id === stop.id).collision = claimed.get(best.atco_code);
      } else {
        claimed.set(best.atco_code, stop.name);
      }
    }
  }

  console.log(`\n${stops.length} non-depot stops checked, search radius ${SEARCH_RADIUS_M}m\n`);
  console.log('stop_name'.padEnd(45), 'distance_m'.padEnd(11), 'matched_naptan_stop'.padEnd(40), 'atco_code');
  console.log('-'.repeat(120));

  let matched = 0;
  for (const { stop, best, collision } of rows) {
    if (best) matched++;
    const line = [
      stop.name.slice(0, 44).padEnd(45),
      (best ? best.distance_m.toFixed(1) : '-').padEnd(11),
      (best ? best.common_name.slice(0, 39) : '(no match)').padEnd(40),
      best ? best.atco_code : '',
    ].join(' ');
    console.log(collision ? `${line}  <-- COLLISION with "${collision}"` : line);
  }

  console.log(`\n${matched}/${stops.length} matched within ${SEARCH_RADIUS_M}m; ${stops.length - matched} unmatched.\n`);

  if (!APPLY) {
    console.log('Dry run only — no changes written. Re-run with --apply to write naptan_code + lat/lon.');
    return;
  }

  for (const { stop, best, collision } of rows) {
    if (!best || collision) continue;
    await sb(`/stops?id=eq.${stop.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ naptan_code: best.atco_code }),
    });
    console.log(`Updated ${stop.name} -> naptan_code ${best.atco_code}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
