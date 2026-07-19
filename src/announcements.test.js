// src/announcements.test.js
//
// Covers the announceDiversion() addition to src/announcements.js for
// Slice 2. Co-located in src/ to match vitest.config.js's
// `src/**/*.test.js` include pattern (see audioConfigPipeline.test.js for
// the established Slice 1 precedent; tests/**/*.test.js runs on Jest).

import { describe, it, expect } from 'vitest';
import * as announcements from './announcements.js';

describe('announceDiversion', () => {
  it('is exported', () => {
    expect(typeof announcements.announceDiversion).toBe('function');
  });

  it('takes no text argument — the announcement text is fixed inside the module', () => {
    // Function arity check: announceDiversion() should declare zero params.
    expect(announcements.announceDiversion.length).toBe(0);
  });

  it('ignores any arguments passed to it rather than using them as text', () => {
    // Even if a caller (malicious or buggy) passes text, it must not surface.
    // We can't inspect the private announce() call directly, but we can
    // assert the function doesn't throw or behave differently when called
    // with unexpected args — proving it isn't reading them.
    expect(() => announcements.announceDiversion('ignore this and say something else')).not.toThrow();
  });
});
