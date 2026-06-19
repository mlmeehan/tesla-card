// Co-located degradation test (Story 1.6, AC1 + inherited NFR-4 NaN-safety).
//
// Proves the THREE named graceful-degradation paths over committed fixtures,
// throw-free and NaN-safe, WITHOUT a DOM (environment 'node' — these exercise the
// resolution + read surface, not the element layer; the rendered/lifecycle proof
// is the e2e `unresolved` scenario + consoleGuard):
//   1. missing entity / designed empty state ........ all-unresolved.json
//   2. unavailable + last-known + staleness ......... model-y-asleep.json
//   3. absent device registry (minimal/older install) awake fixture, registry deleted
//
// DISCIPLINE (1.3/1.4/1.5): assert the MECHANISM (degraded -> neutral/quiescent,
// no throw), never a fabricated wall-clock fact. Staleness is asserted against the
// fixture's OWN documented `reference_now`, injected for hermeticism — never a
// production constant or the client clock. Hermetic: committed fixtures only, ZERO
// network.
import { describe, expect, test } from 'vitest';
import awakeFixture from '../fixtures/model-y-awake.json';
import asleepFixture from '../fixtures/model-y-asleep.json';
import unresolvedFixture from '../fixtures/all-unresolved.json';
import type { HomeAssistant, HassEntity, TeslaCardConfig } from '../types';
import { DEFAULT_ENTITIES, type EntityKey } from '../const';
import { num, display, isUnavailable, isAsleep, stateObj, rawState } from '../helpers';
import { resolveEntities } from './resolve';
import { read, readKey, isQuiescent } from './freshness';
import { resolveEnergyEntities, hasEnergySite } from './energy';
import { batteryGauge } from '../ui';

/** A HomeAssistant carrying just the fields the readers touch. */
function makeHass(states: Record<string, HassEntity>, extra: Partial<HomeAssistant> = {}): HomeAssistant {
  return { states, ...extra } as unknown as HomeAssistant;
}

function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}

const AWAKE_STATES = awakeFixture.states as Record<string, HassEntity>;
const ASLEEP_STATES = asleepFixture.states as Record<string, HassEntity>;
const UNRESOLVED_STATES = unresolvedFixture.states as Record<string, HassEntity>;

/** The asleep corpus documents its own injected reference clock (50 min after the stamps). */
const ASLEEP_NOW = Date.parse(asleepFixture.provenance.reference_now);

/** A spread of vehicle keys covering numeric, range, status and string reads. */
const SAMPLE_KEYS: EntityKey[] = [
  'battery_level',
  'battery_range',
  'usable_battery_level',
  'odometer',
  'status',
  'charging_status',
];

// ───────────────────────────────────────────────────────────────────────────
// Fixture contract (Task 1.3) — both new corpora are pure JSON, synthesized
// ───────────────────────────────────────────────────────────────────────────

