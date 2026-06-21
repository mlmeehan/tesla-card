# R6 — Suite-complete audit checkpoint

> **What this is.** The Definition of Done mandates a *named cross-component pass*
> at the **end of Epic 6 (suite complete)**: keyboard navigation / focus order
> **across cards & the "My Home" Scene**, a reduced-motion **sweep** over all Scene
> animations (Gateway bus, weather vignette, card animations), a freshness-honesty
> **review** of the composed Scene, the composed-Scene **~60fps budget** on the
> NFR-1 reference device, and the suite exercised against a **non-default dialect**.
> This document is the standing suite-level R6 checklist + the durable record of the
> Story 6.8 pass. It is the **peer of `docs/audit-r6-vehicle-card.md` one level up**:
> 5.11 audited the vehicle card as a whole; 6.8 audits the **suite** as a whole.
> Cross-reference (don't duplicate) the vehicle-card audit for the per-panel layer.
>
> It is **honest about its own coverage**. Evaluative items the architecture routes
> to *human review* (epics.md "Verification modes", L354–358) are marked **[HUMAN]**;
> the ~60fps measurement is a **[PROFILER]** task on physical kiosk hardware — neither
> is claimed as automated. Where AC4 needed no remediation it is recorded as a
> **proof, not a fix** (an audit that fabricates a fix to look busy is the dishonest
> read this checkpoint exists to prevent).

Scope reality: Story 6.8 is an **audit-and-document checkpoint**, not a feature
build. No new card, panel, flow node, config field, or engine edit. AC4 turned out
to be a **proof** (energy resolution is already function-slug-based, dialect/prefix-
agnostic by construction) — no leak was found, so no remediation was needed. The
only artifacts are the suite-audit tests + this document.

---

## Surface enumeration (the audit is exhaustive, not sampled)

The composed whole = the vehicle card (already R6-audited in 5.11) **+ the six
ecosystem cards + the My Home Scene**.

| Layer | Files |
|---|---|
| Vehicle card | the entire Epic-3/4/5 card — audited in `docs/audit-r6-vehicle-card.md` |
| Ecosystem cards | `src/components/{solar,powerwall,grid,home,wall-connector}.ts` (Home + WC render through the shared `ecosystem-card.ts`) |
| Weather vignette | `src/components/weather-vignette.ts` (render fn used inside `tc-solar`) |
| My Home Scene | `src/components/my-home.ts` (element) · `src/flow/my-home.ts` (hub) · `src/flow/scene-bus.ts` (`SceneBusRenderer`) |
| Flow engine | `src/flow/{renderer,binding,model,balance}.ts` (FR-33 frozen) |
| Data boundary | `src/data/{energy,dialect,freshness,registry,resolve}.ts` |
| Shared | `src/{styles,ui,helpers,strings,const}.ts` |

---

## AC1 — keyboard navigation / focus order + reduced-motion sweep across cards & the Scene

### Reduced-motion: the Scene/ecosystem animation inventory → behaviour → gate

Rule: **kill the motion, keep the data.** Every animation degrades to a static,
legible read; no animation may *vanish* its data cue. Every source below was
**already gated** before 6.8 — the AC1 gap this checkpoint closed is the **composed
sweep** (no test drove `prefers-reduced-motion` over the whole Scene at once) and
the **cross-card / into-Scene keyboard traversal**.

| Surface | Animation | Reduced-motion | Gated in | Asserted (composed) |
|---|---|---|---|---|
| Gateway bus | `.sb-flow` stroke-dash (`sb-flow-dash`) | `animation: none`; `.sb-head`/`.gw-head` arrowheads + kW ribbon survive | `scene-bus.ts` `sceneBusStyles` `@media` (L353–358), composed into `my-home.ts` styles | **`audit-r6-suite.spec.ts` (NEW)** |
| Weather vignette | `wxGlow`/`wxRays`/`wxDrift`/`wxRain`/`wxSnow`/`wxTw`/`wxFlash` (`.wx-*`) | `animation: none`; the condition art (`.wx-art`) stays legible | `weather-vignette.ts` `@media` (L464–475) | **`audit-r6-suite.spec.ts` (NEW)** |
| Scene focus-highlight | `.scene.focus` cell/leg opacity **transition** | `transition: none` (instant cut); the dim/light cue survives (focused card stays lit) | `my-home.ts` `@media` (L732–737) | **`audit-r6-suite.spec.ts` (NEW)** — composed reduced-motion assertion |
| Ecosystem cards | — | none beyond the vignette + the shared `tc-pulse`/`tc-shimmer` corpus | — | n/a (no card-local keyframes — confirmed by grep) |

**Finding:** unlike 5.11 (which found the Flow-overlay dash *uncovered*), the Scene
had **no uncovered animation** — every source was already `prefers-reduced-motion`-
gated. 6.8 adds the **composed-sweep assertion** that **all three** sources (bus
dash, weather vignette, **and the focus-highlight transition**) freeze together
while every data cue (arrowheads, kW ribbon, condition art, the focused card's lit
state) survives. ✅ automated.

### Keyboard navigation / focus order

| Check | How | Status |
|---|---|---|
| Keyboard Tab lands on a Scene card cell (`tabindex=0`) | E2E `audit-r6-suite.spec.ts` | ✅ automated |
| The focused Scene card paints the 2px `--tc-blue` `:focus-visible` ring | E2E `audit-r6-suite.spec.ts` | ✅ automated |
| Focusing a card highlights the Scene (focusin) with **no navigation / no trap** | E2E `audit-r6-suite.spec.ts` (tabs past all five cells → focus **escapes** the scene-cell set) + `my-home-scene.spec.ts` (no card churn) | ✅ automated |
| Per-card a11y floor (≥44px, ring, SR labels) in isolation | the per-card suites (6.1–6.6) + `a11y-interaction.spec.ts` | ✅ automated (prior) |
| **"Focus order reads naturally across the suite; no surprising jumps"** | manual sweep against EXPERIENCE.md, vehicle card → ecosystem cards → Scene | **[HUMAN]** |
| **"The Scene reads at a glance with motion off"** | manual sweep against DESIGN.md/EXPERIENCE.md | **[HUMAN]** |

---

## AC2 — freshness-honesty review across the Scene (the half-alive read is calm, not broken)

The one unforgivable copy error is a label that overstates freshness. Each Scene
surface stays honest by one of three mechanisms; the half-alive composition was
**proven in 6.7** and is **re-confirmed composed** here.

| Surface | Mechanism | Honest read |
|---|---|---|
| Running-net ribbon | **structural + stamped** | partial quiescence ⇒ **confident** (the live half is NOT understated; `edges.every(...)` dim gate — not widened); full quiescence ⇒ `.dim` + "updated Nm ago" age stamp (`referenceNow`/`formatAgeHint`, never `Date.now()`) |
| Solar / Powerwall / Grid / Home / WC cards | **stamped last-known** | absent ⇒ calm empty sentence (no fabricated 0/NaN); stale ⇒ last-known value + `.tc-stale-copy` "updated …" stamp |
| Weather vignette | **structural** | absent/`unavailable` condition ⇒ honest overcast (never a fabricated sky) |
| Quiescent flow edges | **structural** | sub-deadband / NaN / `unavailable` ⇒ `direction:'none'` (present, calm), never animated jitter |

Staleness copy uses `--tc-text-dim` (the freshness-honest tone), **never**
`--tc-text-mute`. The freshness read-model is `data/freshness.ts`.

| Check | How | Status |
|---|---|---|
| A partially-quiescent Scene is NOT wholesale-dimmed (live half stays confident) | `my-home.test.ts` (6.7) | ✅ automated |
| A fully-quiescent Scene IS `.dim` + age-stamped | `my-home.test.ts` (6.7) | ✅ automated |
| Empty / single-node / 0-data models render calm (no overlay box, no crash) | `my-home.test.ts` + `audit-r6-suite.test.ts` (composed degradation sweep) | ✅ automated |
| No NaN painted anywhere across the composed Scene (incl. the non-default prefix) | `audit-r6-suite.test.ts` | ✅ automated |
| **"Staleness everywhere reads calm, not broken; nothing overstates"** whole-suite | manual sweep against EXPERIENCE.md | **[HUMAN]** |

---

## AC3 — the composed-Scene ~60fps budget ([PROFILER] residue — NOT a CI assertion)

Per epics.md:358 the budget is measured on a **named reference device** via the
**browser performance profiler over a ~10s steady-state Scene** — a sustained-frame
target, **not** a Vitest assertion or a synthetic microbenchmark — so it is **not**
claimed as CI-automated green. It was instead **measured in-session via an instrumented
browser profiler** (headed real-vsync Chromium driven by Playwright + CDP) on the **dev
workstation — explicitly NOT the physical kiosk** — and accepted by the release owner as
the NFR-1 sign-off; the recorded number + its honest caveats are in **The recorded
measurement** below. Claiming AC3 "green, **automated in CI**" would still be the
dishonesty this checkpoint catches — this is a **manual [PROFILER]-class** read,
instrument-driven rather than eyeballed in DevTools, on a workstation rather than the
kiosk, and labeled as exactly that.

### The enabling precondition (machined)

The Scene's geometry runs on **rAF over cached anchors**, decoupled from the
`hass`-tick via the `RafCoalescer` + `ResizeObserver` (epics.md:770) — so a live
data tick re-renders values but does **NOT** thrash layout. This no-thrash
precondition is asserted:

| Check | How | Status |
|---|---|---|
| An unrelated `hass` tick does NOT recompute geometry | `my-home.test.ts` ("an unrelated hass tick does NOT recompute geometry") | ✅ automated |
| A value-only energy tick re-renders but does NOT recompute geometry | `my-home.test.ts` | ✅ automated |
| Geometry recompute is reflow-driven (ResizeObserver), never tick-driven | `my-home.test.ts` + `my-home-scene.spec.ts` (real reflow) | ✅ automated |

### The profiler procedure (for the human to run) — [PROFILER]

1. **Device:** the NFR-1 reference device — the **low-end tablet-kiosk class** (the
   target the suite must hold ~60fps on, not a developer workstation).
2. **Build + serve the composed Scene:** `npm run build`, then `npm run serve:demo`
   and open **`http://127.0.0.1:4173/demo/?card=my-home`** — the `?card=my-home` demo
   mode mounts the full `tc-my-home` Scene (six live cards + Gateway bus + weather
   vignette) fed the demo's mock hass (energy site + `weather.home` present so the
   vignette animates), hides the standalone vehicle card, and widens to the desktop
   horizontal-bus layout. Confirm all six live cards + the bus + the vignette are
   simultaneously visible and animating. **A full turnkey step-by-step lives in
   [`profiler-checklist-nfr1.md`](profiler-checklist-nfr1.md).**
