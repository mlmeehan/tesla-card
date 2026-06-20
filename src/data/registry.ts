// src/data/registry.ts — canonical suite-wide function-key vocabulary (AR-2, D2).
// SINGLE SOURCE OF TRUTH: the resolver (data/resolve.ts, Story 1.3), the per-quantity
// override table (D3), and the D6 layer slots ALL key against these names. New keys
// go HERE, never inlined as string literals elsewhere (registry.test.ts enforces it).
// Pure module: no hass.states, no Lit/DOM, no upward imports (AR-1 boundary) — first
// occupant of src/data/.

/** The six suite roles every function-key is namespaced under. */
export const ROLES = ['vehicle', 'solar', 'powerwall', 'grid', 'home', 'wall_connector'] as const;
export type Role = (typeof ROLES)[number];

/** Every energy-site role (the suite minus the vehicle). */
export type EnergyRole = Exclude<Role, 'vehicle'>;

/**
 * The canonical function-keys, grouped by role. The vehicle subset mirrors
 * `const.ts` DEFAULT_ENTITIES (84 keys) and the energy subset mirrors `energy.ts`
 * EnergyEntities (21 keys); both value tables are typecheck-bound back to these names
 * (`satisfies` / drift guard), so the three tables cannot diverge silently (D2).
 *
 * Story 8.1 grew the energy vocabulary 12 → 21 with telemetry-only keys for the
 * ecosystem-card detail layout (stat grids). Every added key was verified to
 * resolve against the live `tesla_fleet`/`powerwall`/Wall-Connector entity
 * vocabulary by a real substring rule (see `energy.ts` RULES + `energy.test.ts`);
 * none are speculative. The keys are NON-POWER telemetry — `flow/binding.ts`
 * `POWER_KEY` (role → single `*_power` sensor) is untouched, so the FlowModel is
 * unperturbed (FR-33).
 */
export const FUNCTION_KEYS = {
  vehicle: [
    'battery_level', 'battery_range', 'usable_battery_level', 'ideal_battery_range', 'estimate_battery_range', 'odometer',
    'shift_state', 'update', 'status', 'user_present', 'lock', 'frunk',
    'trunk', 'windows', 'sunroof', 'door_fl', 'door_fr', 'door_rl',
    'door_rr', 'window_fl', 'window_fr', 'window_rl', 'window_rr', 'climate',
    'inside_temp', 'outside_temp', 'driver_temp_setting', 'passenger_temp_setting', 'preconditioning', 'preconditioning_enabled',
    'defrost', 'cabin_overheat_protection', 'cop_actively_cooling', 'seat_fl', 'seat_fr', 'seat_rl',
    'seat_rc', 'seat_rr', 'steering_wheel_heater', 'auto_seat_left', 'auto_seat_right', 'auto_steering_wheel',
    'charge_switch', 'charge_limit', 'charge_current', 'charger_voltage', 'charger_current', 'charger_power',
    'charge_rate', 'charge_energy_added', 'time_to_full_charge', 'charging_status', 'charge_port', 'charge_cable',
    'charge_cable_lock', 'scheduled_charging_pending', 'trip_charging', 'charger_has_multiple_phases', 'battery_heater', 'charge_at_arrival',
    'sentry', 'dashcam', 'tire_fl', 'tire_fr', 'tire_rl', 'tire_rr',
    'tire_warn_fl', 'tire_warn_fr', 'tire_warn_rl', 'tire_warn_rr', 'location', 'route',
    'speed', 'power', 'traffic_delay', 'distance_to_arrival', 'time_to_arrival', 'media_player',
    'wake', 'honk', 'flash', 'homelink', 'keyless', 'boombox',
  ],
  solar: ['solar_power', 'solar_generated', 'solar_exported'],
  powerwall: ['battery_power', 'powerwall_level', 'backup_reserve', 'operation_mode', 'battery_charged', 'battery_discharged'],
  grid: ['grid_power', 'grid_status', 'grid_imported', 'grid_exported'],
  home: ['load_power'],
  wall_connector: ['wc_power', 'wc_session', 'wc_connected', 'wc_status', 'wc_voltage', 'wc_frequency', 'wc_temperature'],
} as const satisfies Record<Role, readonly string[]>;

/** The vehicle function-keys (today's `EntityKey`). */
export type VehicleKey = (typeof FUNCTION_KEYS)['vehicle'][number];
/** The energy-site function-keys (today's `energy.ts` `Key`). */
export type EnergyKey = (typeof FUNCTION_KEYS)[EnergyRole][number];
/** Every function-key across all six roles. */
export type FunctionKey = (typeof FUNCTION_KEYS)[Role][number];

/** Flat list of every function-key (suite-wide). */
export const ALL_KEYS: readonly FunctionKey[] = ROLES.flatMap(
  (role) => FUNCTION_KEYS[role]
);

// Reverse index: key → role. Built once; pure (no I/O). Two keys can never collide
// because the registry's uniqueness invariant is enforced by registry.test.ts.
const ROLE_OF: ReadonlyMap<FunctionKey, Role> = new Map(
  ROLES.flatMap((role) => FUNCTION_KEYS[role].map((key) => [key, role] as const))
);

/** The role a function-key belongs to (`undefined` if it is not in the registry). */
export function roleOf(key: string): Role | undefined {
  return ROLE_OF.get(key as FunctionKey);
}

/**
 * Bus orientation per energy role — the sign of a positive CANONICAL power
 * reading relative to the shared site bus (the implicit electrical junction the
 * flow graph centres on):
 *   • `+1` → a positive canonical reading INJECTS into the bus (a source/export),
 *   • `−1` → a positive canonical reading DRAWS from the bus (a sink/charge).
 *
 * This is role metadata, NOT the sign convention itself: the canonical convention
 * (battery `+` = charging, grid `+` = import, kW everywhere — declared once in
 * `flow/balance.ts`) fixes what a `+` MEANS; orientation maps that meaning onto
 * the bus topology. The two genuinely differ — grid `+` (import) injects into the
 * bus (`+1`) while battery `+` (charging) draws from it (`−1`), so orientation
 * cannot be read off the sign convention alone.
 *
 * Living here (the registry, the single source of role truth) is what keeps
 * `flow/balance.ts` ROLE-GENERIC: balance never branches on role, and adding a
 * new energy node is a registry + component edit — never a balance edit (the
 * compute boundary). Keyed by `EnergyRole` so the table cannot omit a role.
 */
export const BUS_ORIENTATION: Readonly<Record<EnergyRole, 1 | -1>> = {
  solar: 1, // PV always produces → injects into the bus
  grid: 1, // canonical + = import → power flowing from grid INTO the bus
  powerwall: -1, // canonical + = charging → power INTO the battery, OUT of the bus
  home: -1, // household load → always draws from the bus
  wall_connector: -1, // charging the car → draws from the bus
} as const;
