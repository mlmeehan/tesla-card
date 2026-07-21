# tesla-card — Component & Primitive Inventory

**Repo:** `tesla-card/` (public, standalone git repo) · **Date:** 2026-07-20 · **Version:** `1.0.0` · **Min HA:** 2024.4.0 · **Node:** 20

Catalog of every custom element, render helper, `data/`/`flow/` module, UI primitive, helper, and
design-token group in the card. For how they fit together see [`architecture.md`](./architecture.md).

> Current as of Epic 17 + v1.0.0 (Epics 9–16 baseline); see footer for counts.

---

## 1. Custom Elements

**20** elements register via `@customElement(...)` (verified count). Of those, **8 are Lovelace picker
cards** in `window.customCards` (each pushes its own entry): `tesla-card`, `tc-solar`, `tc-powerwall`,
`tc-grid`, `tc-home`, `tc-wall-connector`, **`tc-generator`**, `tc-my-home`. The editor
(`tesla-card-editor`) is **lazy** — imported only by `getConfigElement()`, never at module load.
`car.ts`, `weather-vignette.ts`, `chart.ts`, `node-hero.ts`, and `ecosystem-card.ts` register **no**
element (render helpers / abstract base).

### Parent + editor
| Tag | File | Base | Responsibility |
|---|---|---|---|
| `tesla-card` | `src/tesla-card.ts` (~452 LOC) | `LitElement` (implements `LovelaceCard`) | Orchestration parent; tab shell shows **one panel at a time**, splices the Energy tab in at **index 2** when a site is detected, routes `@open-panel`; **`_resolve()` stamps the resolver's effective vehicle dialect onto `_resolvedConfig.integration`** (in-memory only; children's `adapterFor` reads it, 15.1); `getCardSize()→16`; `getStubConfig()→{type}`; `getConfigElement()` lazy-imports the editor; `updated()` reflects the `theme` + `compact` **host attributes**; the `.root` is a `container-type: inline-size` query container so the tab-label reveal keys on `@container (min-width: 760px)` — the card's OWN width, not the viewport (D-CQ-1); pushes the `tesla-card` `window.customCards` entry |
| `tesla-card-editor` | `src/editor.ts` (~2,656 LOC) | `LitElement` (implements `LovelaceCardEditor`) | **Full no-YAML GUI editor (Epic 9):** `WIZARD_STEPS` = `detect → confirm → appearance → tune → finish` + a normal form + a Scene-aware compose mode for `_isMyHome`; `_emit` (REPLACE) vs `_patch` (merge) discipline; reset = **DELETE** the key + prune (`OVERRIDE_TARGET`); `PAINT_SWATCHES` write curated HEX; theme is card-only via `:host([theme='light'])`; hex entered as `{text:{}}` verbatim; `_convertPressure` does psi/bar/kPa; D7 `_liveness` 4-state. **No in-editor My-Home preview** — `_renderPreview` returns nothing when `_isMyHome`. Reads its **own** `hass.states` under the D7 exception (presence + liveness only) |

### Base classes
| Class | File | Supplies |
|---|---|---|
| `TcBase` | `src/base.ts` | `@property({attribute:false}) hass?: HomeAssistant` and `@property({attribute:false}) config!: TeslaCardConfig` (the **resolved** config) to every vehicle child |
| `EcosystemCard` | `src/components/ecosystem-card.ts` (~382 LOC) | Abstract (unregistered) shell `extends TcBase`: `renderShell` + exported `ecosystemShellStyles` + the one pure accent-hex composer `accentVar`; carries the `'neutral'` sentinel; extended by the **6** ecosystem cards |