3. **Capture:** open the browser performance profiler, record a **~10s steady-state**
   (no interaction — the resting animated Scene), stop, read the sustained frame rate.
4. **Pass bar:** **~60fps sustained** over the 10s window (transient dips on first
   paint are not the target; the steady state is).
5. **On a miss:** apply the AC5 degradation ladder below — a missed budget **degrades
   motion, it is NOT a release blocker**.

### The recorded measurement — ✅ PASS (2026-06-21)

**Result: ✅ PASS — the resting composed Scene sustained the full display refresh with
zero dropped frames, every frame within the ~60fps budget, and held there under a
validated 6× CPU throttle.**

| Field | Value |
|---|---|
| Date | 2026-06-21 |
| Subject | the live `?card=my-home` Scene — **6 cards** (5 ecosystem + Model Y vehicle cell) + **Gateway bus** (10 animated `.sb-flow` dash edges) + **weather vignette** (`wxGlow`/rays/cloud-drift); 14 running CSS animations; reduced-motion off; **0 console errors** |
| Method | headed real-vsync Chromium (Playwright + CDP), 1280×900, DPR 1; rAF inter-frame intervals captured over **3 × 10s** steady-state windows, ~1.5s first-paint warmup discarded |
| Baseline (1× CPU) | **120.0 fps** sustained · p95 9.1ms · p99 10.3ms · max 10.4ms · **0** frames >16.7ms · **0** jank |
| 4× CPU throttle | **120.0 fps** · p95 9.3ms · 0 over-budget · 0 jank |
| 6× CPU throttle | **120.0 fps** · p95 9.2ms · max 9.4ms · 0 over-budget · 0 jank |
| Throttle validated | CDP `setCPUThrottlingRate` confirmed real — identical busy-loop scaled 636ms → 2656ms (≈4×) → 3992ms (≈6×) |
| Against the ~60fps bar | display is 120Hz so rAF caps at 120fps; **100% of frames cleared the 16.7ms / 60fps budget** (worst frame 10.4ms) — ≈1.6× frame-time headroom — and stayed clear under 6× CPU slowdown |

