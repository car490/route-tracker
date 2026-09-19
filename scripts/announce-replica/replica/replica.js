// True-size replica of the BusOps Announce sign (slice 2).
//
// The REAL, unmodified sign (announce/onboard.html) runs inside a 1442x901 CSS
// px iframe, so its vh units, --min-text calibration and layout behave exactly
// as on the tablet. The iframe is then scaled so those 1442 CSS px span the
// tablet's measured 289 mm on THIS screen. The sign is driven by calling the
// same exported onSchedule/onState/onJourneyEnd its own feeds call, with mock
// messages: no Supabase, no WebSocket, no tokens, nothing written anywhere.

import { pxPerMm, replicaFrame, minTextVh, mmToPx, pxToMm } from '/__lib/signSizing.mjs';
import {
  SCENARIOS, buildScenarioMessages, rulerTicks, verdictForLowercase, layoutFlags,
} from '/__lib/replicaLogic.mjs';
import { candidateLayout } from '/__lib/candidates.mjs';

// deployed = the sign exactly as shipped; x22 = diagnostic (only --min-text changed);
// compact / proposed / large = candidate layouts (harness-only CSS overrides).
const MODES = ['deployed', 'x22', 'compact', 'proposed', 'large'];
const MODE_LABEL = {
  deployed: 'as deployed (nominal 14")',
  x22: 'DIAGNOSTIC 22 mm only (--min-text alone; top bar not fixed)',
  compact: 'CANDIDATE compact (Lines 2/3 = 22 mm x-height; rest smallest)',
  proposed: 'CANDIDATE proposed (Lines 2/3 = 22 mm x-height; rest medium)',
  large: 'CANDIDATE large (Lines 2/3 = 22 mm x-height; rest largest)',
};
const CANDIDATE_TOKENS = ['--min-text', '--header-text', '--logo-text', '--topbar-height'];

const CONFIG = await (await fetch('/__replica/panels.json', { cache: 'no-store' })).json();
const params = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);
const iframe = $('sign');
const wrap = $('wrap');

const panelDensity = pxPerMm({
  litWidthMm: CONFIG.panel.litWidthMm, litHeightMm: CONFIG.panel.litHeightMm,
  widthPx: CONFIG.panel.cssWidthPx, heightPx: CONFIG.panel.cssHeightPx,
});

// k corrects the laptop's assumed density from a ruler reading of the 100 mm bar:
// bar measures R mm  ->  k = 100 / R. Also nudged live with [ and ].
const state = {
  scenario: 0,
  sizing: MODES.includes(params.get('sizing')) ? params.get('sizing') : 'deployed',
  anchor: ['top', 'bottom', 'center'].includes(params.get('anchor')) ? params.get('anchor') : 'top',
  k: params.get('measured100') ? 100 / Number(params.get('measured100')) : Number(params.get('k') ?? 1),
  hud: params.get('hud') === '1',
  calib: false,
  help: false,
};
if (!Number.isFinite(state.k) || state.k <= 0.5 || state.k > 2) state.k = 1;

let originalMinText = '';
// The sign's OWN inline values for the tokens a candidate overrides (slice B: the sign now
// sets --header-text itself). Leaving a candidate must restore these, not delete them.
const originalTokens = {};
let frame = null;

// ── geometry ────────────────────────────────────────────────────────────────
function computeFrame() {
  const dpr = window.devicePixelRatio;
  return replicaFrame({
    panel: CONFIG.panel,
    screen: {
      litWidthMm: CONFIG.screen.litWidthMm / state.k,
      litHeightMm: CONFIG.screen.litHeightMm,
      resWidthPx: CONFIG.screen.resWidthPx,
      resHeightPx: CONFIG.screen.resHeightPx,
      osScale: dpr,
    },
  });
}