### Vehicle children (`tc-*`, extend `TcBase`)
| Tag | File | Responsibility |
|---|---|---|
| `tc-hero` | `components/hero.ts` (~655 LOC) | Living hero: recolorable car (`carView`) + battery gauge + status/lock line; derived `_chargeVisual` **3 states** (parked/plugged/charging) via the shared `adapterFor`/`classifyChargeState` collapse (15.1/16.1), `_apertures` **4 booleans**, `_security` (11.2); compact-variant **asleep → cached last-known SoC/range** |
| `tc-quick-actions` | `components/quick-actions.ts` (~266 LOC) | The canonical **optimistic-then-reconcile** toggles (lock/climate/charge-port/sentry/…); exports **`RECONCILE_TIMEOUT_MS = 10_000`**; host is a `container-type: inline-size` query container — the 6→3-column grid collapse keys on `@container (max-width: 540px)` (element-relative, D-CQ-1), with a `:host([compact])` backup |
| `tc-commands` | `components/commands.ts` (~331 LOC) | Fire-and-forget command buttons (`button.press`: wake/honk/flash/HomeLink/…); `isMissing`-only degrade; wake-gated; host is a `container-type: inline-size` query container — the 6→3-column grid collapse keys on `@container (max-width: 540px)` (element-relative, D-CQ-1), with a `:host([compact])` backup |
| `tc-slider` | `components/slider.ts` (~233 LOC) | Reusable bar slider; commits `value-changed` **on release only** (never mid-drag); reused by charging/media panels **and the Powerwall backup-reserve control** |
| `tc-panel-charging` | `components/panel-charging.ts` (~460 LOC) | Battery summary, start/stop, charge-limit & current sliders (`tc-slider`), live stat tiles; classifies via `adapterFor`/`classifyChargeState` (15.1/16.1); **asleep-first `.cstatus` branch** — the shared `isAsleep` predicate renders "Asleep" on all dialects, outranking the `unavailable`→"Idle" short-circuit (17.1) |
| `tc-panel-climate` | `components/panel-climate.ts` | Temp set, seat/wheel heaters, defrost, cabin-overheat (generalized optimistic contract) |
| `tc-panel-energy` | `components/panel-energy.ts` | In-card energy overview (solar/powerwall/grid/home/vehicle/WC/generator tiles); reads **RAW** sensor signs; `THRESH = 0.05`; consumes an `entities` prop |
| `tc-panel-closures` | `components/panel-closures.ts` | Doors/windows/lock closures with freshness; non-optimistic (physical closures); `normalizeCoverState`/`LockState` |
| `tc-panel-tires` | `components/panel-tires.ts` | Per-corner tire pressures; low-pressure warning from the **fresh-corner subset only**; `PSI_PER_BAR = 14.5038`; psi/bar/kPa display via `tires.units` (9.13) |
| `tc-panel-location` | `components/panel-location.ts` | Map card + odometer/speed/coords tiles; the one sanctioned hard-coded gradient (135deg, `#1b2533`→`#0f1620`) |
| `tc-panel-media` | `components/panel-media.ts` | Now-playing + transport + volume slider; optimistic; media-inverse (no age stamp) |

### Ecosystem cards (`tc-*`, extend `EcosystemCard`)
Each renders the shared shell with a per-node **stat grid** and deep-links to the matching panel. All read **RAW** sensor signs.
| Tag | File | Accent | Responsibility |
|---|---|---|---|
| `tc-solar` | `components/solar.ts` (~211 LOC) | amber | Standalone Solar card; `solar_power` + generation/export; composes the `weatherVignette` living sky; today-sparkline + daily bars |
| `tc-powerwall` | `components/powerwall.ts` (~483 LOC) | green | Standalone Powerwall card; SoC ring + charge/discharge direction; **control surface (8.4): `operation_mode` select + `backup_reserve` `tc-slider`** (imports `RECONCILE_TIMEOUT_MS`); controls hide when missing or via `energy.hide_powerwall_controls` (9.13); `nodeHero('powerwall')` |
| `tc-grid` | `components/grid.ts` (~239 LOC) | `'neutral'` | Standalone Grid card; `grid_power` import/export + totals; uses the `'neutral'` shell sentinel (not an accent key); `nodeHero('grid')` |
| `tc-home` | `components/home.ts` (~142 LOC) | blue | Standalone Home consumption card; `load_power`; today-sparkline only; `nodeHero('home')` |
| `tc-wall-connector` | `components/wall-connector.ts` (~242 LOC) | teal | Standalone Wall Connector card; status + charge-session + handle-temp (°F via `unitById`); 3-state; today-sparkline; `nodeHero('wall_connector')` |
| `tc-generator` | `components/generator.ts` (~107 LOC) | **copper `#c2855b`** | **★Epic 9 (Story 9.14)** — Standalone Generator card on the **simple** ecosystem mold (`grid.ts`/`home.ts` shape — no chart, no vignette, no node-hero art); presents `generator_power` (a ≥0 source like solar); icon `mdiGeneratorStationary` |

### Scene element
| Tag | File | Base | Responsibility |
|---|---|---|---|
| `tc-my-home` | `components/my-home.ts` (~2,537 LOC) | `LitElement` | The "My Home" energy Scene: live `SceneBusRenderer` over composed cards (incl. embedded **Vehicle presentation cells** via `wcVehicleEdge`, full + compact variants) + the **self-powered ribbon**; node hide/reorder/cross-row-promote/multi-instance + WRAP overflow (overflow-card bus legs **per-gap-derived, straight-preferred / routed-on-conflict** via `_overflowLegPlans`, 13.1/17.3); detected-but-hidden advisory; the reflow slice-gate (`_sliceIds`) watches the **full 11-key vehicle union** (+`charge_cable`/`lock`/4 doors/`windows`, 17.1); reflow lifecycle (`ResizeObserver`/`IntersectionObserver` → `RafCoalescer` → cached geometry → pure-CSS dash); delegates all math to `flow/my-home.ts`; **side-effect-imports all six ecosystem children** so a standalone mount registers them; vehicle embed cached per-instance (`_pruneVehicleCache` scans the **source∪load union**); `variant:'compact'` is presentation-only; the embed suppresses its Energy tab via `energy.hide:true` |

