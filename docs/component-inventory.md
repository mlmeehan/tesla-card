# tesla-card — Component & Primitive Inventory

**Part:** `[card]` · **Path:** `tesla-card/` · **Date:** 2026-06-20

Catalog of every custom element, render helper, `data/`/`flow/` module, UI primitive, helper, and
design-token group in the card. For how they fit together see [`architecture.md`](./architecture.md).

> Regenerated after Epic 6. Supersedes the 2026-06-14 inventory (which listed only the original
> hero/quick-actions/commands/6-panel set and the removed `resolve.ts`/`DEFAULT_IMAGE`).

---

## 1. Custom Elements

### Parent + editor
| Tag | File | Base | Responsibility |
|---|---|---|---|
| `tesla-card` | `src/tesla-card.ts` | `LitElement` (implements `LovelaceCard`) | Orchestration: holds `hass`/`_config`/`_resolvedConfig`/`_energy`/`_panel`; resolves vehicle + energy entities once; renders hero + quick-actions + commands + active panel; tab bar (+ spliced Energy tab); routes `@open-panel`; registers in `window.customCards` |
| `tesla-card-editor` | `src/editor.ts` | `LitElement` (implements `LovelaceCardEditor`) | GUI config editor; lazy-loaded by `getConfigElement()`; edits `name`/`default_panel`/`hide_*`/default-panel picker; emits `config-changed` |

### Base class
| Class | File | Supplies |
|---|---|---|
| `TcBase` | `src/base.ts` | `@property({attribute:false}) hass?: HomeAssistant` and `@property({attribute:false}) config!: TeslaCardConfig` (the **resolved** config) to every vehicle child |
| `EcosystemCard` | `src/components/ecosystem-card.ts` | Abstract (unregistered) shell `extends TcBase`: `renderShell` + exported `ecosystemShellStyles` + pure `accentVar`; extended by the 5 ecosystem cards |

### Vehicle children (`tc-*`, extend `TcBase`)
| Tag | File | Responsibility |
|---|---|---|
| `tc-hero` | `components/hero.ts` | Living hero: recolorable car (paint + 3 charge states + aperture overlays) + battery gauge + composited flow overlay + status/lock line |
| `tc-quick-actions` | `components/quick-actions.ts` | Optimistic-then-reconcile toggles (lock/climate/charge port/sentry/…); exports `RECONCILE_TIMEOUT_MS` |
| `tc-commands` | `components/commands.ts` | Fire-and-forget command buttons (`button.press`: wake/honk/flash/HomeLink/…); wake-gated + cooldown |
| `tc-panel-charging` | `components/panel-charging.ts` | Battery summary, start/stop, charge-limit & current sliders (`tc-slider`), live stat tiles |
| `tc-panel-climate` | `components/panel-climate.ts` | Temp set, seat/wheel heaters, defrost, cabin-overheat (generalized optimistic contract) |
| `tc-panel-energy` | `components/panel-energy.ts` | In-card energy overview (solar/powerwall/grid/home/vehicle/WC tiles); reads RAW sensor signs |
| `tc-panel-closures` | `components/panel-closures.ts` | Doors/windows/lock closures with freshness; non-optimistic (physical closures); `normalizeCoverState`/`LockState` |
| `tc-panel-tyres` | `components/panel-tyres.ts` | Per-corner tyre pressures; low-pressure warning from the **fresh-corner subset only** |
| `tc-panel-location` | `components/panel-location.ts` | Map card + odometer/speed/coords tiles; the one sanctioned hard-coded gradient (135deg) |
| `tc-panel-media` | `components/panel-media.ts` | Now-playing + transport + volume slider; optimistic; media-inverse (no age stamp) |

### Shared control
| Tag | File | Base | Responsibility |
|---|---|---|---|
| `tc-slider` | `components/slider.ts` | `LitElement` | Reusable ~18px-thumb bar slider; fires `value-changed` **on pointer/key release only** (respects Fleet rate limits) |