function layout() {
  frame = computeFrame();
  const s = frame.cssScale;
  const w = CONFIG.panel.cssWidthPx * s;
  const h = CONFIG.panel.cssHeightPx * s;
  iframe.style.width = `${CONFIG.panel.cssWidthPx}px`;
  iframe.style.height = `${CONFIG.panel.cssHeightPx}px`;
  iframe.style.transform = `scale(${s})`;
  wrap.style.width = `${w}px`;
  wrap.style.height = `${h}px`;
  wrap.style.left = `${Math.max(0, (window.innerWidth - w) / 2)}px`;
  wrap.style.top = state.anchor === 'top' ? '0px'
    : state.anchor === 'bottom' ? `${window.innerHeight - h}px`
    : `${(window.innerHeight - h) / 2}px`;
  if (state.calib) renderCalibration();
  renderHud();
}

// ── driving the real sign ───────────────────────────────────────────────────
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const win = () => iframe.contentWindow;
const doc = () => iframe.contentDocument;

function loadSign() {
  return new Promise((resolve) => {
    iframe.addEventListener('load', async () => {
      const d = doc();
      const s = d.createElement('script');
      s.type = 'module';
      // Same URL the page itself loaded => the browser hands back the SAME module
      // instance (no second init()); we only grab its exports.
      s.textContent = "import * as api from '/announce/src/onboard.js'; window.__signApi = api;";
      d.head.appendChild(s);
      for (let i = 0; i < 100 && !win().__signApi; i++) await new Promise((r) => setTimeout(r, 50));
      if (d.fonts?.ready) await d.fonts.ready.catch(() => {});
      originalMinText = d.documentElement.style.getPropertyValue('--min-text');
      for (const k of CANDIDATE_TOKENS) originalTokens[k] = d.documentElement.style.getPropertyValue(k);
      resolve();
    }, { once: true });
    iframe.src = '/announce/onboard.html?panel-profile=lite';
  });
}

async function applyScenario(i) {
  state.scenario = ((i % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length;
  const api = win().__signApi;
  const m = buildScenarioMessages(SCENARIOS[state.scenario], Date.now());
  if (m.journeyEnd) api.onJourneyEnd();
  else { api.onSchedule(m.schedule); api.onState(m.state); }
  applySizing();
  await nextFrame();
  win().dispatchEvent(new Event('resize')); // re-run the sign's own marquee/brand layout
  await nextFrame();
  renderHud();
}

function fontRatio(d, family, weight) {
  const c = d.createElement('canvas').getContext('2d');
  c.font = `${weight} 200px ${family}`;
  return c.measureText('x').actualBoundingBoxAscent / 200;
}

function fontAvailable(d, family, weight) {
  const c = d.createElement('canvas').getContext('2d');
  const probe = 'mmmmmmmmmmlli';
  const width = (f) => { c.font = `${weight} 72px ${f}`; return c.measureText(probe).width; };
  return width(`${family}, monospace`) !== width('monospace') || width(`${family}, serif`) !== width('serif');
}

function clearCandidate() {
  const d = doc();
  d.getElementById('replica-candidate')?.remove();
  for (const k of CANDIDATE_TOKENS.slice(1)) {
    if (originalTokens[k]) d.documentElement.style.setProperty(k, originalTokens[k]);
    else d.documentElement.style.removeProperty(k);
  }
}

function applySizing() {
  const root = doc().documentElement;
  const d = doc();
  if (['compact', 'proposed', 'large'].includes(state.sizing)) {
    const family = getComputedStyle(d.body).fontFamily;
    const ratio = fontRatio(d, family, 700);
    const c = candidateLayout({
      tier: state.sizing, litHeightMm: CONFIG.panel.litHeightMm, xHeightRatio: ratio, targetMm: CONFIG.rule.lowercaseMm,
    });
    for (const [k, v] of Object.entries(c.tokens)) root.style.setProperty(k, v);
    let style = d.getElementById('replica-candidate');
    if (!style) { style = d.createElement('style'); style.id = 'replica-candidate'; d.head.appendChild(style); }
    style.textContent = c.css; // static text from candidates.mjs; no user input reaches it
    return;
  }
  clearCandidate();
  if (state.sizing === 'x22') {
    const family = getComputedStyle(doc().body).fontFamily;
    const ratio = fontRatio(doc(), family, 700);
    const vh = minTextVh({ targetMm: CONFIG.rule.lowercaseMm, xHeightRatio: ratio, litHeightMm: CONFIG.panel.litHeightMm });
    root.style.setProperty('--min-text', `${vh}vh`);
  } else if (originalMinText) {
    root.style.setProperty('--min-text', originalMinText);
  } else {
    root.style.removeProperty('--min-text');
  }
}

async function setSizing(mode) {
  state.sizing = mode;
  await applyScenario(state.scenario); // re-feeds the state so any preview follows the mode
}

// ── measurement ─────────────────────────────────────────────────────────────
const TARGETS = [
  { name: 'Top bar: route code', sel: '.route-code' },
  { name: 'Top bar: destination', sel: '.route-destination' },
  { name: 'Line 1 (verb / wait box)', sel: '.hl-verb, .ewb-title' },
  { name: 'Wait box title', sel: '.hl-verb--early .ewb-title' },
  { name: 'Wait box message', sel: '.hl-verb--early .ewb-msg' },
  { name: 'Line 2 (town)', sel: '.hl-town', rule: true },
  { name: 'Line 3 (stop)', sel: '.hl-stop', rule: true },
  { name: 'Sentence headline', sel: '#sign-headline:not(.hl-three-line)' },
  { name: 'Brand wordmark', sel: '.bo-wordmark' },
];

const rectOf = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width === 0 && r.height === 0 ? null : { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

// Where the words actually are: the union of the line boxes (three-line) or the
// text range (sentence), not the padded headline container.
function headlineTextRect(d) {
  const head = d.getElementById('sign-headline');
  if (!head) return null;
  const lines = [...head.querySelectorAll('.hl-verb, .hl-town, .hl-stop')].filter((e) => e.getBoundingClientRect().width > 0);
  const boxes = lines.length ? lines.map((e) => e.getBoundingClientRect()) : [];
  if (!boxes.length) {
    const range = d.createRange();
    range.selectNodeContents(head);
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    boxes.push(r);
  }
  return {
    top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)),
    left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)),
  };
}