---

## 2. Render Helpers (no element)

Pure functions + a `CSSResult` — the `carView` / `statTile` mold (a consumer adds the helper's styles
to its `static styles`). They register **no** custom element.

| Export(s) | File | Purpose |
|---|---|---|
| `carView()` + `carStyles` (+ `ChargeVisual`/`ApertureKey`/`ApertureState` types) | `components/car.ts` (~563 LOC) | The recolorable hero render — **3 priority modes**: `body` layers → flat `image` → bundled inline-SVG generic EV (**no `/local` default that 404s**); recolor mask stack; internal `isConformingBody` validator. Reused as the editor's **live appearance preview** (9.12) |
| `weatherVignette()` / `weatherScene()` + `weatherVignetteStyles` | `components/weather-vignette.ts` (~478 LOC) | Generative SVG sky for `tc-solar`; reads HA core `weather.home` + `sun.sun` via `readRaw` (**omits, never fabricates**); reduced-motion → static; no age stamp |
| `sparkline()` / `dayBars()` / `barLabels()` + `chartStyles` | `components/chart.ts` (~267 LOC) | Hand-rolled, token-accented SVG charts (today sparkline + multi-day bars) over a `HistorySeries`; SVG `linearGradient` (**not** a CSS 180° gradient), no raw hex; reduced-motion-safe |
| `nodeHero()` + `nodeHeroStyles` | `components/node-hero.ts` (~279 LOC) | **4** inline-SVG node illustrations (`NodeHeroKind = 'powerwall' \| 'grid' \| 'home' \| 'wall_connector'`); token-driven, reduced-motion-frozen, no raster/trade-dress (Solar reuses the weather vignette; the simple generator card carries no node-hero art) |
| `EcosystemCard` / `accentVar` / `ecosystemShellStyles` | `components/ecosystem-card.ts` | see §1 Base classes |

---

## 3. Data layer — `src/data/` (the only runtime subtree that may read `hass.states`)

**9** modules.

| Module | Key exports | Purpose |
|---|---|---|
| `data/freshness.ts` | `read`, `readKey`, `readRaw`, `referenceNow`, `isQuiescent`, `Staleness` | **Sole runtime reader of `hass.states`**; freshness/staleness read-model (thresholds: fresh 5 min / asleep 30 min) + the sanctioned arbitrary-entity reader (`readRaw`) |
| `data/dialect.ts` | `normalizeChargingState`/`LockState`/`CoverState`, `DIALECTS`, `detectDialect` (optional `scope`, 14.2), `adapterFor`, `collapseDialect`, `classifyChargeState`, `makeAdapter`, `DIALECT_ENTITY_ALIASES`, `DIALECT_ABSENT`, `normalizePower`, `Integration` | Per-integration spelling quarantine (D2); identity maps for `tesla_fleet`; **the alias tables are LIVE** — `resolveEntities` consults `DIALECT_ENTITY_ALIASES`/`DIALECT_ABSENT` (14.1); `collapseDialect(report)` is the single ambiguity-collapse authority (ambiguous ⇒ `tesla_fleet`, else verbatim; 17.2); `classifyChargeState` + the adapter's `chargingOverrideCovers` are the shared 7→3 charge-word collapse + coverage predicate (hero + panel single-sourced, 16.1); `adapterFor` dispatches `DIALECTS[collapseDialect(detectDialect(…))]` (17.2). `normalizePower` flips raw battery `−=charging` → canonical at the boundary. `ChargingState = charging\|starting\|stopped\|complete\|disconnected\|no_power\|unknown` (the parked/plugged/charging triad is the **hero's** derived `_chargeVisual`, not this) |
| `data/registry.ts` | `ROLES` (**7**), `Role`/`EnergyRole`, `FUNCTION_KEYS` (**84 vehicle + 22 energy** keys), `ALL_KEYS`, `BUS_ORIENTATION`, `roleOf` | Canonical function-key vocabulary — single source of truth; pure leaf. `ROLES = ['vehicle','solar','powerwall','grid','home','wall_connector','generator']`. `BUS_ORIENTATION`: solar/grid/generator `+1`, powerwall/home/wall_connector `−1`. |
| `data/resolve.ts` | `resolveEntities`, `slugify`, `detectVehicleDialect` | Vehicle entity resolution by stable function-slug (override → registry → guess → bare → default); `detectVehicle` is override-steered with a guarded **four-tier** fallback (`config.device` → integration-override steer → `VEHICLE_SIGNATURES` score → most-entities, 16.2); consults `dialect.ts`'s alias/ABSENT tables (14.1) and exports `detectVehicleDialect` = the **effective vehicle-scoped dialect** incl. ambiguity collapse (15.1). *(`TESLA_PLATFORMS` moved to the new leaf `data/platforms.ts`.)* |
| `data/platforms.ts` | `TESLA_PLATFORMS` | **★Story 14.1** — the shared Tesla-platform `Set` (`tesla_fleet`/`teslemetry`/`tessie`/`tesla_custom`/`tesla`); a leaf importing nothing internal, so `resolve.ts` and `dialect.ts` co-import it without forming a cycle |
| `data/energy.ts` | `resolveEnergyEntities`, `hasEnergySite`, `detectEnergySite`, `numById`, `stateById`, `unitById`, `attrById`, `EnergyEntities`, `RULES` | Energy-site/WC resolution by function-slug substring (`_2`-tolerant); NaN-safe reads. `unitById` (live units — WC temp °F) + `attrById` (array/non-string attrs, e.g. `select` options). `EnergyEntities` includes `generator_power?` |
| `data/history.ts` | `fetchHistory`, `fetchCardHistory`, `parseSeries`, `bucketDailyDelta`, `HistorySample`/`HistorySeries`/`DayBucket`/`HistoryWindow`/`CardHistory` | Recorder history over `hass.callWS('history/history_during_period')` — never polled, never `hass.states`, id-gated/cached, NaN-safe **drop-not-zero** ("empty ≠ zero") |
| `data/slice.ts` | `sliceChanged(prev, next, ids)` | Tick-coalescing slice-gate; must watch the **full union** of entities its consumers read |
| `data/wake.ts` | `observedWakeState`, `canWake`, `wakeCooldownRemaining`, `formatCooldown`, `WAKE_COOLDOWN_DEFAULT_MS = 60_000` | Observed-state wake gate (CI-blocking invariant) + per-instance cooldown math |

