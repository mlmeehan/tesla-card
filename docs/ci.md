# tesla-card — CI Pipeline

**Repo:** `tesla-card/` (public, standalone git repo) · **Last Updated:** 2026-06-24
**Platform:** GitHub Actions · **Runtime:** Node 20 (`.nvmrc` + CI) · **Version:** 0.2.0

How the card's continuous-integration pipeline is structured, what gates a change must
clear, and how to reproduce it locally. Test-authoring details live in
[`../tests/README.md`](../tests/README.md); release mechanics in [`../PUBLISHING.md`](../PUBLISHING.md).

The shipped artifact is a **single Rollup ES bundle** `dist/tesla-card.js` (~346–360 KB,
`inlineDynamicImports: true`), with **only two runtime deps** (`lit` + `@mdi/js`). `dist/`
is gitignored and built in CI — never committed.

---

## Workflow model

Three workflows under `.github/workflows/`. E2E is owned by **`test.yml`** so it runs
**once** per push/PR (it was removed from `validate.yml` to avoid double-running).

| Workflow | Triggers | Jobs (check names) | Purpose |
|---|---|---|---|
| **`validate.yml`** ("Validate") | push · PR · weekly cron `0 3 * * 1` · dispatch | `HACS`, `Type-check & build`, `Structural gates (lint)` | HACS packaging validation + bundle build gate + the 8 structural lint gates |
| **`test.yml`** ("Test Pipeline") | push→`main` · PR · weekly cron `0 2 * * 0` · dispatch | `Type-check`, `Unit (Vitest)`, `E2E (Playwright)`, `Burn-In (flaky detection)`, `Report` | The quality pipeline |
| **`release.yml`** ("Release") | `release: published` | `Build & attach bundle` | Asserts the release tag, builds, and attaches the single `dist/tesla-card.js` |

### `validate.yml` jobs

Three **independent** jobs (no `needs` — they fan out in parallel):

- **`hacs`** (`validate.yml:hacs`) — `hacs/action@main` with `category: plugin`. Validates
  HACS plugin packaging.
- **`build`** (`validate.yml:build`) — Node 20: `npm ci` → `npm run typecheck` →
  `npm run build` → `test -s dist/tesla-card.js` (bundle was produced and is non-empty).
- **`lint`** (`validate.yml:lint`) — Node 20: `npm ci` → `npm run lint` (all **8** structural
  gates, in order). Its leading comment is stale — see the **Stale echoes (harmless)** note
  under Local parity.

### `test.yml` stages

```
lint (Type-check) ──> unit (Vitest) ───┐
                  └──> test (E2E) ──> burn-in (PR/cron/dispatch) ──> report (always)
```

`unit` and `test` both `needs: lint`; `burn-in` `needs: test`; `report` `needs: [unit, test, burn-in]`.

- **lint** (`test.yml:lint`, "Type-check") — `npm run typecheck` + `npm run typecheck:e2e`.
  This project has **no ESLint**; strict `tsc` is its type-lint. Covers both the bundle
  (`tsconfig.json`) and the E2E suite (`tests/tsconfig.json`). The **8 structural lint gates**
  (`npm run lint`) run in `validate.yml`'s `lint` job, not here.
- **unit** (`test.yml:unit`, "Unit (Vitest)") — `npm run test` (the co-located Vitest unit
  suite — **65 files / ~1,578 cases**, node env, fully offline: committed fixtures only, no
  network, no live HA, no browser). The Rollup release path is not exercised here.
- **test** (`test.yml:test`, "E2E (Playwright)") — `npm run test:e2e` (Playwright drives the
  offline `demo/` mock-hass harness — **24 specs / ~293 cases**). On CI the config
  auto-enables `retries:2`, `workers:2`, `forbidOnly`. Caches `~/.cache/ms-playwright`,
  installs chromium, then uploads `playwright-report/` + `test-results/` (HTML report,
  JUnit XML, traces/videos) on `!cancelled()` (7-day retention).
