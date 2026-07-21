# tesla-card — Development Guide

**Repo:** `tesla-card/` (public, standalone git repo) · **Date:** 2026-07-20 (post-Epics 13–17 / v1.0.0 drift-reconciliation)

How to build, verify, preview, and release the card. Verification is **gate-based**: `typecheck` +
the **8-gate `npm run lint` chain** + the separate **`test:census`** inventory gate + `build`, backed
by a co-located **Vitest** unit suite and a demo-driven **Playwright** E2E suite over a shared demo
harness (§3).

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
`typescript ^5.7.3`, `tslib`) is `devDependencies`; none of it enters the shipped bundle.

---

## 2. Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — full strict type-check of `src/`. Strict tsc **is** this project's linter; **must stay clean.** |
| `npm run typecheck:e2e` | `tsc -p tests/tsconfig.json` — type-checks the Playwright suite separately from the bundle. |
| `npm run build` | `rollup -c` — bundles `src/tesla-card.ts` → `dist/tesla-card.js`. **Must emit the bundle.** |
| `npm run watch` | `rollup -c --watch` — rebuild on change (terser skipped; sourcemaps on). |
| `npm run dev` | `vite` — dev server over `demo/` with HMR against live `src/` (see §3). |
| `npm run test` | `vitest run` — the co-located unit suite (`src/**/*.test.ts`). **Must stay green.** |
| `npm run test:watch` | `vitest` — same suite in watch mode for the inner loop. |
| `npm run test:census` | `node scripts/lint/test-census.mjs` — the **test-inventory gate**: fails if the unit/e2e counts or the e2e spec-file list drift from `tests/test-census.json`. Regenerate with `npm run test:census -- --write`. |
| `npm run lint` | the **8-gate** node-script chain (see below) — **not** ESLint; all merge-blocking. |
| `npm run demo` | builds, then echoes a reminder to open `demo/index.html` (does **not** start a server). |
| `npm run serve:demo` | `http-server . -a 127.0.0.1 -p 4173 -c-1 -s` — serves the repo root so the harness can import the built bundle. |
| `npm run test:e2e` | `playwright test` — the E2E suite against the demo harness; excludes `@visual`. |
| `npm run test:e2e:headed` / `:ui` / `:debug` / `:report` | `playwright test` variants: visible browser / UI time-travel / inspector / open the last HTML report. |
| `npm run test:e2e:visual` | `VISUAL=1 playwright test --grep @visual` — the opt-in pixel-baseline specs (2 committed baselines). |
| `npm run test:e2e:burn-in` | `bash scripts/burn-in.sh` — repeat-stress the suite (retries off) for flaky detection. |
| `npm run ci:local` | `bash scripts/ci-local.sh` — mirror the whole CI gate locally. |
| `npm run profile:nfr1` | `bash scripts/profiler/fps-probe.sh` — the NFR-1 ~60fps composed-Scene FPS probe. |

`prepare` (npm lifecycle) runs `git config core.hooksPath scripts/hooks` so the native pre-commit
guard is wired on first install.

**The 8 lint gates** (`npm run lint`, in order — full guide: [`docs/ci.md`](./ci.md)):
`no-bare-hass-states` → `no-cycle` → `trade-dress-denylist` → `import-allowlist` → `no-network-egress`
→ `version-sync` → `token-defined` → `no-planning-artifacts`. Each is a `scripts/lint/*.mjs` CLI;
what each gate asserts lives in the `ci.md` guide linked above.

> ⚠️ `typecheck`, `test`, `lint`, `test:census`, **and** `build` must all be green before any
> release. E2E (`test:e2e`) runs in CI and is part of the gate too.

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
  `my_tesla_*` / `tesla_fleet`), or `tesla_custom` — proves name-based resolution and the dialect
  seam. Since Story 17.1, `tesla_custom` renders the **complete** dialect shape (every divergent-alias
  rename + the `time_charge_complete` timestamp special-case + the absent-twin deletions + the derived
  boolean charging triple), so the harness is a genuine dialect test bed, not merely a probe trigger.
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
bundle (**365,786 B** at v1.0.0, terser-minified), and `dist/` is **gitignored** (built in CI,
attached to releases). Vite is dev/test only.

**tsconfig contract** (load-bearing, do not flip): target `ES2021`, module `ESNext`,
`moduleResolution: 'bundler'`, **`useDefineForClassFields: false`** (Lit decorators depend on this),
full `strict` plus `noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride`.

---

## 5. Test architecture

Two tiers, both driving the *real* code:

