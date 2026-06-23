# tesla-card — Development Guide

**Repo:** `tesla-card/` (public, standalone git repo) · **Date:** 2026-06-23 (Epic 9 doc regeneration)

How to build, verify, preview, and release the card. Verification is **gate-based** (`typecheck` +
the **8-gate `npm run lint` chain** + `build`) **and**, since Epic 1, a co-located **Vitest** unit
suite (`npm run test`, `src/**/*.test.ts` — Vitest env `node` by default, jsdom opt-in per file via
`// @vitest-environment jsdom`) that complements the gates — it does not replace them. The demo
harness (§3) provides visual verification.

---

## 1. Prerequisites

- **Node 20** (matches CI) and npm.
- Install dependencies inside the card repo:

```bash
cd tesla-card
npm ci          # or: npm install
```

Runtime dependencies are only `lit` + `@mdi/js`; keep it that way.

---

## 2. Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — full strict type-check. **Must stay clean.** |
| `npm run build` | `rollup -c` — bundles `src/tesla-card.ts` → `dist/tesla-card.js`. **Must emit the bundle.** |
| `npm run test` | `vitest run` — the co-located Vitest unit suite (`src/**/*.test.ts`; 65 files / ~1,562 tests). **Must stay green.** |
| `npm run dev` | `vite` — dev server for live work (no rebuild needed) |
| `npm run lint` | the 8-gate node-script chain (`no-bare-hass-states` → `no-cycle` → `trade-dress-denylist` → `import-allowlist` → `no-network-egress` → `version-sync` → `token-defined` → `no-planning-artifacts`) — **not** ESLint; all merge-blocking. `version-sync` (Story 7.4) asserts `package.json` `version` == `src/const.ts` `CARD_VERSION` and `hacs.json.filename` == the rollup output basename (`tesla-card.js`). `token-defined` (Epic-8 follow-up) flags any `var(--tc-X, …)` whose `--tc-X` is never defined in `styles.ts`; `no-planning-artifacts` blocks BMAD/planning files from the public repo. |
| `npm run watch` | `rollup -c --watch` — rebuild on change (terser skipped; sourcemaps on) |
| `npm run demo` | builds, then echoes a reminder to open `demo/index.html` (does **not** start a server) |

> ⚠️ `typecheck`, `test`, `lint`, **and** `build` must all be green before any release.

---

## 3. Verifying changes — the demo harness

`demo/index.html` imports the built `../dist/tesla-card.js` and synthesises a mock `hass` (states,
entity registry, device registry, locale, unit system, optimistic `callService`) — **no Home
Assistant needed**.

```bash
cd tesla-card
npm run build
# then open demo/index.html in a browser (e.g. via any static server or file://)
```

- **Rebuild rule:** changing `src/` requires a rebuild; editing `demo/index.html` does **not**.
- **Scenarios / environments via URL params:**
  - `?scenario=asleep` — vehicle asleep (status off; battery/telemetry/charging/media `unavailable`); default is awake/charging.
  - `?env=renamed` — second mock install ("My Tesla" / `my_tesla_*` / `tesla_fleet`) to prove
    name-based resolution; default install is "Garage Model Y" / `garage_model_y_*` / `teslemetry`.
  - `?panel=<id>` — initial tab (default `charging`).
- The demo configures the card with only `name`/`image`/`default_panel`; entities are left to
  auto-resolution (exercises `resolve.ts`).

> **Headless screenshots** have known traps (per-shot timeout+retry, unique `--user-data-dir`,
> WebGL-off for the map). See the `tesla-card-headless-screenshot-workflow` note in agent memory.

---

## 4. Adding a component

1. Create `src/components/<name>.ts` with `@customElement('tc-<name>')` extending `TcBase`
   (gives you `hass` + the resolved `config`).
2. Read entity state via `helpers.ts` (`rawState`, `num`, `display`, `isOn`, …) — **never** hard-code
   entity IDs; resolve by stable function-name through `config.entities[key]`.
3. Style with `sharedStyles` + your own `css`; use `var(--tc-…)` tokens, never raw palette values.
4. Register it with a **side-effect import** where it's used (parent for top-level children; the
   consuming panel for shared widgets like `tc-slider`).
