# Publishing to HACS

This card currently lives in the `tesla-card/` subdirectory of a larger
Home Assistant config repo. HACS expects a **dedicated repository** with
`hacs.json` at its root, so the first step is to extract this folder into its
own repo.

## 1. Extract into a standalone repo

The card is self-contained — everything HACS needs (`hacs.json`, `README.md`,
`src/`, build config, workflows) is inside `tesla-card/`.

```bash
# from the home-assistant repo root
git subtree split --prefix tesla-card -b tesla-card-export

# create the empty repo on GitHub first (github.com/mlmeehan/tesla-card), then:
git push git@github.com:mlmeehan/tesla-card.git tesla-card-export:main
```

Or simply copy the folder into a fresh clone:

```bash
cp -R tesla-card/ ../tesla-card-repo && cd ../tesla-card-repo
git init && git add -A && git commit -m "feat: initial Tesla Card"
git remote add origin git@github.com:mlmeehan/tesla-card.git
git push -u origin main
```

> The repo root must contain `hacs.json`. The `name` in `hacs.json` is the
> display name; `filename: tesla-card.js` must match the release asset.

## 2. Cut a release

The bundle (`dist/tesla-card.js`) is **git-ignored** — it is not committed.
Instead, `.github/workflows/release.yml` builds it on every published release
and attaches it as a release asset, which is what HACS downloads.

```bash
# bump version in package.json + src/const.ts (CARD_VERSION) to match the tag
git tag v0.1.0 && git push origin v0.1.0
# then create a GitHub Release pointing at that tag (gh release create v0.1.0 --generate-notes)
```

On publish, the workflow runs `npm ci && npm run build` and uploads
`dist/tesla-card.js` to the release. Confirm the asset appears on the release
page before continuing.

## 3. Install via HACS (custom repository)

Until the card is accepted into the HACS default store, install it as a custom
repo:

1. HACS → **⋮** → *Custom repositories*
2. URL `https://github.com/mlmeehan/tesla-card`, category **Dashboard**
3. Install **Tesla Card**, then hard-reload the browser (Cmd/Ctrl+Shift+R)

HACS registers the resource automatically. For YAML-mode dashboards add it
manually under `resources:` (see `README.md`).

## 4. (Optional) Submit to the HACS default store

For one-click discoverability without the custom-repo step:

1. Ensure CI is green — `.github/workflows/validate.yml` runs the official
   `hacs/action@main` plugin check plus a type-check + build.
2. Add the brand to <https://github.com/home-assistant/brands> (a `tesla-card`
   logo/icon PR) — HACS requires this for default-store inclusion.
3. Open a PR against <https://github.com/hacs/default> adding
   `mlmeehan/tesla-card` under `plugin`.

## Release checklist

> **Now CI-enforced (Story 7.4):** the first and fifth items below are no longer a
> manual tick — the `version-sync` lint gate (`scripts/lint/version-sync.mjs`, the
> 6th structural gate in `npm run lint`) fails CI on any `package.json` `version` ↔
> `src/const.ts` `CARD_VERSION` drift and pins `hacs.json` `filename` ↔ the Rollup
> output basename = `tesla-card.js`. The **git tag** leg (`tag === v${version}`) is
> asserted at release time in `release.yml`. Keep the boxes for the human's awareness,
> but a drift can no longer slip past CI.

- [ ] `package.json` `version` and `src/const.ts` `CARD_VERSION` match the tag *(CI-enforced: `version-sync` gate + `release.yml` tag check)*
- [ ] `npm run typecheck` clean
- [ ] `npm run build` produces `dist/tesla-card.js`
- [ ] `docs/screenshot-charging.png` (and any others referenced) committed
- [ ] `hacs.json` `filename` matches the release asset name *(CI-enforced: `version-sync` gate)*
- [ ] CI green on the default branch
- [ ] GitHub Release created → `tesla-card.js` attached as an asset