function measure() {
  const d = doc();
  const w = win();
  const rows = [];
  for (const t of TARGETS) {
    const el = [...d.querySelectorAll(t.sel)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) continue;
    const cs = w.getComputedStyle(el);
    const fontPx = parseFloat(cs.fontSize);
    const ratio = fontRatio(d, cs.fontFamily, cs.fontWeight);
    const xPx = fontPx * ratio;
    const xMm = pxToMm(xPx, panelDensity.y);
    rows.push({
      name: t.name,
      text: el.textContent.trim().slice(0, 34),
      fontPx: +fontPx.toFixed(1),
      fontMm: +pxToMm(fontPx, panelDensity.y).toFixed(1),
      xHeightMm: +xMm.toFixed(1),
      weight: cs.fontWeight,
      scrolling: !!(el.matches('.marquee') || el.querySelector('.marquee')),
      verdict: t.rule ? verdictForLowercase({ xHeightMm: xMm, requiredMm: CONFIG.rule.lowercaseMm }) : null,
    });
  }
  const family = w.getComputedStyle(d.body).fontFamily;
  const rects = {
    topbar: rectOf(d.getElementById('sign-topbar')),
    'headline-text': headlineTextRect(d),
    brand: rectOf(d.getElementById('onboard-brand')),
    'early-banner': rectOf(d.getElementById('early-wait-banner')),
  };
  const flags = layoutFlags({
    viewport: { w: w.innerWidth, h: w.innerHeight },
    rects,
    // The headline BOX is padded and stretches; only where the text actually sits matters.
    overlapPairs: [['topbar', 'headline-text'], ['headline-text', 'brand'], ['topbar', 'brand']],
  });
  for (const r of rows) {
    if (r.verdict && r.scrolling) flags.push({ type: 'scrolling', name: r.name });
  }
  for (const id of ['sign-main', 'sign-headline']) {
    const el = d.getElementById(id);
    // Only a box that really clips (overflow not visible) can hide content; a
    // visible-overflow box merely reports glyph overhang in scrollHeight.
    if (el && w.getComputedStyle(el).overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1) {
      flags.push({ type: 'content-clipped', name: id });
    }
  }
  const verbEl = d.querySelector('#sign-headline .hl-verb');
  const line1 = verbEl ? { heightPx: +verbEl.getBoundingClientRect().height.toFixed(2), heightMm: +pxToMm(verbEl.getBoundingClientRect().height, panelDensity.y).toFixed(2) } : null;
  const barEl = d.getElementById('sign-topbar');
  const barRect = barEl ? barEl.getBoundingClientRect() : null;
  const topbar = barRect && barRect.height > 0
    ? { heightPx: +barRect.height.toFixed(2), heightMm: +pxToMm(barRect.height, panelDensity.y).toFixed(2), shareOfPanel: +(barRect.height / w.innerHeight).toFixed(4) }
    : null;
  const dataState = d.getElementById('onboard-sign')?.dataset.state ?? null;
  return {
    line1,
    topbar,
    dataState,
    scenario: SCENARIOS[state.scenario].id,
    sizing: state.sizing,
    minText: w.getComputedStyle(d.documentElement).getPropertyValue('--min-text').trim(),
    viewport: { w: w.innerWidth, h: w.innerHeight },
    fontFamily: family,
    fontLoaded: fontAvailable(d, 'Plus Jakarta Sans', 700),
    rows,
    flags,
  };
}

