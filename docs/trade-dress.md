# Trade-dress safety — gate + human review

No Tesla trade dress ships in this card: no logos, no wordmarks, no "T" badge, no
brand colour (`#e82127`), no marketing colour names, no option codes, and no
vehicle artwork. The bundled hero is a deliberately **generic EV** silhouette.

This is enforced in **two layers** — an automated gate and a human-review step.
The gate is **necessary, not sufficient**: a regex can see source tokens and file
names, but not rendered image content. Net-new asset categories must be reviewed
by a human.

## Layer 1 — the automated gate (merge-blocking)

`scripts/lint/trade-dress-denylist.mjs`, wired into `npm run lint` (3rd gate,
beside `no-bare-hass.states` + `no-cycle`) and the merge-blocking `lint` job in
`.github/workflows/validate.yml`. It scans the **committed** tree (`git ls-files`
— gitignored working art like `assets/*.svg` and CI-built `dist/` are out of
scope) and fails the build on:

- **Brand red `#e82127`** used as a style value, plus its `rgb(232,33,39)` /
  `hsl(~357°)` forms.
- **Tesla option / paint codes** — `PPSW`, `PBSB`, `PBCW`, `PMBL`, `PMNG`, `PN00`,
  `PMSS`, `PN01`, `PPSB`, `PPMR`, `PR00`, `PR01` (word-bounded, case-insensitive).
- **Tesla wordmark with a ®/™ brand mark.**
- **Committed Tesla logo/badge/wordmark/raster asset filenames** (filename only —
  the gate can't inspect pixels).

The pattern list inside the script is the **maintained, append-only denylist**.
Extend it when a new leak vector appears; never weaken it silently.

### What the gate deliberately does NOT flag (and why)

The project is legitimately *named* `tesla-card` (the repo, the `<tesla-card>`
element, the `tesla_fleet` integration id, the `tesla-card.page.ts` page object),
and a few meta-files mention `#e82127` precisely to **assert its absence**
(`src/log.test.ts`, the gate, the gate's test — listed in the gate's
`CONTENT_SKIP`). Factual product references ("Tesla Powerwall", "the official
Tesla Fleet integration") and the required legal disclaimer ("Not affiliated with
Tesla, Inc.") are **not** branding misuse. The gate stays conservative on the
wordmark on purpose — a gate that flags `tesla-card` on every line gets disabled.
False-negatives there are caught by Layer 2.

## Layer 2 — human review for net-new asset categories

A regex can't see a logo inside a raster. Whenever a change adds a **new asset
category** — a committed image/vector render, a font, an icon set, a new colour
palette — a reviewer must manually confirm:

- [ ] No Tesla logo, "T" badge, or wordmark appears in the artwork (open the file
      and look — pixels, not filenames).
- [ ] No traced/derivative Tesla vehicle silhouette is **committed** (personal
      verification art stays in `demo/local/`, gitignored; runtime art lives in
      the user's `config/www/tesla-card/`, never in this repo — such art is fine
      on a private install).
- [ ] No Tesla brand colour, marketing name, or option code is reintroduced (run
      `npm run lint` — but also eyeball anything a regex can't tokenise).
- [ ] If a genuinely new leak vector appears, **add a pattern** to the gate's
      append-only denylist so it's caught automatically next time.
