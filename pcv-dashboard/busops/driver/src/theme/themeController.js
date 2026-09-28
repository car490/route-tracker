// driver/src/theme/themeController.js
//
// The theme slice's only side effects: sets <html data-theme>, the browser
// toolbar colour and the Auto / Light / Dark button, saves the setting, and
// re-checks Auto once a minute and whenever a new GPS position arrives.
// The decision itself lives in resolveTheme.js (pure, tested there).
//
// Everything DOM-shaped is injected so this runs under Vitest's node
// environment without a browser.

import { resolveTheme } from './resolveTheme.js';
import {
  getThemePreference,
  setThemePreference,
  nextThemePreference,
  setLastResolvedTheme,
} from './themePreference.js';

const REFRESH_MS = 60 * 1000;

const LABELS = {
  auto: { text: '◐ Auto', aria: 'Display: Auto, follows sunrise and sunset. Tap for Light.' },
  light: { text: '☀ Light', aria: 'Display: Light. Tap for Dark.' },
  dark: { text: '☾ Dark', aria: 'Display: Dark. Tap for Auto.' },
};

function cssBackground(root) {
  return () => globalThis.getComputedStyle?.(root).getPropertyValue('--bg').trim() || null;
}

export function initTheme({
  root = globalThis.document?.documentElement,
  button = null,
  metaThemeColor = null,
  storage = globalThis.localStorage,
  now = () => new Date(),
  readBackground = null,
  setTimer = (fn, ms) => setInterval(fn, ms),
} = {}) {
  let preference = getThemePreference(storage);
  let location = null;
  const background = readBackground ?? cssBackground(root);

  let applied = null;

  // Cheap enough to call on every GPS fix: the DOM, storage and toolbar
  // colour are only touched when the resolved theme actually changes.
  function apply() {
    const theme = resolveTheme({ preference, now: now(), location });
    if (theme !== applied) {
      applied = theme;
      root.setAttribute('data-theme', theme);
      setLastResolvedTheme(theme, storage);
      const colour = background(theme);
      if (metaThemeColor && colour) metaThemeColor.setAttribute('content', colour);
    }
    if (button) {
      button.textContent = LABELS[preference].text;
      button.setAttribute('aria-label', LABELS[preference].aria);
    }
  }

  if (button) {
    button.addEventListener('click', () => {
      preference = nextThemePreference(preference);
      setThemePreference(preference, storage);
      apply();
    });
  }

  apply();
  setTimer(apply, REFRESH_MS);

  return {
    refresh: apply,
    setLocation(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      location = { lat, lon };
      apply();
    },
  };
}
