// Co-located corpus + precedence + rename test for the entity resolver (Story 1.3).
//
// CONFIRM-BEFORE-HARDEN (AR-0, AC1): these assertions were authored against the resolver's
// CURRENT behaviour and proven green BEFORE the whole-file move `src/resolve.ts →
// src/data/resolve.ts` — they GATE the move, they do not document a rewrite. The matcher
// is unchanged: this story locks + relocates it. The import below (`./resolve`) is the
// post-move sibling path.
//
// Pure-hub test: environment 'node' (reads hass.states, no DOM); hermetic — imports only
// the committed fixture, makes ZERO network calls.
import { describe, expect, test } from 'vitest';
import fixture from '../fixtures/model-y-awake.json';
import fleetGolden from '../fixtures/resolve-fleet-golden.json';
import { resolveEntities, slugify } from './resolve';
import { adapterFor, normalizeChargingState, detectDialect } from './dialect';
import { DEFAULT_ENTITIES, type EntityKey } from '../const';
import type { HomeAssistant, TeslaCardConfig } from '../types';

const VEHICLE_KEYS = Object.keys(DEFAULT_ENTITIES) as EntityKey[];

/** A valid TeslaCardConfig (the card contract requires `type`) with overrides. */
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}

/** Reference slug the bundled DEFAULT_ENTITIES were captured against (mirrors resolve.ts). */
const REFERENCE_SLUG = 'garage_model_y';

/** `${domain}.${suffix}` canonical identity of a bundled default id (mirrors the matcher). */
function canonicalOf(entityId: string): string {
  const dot = entityId.indexOf('.');
  const domain = entityId.slice(0, dot);
  const object = entityId.slice(dot + 1);
  const suffix = object.startsWith(REFERENCE_SLUG + '_')
    ? object.slice(REFERENCE_SLUG.length + 1)
    : object;
  return `${domain}.${suffix}`;
}

/** Minimal HomeAssistant carrying only the maps the resolver reads. */
function makeHass(parts: Partial<HomeAssistant>): HomeAssistant {
  return parts as unknown as HomeAssistant;
}

