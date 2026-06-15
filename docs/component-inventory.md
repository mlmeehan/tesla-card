# tesla-card — Component & Primitive Inventory

**Part:** `[card]` · **Path:** `tesla-card/` · **Date:** 2026-06-14

Catalog of every custom element, UI primitive, helper, and design token in the card. For how they
fit together see [`architecture.md`](./architecture.md).

---

## 1. Custom Elements

### Parent
| Tag | File | Base | Responsibility |
|---|---|---|---|
| `tesla-card` | `src/tesla-card.ts` | `LitElement` (implements `LovelaceCard`) | Orchestration: holds `hass`/`_config`/`_resolvedConfig`/`_panel`; resolves entities once; renders hero + quick-actions + commands + active panel; tab bar; routes `@open-panel`; registers in `window.customCards` + console banner |

### Base class
| Class | File | Supplies |
|---|---|---|
| `TcBase` | `src/base.ts` | `@property({attribute:false}) hass?: HomeAssistant` and `@property({attribute:false}) config!: TeslaCardConfig` (the **resolved** config) to every child |

### Children (all `tc-*`)
All extend `TcBase` **except** `tc-slider` (extends `LitElement`). Registered via side-effect import.

| Tag | File | Responsibility |
|---|---|---|
| `tc-hero` | `components/hero.ts` | Centered car render + name + status line (Charging/Driving/Parked/Asleep) + tappable battery bar (opens charging panel) |
| `tc-quick-actions` | `components/quick-actions.ts` | Row of 6 circular toggles: lock, climate, charge port, frunk, trunk, sentry |
| `tc-commands` | `components/commands.ts` | Row of 6 command buttons (`button.press`): wake, honk, flash, HomeLink, keyless, boombox |
| `tc-panel-climate` | `components/panel-climate.ts` | Temp stepper, 6 seat/wheel heater cyclers, defrost + cabin-overheat toggles |
| `tc-panel-charging` | `components/panel-charging.ts` | Battery summary, start/stop, charge-limit & charge-current sliders, live stat tiles |
| `tc-panel-closures` | `components/panel-closures.ts` | Top-down SVG car: tappable frunk/trunk/windows/charge-port/sunroof zones, door status, lock/vent buttons |
| `tc-panel-tyres` | `components/panel-tyres.ts` | Per-corner tyre pressures with low-pressure warnings |
| `tc-panel-location` | `components/panel-location.ts` | Embedded OpenStreetMap iframe + odometer/speed/power/ETA tiles |
| `tc-panel-media` | `components/panel-media.ts` | Now-playing art/meta, transport, mute + volume slider |
| `tc-slider` | `components/slider.ts` | Reusable pointer-drag bar slider; fires `value-changed` **on release only** (extends `LitElement`) |

### Editor
| Tag | File | Responsibility |
|---|---|---|
| `tesla-card-editor` | `src/editor.ts` | GUI config editor (implements `LovelaceCardEditor`); lazy-loaded by `getConfigElement()`; edits `name`/`image`/`default_panel`/`hide_*`; emits `config-changed` |

---

## 2. Panels (tab bar)

The parent renders one panel at a time, selected by `_panel` (`PanelId`, default `'charging'`).
Children request a switch by dispatching `fireEvent(this, 'open-panel', { panel })`; the parent
listens for `@open-panel` and updates `_panel`. `default_panel` (config / editor) sets the initial tab.

---

## 3. UI Primitives — `src/ui.ts`

All return a Lit `TemplateResult`. Icons render as inline 24×24-viewBox SVG with `fill: currentColor`
(color follows `currentColor`); MDI path strings come from `@mdi/js`.

| Export | Signature (abbrev.) | Purpose |
|---|---|---|
| `icon` | `icon(path, {size?, cls?, color?})` | Inline MDI `<svg class="tc-ico">`; default size 22 |
| `statTile` | `statTile({icon, label, value, color?, onClick?})` | Compact icon + uppercase label + value; `role="button"` when `onClick` set |
| `batteryGauge` | `batteryGauge(percent, {limit?, charging?, height?})` | CSS battery bar; auto state class (`unknown`/`charging`/`low ≤20`/`mid ≤50`/`high`); optional limit marker; default height 22 |
| `ring` | `ring(percent, {size?, stroke?, color?, track?, label?, sub?, charging?})` | Circular SVG progress ring w/ centered label; default size 168, stroke 13 — **exported but currently unused** |

---

## 4. Helpers — `src/helpers.ts`

