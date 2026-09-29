// node --test supabase/functions/_shared/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAPTAN_AREAS, areaCodesForCounties, naptanCsvUrl, atcoInAreas, stopFromNaptanRow, unknownCountiesMessage,
} from './naptanAreas.mjs';

test('Lincolnshire is NaPTAN area 270 (every stop our timetables use starts 270)', () => {
  assert.deepEqual(areaCodesForCounties(['Lincolnshire']), { codes: ['270'], unknown: [] });
});

test('county names match regardless of case, spacing and "&"/"and"', () => {
  assert.deepEqual(areaCodesForCounties(['  lincolnshire ', 'NORTH  EAST LINCOLNSHIRE', 'Kingston upon Hull']).codes,
    ['228', '229', '270']);
});

test('codes are de-duplicated and sorted; unknown names are reported, never guessed', () => {
  const r = areaCodesForCounties(['Lincolnshire', 'lincolnshire', 'Atlantis', '', null]);
  assert.deepEqual(r.codes, ['270']);
  assert.deepEqual(r.unknown, ['Atlantis', '', '']);
  assert.match(unknownCountiesMessage(r.unknown), /Atlantis/);
  assert.match(unknownCountiesMessage(r.unknown), /naptanAreas\.mjs/);
});

test('every area in the table is a three-digit ATCO area code, each used once', () => {
  const codes = Object.values(NAPTAN_AREAS).map((a) => a.code);
  for (const c of codes) assert.match(c, /^\d{3}$/);
  assert.equal(new Set(codes).size, codes.length);
});

test('the NaPTAN URL asks the DfT API for just those areas, as CSV', () => {
  const url = new URL(naptanCsvUrl(['270', '227']));
  assert.equal(url.origin + url.pathname, 'https://naptan.api.dft.gov.uk/v1/access-nodes');
  assert.equal(url.searchParams.get('dataFormat'), 'csv');
  assert.equal(url.searchParams.get('atcoAreaCodes'), '227,270');
});

test('the URL builder refuses anything but three-digit codes, and an empty list', () => {
  for (const bad of [[], ['27'], ['2700'], ['270&x=1'], ['abc'], [270]]) {
    assert.throws(() => naptanCsvUrl(bad), /area code/, JSON.stringify(bad));
  }
});

test('an ATCO code is in the areas only by its three-digit prefix', () => {
  assert.equal(atcoInAreas('2700ABC123', ['270']), true);
  assert.equal(atcoInAreas('2270ABC123', ['270']), false);
  assert.equal(atcoInAreas('', ['270']), false);
  assert.equal(atcoInAreas(undefined, ['270']), false);
});

const row = (over = {}) => ({
  ATCOCode: '2700LIN001', NaptanCode: 'linabc', CommonName: 'Bus Station', LocalityName: 'Lincoln',
  Street: 'High St', Indicator: 'Stand A', Bearing: 'N', Latitude: '53.2', Longitude: '-0.54',
  StopType: 'BCT', Status: 'Active', ...over,
});

test('a bus stop row in the areas becomes a naptan_stops record', () => {
  assert.deepEqual(stopFromNaptanRow(row(), ['270'], '2026-09-29T00:00:00.000Z'), {
    atco_code: '2700LIN001', naptan_code: 'linabc', common_name: 'Bus Station', locality_name: 'Lincoln',
    street: 'High St', indicator: 'Stand A', bearing: 'N', lat: 53.2, lon: -0.54,
    stop_type: 'BCT', status: 'active', updated_at: '2026-09-29T00:00:00.000Z',
  });
  assert.equal(stopFromNaptanRow(row({ ATCOCode: '', AtcoCode: '2700LIN002' }), ['270'], 't').atco_code, '2700LIN002');
  assert.equal(stopFromNaptanRow(row({ Status: '' }), ['270'], 't').status, 'active');
  assert.equal(stopFromNaptanRow(row({ Status: 'Inactive' }), ['270'], 't').status, 'inactive');
});

test('rows outside the areas, not bus stops, or without a position are skipped', () => {
  assert.equal(stopFromNaptanRow(row({ ATCOCode: '2600LEI001' }), ['270'], 't'), null, 'other area');
  assert.equal(stopFromNaptanRow(row({ StopType: 'RLY' }), ['270'], 't'), null, 'rail');
  assert.equal(stopFromNaptanRow(row({ Latitude: '' }), ['270'], 't'), null, 'no position');
  assert.equal(stopFromNaptanRow(row({ ATCOCode: '', AtcoCode: '' }), ['270'], 't'), null, 'no code');
});