- **burn-in** (`test.yml:burn-in`, "Burn-In (flaky detection)") — `playwright test
  --repeat-each=N --retries=0` in one server session. Retries are forced **off** so a single
  flake fails the job. Gated to PR / weekly schedule / manual dispatch (default `N=10`,
  overridable via the `burn_in_iterations` dispatch input; the value is range-checked and
  sanitized to `10` if non-numeric).
- **report** (`test.yml:report`) — `if: always()`; writes a per-stage results table to the
  GitHub run summary (`$GITHUB_STEP_SUMMARY`).

Top-level `concurrency: { group, cancel-in-progress: true }` cancels superseded runs on the
same ref.

### `release.yml` (publish path)

Single `build` job (`release.yml:build`), Node 20, triggered on `release: published` with
`permissions: contents: write`:

1. `npm ci`
2. **Tag assertion** — `node scripts/lint/version-sync.mjs --release-tag "$RELEASE_TAG"`. The
   release tag is passed via `env: RELEASE_TAG: ${{ github.event.release.tag_name }}` and
   **never** interpolated as `${{ }}` into the shell — this prevents tag-name script
   injection. The sub-mode asserts the published tag equals `v${version}`.
3. `npm run build`
4. **Attach** `dist/tesla-card.js` via `softprops/action-gh-release@v2`. The bundle's banner
   version comes from `CARD_VERSION` (not stamped from the tag); the assertion in step 2
   guarantees the tag already agrees with it, so no stamping is needed.

---

## The 8 structural lint gates

`npm run lint` runs all eight `scripts/lint/*.mjs` gates **in this order**. Each is an
ESM/Node-20 script, CLI-guarded via `import.meta.url` so its co-located Vitest test can import
the pure matcher without triggering a repo scan; each prints a greppable `FAIL`/`ok` and exits
non-zero on a violation. **There is no ESLint** — strict `tsc` (the `Type-check` job) is the
type-lint, and these gates are the structural/policy lint.

| # | Gate (`scripts/lint/…`) | Enforces |
|---|---|---|
| 1 | `no-bare-hass-states.mjs` (AR-1) | `hass.states`/`.entities`/`.devices` reads allowed ONLY in `src/data/`; TS-AST walk (comment-safe). Self-invalidating BASELINE (`helpers.ts`, `tesla-card.ts`, the reviewed `editor.ts` Story-9.10 exception) — *errors* if a baseline entry no longer contains a bare read, so the boundary ratchets shut. |
| 2 | `no-cycle.mjs` (AR-11) | The `src/` relative-import graph must be acyclic (guards `data/ ← flow/ ← components/`). TS-AST runtime edges (type-only imports erased), DFS cycle detection. |
| 3 | `trade-dress-denylist.mjs` (AR-12) | No Tesla trade dress in the committed tree (`git ls-files`): brand red `#e82127` as a style value + its rgb()/hsl() forms, Tesla option codes, the wordmark with ®/™, and committed `tesla-*` image filenames. "Necessary, not sufficient"; `CONTENT_SKIP` exempts 6 absence-asserting meta files. |
| 4 | `import-allowlist.mjs` (NFR-2) | Every runtime bare/package import in non-test `src/` must resolve to `lit` / `lit/*` / `@mdi/js`. `@mdi/js` is **named-import only** (default / namespace-barrel / side-effect forms FAIL — they defeat tree-shaking). TS-AST records import kind, including dynamic `import()`. |
| 5 | `no-network-egress.mjs` (AR-17) | No `fetch` / `sendBeacon` / `new XMLHttpRequest`/`WebSocket`/`EventSource`/`RTCPeerConnection` in the bundled graph (a `this.fetch`/`x.fetch` member is allowed). Only `hass.callService`/`callWS`/`callApi`/`connection.*` are sanctioned — the card opens no connection of its own and ships no telemetry. |
| 6 | `version-sync.mjs` (NFR-5) | `package.json` `version` === `src/const.ts` `CARD_VERSION`, AND `hacs.json` `filename` === Rollup output basename === `tesla-card.js`; asserts EXACTLY ONE match for each (a reformat fails loudly). The git-tag leg (`checkReleaseTag`) is invoked only by `release.yml` via `--release-tag`. |
| 7 | `token-defined.mjs` | Every `var(--tc-*)` a component references must be DEFINED in `styles.ts` `:host` or set locally — catches the Epic-8 "undefined token hiding behind a fallback literal" bug class. Polices the `--tc-*` namespace only (HA theme tokens are out of scope). |
| 8 | `no-planning-artifacts.mjs` | Keeps BMAD/planning artifacts (PRD, epics, `<epic>-<story>-<slug>.md` stories, `sprint-status.yaml`, retros, …) out of this public repo. `DIR_DENY` (`_bmad/`, `.claude/`, `stories/`) + `NAME_DENY`; a `KEEP` allowlist pins the 6 doc-project outputs kept public (`docs/architecture.md`, etc.). Three modes: `--tracked` (CI), `--staged` (pre-commit), `--check <paths>` (Claude git-add guard). |