**HONEST provenance / caveats (the device the gate names was NOT used):**
- Measured on a **macOS developer workstation (120Hz)**, **not** the low-end tablet-kiosk
  reference device §AC3 + the checklist call for. A fast machine clears ~60fps trivially;
  the load-bearing signal here is **zero dropped frames under a validated 6× CPU throttle**,
  which emulates a slow **CPU** but **not** a weak **GPU/raster/thermal** envelope.
- This is therefore strong **supporting** evidence (the Scene's per-frame main-thread cost
  is negligible — consistent with the machined no-thrash precondition above), and was
  **accepted by the release owner (2026-06-21) as the NFR-1 sign-off**. A confirmation read
  on the physical kiosk remains the ideal follow-up (run the turnkey
  [`profiler-checklist-nfr1.md`](profiler-checklist-nfr1.md) on the device).
- **Harness correction made to measure the documented subject:** the committed
  `?card=my-home` harness was rendering only **2 of 3** animated layers — the awake vehicle
  fixture carries no `weather.home`/`sun.sun` (install-wide core entities, not
  Tesla-prefixed), so `tc-solar` honestly omitted the vignette (`weather-vignette.ts`:
  absent ⇒ `nothing`). `demo/index.html` now injects a daytime `partlycloudy` sky on the
  my-home path (+ an empty-data favicon to clear a benign 404), so the measured Scene is the
  full 6-card + bus + **vignette** subject with zero console errors.
- **No AC5 ladder rung was needed** (no miss to remediate) — it stays documented + unwired.

**Status: ✅ PASS (manual [PROFILER]-class, instrument-driven; dev-workstation + validated
6× CPU-throttle low-end emulation — see caveats). Closes the last open 1.0.0 trace-gate
condition.**

---

## AC4 — cross-dialect: function-name resolution holds across a non-default install

Every ecosystem card + the Scene was built against the **auto-detected default**
energy resolution. AC4 exercises them against a **non-default install prefix** to
confirm resolution is **dialect/prefix-agnostic** — not only the default.

### The result: a PROOF, not a remediation

Energy entities resolve by **stable function-slug substring in the object-id**
(`data/energy.ts` `find()` — prefix-independent, `_2`-tolerant), so the ecosystem
cards + Scene are **dialect-agnostic by construction**. The audit found **no
fleet-shaped raw-string leak** in any ecosystem-card / Scene surface (every energy
read routes through `data/energy`; the FlowModel consumes `flow/balance.ts`; the
WC-edge ↔ charging-entity authority split is intact). So AC4 is a **proof that
resolution is prefix-agnostic, not a fix** — honestly recorded as such.

### The proof (synthetic non-default prefix)

`audit-r6-suite.test.ts` re-prefixes every energy object-id away from **both** the
bundled vehicle prefix (`garage_model_y_*`) **and** the fixture's site prefix
(`my_home_*` / `tesla_wall_connector_*`) to a synthetic third install
(`acme_ess_*` / `acme_evse_wall_connector_*`), **preserving** the function-slug each
rule keys on:

