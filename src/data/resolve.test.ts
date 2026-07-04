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

  // ── AC2 (ambiguity guard) — a genuinely mixed multi-integration install falls back
  //    to the un-aliased fleet path rather than aliasing with a maybe-wrong dialect.
  //    detectVehicle picks the DEVICE independently of detectDialect's platform count,
  //    so aliasing a mixed install with the count-winning dialect is a live-wrong
  //    resolve (strictly worse than the pre-change fleet ghost). Guard: ambiguous ⇒
  //    tesla_fleet (no table entry). [code-review 2026-07-03]
  describe('AC2 — ambiguous multi-integration install degrades to fleet (no aliasing)', () => {
    /** Two co-resident Tesla platforms: tesla_custom (majority device) + tesla_fleet. */
    function mixedHass(): HomeAssistant {
      const entities: Record<string, any> = {
        // tesla_custom device — the majority (3 entities), so it wins detectDialect's
        // count tie-break AND is the vehicle device detectVehicle picks (slug 'mycar').
        'sensor.mycar_battery': { entity_id: 'sensor.mycar_battery', platform: 'tesla_custom', device_id: 'dev1' },
        'sensor.mycar_range': { entity_id: 'sensor.mycar_range', platform: 'tesla_custom', device_id: 'dev1' },
        'binary_sensor.mycar_charging': { entity_id: 'binary_sensor.mycar_charging', platform: 'tesla_custom', device_id: 'dev1' },
        // a co-resident tesla_fleet entity (a 2nd platform ⇒ detection is ambiguous).
        'sensor.fleetcar_odometer': { entity_id: 'sensor.fleetcar_odometer', platform: 'tesla_fleet', device_id: 'dev2' },
      };
      const states: Record<string, any> = {};
      for (const id of Object.keys(entities)) states[id] = { entity_id: id, state: 'on' };
      return makeHass({
        entities,
        devices: { dev1: { name: 'mycar', manufacturer: 'Tesla' }, dev2: { name: 'fleetcar', manufacturer: 'Tesla' } },
        states,
      });
    }

    test('the raw detection IS ambiguous and would otherwise pick tesla_custom (guard is meaningful, not a tautology)', () => {
      const report = detectDialect(mixedHass(), cfg());
      expect(report.ambiguous).toBe(true);
      expect(report.integration).toBe('tesla_custom'); // the count-winner the guard overrides
    });

    test('resolveEntities does NOT alias — battery_level falls to the fleet default, not sensor.mycar_battery', () => {
      const resolved = resolveEntities(mixedHass(), cfg());
      // Aliased (unguarded) would be 'sensor.mycar_battery'; the guard takes the fleet path.
      expect(resolved.battery_level).not.toBe('sensor.mycar_battery');
      expect(resolved.battery_level).toBe(DEFAULT_ENTITIES.battery_level);
    });

    test('an ABSENT-in-tesla_custom key is NOT force-suppressed to `` under ambiguity (fleet has no ABSENT set)', () => {
      const resolved = resolveEntities(mixedHass(), cfg());
      expect(resolved.preconditioning).not.toBe('');
      expect(resolved.preconditioning).toBe(DEFAULT_ENTITIES.preconditioning);
    });

    test('an explicit config.integration override makes detection unambiguous ⇒ aliasing still applies', () => {
      // A user can still force a dialect on a mixed install; override ⇒ ambiguous:false.
      const resolved = resolveEntities(mixedHass(), cfg({ integration: 'tesla_custom' }));
      expect(resolved.battery_level).toBe('sensor.mycar_battery');
    });
  });
});
