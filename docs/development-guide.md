# tesla-card — Development Guide

**Repo:** `tesla-card/` (public, standalone git repo) · **Date:** 2026-06-24 (Epics 9–11 doc regeneration)

How to build, verify, preview, and release the card. Verification is **gate-based** (`typecheck` +
the **8-gate `npm run lint` chain** + `build`) **and** a co-located **Vitest** unit suite plus a
demo-driven **Playwright** E2E suite — together they complement the gates, they do not replace them.
The demo harness (§3) provides visual verification and is the shared system-under-test for both the
dev loop and E2E.

---

## 1. Prerequisites

- **Node 20** — pinned in `.nvmrc` and matched by CI. Use `nvm use` to align.
- Install dependencies inside the card repo (`npm ci` for the lockfile-exact CI install):

```bash
cd tesla-card
nvm use         # → Node 20 (.nvmrc)
npm ci          # lockfile-exact; or `npm install` to update the lock
```

Runtime dependencies are **only** `lit ^3.2.1` + `@mdi/js ^7.4.47` (named icon imports only) — keep
it that way. Everything else (`rollup`, `vite`, `vitest`, `@playwright/test`, `http-server`,
`typescript ~5.7.3`, `tslib`) is `devDependencies`; none of it enters the shipped bundle.

---

## 2. Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — full strict type-check of `src/`. Strict tsc **is** this project's linter; **must stay clean.** |
| `npm run typecheck:e2e` | `tsc -p tests/tsconfig.json` — type-checks the Playwright suite separately from the bundle. |
| `npm run build` | `rollup -c` — bundles `src/tesla-card.ts` → `dist/tesla-card.js`. **Must emit the bundle.** |
| `npm run watch` | `rollup -c --watch` — rebuild on change (terser skipped; sourcemaps on). |
| `npm run dev` | `vite` — dev server over `demo/` with HMR against live `src/` (see §3). |
| `npm run test` | `vitest run` — the co-located unit suite (`src/**/*.test.ts`; **65 files / ~1,578 cases**). **Must stay green.** |
| `npm run test:watch` | `vitest` — same suite in watch mode for the inner loop. |
| `npm run lint` | the **8-gate** node-script chain (see below) — **not** ESLint; all merge-blocking. |
| `npm run demo` | builds, then echoes a reminder to open `demo/index.html` (does **not** start a server). |
| `npm run serve:demo` | `http-server . -a 127.0.0.1 -p 4173 -c-1 -s` — serves the repo root so the harness can import the built bundle. |
| `npm run test:e2e` | `playwright test` — the E2E suite against the demo harness (**24 specs / ~293 cases**); excludes `@visual`. |
| `npm run test:e2e:headed` / `:ui` / `:debug` / `:report` | `playwright test` variants: visible browser / UI time-travel / inspector / open the last HTML report. |
| `npm run test:e2e:visual` | `VISUAL=1 playwright test --grep @visual` — the opt-in pixel-baseline specs (2 committed baselines). |
| `npm run test:e2e:burn-in` | `bash scripts/burn-in.sh` — repeat-stress the suite (retries off) for flaky detection. |
| `npm run ci:local` | `bash scripts/ci-local.sh` — mirror the whole CI gate locally. |
| `npm run profile:nfr1` | `bash scripts/profiler/fps-probe.sh` — the NFR-1 ~60fps composed-Scene FPS probe. |

`prepare` (npm lifecycle) runs `git config core.hooksPath scripts/hooks` so the native pre-commit
guard is wired on first install.

**The 8 lint gates** (`npm run lint`, in order — full guide: [`docs/ci.md`](./ci.md)):
`no-bare-hass-states` → `no-cycle` → `trade-dress-denylist` → `import-allowlist` → `no-network-egress`
→ `version-sync` → `token-defined` → `no-planning-artifacts`. Each is a `scripts/lint/*.mjs` CLI.
`version-sync` asserts `package.json` `version` == `src/const.ts` `CARD_VERSION` and `hacs.json`
`filename` == the rollup output basename (`tesla-card.js`); `token-defined` flags any
`var(--tc-X, …)` whose `--tc-X` is never defined in `styles.ts`; `no-planning-artifacts` blocks
BMAD/planning files from this public repo.

> ⚠️ `typecheck`, `test`, `lint`, **and** `build` must all be green before any release. E2E
> (`test:e2e`) runs in CI and is part of the gate too.

---

## 3. Verifying changes — the demo harness

