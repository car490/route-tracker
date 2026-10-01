// announce/src/idleScreen.test.js
//
// The idle screen is drawn on top of the sign (onboard.html), so showing it
// while the sign is showing covers the sign. Found live on a Solo,
// 2026-10-01: "This stop is …" covered mid-trip, and the terminus message
// covered seconds after the last stop. Written before idleScreen.js (TDD).

import { describe, it, expect } from 'vitest';
import { showIdleUnlessSignShowing } from './idleScreen.js';

const screens = ({ signShowing }) => ({
  idle: { hidden: true },
  sign: { hidden: !signShowing },
  brand: { hidden: true },
});

describe('showIdleUnlessSignShowing', () => {
  it('shows the idle screen and the brand mark when the sign is not showing', () => {
    const s = screens({ signShowing: false });
    expect(showIdleUnlessSignShowing(s)).toBe(true);
    expect(s.idle.hidden).toBe(false);
    expect(s.brand.hidden).toBe(false);
  });

  it('leaves the idle screen hidden while the sign is showing', () => {
    const s = screens({ signShowing: true });
    expect(showIdleUnlessSignShowing(s)).toBe(false);
    expect(s.idle.hidden).toBe(true);
    expect(s.sign.hidden).toBe(false);
  });
});
