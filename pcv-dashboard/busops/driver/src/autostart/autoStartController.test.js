import { describe, it, expect, vi } from 'vitest';
import { initAutoStart, MATCH_CONFIG } from './autoStartController.js';

// Monday 28 Sep 2026, local time. The S116S leaves Boston Bus Station at 07:40.
const at = (h, m, day = 28) => new Date(2026, 8, day, h, m);
const BUS_STATION = { lat: 52.9776, lon: -0.0253 };
const ELSEWHERE = { lat: 52.99, lon: -0.05 }; // well outside 150 m

const S116S = {
  departureId: 'd-s116s',
  serviceCode: 'S116S',
  label: 'Boston – Donington',
  departureTime: '07:40',
  firstStopName: 'Boston Bus Station (Bay 8)',
  firstStopLat: BUS_STATION.lat,
  firstStopLon: BUS_STATION.lon,
  daysOfWeek: [1, 2, 3, 4, 5],
  schoolTermTime: false,
  removedDates: [],
  addedDates: [],
};
const SUNDAY_ONLY = { ...S116S, departureId: 'd-sunday', daysOfWeek: [7] };

function fakeUi() {
  const handlers = {};
  return {
    calls: [],
    bind(h) { Object.assign(handlers, h); },
    showCountdown(candidate, seconds) { this.calls.push(['countdown', candidate.departureId, seconds]); },
    updateCountdown(seconds) { this.calls.push(['update', seconds]); },
    showStarting(candidate) { this.calls.push(['starting', candidate.departureId]); },
    showError(message) { this.calls.push(['error', message]); },
    hide() { this.calls.push(['hide']); },
    press(name) { return handlers[name](); },
    last() { return this.calls[this.calls.length - 1]; },
  };
}

function setup({ candidates = [S116S], position = BUS_STATION, now = at(7, 35), onStart, testing = false, loadCandidates } = {}) {
  let clock = now;
  let pos = position;
  const timers = [];
  const ui = fakeUi();
  const started = [];
  const changed = [];
  const controller = initAutoStart({
    loadCandidates: loadCandidates ?? (async () => ({ candidates, termDateRanges: [] })),
    getPosition: async () => pos,
    now: () => clock,
    ui,
    onStart: onStart ?? (async (candidate, opts) => { started.push([candidate.departureId, opts.shiftMinutes]); }),
    onChange: (candidate) => changed.push(candidate.departureId),
    testing,
    setInterval: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearInterval: (id) => { if (timers[id]) timers[id].live = false; },
  });
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const t of timers.filter((t) => t.live && t.ms === 1000)) await t.fn();
    }
  };
  return {
    controller, ui, started, changed, timers, tick,
    setClock: (d) => { clock = d; },
    setPosition: (p) => { pos = p; },
  };
}

