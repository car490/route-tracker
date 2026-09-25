import { describe, it, expect } from 'vitest';
import {
  THEME_PREFERENCES,
  getThemePreference,
  setThemePreference,
  nextThemePreference,
  getLastResolvedTheme,
  setLastResolvedTheme,
  PREFERENCE_KEY,
  RESOLVED_KEY,
} from './themePreference.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

describe('themePreference', () => {
  it('offers exactly auto, light and dark, auto first', () => {
    expect(THEME_PREFERENCES).toEqual(['auto', 'light', 'dark']);
  });

  it('defaults to auto when nothing is stored', () => {
    expect(getThemePreference(memoryStorage())).toBe('auto');
  });

  it('round-trips a valid preference', () => {
    const storage = memoryStorage();
    setThemePreference('dark', storage);
    expect(storage.data[PREFERENCE_KEY]).toBe('dark');
    expect(getThemePreference(storage)).toBe('dark');
  });

  it('reads a tampered or unknown stored value as auto', () => {
    expect(getThemePreference(memoryStorage({ [PREFERENCE_KEY]: '<script>' }))).toBe('auto');
    expect(getThemePreference(memoryStorage({ [PREFERENCE_KEY]: 'DARK' }))).toBe('auto');
  });

  it('refuses to store anything outside the allowed values', () => {
    const storage = memoryStorage();
    expect(() => setThemePreference('red', storage)).toThrow();
    expect(storage.data[PREFERENCE_KEY]).toBeUndefined();
  });

  it('still works when storage is blocked', () => {
    expect(getThemePreference(throwingStorage)).toBe('auto');
    expect(() => setThemePreference('light', throwingStorage)).not.toThrow();
    expect(getLastResolvedTheme(throwingStorage)).toBeNull();
    expect(() => setLastResolvedTheme('dark', throwingStorage)).not.toThrow();
  });

  it('cycles auto -> light -> dark -> auto', () => {
    expect(nextThemePreference('auto')).toBe('light');
    expect(nextThemePreference('light')).toBe('dark');
    expect(nextThemePreference('dark')).toBe('auto');
    expect(nextThemePreference('bogus')).toBe('auto');
  });

  it('remembers the last resolved theme for the pre-paint boot script, light or dark only', () => {
    const storage = memoryStorage();
    expect(getLastResolvedTheme(storage)).toBeNull();
    setLastResolvedTheme('dark', storage);
    expect(storage.data[RESOLVED_KEY]).toBe('dark');
    expect(getLastResolvedTheme(storage)).toBe('dark');
    setLastResolvedTheme('auto', storage);
    expect(getLastResolvedTheme(storage)).toBe('dark');
    expect(getLastResolvedTheme(memoryStorage({ [RESOLVED_KEY]: 'x' }))).toBeNull();
  });
});
