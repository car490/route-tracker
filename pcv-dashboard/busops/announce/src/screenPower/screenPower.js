// announce/src/screenPower/screenPower.js
//
// Switches the Announce Solo tablet's screen on and off (owner, 2026-09-30;
// docs/DECISIONS.md "Solo screen power"). A page can't switch a sleeping
// screen back on by itself (a wake lock only keeps one on — the 2026-09-29
// live run stayed dark), so this goes through Fully Kiosk's JavaScript
// interface (PLUS, `websiteIntegration` in cab-device/fully-auto-settings.json).
// turnScreenOff(true) keeps the page running with the screen off, which is
// what lets turnScreenOn() bring it back.
//
// Security: Fully exposes far more than the screen through that interface.
// Only createFullyScreen touches it, and only its two screen functions; the
// kiosk is restricted to our own site (urlWhitelist, guarded by
// tests/soloKioskSettings.test.js).
//
// Decision, in order:
//   - nothing loaded yet (no departures, no term dates) -> on: a dark sign
//     in service is worse than wasted power
//   - a trip in progress, a saved trip waiting to carry on, the terminus
//     hold, or a departure's wake window -> on
//   - otherwise whatever the timetable says (screenSchedule.js)

// Re-applies "off" this often, so a screen someone woke with the power
// button goes dark again (and "on" is re-applied the same way).
export const REASSERT_MS = 10 * 60 * 1000;

/**
 * Fully Kiosk's screen control, or an unavailable stand-in outside Fully.
 * Reads `fully` at call time (Fully injects it into the page).
 */
export function createFullyScreen(host = globalThis) {
  const call = (name, ...args) => {
    const fn = host?.fully?.[name];
    if (typeof fn !== 'function') return false;
    try {
      fn.apply(host.fully, args);
      return true;
    } catch (_) {
      return false;
    }
  };
  return {
    available: () => typeof host?.fully?.turnScreenOn === 'function' && typeof host?.fully?.turnScreenOff === 'function',
    turnOn: () => call('turnScreenOn'),
    turnOff: () => call('turnScreenOff', true),
  };
}

/**
 * @param {{ screen: ReturnType<typeof createFullyScreen>, log?: (msg: string) => void }} deps
 */
export function createScreenPower({ screen, log = () => {} }) {
  let applied = null;
  let appliedAt = 0;

  return {
    /**
     * @param {{ now: Date, dataReady: boolean, scheduledOn: boolean, keepOn: boolean }} inputs
     * @returns {boolean|null} whether the screen should be on; null without Fully
     */
    update({ now, dataReady, scheduledOn, keepOn }) {
      if (!screen?.available()) return null;
      const want = !dataReady || keepOn || scheduledOn;
      const due = now.getTime() - appliedAt >= REASSERT_MS;
      if (want === applied && !due) return want;
      const ok = want ? screen.turnOn() : screen.turnOff();
      if (ok) {
        if (want !== applied) log(want ? 'screen on' : 'screen off');
        applied = want;
        appliedAt = now.getTime();
      }
      return want;
    },
  };
}