5. To switch tabs, dispatch `fireEvent(this, 'open-panel', { panel })`.

If you add a configurable option, surface it in `src/editor.ts` and `TeslaCardConfig` (`types.ts`),
and keep it **additive / zero-diff-when-absent** (the R9 forward-compat spread; reset/clear DELETES the
key, never blanks it). Write a card-side render test for every config key the editor writes.

**Adding a new energy node TYPE** (the `generator` precedent, Story 9.14) is a **registry +
component-metadata edit, never a `flow/balance.ts`/`buildFlowModel`-math edit (AR-6).** Add the role to
`data/registry.ts` `ROLES`, then let the typecheck cascade enumerate the role-keyed tables to fill
(`FUNCTION_KEYS`/`BUS_ORIENTATION`/`POWER_KEY`/`NODE_COLOR`/`NODE_ICON`/`NODE_XY` + a new accent token in
`styles.ts` if needed) and add the `tc-<role>` ecosystem card. Because `ENERGY_ROLES = Object.keys(POWER_KEY)`,
the node auto-flows through binding→model→balance→ribbon→bus by construction.

---

## 5. CI gates

Two workflows run on push / PR (full guide: [`docs/ci.md`](./ci.md)), Node 20 from `.nvmrc`:

**`.github/workflows/validate.yml`** ("Validate") — packaging + build + structural gates:

- **`HACS` job** — `hacs/action@main` (HACS metadata validation).
- **`Type-check & build` job** — `npm ci` → `npm run typecheck` → `npm run build` →
  `test -s dist/tesla-card.js` (bundle-exists check).
- **`Structural gates (lint)` job** — `npm ci` → `npm run lint` (the **8-gate** structural chain).

**`.github/workflows/test.yml`** ("Test Pipeline") — the quality pipeline:

- **`Type-check`** — `typecheck` + `typecheck:e2e` (strict tsc is this project's linter).
- **`Unit (Vitest)`** — `npm run test` (the co-located unit suite).
- **`E2E (Playwright)`** — Playwright against the demo harness (browser-cached); uploads the HTML
  report + traces on failure.
- **`Burn-In (flaky detection)`** (PRs / weekly / manual) — repeats the suite with retries off.
- **`Report`** — writes a stage-results summary to the run page.

Mirror the whole gate locally with `npm run ci:local`; repeat-stress it with `npm run test:e2e:burn-in`.

---

## 6. Release flow

`.github/workflows/release.yml` runs on `release: published`: `npm ci` → `npm run build` →
`softprops/action-gh-release@v2` attaches `dist/tesla-card.js` to the release.

**Checklist (see `tesla-card/PUBLISHING.md`):**

1. Bump **all three** to the same version: `package.json` `version`, `src/const.ts` `CARD_VERSION`,
   and the git tag (`vX.Y.Z`).
2. `npm run typecheck` and `npm run build` green.
3. Tag → create a GitHub Release → `release.yml` builds and attaches `tesla-card.js`.
4. `hacs.json` `filename` must equal the released asset name (`tesla-card.js`).

> ⚠️ **Never commit `dist/`** — it's gitignored and built in CI.
> ⚠️ For HACS distribution the card lives at `github.com/mlmeehan/tesla-card` — its **own standalone
> public repo**. BMAD planning artifacts belong in the sibling private `tesla-card-planning/` repo
> (gate-blocked here by `no-planning-artifacts`).

---

## 7. Consuming the card in Home Assistant

Once installed via HACS (or added manually), the card is registered as a Lovelace **resource**
(HACS does this automatically for plugins) and used in a dashboard as:

```yaml
type: custom:tesla-card
name: Model Y
# entities auto-resolve; override per-key only if needed:
# entities:
#   battery_level: sensor.my_tesla_battery_level
```

For the full user-facing options table and entity-resolution behaviour, see the card
[`README.md`](../README.md); for the no-YAML setup experience, use the GUI editor (the card's
**Edit** pencil in Lovelace) — no YAML required.

---

_Generated by the BMAD `document-project` workflow (exhaustive scan, 2026-06-23 — Epic 9 regeneration)._
