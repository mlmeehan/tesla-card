# tesla-card — Source Tree Analysis

**Part:** `[card]` · **Path:** `tesla-card/` · **Date:** 2026-06-20

Annotated structure of the tesla-card sub-project. For what each piece does at runtime, see
[`architecture.md`](./architecture.md) and [`component-inventory.md`](./component-inventory.md).

> Regenerated after Epic 6. Supersedes the 2026-06-14 tree (which predated the `data/`+`flow/`
> layers, the panel/control surface, the ecosystem cards, and the Scene).

---

## Complete Directory Structure

```
tesla-card/                       # separate nested git repo (gitignored by the parent HA repo)
├── package.json                  # npm pkg: scripts (build/watch/typecheck/test/lint/e2e), deps lit + @mdi/js, ESM
├── package-lock.json             # npm lockfile (committed)
├── tsconfig.json                 # strict TS; useDefineForClassFields:false (load-bearing for Lit)
├── rollup.config.mjs             # bundles src/tesla-card.ts → dist/tesla-card.js (ES, inlined, terser)
├── vitest.config.* / playwright.config.*   # unit (jsdom) + e2e/visual config
├── hacs.json                     # HACS plugin manifest: filename tesla-card.js, min HA 2024.4.0
├── README.md · PUBLISHING.md · LICENSE     # user docs · release/version-sync checklist · MIT
├── .github/workflows/            # validate.yml (CI gates) · release.yml (asset attach, Node 20)
├── scripts/
│   ├── lint/                     # the 5-gate lint chain (dep-light node scripts, NOT ESLint):
│   │   ├── no-bare-hass-states.mjs   #   only data/ may read hass.states
│   │   ├── no-cycle.mjs              #   enforce data/ ← flow/ ← components/
│   │   ├── trade-dress-denylist.mjs  #   no Tesla trade dress / brand hex (CONTENT_SKIP allowlist)
│   │   ├── import-allowlist.mjs      #   restrict external imports to lit + @mdi/js
│   │   └── no-network-egress.mjs     #   no fetch/XHR/network from the bundle
│   ├── burn-in.sh · ci-local.sh  # e2e burn-in / local CI mirror
├── assets/                       # recolor SVG sources (tesla-front.svg, tesla-topdown.svg) + recolor-demo.html
├── demo/                         # mock-hass harness (no HA needed); ?panel=/scenario=/env=/recolor=
├── docs/                         # ← this documentation set (+ contract & audit docs, screenshots)
├── tests/                        # Playwright e2e: tests/e2e/*.spec.ts + support/ (fixtures, page-objects)
└── src/
    ├── tesla-card.ts             # PARENT @customElement('tesla-card'): orchestration, tabs (+Energy splice),
    │                             #   vehicle + energy resolution memo, Lovelace contract, child registration
    ├── base.ts                   # TcBase extends LitElement → supplies @property hass + resolved config
    ├── editor.ts                 # @customElement('tesla-card-editor'): GUI config editor (lazy-loaded)
    ├── const.ts                  # CARD_VERSION, HERO_VIEWBOX (1024×687), DEFAULT_ENTITIES (84 keys), EntityKey
    ├── types.ts                  # HomeAssistant, HassEntity, LovelaceCard(Editor), PanelId, TeslaCardConfig, BodyLayers
    ├── helpers.ts                # pure state/format/service helpers (entityId, rawState, num, toggleEntity, clamp, …)
    ├── ui.ts                     # render primitives (icon, statTile, batteryGauge, ring) + honest-age helpers
    ├── styles.ts                 # --tc-* tokens + sharedStyles + contract maps (ACCENT_SEMANTICS, FRESHNESS_STATES, …)
    ├── strings.ts                # STRINGS — all user-facing copy (leaf, imports nothing)
    ├── log.ts                    # log singleton — the only place console.* appears (leaf)
    ├── paint.ts                  # PAINT_PRESETS, PaintSource, resolvePaint (recolorable-body paint resolver)
    ├── layer-contract.ts         # LAYER_CONTRACT — the @unstable published layer contract (leaf, imports ./const)
    ├── data/                     # DATA LAYER — only subtree allowed to read hass.states
    │   ├── freshness.ts          #   sole hass.states reader; read/readKey/readRaw, referenceNow, staleness
    │   ├── dialect.ts            #   per-integration normalizers (charging/cover/lock) + DIALECTS table (D2)
    │   ├── registry.ts           #   canonical function-key vocabulary (ROLES, FUNCTION_KEYS, BUS_ORIENTATION)
    │   ├── resolve.ts            #   vehicle entity resolution by stable function-name (TESLA_PLATFORMS)
    │   ├── energy.ts             #   energy-site/WC resolution by function-slug + NaN-safe reads (hasEnergySite)
    │   ├── slice.ts             #   sliceChanged() tick-coalescing slice-gate (watch the full child union)
    │   └── wake.ts               #   observed-state wake gate (CI invariant) + cooldown math
    ├── flow/                     # FLOW LAYER — pure energy-flow math; imports data/, never components/
    │   ├── balance.ts            #   computeBalance — SOLE sign/unit-convention owner + conservation
    │   ├── model.ts              #   FlowNode/FlowEdge/FlowModel + buildFlowModel, IDLE_KW, BUS_NODE_ID
    │   ├── binding.ts            #   bindFlowModel(hass, config) auto-detect; ENERGY_ROLES, POWER_KEY
    │   ├── renderer.ts           #   FlowRenderer seam + the ONE shared edgeVisual/NODE_COLOR/NODE_ICON
    │   ├── hero-svg.ts           #   HeroSvgRenderer (fixed 1024×687 coords)
    │   ├── scene-bus.ts          #   SceneBusRenderer (live getBoundingClientRect anchors)
    │   └── my-home.ts            #   "My Home" Scene geometry (gatewaySegments = VIEW of computeBalance().net), BUS_WIDTH_MAX
    ├── components/               # COMPONENTS LAYER — Lit elements (tc-*) + render helpers
    │   ├── hero.ts               #   tc-hero: living car + battery + flow overlay
    │   ├── car.ts                #   carView()/carStyles render helper (NO element) — 3-mode recolorable hero
    │   ├── quick-actions.ts      #   tc-quick-actions: optimistic toggles; exports RECONCILE_TIMEOUT_MS
    │   ├── commands.ts           #   tc-commands: fire-and-forget command buttons (wake-gated)
    │   ├── slider.ts             #   tc-slider: shared release-only bar slider (extends LitElement)
    │   ├── panel-charging.ts     #   tc-panel-charging
    │   ├── panel-climate.ts      #   tc-panel-climate
    │   ├── panel-energy.ts       #   tc-panel-energy (reads RAW sensor signs)
    │   ├── panel-closures.ts     #   tc-panel-closures (non-optimistic; dialect cover/lock)
    │   ├── panel-tyres.ts        #   tc-panel-tyres (fresh-corner-subset warning)
    │   ├── panel-location.ts     #   tc-panel-location (sanctioned map gradient)
    │   ├── panel-media.ts        #   tc-panel-media (optimistic; no age stamp)
    │   ├── ecosystem-card.ts     #   EcosystemCard base shell (NO element): renderShell, ecosystemShellStyles, accentVar
    │   ├── solar.ts              #   tc-solar (extends EcosystemCard) — composes weatherVignette
    │   ├── powerwall.ts          #   tc-powerwall (extends EcosystemCard)
    │   ├── grid.ts               #   tc-grid (extends EcosystemCard; 'neutral' accent)
    │   ├── home.ts               #   tc-home (extends EcosystemCard)
    │   ├── wall-connector.ts     #   tc-wall-connector (extends EcosystemCard)
    │   ├── weather-vignette.ts   #   weatherVignette() render helper (NO element) — HA-core weather+sun via readRaw
    │   └── my-home.ts            #   tc-my-home: live Scene element (SceneBusRenderer + reflow lifecycle)
    └── fixtures/                 # committed test fixtures: flow-*.json (7 flow states), model-y-*.json, scene-stub-rects.json
```

