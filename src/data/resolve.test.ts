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
import { resolveEntities, slugify } from './resolve';
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
