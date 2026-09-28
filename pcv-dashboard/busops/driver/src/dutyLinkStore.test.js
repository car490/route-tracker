// src/dutyLinkStore.test.js
//
// The duty-card link (bearer token + journey ids) must survive a power cut
// that restarts the tablet, but must not outlive the shift it was issued
// for: kept until the token's own expiry, the end of the UK day, or the
// last duty on the card completing, whichever comes first (owner,
// 2026-09-28). Pure logic with injectable storage/clock, same convention
// as localStore.test.js.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDutyLink, loadDutyLink, clearDutyLink, isShiftComplete, tokenExpiry,
  migrateLegacyDutyLink, DUTY_LINK_KEY,
} from './dutyLinkStore.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}

// A structurally real JWT (header.payload.signature) — the signature is
// never checked client-side, only the exp claim is read.
function jwtWithExp(expSeconds) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'anon', exp: expSeconds })}.sig`;
}

// 07:00 BST on 28 Sep 2026.
const MORNING = new Date('2026-09-28T06:00:00Z');
const in24h = (d) => Math.floor(d.getTime() / 1000) + 86400;

let storage;
beforeEach(() => { storage = memoryStorage(); });

describe('saveDutyLink / loadDutyLink', () => {
  it('survives a restart (a fresh load with nothing in the URL)', () => {
    const token = jwtWithExp(in24h(MORNING));
    saveDutyLink({ token, duties: 'j1,j2' }, { storage, now: MORNING });

    const later = new Date('2026-09-28T09:30:00Z');
    expect(loadDutyLink({ storage, now: later })).toEqual({ token, duties: 'j1,j2' });
  });

  it('keeps an earlier value when a later capture only carries one of the two', () => {
    const token = jwtWithExp(in24h(MORNING));
    saveDutyLink({ token, duties: 'j1' }, { storage, now: MORNING });
    saveDutyLink({ token: null, duties: 'j1,j2' }, { storage, now: MORNING });
    expect(loadDutyLink({ storage, now: MORNING })).toEqual({ token, duties: 'j1,j2' });
  });

  it('never carries yesterday\'s token into a capture that only brings duties', () => {
    const yesterday = new Date('2026-09-27T08:00:00Z');
    saveDutyLink({ token: jwtWithExp(in24h(yesterday)), duties: 'old' }, { storage, now: yesterday });
    saveDutyLink({ token: null, duties: 'j9' }, { storage, now: MORNING });
    expect(loadDutyLink({ storage, now: MORNING })).toEqual({ token: null, duties: 'j9' });
  });

  it('discards the link once the token has expired', () => {
    const exp = Math.floor(MORNING.getTime() / 1000) + 3600;
    saveDutyLink({ token: jwtWithExp(exp), duties: 'j1' }, { storage, now: MORNING });

    const afterExpiry = new Date(MORNING.getTime() + 3601 * 1000);
    expect(loadDutyLink({ storage, now: afterExpiry })).toBeNull();
    expect(storage.getItem(DUTY_LINK_KEY)).toBeNull();
  });

  it('discards a link saved on an earlier UK day even if the token has not expired', () => {
    // 23:30 BST on the 27th — the token is still valid the next morning.
    const lateEvening = new Date('2026-09-27T22:30:00Z');
    saveDutyLink({ token: jwtWithExp(in24h(lateEvening)), duties: 'j1' }, { storage, now: lateEvening });

    expect(loadDutyLink({ storage, now: MORNING })).toBeNull();
    expect(storage.getItem(DUTY_LINK_KEY)).toBeNull();
  });

  it('uses the UK date, not UTC: 00:30 BST is already the next day', () => {
    const before = new Date('2026-09-27T22:00:00Z'); // 23:00 BST, 27th
    saveDutyLink({ token: jwtWithExp(in24h(before)), duties: 'j1' }, { storage, now: before });
    const after = new Date('2026-09-27T23:30:00Z');  // 00:30 BST, 28th (still the 27th in UTC)
    expect(loadDutyLink({ storage, now: after })).toBeNull();
  });

  it('keeps a token with no readable expiry only until the end of the day', () => {
    saveDutyLink({ token: 'not-a-jwt', duties: 'j1' }, { storage, now: MORNING });
    expect(loadDutyLink({ storage, now: new Date('2026-09-28T20:00:00Z') })).toEqual({ token: 'not-a-jwt', duties: 'j1' });
    expect(loadDutyLink({ storage, now: new Date('2026-09-29T06:00:00Z') })).toBeNull();
  });

  it('treats corrupt stored data as no link, and removes it', () => {
    storage.setItem(DUTY_LINK_KEY, '{not json');
    expect(loadDutyLink({ storage, now: MORNING })).toBeNull();
    expect(storage.getItem(DUTY_LINK_KEY)).toBeNull();
  });

  it('returns null when nothing was ever saved', () => {
    expect(loadDutyLink({ storage, now: MORNING })).toBeNull();
  });

  it('never throws when storage itself throws (private mode, quota)', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(() => saveDutyLink({ token: 't', duties: 'j1' }, { storage: broken, now: MORNING })).not.toThrow();
    expect(loadDutyLink({ storage: broken, now: MORNING })).toBeNull();
    expect(() => clearDutyLink({ storage: broken })).not.toThrow();
  });
});

describe('clearDutyLink', () => {
  it('removes the stored link', () => {
    saveDutyLink({ token: jwtWithExp(in24h(MORNING)), duties: 'j1' }, { storage, now: MORNING });
    clearDutyLink({ storage });
    expect(loadDutyLink({ storage, now: MORNING })).toBeNull();
  });
});

describe('isShiftComplete', () => {
  it('is true only when every duty on the card is completed', () => {
    expect(isShiftComplete([{ status: 'completed' }, { status: 'completed' }])).toBe(true);
    expect(isShiftComplete([{ status: 'completed' }, { status: 'in_progress' }])).toBe(false);
    expect(isShiftComplete([{ status: 'scheduled' }])).toBe(false);
  });

  it('is false for an empty or missing card (nothing to say the shift is over)', () => {
    expect(isShiftComplete([])).toBe(false);
    expect(isShiftComplete(null)).toBe(false);
  });
});

describe('tokenExpiry', () => {
  it('reads the exp claim of a JWT', () => {
    expect(tokenExpiry(jwtWithExp(1790000000))).toEqual(new Date(1790000000 * 1000));
  });

  it('returns null for anything that is not a readable JWT', () => {
    expect(tokenExpiry(null)).toBeNull();
    expect(tokenExpiry('abc')).toBeNull();
    expect(tokenExpiry('a.%%%.c')).toBeNull();
    expect(tokenExpiry(jwtWithExp('soon'))).toBeNull();
  });
});

describe('migrateLegacyDutyLink', () => {
  // A tablet mid-shift when this ships still holds its link in the old
  // per-tab sessionStorage keys; carry it over once so the first reload
  // after the update doesn't drop the duty card.
  it('moves the old sessionStorage link into the new store and removes the old keys', () => {
    const session = memoryStorage();
    const token = jwtWithExp(in24h(MORNING));
    session.setItem('dutyLinkToken', token);
    session.setItem('dutyLinkIds', 'j1,j2');

    migrateLegacyDutyLink({ session, storage, now: MORNING });

    expect(loadDutyLink({ storage, now: MORNING })).toEqual({ token, duties: 'j1,j2' });
    expect(session.getItem('dutyLinkToken')).toBeNull();
    expect(session.getItem('dutyLinkIds')).toBeNull();
  });

  it('does nothing when there is no old link', () => {
    migrateLegacyDutyLink({ session: memoryStorage(), storage, now: MORNING });
    expect(loadDutyLink({ storage, now: MORNING })).toBeNull();
  });
});