---

## 4. Flow layer — `src/flow/` (pure energy-flow math; imports `data/`, never `components/`)

**7** non-test modules.

> **AR-6 (supersedes the old "six engine files frozen / FR-33"):** only `flow/balance.ts` is the truly
> frozen authority (**zero production diff since Story 4.1**). `model.ts` carries one additive
> multi-instance seam (`id ?? role`). `binding.ts`/`renderer.ts`/`hero-svg.ts` (since removed in Story
> 12.1)/`scene-bus.ts` were edited in Epic 9 for the new role + per-instance ids. A new node/role is a **registry + component-metadata**
> edit, never a balance/compute edit. The kW→visual math in `renderer.ts` is math-unchanged.

| Module | Key exports | Purpose |
|---|---|---|
| `flow/balance.ts` | `computeBalance`, `Balance`, `EPSILON_KW = 0.05` | **Sole** sign/unit-convention owner (kW; battery `+` = charging; grid `+` = import); per-node `net` + conservation (`balanced` ⇔ `\|residual\| ≤ EPSILON_KW`). Role-generic. **Frozen (AR-6, zero diff since 4.1)** |
| `flow/model.ts` | `buildFlowModel`, `FlowNode`/`FlowEdge`/`FlowModel`/`FlowInput`, `BUS_NODE_ID = 'bus'`, `IDLE_KW = 0.05`, `senseOf`, `Provenance`, `Direction` | Flow data-model assembler; carries the additive `const id = input.id ?? input.role` identity seam (9.7); `senseOf` derives `forward`/`reverse`/`none` against `IDLE_KW` |
| `flow/binding.ts` | `bindFlowModel`, `flowInputsFrom`, `POWER_KEY`, `ENERGY_ROLES` (**6**), `DEADBAND` (= `IDLE_KW`), `absentInput` | Turns `(hass, config)` into a `FlowModel`; auto-detects the **6** energy roles. `flowInputsFrom` is the seam for node **hide** (forces `kW:undefined` via `absentInput`) and **N-instance** (flat-maps role → N inputs); accepts a `hide` set |
| `flow/renderer.ts` | `FlowRenderer` (interface `{update}`), `edgeVisual`/`edgeVisuals`, `NODE_COLOR`, `NODE_ICON` | The renderer seam + the **one shared** kW→visual derivation the renderer uses: `width = 1.6 + \|kW\|·0.55`, `durSec = max(0.5, 1.7 − \|kW\|·0.16)`. `NODE_COLOR.generator` = copper, `NODE_ICON.generator` = `mdiGeneratorStationary`. The typecheck-invisible `NODE_COLOR`/`NODE_ICON`/`edgeVisual`-coefficient **values** are pinned in the dedicated `renderer.test.ts` (tsc proves the keys, not the values) |
| `flow/scene-bus.ts` | `SceneBusRenderer`, `setAnchors`, `sceneBusStyles`, `RectLike` | The **sole live `FlowRenderer`** — draws the `FlowModel` against live `getBoundingClientRect` anchors; per-instance chip lookup by `n.id` |
| `flow/my-home.ts` | `gatewaySegments`, `sceneAggregates`/`selfPowered`/`ribbonTiles`, `coupledRoles`/`roleKind`, `wcVehicleEdge`, `RafCoalescer`, `busAxis`/`axisForWidth`, `SCENE_PHONE_MAX = 540`, `BUS_WIDTH_MAX = 7`, `VEHICLE_NODE_ID = 'vehicle'` | "My Home" Scene geometry, reflow, and **all composed-Scene views** — every one a pure **VIEW** of `computeBalance().net` (not the frozen authority); `axisForWidth(w) = w ≤ SCENE_PHONE_MAX ? 'y' : 'x'`; `BUS_WIDTH_MAX` caps stroke width. **No `_trunk`/`P()` helper exists** (that was a doc phantom). `tc-my-home` delegates here |
| `flow/instances.ts` | `instanceId`, `roleOfInstance`, `roleInstances`, `instanceSpecs` | **★Epic 9 (9.7)** — DOM-free per-instance identity: `instanceId = count<=1 ? role : ${role}:${i+1}` (**bare for single = zero-diff**); consumes the descriptor-list schema |

