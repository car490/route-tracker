// Tablet capture, part 4: never hang (tests in tabletCdp.test.mjs).
//
// Found live on 2026-09-19: the Android WebView answers every DevTools call the probe needs but
// never answers Page.captureScreenshot, and the first version of the tool waited for it forever.
// Every DevTools call now has a time limit, so the worst case is a clear error, not a hang.

export class DevToolsTimeout extends Error {
  constructor(label, ms) {
    super(`The WebView did not answer ${label} within ${ms} ms`);
    this.name = 'DevToolsTimeout';
  }
}

/** Resolves like `promise`, or rejects with DevToolsTimeout if it has not settled within `ms`. */
export function withTimeout(promise, ms, label) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    throw new RangeError(`the time limit must be a positive number of ms, got ${ms}`);
  }
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DevToolsTimeout(label, ms)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