**Unit — Vitest (co-located).** `src/**/*.test.ts`, **69 files / 1,784 cases**, configured inside
`vite.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`) — there is intentionally
**no** separate `vitest.config.ts`. Pure `data/`/`flow/` hubs are node-testable; a DOM-touching test
opts into jsdom **per file** with `// @vitest-environment jsdom` (jsdom is installed for exactly
that). Notable property/invariant tests: `flow/balance.test.ts` (sign-convention + sum-to-zero
through the production binding), `data/dialect` (power-sign flip + idempotence), `data/wake` (the
wake gate never fires `button.press` while online/waking), and `flow/flow-states.test.ts` (each of the
seven committed `flow-*.json` fixtures asserted against its `FlowModel`). Each **lint gate** also has
a meta-test that shells out to its `scripts/lint/*.mjs` CLI (exit-0 clean, non-zero on a planted
violation) and unit-tests the pure matcher; the structural gates parse the real TS AST.

**E2E — Playwright (demo-driven, hermetic).** `tests/e2e/*.spec.ts`, **309 cases / 24 specs (23
active by default; `visual.spec.ts` under `VISUAL=1`)**, drive
the **built bundle** in the demo harness so they cover computed styles / layout / `@media` /
`@container` / PointerEvents that jsdom can't. Config in `playwright.config.ts`: `testDir ./tests/e2e`,
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