// Width of each text at the Line 2/3 size (22 mm x-height, 'proposed' layout) in the
// real font, and the width one line has to fit in. Used by the stop-name review.
async function measureLines(texts) {
  await setSizing('proposed');
  await applyScenario(SCENARIOS.findIndex((x) => x.id === 'next-three-line'));
  const d = doc();
  const w = win();
  const cs = w.getComputedStyle(d.querySelector('.hl-town'));
  const ctx = d.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  const widths = {};
  for (const t of texts) widths[t] = ctx.measureText(String(t)).width;
  const xRow = measure().rows.find((r) => r.name === 'Line 2 (town)');
  return {
    availablePx: d.getElementById('sign-headline').clientWidth,
    fontPx: parseFloat(cs.fontSize),
    xHeightMm: xRow?.xHeightMm,
    fontLoaded: fontAvailable(d, 'Plus Jakarta Sans', 700),
    family: cs.fontFamily,
    widths,
  };
}

// ── on-screen ruler / calibration ───────────────────────────────────────────
// Everything sits inside the tablet's true-size outline so nothing overlaps and
// the outline itself shows how the tablet would sit on this screen.
function renderCalibration() {
  const cssPerMm = frame.density / window.devicePixelRatio;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const bar = 100 * cssPerMm;
  const panelW = CONFIG.panel.litWidthMm * cssPerMm;
  const panelH = CONFIG.panel.litHeightMm * cssPerMm;
  const ox = (W - panelW) / 2;
  const oy = Math.max(0, (H - panelH) / 2);
  const hx = ox + (panelW - bar) / 2;
  const hy = oy + 150;
  const vx = ox + 40;
  const vy = oy + 130;
  let g = `<rect x="${ox}" y="${oy}" width="${panelW}" height="${panelH}" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="8 5"/>`;
  for (const t of rulerTicks(100)) {
    const len = t.kind === 'cm' ? 16 : t.kind === 'half' ? 11 : 6;
    const p = t.mm * cssPerMm;
    g += `<line x1="${hx + p}" y1="${hy}" x2="${hx + p}" y2="${hy + len}" stroke="#111" stroke-width="1"/>`;
    g += `<line x1="${vx}" y1="${vy + p}" x2="${vx + len}" y2="${vy + p}" stroke="#111" stroke-width="1"/>`;
    if (t.kind === 'cm') {
      g += `<text x="${hx + p}" y="${hy + 32}" font-size="11" text-anchor="middle" fill="#111">${t.mm / 10}</text>`;
      g += `<text x="${vx + 22}" y="${vy + p + 4}" font-size="11" fill="#111">${t.mm / 10}</text>`;
    }
  }
  g += `<line x1="${hx}" y1="${hy}" x2="${hx + bar}" y2="${hy}" stroke="#111" stroke-width="3"/>`;
  g += `<line x1="${vx}" y1="${vy}" x2="${vx}" y2="${vy + bar}" stroke="#111" stroke-width="3"/>`;
  const lines = [
    'RULER CHECK. Hold a ruler against the top bar: it should read 100 mm end to end.',
    'The left bar should also read 100 mm. If they differ, note both readings.',
    `Correction k = ${state.k.toFixed(4)}   ( [ shorter  ] longer  or reload with ?measured100=<reading in mm> )`,
    `devicePixelRatio ${window.devicePixelRatio}; window ${W}x${H} CSS px = ${Math.round(W * window.devicePixelRatio)}x${Math.round(H * window.devicePixelRatio)} device px` +
      ` (configured screen ${CONFIG.screen.resWidthPx}x${CONFIG.screen.resHeightPx})`,
  ];
  lines.forEach((l, i) => { g += `<text x="${ox + 16}" y="${oy + 26 + i * 18}" font-size="12.5" fill="#111">${esc(l)}</text>`; });
  g += `<text x="${ox + 16}" y="${oy + panelH - 12}" font-size="13" fill="#c0392b">Tablet lit area: ${CONFIG.panel.litWidthMm} x ${CONFIG.panel.litHeightMm} mm at true size</text>`;
  $('calib').innerHTML = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace, Consolas, monospace">${g}</svg>`;
}