describe('fixtures — synthesized, provenance-tagged, dual-consumer pure JSON', () => {
  test('asleep + all-unresolved carry synthesized provenance and an honest entity_count', () => {
    for (const fx of [asleepFixture, unresolvedFixture]) {
      expect(fx.provenance.synthesized).toBe(true);
      expect(fx.provenance.entity_count).toBe(Object.keys(fx.states).length);
    }
    expect(asleepFixture.provenance.scenario).toBe('asleep');
    expect(unresolvedFixture.provenance.scenario).toBe('all-unresolved');
  });

  test('survive serialize/clone round-trips (no functions/Dates) — importable by Vitest AND the demo harness', () => {
    for (const fx of [asleepFixture, unresolvedFixture]) {
      expect(JSON.parse(JSON.stringify(fx))).toEqual(fx);
      expect(structuredClone(fx)).toEqual(fx);
    }
  });

  test('the asleep corpus reuses the awake ids/shape (same corpus, flipped states)', () => {
    expect(Object.keys(ASLEEP_STATES).sort()).toEqual(Object.keys(AWAKE_STATES).sort());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Path 1 — missing entity / designed empty state (all-unresolved.json)
// ───────────────────────────────────────────────────────────────────────────

describe('AC1 path 1 — foreign/unconfigured install: nothing Tesla resolves → designed empty state', () => {
  const hass = makeHass(UNRESOLVED_STATES);
  const config = cfg({ type: 'custom:tesla-card' });

  test('resolveEntities yields the bundled defaults for every key, with NO throw', () => {
    let resolved!: Record<EntityKey, string>;
    expect(() => {
      resolved = resolveEntities(hass, config);
    }).not.toThrow();
    // Nothing in this corpus matches a Tesla function-key, so every key falls back
    // to its bundled default — and every default id is ABSENT from these states.
    for (const key of Object.keys(DEFAULT_ENTITIES) as EntityKey[]) {
      expect(resolved[key]).toBe(DEFAULT_ENTITIES[key]);
      expect(hass.states[resolved[key]]).toBeUndefined();
    }
  });

  test('every sampled vehicle read is neutral: stateObj undefined, num undefined, display "—"', () => {
    for (const key of SAMPLE_KEYS) {
      expect(stateObj(hass, config, key)).toBeUndefined();
      expect(num(hass, config, key)).toBeUndefined();
      expect(display(hass, config, key)).toBe('—');
    }
  });

  test('the freshness reader classifies every resolved id unavailable (no false certainty)', () => {
    const resolved = resolveEntities(hass, config);
    for (const key of SAMPLE_KEYS) {
      const r = read(hass, resolved[key]);
      expect(r.available).toBe(false);
      expect(r.staleness).toBe('unavailable');
      expect(r.value).toBeUndefined();
      expect(isQuiescent(r)).toBe(true);
    }
  });

  test('no energy site is detected → Energy tab stays hidden', () => {
    expect(hasEnergySite(resolveEnergyEntities(hass, config))).toBe(false);
  });

  test('isAsleep is true (no battery signal) and nothing throws', () => {
    expect(() => isAsleep(hass, config)).not.toThrow();
    expect(isAsleep(hass, config)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Path 2 — unavailable + last-known + staleness (model-y-asleep.json)
// ───────────────────────────────────────────────────────────────────────────

describe('AC1 path 2 — asleep/unavailable: volatile reads degrade, last-known surfaces as not-fresh', () => {
  const hass = makeHass(ASLEEP_STATES);
  const config = cfg();

  test('volatile keys read unavailable → num undefined, display "—" (never NaN/0/false reading)', () => {
    for (const key of ['battery_level', 'battery_range'] as EntityKey[]) {
      expect(isUnavailable(rawState(hass, config, key))).toBe(true);
      expect(num(hass, config, key)).toBeUndefined();
      expect(display(hass, config, key)).toBe('—');
    }
  });

  test('last-known cacheable values are retained, not blanked', () => {
    // odometer holds its last-known reading while the car sleeps.
    expect(rawState(hass, config, 'odometer')).toBe('12345');
    expect(num(hass, config, 'odometer')).toBe(12345);
  });

  test('the freshness reader buckets an available last-known read non-fresh under reference_now', () => {
    // usable_battery_level: available, default thresholds, stamped 50 min before
    // reference_now → past the asleep window. Assert the RULE relative to the
    // injected, fixture-documented reference, not a wall-clock constant.
    const r = readKey(hass, config, 'usable_battery_level', { now: ASLEEP_NOW });
    expect(r.available).toBe(true);
    expect(r.staleness).not.toBe('fresh');
    expect(r.staleness).toBe('asleep');
    expect(isQuiescent(r)).toBe(true);
  });

  test('a volatile unavailable key reads available:false via the key-aware reader', () => {
    const r = readKey(hass, config, 'battery_level', { now: ASLEEP_NOW });
    expect(r.available).toBe(false);
    expect(r.staleness).toBe('unavailable');
  });

  test('isAsleep is true (status "off") and nothing throws', () => {
    expect(() => isAsleep(hass, config)).not.toThrow();
    expect(isAsleep(hass, config)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Path 3 — absent device registry (minimal/older install)
// ───────────────────────────────────────────────────────────────────────────

describe('AC1 path 3 — absent registry: resolution falls back to defaults, card still reads', () => {
  // The awake corpus is states-only (no entities/devices) — exactly the
  // minimal/older-install shape. Build hass with registries explicitly absent.
  const hass = makeHass(AWAKE_STATES);
  const config = cfg();

  test('hass carries no entity/device registry (the install this path models)', () => {
    expect(hass.entities).toBeUndefined();
    expect(hass.devices).toBeUndefined();
  });

  test('resolveEntities still resolves the live ids by default-slug guess, NO throw', () => {
    let resolved!: Record<EntityKey, string>;
    expect(() => {
      resolved = resolveEntities(hass, config);
    }).not.toThrow();
    // Direct-guess against live states resolves the present anchored id.
    expect(resolved.battery_level).toBe('sensor.garage_model_y_battery_level');
    expect(hass.states[resolved.battery_level]).toBeTruthy();
  });

  test('the awake happy-path read is unchanged by registry-absence (no regression)', () => {
    expect(num(hass, config, 'battery_level')).toBe(72);
    expect(display(hass, config, 'battery_level', { withUnit: false })).toBe('72');
    expect(isAsleep(hass, config)).toBe(false);
    const r = read(hass, 'sensor.garage_model_y_battery_level', {
      now: Date.parse('2026-06-15T14:41:00Z'),
    });
    expect(r.available).toBe(true);
    expect(r.staleness).toBe('fresh');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Inherited DoD — NaN-safety holds on every degraded path (NFR-4)
// ───────────────────────────────────────────────────────────────────────────

describe('NFR-4 — no degraded numeric read returns NaN; undefined never renders as a real value', () => {
  for (const [name, states] of [
    ['all-unresolved', UNRESOLVED_STATES],
    ['asleep', ASLEEP_STATES],
  ] as const) {
    test(`${name}: num never NaN, display never a bare numeral, batteryGauge(undefined) safe`, () => {
      const hass = makeHass(states as Record<string, HassEntity>);
      const config = cfg();
      for (const key of SAMPLE_KEYS) {
        const n = num(hass, config, key);
        if (n !== undefined) expect(Number.isNaN(n)).toBe(false);
        // display is either em-dash, a formatted value, or pretty text — never "NaN".
        expect(display(hass, config, key)).not.toBe('NaN');
        expect(display(hass, config, key)).not.toBe('undefined');
      }
      // The gauge primitive tolerates an undefined percent (unknown band, no throw).
      expect(() => batteryGauge(num(hass, config, 'battery_level'))).not.toThrow();
    });
  }
});
