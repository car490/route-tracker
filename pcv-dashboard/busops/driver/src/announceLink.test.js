// src/announceLink.test.js
//
// Driver -> Controller push client (see mele-server/announceRelay.mjs for the
// receiving side). Split into pure-helper tests (no globals touched) and
// live-connection tests (WebSocket/localStorage stubbed via vi.stubGlobal —
// vitest.config.js runs src/**/*.test.js under environment: 'node', which
// has no real `window`/`localStorage`).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildConnectionUrl, buildStatePayload, buildSchedulePayload, captureAnnounceSetup,
  connectAnnounceLink, disconnectAnnounceLink, broadcastState, broadcastSchedule, broadcastAnnounce,
} from './announceLink.js';

describe('buildConnectionUrl', () => {
  it('returns null when this device was never commissioned with a Controller target', () => {
    expect(buildConnectionUrl(null, 'tok')).toBeNull();
    expect(buildConnectionUrl('', 'tok')).toBeNull();
  });

  it('returns the base URL unchanged when there is no token', () => {
    expect(buildConnectionUrl('ws://192.168.4.1:8080/driver-push', null)).toBe('ws://192.168.4.1:8080/driver-push');
  });

  it('appends the token as a query param', () => {
    const url = buildConnectionUrl('ws://192.168.4.1:8080/driver-push', 'secret123');
    expect(url).toBe('ws://192.168.4.1:8080/driver-push?token=secret123');
  });
});

describe('buildStatePayload', () => {
  const baseState = {
    journeyId: 'jrn-1',
    stateKey: 'approaching',
    vars: { stopName: 'High Street', isFinal: false },
    earlyWait: null,
    lat: 51.5, lon: -0.1, // must never leak into the payload — see file header of announceLink.js
  };

  it('never includes raw GPS, only derived state', () => {
    const payload = buildStatePayload(baseState);
    expect(payload).not.toHaveProperty('lat');
    expect(payload).not.toHaveProperty('lon');
  });

  it('carries the resolved stateKey/vars and journeyId', () => {
    const payload = buildStatePayload(baseState);
    expect(payload.type).toBe('state');
    expect(payload.journeyId).toBe('jrn-1');
    expect(payload.stateKey).toBe('approaching');
    expect(payload.vars).toEqual({ stopName: 'High Street', isFinal: false });
    expect(typeof payload.ts).toBe('number');
  });

  it('defaults earlyWait to null when omitted', () => {
    const payload = buildStatePayload({ journeyId: 'jrn-1', stateKey: 'idle', vars: {} });
    expect(payload.earlyWait).toBeNull();
  });

  it('carries earlyWait when provided', () => {
    const payload = buildStatePayload({ ...baseState, earlyWait: { stopIndex: 2 } });
    expect(payload.earlyWait).toEqual({ stopIndex: 2 });
  });
});

describe('buildSchedulePayload', () => {
  const baseArgs = {
    journeyId: 'jrn-1',
    serviceCode: 'S125S',
    destination: 'Boston College',
    allStops: [
      { name: 'Weston', lat: 52.8, lon: -0.08, time: '08:00', stop_type: 'timing_point', timetable_stop_id: 'ts-1', stop_id: 's-1' },
      { name: 'Boston College', lat: 52.97, lon: -0.02, time: '08:40', stop_type: 'timing_point', timetable_stop_id: 'ts-2', stop_id: 's-2' },
    ],
  };

  it('forwards allStops verbatim as stops, not a hand-picked subset', () => {
    const payload = buildSchedulePayload(baseArgs);
    expect(payload.type).toBe('schedule');
    expect(payload.stops).toEqual(baseArgs.allStops);
    expect(typeof payload.ts).toBe('number');
  });

  it('carries serviceCode/destination/journeyId through unchanged', () => {
    const payload = buildSchedulePayload(baseArgs);
    expect(payload.journeyId).toBe('jrn-1');
    expect(payload.serviceCode).toBe('S125S');
    expect(payload.destination).toBe('Boston College');
  });

  it('defaults accentColor/primaryColor to null rather than omitting them', () => {
    const payload = buildSchedulePayload(baseArgs);
    expect(payload.accentColor).toBeNull();
    expect(payload.primaryColor).toBeNull();
  });

  it('carries accentColor/primaryColor when provided', () => {
    const payload = buildSchedulePayload({ ...baseArgs, accentColor: '#123456', primaryColor: '#abcdef' });
    expect(payload.accentColor).toBe('#123456');
    expect(payload.primaryColor).toBe('#abcdef');
  });
});

