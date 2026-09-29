// Which NaPTAN stops belong to a company's service counties, without any
// geocoding service (2026-09-29; replaced OpenCage county bounding boxes).
// Plain JS with no imports: shared by the naptan-import Edge Function (Deno)
// and supabase/scripts/import-naptan.js (Node), tested by naptanAreas.test.mjs.
//
// Every NaPTAN stop's ATCO code starts with the three-digit ATCO area code of
// the local transport authority that owns it (Lincolnshire: 270...). The DfT
// NaPTAN API can return just those areas, so a county maps to area codes and
// the import asks for exactly that county, instead of downloading the whole
// country and keeping what falls in a rectangle round it (which cut corners
// off the county and took in its neighbours).

// Verified entries only. Each code was checked 2026-09-29 against production's
// naptan_stops (stops with that ATCO prefix and their locality names). To add
// a county: find its ATCO area code (the first three digits of any of its
// stops' ATCO codes on the NaPTAN download, or DfT's NPTG admin-area list),
// check a few of its stops' localities really are in that county, add it here
// with that evidence, and add it to companies.service_counties.
export const NAPTAN_AREAS = Object.freeze({
  'lincolnshire':             { code: '270', evidence: 'Aby, Alford; all 199 timetable stops' },
  'north lincolnshire':       { code: '227', evidence: 'Alkborough, Appleby' },
  'north east lincolnshire':  { code: '228', evidence: 'Aylesby, Bargate' },
  'leicestershire':           { code: '260', evidence: 'Ab Kettleby, Anstey' },
  'leicester':                { code: '269', evidence: 'Aylestone, Belgrave' },
  'rutland':                  { code: '268', evidence: 'Ayston, Barleythorpe' },
  'nottinghamshire':          { code: '330', evidence: 'Askham, Aslockton' },
  'east riding of yorkshire': { code: '220', evidence: 'Anlaby, Airmyn' },
  'kingston upon hull':       { code: '229', evidence: 'Anlaby Park, Botanic' },
  'doncaster':                { code: '370', evidence: 'Finningley, Hatfield' },
  'north yorkshire':          { code: '320', evidence: 'Drax' },
});

const BUS_STOP_TYPES = new Set(['BCT', 'BCS', 'BCQ', 'BCP']);
const NAPTAN_ACCESS_NODES = 'https://naptan.api.dft.gov.uk/v1/access-nodes';
const AREA_CODE = /^\d{3}$/;

function normalise(name) {
  return String(name ?? '').trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');
}

// County names -> sorted, de-duplicated area codes, plus the names not in the
// table (reported as given; never guessed).
export function areaCodesForCounties(countyNames) {
  const codes = new Set();
  const unknown = [];
  for (const name of countyNames ?? []) {
    const area = NAPTAN_AREAS[normalise(name)];
    if (area) codes.add(area.code);
    else unknown.push(String(name ?? ''));
  }
  return { codes: [...codes].sort(), unknown };
}

export function unknownCountiesMessage(unknown) {
  return `No NaPTAN area code for service count${unknown.length === 1 ? 'y' : 'ies'} ` +
    `${unknown.map((n) => JSON.stringify(n)).join(', ')}. Add it to NAPTAN_AREAS in ` +
    'supabase/functions/_shared/naptanAreas.mjs (with the stops that prove the code) or correct the name.';
}

// The DfT API URL for just these areas. Codes are checked, since they go into a URL.
export function naptanCsvUrl(areaCodes) {
  if (!Array.isArray(areaCodes) || !areaCodes.length || !areaCodes.every((c) => typeof c === 'string' && AREA_CODE.test(c))) {
    throw new Error(`NaPTAN area codes must be three-digit strings, got ${JSON.stringify(areaCodes)}`);
  }
  const url = new URL(NAPTAN_ACCESS_NODES);
  url.searchParams.set('dataFormat', 'csv');
  url.searchParams.set('atcoAreaCodes', [...new Set(areaCodes)].sort().join(','));
  return url.toString();
}

export function atcoInAreas(atcoCode, areaCodes) {
  return typeof atcoCode === 'string' && atcoCode.length > 3 && areaCodes.includes(atcoCode.slice(0, 3));
}

// One parsed NaPTAN CSV row (header -> value) -> a naptan_stops record, or null
// when it is not a bus/coach stop, has no position, or is outside the areas.
// The area check stands even though the URL already asks for those areas, so
// the result is right whatever the API returns.
export function stopFromNaptanRow(row, areaCodes, nowIso) {
  const atco = row.ATCOCode || row.AtcoCode || '';
  const stopType = row.StopType || '';
  if (!BUS_STOP_TYPES.has(stopType) || !atcoInAreas(atco, areaCodes)) return null;
  const lat = parseFloat(row.Latitude);
  const lon = parseFloat(row.Longitude);
  if (!lat || !lon) return null;
  return {
    atco_code:     atco,
    naptan_code:   row.NaptanCode || null,
    common_name:   row.CommonName || '',
    locality_name: row.LocalityName || null,
    street:        row.Street || null,
    indicator:     row.Indicator || null,
    bearing:       row.Bearing || null,
    lat,
    lon,
    stop_type:     stopType,
    status:        (row.Status || '').toLowerCase() || 'active',
    updated_at:    nowIso,
  };
}
