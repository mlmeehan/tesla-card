# tesla-card Documentation Index

**Repo:** `tesla-card/` (public, standalone git repo — `github.com/mlmeehan/tesla-card`) · **Last Updated:** 2026-06-24
**Type:** Frontend UI component library — custom Lovelace card (HACS plugin)
**Primary Language:** TypeScript (strict) · **Framework:** Lit 3

> This is the card's own public documentation set. BMAD planning artifacts (PRD, epics, stories, retros)
> live in the sibling **private** `tesla-card-planning/` repo and are gate-blocked from this repo; the
> Home-Assistant config-as-code half moved to a separate `home-assistant` repo after the ~2026-06-20 split.

---

## Overview

`tesla-card` renders a single Tesla (default: "Garage Model Y") as a Tesla-app-style Lovelace card:
a centered living hero with a tab bar over feature panels (charging, climate, closures, tyres,
location, media, and — when an energy site is detected — a live **Energy** flow panel), plus
quick-action toggles and command buttons. The same bundle also ships standalone **ecosystem cards**
(solar / powerwall / grid / home / wall-connector / **generator**) and a composed **"My Home" energy
Scene**. As of **Epic 9** it includes a complete **no-YAML GUI editor** (guided first-run wizard +
normal form) for setup, theming, per-entity overrides, and Scene customization; **Epics 10 & 11**
(post-1.0, off the critical path) add a Scene-aware mode of that editor for `custom:tc-my-home` and
render-polish for the composed Scene + its embedded vehicle cell.

It bundles to a single file consumed by Home Assistant and distributed via HACS, organized as a
`data/ ← flow/ ← components/` layered architecture. Its core design features are **entity resolution by
stable function-name** (works across installs and prefixes without hard-coded IDs) and a **single
energy sign-convention** that drives both the Hero overlay and the Scene bus.

## Quick Reference

- **Tech Stack:** TypeScript `~5.7.3`, Lit `^3.2.1`, `@mdi/js` `^7.4.47`, Rollup `^4.30.1` + terser, Vitest `4.1.8` (exact pin), Playwright `^1.49.1`, Vite `^7`
- **Entry Point:** `src/tesla-card.ts` → `dist/tesla-card.js` (≈ 346–360 KB minified, single inlined file)
- **Architecture Pattern:** single `@customElement('tesla-card')` orchestrating flat `tc-*` children (shadow-DOM component tree); **20 custom elements**, **8** `window.customCards` picker cards; the GUI editor (`tesla-card-editor`, ~2,657 LOC) is lazy-loaded
- **Build:** `npm run build` (Rollup → single inlined ES bundle); dev loop is Vite (`npm run dev`)
- **Gates:** `npm run typecheck` + `npm run test` (Vitest) + `npm run lint` (**8-gate** chain) + `npm run build` + Playwright E2E + the NFR-1 profiler — see [CI Pipeline](./ci.md)
- **Min HA:** `2024.4.0` · **CI runtime:** Node 20 · **Runtime deps:** only `lit` + `@mdi/js`
- **Tests:** Vitest unit suite — **65 files / ~1,578 tests** (+ **24 Playwright e2e specs / ~293 tests**, plus 2 opt-in `@visual` baselines)
- **Version:** `0.2.0` — `CARD_VERSION` in `src/const.ts`, kept in sync with `package.json` + git tag (**CI-enforced** by the `version-sync` lint gate + a `release.yml` tag assertion); held until the 1.0.0 cut

## Generated Documentation

