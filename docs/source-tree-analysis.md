# tesla-card — Source Tree Analysis

**Part:** `[card]` · **Path:** `tesla-card/` · **Date:** 2026-06-14

Annotated structure of the tesla-card sub-project. For what each piece does at runtime, see
[`architecture.md`](./architecture.md) and [`component-inventory.md`](./component-inventory.md).

---

## Complete Directory Structure

```
tesla-card/                       # separate nested git repo (gitignored by the parent HA repo)
├── package.json                  # npm pkg: scripts (build/watch/typecheck/demo), deps lit + @mdi/js, ESM
├── package-lock.json             # npm lockfile (committed)
├── tsconfig.json                 # strict TS; useDefineForClassFields:false (load-bearing for Lit)
├── rollup.config.mjs             # bundles src/tesla-card.ts → dist/tesla-card.js (ES, inlined, terser)
├── hacs.json                     # HACS plugin manifest: filename tesla-card.js, min HA 2024.4.0
├── README.md                     # user docs: features, install, options table, entity resolution
├── PUBLISHING.md                 # HACS extraction + release/version-sync checklist
├── LICENSE                       # MIT
├── .gitignore                    # ignores node_modules/, dist/, *.tsbuildinfo, .rollup.cache/
├── .github/workflows/
│   ├── validate.yml              # CI: hacs/action plugin check + typecheck/build + bundle-exists test
│   └── release.yml               # on release: build & attach dist/tesla-card.js (Node 20)
├── demo/
│   ├── index.html                # mock-hass harness; awake/asleep + default/renamed envs; ?panel/scenario/env
│   └── car.svg                   # placeholder car render for the demo
├── docs/                         # ← this documentation set
│   ├── index.md
│   ├── architecture.md
│   ├── component-inventory.md
│   ├── development-guide.md
│   └── source-tree-analysis.md
└── src/
    ├── tesla-card.ts             # PARENT @customElement('tesla-card'): orchestration, tabs,
    │                             #   entity-resolution memo, Lovelace contract, child registration, banner
    ├── base.ts                   # TcBase extends LitElement → supplies @property hass + config to children
    ├── const.ts                  # CARD_VERSION, DEFAULT_IMAGE, DEFAULT_ENTITIES (88 keys), EntityKey type
    ├── types.ts                  # HomeAssistant, HassEntity, LovelaceCard(Editor), PanelId, TeslaCardConfig
    ├── styles.ts                 # design tokens (--tc-*) + sharedStyles (reusable classes, keyframes)
    ├── ui.ts                     # UI primitives: icon, statTile, batteryGauge, ring (TemplateResult builders)
    ├── helpers.ts                # state/format/service helpers (entityId, rawState, num, display, toggleEntity, clamp, …)
    ├── resolve.ts                # entity resolution by stable function-name (slugify, detectVehicle, resolveEntities)
    ├── editor.ts                 # @customElement('tesla-card-editor'): GUI config editor (lazy-loaded)
    └── components/
        ├── hero.ts               # tc-hero: centered car render, status line, tappable battery bar
        ├── quick-actions.ts      # tc-quick-actions: 6 circular toggles (lock/climate/port/frunk/trunk/sentry)
        ├── commands.ts           # tc-commands: 6 button.press commands (wake/honk/flash/homelink/keyless/boombox)
        ├── panel-climate.ts      # tc-panel-climate: temp stepper, seat/wheel heaters, defrost, cabin-overheat
        ├── panel-charging.ts     # tc-panel-charging: battery summary, start/stop, limit/current sliders, stat tiles
        ├── panel-closures.ts     # tc-panel-closures: tappable top-down SVG (frunk/trunk/windows/port/sunroof) + lock
        ├── panel-tyres.ts        # tc-panel-tyres: per-corner pressures with low warnings
        ├── panel-location.ts     # tc-panel-location: OpenStreetMap iframe + odo/speed/power/ETA tiles
        ├── panel-media.ts        # tc-panel-media: now-playing, transport, mute + volume slider
        └── slider.ts             # tc-slider: reusable pointer-drag bar (extends LitElement); value-changed on release
```

`dist/` is **not** shown — it is gitignored and produced by `npm run build` / CI.

---

## Entry Point

- **Bundle entry:** `src/tesla-card.ts` → Rollup → `dist/tesla-card.js`. This file defines the
  `tesla-card` element, side-effect-imports all children, and registers the card with
  `window.customCards`.

## File Organization Patterns

| Layer | Location | Convention |
|---|---|---|
| Element shell / orchestration | `src/tesla-card.ts` | one top-level `@customElement` |
| Shared base | `src/base.ts` | `TcBase` supplies `hass` + resolved `config` |
| Children | `src/components/*.ts` | one `tc-*` element per file; side-effect registered |
| Pure data/logic | `src/{const,types,resolve,helpers}.ts` | no DOM; entity catalog + resolution + utils |
| Presentation | `src/{styles,ui}.ts` | tokens, shared classes, `TemplateResult` primitives |
| Editor | `src/editor.ts` | lazy-loaded GUI config |

## Critical Files

| File | Why it matters |
|---|---|
| `src/tesla-card.ts` | The card; orchestrates everything and owns the Lovelace contract |
| `src/resolve.ts` + `src/const.ts` | Entity resolution — the card's core robustness mechanism |
| `src/base.ts` | Defines the `hass`/`config` contract every child relies on |
| `src/styles.ts` | Single source of `--tc-*` design tokens |
| `tsconfig.json` | `useDefineForClassFields: false` is load-bearing for Lit reactivity |
| `rollup.config.mjs` | Single-file bundle config; inlines the lazy editor |

---

_Generated by the BMAD `document-project` workflow (deep scan, 2026-06-14)._
