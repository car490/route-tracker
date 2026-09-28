// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { contentBounds, paddedCrop, applyBrand, getCachedBrand, initBrandLogo } from './brandLogo.js';

// RGBA pixels for a w x h image: background everywhere except the listed
// [x, y] points, which are dark green.
function image(w, h, marks = [], { background = [255, 255, 255, 255] } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(background, i * 4);
  for (const [x, y] of marks) data.set([80, 160, 60, 255], (y * w + x) * 4);
  return data;
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function brandSlots() {
  document.body.innerHTML = `
    <div class="picker-brand">BusOps Driver</div>
    <div class="ndc-brand">BusOps Driver</div>`;
  return [...document.querySelectorAll('.picker-brand, .ndc-brand')];
}

describe('contentBounds', () => {
  it('finds the box around the logo inside a white margin', () => {
    const data = image(10, 8, [[2, 3], [7, 3], [4, 5]]);
    expect(contentBounds(data, 10, 8)).toEqual({ x: 2, y: 3, width: 6, height: 3 });
  });

  it('treats near-white (JPEG-style noise) as background', () => {
    const data = image(4, 4, [], { background: [248, 250, 245, 255] });
    data.set([30, 50, 90, 255], (1 * 4 + 2) * 4);
    expect(contentBounds(data, 4, 4)).toEqual({ x: 2, y: 1, width: 1, height: 1 });
  });

  it('treats transparent pixels as background, whatever their colour', () => {
    const data = image(4, 4, [[1, 1]], { background: [0, 0, 0, 0] });
    expect(contentBounds(data, 4, 4)).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  it('returns null for an all-white image', () => {
    expect(contentBounds(image(5, 5), 5, 5)).toBeNull();
  });
});

describe('paddedCrop', () => {
  it('adds a margin of 4% of the content height', () => {
    expect(paddedCrop({ x: 100, y: 300, width: 1300, height: 400 }, 1536, 1024))
      .toEqual({ x: 84, y: 284, width: 1332, height: 432 });
  });

  it('never extends past the image edges', () => {
    expect(paddedCrop({ x: 0, y: 0, width: 100, height: 100 }, 102, 101))
      .toEqual({ x: 0, y: 0, width: 102, height: 101 });
  });
});

describe('applyBrand', () => {
  it('puts the logo on a plate in every brand slot, named for screen readers', () => {
    const slots = brandSlots();
    applyBrand({ name: 'Acme Coaches', logoSrc: 'data:image/png;base64,AAAA' });
    for (const el of slots) {
      expect(el.classList.contains('has-logo')).toBe(true);
      const img = el.querySelector('.brand-plate > img.brand-logo');
      expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
      expect(img.alt).toBe('Acme Coaches');
      expect(el.textContent).toBe('');
    }
  });

  it('shows the company name as text when there is no logo', () => {
    const slots = brandSlots();
    applyBrand({ name: 'Acme Coaches', logoSrc: null });
    for (const el of slots) {
      expect(el.textContent).toBe('Acme Coaches');
      expect(el.classList.contains('has-logo')).toBe(false);
    }
  });

  it('leaves the default in place with neither name nor logo', () => {
    const slots = brandSlots();
    applyBrand({ name: null, logoSrc: null });
    for (const el of slots) expect(el.textContent).toBe('BusOps Driver');
  });
});

describe('initBrandLogo', () => {
  it('shows the cached brand straight away and keeps it when offline', async () => {
    const slots = brandSlots();
    const storage = memoryStorage();
    storage.setItem('busops.driver.brandLogo', JSON.stringify({ name: 'Acme Coaches', logoSrc: 'data:image/png;base64,CACHED' }));
    await initBrandLogo({ fetchBranding: vi.fn().mockRejectedValue(new Error('offline')), storage });
    expect(slots[0].querySelector('img').getAttribute('src')).toBe('data:image/png;base64,CACHED');
  });

  it('with no logo set, shows and caches the name', async () => {
    const slots = brandSlots();
    const storage = memoryStorage();
    await initBrandLogo({ fetchBranding: async () => ({ name: 'Acme Coaches', logoUrl: null }), storage });
    expect(slots[1].textContent).toBe('Acme Coaches');
    expect(getCachedBrand(storage)).toEqual({ name: 'Acme Coaches', logoSrc: null });
  });

  it('keeps a cached logo when the live logo fails to load', async () => {
    const slots = brandSlots();
    const storage = memoryStorage();
    storage.setItem('busops.driver.brandLogo', JSON.stringify({ name: 'Acme Coaches', logoSrc: 'data:image/png;base64,CACHED' }));
    const OrigImage = globalThis.Image;
    globalThis.Image = class { set src(_) { queueMicrotask(() => this.onerror()); } };
    try {
      await initBrandLogo({ fetchBranding: async () => ({ name: 'Acme Coaches', logoUrl: 'https://x/logo.png' }), storage });
    } finally {
      globalThis.Image = OrigImage;
    }
    expect(slots[0].querySelector('img').getAttribute('src')).toBe('data:image/png;base64,CACHED');
  });
});