describe('entity resolver — corpus-confirmed matcher (Story 1.3)', () => {
  // ── AC1: all 84 vehicle keys resolve to real corpus ids, zero collisions ──────────
  describe('AC1 — corpus presence + zero collisions', () => {
    const hass = makeHass({ states: fixture.states as HomeAssistant['states'] });
    const resolved = resolveEntities(hass, cfg());

    test('the key count is the real DEFAULT_ENTITIES count (84), not a magic number', () => {
      // Derived from the value table, so it tracks the registry if keys are added later.
      expect(VEHICLE_KEYS.length).toBe(84);
    });

    test('every vehicle key resolves to an id PRESENT in the corpus (no absent-default fallback)', () => {
      const corpusIds = new Set(Object.keys(fixture.states));
      const missing = VEHICLE_KEYS.filter((k) => !corpusIds.has(resolved[k]));
      expect(missing, `keys resolving to ids absent from the corpus:\n${missing.join('\n')}`).toEqual([]);
      // Belt-and-braces: a value for every key (the resolver always returns a complete map).
      expect(Object.keys(resolved).length).toBe(VEHICLE_KEYS.length);
    });

    test('zero canonical collisions: no two keys share a (domain, anchored-suffix) identity', () => {
      // Structural — computed from DEFAULT_ENTITIES, so it keeps protecting the property
      // if keys are added later (NOT a hard-coded "0 for keys X,Y").
      const byCanonical = new Map<string, EntityKey[]>();
      for (const key of VEHICLE_KEYS) {
        const c = canonicalOf(DEFAULT_ENTITIES[key]);
        byCanonical.set(c, [...(byCanonical.get(c) ?? []), key]);
      }
      const collisions = [...byCanonical.entries()].filter(([, ks]) => ks.length > 1);
      expect(
        collisions,
        `canonical collisions (ambiguous resolution):\n${collisions.map(([c, ks]) => `${c}: ${ks.join(', ')}`).join('\n')}`
      ).toEqual([]);
    });
  });

  // ── AC2: the zero-collision proof is corpus-specific and NOT transferable ──────────
  test('AC2 — proof is pinned to ONE Model Y on tesla_fleet (re-confirmed per-adapter in Story 1.4)', () => {
    // The zero-collision guarantee above holds for THIS single-integration, single-model
    // corpus ONLY. Other models/dialects each carry their OWN corpus check, landing with
    // Story 1.4's per-adapter seam test. This story neither builds nor stubs that adapter.
    expect(fixture.provenance.source_integration).toBe('tesla_fleet');
    expect(fixture.provenance.model).toBe('Model Y');
  });

  // ── AC3: precedence is explicit-override > resolved > bundled-default ──────────────
  describe('AC3 — precedence tiers', () => {
    test('(a) an explicit config.entities override wins even when another id would resolve', () => {
      const hass = makeHass({ states: fixture.states as HomeAssistant['states'] });
      // `sensor.odometer` IS present in the corpus and would resolve; the override must beat it.
      const config = cfg({ entities: { odometer: 'sensor.my_custom_odometer' } });
      expect(resolveEntities(hass, config).odometer).toBe('sensor.my_custom_odometer');
    });

    test('(b) a resolved (live) match wins over the bundled default when no override is given', () => {
      // Distinct id from the default: a renamed-prefix live state must beat DEFAULT_ENTITIES.
      const live = 'sensor.model_y_battery_level';
      expect(live).not.toBe(DEFAULT_ENTITIES.battery_level); // guard: ids genuinely differ
      const hass = makeHass({ states: { [live]: { entity_id: live, state: '80' } } as any });
      const resolved = resolveEntities(hass, cfg({ prefix: 'model_y' }));
      expect(resolved.battery_level).toBe(live);
    });

    test('(c) the bundled default is the fallback when neither override nor a live match exists', () => {
      const hass = makeHass({ states: {} }); // empty corpus → nothing resolves
      expect(resolveEntities(hass, cfg()).battery_level).toBe(DEFAULT_ENTITIES.battery_level);
    });

    test('(d) no-hass degradation: every key falls to its bundled default, but an explicit override still wins', () => {
      // The card calls resolveEntities(this.hass, …) during init, where `hass` can be undefined.
      // That branch (resolve.ts `if (!hass)`) honours overrides + bundled defaults ONLY — assert both.
      const resolved = resolveEntities(undefined, cfg({ entities: { odometer: 'sensor.my_odo' } }));
      expect(resolved.odometer).toBe('sensor.my_odo'); // override survives a missing hass
      expect(resolved.battery_level).toBe(DEFAULT_ENTITIES.battery_level); // others = bundled default
      expect(Object.keys(resolved).length).toBe(VEHICLE_KEYS.length); // still a complete map
    });
  });

  // ── AC4: a renamed device still resolves by function-name (anchored-suffix) ────────
  test('AC4 — renamed device (garage_model_y → model_y) still resolves by function-name', () => {
    // The committed fixture carries NO entities/devices registry, so synthesize one: clone
    // every state under the renamed prefix, then supply a minimal registry so detectVehicle
    // derives the new slug and path-2 (device-registry match) resolves by canonical identity.
    const renamedStates: Record<string, any> = {};
    const entities: Record<string, any> = {};
    for (const [id, st] of Object.entries(fixture.states)) {
      // Bare ids (e.g. sensor.odometer) are NOT prefixed — they must stay unchanged.
      const renamed = id.replace(`.${REFERENCE_SLUG}_`, '.model_y_');
      renamedStates[renamed] = { ...(st as any), entity_id: renamed };
      entities[renamed] = { entity_id: renamed, platform: 'tesla_fleet', device_id: 'dev_y' };
    }
    const hass = makeHass({
      states: renamedStates as HomeAssistant['states'],
      entities,
      devices: { dev_y: { name: 'Model Y', manufacturer: 'Tesla' } },
    });

    const resolved = resolveEntities(hass, cfg());

    // An anchored key now resolves to its renamed id (function-name survived the rename).
    expect(resolved.battery_level).toBe('sensor.model_y_battery_level');
    // A bare id is un-prefixed and resolves unchanged under rename.
    expect(resolved.odometer).toBe('sensor.odometer');
    // And the whole map still lands on ids that exist in the renamed corpus.
    const renamedIds = new Set(Object.keys(renamedStates));
    const missing = VEHICLE_KEYS.filter((k) => !renamedIds.has(resolved[k]));
    expect(missing, `keys not resolving under rename:\n${missing.join('\n')}`).toEqual([]);
  });
});

