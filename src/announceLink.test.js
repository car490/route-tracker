// src/announceLink.test.js
//
// Driver -> Pi push client (see pi-server/announceRelay.mjs for the
// receiving side). Split into pure-helper tests (no globals touched) and
// live-connection tests (WebSocket/localStorage stubbed via vi.stubGlobal —
// vitest.config.js runs src/**/*.test.js under environment: 'node', which
// has no real `window`/`localStorage`).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildConnectionUrl, buildStatePayload, captureAnnounceSetup,
  connectAnnounceLink, disconnectAnnounceLink, broadcastState, setAnnouncing,
} from './announceLink.js';

describe('buildConnectionUrl', () => {
  it('returns null when this device was never commissioned with a Pi target', () => {
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
    journeyId: 'jrn-1', nextStopIndex: 2, nextStopName: 'High Street',
    atStop: null, approaching: { stopIndex: 2 }, earlyWait: null,
    timing: { status: 'on-time' }, diversionActive: false, isFinal: false,
    stopStates: [
      { status: 'departed', arrivedAt: null, departedAt: null },
      { status: 'skipped_signal', arrivedAt: null, departedAt: null },
      { status: 'approaching', arrivedAt: null, departedAt: null },
    ],
    lat: 51.5, lon: -0.1, // must never leak into the payload — see file header of announceLink.js
  };

  it('never includes raw GPS, only derived state', () => {
    const payload = buildStatePayload(baseState);
    expect(payload).not.toHaveProperty('lat');
    expect(payload).not.toHaveProperty('lon');
  });

  it('carries the expected fields and defaults announcing to null', () => {
    const payload = buildStatePayload(baseState);
    expect(payload.type).toBe('state');
    expect(payload.journeyId).toBe('jrn-1');
    expect(payload.nextStopName).toBe('High Street');
    expect(payload.announcing).toBeNull();
    expect(typeof payload.ts).toBe('number');
  });

  it('carries the full stopStates array — gps.js\'s single source of truth for per-stop status, not a hand-picked subset', () => {
    const payload = buildStatePayload(baseState);
    expect(payload.stopStates).toEqual(baseState.stopStates);
    expect(payload.stopStates.map((s) => s.status)).toEqual(['departed', 'skipped_signal', 'approaching']);
  });

  it('carries the announcing field when provided', () => {
    const payload = buildStatePayload(baseState, { announcing: 'High Street' });
    expect(payload.announcing).toBe('High Street');
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

    broadcastState({ journeyId: 'j1', nextStopIndex: 0 }); // not open yet
    expect(ws.sent).toHaveLength(0);

    ws.open();
    broadcastState({ journeyId: 'j1', nextStopIndex: 0 });
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]).journeyId).toBe('j1');
  });

  it('includes whatever setAnnouncing() last set', () => {
    store.set('announceLinkUrl', 'ws://192.168.4.1:8080/driver-push');
    connectAnnounceLink();
    const ws = MockWebSocket.instances[0];
    ws.open();

    setAnnouncing('High Street');
    broadcastState({ journeyId: 'j1' });
    expect(JSON.parse(ws.sent[0]).announcing).toBe('High Street');

    setAnnouncing(null);
    broadcastState({ journeyId: 'j1' });
    expect(JSON.parse(ws.sent[1]).announcing).toBeNull();
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
});
