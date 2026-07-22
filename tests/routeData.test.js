import { routeData } from '../src/routeData.js';

const EXPECTED_SERVICES = ['S116S', 'S125S'];
const EXPECTED_VARIANTS = ['Morning Outbound', 'Afternoon Inbound'];

describe('routeData — lookup shape', () => {
  test('has exactly the two expected services, no more, no fewer', () => {
    expect(Object.keys(routeData).sort()).toEqual([...EXPECTED_SERVICES].sort());
  });

  test.each(EXPECTED_SERVICES)('service %s has exactly the two expected variants', (service) => {
    expect(Object.keys(routeData[service]).sort()).toEqual([...EXPECTED_VARIANTS].sort());
  });

  for (const service of EXPECTED_SERVICES) {
    for (const variant of EXPECTED_VARIANTS) {
      test(`${service} / ${variant} maps to a single, non-empty timetable_departure_id string`, () => {
        const value = routeData[service]?.[variant];
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      });
    }
  }

  test('has no duplicate timetable_departure_id values across entries (each maps to exactly one)', () => {
    const ids = EXPECTED_SERVICES.flatMap((s) => EXPECTED_VARIANTS.map((v) => routeData[s]?.[v]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
