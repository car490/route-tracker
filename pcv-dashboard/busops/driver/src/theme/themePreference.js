// driver/src/theme/themePreference.js
//
// The driver's display setting, kept on this device only. Storage is
// injectable (same pattern as localStore.js) and every access is wrapped:
// a blocked or full localStorage must never stop the app painting.
//
// Only the three known values are ever written or honoured, so nothing read
// back from storage can reach the DOM as anything other than 'light'/'dark'.
//
// PREFERENCE_KEY and RESOLVED_KEY are also read by the small pre-paint script
// in driver/index.html's <head>; keep the names in sync with it.

export const THEME_PREFERENCES = Object.freeze(['auto', 'light', 'dark']);
export const PREFERENCE_KEY = 'busops.driver.theme';
export const RESOLVED_KEY = 'busops.driver.theme.resolved';

function isPreference(value) {
  return THEME_PREFERENCES.includes(value);
}

function isTheme(value) {
  return value === 'light' || value === 'dark';
}

export function getThemePreference(storage = globalThis.localStorage) {
  try {
    const value = storage.getItem(PREFERENCE_KEY);
    return isPreference(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function setThemePreference(value, storage = globalThis.localStorage) {
  if (!isPreference(value)) throw new Error(`Unknown theme preference: ${value}`);
  try {
    storage.setItem(PREFERENCE_KEY, value);
  } catch {
    // Not persisted this time; the setting still applies for this session.
  }
}

export function nextThemePreference(current) {
  const i = THEME_PREFERENCES.indexOf(current);
  return i === -1 ? 'auto' : THEME_PREFERENCES[(i + 1) % THEME_PREFERENCES.length];
}

export function getLastResolvedTheme(storage = globalThis.localStorage) {
  try {
    const value = storage.getItem(RESOLVED_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function setLastResolvedTheme(theme, storage = globalThis.localStorage) {
  if (!isTheme(theme)) return;
  try {
    storage.setItem(RESOLVED_KEY, theme);
  } catch {
    // Best effort only: it just saves one repaint on the next launch.
  }
}
