// Tablet capture, part 3: the measurement that runs INSIDE the sign's page.
//
// probeSign is one self-contained async function (no imports, no closed-over variables), so its
// source can be sent to the tablet's page over DevTools as `(${probeSign})()` and, in the tests,
// handed to Playwright's page.evaluate unchanged. It is READ-ONLY: it reads computed styles and
// element boxes, and measures glyphs on a canvas that is created in memory and never attached to
// the page. It writes nothing, navigates nowhere, and records the page URL WITHOUT its query
// string (the query carries the device token).
//
// It returns raw CSS px and glyph ratios; converting to millimetres and judging them is
// tabletReport.mjs's job (pure, unit-tested).
//
// Glyphs are measured two independent ways at Line 2/3's own font and weight:
//   - canvas measureText, the sign's own method (onboard.js measureXHeightRatio), at 200 px;
//   - the drawn pixels: each lowercase letter is filled on an in-memory canvas at 600 px and the
//     ink above the baseline is scanned. That does not depend on measureText's metrics, and it
//     also finds the SHORTEST lowercase letter, which is what the strict reading of the rule needs.
export async function probeSign() {
  const byId = (id) => document.getElementById(id);
  const isVisible = (e) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const firstVisible = (selector) => [...document.querySelectorAll(selector)].find(isVisible) ?? null;

  // Same names and selectors as the replica harness's measure(), so the two reports read alike.
  const TARGETS = [
    ['Top bar: route code', '.route-code'],
    ['Top bar: destination', '.route-destination'],
    ['Line 1 (verb / wait box)', '.hl-verb, .ewb-title'],
    ['Wait box title', '.hl-verb--early .ewb-title'],
    ['Wait box message', '.hl-verb--early .ewb-msg'],
    ['Line 2 (town)', '.hl-town'],
    ['Line 3 (stop)', '.hl-stop'],
    ['Sentence headline', '#sign-headline:not(.hl-three-line)'],
    ['Brand wordmark', '.bo-wordmark'],
  ];
  const rows = [];
  for (const [name, selector] of TARGETS) {
    const e = firstVisible(selector);
    if (!e) continue;
    const style = getComputedStyle(e);
    rows.push({
      name,
      text: (e.textContent || '').trim().slice(0, 60),
      fontPx: parseFloat(style.fontSize),
      weight: style.fontWeight,
      family: style.fontFamily,
    });
  }

  const sign = byId('onboard-sign');
  const headline = byId('sign-headline');
  const signShown = Boolean(sign && !sign.hidden && isVisible(sign));

  const bar = firstVisible('#sign-topbar, #idle-topbar');
  const verb = firstVisible('#sign-headline .hl-verb');

  const town = rows.find((r) => r.name === 'Line 2 (town)');
  const glyphSource = town || rows.find((r) => r.name === 'Sentence headline') || null;
  const glyphFamily = (glyphSource ?? (headline ? { family: getComputedStyle(headline).fontFamily, weight: '700' } : null));
  const primaryFamily = glyphFamily ? glyphFamily.family.split(',')[0].trim().replace(/^["']|["']$/g, '') : '';

  // Is the web font really loaded? document.fonts.check() answers true for a family it has never
  // heard of, so look for a loaded FontFace of that family instead.
  let fontLoaded = false;
  try {
    for (const face of document.fonts) {
      if (face.status === 'loaded' && face.family.replace(/^["']|["']$/g, '') === primaryFamily) { fontLoaded = true; break; }
    }
  } catch (_) { fontLoaded = false; }

  // Glyph measurements only make sense once a three-line state is showing Line 2/3.
  let glyphs = null;
  if (signShown && town && glyphFamily) {
    const weight = String(town.weight);
    const family = glyphFamily.family;
    try { await document.fonts.load(`${weight} 600px ${family}`, 'x'); } catch (_) { /* measured with whatever is loaded */ }

    // 1) the sign's own method: measureText at 200 px
    const canvasCtx = document.createElement('canvas').getContext('2d');
    canvasCtx.font = `${weight} 200px ${family}`;
    const canvasRatio = canvasCtx.measureText('x').actualBoundingBoxAscent / 200;

    // 2) the drawn pixels: ink above the baseline of every lowercase letter
    const SIZE = 600;
    const BASELINE = 640;
    const c = document.createElement('canvas');
    c.width = 700;
    c.height = 820;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const inkAbove = (ch) => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.font = `${weight} ${SIZE}px ${family}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000';
      ctx.fillText(ch, 40, BASELINE);
      const { data } = ctx.getImageData(0, 0, c.width, BASELINE);
      for (let y = 0; y < BASELINE; y++) {
        for (let x = 0; x < c.width; x++) {
          if (data[(y * c.width + x) * 4 + 3] > 127) return (BASELINE - y) / SIZE;
        }
      }
      return 0;
    };
    const rasterRatio = inkAbove('x');
    let shortestLowerRatio = Infinity;
    let shortestLowerChar = '';
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      const ratio = inkAbove(ch);
      if (ratio > 0 && ratio < shortestLowerRatio) { shortestLowerRatio = ratio; shortestLowerChar = ch; }
    }
    glyphs = { weight, family: primaryFamily, canvasRatio, rasterRatio, shortestLowerRatio, shortestLowerChar };
  }

  return {
    // origin + path only: the query string can carry the device token and is never recorded
    url: location.origin + location.pathname,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
    fontLoaded,
    sign: {
      shown: signShown,
      dataState: sign && sign.dataset ? sign.dataset.state || null : null,
      threeLine: Boolean(headline && headline.classList.contains('hl-three-line')),
    },
    topbar: bar ? { heightPx: bar.getBoundingClientRect().height } : null,
    line1: verb ? { heightPx: verb.getBoundingClientRect().height } : null,
    tokens: {
      minText: getComputedStyle(document.documentElement).getPropertyValue('--min-text').trim(),
      headerText: getComputedStyle(document.documentElement).getPropertyValue('--header-text').trim(),
      sentenceText: getComputedStyle(document.documentElement).getPropertyValue('--sentence-text').trim(),
      logoText: getComputedStyle(document.documentElement).getPropertyValue('--logo-text').trim(),
    },
    rows,
    glyphs,
  };
}