- [Architecture](./architecture.md) — component tree, entity resolution, energy engine (**AR-6**), design tokens, Lovelace contract, build pipeline, **Enhanced Configuration (Epic 9)**, and **Scene-aware editor + render polish (Epics 10–11)**
- [Component & Primitive Inventory](./component-inventory.md) — every `tc-*` element, render helper, `data/`/`flow/` module, `ui.ts` primitive, `--tc-*` token, the 8 accents, and the full config surface
- [Development Guide](./development-guide.md) — commands, demo harness + URL params, adding a component / energy node (the AR-6 pattern), testing, CI, release/version-sync
- [CI Pipeline](./ci.md) — the 3 workflows (validate / test / release), the 8 quality gates, local-parity scripts, the version-sync release-tag assertion, the NFR-1 profiler, troubleshooting
- [Source Tree Analysis](./source-tree-analysis.md) — annotated `src/` and project layout, the layering arrow, where gates/tests live

## Reference & Deep-Dives (hand-curated)

- [Privacy](./privacy.md) — no-network-egress / no-telemetry affirmation, the merge-blocking gate, and the sanctioned HA channel
- [Layer contract (`@unstable`)](./layer-contract.md) — the published body-render contract: named layers/nodes, the 3/4 camera, the 1024×687 anchor, and the one-way-door freeze warning
- [Recolorable body](./recolorable-body.md) — how to bake the four layers the Layer contract composites (bring-your-own render)
- [Asset packs (`@unstable`)](./asset-packs.md) — bring-your-own render + multi-model packs: WebP externalization, HA placement, swapping models by URL, the never-committed boundary
- [Trade dress](./trade-dress.md) — the no-Tesla-trade-dress policy enforced by the `trade-dress-denylist` gate

## Quality Audits & Profiling (snapshots)

- [R6 suite audit](./audit-r6-suite.md) · [R6 vehicle-card audit](./audit-r6-vehicle-card.md) — composed-suite & whole-vehicle-card review snapshots
- [NFR-1 profiler checklist](./profiler-checklist-nfr1.md) — the ~60fps composed-Scene gate procedure

## Existing Project Docs

- [`../README.md`](../README.md) — user-facing: features, install, options table, entity resolution
- [`../PUBLISHING.md`](../PUBLISHING.md) — HACS extraction + release / version-sync checklist

## Getting Started

```bash
cd tesla-card
npm ci
npm run typecheck   # strict type-check (must pass)
npm run build       # emits dist/tesla-card.js (must succeed)
npm run dev         # Vite dev server, or open demo/index.html in a browser (no HA needed)
# try ?scenario=asleep / ?env=renamed / ?panel=charging / ?card=my-home / ?editor=1
```

## For AI-Assisted Development

When extending the card, **read [`architecture.md`](./architecture.md) first**, then keep these
invariants (full list in architecture §12):

- **No hard-coded Tesla entity IDs** — resolve by stable function-name via `config.entities[key]`.
- **`useDefineForClassFields: false`** is load-bearing for Lit — never "fix" it.
- **Use `var(--tc-…)` tokens with a fallback, and the token must be real** (two gates: fallback-exists + token-defined).
- **One sign convention per layer, never copied** — consume `flow/balance.ts` (the **AR-6** frozen authority:
  zero production diff since Story 4.1; `model.ts` carries only the `id ?? role` seam); a new energy node/role
  is registry + component metadata, never a balance/compute edit.
- **Editor writes:** REPLACE-not-MERGE for deletable keys; reset/default = DELETE the key; paint swatches write curated HEX; theme is card-only. The Scene-aware editor has **no in-editor preview** (HA's native split-pane is authoritative).
- **Keep the Lovelace contract** (`setConfig`/`getCardSize`/`getStubConfig`/`getConfigElement`) and the forward-compat spread.
- **`variant:'compact'` is presentation-only** — it does not hide the tab shell; the embedded vehicle cell honors `hide_*`/`default_panel`.
- **Never commit `dist/`**; keep the bundle dependency-free beyond `lit` + `@mdi/js`.
- This is the **standalone public card repo** — commit card changes inside `tesla-card/`; planning artifacts belong in the sibling `tesla-card-planning/` repo.

---

_Documentation generated by the BMAD Method `document-project` workflow · last regenerated 2026-06-24._