---

## Quality gates

A change is green when **every** job above passes:

- **Type gate** (`Type-check`)
- **Unit gate** (`Unit (Vitest)`)
- **E2E gate** (`E2E (Playwright)`) — 100% of the suite must pass (no partial-pass threshold;
  Playwright exits non-zero on any failure → the job fails). The 2 opt-in `@visual` baseline
  specs are **excluded** from the default gate (`grepInvert: /@visual/`); opt in with
  `VISUAL=1` / `npm run test:e2e:visual`.
- **Flake gate** (`Burn-In`)
- **Packaging + structural gate** (`validate.yml`) — `HACS` + `Type-check & build` +
  `Structural gates (lint)` (the 8-gate `npm run lint` chain — see §The 8 structural lint gates).

### Enforce as required checks (recommended)

After these workflows land on `main`, protect the branch so the checks must pass before merge:

```bash
gh api -X PUT repos/mlmeehan/tesla-card/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Type-check' \
  -f 'required_status_checks[contexts][]=Unit (Vitest)' \
  -f 'required_status_checks[contexts][]=E2E (Playwright)' \
  -f 'required_status_checks[contexts][]=Burn-In (flaky detection)' \
  -f 'required_status_checks[contexts][]=HACS' \
  -f 'required_status_checks[contexts][]=Type-check & build' \
  -f 'required_status_checks[contexts][]=Structural gates (lint)' \
  -f 'enforce_admins=false' \
  -f 'required_pull_request_reviews=' \
  -f 'restrictions='
```

> Requires repo-admin auth (`gh auth status`). `Burn-In` only runs on PRs/cron/dispatch —
> requiring it means PRs that change nothing testable still run it; drop that context if you'd
> rather keep it advisory.

---

## Local parity

| Command | Mirrors |
|---|---|
| `npm run ci:local` (`scripts/ci-local.sh`) | The whole gate: `npm ci` → typecheck → typecheck:e2e → `npm run lint` (all 8 gates) → build + bundle-exists check → `CI=1` e2e |
| `npm run lint` | The `validate.yml` `Structural gates (lint)` job (all 8 gates, in order) |
| `npm run test:e2e:burn-in` (`scripts/burn-in.sh`) | The `burn-in` job (`--repeat-each=10 --retries=0`, one server session); pass a count: `./scripts/burn-in.sh 20` |
| `npm run test:e2e` | The `test` job's E2E run |
| `npm run test` | The `unit` job (Vitest) |

`CI=1` is what flips Playwright into CI mode locally (retries/workers/forbidOnly), so a green
`ci:local` is a strong predictor of a green pipeline.

> **Stale echoes (harmless):** `ci-local.sh` prints a banner naming only 5 of the 8 gates, but
> it runs `npm run lint` (all 8). Same for the comment block in `validate.yml`'s `lint` job,
> which names only 6 — it predates `token-defined` + `no-planning-artifacts`. The chain itself
> is the source of truth.

### The native pre-commit hook

`scripts/hooks/pre-commit` is **Layer 1 of the planning-artifact guard** — it runs on every
`git commit` by any committer (you, Claude, a bot), checks only the **staged** set, and
delegates the deny decision to `no-planning-artifacts.mjs --staged`. It catches a `git add -f`
that bypassed `.gitignore` and catches the human (which `.gitignore` and the Claude-only
PreToolUse hooks cannot).

