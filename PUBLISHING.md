# Publishing to HACS

## 1. Repository layout

HACS expects a **dedicated repository** with `hacs.json` at its root, and this
repo is already one: `origin` points at `github.com/mlmeehan/tesla-card` and
everything HACS needs lives at the repo root — `hacs.json`, `README.md`,
`src/`, the build config, and `.github/workflows/`.

> The repo root must contain `hacs.json`. The `name` in `hacs.json` is the
> display name; `filename: tesla-card.js` must match the release asset; and
> `homeassistant` (currently `2024.4.0`) pins the minimum supported HA version.

## 2. Cut a release

The bundle (`dist/tesla-card.js`) is **git-ignored** — it is not committed.
Instead, `.github/workflows/release.yml` builds it on every published release
and attaches it as a release asset, which is what HACS downloads.

```bash
# bump version in package.json + src/const.ts (CARD_VERSION) to match the tag, then commit it
git tag v0.2.0 && git push origin v0.2.0
# then create a GitHub Release pointing at that tag (gh release create v0.2.0 --generate-notes)
```

On publish, the workflow runs `npm ci && npm run build` and uploads
`dist/tesla-card.js` to the release. Confirm the asset appears on the release
page before continuing.

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

## 4. (Optional) Submit to the HACS default store

For one-click discoverability without the custom-repo step:

1. Ensure CI is green — `.github/workflows/validate.yml` runs the official
   `hacs/action@main` plugin check plus a type-check and build.
2. Add the brand to <https://github.com/home-assistant/brands> (a `tesla-card`
   logo/icon PR) — HACS requires this for default-store inclusion.
3. Open a PR against <https://github.com/hacs/default> adding
   `mlmeehan/tesla-card` under `plugin`.
