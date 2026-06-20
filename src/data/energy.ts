import type { HomeAssistant, TeslaCardConfig } from '../types';
import type { EnergyKey } from './registry';
import { readRaw } from './freshness';

/**
 * Energy-site entity resolution + state reads (AR-16 split, relocated from the
 * former top-level `src/energy.ts` in Story 4.1). This belongs in `src/data/`:
 * it resolves entities and reads `hass.states` — the data-access boundary's job,
 * the only subtree permitted bare state access. The flow-MATH that used to be
 * implied here now lives in `src/flow/` (model + balance); this module is purely
 * the data half (resolution + reads).
 *
 * The numeric/string reads (`numById`/`stateById`) route through the freshness
 * reader's `readRaw` rather than touching `hass.states` directly — one reader,
 * no duplicate access pattern. The auto-detect (`find`/`RULES`) legitimately
 * scans `hass.states` keys here (resolution is a data-layer concern).
 */

// Story 1.2 drift guard: keep EnergyEntities' keys ≡ the registry's energy-role
// vocabulary (the 12 energy function-keys). `Expect<Equal<…>>` resolves to a
// non-`true` type — a compile error at `_EnergyKeysMatchRegistry` — the moment the
// two diverge, so EnergyEntities (and RULES, keyed by `Key` below) cannot drift from
// the canonical registry. Pure type-level: no runtime cost.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;
type _EnergyKeysMatchRegistry = Expect<Equal<keyof EnergyEntities, EnergyKey>>;

/**
 * Resolved entity ids for the Tesla energy site + Wall Connector. Any may be
 * absent on installs without that hardware.
 *
 * RAW sign conventions (from the `tesla_fleet`/`powerwall` integrations):
 *   • battery_power  negative = charging (power into the Powerwall), positive = discharging
 *   • grid_power     positive = importing from the grid, negative = exporting
 *   • solar_power / load_power / wc_power are ≥ 0
 * These are RAW signs — the canonical convention the FlowModel sees (battery `+` =
 * charging) is reached via `data/dialect`'s `normalizePower` (Story 4.1, AC3).
 */
export interface EnergyEntities {
  /** PV production, kW (≥0). */
  solar_power?: string;
  /** Powerwall flow, kW (−charging / +discharging). */
  battery_power?: string;
  /** Home consumption, kW (≥0). */
  load_power?: string;
  /** Grid flow, kW (+import / −export). */
  grid_power?: string;
  /** Powerwall state of charge, %. */
  powerwall_level?: string;
  /** Grid status enum (`on_grid` / `off_grid` / …). */
  grid_status?: string;
  /** Backup reserve floor, %. */
  backup_reserve?: string;
  /** Operation mode select (`self_consumption` / `autonomous` / `backup`). */
  operation_mode?: string;
  /** Wall Connector output power, kW (>0 while charging). */
  wc_power?: string;
  /** Wall Connector session energy, kWh. */
  wc_session?: string;
  /** Wall Connector "vehicle connected" plug sensor. */
  wc_connected?: string;
  /** Wall Connector status enum. */
  wc_status?: string;
  // ── Story 8.1 telemetry-only keys (ecosystem-card detail stat grids) ──────
  // All verified to resolve against the live tesla_fleet/powerwall/Wall-Connector
  // vocabulary (see RULES + energy.test.ts). Cumulative energy sensors carry the
  // integration's own kWh unit; the WC measurement sensors carry V/Hz/°(F|C).
  // Read the unit live via `unitById` — never assume (e.g. handle temp is °F on
  // some installs). Non-power telemetry: the FlowModel never sees these (FR-33).
  /** Solar energy generated (cumulative, kWh). */
  solar_generated?: string;
  /** Solar energy exported (cumulative, kWh). */
  solar_exported?: string;
  /** Grid energy imported (cumulative, kWh). */
  grid_imported?: string;
  /** Grid energy exported (cumulative, kWh). */
  grid_exported?: string;
  /** Powerwall energy charged (cumulative, kWh). */
  battery_charged?: string;
  /** Powerwall energy discharged (cumulative, kWh). */
  battery_discharged?: string;
  /** Wall Connector grid voltage (V). */
  wc_voltage?: string;
  /** Wall Connector grid frequency (Hz). */
  wc_frequency?: string;
  /** Wall Connector handle temperature (° — unit per install). */
  wc_temperature?: string;
}