// ── HUD ─────────────────────────────────────────────────────────────────────
function renderHud() {
  const hud = $('hud');
  hud.hidden = !state.hud || state.calib;
  if (!state.hud || state.calib || !frame || !doc() || !win().__signApi) return;
  const m = measure();
  const f = frame;
  const detected = `${Math.round(window.innerWidth * window.devicePixelRatio)}x${Math.round(window.innerHeight * window.devicePixelRatio)}`;
  const out = [];
  out.push(`STATE ${state.scenario + 1}/${SCENARIOS.length}: ${SCENARIOS[state.scenario].label}`);
  out.push(`SIZING ${MODE_LABEL[state.sizing]}   --min-text ${m.minText.replace(/(\d+\.\d{3})\d*/, '$1')}`);
  out.push(`FRAME ${CONFIG.panel.cssWidthPx}x${CONFIG.panel.cssHeightPx} css px, scale ${f.cssScale.toFixed(4)} @ dpr ${window.devicePixelRatio}`);
  out.push(`TRUE SIZE ${f.fits ? 'YES' : `NO - cropped ${(f.cropHeightFraction * 100).toFixed(1)}% tall / ${(f.cropWidthFraction * 100).toFixed(1)}% wide`}  (spare ${Math.round(f.spareWidthPx)} x ${Math.round(f.spareHeightPx)} device px)  k ${state.k.toFixed(4)}`);
  if (detected !== `${CONFIG.screen.resWidthPx}x${CONFIG.screen.resHeightPx}`) {
    out.push(`NOTE window is ${detected} device px, not ${CONFIG.screen.resWidthPx}x${CONFIG.screen.resHeightPx} - press F11 for fullscreen`);
  }
  const viewportOk = m.viewport.w === CONFIG.panel.cssWidthPx && m.viewport.h === CONFIG.panel.cssHeightPx;
  out.push(`SIGN VIEWPORT ${m.viewport.w}x${m.viewport.h} ${viewportOk ? 'OK' : `*** WRONG - expected ${CONFIG.panel.cssWidthPx}x${CONFIG.panel.cssHeightPx}; press R to reload ***`}`);
  out.push(`FONT ${m.fontLoaded ? 'Plus Jakarta Sans loaded' : '*** Plus Jakarta Sans NOT loaded - fallback font, x-heights unreliable ***'}`);
  out.push('');
  out.push('Element                    font px / mm | lowercase x-height | 22 mm rule');
  for (const r of m.rows) {
    const rule = (r.verdict ? (r.verdict.pass ? 'PASS' : `FAIL (short ${r.verdict.shortfallMm.toFixed(1)} mm)`) : '-') + (r.verdict && r.scrolling ? ' SCROLLS' : '');
    out.push(`${r.name.padEnd(26)} ${String(r.fontPx).padStart(5)} / ${String(r.fontMm).padStart(4)} | ${String(r.xHeightMm).padStart(5)} mm | ${rule}`);
  }
  out.push('');
  out.push(m.flags.length
    ? `LAYOUT FLAGS:\n${m.flags.map((x) => `  ${x.type}: ${x.name ?? x.names.join(' / ')}${x.overshootPx ? ` by ${Math.round(x.overshootPx)} px` : ''}`).join('\n')}`
    : 'LAYOUT FLAGS: none');
  hud.textContent = out.join('\n');
}

