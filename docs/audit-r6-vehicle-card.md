# R6 — Vehicle-card integration audit checkpoint

> **What this is.** The Definition of Done mandates a *named cross-component pass*
> at the end of Epic 5 (vehicle card complete): keyboard navigation / focus order
> **across** panels & controls, a reduced-motion **sweep** over all animations, a
> freshness-honesty **review** of every surface, and the whole card exercised
> against the **costly `tesla_custom` dialect**. This document is the standing R6
> checklist + the durable record of the Story 5.11 pass. It is **honest about its
> own coverage**: evaluative items the architecture routes to *human review*
> (architecture / epics "Verification modes") are marked **[HUMAN]** and must be
> signed off by a person against the UX spine (DESIGN.md / EXPERIENCE.md) — they
> are NOT claimed as automated.

Scope reality: Story 5.11 is an **audit-and-remediate checkpoint**, not a feature
build. No new panel, control, or config field. The only code change is closing the
`tesla_custom` dialect leak (AC4) — routing the inline `=== 'open'` / `'locked'`
status reads through the existing `data/dialect` normalizers — plus the audit
fixture, tests, and this artifact.

---

## Surface enumeration (the audit is exhaustive, not sampled)

Complete card = shell + Hero + quick-actions + commands + **seven
panels** (charging, climate, closures, tyres, location, media, energy). *(The Hero
**Flow overlay** this report originally audited was removed in Story 12.1; flow viz
now lives on the Scene bus + Energy panel only.)*

| Layer | Files |
|---|---|
| Shell / tabs | `src/tesla-card.ts` (panel-switch; the single `detectDialect` call) |
| Hero / car | `src/components/{hero,car,quick-actions,commands,slider}.ts` |
| Panels | `src/components/panel-{charging,climate,closures,tyres,location,media,energy}.ts` |
| Flow viz (Hero overlay `hero-svg.ts` removed in 12.1; now Scene bus + Energy panel) | `src/flow/{scene-bus,renderer,binding,model,balance}.ts` |
| Data boundary | `src/data/{dialect,freshness,wake,resolve,registry,energy,degradation}.ts` |
| Shared | `src/{styles,ui,helpers,strings,const}.ts` |

---

## AC1 — keyboard navigation / focus order across panels & controls

**Mechanism (UX-DR21):** focus order = reading order; 2px `--tc-blue` ring on
keyboard focus (mouse-silent); ≥44×44 tap targets; SVG zones Enter/Space; the
battery row is a real `<button>`; staleness copy in `--tc-text-dim`.

**Cross-panel traversal map (reading order):** tab bar (pill buttons) → active
panel content → quick-actions row → commands column. The shell renders **one panel
at a time** — inactive panels are **absent from the DOM**, so they expose zero
tabbable content (no cross-panel focus trap, no hidden tabbable hosts).

| Check | How | Status |
|---|---|---|
| Tab order across the tab strip = reading order | E2E `audit-r6.spec.ts` (`Tab visits the tabs in reading order`) | ✅ automated |
| Inactive panels expose no tabbable DOM (one panel mounted; tab-switch swaps, never stacks) | Vitest `audit-r6.test.ts` (`shell renders one panel at a time`) | ✅ automated |
| Focus continues PAST the tab strip into operable content, 2px blue ring intact | E2E `audit-r6.spec.ts` (`keyboard focus continues PAST the tab strip`) | ✅ automated |
| Per-panel focus ring + ≥44px + slider commit (in isolation) | existing `a11y-interaction.spec.ts` | ✅ automated (prior) |
| **"Focus order reads naturally; no surprising jumps" across every panel** | manual sweep against EXPERIENCE.md | **[HUMAN]** |

---

## AC2 — reduced-motion sweep over ALL animations

Rule: **kill the motion, keep the data.** Every animation degrades to a static,
legible read; no animation may *vanish* its data cue.

### Animation inventory → reduced-motion behaviour → gate

| Surface | Animation | Reduced-motion | Gated in | Asserted |
|---|---|---|---|---|
| Shared corpus | `tc-pulse`, `tc-shimmer` | `animation: none` | `styles.ts` `sharedStyles` `@media` | `a11y-interaction.spec.ts` (shimmer halt) |
| Battery gauge | width `transition` | snaps (`transition: none → 0s`) | `sharedStyles` | `a11y-interaction.spec.ts` (gauge snap) |
| Hero charge halo | pulsing green halo | **static green glow** (not removed) | `carStyles` | `hero.spec.ts` L249-281 |
| Hero plugged-idle | blue port glow | static blue (intact) | `carStyles` | `hero.spec.ts` L269 |
| Hero apertures | opacity **crossfade** | **instant cut** (`transition: none`) | `carStyles` | (covered by carStyles guard) |
| **Flow overlay edges** *(Hero overlay removed in Story 12.1)* | `fo-flow-dash` stroke-dashoffset | (at audit time) `animation: none` + `stroke-dasharray: none`; arrowheads + kW chips survive | `flow/hero-svg.ts` `@media` L352-360 (file since removed) | **`audit-r6.spec.ts` (NEW — the prior gap)** |
| Asleep wake-hint | presence change (no keyframe) | instant by construction | n/a | `commands.spec.ts` L169-180 |

