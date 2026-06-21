# NFR-1 composed-Scene FPS profiler

Instrumented, re-runnable harness for the **last release-gate measurement** — Story
6.8 / 8.8 **AC3**: the composed "My Home" Scene (6 live cards + Gateway bus + weather
vignette) sustains **~60fps at rest**. This is the automated counterpart to the
human-at-the-device procedure in [`docs/profiler-checklist-nfr1.md`](../../docs/profiler-checklist-nfr1.md);
the recorded sign-off lives in [`docs/audit-r6-suite.md` §AC3](../../docs/audit-r6-suite.md).

## Run it

```bash
npm run profile:nfr1
```

Turnkey: builds `dist/tesla-card.js`, serves the demo, opens the `?card=my-home` Scene
in **headed** Chromium, validates the CPU throttle, measures ~10s of steady-state rAF
cadence per rate, then tears the server down. A browser window opens — this needs a real
display (headed = true vsync), so it is **not** a headless CI job by design (AC3 is a
`[PROFILER]`-class read, never a CI assertion).

Already have the demo served at `127.0.0.1:4173`? Skip the wrapper:

```bash
node scripts/profiler/fps-probe.mjs
```

### Knobs (env vars)

| Var | Default | Meaning |
| --- | --- | --- |
| `RATES` | `1,4,6` | CSV of CDP CPU-throttle rates (1× baseline, 4× ≈ Lighthouse mobile, 6× aggressive low-end) |
| `DURATION_MS` | `10000` | steady-state measurement window per rate |
| `WARMUP_MS` | `1500` | discarded settle window before each measurement |
| `SCENE_URL` | `http://127.0.0.1:4173/demo/?card=my-home` | Scene under test |
| `OUT_DIR` | `scripts/profiler/out` | artifact dir (gitignored) |

## What it reports

- **Subject confirmation** — that the 6 eco cards + vehicle cell + Gateway bus flow +
  weather vignette are present and animating at rest (catches a wrong/blank subject
  before the number means anything), plus reduced-motion / DPR.
- **Throttle validation** — an identical busy-loop timed at 1× and each rate; elapsed
  time must scale ~linearly with the rate. This is the **load-bearing honesty check**:
  "zero dropped frames" only means something under a throttle that actually bit. (The
  recorded run scaled 636ms → 2656ms ≈4× → 3992ms ≈6×.)
- **Per-rate cadence** — sustained fps, mean/p50/p95/p99/max frame interval, dropped
  frames (>32ms = two missed 60Hz vsyncs), and jank.
- **Artifacts** in `OUT_DIR`: `fps-results.json` (full record) + `my-home-scene.png`.

## Reading the result

- **Pass bar:** ~60fps sustained with **zero dropped frames** across the window. The
  signal that matters is *zero dropped frames under a validated throttle*, not the
  headline fps (a fast 120Hz display clears 60 trivially).
- **HONEST scope:** this is an in-browser read on **this workstation**. CPU throttling
  emulates a slow CPU, **not** a weak GPU / raster / thermal envelope, and the dev
  display is not the physical kiosk. Treat a pass here as strong *supporting* evidence;
  a physical-kiosk confirmation via the manual checklist remains the gold standard.
- **On a miss:** apply the ordered AC5 degradation ladder in
  [`docs/audit-r6-suite.md` §AC5](../../docs/audit-r6-suite.md) (reduce bus density → cap
  edges via the shared `edgeVisual` clamp → freeze the vignette), re-measuring after each
  rung. A miss is **not** a release blocker; it degrades *motion*, never data.
