// Resolution gate for the Story 8.1 telemetry function-keys (the meatiest part).
//
// The registry drift guard (`_EnergyKeysMatchRegistry`) + registry.test.ts only
// prove KEY PARITY across registry/EnergyEntities/RULES — NOT that a RULES
// substring actually matches a real entity. That is the Epic-6 gate blind-spot:
// a key that compiles but never resolves is silently dead. This test pins what
// the drift guard cannot: each new key resolves to the INTENDED live entity (and
// not a decoy false-positive), and a missing one stays `undefined` so its tile
// hides. The fixture mirrors the live install's real object-ids (verified via
// /api/states) and includes deliberate decoys.
import { describe, expect, test } from 'vitest';
import { resolveEnergyEntities, numById, unitById } from './energy';
import { FUNCTION_KEYS } from './registry';
import { POWER_KEY } from '../flow/binding';
import detailFx from '../fixtures/energy-detail.json';
import allUnresolvedFx from '../fixtures/all-unresolved.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

const CONFIG: TeslaCardConfig = { type: 'custom:tesla-card' };

function makeHass(fx: { states: Record<string, HassEntity> }): HomeAssistant {
  return { states: JSON.parse(JSON.stringify(fx.states)) } as unknown as HomeAssistant;
}

describe('Story 8.1 — new telemetry keys resolve to the intended live entity', () => {
  const e = resolveEnergyEntities(makeHass(detailFx), CONFIG);

  test.each([
    ['solar_generated', 'sensor.my_home_solar_generated'],
    ['solar_exported', 'sensor.my_home_solar_exported'],
    ['grid_imported', 'sensor.my_home_grid_imported'],
    ['grid_exported', 'sensor.my_home_grid_exported'],
    ['battery_charged', 'sensor.my_home_battery_charged'],
    ['battery_discharged', 'sensor.my_home_battery_discharged'],
    ['wc_voltage', 'sensor.tesla_wall_connector_grid_voltage'],
    ['wc_frequency', 'sensor.tesla_wall_connector_grid_frequency'],
    ['wc_temperature', 'sensor.tesla_wall_connector_handle_temperature'],
  ] as const)('%s → %s', (key, expected) => {
    expect(e[key]).toBe(expected);
  });

  test('grid_imported does NOT mis-resolve to the grid_services_imported decoy', () => {
    expect(e.grid_imported).not.toBe('sensor.my_home_grid_services_imported');
  });

  test('grid_exported picks the shortest object-id, not a grid_exported_from_* sibling', () => {
    expect(e.grid_exported).toBe('sensor.my_home_grid_exported');
  });

  test('wc_voltage picks the WC grid voltage, not the phase_a_voltage decoy', () => {
    expect(e.wc_voltage).not.toBe('sensor.tesla_wall_connector_phase_a_voltage');
  });

  test('the existing leads still resolve unchanged alongside the new keys', () => {
    expect(e.solar_power).toBe('sensor.my_home_solar_power');
    expect(e.grid_power).toBe('sensor.my_home_grid_power');
    expect(e.wc_power).toBe('sensor.tesla_wall_connector_total_power');
  });

  test('values + live units read NaN-safe through numById/unitById', () => {
    expect(numById(makeHass(detailFx), e.solar_generated)).toBeCloseTo(15.7);
    expect(unitById(makeHass(detailFx), e.solar_generated)).toBe('kWh');
    // The handle temperature carries °F on this install — proves we never assume.
    expect(unitById(makeHass(detailFx), e.wc_temperature)).toBe('°F');
  });
});

describe('Story 8.1 — a key with no matching entity stays undefined (tile hides)', () => {
  test('on a minimal/empty install none of the new keys resolve', () => {
    const e = resolveEnergyEntities(makeHass(allUnresolvedFx), CONFIG);
    for (const key of [
      'solar_generated', 'solar_exported', 'grid_imported', 'grid_exported',
      'battery_charged', 'battery_discharged', 'wc_voltage', 'wc_frequency', 'wc_temperature',
    ] as const) {
      expect(e[key]).toBeUndefined();
    }
  });
});

describe('Story 8.1 — flow-engine safety (FR-33): non-power keys do not perturb the FlowModel', () => {
  test('POWER_KEY still maps each role to its single *_power sensor (untouched)', () => {
    expect(POWER_KEY).toEqual({
      solar: 'solar_power',
      powerwall: 'battery_power',
      grid: 'grid_power',
      home: 'load_power',
      wall_connector: 'wc_power',
      generator: 'generator_power', // Story 9.14 — the new source role
    });
  });

  test('every POWER_KEY value is a *_power key — the new telemetry keys are NOT power', () => {
    for (const k of Object.values(POWER_KEY)) expect(k.endsWith('_power')).toBe(true);
  });

  test('the registry holds 22 energy keys (21 + the Story 9.14 generator_power)', () => {
    const energyKeys = [
      ...FUNCTION_KEYS.solar, ...FUNCTION_KEYS.powerwall, ...FUNCTION_KEYS.grid,
      ...FUNCTION_KEYS.home, ...FUNCTION_KEYS.wall_connector, ...FUNCTION_KEYS.generator,
    ];
    expect(energyKeys.length).toBe(22);
    expect(new Set(energyKeys).size).toBe(22); // still unique
  });
});

// ── Story 9.14 — the generator resolves by function-slug, decoy-scoped ─────────
describe('Story 9.14 — generator_power resolves to the intended sensor, not a decoy', () => {
  test('generator_power resolves to the generator output sensor (not a *_generator_load decoy)', () => {
    const hass = makeHass({
      states: {
        'sensor.home_generator_power': { state: '3.4', attributes: { unit_of_measurement: 'kW' } },
        // Decoy: a non-output generator sensor that must NOT win the *_power slot.
        'sensor.home_backup_generator_load_power': { state: '1.1', attributes: {} },
      } as unknown as Record<string, HassEntity>,
    });
    const e = resolveEnergyEntities(hass, CONFIG);
    expect(e.generator_power).toBe('sensor.home_generator_power');
  });

  test('generator_power stays undefined when no generator sensor exists (the tile hides)', () => {
    const e = resolveEnergyEntities(makeHass(allUnresolvedFx), CONFIG);
    expect(e.generator_power).toBeUndefined();
  });

  test('an explicit energy.entities.generator_power override always wins', () => {
    const cfg: TeslaCardConfig = {
      type: 'custom:tesla-card',
      energy: { entities: { generator_power: 'sensor.my_custom_generator' } },
    };
    const e = resolveEnergyEntities(makeHass(allUnresolvedFx), cfg);
    expect(e.generator_power).toBe('sensor.my_custom_generator');
  });
});