---

## 5. Root leaf & shared modules — `src/`

| Module | Key exports | Purpose |
|---|---|---|
| `const.ts` | `CARD_VERSION` (**`'1.0.0'`**), `HERO_VIEWBOX` (`{width:1024, height:687}`), `DEFAULT_ENTITIES` (~84 keys `satisfies Record<VehicleKey,string>`), `EntityKey` | Constants + the live entity catalog. **No `DEFAULT_IMAGE`** (removed) |
| `types.ts` | `TeslaCardConfig` + sub-shapes (`BodyLayers`, `EnergyConfig`, `NodeCustomization`, `InstanceSpec`, `SceneRow`, `TiresConfig`, `AppearanceConfig`) + HA-platform interfaces (`HassEntity`, `HomeAssistant` incl. optional `callWS?<T>`, `LovelaceCard`, `LovelaceCardEditor`, `PanelId`) | Shared TS types — **public config + sub-shapes + HA-platform interfaces only** (Hero-internal types live with their owners in `car.ts`) |
| `helpers.ts` | `UNAVAILABLE_STATES`, `entityId`, `stateObj`, `rawState`, `isUnavailable` / `isMissing`, `num`/`attr`/`unit`/`isOn`/`isAsleep`, `formatNumber`/`prettyText`/`formatAge`/`display`, `toggleEntity`/`pressButton`/`setNumber`/`selectOption`, `fireEvent`/`moreInfo`/`domainOf`, `srState`, `clamp` | Pure entity-read / format / service helpers. `isMissing` is **deliberately narrow** (`undefined`/`'unavailable'` only — so a never-pressed button stays wakeable); `isUnavailable` is the wider sensor/toggle guard; `isAsleep` is the **shared** asleep predicate consumed by `hero.ts`, `panel-charging.ts` and the Scene embed (17.1) |
| `ui.ts` | shared render primitives + honest-age helpers (detailed in §6) | Shared render primitives (`TemplateResult` builders) + the honest-age helpers (here, not `helpers.ts`, to avoid a `helpers ↔ data/freshness` cycle) |
| `styles.ts` | `tokens`, `sharedStyles`, `LIGHT_TOKENS`, `ACCENT_SEMANTICS` (**8**), `INTERACTION_PRIMITIVES`/`INTERACTION_BANS`, `FRESHNESS_STATES` (**6**), `BREAKPOINTS` (`{compact:540, full:760}`) | Design tokens + shared CSS + machine-checkable contract maps + the card-only light palette; the locked a11y keyframe corpus in `sharedStyles` is `{tc-pulse, tc-shimmer}` |
| `paint.ts` | `PAINT_PRESETS`, `PaintSource`, `resolvePaint` | Hero body-paint resolution — **3 forms in order**: literal CSS colour/keyword (**passthrough FIRST**) → `PAINT_PRESETS` name → live `PaintSource`. ⚠ the literal-keyword branch wins first, so writers (editor swatches) must write the curated HEX. `PAINT_PRESETS` = generic colour names only |
| `layer-contract.ts` | `LAYER_CONTRACT` | The `@unstable` published Layer contract (`as const`): `unstable:true`, `viewBox` = `HERO_VIEWBOX`, `camera:'3/4'`, `requiredLayers [color,shade,mask]`, optional `[highlight]`, nodes `[apertureLayers, chargePort]`; imports only `./const` |
| `strings.ts` | `STRINGS` | All user-facing copy, namespaced `as const`; leaf, imports nothing |
| `log.ts` | `log` | The single neutral `[tesla-card]`-prefixed logger; the only place `console.*` appears |
| `base.ts` | `TcBase` | The vehicle-child base class (§1) |

