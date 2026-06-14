import type { HomeAssistant, TeslaCardConfig } from './types';

/**
 * Resolved entity ids for the Tesla energy site + Wall Connector. Any may be
 * absent on installs without that hardware.
 *
 * Sign conventions (from the `tesla_fleet`/`powerwall` integrations):
 *   • battery_power  negative = charging (power into the Powerwall), positive = discharging
 *   • grid_power     positive = importing from the grid, negative = exporting
 *   • solar_power / load_power / wc_power are ≥ 0
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
}

type Key = keyof EnergyEntities;

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

/** Numeric state by entity id (NaN-safe). */
export function numById(
  hass: HomeAssistant | undefined,
  id?: string
): number | undefined {
  if (!hass || !id) return undefined;
  const st = hass.states[id];
  if (!st) return undefined;
  const n = Number(st.state);
  return Number.isFinite(n) ? n : undefined;
}

/** Raw state string by entity id. */
export function stateById(
  hass: HomeAssistant | undefined,
  id?: string
): string | undefined {
  if (!hass || !id) return undefined;
  return hass.states[id]?.state;
}