Co-located `*.test.ts` files (Vitest, 50 of them) sit beside their modules and are omitted above.
`dist/` is **not** shown — it is gitignored and produced by `npm run build` / CI.

---

## Entry Point

- **Bundle entry:** `src/tesla-card.ts` → Rollup → `dist/tesla-card.js`. This file defines the
  `tesla-card` element, side-effect-imports every child (hero, quick-actions, commands, the 7 panels,
  the 5 ecosystem cards, and `my-home`), and registers the card with `window.customCards`.

## File Organization Patterns

| Layer | Location | Convention |
|---|---|---|
| Element shell / orchestration | `src/tesla-card.ts` | one top-level `@customElement` |
| Shared base | `src/base.ts`, `src/components/ecosystem-card.ts` | `TcBase` (vehicle children) / `EcosystemCard` (ecosystem cards) |
| Components | `src/components/*.ts` | one `tc-*` element per file (or a render helper); side-effect registered |
| Flow logic | `src/flow/*.ts` | pure energy-flow math; imports `data/`, never `components/` |
| Data access | `src/data/*.ts` | the only subtree that reads `hass.states` (via `freshness.ts`) |
| Presentation | `src/{styles,ui}.ts` | tokens, shared classes, `TemplateResult` primitives |
| Leaf modules | `src/{strings,log,layer-contract,const,types}.ts` | import nothing upward (keeps the cycle gate green) |
| Editor | `src/editor.ts` | lazy-loaded GUI config |

## Critical Files

| File | Why it matters |
|---|---|
| `src/tesla-card.ts` | The card; orchestrates everything and owns the Lovelace contract |
| `src/data/resolve.ts` + `src/data/registry.ts` + `src/const.ts` | Vehicle entity resolution — the card's core robustness mechanism |
| `src/data/freshness.ts` | The sole `hass.states` reader; the data boundary |
| `src/flow/balance.ts` | The single sign/unit-convention authority + conservation (top verification target) |
| `src/data/wake.ts` | The CI-blocking wake-safety invariant |
| `src/base.ts` | Defines the `hass`/`config` contract every vehicle child relies on |
| `src/styles.ts` | Single source of `--tc-*` tokens + machine-checkable contract maps |
| `tsconfig.json` | `useDefineForClassFields: false` is load-bearing for Lit reactivity |
| `rollup.config.mjs` | Single-file bundle config; inlines the lazy editor |
| `scripts/lint/*.mjs` | The 5 merge-blocking lint gates (boundary, cycle, trade-dress, imports, egress) |

---

_Generated by the BMAD `document-project` workflow (deep scan, 2026-06-20)._