---

## 6. UI Primitives — `src/ui.ts`

All return a Lit `TemplateResult`. Icons render as inline SVG with `fill: currentColor`; MDI path
strings come from `@mdi/js`.

| Export | Purpose |
|---|---|
| `icon(path, opts?)` | Inline MDI `<svg class="tc-ico">` (default 22px; optional `size`/`cls`/`color`) |
| `statTile({icon, label, value?, …})` | Compact icon + label + value; **hides (renders `nothing`) when `value === undefined`** (a missing entity, not a lone "—"); `role="button"` + `tabindex` when interactive |
| `batteryGauge(percent, opts?)` | CSS battery bar; auto state class (`unknown`/`charging`/`low ≤20`/`mid ≤50`/`high`) + optional limit marker |
| `ring(percent, opts?)` | Circular SVG progress ring with centred label (used by ecosystem SoC rings); `charging` adds the pulse class |
| `formatAgeHint(lastUpdated, now)` | The ONE "updated Nm ago" formatter (UX-DR18); returns `undefined` (caller omits) when no stamp — never "updated NaN" |
| `keyAgeHint(hass, config, key, now?)` | Per-key honest last-updated hint; `now` defaults to one `referenceNow(hass)` scan |
| `ageHint(hass, config)` | The Hero/commands hint, backed by `battery_level` |

> 🔑 **Rule:** reuse `ui.ts` primitives and `helpers.ts` functions instead of re-implementing. Entity
> resolution lives under `src/data/` (`resolve.ts`/`registry.ts`/`energy.ts`), **not** `helpers.ts`.
> Charts/illustrations live in the `chart.ts`/`node-hero.ts` render helpers, not `ui.ts`. Honest-age
> helpers live in `ui.ts` (not `helpers.ts`) to avoid a `helpers ↔ data/freshness` import cycle.

---

## 7. Design Tokens — `src/styles.ts`

Defined once in the `tokens` `:host` block, inherited through shadow DOM. Read via `var(--tc-…)` —
**always with the DESIGN.md value as a fallback** (hard gate) **AND** the token must be a real token
(the Epic-9 `token-defined` gate; the fallback gate proves a fallback exists, this proves the token
is real — both must pass).