`demo/index.html` is a **self-contained mock-`hass` shell** (states, entity registry, device
registry, locale, unit system, optimistic `callService`) with **zero Home Assistant dependency**. It
is the shared SUT for **both** `npm run dev` (Vite HMR) and Playwright E2E (`http-server` on `:4173`),
and it imports the shared fixture corpus `src/fixtures/model-y-awake.json` (one fixture feeds both
Vitest and the browser).

```bash
cd tesla-card
npm run dev     # Vite serves demo/ with HMR — edit any src/ module, it hot-reloads
# or, to mirror the CI/Playwright path against the BUILT bundle:
npm run build && npm run serve:demo   # http-server on http://127.0.0.1:4173/demo/index.html
```

**Dev-loop detail:** `demo/index.html` statically imports the *built* bundle
(`../dist/tesla-card.js`) so it works under plain `http-server` with no bundler. Under Vite,
`vite.config.ts` transparently aliases that one specifier to `src/tesla-card.ts`, so editing any
`src/` module hot-reloads with no rebuild. Editing `demo/index.html` itself never needs a rebuild;
changing `src/` for the `serve:demo` path does.

**Scenarios / modes via URL params** (the contract is centralised in
`tests/support/helpers/demo-url.ts` `buildDemoUrl`):

- `?scenario=` — `asleep` | `parked` | `plugged` | `apertures` | `unresolved` (default = awake/charging).
- `?panel=<id>` — initial tab (default `charging`).
- `?env=` — `default` (Garage Model Y / `garage_model_y_*` / `teslemetry`), `renamed` (My Tesla /
  `my_tesla_*` / `tesla_fleet`), or `tesla_custom` (the costly distinct dialect) — proves name-based
  resolution and the dialect seam.
- `?card=my-home` — mounts the full `tc-my-home` Scene (six cards + Gateway bus + weather vignette)
  as the sole subject for the NFR-1 profiler.
- `?editor=1&setup=<bare|progress|done>&editortype=<vehicle|my-home>` — mounts the **real lazy
  editor** exactly as Lovelace does (via `getConfigElement`), fed the same mock `hass`; surfaces its
  last `config-changed` payload on `window.__lastConfig` for assertions.
- Per-hero / per-aperture flags: `?paint=<hex>`, `?image=1`, `?recolor=1|broken`, `?colorentity=<…>`,
  `?charge=<charging|plugged|parked>`, and `?frunk=1`/`?door=1`/`?unavail=<…>` aperture probes.

A data-URI favicon (`<link rel="icon" href="data:," />`) suppresses the browser's `/favicon.ico`
request so a clean Scene logs **zero** console errors — the NFR-1 profiler precondition.
`demo/local/` holds gitignored bring-your-own recolor art (Tesla trade dress stays out of the repo).

> **Headless screenshots** have known traps (per-shot timeout+retry, unique `--user-data-dir`,
> WebGL-off for the map). See the `tesla-card-headless-screenshot-workflow` note in agent memory.

---

## 4. The build (Rollup)

The shipped artifact is built by **Rollup**, not Vite — the dev loop and the release bundle are
**decoupled by design** (do not fold the build into Vite). `rollup.config.mjs` takes a single input
`src/tesla-card.ts` → `dist/tesla-card.js`, `format: 'es'`, `inlineDynamicImports: true`, with
`terser` applied when not `ROLLUP_WATCH` (`compress.passes: 2`). The output is one self-contained ES
bundle, **~346–360KB**, and `dist/` is **gitignored** (built in CI, attached to releases). Vite is
dev/test only.

**tsconfig contract** (load-bearing, do not flip): target `ES2021`, module `ESNext`,
`moduleResolution: 'bundler'`, **`useDefineForClassFields: false`** (Lit decorators depend on this),
full `strict` plus `noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride`.

---

## 5. Test architecture

Two tiers, both driving the *real* code:

**Unit — Vitest (co-located).** `src/**/*.test.ts`, **65 files / ~1,578 cases**, configured inside
`vite.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`) — there is intentionally
**no** separate `vitest.config.ts`. Pure `data/`/`flow/` hubs are node-testable; a DOM-touching test
opts into jsdom **per file** with `// @vitest-environment jsdom` (jsdom is installed for exactly
that). Notable property/invariant tests: `flow/balance.test.ts` (sign-convention + sum-to-zero
through the production binding), `data/dialect` (power-sign flip + idempotence), `data/wake` (the
wake gate never fires `button.press` while online/waking), and `flow/flow-states.test.ts` (each of the
seven committed `flow-*.json` fixtures asserted against its `FlowModel`). Each **lint gate** also has
a meta-test that shells out to its `scripts/lint/*.mjs` CLI (exit-0 clean, non-zero on a planted
violation) and unit-tests the pure matcher; the structural gates parse the real TS AST.

