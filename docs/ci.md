# tesla-card — CI Pipeline

**Part:** `[card]` · **Path:** `tesla-card/` (separate nested git repo) · **Last Updated:** 2026-06-15
**Platform:** GitHub Actions · **Runtime:** Node 20 (`.nvmrc`)

How the card's continuous-integration pipeline is structured, what gates a change must
clear, and how to reproduce it locally. Test-authoring details live in
[`../tests/README.md`](../tests/README.md); release mechanics in [`../PUBLISHING.md`](../PUBLISHING.md).

---

## Workflow model

Three workflows under `.github/workflows/`. E2E is owned by **`test.yml`** so it runs
**once** per push/PR (it was removed from `validate.yml` to avoid double-running).

| Workflow | Triggers | Jobs (check names) | Purpose |
|---|---|---|---|
| **`validate.yml`** | push · PR · weekly cron · dispatch | `HACS`, `Type-check & build` | HACS packaging validation + bundle build gate |
| **`test.yml`** | push→`main` · PR · weekly cron · dispatch | `Type-check`, `E2E (Playwright)`, `Burn-In (flaky detection)`, `Report` | The quality pipeline |
| **`release.yml`** | `release: published` | `Build & attach bundle` | Builds + attaches `dist/tesla-card.js` to the release |

### `test.yml` stages

```
lint (Type-check) ──> test (E2E Playwright) ──> burn-in (PR/cron/dispatch) ──> report (always)
```

- **lint** — `npm run typecheck` + `npm run typecheck:e2e`. This project has no ESLint;
  strict `tsc` is its linter. Covers both the bundle (`tsconfig.json`) and the E2E suite
  (`tests/tsconfig.json`).
- **test** — `npm run test:e2e` (Playwright drives the offline `demo/` harness). On CI the
  config auto-enables `retries:2`, `workers:2`, `forbidOnly`. Uploads `playwright-report/`
  + `test-results/` (HTML report, JUnit XML, traces/videos) on `!cancelled()`.
- **burn-in** — `playwright test --repeat-each=N --retries=0` in one server session.
  Retries are forced **off** so a single flake fails the job. Gated to PR / weekly schedule /
  manual dispatch (default `N=10`; override via the `burn_in_iterations` dispatch input).
- **report** — writes a stage-results table to the GitHub run summary (`$GITHUB_STEP_SUMMARY`).

Top-level `concurrency: cancel-in-progress` cancels superseded runs on the same ref.

---

## Quality gates

A change is green when **every** job above passes:

- **Type gate** (`Type-check`) — strict TS, bundle + E2E.
- **E2E gate** (`E2E (Playwright)`) — 100% of the suite must pass (no partial-pass threshold;
  Playwright exits non-zero on any failure → the job fails). `@visual` specs are excluded
  from the default gate (opt in with `VISUAL=1`).
- **Flake gate** (`Burn-In`) — on PRs, the suite must survive `--repeat-each` with retries off.
- **Packaging gate** (`validate.yml`) — `HACS` + `Type-check & build` (bundle emitted).

### Enforce as required checks (recommended)

After these workflows land on `main`, protect the branch so the checks must pass before merge:

```bash
gh api -X PUT repos/mlmeehan/tesla-card/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Type-check' \
  -f 'required_status_checks[contexts][]=E2E (Playwright)' \
  -f 'required_status_checks[contexts][]=Burn-In (flaky detection)' \
  -f 'required_status_checks[contexts][]=HACS' \
  -f 'required_status_checks[contexts][]=Type-check & build' \
  -f 'enforce_admins=false' \
  -f 'required_pull_request_reviews=' \
  -f 'restrictions='
```

> Requires repo-admin auth (`gh auth status`). `Burn-In` only runs on PRs — requiring it
> means PRs that change nothing testable still run it; drop that context if you'd rather keep it advisory.

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

## Run it locally (1:1 parity)

| Command | Mirrors |
|---|---|
| `npm run ci:local` | The whole gate: `npm ci` → typecheck → typecheck:e2e → build + bundle check → `CI=1` e2e |
| `npm run test:e2e:burn-in` | The `burn-in` job (`--repeat-each=10 --retries=0`); pass a count via `./scripts/burn-in.sh 20` |
| `npm run test:e2e` | The `test` job's E2E run |

`CI=1` is what flips Playwright into CI mode locally (retries/workers/forbidOnly), so a green
`ci:local` is a strong predictor of a green pipeline.

---

## Troubleshooting

- **Passes locally, fails in CI** — run `npm run ci:local` (it sets `CI=1` and does a clean
  `npm ci`), the closest local mirror of the runner.
- **Cache miss / slow chromium install** — first run on a new lockfile repopulates the
  `ms-playwright` cache; subsequent runs restore it. Check the job log for `Cache restored`.
- **Burn-in too slow** — it's PR/cron/dispatch-only by design. Lower the `burn_in_iterations`
  dispatch input, or trim the `if:` triggers on the `burn-in` job.
- **`forbidOnly` failure** — a `test.only`/`describe.only` was committed; remove it.

_Burn-in/caching/artifact strategy follows the TEA `ci-burn-in` knowledge fragment._