| Group | Tokens |
|---|---|
| Typography | `--tc-font`, `--tc-font-display`, type ramp `--tc-fs-*` / `--tc-fw-*` (8 DESIGN.md roles: label/name/body/stat-key/battery/charging-display/climate-readout/display) |
| Text colour | `--tc-text`, `--tc-text-dim` (the staleness/load-bearing 4.5:1 token), `--tc-text-mute` (3:1, decorative only) |
| Surfaces / borders | `--tc-surface`, `--tc-surface-2/3`, `--tc-border`, `--tc-border-strong` |
| Accent palette | `--tc-blue`, `--tc-green`, `--tc-amber`, `--tc-red`, `--tc-purple`, `--tc-orange`, `--tc-teal`, **`--tc-copper`** — the **8** `ACCENT_SEMANTICS` keys (hex byte-identical to the map) |
| Radii | `--tc-radius-xl/lg/md/sm` (28/22/16/12), `--tc-pill` (999px) |
| Spacing | `--tc-space-1..4` (4/8/12/16), `--tc-gap` (16) |
| Focus | `--tc-focus` (2px blue), `--tc-focus-offset` (2px) |
| State | `--tc-dim-opacity` (0.5), `--tc-dim-grayscale` (1), `--tc-disabled-opacity` (0.45), `--tc-skeleton-bg` |
| Shadows / motion | `--tc-shadow`, `--tc-shadow-sm`, `--tc-ease` |
| **Light theme (9.12)** | `LIGHT_TOKENS` single-sources the `:host([theme='light'])` colour-token override block AND the editor preview (so the two can't drift; pinned in `styles.test.ts`) |

**The 8 `ACCENT_SEMANTICS` accents** (machine-checkable contract; each owns ONE suite-wide meaning,
never decorative, byte-identical across light/dark grounds):

| Key | Hex | Meaning |
|---|---|---|
| blue | `#38bdf8` | plugged / info |
| green | `#34d399` | charging / OK / solar |
| amber | `#fbbf24` | mid / caution |
| red | `#f87171` | low / alert |
| purple | `#a78bfa` | media |
| orange | `#fb923c` | climate / heat |
| teal | `#2dd4bf` | secondary / ecosystem |
| **copper** | **`#c2855b`** | **generator / fuel** |

> The Grid card uses a `'neutral'` shell **sentinel**, not an accent key.

**Contract maps** (the machine-checkable half, exported `as const`):
- `ACCENT_SEMANTICS` — the 8 accents → meaning (above).
- `INTERACTION_PRIMITIVES` — `tap` (universal act), `drag` (commit-on-release, impl `tc-slider`), `toggle` (optimistic-then-reconcile, impl `quick-actions`), `crossfade` (layer swaps, base `--tc-ease`).
- `INTERACTION_BANS` — `no-background-polling` (gated), `no-auto-wake`, `no-mid-drag-commits` (gated), `no-decorative-motion`, `no-gamification`.
- `FRESHNESS_STATES` — the **6** presentation states: `asleep`, `wake-pending`, `unavailable`, `loading`, `optimistic`, `empty` (each with treatment/recipe/copy/control/staleness/gated).
- `BREAKPOINTS` — the compact/full breakpoints (values in §5); `sharedStyles` keeps a viewport `@media (max-width: compact)` (child grids), while `tesla-card` `.root`'s tab-label reveal is element-relative `@container (min-width: full)` and the `tc-commands`/`tc-quick-actions` grids collapse on their own `@container (max-width: compact)` (D-CQ-1) — a gate (`a11y.test.ts`) pins both literals to these constants.
- `LIGHT_TOKENS` — the card-only light palette (see the Light-theme row above); 8 colour tokens flip, accents intentionally NOT re-listed.

**Sanctioned literal-colour exceptions** (everything else must be a token): the `panel-location.ts`
map gradient (135deg, `#1b2533`→`#0f1620`), the `tc-slider` `#fff` thumb, the `tc-my-home` Gateway
stroke **`#cfe2ff`** (`GATEWAY_STROKE`), the opened-aperture neutral silver `#c6c8c9`.

> ⚠️ **Theme override is card-only** — `appearance.theme` reflects a host `theme` attribute that
> re-resolves `--tc-*` colour tokens via `:host([theme='light'])` (sourced from `LIGHT_TOKENS`). Accents
> stay semantic on both grounds. **Never** write HA's global `--primary-*`/theme vars.

---

## 8. Configuration Surface — `TeslaCardConfig` (`src/types.ts`)

A single consolidated, forward-compatible shape (Story 7.1). `setConfig` spreads unknown/future keys and
never throws on extras (R9). **Epic 9 added many additive, zero-diff-when-absent keys** (in **bold**).

| Key | Sub-shape | Effect |
|---|---|---|
| `type` | `string` | `custom:tesla-card` (required) |
| `name` | `string` | Vehicle display name (defaults "Model Y"; also used for name-based device detection) |
| `image` | `string` | Flat car render URL — **no default**; used only in flat `image` mode (ignores `paint`) |
| `body` | `BodyLayers` | Recolorable render: `color`/`shade`/`mask` required, `highlight?`/`width?`/`height?`/`apertureLayers?`/`chargePort?` optional |
| `paint` | `string \| PaintSource` | Literal CSS colour/keyword, preset name, or `PaintSource` `{entity, attribute?, map?, default?}` |
| **`appearance`** | **`AppearanceConfig`** | **Card-only `theme?: 'light'\|'dark'` (Auto = absent) (9.12)** |
| `device` / `prefix` | `string` | Force the vehicle device (registry id / name) / entity-prefix slug |
| `entities` | `Partial<Record<EntityKey,string>>` | Per-key vehicle entity-id overrides — highest precedence |
| `integration` | `Integration` | Force the dialect — one of **`tesla_fleet` / `teslemetry` / `tessie` / `tesla_custom` / `tesla`** (legacy, Fleet-family) — instead of auto-detect (D2); also **steers** anonymous vehicle-device selection among cars on a mixed-platform install (16.2) |
| `default_panel` | `PanelId` | Initial tab; falls back to first available if absent/hidden |
| `hide_panels` / `hide_quick_actions` / `hide_commands` | `boolean` | Section visibility toggles |
| `variant` | `'full' \| 'compact'` | `'full'` (default). `'compact'` renders hero + status + gauge ONLY (implies the three hide flags + suppresses flow labels; asleep → cached SoC/range). Presentation-only — does **not** hide the My-Home tab shell. Set by the My-Home in-line vehicle embed |
| **`notify_hidden_detected`** | **`boolean`** | **Surface the calm detected-but-hidden Scene advisory; default-ON (9.10)** |
| **`setup_complete`** | **`boolean`** | **Wizard resume marker: `true` done / `false` in-progress / absent = bare stub (9.9)** |
| `energy` | `EnergyConfig` | `entities?` + `hide?` + **`nodes?` (`NodeCustomization`)** + **`hide_powerwall_controls?`** (9.13) |
| `wake_cooldown` | `number` | Per-instance implicit-wake cooldown, in **minutes** (built-in default ~1 min when unset/≤0) |
| `tires` | `TiresConfig` | `recommended?`/`margin?` (NATIVE unit) + **`units?: 'psi'\|'bar'`** (display-only; comparison stays native, 9.13) |
| `weather` | `{entity?, sun?, hide?}` | Solar-vignette tuning (6.4) |

**Sub-shapes** — full TS definitions live in `src/types.ts` (the single source of truth). The
contributor-facing semantics not obvious from the shapes:
- `NodeCustomization` — keyspace is **`Role`** (the **7** suite nodes **incl. `vehicle`**), not `EnergyRole`; precedence is **hide wins over order**; `rows` (9.15) is cross-row promotion (presentation only — never a sign source); `instances` is a **descriptor list** whose array LENGTH is the instance count.
- `InstanceSpec` — `config` is consumed **only for the `vehicle` role** (a 2nd/3rd car's own embedded `tesla-card` config, 9.8); energy roles ignore it.

(`EnergyConfig`, `SceneRow`, `TiresConfig`, `AppearanceConfig`, and `BodyLayers` are plain shapes — see `types.ts`.)

`PanelId` = `'climate' | 'charging' | 'energy' | 'closures' | 'tires' | 'location' | 'media'`. All
unknown/garbage values degrade gracefully (R9 / FR-24), never throw.

---

## 9. Key Exported Constants (quick reference)

| Constant | Value | Home |
|---|---|---|
| `CARD_VERSION` | `'1.0.0'` | `const.ts` |
| `HERO_VIEWBOX` | `{ width: 1024, height: 687 }` | `const.ts` |
| `RECONCILE_TIMEOUT_MS` | `10_000` | `components/quick-actions.ts` (exported; `powerwall.ts` imports it, never redefines) |
| `WAKE_COOLDOWN_DEFAULT_MS` | `60_000` | `data/wake.ts` |
| `PSI_PER_BAR` | `14.5038` | `components/panel-tires.ts` (the one bar↔psi factor) |
| `EPSILON_KW` | `0.05` | `flow/balance.ts` (bus-balance tolerance) |
| `IDLE_KW` | `0.05` | `flow/model.ts` (`senseOf` threshold) |
| `DEADBAND` | `= IDLE_KW` (`0.05`) | `flow/binding.ts` |
| `BUS_NODE_ID` | `'bus'` | `flow/model.ts` |
| `VEHICLE_NODE_ID` | `'vehicle'` | `flow/my-home.ts` |
| `edgeVisual` math | `width = 1.6 + \|kW\|·0.55`, `durSec = max(0.5, 1.7 − \|kW\|·0.16)` | `flow/renderer.ts` |
| `BUS_WIDTH_MAX` | `7` (Scene stroke cap) | `flow/my-home.ts` |
| `SCENE_PHONE_MAX` | `540` (`axisForWidth` → vertical bus at/below) | `flow/my-home.ts` |
| `WRAP_MAX_PER_ROW` | `3` (band wraps to a 2nd sub-row beyond this) | `components/my-home.ts` |
| `SAFE_BAND_MAX` | `6` (= `2 × WRAP_MAX_PER_ROW`; Story 9.8 clamp guard) | `components/my-home.ts` |
| `--subrow-offset` | `230px` (= `(380 + 80)/2`; overflow card centres on a near-row channel) | `components/my-home.ts` (CSS var) |
| `SCENE_TRACK_MIN_PX` / `SCENE_TRACK_MAX_PX` | `380` / `560` (capped-fluid `minmax`) | `components/my-home.ts` |
| `LONG_LEG_PX` | `160` (the `.long` conduit threshold at the floor track) | `components/my-home.ts` |
| `GATEWAY_STROKE` | `'#cfe2ff'` (sanctioned literal) | `components/my-home.ts` |

---

_Generated by the BMAD `document-project` workflow (exhaustive rescan, 2026-06-24; refreshed 2026-07-20
for Epics 13–17 + v1.0.0). Counts: **20** custom elements · **8** `window.customCards` picker cards · **7**
roles (1 vehicle + 6 energy) · **6** `ENERGY_ROLES` · **8** `ACCENT_SEMANTICS` accents · **69** unit test
files (**1,784** cases) / **24** e2e specs (**309** cases) · **8** lint gates._