**Test census (a required dev-loop step since PR #7).** The unit/e2e counts above are
machine-checked: `tests/test-census.json` is the authoritative inventory, and `npm run test:census`
(CI's `Unit (Vitest)` job + `ci:local`) fails the build on any drift. **Adding or removing a unit test
or an e2e spec means regenerating it — `npm run test:census -- --write` — and committing
`tests/test-census.json` in the same change**, or CI goes red.

**Visual baselines** are opt-in (`@visual`, **2 committed baselines**, `maxDiffPixelRatio 0.02`),
excluded from the default gate via `grepInvert` unless `VISUAL=1`. Cross-OS AA differences make pixel
baselines machine-specific. The recolor specs are similarly **guarded** — they skip on a fresh
checkout / CI because `demo/local/` art is gitignored.

> **Process note (from retros):** `my-home-scene.spec.ts` pins the *embedded* render per editor key
> (Story 11.4). The render-test-per-editor-key DoD lives in §6 (Adding a component).

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
the key, never blanks it). Write a card-side render test for every config key the editor writes,
including nested embeds.

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

- `data/registry.ts`: `FUNCTION_KEYS.generator = ['generator_power']`, `BUS_ORIENTATION.generator = 1`.
- `flow/binding.ts`: the `POWER_KEY` entry. (`ENERGY_ROLES = Object.keys(POWER_KEY)`, so the node
  auto-flows through binding → model → balance → ribbon → bus by construction.)
- `data/energy.ts`: `EnergyEntities.generator_power?` + the resolution `RULES`.
- renderer: `NODE_COLOR` / `NODE_ICON` (`mdiGeneratorStationary`).
- editor: `NODE_LABELS`.
- `styles.ts`: a new accent — `ACCENT_SEMANTICS` copper `#c2855b` + the `--tc-copper` token (there are
  now **8 accents**); update the three `styles.test.ts` accent gates together.
- model the `tc-generator` ecosystem card on the **simple** mold (`grid.ts` / `home.ts`), **not**
  `solar.ts`.

`balance.ts` / `buildFlowModel` math is left **untouched** — that is the AR-6 proof.

Layering is `data/` ← `flow/` ← `components/` (enforced by the `no-cycle` gate); only `src/data/`
reads `hass.states` (plus the editor, under D7).

---

## 8. Adding a dialect — the AR-4 pattern

Integrations name the same Tesla facts differently (`tesla_fleet` vs the HACS `tesla_custom` vs
Teslemetry vs Tessie). **Everything dialect-specific is quarantined in `src/data/dialect.ts`**, behind
pure functions in tables — never an OO hierarchy, never a `=== 'Charging'` scattered across
components. AR-4 (narrowed in Story 14.1): a fully-covered new dialect touches **up to four
coordinated data structures there and nothing downstream** — no `resolve.ts` loop edit, no component
or `flow/` churn. The resolver's one-time `detectDialect` consult is the single binding, proven by the
co-located seam test.

1. Add the platform to the `Integration` union **and** to `TESLA_PLATFORMS` in the leaf
   `src/data/platforms.ts`. That shared set — not the dialect table — is what `detectDialect` scans, so
   an unregistered platform is never probed; this is the one shared-constant edit, by design.
2. One `DIALECTS` entry: `makeAdapter({ integration: '…' })`. Every other `AdapterSpec` field is
   optional and **degrades to the fleet default** — a status override (`charging` / `lock` / `cover`
   maps), `combine` / `split`, or `flipPower`.
3. As needed: `DIALECT_ENTITY_ALIASES` (per-key `"domain.suffix"` renames where the dialect spells an
   entity differently) and `DIALECT_ABSENT` (canonical keys the dialect never produces).

`tesla_custom` is the fully-worked example (all three tables populated); `teslemetry` / `tessie` /
bare `tesla` are present entries that degrade to the default dialect, fillable incrementally. The
demo's `?env=tesla_custom` (§3) renders the complete shape, and the shape-asserting
`charging-panel.spec.ts` rows are the drift alarm.

---

## 9. CI gates

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
- **`Unit (Vitest)`** — `npm run test`, then `npm run test:census` (the test-inventory gate;
  `playwright test --list` needs no browser binaries, so it rides this job).
- **`E2E (Playwright)`** — the demo-harness suite (browser-cached).
- **`Burn-In (flaky detection)`** (PRs / weekly / manual) — repeats the suite with retries off.
- **`Report`** — writes a stage-results summary to the run page.

Mirror the whole gate locally with `npm run ci:local`; repeat-stress it with `npm run test:e2e:burn-in`.

---

## 10. Release flow

**v1.0.0 shipped 2026-07-12**, so the path below is a real, exercised flow — not a future event.
`.github/workflows/release.yml` runs on `release: published`: `npm ci` → **assert the published tag
equals `v${version}`** (`node scripts/lint/version-sync.mjs --release-tag` — the release-time leg of
the version-sync invariant, so a tag can never ship a bundle whose banner disagrees) → `npm run build`
→ `softprops/action-gh-release@v2` attaches the CI-built `dist/tesla-card.js`. The card is distributed
as a **HACS custom repository** (live); default-store submission is deliberately deferred.

**Checklist (see `tesla-card/PUBLISHING.md`):**

1. Bump **all three** to the same version: `package.json` `version`, `src/const.ts` `CARD_VERSION`,
   and the git tag (`vX.Y.Z`). The `version-sync` lint gate enforces the first two on every push
   (current: **1.0.0**); `release.yml` asserts the tag matches them at publish time.
2. `npm run typecheck`, `npm run test`, `npm run test:census`, `npm run lint`, and `npm run build`
   all green (or just `npm run ci:local`, which mirrors the whole chain).
3. Tag → create a GitHub Release → `release.yml` builds and attaches `tesla-card.js`.
4. `hacs.json` `filename` must equal the released asset name (`tesla-card.js`).

> ⚠️ **Never commit `dist/`** — it's gitignored and built in CI.
> ⚠️ For HACS distribution the card lives in its **own standalone public repo**. BMAD planning
> artifacts belong in the sibling private `tesla-card-planning/` repo (gate-blocked here by
> `no-planning-artifacts`).

---

## 11. Common gotchas

- **`useDefineForClassFields: false`** in `tsconfig.json` is load-bearing for Lit's decorators —
  never flip it.
- **No hard-coded entity IDs.** Resolve by stable function-name through `config.entities[key]`; the
  `no-bare-hass-states` gate keeps `hass.states` access inside `src/data/` (plus the editor).
- **Import `RECONCILE_TIMEOUT_MS`** from `components/quick-actions.ts` (and other shared constants from their owning module); never re-declare a
  literal locally.
- **`@mdi/js` named imports only** — no wildcard / default imports (keeps the bundle from pulling the
  whole icon set; checked by `import-allowlist`).
- Minimum supported Home Assistant runtime is **2024.4.0**; every widget the card uses predates it.

---

## 12. Consuming the card in Home Assistant

```yaml
type: custom:tesla-card
name: Model Y
# entities auto-resolve; override per-key only if needed:
# entities:
#   battery_level: sensor.my_tesla_battery_level
```

For the full user-facing options table and entity-resolution behaviour, see the card
[`README.md`](../README.md); for the no-YAML setup experience, use the GUI editor (the card's
**Edit** pencil in Lovelace). Related docs: contributor workflow in
[`CONTRIBUTING.md`](../CONTRIBUTING.md), runtime/setup issues in
[`docs/troubleshooting.md`](./troubleshooting.md), release mechanics in
[`PUBLISHING.md`](../PUBLISHING.md), and the gate details in [`docs/ci.md`](./ci.md).

---

_Generated by the BMAD `document-project` workflow (exhaustive scan, 2026-06-24 — Epics 9–11
regeneration); drift-reconciled 2026-07-20 against `main` @ `3b08d7f` (post-Epics 13–17, v1.0.0,
census gate)._