It is wired via `core.hooksPath = scripts/hooks`, set by the package.json **`prepare`** script
on `npm install` / `npm ci`:

```jsonc
"prepare": "git rev-parse --git-dir > /dev/null 2>&1 && git config core.hooksPath scripts/hooks || true"
```

To install by hand: `git config core.hooksPath scripts/hooks`. The hook degrades gracefully
(warn + allow) if `node` is absent, since CI's `npm run lint --tracked` is the un-bypassable
backstop. Bypass is intentionally noisy (`git commit --no-verify`) — but the Claude guard
still checks `--no-verify` commits, and `npm run lint` / CI re-check the whole tracked tree.

---

## The NFR-1 FPS profiler (NOT a CI job)

`npm run profile:nfr1` (`scripts/profiler/fps-probe.{sh,mjs}`) is the **NFR-1 ~60fps
composed-Scene gate**: it builds the bundle, serves the demo, opens the `?card=my-home` Scene
in **headed** Chromium, validates the CDP CPU throttle (`RATES=1,4,6×`) via a busy-loop, then
measures steady-state rAF cadence and dropped frames. Artifacts land in `scripts/profiler/out/`
(gitignored).

It is **explicitly not a CI job** — headed Chromium needs a real display (true vsync), so it is
a `[PROFILER]`-class human/workstation read, never a CI assertion. A miss degrades *motion*,
never data, and is not a release blocker. See `scripts/profiler/README.md`.

---

## Secrets

**None required.** Every job runs on the auto-provided `GITHUB_TOKEN`:

- `hacs/action@main` validates packaging with `GITHUB_TOKEN` (no PAT).
- `release.yml` attaches the bundle via `GITHUB_TOKEN` (`permissions: contents: write`).

The only optional secret is `SLACK_WEBHOOK_URL` — see Notifications.

---

## Notifications

- **Default:** GitHub emails the actor/watchers on a failed run — no setup needed.
- **Run summary:** the `report` job posts a per-stage results table to the Actions run page.
- **Optional Slack** — add a `SLACK_WEBHOOK_URL` secret, then append to `test.yml`:

  ```yaml
    notify:
      needs: [test, burn-in]
      if: failure()
      runs-on: ubuntu-latest
      steps:
        - uses: slackapi/slack-github-action@v2
          with:
            webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
            webhook-type: incoming-webhook
            payload: '{"text":"tesla-card CI failed on ${{ github.ref_name }}"}'
  ```

---

## Caching

- **npm** — `actions/setup-node@v4` with `cache: npm` (keyed on `package-lock.json`).
- **Playwright browsers** — `actions/cache@v4` on `~/.cache/ms-playwright`, keyed on the
  lockfile hash, with a `restore-keys` fallback. Saves the chromium download on cache hits.

---

## Troubleshooting

- **Passes locally, fails in CI** — run `npm run ci:local` (it sets `CI=1` and does a clean
  `npm ci`), the closest local mirror of the runner.
- **Cache miss / slow chromium install** — first run on a new lockfile repopulates the
  `ms-playwright` cache; subsequent runs restore it. Check the job log for `Cache restored`.
- **Burn-in too slow** — it's PR/cron/dispatch-only by design. Lower the `burn_in_iterations`
  dispatch input, or trim the `if:` triggers on the `burn-in` job.
- **`forbidOnly` failure** — a `test.only`/`describe.only` was committed; remove it.
- **`version-sync` fails on release** — the published tag must be `v${version}` and
  `package.json` `version` must equal `src/const.ts` `CARD_VERSION`; bump both together.
- **Lint gate fails locally** — run the single offending gate directly, e.g.
  `node scripts/lint/token-defined.mjs`; each prints a greppable `FAIL` line.

_Burn-in/caching/artifact strategy follows the TEA `ci-burn-in` knowledge fragment._

---

_Regenerated 2026-06-24 by an exhaustive `document-project` rescan, reflecting Epics 9–11.
Verified against `package.json`, `src/const.ts`, `hacs.json`, the three workflows, the 8
`scripts/lint/*.mjs` gates, `scripts/ci-local.sh`, `scripts/hooks/pre-commit`,
`scripts/burn-in.sh`, and `scripts/profiler/README.md`._
