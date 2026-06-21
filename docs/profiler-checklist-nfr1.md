# NFR-1 composed-Scene ~60fps profiler — turnkey checklist

**Purpose.** This is the one remaining manual step to flip the tesla-card 1.0.0
release gate (`bmad-testarch-trace`) from 🟡 **CONCERNS** → ✅ **PASS**. Story 6.8 /
8.8 **AC3** requires that the composed "My Home" Scene — 6 live cards + Gateway bus +
weather vignette — sustains **~60fps** on the NFR-1 reference device. By design this
is a **[PROFILER]** measurement on physical hardware, not a CI assertion (see
`docs/audit-r6-suite.md` § AC3). Everything that *can* be automated already is; this
is the last human-in-the-loop item.

> **For a fresh Claude session:** you can run steps 1–3 and steps 6–7 for the user
> (build, serve, confirm the Scene, then record the result). **Step 4 (the actual
> profiler capture) needs a human at the reference device** — Claude cannot read the
> hardware's frame rate. Hand the user steps 4–5, collect the number they report, and
> do the recording in steps 6–7.

---

## 0. Prerequisites

- A checkout of `tesla-card` on `main` with deps installed (`npm ci`).
- The **NFR-1 reference device**: the **low-end tablet / wall-kiosk class** the suite
  must hold ~60fps on — *not* a developer workstation (a fast laptop will pass
  trivially and prove nothing). Use the actual target kiosk, or the closest low-end
  Android tablet / equivalent you ship to.
- Google Chrome (the device's own browser) with DevTools reachable (desktop Chrome
  for the capture, or remote-debug the tablet via `chrome://inspect` from a host).

## 1. Build + serve the composed Scene

```bash
npm run build                 # produces dist/tesla-card.js (the demo imports it)
npm run serve:demo            # http-server on http://127.0.0.1:4173 (-c-1, no cache)
```

If profiling the tablet against a host machine, serve on the host and reach it from
the tablet via the host's LAN IP (`http://<host-ip>:4173/...`), or copy `dist/` +
`demo/` to the device and serve locally.

## 2. Load the Scene (verified turnkey URL)

```
http://127.0.0.1:4173/demo/?card=my-home
```

The `?card=my-home` demo mode mounts the full `tc-my-home` Scene fed the same mock
`hass` the demo already builds (energy site + `weather.home` present), hides the
standalone vehicle card, and widens the stage to the **desktop horizontal-bus**
layout. *(Wired in `demo/index.html`; if it's missing, you're on an old build —
rebuild.)*

## 3. Confirm the Scene is the right subject (do this before measuring)

You should see, all simultaneously visible and animating at rest:

- [ ] The **self-powered ribbon** across the top (e.g. "89% self-powered now").
- [ ] **Six live cards**: Solar, Powerwall, Grid (top row) · Home, Wall Connector,
      **Vehicle** (Model Y, charging) (bottom row).
- [ ] The **Gateway bus** running horizontally between the rows with **kW pills** and
      a **flowing dash** animation.
- [ ] The **weather vignette** animating on the Solar card.
- [ ] **Zero console errors** (open DevTools → Console; a clean Scene logs none).
- [ ] Leave it **at rest — do not interact**. The target is the *steady-state*
      resting animation, not interaction latency.

If the bus dash and vignette aren't moving, you may be under an OS "reduce motion"
setting — turn it **off** for this measurement (reduced-motion legitimately freezes
the animations, which is not what AC3 measures).

## 4. Capture (~10s steady state) — **human at the device**

Either method is valid; the Performance recording is the authoritative one.

**A — live read (quick sanity):** DevTools → ⋮ → **More tools → Rendering** → tick
**Frame Rendering Stats** (FPS overlay). Watch the resting Scene for ~10s; note the
sustained FPS (ignore the first ~1s paint spike).

**B — sustained number (authoritative):** DevTools → **Performance** → ●Record →
let the resting Scene run **~10 seconds** → Stop. Read the sustained frame rate from
the **Frames** track / the FPS chart (green = good). Read the *steady-state* band,
not the initial first-paint dip.

## 5. Pass bar

- **PASS:** **~60fps sustained** across the 10s window on the reference device.
- A brief dip on first paint is expected and is **not** the target — the steady state
  is.
- **MISS:** sustained materially below ~60fps (e.g. persistent 30–45fps). A miss is
  **not a release blocker** — it triggers the degradation ladder (step 6), which
  degrades *motion*, never the data.

## 6. On a miss — apply the AC5 degradation ladder (ordered, cheap)

Documented in `docs/audit-r6-suite.md` § AC5. Apply in order, re-measuring after each
rung; **keep the data** (arrowheads + kW labels survive) at every rung:

1. **Reduce bus-animation density** — fewer simultaneously-animated edges / longer
   dash period.
2. **Cap simultaneously-animated edges** — clamp the **shared** `edgeVisual`
   width/`durSec` output (the seam is noted at `flow/renderer.ts` / `my-home.ts`).
   **Never fork the kW→visual formula** (FR-33 — the flow engine is frozen).
3. **Freeze the weather vignette first** — it already freezes via the reduced-motion
   path; reuse that as the lowest-cost rung.

Stop at the first rung that restores the budget. Wire only the rung(s) the
measurement actually demands.

## 7. Record the result (where it flips the gate)

1. **`docs/audit-r6-suite.md` § AC3** — replace the `[PROFILER] — not measured`
   status with the captured number, the device, the date, and PASS/MISS (+ which
   ladder rungs were applied, if any).
2. **The trace matrix** `_bmad-output/test-artifacts/traceability-matrix.md` —
   condition #2 → DONE; flip **6.8/8.8 AC3** NONE → FULL (or FULL-with-evidence); set
   `gateDecision: PASS` if this was the last open item.
3. **The planning-repo audit story**
   `tesla-card-planning/implementation-artifacts/6-8-suite-complete-audit-checkpoint-r6.md`
   (and `8-8-...`) — note the measurement in the change log so the retro record is
   complete.
4. If PASS and nothing else is open: the gate is **PASS** — proceed to cut **1.0.0**
   per the release backlog.

---

### One-paragraph summary (paste to a fresh session to resume)

> Run the NFR-1 ~60fps profiler pass — the last open tesla-card 1.0.0 gate condition.
> `npm run build && npm run serve:demo`, open `http://127.0.0.1:4173/demo/?card=my-home`
> on the **low-end kiosk reference device**, confirm the 6-card + Gateway-bus +
> vignette Scene is animating at rest with zero console errors, then DevTools →
> Performance → record ~10s steady-state and read the sustained FPS. Pass bar
> **~60fps**. On a miss, apply the `docs/audit-r6-suite.md` § AC5 ladder (reduce bus
> density → cap edges via the shared `edgeVisual` clamp → freeze the vignette).
> Record the number in `docs/audit-r6-suite.md` § AC3 + the trace matrix (condition
> #2 → done, 6.8/8.8 AC3 → FULL, gate → PASS).