function renderHelp() {
  const help = $('help');
  help.hidden = !state.help;
  help.textContent = [
    '1-9, 0    pick a state          Left / Right   previous / next state',
    'S         cycle: deployed > 22mm diagnostic > compact > proposed > large    D   back to deployed',
    'M         measurements panel    K   ruler check    T   anchor top/bottom/center',
    'F         fullscreen (or F11)   R   reload the sign (picks up CSS edits)',
    '[ ]       nudge scale 0.25%     H   this help',
  ].join('\n');
}

// ── keys ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', async (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;
  if (/^[0-9]$/.test(key)) {
    const i = SCENARIOS.findIndex((s) => s.key === key);
    if (i !== -1) await applyScenario(i);
  } else if (key === 'ArrowRight') await applyScenario(state.scenario + 1);
  else if (key === 'ArrowLeft') await applyScenario(state.scenario - 1);
  else if (key === 's' || key === 'S') await setSizing(MODES[(MODES.indexOf(state.sizing) + 1) % MODES.length]);
  else if (key === 'd' || key === 'D') await setSizing('deployed');
  else if (key === 'm' || key === 'M') { state.hud = !state.hud; renderHud(); }
  else if (key === 'k' || key === 'K') { state.calib = !state.calib; $('calib').hidden = !state.calib; $('wrap').hidden = state.calib; if (state.calib) renderCalibration(); renderHud(); }
  else if (key === 'h' || key === 'H') { state.help = !state.help; renderHelp(); }
  else if (key === 't' || key === 'T') { state.anchor = { top: 'bottom', bottom: 'center', center: 'top' }[state.anchor]; layout(); }
  else if (key === 'f' || key === 'F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); }
  else if (key === 'r' || key === 'R') { await loadSign(); await applyScenario(state.scenario); }
  else if (key === '[') { state.k = Math.max(0.5, state.k * 0.9975); layout(); }
  else if (key === ']') { state.k = Math.min(2, state.k * 1.0025); layout(); }
});
window.addEventListener('resize', layout);

// ── boot ────────────────────────────────────────────────────────────────────
// The frame MUST be sized before the sign loads: onboard.js calibrates
// --min-text once at init from its own window size, so a default-sized iframe
// would silently calibrate against the wrong viewport.
layout();
await loadSign();
layout();
await applyScenario(Number(params.get('scenario') ?? 0));
renderHelp();
if (params.get('calib') === '1') { state.calib = true; $('calib').hidden = false; $('wrap').hidden = true; renderCalibration(); }

// Read-only hooks for automated capture (slice 3) and verification.
window.__replica = {
  config: CONFIG,
  state,
  scenarios: SCENARIOS,
  measure,
  measureLines,
  applyScenario,
  setSizing,
  layout,
  frame: () => frame,
  mmToPx: (mm) => mmToPx(mm, panelDensity.y),
};
window.__replicaReady = true;