**E2E — Playwright (demo-driven, hermetic).** `tests/e2e/*.spec.ts`, **24 specs / ~293 cases**, drive
the **built bundle** in the demo harness so they cover computed styles / layout / `@media` /
PointerEvents that jsdom can't. Config in `playwright.config.ts`: `testDir ./tests/e2e`,
`fullyParallel`, `webServer` runs `npm run build && npm run serve:demo`; under CI `retries: 2`,
`workers: 2`, `forbidOnly`, with traces/screenshots/video retained on failure.

E2E support lives under `tests/support/`:
- `fixtures/index.ts` — `mergeTests` of `demo-fixture` (→ a ready `TeslaCardPage`) and the
  **auto-attached console-guard**, which fails a test if the card emits any uncaught error or an
  unexpected `console.error` (turns "rendered" into "rendered *cleanly*").
- `helpers/hermetic.ts` — aborts any non-localhost request for offline determinism.
- `helpers/demo-url.ts` — `buildDemoUrl`, the single source of the harness URL contract.
- `scenarios.ts` — scenario data + expected rendered strings (`72%`, `235 mi`, …) asserted once.
- page objects (`page-objects/tesla-card.page.ts`, `tesla-editor.page.ts`) — selectors as behaviour.
  The card ships **no `data-testid`**; selectors are role/text/aria only and pierce nested shadow DOM.

**Visual baselines** are opt-in (`@visual`, **2 committed baselines**, `maxDiffPixelRatio 0.02`),
excluded from the default gate via `grepInvert` unless `VISUAL=1`. Cross-OS AA differences make pixel
baselines machine-specific. The recolor specs are similarly **guarded** — they skip on a fresh
checkout / CI because `demo/local/` art is gitignored.

> **Process note (from retros):** the recurring "File-List omits e2e" wart means the DoD now wants a
> **render-test-per-editor-key** — `my-home-scene.spec.ts` pins the *embedded* render per editor key
> (Story 11.4). Add a card-side render test for every config key the editor writes, including nested
> embeds.

---

## 6. Adding a component

1. Create `src/components/<name>.ts` with `@customElement('tc-<name>')` extending `TcBase`
   (gives you `hass` + the resolved `config`).
2. Read entity state via `helpers.ts` (`rawState`, `num`, `display`, `isOn`, …) — **never** hard-code
   entity IDs; resolve by stable function-name through `config.entities[key]`.
3. Style with `sharedStyles` + your own `css`; use `var(--tc-…)` tokens, never raw palette values.
4. Register it with a **side-effect import** where it's used (parent for top-level children; the
   consuming panel for shared widgets like `tc-slider`). Assert the new element appears against the
   bundle entry (`tesla-card.ts`) so it can't silently drop out of the single bundle.
5. To switch tabs, dispatch `fireEvent(this, 'open-panel', { panel })`.

If you add a configurable option, surface it in `src/editor.ts` and `TeslaCardConfig` (`types.ts`),
and keep it **additive / zero-diff-when-absent** (the R9 forward-compat spread; reset/clear DELETES
the key, never blanks it). Write a card-side render test for every config key the editor writes.

There are **20 custom elements** today (8 of them picker/ecosystem cards); the editor is registered
lazily via `getConfigElement`.

---

## 7. Adding an energy node / role — the AR-6 pattern

A new energy node is a **registry + component-metadata edit, NEVER a `flow/balance.ts` /
`buildFlowModel`-math edit**. This is the AR-6 invariant: `balance.ts` has had **zero** production
diff since Story 4.1, and `model.ts` carries only the `id ?? role` seam. The compiler does the work —
add the role to `ROLES` (`src/data/registry.ts`) and the strict typecheck cascade *enumerates exactly
which role-keyed tables you must fill*.

The **`generator`** role (Story 9.14) is the worked example. Adding `generator` to `ROLES` forced
exactly these:

- `data/registry.ts`: `FUNCTION_KEYS.generator = ['generator_power']`, `BUS_ORIENTATION.generator = 1`,
  `POWER_KEY` entry. (`ENERGY_ROLES = Object.keys(POWER_KEY)`, so the node auto-flows through
  binding → model → balance → ribbon → bus by construction.)