### Ecosystem cards (`tc-*`, extend `EcosystemCard`)
| Tag | File | Responsibility |
|---|---|---|
| `tc-solar` | `components/solar.ts` | Standalone Solar card; presents `solar_power`; composes the `weatherVignette` living sky |
| `tc-powerwall` | `components/powerwall.ts` | Standalone Powerwall card; SoC ring + charge/discharge direction |
| `tc-grid` | `components/grid.ts` | Standalone Grid card; `grid_power` import/export; uses the `'neutral'` shell accent |
| `tc-home` | `components/home.ts` | Standalone Home consumption card; presents `load_power` |
| `tc-wall-connector` | `components/wall-connector.ts` | Standalone Wall Connector card; status + charge-session tiles |

### Scene element
| Tag | File | Base | Responsibility |
|---|---|---|---|
| `tc-my-home` | `components/my-home.ts` | `LitElement` | The "My Home" energy Scene: live `SceneBusRenderer` over composed cards; reflow lifecycle (observers → `RafCoalescer` → cached geometry); delegates math to `flow/my-home.ts`; slice-gated |

> **19 `tc-*` elements** register in all, plus `tesla-card` and `tesla-card-editor`. `car.ts`,
> `weather-vignette.ts`, and `ecosystem-card.ts` register **no** element (render helpers / base class).

---

## 2. Render Helpers (no element)

| Export | File | Purpose |
|---|---|---|
| `carView()` + `carStyles` | `components/car.ts` | The recolorable hero render (3 priority modes: `body` layers → flat `image` → bundled inline-SVG generic EV); `CLOSED_APERTURES`, internal `isConformingBody` validator. A render function, not a `tc-*` element |
| `weatherVignette()` / `weatherScene()` + `weatherVignetteStyles` | `components/weather-vignette.ts` | Generative SVG sky for `tc-solar`; reads HA core `weather.home`+`sun.sun` via `readRaw`; reduced-motion → static |

---

## 3. Data layer — `src/data/` (the only subtree that may read `hass.states`)

| Module | Key exports | Purpose |
|---|---|---|
| `data/freshness.ts` | `read`, `readKey`, `readRaw`, `referenceNow`, `isQuiescent`, `Staleness` | **Sole reader of `hass.states`**; freshness/staleness read-model + sanctioned arbitrary-entity reader |
| `data/dialect.ts` | `detectDialect`, `adapterFor`, `normalizeChargingState`/`CoverState`/`LockState`, `DIALECTS`, `Integration` | Per-integration spelling quarantine (D2); identity maps for `tesla_fleet` |
| `data/registry.ts` | `ROLES`, `Role`/`EnergyRole`, `FUNCTION_KEYS`, `BUS_ORIENTATION` | Canonical function-key vocabulary — single source of truth; pure leaf |
| `data/resolve.ts` | `resolveEntities`, `TESLA_PLATFORMS` | Vehicle entity resolution by stable function-name (override → registry → guess → bare → default) |
| `data/energy.ts` | `resolveEnergyEntities`, `numById`, `stateById`, `hasEnergySite`, `EnergyEntities` | Energy-site/WC resolution by function-slug substring (`_2`-tolerant); NaN-safe reads |
| `data/slice.ts` | `sliceChanged(prev, next, ids)` | Tick-coalescing slice-gate; must watch the **full union** of entities its consumers read |
| `data/wake.ts` | `canWake`, `observedWakeState`, `wakeCooldownRemaining`, `formatCooldown`, `WAKE_COOLDOWN_DEFAULT_MS` | Observed-state wake gate (CI-blocking invariant) + per-instance cooldown math |

---

## 4. Flow layer — `src/flow/` (pure energy-flow math; imports `data/`, never `components/`)

