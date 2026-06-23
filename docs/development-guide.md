# tesla-card — Development Guide

**Part:** `[card]` · **Path:** `tesla-card/` (separate nested git repo) · **Date:** 2026-06-14
**Last reviewed:** 2026-06-19 (Epic 4 retro doc audit)

How to build, verify, preview, and release the card. Verification is **gate-based** (`typecheck` +
the **8-gate `npm run lint` chain** + `build`) **and**, since Epic 1, a co-located **Vitest** unit
suite (`npm run test`, `src/**/*.test.ts` incl. jsdom element tests) that complements the gates —
it does not replace them. The demo harness (§3) provides visual verification.

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
| `npm run test` | `vitest run` — the co-located Vitest unit suite (`src/**/*.test.ts`, jsdom). **Must stay green.** |
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

If you add a configurable option, surface it in `src/editor.ts` and `TeslaCardConfig` (`types.ts`).

---

## 5. CI gates

Two workflows run on push / PR (full guide: [`docs/ci.md`](./ci.md)), Node 20 from `.nvmrc`:

**`.github/workflows/validate.yml`** — packaging + build gate:

- **`hacs` job** — `hacs/action@main` with `category: plugin` (HACS metadata validation).
- **`build` job** — `npm ci` → `npm run typecheck` → `npm run build` → `test -s dist/tesla-card.js`
  (bundle-exists check).

**`.github/workflows/test.yml`** — the quality pipeline:

- **`lint`** — `typecheck` + `typecheck:e2e` (strict tsc is this project's linter).
- **`test`** — Playwright E2E against the demo harness (browser-cached); uploads the HTML
  report + traces on failure.
- **`burn-in`** (PRs / weekly / manual) — repeats the suite with retries off to surface flakiness.
- **`report`** — writes a stage-results summary to the run page.

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
> ⚠️ For HACS distribution the card lives at `github.com/mlmeehan/tesla-card`; the card is a
> **separate nested git repo** — commit card changes *inside* `tesla-card/`, not the parent.

---

## 7. Consuming the card in Home Assistant

Once released/installed, the card is registered as a Lovelace **resource** (in this repo,
resources are centralized in `configuration.yaml`'s `lovelace.resources`, see the `[HA]` docs) and
used in a dashboard as:

```yaml
type: custom:tesla-card
name: Model Y
# entities auto-resolve; override per-key only if needed:
# entities:
#   battery_level: sensor.my_tesla_battery_level
```

See the repo-wide [integration overview](../../docs/project-overview.md#6-how-the-two-parts-relate).

---

_Generated by the BMAD `document-project` workflow (deep scan, 2026-06-14)._
