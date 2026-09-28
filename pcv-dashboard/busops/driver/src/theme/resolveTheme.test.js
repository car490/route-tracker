import { describe, it, expect } from 'vitest';
import { resolveTheme, DEFAULT_LOCATION } from './resolveTheme.js';

const LONDON = { lat: 51.5074, lon: -0.1278 };

describe('resolveTheme', () => {
  it('returns an explicit light or dark preference unchanged, whatever the time', () => {
    const midnight = new Date('2026-06-21T00:00:00Z');
    const noon = new Date('2026-06-21T12:00:00Z');
    expect(resolveTheme({ preference: 'light', now: midnight, location: LONDON })).toBe('light');
    expect(resolveTheme({ preference: 'dark', now: noon, location: LONDON })).toBe('dark');
  });

  it('auto is light between sunrise and sunset', () => {
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-12-21T12:00:00Z'), location: LONDON })).toBe('light');
  });

  it('auto is dark before sunrise and after sunset', () => {
    // London midwinter: sunrise ~08:04Z, sunset ~15:53Z.
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-12-21T07:30:00Z'), location: LONDON })).toBe('dark');
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-12-21T16:30:00Z'), location: LONDON })).toBe('dark');
  });

  it('auto flips at the boundary, not minutes either side of it', () => {
    // London midsummer sunset ~20:21Z.
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-06-21T20:10:00Z'), location: LONDON })).toBe('light');
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-06-21T20:30:00Z'), location: LONDON })).toBe('dark');
  });

  it('auto without a GPS location falls back to the UK default location', () => {
    const now = new Date('2026-12-21T12:00:00Z');
    expect(resolveTheme({ preference: 'auto', now, location: null }))
      .toBe(resolveTheme({ preference: 'auto', now, location: DEFAULT_LOCATION }));
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-12-21T22:00:00Z') })).toBe('dark');
  });

  it('ignores a location with non-finite coordinates rather than producing NaN times', () => {
    const now = new Date('2026-12-21T12:00:00Z');
    expect(resolveTheme({ preference: 'auto', now, location: { lat: NaN, lon: 0 } })).toBe('light');
  });

  it('treats an unknown preference as auto', () => {
    const night = new Date('2026-12-21T22:00:00Z');
    expect(resolveTheme({ preference: 'sepia', now: night, location: LONDON })).toBe('dark');
  });

  it('handles polar day and night', () => {
    const svalbard = { lat: 78.22, lon: 15.65 };
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-06-21T00:00:00Z'), location: svalbard })).toBe('light');
    expect(resolveTheme({ preference: 'auto', now: new Date('2026-12-21T12:00:00Z'), location: svalbard })).toBe('dark');
  });
});