| Module | Key exports | Purpose |
|---|---|---|
| `flow/balance.ts` | `computeBalance`, `Balance` | **Sole** sign/unit-convention owner (kW; battery + = charging; grid + = import); per-node net + conservation |
| `flow/model.ts` | `buildFlowModel`, `FlowNode`/`FlowEdge`/`FlowModel`, `BUS_NODE_ID`, `IDLE_KW`, `Provenance` | Flow data-model assembler |
| `flow/binding.ts` | `bindFlowModel`, `ENERGY_ROLES`, `POWER_KEY` | Turns `(hass, config)` into a `FlowModel`; auto-detects the 5 roles |
| `flow/renderer.ts` | `FlowRenderer` (interface), `edgeVisual`/`edgeVisuals`, `NODE_COLOR`, `NODE_ICON` | The renderer seam + the **one shared** kW→visual derivation both renderers use |
| `flow/hero-svg.ts` | `HeroSvgRenderer`, `flowOverlayStyles` | Draws the FlowModel as the Hero overlay in fixed 1024×687 coords |
| `flow/scene-bus.ts` | `SceneBusRenderer`, `sceneBusStyles`, `RectLike` | Draws the same FlowModel against live `getBoundingClientRect` anchors |
| `flow/my-home.ts` | `gatewaySegments`, axis/topology helpers, `BUS_WIDTH_MAX` | "My Home" Scene geometry/anchor/reflow math (a VIEW of `computeBalance().net`); `tc-my-home` delegates here |

---

## 5. Root leaf & shared modules — `src/`

| Module | Key exports | Purpose |
|---|---|---|
| `const.ts` | `CARD_VERSION`, `HERO_VIEWBOX` (1024×687), `DEFAULT_ENTITIES` (84 keys), `EntityKey` | Constants + entity catalog. **No `DEFAULT_IMAGE`** (removed) |
| `types.ts` | `HomeAssistant`, `HassEntity`, `LovelaceCard(Editor)`, `PanelId`, `TeslaCardConfig`, `BodyLayers`, `EnergyConfig`, `TyresConfig` | Shared TypeScript types |
| `helpers.ts` | `entityId`, `stateObj`, `rawState`, `isUnavailable`/`isMissing`, `num`/`attr`/`unit`/`isOn`, formatters, `toggleEntity`/`pressButton`/`setNumber`/`selectOption`, `fireEvent`/`moreInfo`, `clamp` | Pure entity-read / format / service helpers |
| `ui.ts` | `icon`, `statTile`, `batteryGauge`, `ring`, `ageHint`/`keyAgeHint`/`formatAgeHint` | Shared render primitives (`TemplateResult` builders) + honest-age helpers (here, not `helpers.ts`, to avoid a `helpers ↔ data/freshness` cycle) |
| `styles.ts` | `tokens`, `sharedStyles`, `ACCENT_SEMANTICS`, `INTERACTION_PRIMITIVES`/`BANS`, `BREAKPOINTS`, `FRESHNESS_STATES` | Design tokens + shared CSS + machine-checkable contract maps |
| `paint.ts` | `PAINT_PRESETS`, `PaintSource`, `resolvePaint` | Hero body-paint resolution (literal / preset name / entity-driven) |
| `layer-contract.ts` | `LAYER_CONTRACT` | The `@unstable` published layer contract (machine-checkable half); imports only `./const` |
| `strings.ts` | `STRINGS` | All user-facing copy, namespaced `as const`; leaf, imports nothing |
| `log.ts` | `log` | The single neutral `[tesla-card]`-prefixed logger; the only place `console.*` appears |

---

## 6. UI Primitives — `src/ui.ts`

All return a Lit `TemplateResult`. Icons render as inline SVG with `fill: currentColor`; MDI path
strings come from `@mdi/js`.

| Export | Purpose |
|---|---|
| `icon(path, opts?)` | Inline MDI `<svg class="tc-ico">` |
| `statTile({icon, label, value, …})` | Compact icon + label + value; **hides when its entity is missing**; `role="button"` when interactive |
| `batteryGauge(percent, opts?)` | CSS battery bar with auto state class (`unknown`/`charging`/`low`/`mid`/`high`) + optional limit marker |
| `ring(percent, opts?)` | Circular SVG progress ring with centered label (used by ecosystem SoC rings) |
| `ageHint` / `keyAgeHint` / `formatAgeHint` | Honest "updated N ago" last-known stamps (use `referenceNow(hass)`, never `Date.now()`) |

