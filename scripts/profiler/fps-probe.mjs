// NFR-1 composed-Scene FPS probe — the instrumented counterpart to the human
// `docs/profiler-checklist-nfr1.md` procedure. Drives the real bundled `tc-my-home`
// Scene in HEADED Chromium (headed is deliberate — real vsync; headless caps/structures
// rAF differently), confirms the subject (6 cards + Gateway bus + weather vignette +
// animating-at-rest), captures console errors, screenshots, and measures sustained rAF
// frame cadence over a ~10s steady-state window per throttle rate.
//
// CPU throttling (CDP Emulation.setCPUThrottlingRate) emulates the low-end kiosk CPU
// class: 1x baseline, 4x (~Lighthouse mobile), 6x (aggressive low-end). Each run first
// VALIDATES the throttle actually bit — an identical busy-loop is timed at 1x and at each
// rate; the elapsed time must scale ~linearly with the rate (this is the "636ms → 3992ms"
// evidence recorded in docs/audit-r6-suite.md §AC3). Zero dropped frames under a VALIDATED
// throttle is the load-bearing signal, not the headline fps.
//
// HONEST scope: this is an in-browser measurement on THIS workstation. CPU throttling
// emulates a slow CPU, not a weak GPU/raster/thermal envelope, and the dev display is not
// the physical kiosk. It is strong SUPPORTING evidence (negligible per-frame main-thread
// cost), not a substitute for a physical-kiosk read — run the manual checklist for that.
//
// Turnkey:  npm run profile:nfr1          (builds, serves, probes, tears down)
// Manual:   node scripts/profiler/fps-probe.mjs   (needs a server already at SCENE_URL)
//
// Env knobs: SCENE_URL, DURATION_MS, WARMUP_MS, RATES (csv), OUT_DIR.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const URL = process.env.SCENE_URL || 'http://127.0.0.1:4173/demo/?card=my-home';
const DURATION_MS = Number(process.env.DURATION_MS || 10000);
const WARMUP_MS = Number(process.env.WARMUP_MS || 1500);
const RATES = (process.env.RATES || '1,4,6').split(',').map(Number);
const OUT_DIR = resolve(REPO_ROOT, process.env.OUT_DIR || 'scripts/profiler/out');
mkdirSync(OUT_DIR, { recursive: true });

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[i];
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const browser = await chromium.launch({
  headless: false,
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => {
    const s = document.querySelector('tc-my-home');
    return !!(s && s.shadowRoot && s.shadowRoot.querySelector('.sb-flow'));
  },
  { timeout: 20000 },
);
// Let layout + first paint settle before inspecting/measuring.
await page.waitForTimeout(1200);

const subject = await page.evaluate(() => {
  const scene = document.querySelector('tc-my-home');
  const sr = scene.shadowRoot;
  const ecoTags = ['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector'];
  const eco = ecoTags.filter((t) => sr.querySelector(t));
  const vehicle = sr.querySelectorAll('tesla-card').length;
  const busFlows = sr.querySelectorAll('.sb-flow').length;
  const busChips = sr.querySelectorAll('.sb-chip').length;
  const solar = sr.querySelector('tc-solar');
  const ssr = solar && solar.shadowRoot;
  const vignPresent = !!(ssr && ssr.querySelector('.wx'));
  const vignArt = ssr ? ssr.querySelectorAll('[class^="wx-"]').length : 0;
  const flow = sr.querySelector('.sb-flow');
  const flowAnim = flow ? getComputedStyle(flow).animationName : 'none';
  const wxEl = ssr && ssr.querySelector('.wx-glow,.wx-rays,.wx-cloud,.wx-drop,.wx-flake,.wx-star,.wx-bolt');
  const wxAnim = wxEl ? getComputedStyle(wxEl).animationName : 'none';
  // Count running CSS animations across the scene + its sub-roots.
  const countAnims = (root) => {
    let n = 0;
    try { n += root.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length; } catch {}
    return n;
  };
  let runningAnims = countAnims(sr);
  if (ssr) runningAnims += countAnims(ssr);
  return {
    ecoCards: eco, ecoCount: eco.length, vehicleCells: vehicle,
    busFlowPaths: busFlows, busChips, vignettePresent: vignPresent, vignetteArtNodes: vignArt,
    busFlowAnimationName: flowAnim, vignetteAnimationName: wxAnim, runningCssAnimations: runningAnims,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    dpr: window.devicePixelRatio,
  };
});

const cdp = await context.newCDPSession(page);

// Fixed CPU-bound loop, timed via performance.now(). Run once per rate to prove the
// CDP throttle is real: elapsed time must scale ~linearly with the throttle rate.
// Sized for a few-hundred-ms baseline so fixed overhead is negligible and the ratio is
// low-noise (a short loop dilutes the ratio — fixed cost is a larger fraction of it).
const busyLoopMs = () =>
  page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 3e8; i++) x += Math.sqrt(i + 1) * 1.0000001;
    return { ms: performance.now() - t0, sink: x };
  });

