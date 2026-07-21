# Publishing to HACS

> **Status (2026-07-20).** **v1.0.0 is released** — tagged `v1.0.0`, with a
> GitHub Release carrying the CI-built `tesla-card.js` asset. Installation via
> **HACS custom repository** (§3) is the **live channel**. Submission to the
> **HACS default store** (§4) is the documented next step, **deferred by
> decision** — pending, not blocked; the card ships and installs today.

## 1. Repository layout

HACS expects a **dedicated repository** with `hacs.json` at its root, and this
repo is already one: `origin` points at `github.com/mlmeehan/tesla-card` and
everything HACS needs lives at the repo root — `hacs.json`, `README.md`,
`src/`, the build config, and `.github/workflows/`.

> The repo root must contain `hacs.json`. The `name` in `hacs.json` is the
> display name; `filename: tesla-card.js` must match the release asset; and
> `homeassistant` (currently `2024.4.0`) pins the minimum supported HA version.

## 2. Cut a release

The bundle (`dist/tesla-card.js`) is **git-ignored** — it is never committed.
Instead, `.github/workflows/release.yml` builds it on every published release
and attaches it as a release asset, which is what HACS downloads.

The flow that shipped v1.0.0 (bump → PR merge → tag → Release), using the next
release `v1.0.1` as the worked example:

```bash
# 1. Bump the version in BOTH package.json (`version`) and src/const.ts
#    (`CARD_VERSION`) to the new number — they must match (version-sync gate).
# 2. Land that on the default branch via PR (CI green), as v1.0.0 did (PR #10).
# 3. Tag the merged commit and push the tag:
git tag v1.0.1 && git push origin v1.0.1
# 4. Create a GitHub Release for the tag — this is what triggers release.yml:
gh release create v1.0.1 --generate-notes
```

On publish, `release.yml` runs `npm ci`, asserts the published tag equals
`v${version}` (= `v${CARD_VERSION}`) via the `version-sync --release-tag` check,
runs `npm run build`, and uploads `dist/tesla-card.js` to the release. Confirm
the asset appears on the release page before continuing.

### Release checklist

> Items marked *CI-enforced* can no longer drift silently: the `version-sync`
> lint gate (`scripts/lint/version-sync.mjs`, part of `npm run lint`) fails CI
> on `package.json` `version` ↔ `src/const.ts` `CARD_VERSION` drift and pins
> `hacs.json` `filename` to the Rollup output basename; `release.yml`
> asserts `tag === v${version}` at release time.

- [ ] `package.json` `version` and `src/const.ts` `CARD_VERSION` match the tag *(CI-enforced: `version-sync` gate + `release.yml` tag check)*
- [ ] `npm run typecheck` clean
- [ ] `npm run build` succeeds locally (sanity check only — HACS ships the asset built by `release.yml`, not local `dist/`)
- [ ] `docs/screenshot-charging.png` (and any others referenced) committed
- [ ] `hacs.json` `filename` matches the release asset name *(CI-enforced: `version-sync` gate)*
- [ ] CI green on the default branch
- [ ] GitHub Release created → `tesla-card.js` attached as an asset

## 3. Install via HACS (custom repository)

Until the card is in the HACS default store, users add it as a custom
repository — steps are in the [README install section](README.md#hacs-recommended).
HACS registers the resource automatically; YAML-mode dashboards need a manual
`resources:` entry (also covered there).

## 4. Submit to the HACS default store

The documented **next step** — one-click discoverability without the custom-repo
step. **Deferred by decision** for now: it is pending, not blocked, and the card
already ships and installs via §3. When you choose to proceed:

1. Ensure CI is green — `.github/workflows/validate.yml` runs the official
   `hacs/action@main` plugin check plus a type-check and build.
2. Add the brand to <https://github.com/home-assistant/brands> (a `tesla-card`
   logo/icon PR) — HACS requires this for default-store inclusion.
3. Open a PR against <https://github.com/hacs/default> adding
   `mlmeehan/tesla-card` under `plugin`.