- `data/energy.ts`: `EnergyEntities.generator_power?` + the resolution `RULES`.
- renderer: `NODE_COLOR` / `NODE_ICON` (`mdiGeneratorStationary`).
- editor: `NODE_LABELS`.
- `styles.ts`: a new accent — `ACCENT_SEMANTICS` copper `#c2855b` + the `--tc-copper` token (there are
  now **8 accents**); update the three `styles.test.ts` accent gates together.
- model the `tc-generator` ecosystem card on the **simple** mold (`grid.ts` / `home.ts`), **not**
  `solar.ts`.

`balance.ts` / `buildFlowModel` math is left **untouched** — that is the AR-6 proof.

There are **7 ROLES** today (`vehicle` + the six energy roles `solar` / `powerwall` / `grid` / `home`
/ `wall_connector` / `generator`) and **22 energy function-keys** (some code comments still stale-say
21); the vehicle side carries **84** function-keys. Layering is `data/` ← `flow/` ← `components/`
(enforced by the `no-cycle` gate); only `src/data/` reads `hass.states` (plus the editor, under D7).
`data/` = 8 modules, `flow/` = 8 non-test modules (including `instances.ts`).

---

## 8. CI gates

Three workflows run on push / PR (full guide: [`docs/ci.md`](./ci.md)), Node 20 from `.nvmrc`:

**`.github/workflows/validate.yml`** ("Validate") — packaging + build + structural gates:
- **`HACS` job** — `hacs/action@main` (HACS metadata validation).
- **`Type-check & build` job** — `npm ci` → `npm run typecheck` → `npm run build` →
  `test -s dist/tesla-card.js` (bundle-exists check).
- **`Structural gates (lint)` job** — `npm ci` → `npm run lint` (the **8-gate** structural chain).
- **`E2E (Playwright)` job** — `npm ci` → `npx playwright install --with-deps chromium` →
  `npm run test:e2e`; uploads the HTML report + traces on failure.

**`.github/workflows/test.yml`** ("Test Pipeline") — the quality pipeline:
- **`Type-check`** — `typecheck` + `typecheck:e2e`.
- **`Unit (Vitest)`** — `npm run test`.
- **`E2E (Playwright)`** — the demo-harness suite (browser-cached).
- **`Burn-In (flaky detection)`** (PRs / weekly / manual) — repeats the suite with retries off.
- **`Report`** — writes a stage-results summary to the run page.

Mirror the whole gate locally with `npm run ci:local`; repeat-stress it with `npm run test:e2e:burn-in`.

---

## 9. Release flow

`.github/workflows/release.yml` runs on `release: published`: `npm ci` → `npm run build` →
`softprops/action-gh-release@v2` attaches `dist/tesla-card.js` to the release.

**Checklist (see `tesla-card/PUBLISHING.md`):**

1. Bump **all three** to the same version: `package.json` `version`, `src/const.ts` `CARD_VERSION`,
   and the git tag (`vX.Y.Z`). The `version-sync` gate enforces the first two (current: **0.2.0**).
2. `npm run typecheck`, `npm run test`, `npm run lint`, and `npm run build` all green.
3. Tag → create a GitHub Release → `release.yml` builds and attaches `tesla-card.js`.
4. `hacs.json` `filename` must equal the released asset name (`tesla-card.js`).

> ⚠️ **Never commit `dist/`** — it's gitignored and built in CI.
> ⚠️ For HACS distribution the card lives in its **own standalone public repo**. BMAD planning
> artifacts belong in the sibling private `tesla-card-planning/` repo (gate-blocked here by
> `no-planning-artifacts`).

---

## 10. Common gotchas

- **`useDefineForClassFields: false`** in `tsconfig.json` is load-bearing for Lit's decorators —
  never flip it.
- **No hard-coded entity IDs.** Resolve by stable function-name through `config.entities[key]`; the
  `no-bare-hass-states` gate keeps `hass.states` access inside `src/data/` (plus the editor).
- **Never commit `dist/`** — it's built in CI and attached to releases.
- **Import `RECONCILE_TIMEOUT_MS`** (and other shared constants) from `const.ts`; never re-declare a
  literal locally.
- **`@mdi/js` named imports only** — no wildcard / default imports (keeps the bundle from pulling the
  whole icon set; checked by `import-allowlist`).
- Minimum supported Home Assistant runtime is **2024.4.0**; every widget the card uses predates it.

---

## 11. Consuming the card in Home Assistant

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

_Generated by the BMAD `document-project` workflow (exhaustive scan, 2026-06-24 — Epics 9–11 regeneration)._