**The AC2 gap this checkpoint closed** (for the Hero Flow overlay later removed in
Story 12.1): the live-energy Flow overlay dash had no reduced-motion assertion.
`audit-r6.spec.ts` pinned both halves — the dash animated by default and
`animation: none` under `prefers-reduced-motion`, while `.fo-head` (arrowheads) and
`.fo-chip-val` (kW magnitude) remained (colour-blind-safe static read).

---

## AC3 — freshness-honesty review (no surface overstates freshness)

The one unforgivable copy error is a label that overstates freshness — a confident
"closed" / "playing" / "locked" on a stale, asleep, or `unavailable` read. Each
surface stays honest by one of three mechanisms:

| Surface | Mechanism | Honest read |
|---|---|---|
| Closures | **stamped last-known + `unknown` neutral** | `_closure` → `unknown` when `!available` (never a false "closed"); "All closed" GREEN reserved for fresh+locked+all-confirmed; any stale/unknown degrades tone to dim + "updated Nm ago" stamp |
| Location | **stamped last-known** | last-known coords + "updated Nm ago"; never presented as live |
| Media | **structural** | `media_player: 'off'` → calm empty state, never "playing" |
| Charging / tyres | **hidden / dimmed** | absent/unavailable → tile hides or dims, never a fabricated value/`NaN` |
| Hero status | **stamped** | "Asleep · updated 47m ago"; falls back to wake affordance, never a fabricated time |

Staleness copy uses `--tc-text-dim` (the freshness-honest tone), **never**
`--tc-text-mute`. The freshness read-model is `data/freshness.ts`
(`readKey`/`readRaw`, the `fresh`/`stale`/`asleep`/`unavailable` triple) — the sole
`hass.states` reader, measuring age against HA's **own** time base (`referenceNow`,
the max server stamp), never `Date.now()`.

| Check | How | Status |
|---|---|---|
| Whole card renders on asleep / 0-data / tesla_custom — no throw, no blank, no `NaN`, no false state | Vitest `audit-r6.test.ts` (sweep all panels) | ✅ automated |
| Closures NEVER paints confident green "All closed" on an asleep car | Vitest + E2E `audit-r6` | ✅ automated |
| Per-panel freshness/empty states (closures `unknown`, media `off`, location last-known, tyres no-data) | existing per-panel suites | ✅ automated (prior) |
| **"Staleness everywhere reads calm, not broken; nothing overstates"** whole-card | manual sweep against EXPERIENCE.md | **[HUMAN]** |

---

## AC4 — `tesla_custom` dialect pass (the real build)

Every Epic-5 vertical was built against the auto-detected default dialect
(`tesla_fleet`). AC4 exercises the complete card against the **costly distinct
dialect** (`tesla_custom`) to confirm no fleet-shaped assumption leaked into the UI.

### The leak the audit found, and the remediation

`data/dialect.ts` was consumed for **charging** (`hero.ts`, `panel-charging.ts`) and
**energy roles** (`flow/binding.ts`), but **closures / quick-actions / hero-apertures
/ charge-port / lock** still read **raw inline strings** (`=== 'open'` / `'locked'`)
— fleet-shaped assumptions bypassing the dialect seam. Story 5.11 routes those reads
through the existing `normalizeCoverState` / `normalizeLockState` normalizers:

| File | Read | Now routed through |
|---|---|---|
| `panel-closures.ts` | `_closure` cover/door, `_open`, lock pill (3×) | `normalizeCoverState` / `normalizeLockState` |
| `quick-actions.ts` | lock `=== 'locked'`; charge_port/frunk/trunk `=== 'open'` | `normalizeLockState` / `normalizeCoverState` |
| `hero.ts` | apertures frunk/liftgate/window `=== 'open'`; lock `=== 'locked'` | `normalizeCoverState` / `normalizeLockState` |
| `panel-charging.ts` | charge-port `=== 'open'` | `normalizeCoverState` |

**Behaviour-preserving for `tesla_fleet`:** the default `COVER_MAP` / `LOCK_MAP` are
identity for the fleet spellings (`open`/`closed`/`on`/`off`/`locked`/`unlocked`), so
every existing test stays green (686 Vitest total, incl. all per-panel suites + the
14 new `audit-r6` tests). Closing the leak is **data-only future-proofing**: a future
captured `tesla_custom` corpus becomes a `DIALECTS`-table edit, not a component edit
(the D2 quarantine intent).

**Deliberately NOT routed (dialect-invariant binary reads).** A handful of reads stay
on a bare `=== 'on'`/`'off'` (or `isOn`) by design — they are HA-platform-canonical
binary states, not Tesla-fleet-dialect spellings, so there is no per-dialect map to
consult: the Hero/closures **door** sensors (`isOn`), `quick-actions` **sentry**
(`=== 'on'`), `panel-energy` **wall-connector connected** (`=== 'on'`), and
`panel-media` **off/idle**. Routing these would add noise without changing any
behaviour (the story's conservatism rule: document, don't blindly route).

