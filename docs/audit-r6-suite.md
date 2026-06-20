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
target, **not** a Vitest assertion or a synthetic microbenchmark. It **cannot** be
claimed green from CI or this session (no physical kiosk hardware). Claiming AC3
"green, automated" would be the same dishonesty this checkpoint catches in the
product.

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
2. **Build + serve the composed Scene:** `npm run build`, then serve `demo/` and open
   the full six-card + Gateway bus + weather-vignette Scene composed with the live
   vehicle card (`demo/index.html` — the awake/charging scenario with an energy site,
   weather injected so the vignette animates). Confirm all six live cards + the bus +
   the vignette are simultaneously visible and animating.
3. **Capture:** open the browser performance profiler, record a **~10s steady-state**
   (no interaction — the resting animated Scene), stop, read the sustained frame rate.
4. **Pass bar:** **~60fps sustained** over the 10s window (transient dips on first
   paint are not the target; the steady state is).
5. **On a miss:** apply the AC5 degradation ladder below — a missed budget **degrades
   motion, it is NOT a release blocker**.

**Status: [PROFILER] — not measured this session (no hardware). The procedure +
pass bar are recorded here for the human to run.**

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
