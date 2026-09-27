import { describe, it, expect, vi } from 'vitest';
import { createAutoStartOverlay, OVERLAY_IDS } from './autoStartOverlay.js';

function fakeDoc() {
  const els = {};
  for (const id of OVERLAY_IDS) {
    const listeners = {};
    els[id] = {
      id,
      hidden: true,
      textContent: '',
      disabled: false,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      click: () => listeners.click?.(),
      focus: vi.fn(),
    };
  }
  return { getElementById: (id) => els[id] ?? null, els };
}

const CAND = {
  departureId: 'd1',
  serviceCode: 'S116S',
  label: 'Boston – Donington',
  departureTime: '07:40',
  firstStopName: 'Boston Bus Station (Bay 8)',
};

describe('createAutoStartOverlay', () => {
  it('covers the overlay, its text and its three buttons', () => {
    expect(OVERLAY_IDS).toEqual([
      'autostart-overlay', 'as-title', 'as-service', 'as-detail', 'as-countdown', 'as-message',
      'as-start-now', 'as-change', 'as-cancel',
    ]);
  });

  it('shows the matched service in plain words with the countdown, and focuses Start now', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    ui.showCountdown(CAND, 10);
    expect(doc.els['autostart-overlay'].hidden).toBe(false);
    expect(doc.els['as-service'].textContent).toBe('S116S · Boston – Donington');
    expect(doc.els['as-detail'].textContent).toBe('Departs 07:40 from Boston Bus Station (Bay 8)');
    expect(doc.els['as-countdown'].textContent).toBe('Starting in 10 seconds');
    expect(doc.els['as-message'].hidden).toBe(true);
    expect(doc.els['as-start-now'].focus).toHaveBeenCalled();
  });

  it('updates the countdown, with "1 second" singular', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    ui.showCountdown(CAND, 10);
    ui.updateCountdown(1);
    expect(doc.els['as-countdown'].textContent).toBe('Starting in 1 second');
  });

  it('while starting, says so and disables the buttons', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    ui.showCountdown(CAND, 10);
    ui.showStarting(CAND);
    expect(doc.els['as-countdown'].textContent).toBe('Starting S116S…');
    for (const id of ['as-start-now', 'as-change', 'as-cancel']) expect(doc.els[id].disabled).toBe(true);
  });

  it('shows an error message and leaves only Close available', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    ui.showError("Couldn't start S116S 07:40. Choose the service yourself.");
    expect(doc.els['autostart-overlay'].hidden).toBe(false);
    expect(doc.els['as-message'].hidden).toBe(false);
    expect(doc.els['as-message'].textContent).toMatch(/Couldn't start/);
    expect(doc.els['as-start-now'].hidden).toBe(true);
    expect(doc.els['as-change'].hidden).toBe(true);
    expect(doc.els['as-cancel'].textContent).toBe('Close');
    expect(doc.els['as-cancel'].disabled).toBe(false);
  });

  it('in the error state drops the countdown and says automatic start stopped', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    ui.showCountdown(CAND, 10);
    ui.updateCountdown(7);
    ui.showError('x');
    expect(doc.els['as-countdown'].hidden).toBe(true);
    expect(doc.els['as-title'].textContent).toBe('Automatic start stopped');
    ui.hide();
    ui.showCountdown(CAND, 10);
    expect(doc.els['as-countdown'].hidden).toBe(false);
    expect(doc.els['as-title'].textContent).toBe('Starting automatically');
  });

  it('wires the three buttons to the handlers it is bound to; Close after an error just hides', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    const onStartNow = vi.fn();
    const onChange = vi.fn();
    const onCancel = vi.fn();
    ui.bind({ onStartNow, onChange, onCancel });
    ui.showCountdown(CAND, 10);
    doc.els['as-start-now'].click();
    doc.els['as-change'].click();
    doc.els['as-cancel'].click();
    expect([onStartNow, onChange, onCancel].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);

    ui.showError('x');
    doc.els['as-cancel'].click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(doc.els['autostart-overlay'].hidden).toBe(true);
  });

  it('writes text only, never HTML', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    ui.showCountdown({ ...CAND, label: '<img src=x onerror=alert(1)>' }, 10);
    expect(doc.els['as-service'].textContent).toContain('<img');
    expect(doc.els['as-service'].innerHTML).toBeUndefined();
  });

  it('hide() hides the overlay and resets it for the next offer', () => {
    const doc = fakeDoc();
    const ui = createAutoStartOverlay(doc);
    ui.showError('x');
    ui.hide();
    expect(doc.els['autostart-overlay'].hidden).toBe(true);
    ui.showCountdown(CAND, 10);
    expect(doc.els['as-start-now'].hidden).toBe(false);
    expect(doc.els['as-change'].hidden).toBe(false);
    expect(doc.els['as-cancel'].textContent).toBe('Not now');
    expect(doc.els['as-start-now'].disabled).toBe(false);
  });
});