### HONESTY: the `tesla_custom` corpus is SYNTHETIC / ASSUMED

We hold **no captured `tesla_custom` install**. `src/fixtures/model-y-tesla-custom.json`
is derived from the `tesla_fleet` awake corpus by (a) attaching a `platform:
'tesla_custom'` registry so `detectDialect` probes it, and (b) rewriting the
charging-status read to the assumed override spelling (`charge_complete`). The exact
spellings are the **`dialect.ts` ASSUMPTION set** (`TESLA_CUSTOM_ALIASES` /
`TESLA_CUSTOM_CHARGING`, dialect.ts L303-327), pinned in the fixture's
`provenance.assumption_notice`. The tests assert the **mechanism is applied**
(platform-driven detection + alias/override consulted) — **never** that these
literals are ground truth. Fill in DATA-ONLY when a real corpus lands.

| Check | How | Status |
|---|---|---|
| `detectDialect` probes `tesla_custom` from the registry; `config.integration` override path | Vitest `audit-r6.test.ts` | ✅ automated |
| Adapter applies alias map (`charging→charging_status`) + charging override (`charge_complete→complete`) | Vitest `audit-r6.test.ts` | ✅ automated (mechanism, not literals) |
| Cover/lock degrade to the default map (no captured corpus differs yet) | Vitest `audit-r6.test.ts` | ✅ automated |
| Whole card renders under tesla_custom (probe-detected + override-pinned) — no throw / `NaN` / false state | Vitest `audit-r6.test.ts` (sweep all panels) | ✅ automated |
| Closures lock pill reads correctly under tesla_custom (normalizer consulted) | Vitest `audit-r6.test.ts` | ✅ automated |
| Every panel opens under `?env=tesla_custom` with zero console errors | E2E `audit-r6.spec.ts` | ✅ automated |

### Known residue (honest coverage gap)

The Hero charge cue (`hero.ts` `_chargeVisual`) and the charging panel consume the
**default exported** `normalizeChargingState` (the seam pattern they were built on in
Story 3.4 — explicitly out of remediation scope per the story). The default export
does **not** apply the per-dialect charging override, so a `tesla_custom`
`charge_complete` state would degrade to a **neutral, safe** read in the Hero (parked
/ not-the-live-cue) rather than resolving to "plugged". This is a *safe degrade, not
a false state* (it never claims charging when not). Routing those two reads through
`adapterFor(hass, config)` is the data-only follow-up when a real `tesla_custom`
corpus is captured — recorded here so the gap isn't silently claimed as covered.

---

## Cross-cutting DoD (verified by this checkpoint)

- **Data boundary (AR-1):** status reads route through `data/dialect` (a `data/`
  module legitimately imported by components — `hero.ts`/`panel-charging.ts` already
  did). `no-bare-hass.states` + `no-cycle` gates green (120 edges, no cycle).
- **Sign convention (AR-6, R2):** charge direction reads from the discrete charging
  entity via `normalizeChargingState`, never from signed power. No Epic-5 surface
  re-derives charge state from Epic-4's balance.
- **Trade-dress (AR-12):** the `tesla_custom` fixture is synthetic data only (object
  ids / states / attributes) — no art, no brand hex/wordmark. A functional
  fixture-driven test needs no `CONTENT_SKIP`; `trade-dress` gate green.
- **No new strings / logging literals; token fallbacks intact** (`styles.test.ts`,
  `strings.test.ts` green).

## Pre-existing findings (flagged, NOT introduced by Story 5.11)

An R6 audit reports what it finds. The full Playwright E2E suite has **8 pre-existing
red specs** on the `feat/epic-4-live-energy-flow` branch — confirmed red on the clean
baseline (Story 5.11 changes stashed), so they predate this story:

- `hero.spec.ts` image-mode (`:73`, `:132`) assert **0 SVGs** in `.car-stage` under
  `?image=1`, but at audit time Epic-4's Hero-agnostic **Flow overlay** composited an `<svg>`
  over image mode too (by design — CLAUDE.md "composites over all three Epic-3 render
  modes"). The Epic-3 assertion was stale vs Epic-4; the *spec* needed updating, not the
  card. *(The Hero Flow overlay was removed in Story 12.1.)*
- `commands.spec.ts` asleep wake-hint + degrade specs (`:59`, `:148`, `:169`, `:177`,
  `:231`, `:243`) — the asleep `.wake-hint` is not located in the demo asleep scenario.

These are **out of Story 5.11's remediation scope** (audit-and-remediate closes the
*integration-level* gaps; it does not fix unrelated Epic-3/4 spec drift) but are
recorded here as the checkpoint's honest finding. The Vitest suite (686 tests, of
which 14 are the new `audit-r6` cases) and the new `audit-r6` E2E spec are **all
green**.