async function validateThrottle(rates) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForTimeout(200);
  const baseline = (await busyLoopMs()).ms;
  const rows = [{ rate: 1, busyMs: +baseline.toFixed(0), ratio: 1, expected: 1, bit: true }];
  for (const rate of rates) {
    if (rate === 1) continue;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.waitForTimeout(200);
    const ms = (await busyLoopMs()).ms;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const ratio = ms / baseline;
    rows.push({ rate, busyMs: +ms.toFixed(0), ratio: +ratio.toFixed(2), expected: rate, bit: ratio >= 0.6 * rate });
  }
  return { baselineMs: +baseline.toFixed(0), rows };
}

async function measure(rate) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.waitForTimeout(600); // let the throttle take hold
  const raw = await page.evaluate(
    ({ durationMs, warmupMs }) =>
      new Promise((resolve) => {
        const ts = [];
        let start = null;
        const frame = (now) => {
          if (start === null) start = now;
          ts.push(now);
          if (now - start < durationMs + warmupMs) requestAnimationFrame(frame);
          else {
            const cutoff = start + warmupMs;
            const kept = ts.filter((t) => t >= cutoff);
            const intervals = [];
            for (let i = 1; i < kept.length; i++) intervals.push(kept[i] - kept[i - 1]);
            resolve({ frames: kept.length, span: kept[kept.length - 1] - kept[0], intervals });
          }
        };
        requestAnimationFrame(frame);
      }),
    { durationMs: DURATION_MS, warmupMs: WARMUP_MS },
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const iv = raw.intervals;
  const fps = (raw.frames - 1) / (raw.span / 1000);
  const med = pct(iv, 50);
  const longFrames = iv.filter((d) => d > 32).length; // > two 60Hz vsyncs = a dropped frame
  const jank = iv.filter((d) => d > 1.5 * med).length;
  return {
    rate,
    sustainedFps: +fps.toFixed(1),
    frames: raw.frames,
    spanSec: +(raw.span / 1000).toFixed(2),
    meanMs: +mean(iv).toFixed(2),
    p50Ms: +med.toFixed(2),
    p95Ms: +pct(iv, 95).toFixed(2),
    p99Ms: +pct(iv, 99).toFixed(2),
    maxMs: +Math.max(...iv).toFixed(2),
    longFrames,
    longFramePct: +((100 * longFrames) / iv.length).toFixed(2),
    jankFrames: jank,
  };
}

process.stdout.write('validating CPU throttle (busy-loop scaling) ... ');
const throttle = await validateThrottle(RATES);
console.log(throttle.rows.map((r) => `${r.rate}x→${r.busyMs}ms`).join('  '));
const throttleSuspect = throttle.rows.filter((r) => !r.bit);
if (throttleSuspect.length) {
  console.log(`  ⚠ throttle may NOT have engaged at: ${throttleSuspect.map((r) => `${r.rate}x`).join(', ')} (busy-loop did not scale)`);
}

const results = [];
for (const r of RATES) {
  process.stdout.write(`measuring rate=${r}x ... `);
  const m = await measure(r);
  results.push(m);
  console.log(`${m.sustainedFps} fps  (p95 ${m.p95Ms}ms, long ${m.longFramePct}%)`);
}

const shotPath = join(OUT_DIR, 'my-home-scene.png');
const jsonPath = join(OUT_DIR, 'fps-results.json');
await page.screenshot({ path: shotPath, fullPage: true });

const out = {
  url: URL, durationMs: DURATION_MS, warmupMs: WARMUP_MS,
  viewport: '1280x900', dpr: subject.dpr,
  subject, throttle, consoleErrors, pageErrors, results,
};
writeFileSync(jsonPath, JSON.stringify(out, null, 2));
console.log('\n=== SUBJECT ===');
console.log(JSON.stringify(subject, null, 2));
console.log('\n=== THROTTLE VALIDATION (busy-loop scaling) ===');
console.table(throttle.rows);
console.log('\n=== CONSOLE ERRORS ===', consoleErrors.length, pageErrors.length ? `(+${pageErrors.length} pageerrors)` : '');
for (const e of [...consoleErrors, ...pageErrors]) console.log('  •', e);
console.log('\n=== RESULTS (per CPU-throttle rate) ===');
console.table(results);

// Load-bearing signal: zero dropped frames under the most aggressive VALIDATED throttle.
const worst = results[results.length - 1];
const worstThrottleOk = (throttle.rows.find((r) => r.rate === worst.rate) || {}).bit !== false;
console.log(
  `\nLoad-bearing signal: ${worst.longFrames} dropped frame(s) at ${worst.rate}x throttle` +
    `${worstThrottleOk ? ' (throttle validated)' : ' (⚠ throttle UNVALIDATED — re-run)'}.`,
);
console.log(`Artifacts: ${jsonPath}  ·  ${shotPath}`);

await browser.close();