describe('initAutoStart', () => {
  it('uses the same match settings as a Solo device by default', () => {
    expect(MATCH_CONFIG).toEqual({ terminusRadiusM: 150, matchWindowBeforeMin: 15, matchWindowAfterMin: 30 });
  });

  it('polls GPS every 5 seconds once started, and not before', async () => {
    const { controller, timers } = setup();
    expect(timers).toHaveLength(0);
    await controller.start();
    expect(timers.filter((t) => t.live && t.ms === 5000)).toHaveLength(1);
  });

  it('at the first stop inside the time window, offers the departure with a 10 second countdown', async () => {
    const { controller, ui } = setup();
    await controller.start();
    await controller.poll();
    expect(ui.last()).toEqual(['countdown', 'd-s116s', 10]);
    expect(controller.getState().phase).toBe('countdown');
  });

  it('does nothing away from the first stop, or outside the time window', async () => {
    const away = setup({ position: ELSEWHERE });
    await away.controller.start();
    await away.controller.poll();
    expect(away.ui.calls).toEqual([]);

    const tooEarly = setup({ now: at(7, 0) });
    await tooEarly.controller.start();
    await tooEarly.controller.poll();
    expect(tooEarly.ui.calls).toEqual([]);
  });

  it('ignores a departure that does not run today', async () => {
    const { controller, ui } = setup({ candidates: [SUNDAY_ONLY] });
    await controller.start();
    await controller.poll();
    expect(ui.calls).toEqual([]);
  });

  it('starts the journey by itself when the countdown reaches zero', async () => {
    const { controller, ui, started, tick } = setup();
    await controller.start();
    await controller.poll();
    await tick(9);
    expect(ui.last()).toEqual(['update', 1]);
    expect(started).toEqual([]);
    await tick(1);
    expect(started).toEqual([['d-s116s', 0]]);
    expect(ui.calls).toContainEqual(['starting', 'd-s116s']);
    expect(ui.last()).toEqual(['hide']);
    expect(controller.getState().phase).toBe('running');
  });

  it('Start now starts immediately and stops the countdown', async () => {
    const { controller, started, tick } = setup();
    await controller.start();
    await controller.poll();
    await controller.startNow();
    expect(started).toHaveLength(1);
    await tick(20);
    expect(started).toHaveLength(1);
  });

  it('Not now hides the offer and does not offer the same departure again today', async () => {
    const { controller, ui, started, tick } = setup();
    await controller.start();
    await controller.poll();
    ui.press('onCancel');
    expect(ui.last()).toEqual(['hide']);
    await tick(20);
    await controller.poll();
    expect(started).toEqual([]);
    expect(controller.getState().phase).toBe('watching');
    expect(ui.calls.filter((c) => c[0] === 'countdown')).toHaveLength(1);
  });

  it('offers it again the next day', async () => {
    const { controller, ui, setClock } = setup();
    await controller.start();
    await controller.poll();
    ui.press('onCancel');
    setClock(at(7, 35, 29));
    await controller.poll();
    expect(ui.calls.filter((c) => c[0] === 'countdown')).toHaveLength(2);
  });

  it('Change service hands over to the manual picker and pauses automatic mode', async () => {
    const { controller, ui, changed, started } = setup();
    await controller.start();
    await controller.poll();
    ui.press('onChange');
    expect(changed).toEqual(['d-s116s']);
    await controller.poll();
    expect(started).toEqual([]);
    expect(controller.getState().phase).toBe('paused');
    controller.resume();
    expect(controller.getState().phase).toBe('watching');
  });

  it('a start the server refuses shows a plain message and does not retry that departure', async () => {
    const { controller, ui } = setup({ onStart: async () => { throw new Error('service does not run today'); } });
    await controller.start();
    await controller.poll();
    await controller.startNow();
    expect(ui.last()[0]).toBe('error');
    expect(ui.last()[1]).toMatch(/Couldn.t start S116S 07:40/);
    expect(controller.getState()).toMatchObject({ phase: 'watching', dismissed: ['d-s116s'] });
  });

  it('does not poll while an offer or a journey is in progress, and resumes after the journey ends', async () => {
    const getPosition = vi.fn(async () => BUS_STATION);
    const ui = fakeUi();
    const c = initAutoStart({
      loadCandidates: async () => ({ candidates: [S116S], termDateRanges: [] }),
      getPosition, now: () => at(7, 35), ui, onStart: async () => {},
      setInterval: () => 0, clearInterval: () => {},
    });
    await c.start();
    await c.poll();
    await c.startNow();
    getPosition.mockClear();
    await c.poll();
    expect(getPosition).not.toHaveBeenCalled();
    c.journeyEnded();
    await c.poll();
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it('skips a tick without a GPS fix or before the timetable has loaded', async () => {
    const noFix = setup({ position: null });
    await noFix.controller.start();
    await expect(noFix.controller.poll()).resolves.toBeUndefined();
    expect(noFix.ui.calls).toEqual([]);

    let attempts = 0;
    const offlineFirst = setup({
      loadCandidates: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return { candidates: [S116S], termDateRanges: [] };
      },
    });
    await offlineFirst.controller.start();
    await offlineFirst.controller.poll(); // timetable unavailable: nothing yet
    expect(offlineFirst.ui.calls).toEqual([]);
    await offlineFirst.controller.poll(); // next tick retries the load
    expect(offlineFirst.ui.last()).toEqual(['countdown', 'd-s116s', 10]);
  });

  it('in testing mode (?debug) matches the first stop at any time, shifting the timetable to now', async () => {
    const { controller, started } = setup({ now: at(13, 40), testing: true });
    await controller.start();
    await controller.poll();
    await controller.startNow();
    expect(started).toEqual([['d-s116s', 360]]);
  });

  it('never uses the testing fallback on a live device', async () => {
    const { controller, ui } = setup({ now: at(13, 40), testing: false });
    await controller.start();
    await controller.poll();
    expect(ui.calls).toEqual([]);
  });

  it('only offers while its screen is showing (isActive), never over a picker or a journey', async () => {
    let active = false;
    const getPosition = vi.fn(async () => BUS_STATION);
    const ui = fakeUi();
    const c = initAutoStart({
      loadCandidates: async () => ({ candidates: [S116S], termDateRanges: [] }),
      getPosition, now: () => at(7, 35), ui, onStart: async () => {},
      isActive: () => active,
      setInterval: () => 0, clearInterval: () => {},
    });
    await c.start();
    await c.poll();
    expect(getPosition).not.toHaveBeenCalled();
    expect(ui.calls).toEqual([]);
    active = true;
    await c.poll();
    expect(ui.last()).toEqual(['countdown', 'd-s116s', 10]);
  });

  it('stop() clears its timers and hides any offer', async () => {
    const { controller, ui, timers } = setup();
    await controller.start();
    await controller.poll();
    controller.stop();
    expect(timers.every((t) => !t.live)).toBe(true);
    expect(ui.last()).toEqual(['hide']);
  });
});

describe('getBrowserPosition', () => {
  it('resolves a one-off high-accuracy fix, the same options a Solo device uses', async () => {
    const { getBrowserPosition } = await import('./autoStartController.js');
    const geolocation = {
      getCurrentPosition: vi.fn((ok, _err, opts) => {
        expect(opts).toEqual({ enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
        ok({ coords: { latitude: 52.97, longitude: -0.02 } });
      }),
    };
    await expect(getBrowserPosition(geolocation)).resolves.toEqual({ lat: 52.97, lon: -0.02 });
  });

  it('resolves null on a GPS error or when there is no geolocation at all', async () => {
    const { getBrowserPosition } = await import('./autoStartController.js');
    const failing = { getCurrentPosition: (_ok, err) => err(new Error('denied')) };
    await expect(getBrowserPosition(failing)).resolves.toBeNull();
    await expect(getBrowserPosition(undefined)).resolves.toBeNull();
  });
});