// Code-review regression (Epic 9 P1): slugify must coerce a non-string argument rather
// than throw `…trim is not a function`. A hand-written non-string `config.name`/`device`
// (e.g. a YAML number `name: 2024`) reaches slugify because the call sites guard only
// truthiness, not type — an un-coerced slugify crashed both the editor's discovery on
// open AND the card's entity resolution at runtime.
describe('slugify — non-string coercion (FR-24)', () => {
  test('a numeric argument slugs instead of throwing', () => {
    expect(() => slugify(2024 as unknown as string)).not.toThrow();
    expect(slugify(2024 as unknown as string)).toBe('2024');
  });
  test('null/undefined slug to the empty string (not a throw)', () => {
    expect(slugify(undefined as unknown as string)).toBe('');
    expect(slugify(null as unknown as string)).toBe('');
  });
  test('resolveEntities does not throw with a non-string config.name', () => {
    expect(() =>
      resolveEntities({ states: {} } as unknown as HomeAssistant, cfg({ name: 2024 as unknown as string }))
    ).not.toThrow();
  });
});

// ── Story 14.1 — per-dialect alias resolution + honest ABSENT degrade ──────────
//
// The resolver now consults detectDialect → DIALECT_ENTITY_ALIASES / DIALECT_ABSENT.
// These assertions are RED against the pre-wire resolver (which matched only fleet
// KEY_SIGNATURES): battery_level would fall to the fleet default
// `sensor.garage_model_y_battery_level` (not the alias-resolved `sensor.<slug>_battery`),
// and an ABSENT key would fall to its fleet default (not `''`). They pass only because
// the dialect alias/ABSENT tables are now consulted — proving the new path, not a tautology.
describe('Story 14.1 — per-dialect resolution (alias + ABSENT wiring)', () => {
  /** Build a synthetic single-device dialect install: platform-tagged registry + states. */
  function dialectHass(
    platform: string,
    slug: string,
    ids: string[],
    stateOverrides: Record<string, string> = {}
  ): HomeAssistant {
    const entities: Record<string, any> = {};
    const states: Record<string, any> = {};
    for (const id of ids) {
      entities[id] = { entity_id: id, platform, device_id: 'dev1' };
      states[id] = { entity_id: id, state: stateOverrides[id] ?? 'on' };
    }
    return makeHass({
      entities,
      devices: { dev1: { name: slug, manufacturer: 'Tesla' } },
      states,
    });
  }

  describe('AC1 — a divergent entity resolves via the dialect alias, not the fleet fallback', () => {
    test('(a) tesla_custom battery_level → the aliased sensor.<slug>_battery (NOT the fleet default)', () => {
      const hass = dialectHass('tesla_custom', 'mycar', [
        'sensor.mycar_battery',
        'binary_sensor.mycar_charging',
      ]);
      const resolved = resolveEntities(hass, cfg());
      expect(resolved.battery_level).toBe('sensor.mycar_battery');
      // The pre-wire resolver would have returned this fleet ghost — assert we DON'T.
      expect(resolved.battery_level).not.toBe(DEFAULT_ENTITIES.battery_level);
    });

    test('(b) tessie windows → the vent_windows cover (domain-preserving suffix divergence)', () => {
      const hass = dialectHass('tessie', 'mycar', [
        'cover.mycar_vent_windows',
        'switch.mycar_defrost_mode',
        'select.mycar_seat_heater_left',
      ]);
      const resolved = resolveEntities(hass, cfg());
      expect(resolved.windows).toBe('cover.mycar_vent_windows');
      expect(resolved.defrost).toBe('switch.mycar_defrost_mode');
      expect(resolved.seat_fl).toBe('select.mycar_seat_heater_left');
    });
  });

  describe('AC4 — an ABSENT key degrades to the empty-string sentinel, never a fleet ghost', () => {
    test('(c) tesla_custom preconditioning resolves to `` (not the fleet default)', () => {
      const hass = dialectHass('tesla_custom', 'mycar', ['sensor.mycar_battery']);
      const resolved = resolveEntities(hass, cfg());
      expect(resolved.preconditioning).toBe('');
      expect(resolved.preconditioning).not.toBe(DEFAULT_ENTITIES.preconditioning);
    });

    test('(d) an explicit config.entities override still WINS over an ABSENT marker', () => {
      const hass = dialectHass('tesla_custom', 'mycar', ['sensor.mycar_battery']);
      const resolved = resolveEntities(
        hass,
        cfg({ entities: { preconditioning: 'binary_sensor.my_precond' } })
      );
      expect(resolved.preconditioning).toBe('binary_sensor.my_precond');
    });

    test('an aliased key with no matching entity falls back to the dialect-correct guess, NOT the fleet ghost', () => {
      // tesla_custom detected, but battery entity absent from this install → the
      // fallback is the slug-prefixed alias guess (sensor.<slug>_battery), never
      // the fleet `sensor.<slug>_battery_level` default (the mis-resolve AC4 forbids).
      const hass = dialectHass('tesla_custom', 'mycar', ['sensor.mycar_range']);
      const resolved = resolveEntities(hass, cfg());
      expect(resolved.battery_level).toBe('sensor.mycar_battery');
      expect(resolved.battery_level).not.toBe(DEFAULT_ENTITIES.battery_level);
    });
  });

  describe('AC5 — tesla_custom charging is derived from the boolean (adapter/DATA layer)', () => {
    test('(e) adapterFor(tesla_custom).normalizeChargingState maps the boolean vocabulary', () => {
      const hass = dialectHass('tesla_custom', 'mycar', ['sensor.mycar_battery']);
      const a = adapterFor(hass, cfg());
      expect(a.integration).toBe('tesla_custom');
      expect(a.normalizeChargingState('on')).toBe('charging');
      expect(a.normalizeChargingState('off')).toBe('stopped');
    });

    test('(f) the dead charge_complete override is gone — default normalizer returns unknown', () => {
      expect(normalizeChargingState('charge_complete')).toBe('unknown');
    });
  });

  describe('AC6 — tesla_fleet resolution is byte-identical to the pre-change golden', () => {
    test('resolveEntities on the fleet corpus deep-equals the committed golden', () => {
      const hass = makeHass({ states: fixture.states as HomeAssistant['states'] });
      const resolved = resolveEntities(hass, cfg());
      // Golden captured from the PRE-change resolver (throwaway capture on a clean
      // tree) — a circular "assert against myself" test is explicitly avoided.
      expect(resolved).toEqual(fleetGolden);
    });

    test('a no-registry fleet install still lands on the golden (no dialect entry ⇒ fleet path)', () => {
      // No entities registry ⇒ detectDialect → default tesla_fleet ⇒ no alias/ABSENT.
      const hass = makeHass({ states: fixture.states as HomeAssistant['states'] });
      const resolved = resolveEntities(hass, cfg());
      expect(resolved.battery_level).toBe(DEFAULT_ENTITIES.battery_level);
      expect(resolved.preconditioning).toBe(DEFAULT_ENTITIES.preconditioning); // NOT '' for fleet
    });
  });

  // ── AC2/AC4 (retained same-device ambiguity guard) — Story 14.2 device-scoping
  //    superseded the Story-14.1 registry-wide guard: a split-*device* household is
  //    now disambiguated to the car's own dialect (covered in the Story 14.2 block
  //    below), so the guard fires ONLY when the ONE resolved vehicle device carries
  //    ≥2 Tesla platforms at once. That is essentially production-unreachable (a
  //    device_id belongs to a single config entry), so the guard is cheap
  //    defense-in-depth, exercised only by this synthetic same-device fixture. When
  //    it fires the resolver falls to the un-aliased fleet path rather than alias
  //    with a maybe-wrong dialect. [Story 14.2 AC4; supersedes code-review 2026-07-03]
  describe('AC4 — a same-device two-platform install still degrades to fleet (retained guard)', () => {
    /** Two Tesla platforms on the SAME device — the only shape that stays ambiguous
     *  after device-scoping (tesla_custom majority + one co-resident tesla_fleet). */
    function sameDeviceHass(): HomeAssistant {
      const entities: Record<string, any> = {
        'sensor.mycar_battery': { entity_id: 'sensor.mycar_battery', platform: 'tesla_custom', device_id: 'dev1' },
        'sensor.mycar_range': { entity_id: 'sensor.mycar_range', platform: 'tesla_custom', device_id: 'dev1' },
        'binary_sensor.mycar_charging': { entity_id: 'binary_sensor.mycar_charging', platform: 'tesla_custom', device_id: 'dev1' },
        // A co-resident tesla_fleet entity on the SAME device ⇒ scoped detection is
        // still ambiguous (2 platforms in the one resolved device's scope).
        'sensor.mycar_odometer': { entity_id: 'sensor.mycar_odometer', platform: 'tesla_fleet', device_id: 'dev1' },
      };
      const states: Record<string, any> = {};
      for (const id of Object.keys(entities)) states[id] = { entity_id: id, state: 'on' };
      return makeHass({
        entities,
        devices: { dev1: { name: 'mycar', manufacturer: 'Tesla' } },
        states,
      });
    }

    test('the scoped detection IS ambiguous and would otherwise pick tesla_custom (guard is meaningful, not a tautology)', () => {
      const hass = sameDeviceHass();
      // Scope = the one device's entities; both platforms are in it ⇒ still ambiguous.
      const scope = new Set(Object.keys((hass as any).entities));
      const report = detectDialect(hass, cfg(), scope);
      expect(report.ambiguous).toBe(true);
      expect(report.integration).toBe('tesla_custom'); // the count-winner the guard overrides
    });

    test('resolveEntities does NOT alias — battery_level falls to the fleet default, not sensor.mycar_battery', () => {
      const resolved = resolveEntities(sameDeviceHass(), cfg());
      // Aliased (unguarded) would be 'sensor.mycar_battery'; the guard takes the fleet path.
      expect(resolved.battery_level).not.toBe('sensor.mycar_battery');
      expect(resolved.battery_level).toBe(DEFAULT_ENTITIES.battery_level);
    });

    test('an ABSENT-in-tesla_custom key is NOT force-suppressed to `` under ambiguity (fleet has no ABSENT set)', () => {
      const resolved = resolveEntities(sameDeviceHass(), cfg());
      expect(resolved.preconditioning).not.toBe('');
      expect(resolved.preconditioning).toBe(DEFAULT_ENTITIES.preconditioning);
    });

    test('an explicit config.integration override makes detection unambiguous ⇒ aliasing still applies', () => {
      // A user can still force a dialect on a mixed same-device install; override ⇒
      // ambiguous:false, and the one device carries the tesla_custom battery entity.
      const resolved = resolveEntities(sameDeviceHass(), cfg({ integration: 'tesla_custom' }));
      expect(resolved.battery_level).toBe('sensor.mycar_battery');
    });
  });
});