// `Key` is gated on the drift guard so the guard is load-bearing, not decorative:
// if EnergyEntities and the registry diverge, `Expect<…>` fails to compile here.
type Key = _EnergyKeysMatchRegistry extends true ? keyof EnergyEntities : never;

interface Rule {
  domain: string;
  /** every substring must appear in the entity object-id */
  has: string[];
  /** none of these may appear */
  not?: string[];
}

/**
 * Match by the stable function-slug embedded in the object-id (e.g.
 * `my_home_solar_power_2` → contains `solar_power`). This is prefix-independent
 * (`my_home_`) and tolerates the integration's `_2` duplicate-entity suffix.
 */
const RULES: Record<Key, Rule> = {
  solar_power: { domain: 'sensor', has: ['solar_power'] },
  battery_power: { domain: 'sensor', has: ['battery_power'] },
  load_power: { domain: 'sensor', has: ['load_power'] },
  grid_power: { domain: 'sensor', has: ['grid_power'], not: ['services'] },
  powerwall_level: { domain: 'sensor', has: ['percentage_charged'] },
  grid_status: { domain: 'sensor', has: ['grid_status'] },
  backup_reserve: { domain: 'number', has: ['backup_reserve'], not: ['vpp'] },
  operation_mode: { domain: 'select', has: ['operation_mode'] },
  wc_power: { domain: 'sensor', has: ['total_power'] },
  wc_session: { domain: 'sensor', has: ['session_energy'] },
  wc_connected: { domain: 'binary_sensor', has: ['vehicle_connected'] },
  wc_status: { domain: 'sensor', has: ['wall_connector', 'status'], not: ['code'] },
  // ── Story 8.1 telemetry rules ─────────────────────────────────────────────
  // Each substring set was checked against the live install's object-ids and the
  // `find()` shortest-match semantics so it resolves to exactly the intended
  // entity (energy.test.ts pins this — the drift guard only proves key parity,
  // NOT that a rule matches a real entity, the Epic-6 gate blind-spot).
  //   solar_generated → sensor.my_home_solar_generated
  solar_generated: { domain: 'sensor', has: ['solar_generated'] },
  //   solar_exported → sensor.my_home_solar_exported (NOT grid_exported_from_solar)
  solar_exported: { domain: 'sensor', has: ['solar_exported'] },
  //   grid_imported → sensor.my_home_grid_imported (NOT grid_services_imported)
  grid_imported: { domain: 'sensor', has: ['grid_imported'] },
  //   grid_exported → my_home_grid_exported wins on shortest object-id over the
  //   longer my_home_grid_exported_from_* siblings.
  grid_exported: { domain: 'sensor', has: ['grid_exported'] },
  //   battery_charged/discharged → my_home_battery_charged / _discharged
  battery_charged: { domain: 'sensor', has: ['battery_charged'] },
  battery_discharged: { domain: 'sensor', has: ['battery_discharged'] },
  //   WC measurement sensors — scoped to the wall_connector device so they never
  //   false-match an energy-site grid sensor.
  wc_voltage: { domain: 'sensor', has: ['wall_connector', 'grid_voltage'] },
  wc_frequency: { domain: 'sensor', has: ['wall_connector', 'frequency'] },
  wc_temperature: { domain: 'sensor', has: ['wall_connector', 'handle_temperature'] },
};

function objectId(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot < 0 ? entityId : entityId.slice(dot + 1);
}

/**
 * Best entity for a rule: the shortest matching object-id that has a live state.
 * Shortest wins so the canonical `solar_power` beats a longer false positive;
 * because disabled duplicates carry no live state, the enabled `…_2` is what's
 * present and gets picked.
 */
