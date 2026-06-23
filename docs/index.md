# tesla-card Documentation Index

**Repo:** `tesla-card/` (public, standalone git repo — `github.com/mlmeehan/tesla-card`) · **Last Updated:** 2026-06-23
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
normal form) for setup, theming, per-entity overrides, and Scene customization. It bundles to a single
ES module (`dist/tesla-card.js`) consumed by Home Assistant and distributed via HACS, organized as a
`data/ ← flow/ ← components/` layered architecture. Its core design features are **entity resolution by
stable function-name** (works across installs and prefixes without hard-coded IDs) and a **single
energy sign-convention** that drives both the Hero overlay and the Scene bus.

## Quick Reference

- **Tech Stack:** TypeScript `~5.7.3`, Lit `^3.2.1`, `@mdi/js` `^7.4.47`, Rollup `^4.30.1` + terser
- **Entry Point:** `src/tesla-card.ts` → `dist/tesla-card.js` (≈ 346 KB minified, single file)
- **Architecture Pattern:** single `@customElement('tesla-card')` orchestrating flat `tc-*` children (shadow-DOM component tree); **20 custom elements**, **8** `window.customCards` picker cards
- **Build:** `npm run build` (Rollup → single inlined ES bundle)
- **Gates:** `npm run typecheck` + `npm run test` (Vitest unit suite) + `npm run lint` (8-gate chain) + `npm run build` + Playwright E2E + demo harness — see [CI Pipeline](./ci.md)
- **Min HA:** `2024.4.0` · **CI runtime:** Node 20
- **Tests:** Vitest unit suite — **65 files / ~1,562 tests** (+ 23 Playwright e2e specs)
- **Version:** `0.2.0` — `CARD_VERSION` in `src/const.ts`, kept in sync with `package.json` + git tag (**CI-enforced** by the `version-sync` lint gate + a `release.yml` tag assertion); held until the 1.0.0 cut

## Generated Documentation

- [Architecture](./architecture.md) — component tree, entity resolution, energy engine (AR-6), design tokens, Lovelace contract, build pipeline, **Enhanced Configuration (Epic 9)**
- [Component & Primitive Inventory](./component-inventory.md) — every `tc-*` element, render helper, `data/`/`flow/` module, `ui.ts` primitive, `--tc-*` token, and the config surface
- [Development Guide](./development-guide.md) — commands, demo harness, adding a component / energy node, CI, release/version-sync
- [CI Pipeline](./ci.md) — workflows (validate / test / release), quality gates, local-parity scripts, secrets, troubleshooting
- [Source Tree Analysis](./source-tree-analysis.md) — annotated `src/` and project layout
- [Privacy](./privacy.md) — no-network-egress / no-telemetry affirmation, the merge-blocking gate, and the sanctioned HA channel
- [Layer contract (`@unstable`)](./layer-contract.md) — the published body-render contract: named layers/nodes, registration, the 3/4 camera, the 1024×687 anchor, and the one-way-door freeze warning
- [Recolorable body](./recolorable-body.md) — how to bake the four layers the Layer contract composites (bring-your-own render)
- [Asset packs (`@unstable`)](./asset-packs.md) — bring-your-own render + multi-model packs: WebP externalization, HA placement, swapping models by URL, the never-committed boundary

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
# try ?scenario=asleep / ?env=renamed / ?panel=charging
```

## For AI-Assisted Development

When extending the card, **read [`architecture.md`](./architecture.md) first**, then keep these
invariants (full list in architecture §12):

- **No hard-coded Tesla entity IDs** — resolve by stable function-name via `config.entities[key]`.
- **`useDefineForClassFields: false`** is load-bearing for Lit — never "fix" it.
- **Use `var(--tc-…)` tokens with a fallback, and the token must be real** (two gates: fallback-exists + token-defined).
- **One sign convention per layer, never copied** — consume `flow/balance.ts` (the **AR-6** frozen authority); a new energy node/role is registry + component metadata, never a balance/compute edit.
- **Editor writes:** REPLACE-not-MERGE for deletable keys; reset/default = DELETE the key; paint swatches write curated HEX; theme is card-only.
- **Keep the Lovelace contract** (`setConfig`/`getCardSize`/`getStubConfig`/`getConfigElement`) and the forward-compat spread.
- **Never commit `dist/`**; keep the bundle dependency-free beyond `lit` + `@mdi/js`.
- This is the **standalone public card repo** — commit card changes inside `tesla-card/`; planning artifacts belong in the sibling `tesla-card-planning/` repo.

---

_Documentation generated by the BMAD Method `document-project` workflow. Regenerated by a 2026-06-23
exhaustive scan to reflect **Epic 9 (Enhanced Configuration / CAP-5)**: the no-YAML GUI editor, the
`generator` node type (8th picker card / 8th accent), per-instance/multi-instance Scene identity,
card-only theming, and per-entity overrides — all additive and zero-diff-when-absent. The "all six
`flow/` files frozen" framing is retired in favour of **AR-6** (only `flow/balance.ts` is the frozen
authority)._