| Export | Purpose |
|---|---|
| `entityId(config, key)` | Resolved/overridden entity id for a key (`override ?? DEFAULT_ENTITIES[key]`) |
| `stateObj(hass, config, key)` | The `HassEntity` for a key |
| `rawState(hass, config, key)` | Raw `.state` string |
| `isUnavailable(state)` | True for `undefined`/`unavailable`/`unknown`/`none`/`''` (exports `UNAVAILABLE_STATES`) |
| `num(hass, config, key)` | Finite number or `undefined` |
| `attr(hass, config, key, name)` | Entity attribute value |
| `unit(hass, config, key)` | `unit_of_measurement` or `''` |
| `isOn(hass, config, key, onStates=['on'])` | Boolean on-state test |
| `isAsleep(hass, config)` | Vehicle offline/asleep (status binary sensor; battery-unavailability fallback) |
| `formatNumber(value, decimals=0)` | Locale number formatting |
| `prettyText(state)` | underscores→spaces, capitalised |
| `formatHoursToHM(h)` / `formatMinutesToHM(m)` | "2h 30m" / "45m" |
| `display(hass, config, key, opts?)` | Pretty "value unit" or em-dash when unavailable |
| `fireEvent(node, type, detail?)` | Dispatch a bubbling/composed `CustomEvent` |
| `moreInfo(node, entity)` | Fire HA `hass-more-info` |
| `domainOf(entity)` | Entity domain |
| `toggleEntity(hass, entity)` | Domain-aware toggle (lock/cover/switch/light/fan/input_boolean/climate/button + `homeassistant.toggle` fallback) |
| `pressButton(hass, entity)` | `button.press` |
| `setNumber(hass, entity, value)` | `number.set_value` |
| `selectOption(hass, entity, option)` | `select.select_option` |
| `clamp(v, lo, hi)` | Numeric clamp |

> Entity-resolution functions (`slugify`, `detectVehicle`, `resolveEntities`) live in `src/resolve.ts`,
> **not** `helpers.ts`.

> 🔑 **Rule:** reuse `ui.ts` primitives and `helpers.ts` functions instead of re-implementing.

---

## 5. Design Tokens — `src/styles.ts`

Defined once in the `tokens` `:host` block, inherited through shadow DOM. Read via `var(--tc-…)`.

| Group | Tokens |
|---|---|
| Typography | `--tc-font` |
| Text color | `--tc-text` `#f1f5f9`, `--tc-text-dim` `#9aa7b8`, `--tc-text-mute` `#64748b` |
| Surfaces / borders | `--tc-surface`, `--tc-surface-2`, `--tc-surface-3`, `--tc-border`, `--tc-border-strong` |
| Accent palette | `--tc-blue` `#38bdf8`, `--tc-green` `#34d399`, `--tc-amber` `#fbbf24`, `--tc-red` `#f87171`, `--tc-purple` `#a78bfa`, `--tc-orange` `#fb923c`, `--tc-teal` `#2dd4bf` |
| Radii | `--tc-radius-xl` 28, `--tc-radius-lg` 22, `--tc-radius-md` 16, `--tc-radius-sm` 12, `--tc-pill` 999px |
| Shadows | `--tc-shadow`, `--tc-shadow-sm` |
| Layout / motion | `--tc-gap` 16, `--tc-ease` `cubic-bezier(0.22,1,0.36,1)` |

**Shared classes** (in `sharedStyles`): `.tc-ico`, `.surface`, `.label`, `.muted`, `.stat`/`.k`/`.v`,
`.ctrl`/`.ctrl-wrap`/`.ctrl-name`, `.chip`, `.grid`/`.g2`/`.g3`/`.g4`, `.divider`, battery gauge
(`.tc-bat*`), progress ring (`.tc-ring*`), and a `@media (max-width:540px)` 2-column collapse.

Components set a per-control `--accent` (default `var(--tc-blue)`) for active-state coloring.

---

## 6. Configuration Surface — `TeslaCardConfig` (`src/types.ts`)

| Key | Effect |
|---|---|
| `name` | Vehicle display name (also used for name-based device detection) |
| `image` | Car render image URL (default `DEFAULT_IMAGE = '/local/model_y.png'`) |
| `default_panel` | Initial tab (`PanelId`) |
| `device` / `prefix` | Force the vehicle device (registry id/name) / entity prefix slug |
| `entities` | Per-key entity-id overrides (`{ [EntityKey]: entity_id }`) — highest precedence |
| `hide_quick_actions` / `hide_panels` / `hide_commands` | Section visibility toggles |

---

_Generated by the BMAD `document-project` workflow (deep scan, 2026-06-14)._
