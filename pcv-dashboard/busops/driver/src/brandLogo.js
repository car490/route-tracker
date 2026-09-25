// src/brandLogo.js
//
// The operator's logo in the brand slot at the top of the Driver's
// no-duty, duty-card and picker screens (.picker-brand / .ndc-brand),
// in place of the company name as text (owner, 2026-09-27).
//
// The logo is the one uploaded in the dashboard's Company Settings:
// companies.logo_path in the public 'operator-assets' bucket, the same
// source Announce's idle screen reads (announceDeviceFeed.js), so one
// upload updates both.
//
// Uploaded logos are usually a white rectangle with generous empty margins
// (Phil Haines Coaches' is 1536x1024 with the wording in the middle ~40%).
// The margins are trimmed here on the device so the logo fills its slot,
// and it always sits on a white plate (--logo-plate): a logo drawn for
// white, like this one's navy "COACHES", can't be read on the dark theme's
// background, and cutting the white away can't fix that.
//
// The prepared image is kept in localStorage so it shows at once on boot
// and offline. The live logo is fetched again on every online boot because
// a re-upload keeps the same path ({company_id}/logo.png). No logo, or one
// that fails to load, leaves the company name as text, as before.

const CACHE_KEY = 'busops.driver.brandLogo';
const BRAND_SELECTOR = '.picker-brand, .ndc-brand';
// Output width in device pixels: the slot is at most ~18rem (288 CSS px),
// so this stays sharp at 2x without storing a full-size upload.
const MAX_OUTPUT_WIDTH = 640;
// A pixel counts as background when it is close to white or mostly
// transparent. 240 leaves JPEG-ish noise in a "white" background out.
const WHITE_THRESHOLD = 240;
const ALPHA_THRESHOLD = 16;

// Pure: the bounding box of the non-background pixels in RGBA data, or
// null when the image is all background. Exported for tests.
export function contentBounds(data, width, height) {
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < ALPHA_THRESHOLD) continue;
      if (data[i] >= WHITE_THRESHOLD && data[i + 1] >= WHITE_THRESHOLD && data[i + 2] >= WHITE_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

// Pure: the content box grown by a small margin (4% of its height, so the
// logo doesn't touch the plate's edge), clamped to the image. Exported for
// tests.
export function paddedCrop(bounds, width, height) {
  const pad = Math.round(bounds.height * 0.04);
  const x = Math.max(0, bounds.x - pad);
  const y = Math.max(0, bounds.y - pad);
  return {
    x,
    y,
    width: Math.min(width, bounds.x + bounds.width + pad) - x,
    height: Math.min(height, bounds.y + bounds.height + pad) - y,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Supabase Storage's public objects send Access-Control-Allow-Origin: *;
    // without this the canvas is tainted and can't be read back.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`logo failed to load: ${url}`));
    img.src = url;
  });
}

// Loads the logo, trims its empty margins and returns it as a PNG data URL.
// Falls back to the original URL if the image can't be read back (e.g. a
// storage host without CORS), so the logo still shows, just untrimmed.
export async function prepareLogo(url, doc = document) {
  const img = await loadImage(url);
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const probe = doc.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0);
    const bounds = contentBounds(pctx.getImageData(0, 0, w, h).data, w, h);
    const crop = bounds ? paddedCrop(bounds, w, h) : { x: 0, y: 0, width: w, height: h };

    const scale = Math.min(1, MAX_OUTPUT_WIDTH / crop.width);
    const out = doc.createElement('canvas');
    out.width = Math.round(crop.width * scale);
    out.height = Math.round(crop.height * scale);
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } catch {
    return url;
  }
}

// Puts the logo (src) or, without one, the company name as text into every
// brand slot. alt carries the name for screen readers.
export function applyBrand({ name, logoSrc }, doc = document) {
  doc.querySelectorAll(BRAND_SELECTOR).forEach((el) => {
    if (logoSrc) {
      const plate = doc.createElement('span');
      plate.className = 'brand-plate';
      const img = doc.createElement('img');
      img.className = 'brand-logo';
      img.alt = name || 'Company logo';
      img.src = logoSrc;
      plate.appendChild(img);
      el.replaceChildren(plate);
      el.classList.add('has-logo');
    } else if (name) {
      el.replaceChildren(doc.createTextNode(name));
      el.classList.remove('has-logo');
    }
  });
}

export function getCachedBrand(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedBrand(brand, storage = globalThis.localStorage) {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(brand));
  } catch {
    // Storage full or blocked: the logo still shows this session.
  }
}

// Boot entry point. Shows the cached brand at once, then refreshes it from
// Supabase. Best-effort: never throws, never delays the functional screens.
export async function initBrandLogo({ fetchBranding, storage = globalThis.localStorage, doc = document }) {
  const cached = getCachedBrand(storage);
  if (cached) applyBrand(cached, doc);

  let branding;
  try {
    branding = await fetchBranding();
  } catch {
    return; // offline: the cached brand (or the index.html default) stands
  }
  if (!branding?.name && !branding?.logoUrl) return;

  let logoSrc = null;
  if (branding.logoUrl) {
    try {
      logoSrc = await prepareLogo(branding.logoUrl, doc);
    } catch {
      // Logo missing from storage or unreachable: keep a cached logo if there
      // is one rather than dropping back to text on a transient failure.
      logoSrc = cached?.logoSrc ?? null;
    }
  }
  const brand = { name: branding.name ?? null, logoSrc };
  applyBrand(brand, doc);
  setCachedBrand(brand, storage);
}
