// driver/src/screens/scrollOnShow.js
//
// Every Driver screen opens scrolled to the top: when one of the six
// top-level screens goes from hidden to shown, the page and that screen's
// own scroll box are reset. The same happens to the visible screen when the
// driver comes back to the app (another app, or the screen was locked), so
// mid-journey the status card is always the first thing they see.
//
// It watches the screens' `hidden` attribute instead of hooking each place
// main.js shows a screen (about a dozen), so no show path can be missed.
// tests/driverScreens.test.js fails if a new screen in index.html is not
// listed below.
//
// Deliberately NOT reset: the tracker's List/Map/Directions/Log tabs (they
// sit below the status card; jumping to the top would move the view away
// from the tab just tapped) and scroll boxes inside a screen, e.g. the stop
// list, which keeps centring itself on the current stop (ui.js).

export const SCREEN_IDS = Object.freeze([
  'duty-card',
  'no-duty-card',
  'vehicle-setup',
  'manual-picker',
  'picker',
  'tracker',
]);

export function initScrollOnShow({
  doc = globalThis.document,
  win = globalThis.window,
  Observer = globalThis.MutationObserver,
} = {}) {
  const screens = SCREEN_IDS.map((id) => doc.getElementById(id)).filter(Boolean);

  function toTop(screen) {
    win.scrollTo(0, 0);
    if (screen) screen.scrollTop = 0;
  }

  // oldValue is the attribute's value before the change: '' when it was
  // hidden, null when it was already visible. Only a real hidden -> shown
  // change counts, so re-setting hidden = false on a showing screen (main.js
  // does) never yanks the driver back to the top.
  const observer = new Observer((records) => {
    for (const record of records) {
      if (record.attributeName === 'hidden' && record.oldValue !== null && !record.target.hidden) {
        toTop(record.target);
      }
    }
  });
  for (const screen of screens) {
    observer.observe(screen, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  }

  function onVisibilityChange() {
    if (doc.visibilityState !== 'visible') return;
    toTop(screens.find((screen) => !screen.hidden));
  }
  doc.addEventListener('visibilitychange', onVisibilityChange);

  return {
    disconnect() {
      observer.disconnect();
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