function find(hass: HomeAssistant, rule: Rule): string | undefined {
  let best: string | undefined;
  let bestLen = Infinity;
  const prefix = rule.domain + '.';
  for (const id of Object.keys(hass.states)) {
    if (!id.startsWith(prefix)) continue;
    const obj = objectId(id);
    if (!rule.has.every((h) => obj.includes(h))) continue;
    if (rule.not && rule.not.some((n) => obj.includes(n))) continue;
    if (obj.length < bestLen) {
      best = id;
      bestLen = obj.length;
    }
  }
  return best;
}

/**
 * Resolve the energy-site + Wall-Connector entities. Explicit
 * `config.energy.entities` overrides always win; the rest auto-detect.
 */
export function resolveEnergyEntities(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): EnergyEntities {
  const out: EnergyEntities = {};
  const overrides = config.energy?.entities ?? {};
  for (const key of Object.keys(RULES) as Key[]) {
    const override = overrides[key];
    if (override) {
      out[key] = override;
    } else if (hass) {
      const found = find(hass, RULES[key]);
      if (found) out[key] = found;
    }
  }
  return out;
}

/** True when enough of an energy site exists to be worth showing the panel. */
export function hasEnergySite(e: EnergyEntities | undefined): boolean {
  return !!(e && (e.solar_power || e.battery_power || e.grid_power || e.wc_power));
}

/**
 * The single composing entry point for "is there an energy site?" — the one
 * predicate Story 5.1 (Energy tab) and Epic 6 (ecosystem cards + Scene presence)
 * import so the predicate AND its input shape are specified exactly once. It runs
 * the resolver then applies `hasEnergySite`, so callers that hold only `hass`+
 * `config` never recombine `resolve + predicate` themselves (which would drift).
 *
 * Use `hasEnergySite` directly if you already hold a resolved `EnergyEntities`
 * (e.g. the card's cached `_energy`) — it's the faster path. Use this when you
 * only have `hass` + `config`.
 */
export function detectEnergySite(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): boolean {
  return hasEnergySite(resolveEnergyEntities(hass, config));
}

/** Numeric state by entity id (NaN-safe). Routes through the freshness reader. */
export function numById(
  hass: HomeAssistant | undefined,
  id?: string
): number | undefined {
  if (!id) return undefined;
  const raw = readRaw(hass, id);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Raw state string by entity id. Routes through the freshness reader. */
export function stateById(
  hass: HomeAssistant | undefined,
  id?: string
): string | undefined {
  return id ? readRaw(hass, id) : undefined;
}

/**
 * The entity's `unit_of_measurement` attribute (Story 8.1). Routes through the
 * freshness reader's attribute path (the sanctioned arbitrary-entity read) so the
 * detail stat-grid can render the integration's OWN unit rather than assuming one
 * — load-bearing for telemetry whose unit varies per install (e.g. the Wall
 * Connector handle temperature is °F on some, °C on others). `undefined` when the
 * entity or the attribute is absent.
 */
export function unitById(
  hass: HomeAssistant | undefined,
  id?: string
): string | undefined {
  return id ? readRaw(hass, id, 'unit_of_measurement') : undefined;
}

/**
 * Raw attribute value for an entity by id (Story 8.4) — the array/non-string
 * sibling of {@link unitById}. `readRaw` returns only STRINGS (it yields
 * `undefined` for a non-string like a `select`'s `options: string[]`), so a
 * control needing the raw `options` array, or a `number`'s numeric `min`/`max`/
 * `step`, reads them here. Leaf `data/` accessor — it reads `hass.states[id]`
 * like the rest of the `numById`/`stateById`/`unitById` family, so this is the
 * sanctioned home for the access (the `no-bare-hass.states` gate exempts the
 * `data/` subtree). Returns `unknown`; the caller coerces (e.g. `as string[]` for
 * options, `Number(...)` for min/max/step). `undefined` when the entity or the
 * attribute is absent.
 */
export function attrById(
  hass: HomeAssistant | undefined,
  id: string | undefined,
  name: string
): unknown {
  if (!id) return undefined;
  return hass?.states?.[id]?.attributes?.[name];
}