// ── Story 14.2 — vehicle-device-scoped dialect detection (dual-integration) ──────
//
// Closes the D-DGT-1 dual-integration deferrals: a split-platform household (a
// tesla_custom car + a tesla_fleet Powerwall) now resolves the CAR on its own
// dialect instead of being forced to the un-aliased fleet default. Three-sided
// fix: (3a) detectVehicle prefers the vehicle-shaped device; (1/2) the dialect
// probe is scoped to that device; (3b/c) an `integration:` override steers device
// selection. Synthetic fixtures only (no real corpus — the dialect honesty note).
describe('Story 14.2 — vehicle-device-scoped dialect detection', () => {
  /**
   * A split household: a tesla_custom CAR (vehicle-shaped — owns an odometer, a
   * shared fleet key ⇒ a vehicle-signature hit) plus a tesla_fleet POWERWALL that
   * owns MORE Tesla entities than the car (the realistic shape — energy products
   * expose more sensors) but scores ZERO vehicle keys. A car-majority fixture is
   * forbidden: it would hide the device-selection defect (the "passes even if
   * broken" trap the 14.1 review flagged).
   */
  function splitHouseholdHass(): HomeAssistant {
    const car: Record<string, string> = {
      'sensor.car_battery': 'tesla_custom', // divergent (→ sensor.battery), the alias target
      'sensor.car_range': 'tesla_custom', // divergent (→ sensor.range), not a vehicle key
      'sensor.car_odometer': 'tesla_custom', // SHARED fleet key (→ sensor.odometer) ⇒ vehicle hit
    };
    const powerwall: Record<string, string> = {
      'sensor.pw_battery_power': 'tesla_fleet',
      'sensor.pw_solar_power': 'tesla_fleet',
      'sensor.pw_load_power': 'tesla_fleet',
      'sensor.pw_grid_power': 'tesla_fleet',
      'sensor.pw_percentage': 'tesla_fleet', // 5 entities > the car's 3, none vehicle-shaped
    };
    const entities: Record<string, any> = {};
    const states: Record<string, any> = {};
    for (const [id, platform] of Object.entries(car)) {
      entities[id] = { entity_id: id, platform, device_id: 'car1' };
      states[id] = { entity_id: id, state: '50' };
    }
    for (const [id, platform] of Object.entries(powerwall)) {
      entities[id] = { entity_id: id, platform, device_id: 'pw1' };
      states[id] = { entity_id: id, state: '1.0' };
    }
    return makeHass({
      entities,
      devices: {
        car1: { name: 'car', manufacturer: 'Tesla' },
        pw1: { name: 'pw', manufacturer: 'Tesla' },
      },
      states,
    });
  }

  describe('AC1 — the split household resolves the car end-to-end (device + scope)', () => {
    test('(a) the car resolves via its tesla_custom alias even though the Powerwall owns MORE entities', () => {
      const resolved = resolveEntities(splitHouseholdHass(), cfg());
      // The car (vehicle-shaped) is selected over the higher-count Powerwall, its
      // dialect is scoped to the car device (single platform ⇒ not ambiguous), and
      // the divergent battery resolves via the tesla_custom alias sensor.<slug>_battery.
      expect(resolved.battery_level).toBe('sensor.car_battery');
      // This assertion is RED if EITHER half of the fix is removed:
      //  • vehicle-signature preference removed ⇒ raw most-entities picks the
      //    Powerwall ⇒ scope tesla_fleet ⇒ battery_level = fleet default; and
      //  • scope removed ⇒ registry-wide probe is ambiguous ⇒ guard forces fleet.
      expect(resolved.battery_level).not.toBe(DEFAULT_ENTITIES.battery_level);
      // The shared vehicle key resolves against the SAME (car) device — proof the
      // car, not the Powerwall, was selected.
      expect(resolved.odometer).toBe('sensor.car_odometer');
    });
  });

  /**
   * Two vehicle-shaped cars of DIFFERENT platforms, EQUAL vehicle-signature score
   * (each owns exactly one shared fleet key: an odometer — the `_widget`/`_battery`/
   * `_cop_active` entities score 0) and equal entity counts (3 each), with the
   * tesla_fleet car inserted FIRST so it wins the raw-count/insertion tie. Only
   * override steering (3b) distinguishes them ⇒ the override is load-bearing. The
   * fleet car also carries a teslemetry-DIVERGENT `cop_actively_cooling` entity so
   * test (c) can prove the override dialect governs (not a silent fleet fallback).
   */
  function twoCarsHass(): HomeAssistant {
    const entities: Record<string, any> = {
      'sensor.cf_odometer': { entity_id: 'sensor.cf_odometer', platform: 'tesla_fleet', device_id: 'cf' },
      'sensor.cf_widget': { entity_id: 'sensor.cf_widget', platform: 'tesla_fleet', device_id: 'cf' },
      // teslemetry aliases cop_actively_cooling → binary_sensor.cabin_overheat_protection_active
      // (fleet's canonical is …_actively_cooling); this entity matches ONLY the teslemetry alias.
      'binary_sensor.cf_cabin_overheat_protection_active': { entity_id: 'binary_sensor.cf_cabin_overheat_protection_active', platform: 'tesla_fleet', device_id: 'cf' },
      'sensor.cc_odometer': { entity_id: 'sensor.cc_odometer', platform: 'tesla_custom', device_id: 'cc' },
      'sensor.cc_battery': { entity_id: 'sensor.cc_battery', platform: 'tesla_custom', device_id: 'cc' },
      'sensor.cc_widget': { entity_id: 'sensor.cc_widget', platform: 'tesla_custom', device_id: 'cc' },
    };
    const states: Record<string, any> = {};
    for (const id of Object.keys(entities)) states[id] = { entity_id: id, state: '1' };
    return makeHass({
      entities,
      devices: { cf: { name: 'cf', manufacturer: 'Tesla' }, cc: { name: 'cc', manufacturer: 'Tesla' } },
      states,
    });
  }

  describe('AC3 — device selection is vehicle-aware + override-steered', () => {
    test('(b) an integration override lands on the matching device (steering is load-bearing)', () => {
      // Without an override the fleet car (inserted first, equal score/count) wins…
      expect(resolveEntities(twoCarsHass(), cfg()).battery_level).not.toBe('sensor.cc_battery');
      // …the override steers selection onto the tesla_custom car, whose divergent
      // battery then resolves via the tesla_custom alias.
      const resolved = resolveEntities(twoCarsHass(), cfg({ integration: 'tesla_custom' }));
      expect(resolved.battery_level).toBe('sensor.cc_battery');
    });

    test('(c) an override naming a platform NO device owns → vehicle-shaped pick, no crash, dialect still applies', () => {
      // teslemetry is owned by neither device ⇒ the override key no-ops and selection
      // falls to the vehicle-shaped (here the first-inserted fleet) car. Crucially the
      // teslemetry dialect STILL governs resolution (documented mis-config, not a silent
      // fleet fallback); the escape hatch is config.device + config.entities[key].
      let resolved: Record<string, string> | undefined;
      expect(() => {
        resolved = resolveEntities(twoCarsHass(), cfg({ integration: 'teslemetry' }));
      }).not.toThrow();
      // A vehicle-shaped device (cf) was picked — its shared odometer resolves…
      expect(resolved!.odometer).toBe('sensor.cf_odometer');
      // …AND the teslemetry dialect genuinely governs: cop_actively_cooling resolves via
      // the teslemetry-DIVERGENT alias (binary_sensor.cabin_overheat_protection_active).
      // A silent fleet fallback would expect …_actively_cooling — which cf does NOT own —
      // so this assertion is RED unless teslemetry actually governs. (Distinguishes
      // "override dialect applied" from "fell back to fleet"; the shared odometer above
      // cannot.)
      expect(resolved!.cop_actively_cooling).toBe('binary_sensor.cf_cabin_overheat_protection_active');
    });

    test('(d) an explicit config.device pin wins over BOTH the override and the vehicle-signature preference', () => {
      // Pin the tesla_custom car by id while overriding to tesla_fleet (which would
      // otherwise steer to the fleet car): the pin must win the device selection.
      const resolved = resolveEntities(
        twoCarsHass(),
        cfg({ device: 'cc', integration: 'tesla_fleet' })
      );
      expect(resolved.odometer).toBe('sensor.cc_odometer'); // the pinned device, not cf
    });
  });

  describe('AC5 — single-integration / registry-less paths stay byte-identical', () => {
    test('a single-tesla_fleet install WITH a registry resolves by canonical (scope passed, one platform)', () => {
      // detectVehicle returns non-empty entityIds ⇒ scope is PASSED; a single-platform
      // scope counts to the same one platform as the registry-wide probe ⇒ identical.
      const entities: Record<string, any> = {
        'sensor.model_y_battery_level': { entity_id: 'sensor.model_y_battery_level', platform: 'tesla_fleet', device_id: 'dev_y' },
      };
      const states: Record<string, any> = { 'sensor.model_y_battery_level': { entity_id: 'sensor.model_y_battery_level', state: '80' } };
      const hass = makeHass({ entities, states, devices: { dev_y: { name: 'Model Y', manufacturer: 'Tesla' } } });
      const resolved = resolveEntities(hass, cfg());
      expect(resolved.battery_level).toBe('sensor.model_y_battery_level'); // fleet canonical match, no alias
      expect(detectDialect(hass, cfg(), new Set(['sensor.model_y_battery_level'])).integration).toBe('tesla_fleet');
    });

    test('a registry-less fleet install omits the scope (empty entityIds) ⇒ golden fleet resolution', () => {
      // detectVehicle returns entityIds:[] ⇒ resolve.ts OMITS the scope. This case pins
      // the registry-less GOLDEN resolution. Note it does NOT exercise the empty-Set-vs-
      // omit distinction: with hass.entities undefined the probe is skipped either way,
      // so an empty Set would yield the same golden. That distinction is proven at the
      // detectDialect unit level (dialect.test.ts "an EMPTY scope is NOT the same as
      // omitting it — empty ⇒ zero-count default, omit ⇒ registry-wide").
      const hass = makeHass({ states: fixture.states as HomeAssistant['states'] });
      const resolved = resolveEntities(hass, cfg());
      expect(resolved).toEqual(fleetGolden); // byte-identical to the Story 14.1 golden
    });
  });

  // ── AC3a hardening (code review 2026-07-04): the vehicle-signature score must be
  //    rename-proof (HA freezes entity_ids at creation, so a device rename detaches the
  //    display name from the entity-id slug) AND must not false-positive on generic
  //    canonicals (`sensor.power`/`sensor.speed`) that an energy device shares. A car
  //    with FEWER entities than a Powerwall — that also carries a bare `sensor.<slug>_power`
  //    — must still win device selection.
  describe('AC3a hardening — vehicle-signature is rename- and generic-suffix-proof', () => {
    /**
     * A RENAMED tesla_custom car: its device display name ("Renamed Car") no longer
     * matches its entity-id slug ("model_y", frozen at creation). The tesla_fleet
     * Powerwall is named "Powerwall", owns MORE entities (4 > the car's 2), and carries
     * a bare `sensor.powerwall_power` that strips to the generic canonical `sensor.power`.
     * The user pins `config.prefix: 'model_y'` (the documented rename escape hatch) so
     * the SELECTED car resolves; selection itself must NOT need the prefix.
     */
    function renamedCarPlusPowerwall(): HomeAssistant {
      const entities: Record<string, any> = {
        'sensor.model_y_odometer': { entity_id: 'sensor.model_y_odometer', platform: 'tesla_custom', device_id: 'car1' },
        'sensor.model_y_battery': { entity_id: 'sensor.model_y_battery', platform: 'tesla_custom', device_id: 'car1' },
        'sensor.powerwall_power': { entity_id: 'sensor.powerwall_power', platform: 'tesla_fleet', device_id: 'pw1' },
        'sensor.powerwall_solar_power': { entity_id: 'sensor.powerwall_solar_power', platform: 'tesla_fleet', device_id: 'pw1' },
        'sensor.powerwall_load_power': { entity_id: 'sensor.powerwall_load_power', platform: 'tesla_fleet', device_id: 'pw1' },
        'sensor.powerwall_grid_power': { entity_id: 'sensor.powerwall_grid_power', platform: 'tesla_fleet', device_id: 'pw1' },
      };
      const states: Record<string, any> = {};
      for (const id of Object.keys(entities)) states[id] = { entity_id: id, state: '1' };
      return makeHass({
        entities,
        devices: {
          car1: { name_by_user: 'Renamed Car', name: 'Model Y', manufacturer: 'Tesla' },
          pw1: { name: 'Powerwall', manufacturer: 'Tesla' },
        },
        states,
      });
    }

    test('the renamed lower-count car beats a higher-count Powerwall that owns a bare _power sensor', () => {
      const resolved = resolveEntities(renamedCarPlusPowerwall(), cfg({ prefix: 'model_y' }));
      // Car selected ⇒ scope tesla_custom ⇒ battery_level aliases to sensor.<prefix>_battery.
      expect(resolved.battery_level).toBe('sensor.model_y_battery');
      // RED before the hardening: the old score stripped the DISPLAY-name slug
      // ("renamed_car"), so the car's model_y_* entities scored 0, while the Powerwall's
      // `sensor.powerwall_power` → `sensor.power` (a canonical then in the set) scored 1
      // ⇒ Powerwall selected ⇒ scope tesla_fleet ⇒ battery_level = the fleet default.
      expect(resolved.battery_level).not.toBe(DEFAULT_ENTITIES.battery_level);
    });
  });
});
