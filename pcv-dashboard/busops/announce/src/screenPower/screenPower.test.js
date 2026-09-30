// announce/src/screenPower/screenPower.test.js
//
// The part that switches the Solo tablet's screen: Fully Kiosk's JavaScript
// interface (PLUS) behind a small adapter, and a controller that decides
// from the timetable plus the overrides (trip in progress, nothing loaded
// yet) and only calls Fully on a change.

import { describe, it, expect, vi } from 'vitest';
import { createFullyScreen, createScreenPower, REASSERT_MS } from './screenPower.js';

function fakeFully() {
  return { turnScreenOn: vi.fn(), turnScreenOff: vi.fn() };
}

describe('createFullyScreen', () => {
  it('is unavailable outside Fully (a browser, the replica, a test)', () => {
    const screen = createFullyScreen({});
    expect(screen.available()).toBe(false);
    expect(screen.turnOn()).toBe(false);
    expect(screen.turnOff()).toBe(false);
  });

  it('switches the screen through Fully, keeping the page running when off', () => {
    const fully = fakeFully();
    const screen = createFullyScreen({ fully });
    expect(screen.available()).toBe(true);
    expect(screen.turnOff()).toBe(true);
    expect(fully.turnScreenOff).toHaveBeenCalledWith(true);
    expect(screen.turnOn()).toBe(true);
    expect(fully.turnScreenOn).toHaveBeenCalled();
  });

  it('reports failure instead of throwing when Fully throws', () => {
    const fully = { turnScreenOn: () => { throw new Error('x'); }, turnScreenOff: () => { throw new Error('x'); } };
    const screen = createFullyScreen({ fully });
    expect(screen.turnOn()).toBe(false);
    expect(screen.turnOff()).toBe(false);
  });

  it('only ever calls the two screen functions', () => {
    const fully = new Proxy({}, { get: (_, name) => (name === 'turnScreenOn' || name === 'turnScreenOff' ? () => {} : undefined) });
    const touched = [];
    const host = { get fully() { return new Proxy(fully, { get: (t, n) => { touched.push(n); return t[n]; } }); } };
    const screen = createFullyScreen(host);
    screen.available();
    screen.turnOn();
    screen.turnOff();
    expect(new Set(touched)).toEqual(new Set(['turnScreenOn', 'turnScreenOff']));
  });
});

function setup() {
  const screen = { available: () => true, turnOn: vi.fn(() => true), turnOff: vi.fn(() => true) };
  const log = vi.fn();
  const power = createScreenPower({ screen, log });
  return { screen, log, power };
}

const T0 = new Date(2026, 9, 5, 12, 0);
const later = (ms) => new Date(T0.getTime() + ms);

describe('createScreenPower', () => {
  it('switches off outside the timetable once everything is loaded', () => {
    const { screen, power, log } = setup();
    expect(power.update({ now: T0, dataReady: true, scheduledOn: false, keepOn: false })).toBe(false);
    expect(screen.turnOff).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('screen off');
  });

  it('stays on while nothing is loaded yet (a dark sign in service is worse than wasted power)', () => {
    const { screen, power } = setup();
    expect(power.update({ now: T0, dataReady: false, scheduledOn: false, keepOn: false })).toBe(true);
    expect(screen.turnOn).toHaveBeenCalledTimes(1);
    expect(screen.turnOff).not.toHaveBeenCalled();
  });

  it('stays on during a trip, whatever the timetable says', () => {
    const { screen, power } = setup();
    expect(power.update({ now: T0, dataReady: true, scheduledOn: false, keepOn: true })).toBe(true);
    expect(screen.turnOff).not.toHaveBeenCalled();
  });

  it('switches back on when the timetable window opens', () => {
    const { screen, power } = setup();
    power.update({ now: T0, dataReady: true, scheduledOn: false, keepOn: false });
    power.update({ now: later(5000), dataReady: true, scheduledOn: true, keepOn: false });
    expect(screen.turnOn).toHaveBeenCalledTimes(1);
  });

  it('does not call Fully again while nothing changes', () => {
    const { screen, power } = setup();
    for (let i = 0; i < 10; i += 1) power.update({ now: later(i * 5000), dataReady: true, scheduledOn: false, keepOn: false });
    expect(screen.turnOff).toHaveBeenCalledTimes(1);
  });

  it('switches off again every few minutes, in case someone woke it with the power button', () => {
    const { screen, power } = setup();
    power.update({ now: T0, dataReady: true, scheduledOn: false, keepOn: false });
    power.update({ now: later(REASSERT_MS - 1), dataReady: true, scheduledOn: false, keepOn: false });
    expect(screen.turnOff).toHaveBeenCalledTimes(1);
    power.update({ now: later(REASSERT_MS), dataReady: true, scheduledOn: false, keepOn: false });
    expect(screen.turnOff).toHaveBeenCalledTimes(2);
  });

  it('retries on the next update if Fully refused', () => {
    const { screen, power } = setup();
    screen.turnOff.mockReturnValueOnce(false);
    power.update({ now: T0, dataReady: true, scheduledOn: false, keepOn: false });
    power.update({ now: later(5000), dataReady: true, scheduledOn: false, keepOn: false });
    expect(screen.turnOff).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all without Fully', () => {
    const screen = { available: () => false, turnOn: vi.fn(), turnOff: vi.fn() };
    const power = createScreenPower({ screen });
    expect(power.update({ now: T0, dataReady: true, scheduledOn: false, keepOn: false })).toBe(null);
    expect(screen.turnOff).not.toHaveBeenCalled();
  });
});
