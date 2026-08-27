// src/announceLiteSetup.test.js
//
// BusOps Announce Lite — one-time device-token commissioning.
// Same injectable-storage pattern as announceLink.js's captureAnnounceSetup
// tests / vehicleSetup.test.js, so no DOM or real localStorage is needed.

import { describe, it, expect } from 'vitest';
import { captureAnnounceDeviceSetup, getAnnounceDeviceToken } from './announceLiteSetup.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

describe('captureAnnounceDeviceSetup', () => {
  it('persists the token from ?announce-device-token= to storage', () => {
    const storage = fakeStorage();
    captureAnnounceDeviceSetup(new URLSearchParams('?announce-device-token=abc123'), storage);
    expect(getAnnounceDeviceToken(storage)).toBe('abc123');
  });

  it('is a no-op when the URL has no announce-device-token param', () => {
    const storage = fakeStorage({ announceDeviceToken: 'already-there' });
    captureAnnounceDeviceSetup(new URLSearchParams(''), storage);
    expect(getAnnounceDeviceToken(storage)).toBe('already-there');
  });

  it('overwrites a previously stored token with a newer one from the URL', () => {
    const storage = fakeStorage({ announceDeviceToken: 'old-token' });
    captureAnnounceDeviceSetup(new URLSearchParams('?announce-device-token=new-token'), storage);
    expect(getAnnounceDeviceToken(storage)).toBe('new-token');
  });
});

describe('getAnnounceDeviceToken', () => {
  it('returns null when this device was never commissioned', () => {
    expect(getAnnounceDeviceToken(fakeStorage())).toBeNull();
  });
});