| Check | How | Status |
|---|---|---|
| The transform is genuinely non-default (no `garage_model_y_`/`my_home_` left in energy ids) | `audit-r6-suite.test.ts` | ✅ automated |
| Every present power role STILL resolves — by slug substring, not prefix | `audit-r6-suite.test.ts` | ✅ automated (mechanism) |
| The composed Scene renders all five cards + a named bus under the new prefix | `audit-r6-suite.test.ts` + E2E `audit-r6-suite.spec.ts` | ✅ automated |
| Each ecosystem card renders standalone under the new prefix (value shown, no NaN) | `audit-r6-suite.test.ts` | ✅ automated |
| `computeBalance().net` is IDENTICAL across prefixes (resolution changed, physics didn't) | `audit-r6-suite.test.ts` | ✅ automated |
| An absent node under the new prefix still degrades gracefully (6.7 holds across dialects) | `audit-r6-suite.test.ts` | ✅ automated |
| Re-prefixed Scene renders at runtime with zero console errors | E2E `audit-r6-suite.spec.ts` | ✅ automated |

### HONESTY: the non-default prefix is SYNTHETIC / ASSUMED

We hold **no captured second-install corpus**. The `acme_*` prefix is a synthetic
derivation of the awake fixture; the tests assert the **mechanism** (slug-substring
resolution is prefix-independent), **never** that any invented spelling is ground
truth. This mirrors the `dialect.ts` ASSUMPTION framing (the 5.11 honesty rule).

### Known residue (cross-referenced, not re-litigated)

The `wc_status` rule keys on the literal `wall_connector` substring (a non-
`wall_connector`-named EVSE status sensor would not resolve) — but `wc_status` is
energy-panel **metadata, not a power role**, and degrades gracefully (absent ⇒ calm).
The 5.11 vehicle-card audit records the charging-state dialect residue (`hero.ts` /
`panel-charging.ts` consume the **default** `normalizeChargingState`); that is the
vehicle-card layer's residue, unchanged here — see `docs/audit-r6-vehicle-card.md`.

---

## AC5 — documented graceful-degradation ladder (budget missed on the reference device)

A missed composed-budget **degrades motion; it is NOT a recourse-less release
blocker** (the AC's explicit framing). The ordered, cheap policy — applied when the
AC3 profiler measurement misses ~60fps on the reference device. At **every** rung the
data stays (arrowheads + kW labels survive):

1. **Reduce bus-animation density** — fewer simultaneously-animated edges / a longer
   dash period. The static read (arrowheads + kW ribbon) is unchanged.
2. **Cap simultaneously-animated edges** — clamp the **shared** `edgeVisual` output
   (`flow/renderer.ts:57`; the cap seam is noted at `my-home.ts:155`). **Clamp the
   shared output — never fork the kW→visual formula** (R1: one model, one renderer
   math). A capped edge keeps its arrowhead + kW chip; only the animation density drops.
3. **Freeze the weather vignette first** — it already freezes via the reduced-motion
   path (`weather-vignette.ts:464–475`), the **lowest-cost** rung: reuse it (force the
   vignette into its `animation:none` state) while the bus still animates.

**Wiring status:** no rung is wired this session — there is **no measurement** to
trigger one (physical hardware only). The deliverable is the **documented policy +
the reuse hooks** (the vignette-freeze path + the `edgeVisual` clamp seam already
exist). Any actual cap wiring is **follow-up**, to be driven by a real profiler miss.

---

## Cross-cutting DoD (verified by this checkpoint)

- **Suite invariant — composed-view authority split (AR-6 / R2):** the discrete
  charging entity owns the Hero halo (`normalizeChargingState`); the FlowModel owns
  the Wall-Connector edge magnitude/direction (the WC edge **is** the car-charging
  edge — no 6th vehicle node). `audit-r6-suite.test.ts` asserts they **agree** on the
  awake fixture (car `Charging` ⇒ an active wall_connector edge) — a mismatch is a
  defect. No Scene surface re-derives charge state with a private sign convention.
- **One model serves both renderers (R1):** `SceneBusRenderer` and `HeroSvgRenderer`
  derive edge visuals from the **shared** `edgeVisual`/`edgeVisuals` — proven by the
  deep-equal parity test (`flow/scene-bus.test.ts`, against `fixtures/scene-stub-rects.json`).
  The audit introduces no fork; the AC5 cap clamps the shared output.
- **Arbitrary-topology composed:** the minimal→full sweep + the packed grid + the
  breakpoint-driven bus axis hold composed (`my-home-scene.spec.ts` 6.7 + `my-home.test.ts`).
- **Data boundary (AR-1):** `hass.states` read only inside `src/data/`; `data/ ← flow/ ←
  components/` acyclic. `no-bare-hass.states` + `no-cycle` gates green.
- **Trade-dress (AR-12):** the non-default-prefix fixture is **synthetic data**
  (object-ids/states only — no art, no brand hex/wordmark). A functional fixture-driven
  test needs no `CONTENT_SKIP`; `trade-dress` gate green.
- **No new strings / logging literals; token fallbacks intact** (`styles.test.ts`,
  `strings.test.ts` green); no second 180° elevation gradient; **no `CARD_VERSION`
  bump** (stays `0.1.0`); `dist/` uncommitted.

## Pre-existing findings (flagged, NOT introduced by Story 6.8)

An R6 audit reports what it finds. The 5.11 vehicle-card audit records the
`feat/epic-4-live-energy-flow` branch's pre-existing red E2E specs (`hero.spec.ts`
image-mode, `commands.spec.ts` asleep wake-hint) — those are the vehicle-card layer's
findings, unchanged here; see `docs/audit-r6-vehicle-card.md`. This checkpoint adds
no new red; the suite-audit Vitest + E2E specs are green.

---
---

# R6 — Epic-8 DEPTH audit (Story 8.8)

> **What this is.** Story 8.8 is the depth-level R6 checkpoint that **closes Epic 8**.
> 6.8 (above) swept the suite at **MVP depth**; 8.8 extends that SAME pass to **only
> the richness Epic 8 added** — the six ecosystem cards now carrying detail shells +
> stat grids + per-node hero art + inline history charts + the Powerwall control
> surface, the Vehicle node in the Scene, the enriched Gateway bus, and the
> self-powered ribbon — layered over the already-passing 6.8 audit. It is the peer of
> 6.8 (suite) and `docs/audit-r6-vehicle-card.md` (5.11, vehicle card) **one level
> deeper**. It does **not** fork a parallel artifact — it extends this one, the
> `audit-r6-suite.test.ts` jsdom harness, and the `audit-r6-suite.spec.ts` E2E harness.
>
> Same honesty discipline: evaluative items route to **[HUMAN]**; the heavier
> ~60fps budget is a **[PROFILER]** task on physical kiosk hardware. Where a surface
> needed no remediation it is recorded as a **proof, not a fix**. One concrete
> cross-cutting defect WAS found and fixed (see AC2) — an R6 audit reports what it
> finds, and a fabricated fix is the dishonesty this checkpoint exists to prevent.

**Scope reality:** an audit-and-document checkpoint, NOT a feature build. No new card,
panel, flow node, control, chart, config field, or engine edit. The artifacts are the
extended suite-audit tests + this section + one surgical token remediation.

**Merge baseline.** All of Epic 8 (8.1–8.7) is merged before this pass — confirmed at
HEAD: 8.1 `1f4d987` → 8.2 `570914f` → 8.3 `d8132df` → 8.4 `07c9397` → 8.5 `fed8e77`
→ 8.6 `4c5c9f6` (enriched bus) → 8.7 `1ded860` (ribbon). **No AC item lacked a new
source; nothing was deferred.** The DAG `8.8 → all of Epic 8 + the Epic-6 Scene` holds.

## NEW surface enumeration (the Epic-8 depth the audit owns)

The composed whole = the **6.8-audited MVP suite** *plus*:

| Story | NEW surface | Files |
|---|---|---|
| 8.1 | detail shells + stat grids + **deep-link chip** | `components/ecosystem-card.ts` (`_deepLinkChip`/`_openEnergy`/`_onDeepLinkKey`, `.eco-deeplink`) |
| 8.2 | **per-node hero art** (`nhPulse` WC-dot) | `components/node-hero.ts` |
| 8.3 | **inline history charts** (`chartIn` draw-on) + on-demand recorder fetch | `components/chart.ts`, `data/history.ts` |
| 8.4 | **Powerwall controls** (segmented op-mode `.seg` + backup-reserve `tc-slider`) | `components/powerwall.ts`, `components/slider.ts` |
| 8.5 | **Vehicle cell** in the Scene + the WC→Vehicle edge | `components/my-home.ts`, `flow/my-home.ts` (`wcVehicleEdge`/`VEHICLE_NODE_ID`) |
| 8.6 | **enriched Gateway bus** (kW pills · terminals · focus-highlight) | `components/my-home.ts` (`_pill`/`_terminal`/`_legs`), `flow/my-home.ts` |
| 8.7 | **self-powered % ribbon** + per-node tiles | `components/my-home.ts` (`_ribbon`), `flow/my-home.ts` (`selfPowered`/`ribbonTiles`) |

Frozen / read-only (confirmed un-touched): `flow/{model,balance,binding,renderer,hero-svg,scene-bus}.ts`, `data/{registry,resolve,dialect,energy,freshness}.ts`.

---

## AC1 — cross-control keyboard + reduced-motion sweep across the NEW surfaces

### Reduced-motion: the NEW Epic-8 animation inventory → behaviour → gate

Rule unchanged: **kill the motion, keep the data.** Every NEW source below was
**already `prefers-reduced-motion`-gated by its own story** — the AC1 gap 8.8 closes is
the **composed sweep** (no test drove `reduced-motion` over *all the new sources at
once*) and the **cross-control keyboard traversal** *through* the new controls.

| Surface | Animation | Reduced-motion | Gated in | Asserted (composed, NEW) |
|---|---|---|---|---|
| Per-node hero art | `.nh-wc-dot` `nhPulse` pulse | `animation: none`; the dot stays visible | `node-hero.ts` `@media` (L271–278) | `audit-r6-suite.test.ts` (stylesheet) + `.spec.ts` (runtime, composed) |
| Inline charts | `.spark`/`.bars` `chartIn` fade-in | `animation: none`; the final static curve renders | `chart.ts` `@media` (L260–266) | `audit-r6-suite.test.ts` + `.spec.ts` (composed) |
| Powerwall controls | `.seg` `transition: background/color` | `transition: none` (instant) | `powerwall.ts` `@media` (L456–460) | `audit-r6-suite.test.ts` + `.spec.ts` (composed) |
| Gateway bus (enriched) | `.sb-flow` dash (`sb-flow-dash`) | `animation: none`; arrowheads + kW pills survive | `scene-bus.ts` `@media` (L353–358) | `audit-r6-suite.spec.ts` (composed) |
| Bus focus-highlight | `.scene.focus` cell/`.gw-leg` opacity **transition** | `transition: none` (instant cut) | `my-home.ts` `@media` (L1211–1214) | `audit-r6-suite.test.ts` + `.spec.ts` (6.8 + depth) |
| **8.6 bus pills / terminals / taps** | — (**deliberately STATIC SVG**) | n/a — already the static "keep the data" read | `my-home.ts` L1181 (no keyframe by design) | proof: nothing to gate (recorded, not fixed) |

**Finding:** like 6.8 (and unlike 5.11's Flow-overlay dash), the Epic-8 depth had
**no uncovered animation** — every NEW source was already gated by its own story, and
the 8.6 enriched-bus decorations are static by design. 8.8 adds the **composed
machined inventory** (`audit-r6-suite.test.ts` — every NEW source's stylesheet carries
its `prefers-reduced-motion` kill) **and** the **composed runtime sweep**
(`audit-r6-suite.spec.ts` — hero art + charts + the segmented control freeze
*together* in one deepened Scene render while the dot/curve/labels survive). ✅ automated.

### Keyboard navigation / focus order across the NEW controls

| Check | How | Status |
|---|---|---|
| Tab reaches the deep-link chip, Powerwall segmented control, backup-reserve slider AND the scene cells in the composed Scene | E2E `audit-r6-suite.spec.ts` (composed walk) | ✅ automated |
| The shared-outline controls (deep-link / seg / scene-cell) paint the 2px `--tc-blue` `:focus-visible` ring on keyboard focus | E2E `audit-r6-suite.spec.ts` | ✅ automated |
| Every new affordance clears the ≥44×44 tap-target floor (incl. the 46px slider track) | E2E `audit-r6-suite.spec.ts` | ✅ automated |
| Focus is NOT trapped — it leaves the control/cell set after the last | E2E `audit-r6-suite.spec.ts` (escape proof) | ✅ automated |
| Per-control a11y in isolation (seg `aria-pressed`-settled; slider commit-on-release; deep-link Enter/Space; ring) | `powerwall-controls.spec.ts` / `a11y-interaction.spec.ts` / `node-hero.spec.ts` / `inline-charts.spec.ts` | ✅ automated (per-story) |
| **"Focus order through the new controls reads naturally; no surprising jumps"** | manual sweep vs EXPERIENCE.md | **[HUMAN]** |
| **"The deepened Scene reads at a glance with motion off; charts read calmly static"** | manual sweep vs DESIGN.md/EXPERIENCE.md | **[HUMAN]** |

The slider's focus affordance is its thumb/track (commit-on-release, UX-DR8), not the
shared outline recipe — its keyboard a11y is pinned in `powerwall-controls.spec.ts` +
`a11y-interaction.spec.ts`; the depth sweep asserts its reachability + ≥44px track.

---

## AC2 — freshness honesty across the NEW surfaces

| Surface | Mechanism | Honest read | Pinned |
|---|---|---|---|
| Inline charts | **structural calm-empty** | short/absent/all-NaN history ⇒ the muted empty caption, **never a fabricated flat line / zero bars**; a genuinely-fetched zero is real | `chart.test.ts`, `history.test.ts` (helper) + per-card suites/`inline-charts.spec.ts` (standalone) + **`audit-r6-suite.test.ts` (COMPOSED-Scene: an empty recorder ⇒ `.ct-empty` inside the embedded cards, NO `svg.spark`/`.bcol` anywhere, fetch stays id-gated composed, NEW)** |
| Self-powered % lead | **structural `—`** | no/sub-deadband live load ⇒ `selfPowered.pct === undefined` ⇒ the lead reads `—`, **never a divide-by-zero `0%`/`100%`** | `flow/my-home.test.ts` (math) + **`audit-r6-suite.test.ts` (composed render `.rib-big` = `—`, NEW)** |
| Ribbon (quiescent) | **`.dim` + stamped** | fully-quiescent Scene ⇒ `.dim` + a last-known "updated Nm ago" stamp (`referenceNow`/`formatAgeHint`, never `Date.now()`) | `my-home.test.ts` + `audit-r6-suite.test.ts` (composed, NEW) |
| Stat-grid tiles | **hide-when-missing + stamped** | absent ⇒ hidden (no fabricated `0`); stale ⇒ last-known + `.tc-stale-copy` stamp | per-card suites |
| Vehicle cell (asleep) | **last-known (compact) + stamp** | asleep ⇒ calm asleep word + stamp; the **compact** embed shows last-known SoC/range via the stale dim (real cached sensor: `usable_battery_level` / `estimate_battery_range`), `—` when absent; full card stays `—`; **never a false "Charging"** | `my-home.test.ts` (8.5 AC3) + `hero.test.ts` (compact last-known, Story 8.11) |

Staleness copy uses `--tc-text-dim` (the freshness-honest 4.5:1 tone), **never**
`--tc-text-mute`. A new composed pin (`audit-r6-suite.test.ts`) enforces this on the
NEW surfaces.

### Concrete defect found + fixed (a fix, not a fabrication)

The depth review surfaced **one** genuine cross-cutting honesty defect the per-story
ACs missed in isolation: **`.ribbon-age`** — the Gateway-ribbon "updated Nm ago"
staleness stamp (`my-home.ts`) — rendered at **`var(--tc-text-mute, #64748b)`**, the
lowest-contrast tone the DoD honesty rule (UX-DR18) **explicitly forbids for staleness
copy** ("`--tc-text-dim`, never `--tc-text-mute`"). Every peer stamp (`.veh-age`,
`.eco-stamp` via `.tc-stale-copy`) already used `--tc-text-dim`; `.ribbon-age` was the
lone outlier — a freshness *disclosure* rendered as if it were a decorative caption.
The bare-`var(--tc-*)` gate did not catch it (it checks a fallback EXISTS, not that the
*right* token is used — the Epic-6 gate-blind-spot lesson), so only a depth review
could. **Remediation:** one token change (`--tc-text-mute` → `--tc-text-dim`),
behavior-preserving (visual legibility only), aligning the code to the contract the
6.8 audit's own prose already claimed. Pinned by `audit-r6-suite.test.ts` so it cannot
regress. ✅ fixed + pinned.

---

## AC3 — the HEAVIER composed ~60fps budget ([PROFILER] residue — NOT a CI assertion)

Unchanged in kind from 6.8 (epics.md:398: a named reference device, the browser
performance profiler, a ~10s steady-state read — **not** a Vitest assertion), but the
Scene is now **heavier**: **6 *detail* cards + inline charts + per-node hero art + the
enriched Gateway bus + the weather vignette** simultaneously visible/animating (vs.
6.8's MVP cards + bus + vignette).

### The enabling precondition (machined) holds at the new depth

The no-thrash architecture is unchanged and re-confirmed: geometry runs on **rAF over
cached anchors** decoupled from the `hass`-tick (`RafCoalescer` + `ResizeObserver`), so
a live tick re-renders values but does NOT thrash layout; the **chart fetch is
gated/cached** (id-keyed — `_lastChartKey`; an unrelated tick does not refire
`fetchCardHistory`, pinned in `powerwall.test.ts`/`inline-charts.spec.ts`); the chart
**render is static SVG** (no rAF). So the depth added telemetry surfaces (charts, hero
art) **without** adding a per-tick layout/fetch cost.

| Check | How | Status |
|---|---|---|
| An unrelated `hass` tick does NOT recompute geometry | `my-home.test.ts` | ✅ automated |
| The chart fetch is id-gated/cached — same resolved ids ⇒ no refire | `powerwall.test.ts`, `inline-charts.spec.ts` | ✅ automated |
| The chart render is static SVG (the `chartIn` is content-free, frozen under reduced-motion) | `chart.test.ts` + `audit-r6-suite.*` | ✅ automated |

### The profiler procedure (for the human to run) — [PROFILER]

1. **Device:** the NFR-1 reference device — the low-end tablet-kiosk class.
2. **Build + serve the DEEPENED Scene:** `npm run build`, serve `demo/`, open the full
   six-*detail*-card Scene (each with hero art + stat grid + inline charts) + the
   enriched Gateway bus + the weather vignette, composed with the live vehicle cell —
   the awake/charging + energy-site scenario, weather injected so the vignette animates
   and history present so the charts draw. Confirm all are simultaneously visible/animating.
3. **Capture:** profiler, **~10s steady-state** (no interaction), read the sustained FPS.
4. **Pass bar:** **~60fps sustained** over the 10s window (first-paint dips are not the target).
5. **On a miss:** apply the extended degradation ladder below — a missed budget
   **degrades motion, it is NOT a release blocker**.

**Status: ✅ PASS (2026-06-21).** The measured `?card=my-home` Scene at HEAD **IS** the
Epic-8-**deepened** composition — detail cards with stat grids + per-node hero art + the
segmented Powerwall control + backup-reserve slider + deep-link chips, the enriched
kW-pill Gateway bus, the self-powered ribbon, and the live Model Y vehicle cell (all
visible in the captured screenshot) — so the single recorded measurement in **6.8 § AC3 →
The recorded measurement** satisfies **both** AC3s: **120.0 fps** sustained, **0
dropped/jank** frames, every frame within the 60fps budget, held under a **validated 6×
CPU throttle**. The same HONEST caveats apply (dev workstation, **not** the physical
kiosk; CPU-throttle emulates CPU, not GPU/raster). One depth-specific note: the inline
history charts were in their **calm-empty** state (the demo mock hass carries no recorder
history), so the one-shot `chartIn` draw-on — a transient, not a steady-state loop — was
not part of the resting animated load (the chart render is static SVG regardless). **No
AC5 rung needed.**

---

## AC5 — the EXTENDED graceful-degradation ladder (heavier Scene)

The AC3 wording adds **"freeze charts/vignette first"** to the 6.8 ladder. Ordered,
cheap, motion-only; at **every** rung the data stays (arrowheads + kW pills + the
chart's final curve survive):

1. **Reduce bus-animation density** — fewer simultaneously-animated edges / longer dash
   period. The static read (arrowheads + kW pills) is unchanged.
2. **Cap simultaneously-animated edges** — clamp the **shared** `edgeVisual` output
   (`flow/renderer.ts`; the `BUS_WIDTH_MAX` ceiling in `flow/my-home.ts` is the existing
   precedent for clamping the shared output). **Clamp the shared output — never fork the
   kW→visual formula** (R1). A capped edge keeps its arrowhead + kW pill.
3. **Freeze the charts + the weather vignette first** — the **lowest-cost** rung: both
   already freeze via the reduced-motion path (`chart.ts` `chartIn`,
   `weather-vignette.ts` `wx-*`). Force them into their `animation:none` state while the
   bus still animates. A frozen chart still shows its final static curve; a frozen sky
   still shows the condition art.

**Wiring status:** no rung is wired this session — there is **no measurement** to
trigger one (physical hardware only). The deliverable is the **documented policy + the
reuse hooks** (the chart/vignette freeze paths + the `edgeVisual`/`BUS_WIDTH_MAX` clamp
seam already exist). Any actual cap wiring is **follow-up**, driven by a real profiler miss.

---

## Depth-level invariants (the composed authority the deepened view introduces)

- **Vehicle cell ↔ WC-edge agreement (8.5).** The in-Scene vehicle cell's charge read
  and the Scene's Wall-Connector → Vehicle edge both derive from the ONE `wcVehicleEdge()`
  view (FlowModel-owned). The WC edge **is** the car-charging edge: **no 6th vehicle flow
  node, no second sign convention**. Pinned: the numeric "Charging · N.N kW" = `|wcVehicleEdge.kW|`
  in `my-home.test.ts` (8.5 AC2); the **structural** invariant (the bound model carries no
  `vehicle` node; `ENERGY_ROLES` is exactly five; `wcVehicleEdge` active when charging) in
  **`audit-r6-suite.test.ts` (NEW)**. The frozen engine has **zero Epic-8 diff** (verified:
  `git diff c3503a0..HEAD -- src/flow/{model,balance,binding,renderer,hero-svg,scene-bus}.ts`
  is empty).
- **Bus / ribbon / cell agree by construction (8.7).** The self-powered %, the per-node
  tiles, and the bus segments all read the **same** `computeBalance(model).net` (computed
  once per `_ribbon` render, threaded). No second balance, no re-signed net. Pinned in
  `flow/my-home.test.ts` + the composed `.rib-big` honesty pin.
- **One model serves both renderers (R1).** `SceneBusRenderer` derives edge visuals from
  the **shared** `edgeVisual`/`edgeVisuals` (`flow/renderer.ts`); the vehicle edge reuses
  the unforked helper; any degradation cap clamps the shared output, never re-implements it.

---

## Cross-cutting DoD (deltas verified by this depth checkpoint)

- **Graceful degradation / NaN-safety:** the deepened suite renders calm against 0-data,
  asleep, short/empty-history, and the non-default `acme_*` dialect — no throw, blank, or
  false state / NaN (`audit-r6-suite.test.ts` composed degradation sweep, unchanged + the
  chart/ribbon honesty pins). Absent control entities ⇒ Powerwall stays a read-only Sensor;
  absent history ⇒ calm empty chart; absent vehicle ⇒ omitted cell + edge.
- **Data boundary (AR-1):** `hass.states` only inside `src/data/`; the on-demand history
  fetch (`data/history.ts`) rides `callWS` (NOT `hass.states`, sanctioned by
  `no-network-egress`) and is id-gated/cached (never background-polled, UX-DR23).
  `data/ ← flow/ ← components/` acyclic. `no-bare-hass.states` + `no-cycle` green.
- **Trade-dress (AR-12):** the hero art is hand-rolled token SVG; the non-default fixture
  is synthetic data (ids/states only). The added audit tests are **functional fixture-driven**
  (no define-to-assert-absence file) ⇒ **no `CONTENT_SKIP` entry needed**; `trade-dress` green.
- **Token fallbacks on REAL tokens; no second 180° gradient** (`styles.test.ts` green —
  the `.ribbon-age` fix uses the real `--tc-text-dim` token). No new strings/logging literals.
- **Registration contract unchanged — 7 elements** (`node-hero.ts`/`chart.ts` register
  nothing); `tesla-card.contract.test.ts` green.
- **No `CARD_VERSION` bump** — `0.2.0` synced across `package.json`/`const.ts`/`hacs.json`
  (`version-sync` 6th gate green); **`dist/` uncommitted** (CI-built).

## Pre-existing findings (flagged, NOT introduced by Story 8.8)

The 5.11 vehicle-card layer's pre-existing red E2E specs are unchanged (see
`docs/audit-r6-vehicle-card.md`). This depth checkpoint adds **no new red**: the
extended `audit-r6-suite.test.ts` (jsdom) + `audit-r6-suite.spec.ts` (Playwright) are
green, all per-story suites stay green (behavior-preserving), and the single remediation
(`.ribbon-age` tone) is pinned. The evaluative AC1/AC2 residue is **[HUMAN]**; the
heavier ~60fps budget is **[PROFILER]** — neither is claimed as automated.
