# Tesla card — E2E tests (Playwright)

End-to-end tests for the `tesla-card` Lovelace card. The system-under-test is the
**demo harness** (`demo/index.html`): a mock-`hass` shell that renders the *real*
bundled card with **zero Home Assistant dependency**. Tests build the card, serve
the demo locally, drive it in a real browser, and assert on what the card renders.

Everything runs **offline and hermetically** — any request that leaves localhost is
aborted (see `support/helpers/hermetic.ts`), so the suite never touches the public
internet and is fully deterministic.

> Test tooling (`@playwright/test`, `http-server`) lives in `devDependencies` only.
> It never enters `dist/tesla-card.js` — the shipped bundle stays dependency-free
> beyond `lit` + `@mdi/js`, per project policy.

---

## Setup

Requires Node 20 (see `../.nvmrc`).

```bash
cd tesla-card
npm install                       # installs @playwright/test, http-server, @types/node
npx playwright install chromium   # one-time browser download (use --with-deps in CI)
```

After `npm install`, commit the updated `package-lock.json` so CI's `npm ci` stays
in sync.

## Running

The Playwright config builds the card and starts the static server automatically
(`webServer`) — you do **not** need to run a server yourself.

```bash
npm run test:e2e            # headless run (the default gate; excludes @visual)
npm run test:e2e:headed     # watch it in a real browser window
npm run test:e2e:ui         # Playwright UI mode (time-travel, pick tests)
npm run test:e2e:debug      # step through with the inspector
npm run test:e2e:report     # open the last HTML report

# Single file / single test:
npx playwright test tests/e2e/panels.spec.ts
npx playwright test -g "default open panel"
```

Type-check the suite (separate from the bundle's `npm run typecheck`):

```bash
npm run typecheck:e2e
```

### Visual snapshots (opt-in)

Cross-OS font/anti-aliasing differences make pixel baselines machine-specific, so
visual tests are tagged `@visual` and **excluded from the default gate**.

```bash
npm run test:e2e:visual                       # run @visual specs
npm run test:e2e:visual -- --update-snapshots  # seed/refresh baselines
```

Baselines are committed per-platform under `e2e/visual.spec.ts-snapshots/`. Generate
them on the machine/OS that will act as the source of truth (or in CI on Linux).

---

## Architecture

```
tests/
├─ e2e/                         # specs (one concern per file)
│  ├─ smoke.spec.ts             # renders cleanly, awake + asleep
│  ├─ panels.spec.ts            # tab nav + auto-detected Energy tab + data flow
│  ├─ entity-resolution.spec.ts # name-based resolution (garage_model_y_* vs my_tesla_*)
│  ├─ hero.spec.ts              # default / paint / image / recolor (guarded) hero modes
│  └─ visual.spec.ts            # @visual screenshot baselines (opt-in)
└─ support/
   ├─ fixtures/
   │  ├─ index.ts               # composed `test`/`expect` (mergeTests) — import from here
   │  ├─ demo-fixture.ts        # `demo` → a ready TeslaCardPage
   │  ├─ console-guard.ts       # auto fixture: fail on unexpected console/page errors
   │  └─ scenarios.ts           # scenario data + expected rendered strings
   ├─ helpers/
   │  ├─ demo-url.ts            # demo-URL factory (the harness param contract)
   │  └─ hermetic.ts            # abort non-localhost requests (offline determinism)
   └─ page-objects/
      └─ tesla-card.page.ts     # selectors as behaviour (tabs, hero, panels)
```

**Fixtures** are small and single-purpose, composed with `mergeTests`. Add a
capability by writing another `base.extend` fixture and merging it in `index.ts`.

- `demo` — a `TeslaCardPage` bound to the test's page. `demo.open(opts)` installs
  hermetic routing, navigates the harness, and waits for first paint.
- `consoleGuard` — **auto-attached** to every test; at teardown it fails the test if
  the card emitted an uncaught exception or an unexpected `console.error`. This
  turns "rendered" into "rendered *cleanly*". Opt out per test with
  `consoleGuard.disable()`, or whitelist a pattern with `consoleGuard.ignore(/…/)`.

**Factory** — `buildDemoUrl(options)` is the single source of truth for the demo's
URL contract (`scenario`, `env`, `panel`, `paint`, `image`, `recolor`, `colorentity`).
Specs describe intent; they never hand-assemble query strings.

**Page object** — `TeslaCardPage` centralises selectors. The card is a Lit web
component with nested shadow roots; Playwright's locator engines pierce open shadow
DOM automatically, so locators scoped to `tesla-card` reach `tc-hero` / `tc-panel-*`.

---

## Best practices baked in

- **Selectors**: tabs are real `<button role="tab">` → `getByRole('tab', { name })`.
  The card ships **no `data-testid`** hooks and this suite does not add any —
  resolution is by role + visible text, which survives refactors. Add `data-testid`
  to the card only if a future surface can't be addressed by role/text.
- **Isolation**: each test gets a fresh Playwright context (no shared state). The
  mock `hass` is rebuilt per navigation by the harness.
- **Determinism / cleanup**: hermetic routing blocks all external hosts, so there are
  no flaky network waits and nothing to tear down. The Location panel's OpenStreetMap
  iframe is intentionally suppressed — never snapshot or assert on map tiles.
- **Stable assertions**: assert on rendered strings the card derives from the mock
  (e.g. `72%`, `235 mi`, `Bohemian Rhapsody`), defined once in `scenarios.ts`.

### The recolor (bring-your-own-art) trap

`?recolor=1` / `?colorentity=` loads photoreal layers from `demo/local/`, which is
**gitignored** (Tesla trade dress stays out of the repo). Those tests are **guarded**
with `test.skip(!hasRecolorArt, …)`: they run on a dev machine that dropped the
layers in and skip on a fresh checkout / CI — never a false failure. CI-safe hero
modes are the bundled generic EV (default), `?paint=`, and `?image=1` (`demo/car.svg`
is committed).

---

## CI integration

A dedicated `e2e` job runs in `.github/workflows/validate.yml` on push/PR (Node 20):

```yaml
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: npm run test:e2e
```

It is separate from the existing `Type-check & build` and `HACS` jobs so each
reports independently. Artifacts (`playwright-report/`, `test-results/`) are
gitignored; upload them with `actions/upload-artifact` if you want them retained.

Tuning already in `playwright.config.ts`: `retries: 2` and `workers: 2` under CI,
`forbidOnly` on, traces/screenshots/video retained on failure.

---

## Knowledge base (BMAD TEA)

Patterns applied here, from the Test Architect knowledge base
(`_bmad/.../bmad-testarch-framework/resources/knowledge/`):

- **fixtures-composition** — `mergeTests` of small fixtures.
- **data-factories** — `buildDemoUrl` + `scenarios.ts`.
- **network-first / network-error-monitor** — hermetic routing + the console guard.
- **selector-resilience** — role/text selectors over brittle CSS/test-ids.
- **playwright-config** — timeout standards, artifact retention, CI parallelism.
- **test-quality** — isolation, deterministic waits (auto-waiting locators only).

> `@seontechnologies/playwright-utils` is intentionally **not** installed. Its value
> is API/auth/network-interception against a live backend; this card harness is
> offline with no backend, so those utilities would be dead weight. Revisit if/when
> tests target a live Home Assistant REST/WebSocket API — then add it and adopt
> `auth-session` / `api-request` / `intercept-network-call`.
