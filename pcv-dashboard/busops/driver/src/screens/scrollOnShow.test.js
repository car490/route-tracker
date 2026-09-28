import { describe, it, expect, vi } from 'vitest';
import { initScrollOnShow, SCREEN_IDS } from './scrollOnShow.js';

// Minimal stand-ins for the DOM pieces the slice touches.
function fakeScreen(id, { hidden = true } = {}) {
  return { id, hidden, scrollTop: 250 };
}

function fakeObserverClass() {
  const instances = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnect = vi.fn();
      instances.push(this);
    }
    observe(target, options) {
      this.observed.push({ target, options });
    }
    // Test helper: deliver hidden-attribute mutations the way the browser does.
    fire(records) {
      this.callback(records, this);
    }
  }
  return { FakeObserver, instances };
}

function fakeDocument(screens) {
  const listeners = {};
  return {
    visibilityState: 'visible',
    getElementById: (id) => screens.find((s) => s.id === id) ?? null,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: vi.fn(),
    emit: (type) => listeners[type]?.(),
  };
}

function setup({ visible = null } = {}) {
  const screens = SCREEN_IDS.map((id) => fakeScreen(id, { hidden: id !== visible }));
  const stopList = { id: 'stop-list', scrollTop: 400 };
  const doc = fakeDocument(screens);
  const win = { scrollTo: vi.fn() };
  const { FakeObserver, instances } = fakeObserverClass();
  const controller = initScrollOnShow({ doc, win, Observer: FakeObserver });
  const observer = instances[0];
  const screen = (id) => screens.find((s) => s.id === id);
  // A screen being shown: attribute removed (hidden = false), old value was ''.
  const show = (id) => {
    screen(id).hidden = false;
    observer.fire([{ type: 'attributes', attributeName: 'hidden', target: screen(id), oldValue: '' }]);
  };
  return { screens, screen, stopList, doc, win, observer, controller, show };
}

describe('SCREEN_IDS', () => {
  it('lists the six top-level Driver screens', () => {
    expect(SCREEN_IDS).toEqual(['duty-card', 'no-duty-card', 'vehicle-setup', 'manual-picker', 'picker', 'tracker']);
  });
});

describe('initScrollOnShow', () => {
  it('watches only the hidden attribute of every screen, remembering the old value', () => {
    const { observer, screens } = setup();
    expect(observer.observed.map((o) => o.target)).toEqual(screens);
    for (const { options } of observer.observed) {
      expect(options).toEqual({ attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
    }
  });

  it('scrolls the page and the screen itself to the top when a screen is shown', () => {
    const { show, win, screen } = setup();
    show('picker');
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(screen('picker').scrollTop).toBe(0);
  });

  it("resets the tracker's own scroll box, not the stop list inside it", () => {
    const { show, screen, stopList } = setup();
    show('tracker');
    expect(screen('tracker').scrollTop).toBe(0);
    expect(stopList.scrollTop).toBe(400);
  });

  it('does nothing when a screen is hidden', () => {
    const { screen, observer, win } = setup({ visible: 'picker' });
    screen('picker').hidden = true;
    observer.fire([{ type: 'attributes', attributeName: 'hidden', target: screen('picker'), oldValue: null }]);
    expect(win.scrollTo).not.toHaveBeenCalled();
    expect(screen('picker').scrollTop).toBe(250);
  });

  it('does not reset a screen that was already showing when its attribute is touched again', () => {
    const { screen, observer, win } = setup({ visible: 'tracker' });
    // hidden = false on an already-visible element: old value null, still visible.
    observer.fire([{ type: 'attributes', attributeName: 'hidden', target: screen('tracker'), oldValue: null }]);
    expect(win.scrollTo).not.toHaveBeenCalled();
    expect(screen('tracker').scrollTop).toBe(250);
  });

  it('scrolls the visible screen to the top when the driver comes back to the app', () => {
    const { doc, win, screen } = setup({ visible: 'tracker' });
    doc.visibilityState = 'visible';
    doc.emit('visibilitychange');
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(screen('tracker').scrollTop).toBe(0);
    expect(screen('picker').scrollTop).toBe(250);
  });

  it('does nothing when the app goes into the background', () => {
    const { doc, win, screen } = setup({ visible: 'tracker' });
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    expect(win.scrollTo).not.toHaveBeenCalled();
    expect(screen('tracker').scrollTop).toBe(250);
  });

  it('still resets the page on return when no screen is showing yet (boot)', () => {
    const { doc, win } = setup({ visible: null });
    doc.emit('visibilitychange');
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('skips screens missing from the page instead of throwing', () => {
    const doc = fakeDocument([fakeScreen('tracker')]);
    const { FakeObserver, instances } = fakeObserverClass();
    expect(() => initScrollOnShow({ doc, win: { scrollTo() {} }, Observer: FakeObserver })).not.toThrow();
    expect(instances[0].observed).toHaveLength(1);
  });

  it('can be stopped', () => {
    const { controller, observer, doc } = setup();
    controller.disconnect();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
