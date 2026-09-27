import { describe, it, expect, vi } from 'vitest';
import { initTheme } from './themeController.js';
import { PREFERENCE_KEY, RESOLVED_KEY } from './themePreference.js';

const LONDON = { lat: 51.5074, lon: -0.1278 };
const WINTER_NOON = new Date('2026-12-21T12:00:00Z');
const WINTER_NIGHT = new Date('2026-12-21T22:00:00Z');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

function fakeRoot() {
  const attrs = {};
  return {
    attrs,
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k] ?? null,
  };
}

function fakeButton() {
  const attrs = {};
  const listeners = {};
  return {
    attrs,
    textContent: '',
    setAttribute: (k, v) => { attrs[k] = v; },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    click: () => listeners.click?.(),
  };
}

function setup({ stored = {}, now = WINTER_NOON } = {}) {
  const root = fakeRoot();
  const button = fakeButton();
  const metaThemeColor = { setAttribute: vi.fn() };
  const storage = memoryStorage(stored);
  let clock = now;
  const controller = initTheme({
    root,
    button,
    metaThemeColor,
    storage,
    now: () => clock,
    readBackground: (theme) => (theme === 'dark' ? '#14181F' : '#EFF1ED'),
    setTimer: () => 0,
  });
  return { root, button, metaThemeColor, storage, controller, setClock: (d) => { clock = d; } };
}

describe('initTheme', () => {
  it('applies the auto theme immediately on init', () => {
    expect(setup({ now: WINTER_NOON }).root.attrs['data-theme']).toBe('light');
    expect(setup({ now: WINTER_NIGHT }).root.attrs['data-theme']).toBe('dark');
  });

  it('honours a stored explicit preference', () => {
    const { root } = setup({ stored: { [PREFERENCE_KEY]: 'dark' }, now: WINTER_NOON });
    expect(root.attrs['data-theme']).toBe('dark');
  });

  it('remembers the resolved theme so the next launch paints the right one first', () => {
    const { storage } = setup({ now: WINTER_NIGHT });
    expect(storage.data[RESOLVED_KEY]).toBe('dark');
  });

  it('updates the browser toolbar colour to the theme background', () => {
    const { metaThemeColor } = setup({ now: WINTER_NIGHT });
    expect(metaThemeColor.setAttribute).toHaveBeenLastCalledWith('content', '#14181F');
  });

  it('labels the button with the current setting in words', () => {
    const { button } = setup();
    expect(button.textContent).toMatch(/Auto/);
    expect(button.attrs['aria-label']).toMatch(/Auto/);
  });

  it('cycles the setting on tap, applies it and saves it', () => {
    const { button, root, storage } = setup({ now: WINTER_NOON });
    button.click();
    expect(storage.data[PREFERENCE_KEY]).toBe('light');
    expect(root.attrs['data-theme']).toBe('light');
    expect(button.textContent).toMatch(/Light/);
    button.click();
    expect(storage.data[PREFERENCE_KEY]).toBe('dark');
    expect(root.attrs['data-theme']).toBe('dark');
    button.click();
    expect(storage.data[PREFERENCE_KEY]).toBe('auto');
    expect(root.attrs['data-theme']).toBe('light');
  });

  it('re-resolves auto as time passes', () => {
    const { root, controller, setClock } = setup({ now: WINTER_NOON });
    setClock(WINTER_NIGHT);
    controller.refresh();
    expect(root.attrs['data-theme']).toBe('dark');
  });

  it('uses the live GPS position once one is supplied', () => {
    // 16:05Z on 21 Dec: after sunset in London (~15:53Z), before it in
    // Penzance (~16:10Z) — only the location differs.
    const { root, controller } = setup({ now: new Date('2026-12-21T16:05:00Z') });
    controller.setLocation(LONDON.lat, LONDON.lon);
    expect(root.attrs['data-theme']).toBe('dark');
    controller.setLocation(50.118, -5.537);
    expect(root.attrs['data-theme']).toBe('light');
  });

  it('does not rewrite storage or the toolbar colour on every GPS fix', () => {
    const { controller, metaThemeColor, storage } = setup({ now: WINTER_NOON });
    const setItem = vi.spyOn(storage, 'setItem');
    metaThemeColor.setAttribute.mockClear();
    for (let i = 0; i < 5; i++) controller.setLocation(LONDON.lat, LONDON.lon);
    expect(setItem).not.toHaveBeenCalled();
    expect(metaThemeColor.setAttribute).not.toHaveBeenCalled();
  });

  it('ignores non-numeric coordinates', () => {
    const { root, controller } = setup({ now: WINTER_NOON });
    controller.setLocation('51.5', undefined);
    expect(root.attrs['data-theme']).toBe('light');
  });

  it('works without a button or meta tag', () => {
    const root = fakeRoot();
    expect(() => initTheme({ root, storage: memoryStorage(), now: () => WINTER_NOON, setTimer: () => 0 })).not.toThrow();
    expect(root.attrs['data-theme']).toBe('light');
  });
});
