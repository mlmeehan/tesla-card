# tesla-card — Architecture

**Part:** `[card]` · **Path:** `tesla-card/` (separate nested git repo) · **Date:** 2026-06-14
**Type:** Frontend UI component library (custom Lovelace card, HACS plugin)

> This document covers the **tesla-card** sub-project only. For the repository-wide picture
> and the `[HA]` config-as-code side, see [`../../docs/index.md`](../../docs/index.md).

---

## 1. Executive Summary

`tesla-card` is a Tesla-app-style custom [Lovelace](https://www.home-assistant.io/dashboards/)
card for Home Assistant, built in **TypeScript (strict) + [Lit](https://lit.dev) 3**. It renders a
single vehicle (default profile: "Garage Model Y") as a centered hero with a tab bar over nine
feature panels (climate, charging, closures, tyres, location, media, …), plus quick-action toggles
and command buttons.

It ships as a **single bundled ES module** (`dist/tesla-card.js`) consumed by Home Assistant as a
Lovelace resource and distributed via [HACS](https://hacs.xyz/). There is **no application server,
no API layer, and no datastore** — all state comes from the HA `hass` object injected by the
dashboard at runtime.

The defining design problem this card solves is **entity resolution**: Tesla Fleet integrations
expose ~88 entities whose IDs are *not* uniformly prefixed (~30 live on the bare device, e.g.
`sensor.odometer`, `cover.sunroof`). The card resolves entities by stable *function-name* keys so
it works across installs, device renames, and integration prefixes without hard-coded IDs.

---

## 2. Technology Stack

| Category | Technology | Version | Notes |
|---|---|---|---|
| Language | TypeScript | `^5.7.3` | full `strict`, `noUnusedLocals/Parameters`, `noImplicitOverride` |
| UI framework | Lit | `^3.2.1` | `LitElement`, `@customElement`, `@property`, `@state`, `css` |
| Icons | `@mdi/js` | `^7.4.47` | MDI path strings, rendered as inline SVG |
| Bundler | Rollup | `^4.30.1` | `@rollup/plugin-typescript`, `-node-resolve`, `-commonjs`, `-json`, `-terser` |
| Runtime helper | tslib | `^2.8.1` | TS decorator/helper runtime |
| Build/CI runtime | Node | 20 | CI only — no Node runtime in production |
| Min HA version | Home Assistant | `2024.4.0` | declared in `hacs.json` |
| Module system | ESM | — | `"type": "module"`; single inlined bundle |

**`tsconfig.json` load-bearing options:** `target ES2021`, `module ESNext`,
`moduleResolution bundler`, `experimentalDecorators: true`, **`useDefineForClassFields: false`**.

> ⚠️ **Never set `useDefineForClassFields: true`.** Lit's `@property`/`@state` decorators depend
> on it being `false` (with `experimentalDecorators: true`). Flipping it silently breaks reactivity.

---

## 3. Architecture Pattern — Shadow-DOM Component Tree

A single top-level custom element orchestrates a flat set of child components. There is **one**
`@customElement('tesla-card')`; every child is a `tc-*` element and (with two exceptions) extends a
shared base class. Components communicate **downward** by props and **upward** by `CustomEvent`.

```
tesla-card  (src/tesla-card.ts)  — LitElement, implements LovelaceCard
│  state: hass, _config, _resolvedConfig (memoised), _panel (active tab, default 'charging')
│  owns: design tokens on :host, tab bar, @open-panel routing, customCards registration
│
├── tc-hero            components/hero.ts          centered car render + status + battery bar
├── tc-quick-actions   components/quick-actions.ts 6 circular toggles (lock/climate/port/frunk/trunk/sentry)
├── tc-commands        components/commands.ts      6 command buttons (wake/honk/flash/homelink/keyless/boombox)
└── tc-panel-*  (the active tab; one rendered at a time)
    ├── tc-panel-climate    panel-climate.ts
    ├── tc-panel-charging   panel-charging.ts   ── uses ─▶ tc-slider (components/slider.ts)
    ├── tc-panel-closures   panel-closures.ts
    ├── tc-panel-tyres      panel-tyres.ts
    ├── tc-panel-location   panel-location.ts
    └── tc-panel-media      panel-media.ts      ── uses ─▶ tc-slider

tesla-card-editor  (src/editor.ts)  — LitElement, implements LovelaceCardEditor (lazy-loaded)
```

**Base class — `TcBase` (`src/base.ts`).** Extends `LitElement` and supplies exactly two reactive
properties to every child:

```ts
@property({ attribute: false }) public hass?: HomeAssistant;
@property({ attribute: false }) public config!: TeslaCardConfig;   // the RESOLVED config
```

Children read `config` (not `_config`). The two non-`TcBase` elements are **`tc-slider`** and
**`tesla-card-editor`**, which extend `LitElement` directly because they don't need the resolved
vehicle config.

**Registration.** Children are pulled in by **side-effect imports** in `src/tesla-card.ts`
(`import './components/hero';` …). `tc-slider` is side-effect-imported by its two consumers
(`panel-charging.ts`, `panel-media.ts`), not by the parent. To add a child component, define its
`@customElement` and add a side-effect import where it is used.

---

## 4. Entity Resolution (the core design)

All resolution logic lives in **`src/resolve.ts`** and the catalog in **`src/const.ts`**. It runs
**once** in the parent and the resolved map is passed down; children never re-resolve.

### 4.1 The catalog — `DEFAULT_ENTITIES` (`const.ts`)
An `as const` object mapping **88 stable function-name keys** (e.g. `battery_level`, `odometer`,
`time_to_full_charge`, `tire_fl`, `seat_rl`, `wake`, `boombox`) to the exact live entity IDs of a
reference "Garage Model Y" install. `EntityKey = keyof typeof DEFAULT_ENTITIES`. Also exports
`DEFAULT_IMAGE = '/local/model_y.png'`.

> ⚠️ **Tesla Fleet IDs are NOT uniformly prefixed.** ~30 of the 88 keys point at *bare* device
> entities — `sensor.odometer`, `cover.sunroof`, `sensor.shift_state`, all `sensor.tire_pressure_*`,
> the rear seat heaters (`select.seat_heater_rear_*`), `sensor.usable_battery_level`, `sensor.speed`,
> `sensor.power`, `binary_sensor.preconditioning`, `binary_sensor.dashcam`,
> `climate.cabin_overheat_protection`, … The rest carry the `garage_model_y_` device prefix.
> Blindly prefixing the bare ones yields `unavailable`. `DEFAULT_ENTITIES` encodes the exact mix.

### 4.2 Resolution flow (`resolve.ts`)
1. **`KEY_SIGNATURES`** — derived once from `DEFAULT_ENTITIES`. Each key reduces to
   `{domain, suffix, canonical}` by stripping the reference slug `garage_model_y`
   (so `sensor.garage_model_y_battery_level` → canonical `sensor.battery_level`; bare ids stay
   as-is). `canonical` is the prefix/language-independent identity.
2. **`detectVehicle()`** — finds the vehicle device by precedence: `config.device` (registry id,
   then name) → `config.name` match → the device owning the most Tesla-platform entities
   (`tesla_fleet` / `teslemetry` / `tessie` / `tesla_custom` / `tesla`), with a
   `manufacturer = "Tesla"` fallback. Derives the device's prefix `slug` (overridable via
   `config.prefix`). Degrades gracefully when the entity/device registry is absent (older HA, demo).
3. **`resolveEntities()`** — builds a complete id map for **every** key, in order of precedence:
   1. explicit `config.entities[key]` override (always wins);
   2. registry match by `canonical` within the detected device (handles any prefix);
   3. direct guess `${domain}.${slug}_${suffix}` against live `hass.states`;
   4. bare global `canonical` if it exists in states;
   5. fall back to bundled `DEFAULT_ENTITIES[key]` (worst case = original hard-coded behaviour).
   Without `hass`, only overrides + defaults are used.

### 4.3 Memoisation & propagation
`TeslaCard._resolve()` (in `willUpdate`) memoises on the identity of `hass.entities` /
`hass.devices` / `_config`, builds `_resolvedConfig = { ..._config, entities: resolveEntities(...) }`,
and `render()` passes that resolved `cfg` to every child. Children read ids via the
`entityId(config, key)` / `rawState(config, …)` helpers, which read `config.entities[key]`.

> 🔑 **Rule:** never hard-code a Tesla entity ID in a component. Resolve by stable function-name
> through the parent's resolved config so the card works across installs and prefixes.

---

## 5. Design System (tokens & styles)

Defined once in **`src/styles.ts`** as two `css` tagged templates:

- **`tokens`** — a `:host { … }` block of `--tc-*` custom properties, set on the `tesla-card` host
  (`static styles = [tokens, sharedStyles, …]`). CSS custom properties inherit across shadow-DOM
  boundaries, so **children import only `sharedStyles` + their own `css`** and read tokens via
  `var(--tc-…)`. The literal values double as defaults when rendered outside HA (the demo harness).
- **`sharedStyles`** — reusable class rules: `.tc-ico` (inline icon, `fill: currentColor`),
  `.surface`, `.stat*` (stat tile), `.ctrl*` (circular control), `.chip`, grid helpers
  `.grid/.g2/.g3/.g4`, the battery gauge (`.tc-bat*` with `low/mid/high/charging/unknown` state
  classes + shimmer) and progress ring (`.tc-ring*`), plus a `@media (max-width:540px)` collapse.

**Token groups:** typography (`--tc-font`), text (`--tc-text`, `--tc-text-dim`, `--tc-text-mute`),
surfaces/borders (`--tc-surface`, `--tc-surface-2/3`, `--tc-border`, `--tc-border-strong`), accent
palette (`--tc-blue/green/amber/red/purple/orange/teal`), radii
(`--tc-radius-xl/lg/md/sm`, `--tc-pill`), shadows (`--tc-shadow`, `--tc-shadow-sm`), and
layout/motion (`--tc-gap`, `--tc-ease`). Components set a local `--accent` (default `var(--tc-blue)`)
inline for active-state coloring.

> 🔑 **Rule:** don't redefine tokens or hard-code palette values; use `var(--tc-…)`. (The only
> intentional hard-coded colors are demo chrome in `demo/index.html` and one map-gradient in
> `panel-location.ts`.)

See [`component-inventory.md`](./component-inventory.md) for the full token, primitive, and helper tables.

---

## 6. Data Flow

```
HA dashboard ──(injects hass)──▶ tesla-card
                                   │  willUpdate: _resolve() memoised → _resolvedConfig
                                   │  render(): pass resolved cfg + hass to children
                                   ▼
        tc-hero / tc-quick-actions / tc-commands / tc-panel-*
                                   │  read state via helpers.ts (rawState/num/display/isOn…)
                                   │  user interaction → toggleEntity/pressButton/setNumber/selectOption
                                   ▼  (helpers call hass.callService — optimistic; HA pushes new hass)
                              Home Assistant services
        children → fireEvent('open-panel') ──▶ parent switches _panel (tab change)
        child   → 'value-changed' (tc-slider, on release) / 'config-changed' (editor)
```

All service calls are routed through `helpers.ts` (`toggleEntity`, `pressButton`, `setNumber`,
`selectOption`, `fireEvent`, `moreInfo`). Sliders fire `value-changed` **on pointer release only**
to avoid spamming services mid-drag.

---

## 7. Lovelace Card Contract

Implemented on `TeslaCard` in `src/tesla-card.ts`:

| Method | Kind | Behaviour |
|---|---|---|
| `setConfig(config)` | instance | throws on falsy config; shallow-copies into `_config`; applies `default_panel` |
| `getCardSize()` | instance | returns `16` |
| `getStubConfig()` | static | returns `{ type: 'custom:tesla-card' }` |
| `getConfigElement()` | static async | **lazy-imports** the editor (`await import('./editor')`) then creates `tesla-card-editor` |

> 🔑 **Rule:** keep this contract intact. The lazy editor import keeps the editor out of the
> initial render path; Rollup `inlineDynamicImports: true` folds it back into the single bundle.

The GUI editor (`src/editor.ts`, `@customElement('tesla-card-editor')`) edits `name`, `image`,
`default_panel`, and the three `hide_*` booleans, emitting `config-changed`. Per-entity overrides
are YAML-only. The editor uses HA theme vars (`--primary-text-color`, …), not `--tc-*` tokens.

---

## 8. Build Pipeline

`src/tesla-card.ts` ── Rollup (`rollup.config.mjs`) ──▶ `dist/tesla-card.js`

- `format: 'es'`, `inlineDynamicImports: true` (single file, lazy editor inlined).
- Plugin order: `resolve()` → `commonjs()` → `json()` → `typescript()` →
  `terser({ format:{comments:false}, compress:{passes:2} })` (terser skipped in `ROLLUP_WATCH`).
- `dist/` is **git-ignored** and built in CI — never committed.

See [`development-guide.md`](./development-guide.md) for commands, the demo harness, and the release flow.

---

## 9. Source Tree

See [`source-tree-analysis.md`](./source-tree-analysis.md) for the annotated `src/` tree.

```
tesla-card/
├── src/
│   ├── tesla-card.ts   parent element, orchestration, Lovelace contract, registration
│   ├── base.ts         TcBase → supplies hass + config to children
│   ├── const.ts        CARD_VERSION, DEFAULT_IMAGE, DEFAULT_ENTITIES (88 keys)
│   ├── types.ts        HomeAssistant, LovelaceCard(Editor), PanelId, TeslaCardConfig, …
│   ├── resolve.ts      entity resolution (slugify, detectVehicle, resolveEntities)
│   ├── styles.ts       --tc-* tokens + sharedStyles
│   ├── ui.ts           primitives: icon, statTile, batteryGauge, ring
│   ├── helpers.ts      state/format/service helpers
│   ├── editor.ts       GUI config editor (lazy-loaded)
│   └── components/      tc-hero, tc-quick-actions, tc-commands, tc-panel-*, tc-slider
├── demo/               mock-hass harness (no HA needed)
├── rollup.config.mjs · tsconfig.json · package.json · hacs.json
└── .github/workflows/  validate.yml (CI gates) · release.yml (asset attach)
```

---

## 10. Key Constraints & Gotchas

- **`useDefineForClassFields: false`** is load-bearing (see §2). Never "fix" it.
- **No hard-coded Tesla entity IDs** in components — resolve by function-name (see §4).
- **Don't redefine `--tc-*` tokens** or hard-code palette values — use `var(--tc-…)` (see §5).
- **Keep the Lovelace contract** (`setConfig`/`getCardSize`/`getStubConfig`/`getConfigElement`).
- **Never commit `dist/`** — it's gitignored and built in CI.
- **Version sync:** `package.json` `version` ↔ `src/const.ts` `CARD_VERSION` ↔ git tag must all match.
- **Bundle stays dependency-free** beyond `lit` + `@mdi/js`.
- This is a **separate nested git repo** — commit card changes *inside* `tesla-card/`, not the parent.

*Known minor discrepancies (as of this scan):* `README.md` says "≈80 keys" (actual: 88); the `demo`
npm script builds + echoes but does **not** start a server (despite README implying `:8080`); the
`ring` primitive in `ui.ts` is exported but currently unused.

---

_Generated by the BMAD `document-project` workflow (deep scan, 2026-06-14)._