describe('captureAnnounceSetup', () => {
  it('saves both url and token to storage when present', () => {
    const storage = { setItem: vi.fn() };
    const params = new URLSearchParams('announce-setup=ws%3A%2F%2F192.168.4.1%3A8080%2Fdriver-push&announce-token=secret');
    captureAnnounceSetup(params, storage);
    expect(storage.setItem).toHaveBeenCalledWith('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
    expect(storage.setItem).toHaveBeenCalledWith('announceLinkToken', 'secret');
  });

  it('does nothing when the commissioning params are absent', () => {
    const storage = { setItem: vi.fn() };
    captureAnnounceSetup(new URLSearchParams(''), storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('live connection (stubbed WebSocket/localStorage)', () => {
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      this.listeners = {};
      this.sent = [];
      MockWebSocket.instances.push(this);
    }
    addEventListener(type, cb) { (this.listeners[type] ??= []).push(cb); }
    send(data) { this.sent.push(data); }
    close() {
      this.readyState = MockWebSocket.CLOSED;
      (this.listeners.close ?? []).forEach((cb) => cb());
    }
    open() {
      this.readyState = MockWebSocket.OPEN;
      (this.listeners.open ?? []).forEach((cb) => cb());
    }
  }
  MockWebSocket.CONNECTING = 0;
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSED = 3;
  MockWebSocket.instances = [];

  let store;
  beforeEach(() => {
    store = new Map();
    MockWebSocket.instances = [];
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    });
    vi.stubGlobal('WebSocket', MockWebSocket);
  });
  afterEach(() => {
    disconnectAnnounceLink();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a no-op when this device was never commissioned', () => {
    connectAnnounceLink();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(() => broadcastState({ journeyId: 'j1' })).not.toThrow();
  });

  it('connects to the commissioned URL and sends state once open', () => {
    store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
    store.set('announceLinkToken', 'tok');
    connectAnnounceLink();

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('ws://192.168.4.1:8080/driver-push?token=tok');

    broadcastState({ journeyId: 'j1', stateKey: 'idle', vars: {} }); // not open yet
    expect(ws.sent).toHaveLength(0);

    ws.open();
    broadcastState({ journeyId: 'j1', stateKey: 'idle', vars: {} });
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]).journeyId).toBe('j1');
  });

  it('reconnects after the socket closes', () => {
    vi.useFakeTimers();
    store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
    connectAnnounceLink();
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].close();
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('disconnectAnnounceLink cancels any pending reconnect', () => {
    vi.useFakeTimers();
    store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
    connectAnnounceLink();
    MockWebSocket.instances[0].close(); // schedules a reconnect
    disconnectAnnounceLink();

    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(1); // no reconnect attempted
  });

  describe('broadcastSchedule', () => {
    const schedule = { journeyId: 'j1', serviceCode: 'S125S', destination: 'Boston College', allStops: [{ name: 'A' }] };

    it('is a no-op (does not throw) when never called before a socket opens', () => {
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      const ws = MockWebSocket.instances[0];
      expect(() => ws.open()).not.toThrow();
      expect(ws.sent).toHaveLength(0);
    });

    it('sends immediately when the socket is already open', () => {
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      const ws = MockWebSocket.instances[0];
      ws.open();

      broadcastSchedule(schedule);
      expect(ws.sent).toHaveLength(1);
      const sent = JSON.parse(ws.sent[0]);
      expect(sent.type).toBe('schedule');
      expect(sent.journeyId).toBe('j1');
    });

    it('is held and sent once the socket opens, when called before open', () => {
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      const ws = MockWebSocket.instances[0];

      broadcastSchedule(schedule); // socket not open yet
      expect(ws.sent).toHaveLength(0);

      ws.open(); // fires the 'open' listener, which resends the remembered schedule
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0]).journeyId).toBe('j1');
    });

    it('is resent automatically on reconnect, without calling broadcastSchedule again', () => {
      vi.useFakeTimers();
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      const first = MockWebSocket.instances[0];
      first.open();
      broadcastSchedule(schedule);
      expect(first.sent).toHaveLength(1);

      first.close(); // simulates a Controller reboot mid-shift
      vi.advanceTimersByTime(3000);
      expect(MockWebSocket.instances).toHaveLength(2);
      const second = MockWebSocket.instances[1];
      expect(second.sent).toHaveLength(0);

      second.open();
      expect(second.sent).toHaveLength(1);
      expect(JSON.parse(second.sent[0]).journeyId).toBe('j1');
    });

    it('is cleared by disconnectAnnounceLink — a fresh journey does not leak a prior one', () => {
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      MockWebSocket.instances[0].open();
      broadcastSchedule(schedule);
      disconnectAnnounceLink();

      connectAnnounceLink();
      const ws = MockWebSocket.instances[1];
      ws.open();
      expect(ws.sent).toHaveLength(0); // no stale schedule resent
    });
  });

  describe('broadcastAnnounce', () => {
    it('is a no-op (does not throw) when this device was never commissioned', () => {
      connectAnnounceLink();
      expect(() => broadcastAnnounce('This is High Street.', ['arrive/abc123'])).not.toThrow();
    });

    it('sends {type:"announce"} with text and audioKeys when the socket is open', () => {
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      const ws = MockWebSocket.instances[0];
      ws.open();

      broadcastAnnounce('This is High Street.', ['arrive/abc123']);
      expect(ws.sent).toHaveLength(1);
      const sent = JSON.parse(ws.sent[0]);
      expect(sent.type).toBe('announce');
      expect(sent.text).toBe('This is High Street.');
      expect(sent.audioKeys).toEqual(['arrive/abc123']);
    });

    it('defaults audioKeys to an empty array rather than sending null', () => {
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      const ws = MockWebSocket.instances[0];
      ws.open();

      broadcastAnnounce('This is the final stop.', null);
      expect(JSON.parse(ws.sent[0]).audioKeys).toEqual([]);
    });

    it('is silently dropped (not queued) when called before the socket opens', () => {
      store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
      connectAnnounceLink();
      const ws = MockWebSocket.instances[0];

      broadcastAnnounce('This is High Street.', ['arrive/abc123']); // socket not open yet
      ws.open();
      expect(ws.sent).toHaveLength(0); // unlike broadcastSchedule, never resent — see the function's own comment
    });
  });
});