> 🔑 **Rule:** reuse `ui.ts` primitives and `helpers.ts` functions instead of re-implementing. Entity
> resolution lives under `src/data/` (`resolve.ts`/`registry.ts`/`energy.ts`), **not** `helpers.ts`.

---

## 7. Design Tokens — `src/styles.ts`

Defined once in the `tokens` `:host` block, inherited through shadow DOM. Read via `var(--tc-…)` —
**always with the DESIGN.md value as a fallback** (hard gate).

| Group | Tokens |
|---|---|
| Typography | `--tc-font`, `--tc-font-display`, type ramp `--tc-fs-*` / `--tc-fw-*` |
| Text color | `--tc-text`, `--tc-text-dim`, `--tc-text-mute` |
| Surfaces / borders | `--tc-surface`, `--tc-surface-2/3`, `--tc-border`, `--tc-border-strong` |
| Accent palette | `--tc-blue`, `--tc-green`, `--tc-amber`, `--tc-red`, `--tc-purple`, `--tc-orange`, `--tc-teal` (the 7 `ACCENT_SEMANTICS` keys) |
| Radii | `--tc-radius-xl/lg/md/sm`, `--tc-pill` |
| Spacing | `--tc-space-1..4`, `--tc-gap` |
| Focus | `--tc-focus`, `--tc-focus-offset` |
| State | `--tc-dim-opacity`, `--tc-disabled-opacity`, skeleton tokens |
| Shadows / motion | `--tc-shadow`, `--tc-shadow-sm`, `--tc-ease` |

**Contract maps** (the machine-checkable half, exported `as const`): `ACCENT_SEMANTICS` (7 accents →
meaning), `INTERACTION_PRIMITIVES` / `INTERACTION_BANS`, `BREAKPOINTS` (build-time TS constant),
`FRESHNESS_STATES` (asleep/waking/unavailable/loading/optimistic/empty). The locked a11y keyframe
corpus in `sharedStyles` is `{tc-pulse, tc-shimmer}`; new animations live in component-local styles.

**Sanctioned literal-colour exceptions** (everything else must be a token): the `panel-location.ts`
map gradient (135deg), the `tc-slider` `#fff` thumb, the `tc-my-home` Gateway stroke `#cfe2ff`, the
opened-aperture neutral silver `#c6c8c9`.

---

## 8. Configuration Surface — `TeslaCardConfig` (`src/types.ts`)

| Key | Effect |
|---|---|
| `type` | `custom:tesla-card` (required) |
| `name` | Vehicle display name (also used for name-based device detection) |
| `image` | Flat car render URL — **no default**; used only in flat `image` mode (ignores `paint`) |
| `body` | `BodyLayers` recolorable render (`color`/`shade`/`mask` required, `highlight` optional) |
| `paint` | Literal CSS colour, preset name, or `PaintSource` `{entity, attribute?, map?, default?}` |
| `energy` | `EnergyConfig`: `entities?` (per-key energy/WC overrides) + `hide?` (suppress Energy panel) |
| `device` / `prefix` | Force the vehicle device (registry id / name) / entity-prefix slug |
| `entities` | Per-key vehicle entity-id overrides (`Partial<Record<EntityKey,string>>`) — highest precedence |
| `integration` | Force the dialect (`tesla_fleet`/…) instead of auto-detect |
| `default_panel` | Initial tab (`PanelId`); falls back to first available if absent/hidden |
| `wake_cooldown` | Per-instance implicit-wake cooldown, in minutes (default 60 s) |
| `tyres` | `TyresConfig` advanced tyre wiring |
| `hide_panels` / `hide_quick_actions` / `hide_commands` | Section visibility toggles |

`PanelId` = `'charging' | 'climate' | 'energy' | 'closures' | 'tyres' | 'location' | 'media'`.

---

_Generated by the BMAD `document-project` workflow (deep scan, 2026-06-20)._
