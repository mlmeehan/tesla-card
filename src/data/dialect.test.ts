// Co-located unit test for the dialect-adapter layer (Story 1.4).
//
// Pure-hub test (D5/F3 "hubs get Vitest"): environment 'node' (reads hass.entities,
// no DOM); hermetic — reuses the committed tesla_fleet fixture and synthesizes
// minimal hass.entities for the other-platform / ambiguity cases. ZERO network.
//
// HONESTY NOTE: we have only a tesla_fleet Model Y corpus. For tesla_custom
// (uncaptured) we assert the alias-map/override MECHANISM is applied, with the
// assumed strings pinned in dialect.ts — never that those literals are ground truth.
import { describe, expect, test } from 'vitest';
import fixture from '../fixtures/model-y-awake.json';
import { TESLA_PLATFORMS } from './resolve';
import {
  DIALECTS,
  adapterFor,
  detectDialect,
  makeAdapter,
  normalizeChargingState,
  normalizeCoverState,
  normalizeLockState,
  type DialectAdapter,
  type Integration,
} from './dialect';
import type { HomeAssistant, TeslaCardConfig } from '../types';

/** A valid TeslaCardConfig (the card contract requires `type`) with overrides. */
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}

/** Minimal HomeAssistant carrying only the maps the detector reads. */
function makeHass(parts: Partial<HomeAssistant>): HomeAssistant {
  return parts as unknown as HomeAssistant;
}

/** Build a synthetic `hass.entities` registry with `count` entities on `platform`. */
function entitiesOn(
  spec: Array<{ platform: string; count: number }>
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const { platform, count } of spec) {
    for (let n = 0; n < count; n++) {
      const id = `sensor.dev_${platform}_${n}`;
      out[id] = { entity_id: id, platform, device_id: `dev_${platform}` };
    }
  }
  return out;
}

const REAL_INTEGRATIONS: Integration[] = [
  'tesla_fleet',
  'teslemetry',
  'tessie',
  'tesla_custom',
  'tesla',
];

describe('dialect-adapter layer (Story 1.4)', () => {
  // ── Single source of truth: the table + precedence track resolve.ts's set ──────────
  test('DIALECTS keys exactly match resolve.ts TESLA_PLATFORMS (no drift)', () => {
    expect(new Set(Object.keys(DIALECTS))).toEqual(new Set(TESLA_PLATFORMS));
    // And every real integration has an adapter (degrade-or-first-class, none missing).
    for (const i of REAL_INTEGRATIONS) expect(DIALECTS[i]?.integration).toBe(i);
  });

  // ── AC1 — detection + override + ambiguity ─────────────────────────────────────────
  describe('AC1 — detectDialect: probe / override / tie-break + surfaced ambiguity', () => {
    test('(a) probing tesla_fleet entities → tesla_fleet, source probe, not ambiguous', () => {
      const hass = makeHass({ entities: entitiesOn([{ platform: 'tesla_fleet', count: 5 }]) });
      const r = detectDialect(hass, cfg());
      expect(r.integration).toBe('tesla_fleet');
      expect(r.source).toBe('probe');
      expect(r.ambiguous).toBe(false);
      expect(r.candidates).toEqual(['tesla_fleet']);
    });

    test('(b) config.integration override wins regardless of probe', () => {
      // Probe would say tesla_fleet; the override forces tessie.
      const hass = makeHass({ entities: entitiesOn([{ platform: 'tesla_fleet', count: 9 }]) });
      const r = detectDialect(hass, cfg({ integration: 'tessie' }));
      expect(r.integration).toBe('tessie');
      expect(r.source).toBe('override');
      expect(r.ambiguous).toBe(false);
    });

    test('(b2) an invalid override is ignored and falls through to the probe', () => {
      const hass = makeHass({ entities: entitiesOn([{ platform: 'tesla_fleet', count: 2 }]) });
      const r = detectDialect(hass, cfg({ integration: 'not_a_real_dialect' as Integration }));
      expect(r.source).toBe('probe');
      expect(r.integration).toBe('tesla_fleet');
    });

    test('(c) two platforms present → ambiguous, both candidates, deterministic pick', () => {
      // tesla_custom has MORE entities, so most-entities tie-break picks it…
      const hass = makeHass({
        entities: entitiesOn([
          { platform: 'tesla_fleet', count: 2 },
          { platform: 'tesla_custom', count: 7 },
        ]),
      });
      const r = detectDialect(hass, cfg());
      expect(r.ambiguous).toBe(true);
      expect(new Set(r.candidates)).toEqual(new Set(['tesla_fleet', 'tesla_custom']));
      expect(r.integration).toBe('tesla_custom');
      expect(r.source).toBe('probe');
    });

    test('(c2) equal counts → fixed precedence breaks the tie (tesla_fleet > tessie)', () => {
      const hass = makeHass({
        entities: entitiesOn([
          { platform: 'tessie', count: 4 },
          { platform: 'tesla_fleet', count: 4 },
        ]),
      });
      const r = detectDialect(hass, cfg());
      expect(r.ambiguous).toBe(true);
      expect(r.integration).toBe('tesla_fleet'); // precedence wins on equal counts
    });

    test('(d) no platform + no override → source default, tesla_fleet, no throw', () => {
      const empty = detectDialect(makeHass({ entities: {} }), cfg());
      expect(empty).toMatchObject({ integration: 'tesla_fleet', source: 'default', ambiguous: false });
      expect(empty.candidates).toEqual([]);
      // Also robust when hass itself is undefined (init-time path).
      const none = detectDialect(undefined, cfg());
      expect(none).toMatchObject({ integration: 'tesla_fleet', source: 'default' });
    });

    test('(e) the committed tesla_fleet fixture probes to tesla_fleet via its registry, if present', () => {
      // The fixture is primarily a states snapshot; only assert the probe path when it
      // actually carries an entities registry (keeps the test honest about the corpus).
      const entities = (fixture as any).entities;
      if (entities && Object.keys(entities).length) {
        const r = detectDialect(makeHass({ entities }), cfg());
        expect(r.integration).toBe('tesla_fleet');
      } else {
        // No registry in the fixture → detection degrades to the designed default.
        const r = detectDialect(makeHass({ states: fixture.states as any }), cfg());
        expect(r.source).toBe('default');
      }
      // Provenance pins the corpus dialect regardless.
      expect(fixture.provenance.source_integration).toBe('tesla_fleet');
    });
  });

  // ── AC5 — status normalization ─────────────────────────────────────────────────────
  describe('AC5 — status normalizers: canonical, case/spelling-tolerant, unknown-safe', () => {
    test('charging: every dialect spelling collapses to a canonical member', () => {
      expect(normalizeChargingState('Charging')).toBe('charging');
      expect(normalizeChargingState('charging')).toBe('charging');
      expect(normalizeChargingState('Charging')).toBe(normalizeChargingState('charging'));
      expect(normalizeChargingState('ChargeStarting')).toBe('starting');
      expect(normalizeChargingState('Stopped')).toBe('stopped');
      expect(normalizeChargingState('Complete')).toBe('complete');
      expect(normalizeChargingState('Disconnected')).toBe('disconnected');
      expect(normalizeChargingState('NoPower')).toBe('no_power');
    });

    test('lock + cover canonicalize their dialect strings', () => {
      expect(normalizeLockState('locked')).toBe('locked');
      expect(normalizeLockState('Unlocked')).toBe('unlocked');
      expect(normalizeCoverState('open')).toBe('open');
      expect(normalizeCoverState('Closed')).toBe('closed');
      expect(normalizeCoverState('on')).toBe('open'); // door binary_sensors
      expect(normalizeCoverState('off')).toBe('closed');
    });

    test('unrecognized / undefined / unavailable → unknown (never throws, never raw passthrough)', () => {
      for (const raw of [undefined, '', 'unavailable', 'unknown', 'none', 'wat']) {
        expect(normalizeChargingState(raw)).toBe('unknown');
        expect(normalizeLockState(raw)).toBe('unknown');
        expect(normalizeCoverState(raw)).toBe('unknown');
      }
    });

    test("the present inline checks' canonical targets remain derivable (3.4/5.7 regression-safe)", () => {
      // hero.ts:34 / panel-charging.ts:56 test raw `=== 'Charging'`; the canonical successor is 'charging'.
      expect(normalizeChargingState('Charging')).toBe('charging');
      // panel-closures.ts:23 tests raw `=== 'open'`; canonical successor is 'open'.
      expect(normalizeCoverState('open')).toBe('open');
      // panel-closures lock tests raw `=== 'locked'`; canonical successor is 'locked'.
      expect(normalizeLockState('locked')).toBe('locked');
    });
  });

  // ── AC2 — tesla_custom alias map + per-dialect status override (MECHANISM) ───────────
  describe('AC2 — tesla_custom carries its own alias map (mechanism, not fabricated literals)', () => {
    test('tesla_custom.alias() applies its alias map; tesla_fleet.alias() is identity', () => {
      // ASSUMED strings (pinned in dialect.ts): assert the map is APPLIED, not that
      // these are corpus-verified ground truth.
      expect(DIALECTS.tesla_custom.alias('charging')).toBe('charging_status');
      expect(DIALECTS.tesla_custom.alias('battery')).toBe('battery_level');
      // Unmapped names pass through unchanged.
      expect(DIALECTS.tesla_custom.alias('odometer')).toBe('odometer');
      // The default dialect aliases nothing (pure passthrough).
      expect(DIALECTS.tesla_fleet.alias('charging')).toBe('charging');
      expect(DIALECTS.tesla_fleet.aliasMap).toEqual({});
    });

    test('tesla_custom status override is consulted ahead of the default map', () => {
      // ASSUMED override `charge_complete → complete` (pinned in dialect.ts) — the default
      // map has no such key, so this proves the per-dialect override mechanism works.
      expect(DIALECTS.tesla_custom.normalizeChargingState('charge_complete')).toBe('complete');
      expect(normalizeChargingState('charge_complete')).toBe('unknown'); // default doesn't know it
      // tesla_custom still inherits the default mappings it didn't override.
      expect(DIALECTS.tesla_custom.normalizeChargingState('Charging')).toBe('charging');
    });
  });

  // ── AC4 — incremental degrade: other dialects are present + non-crashing ─────────────
  describe('AC4 — teslemetry / tessie / tesla degrade to the default dialect (unblocked verticals)', () => {
    test('each non-fleet adapter behaves like the default (no throw, sane results)', () => {
      for (const i of ['teslemetry', 'tessie', 'tesla'] as Integration[]) {
        const a = DIALECTS[i];
        expect(a.integration).toBe(i);
        expect(() => a.normalizeChargingState('Charging')).not.toThrow();
        expect(a.normalizeChargingState('Charging')).toBe('charging'); // default mapping
        expect(a.normalizeLockState('locked')).toBe('locked');
        expect(a.normalizeCoverState('open')).toBe('open');
        expect(a.alias('odometer')).toBe('odometer'); // no alias map → identity
        expect(a.combine([undefined, 42, 7])).toBe(42); // default combine = first defined
        expect(a.split(5)).toEqual([5]);
      }
    });

    test('adapterFor() dispatches to the detected dialect', () => {
      const hass = makeHass({ entities: entitiesOn([{ platform: 'tessie', count: 3 }]) });
      expect(adapterFor(hass, cfg()).integration).toBe('tessie');
      expect(adapterFor(undefined, cfg()).integration).toBe('tesla_fleet'); // default
      expect(adapterFor(hass, cfg({ integration: 'tesla_custom' })).integration).toBe('tesla_custom');
    });
  });

  // ── AC3 — the +1-adapter seam: a new integration is one table entry, nothing else ────
  describe('AC3 — +1-adapter seam: adding an adapter is a single localized change', () => {
    // The seam: a new integration = `makeAdapter({...})` + one table key. This test adds
    // a synthetic adapter to a LOCAL copy of the table — using ONLY the public API
    // (makeAdapter + object spread) — and proves dispatch routes to it while the real
    // public surface is unchanged. It imports nothing but `./dialect`. If adding an
    // adapter ever required editing detection/normalizers/another module, this test (and
    // the design) would have to change — that is the AC3 guard. (Scope note: this proves
    // the *adapter table* is +1-additive; making detectDialect *probe* a never-seen
    // platform additionally needs that platform in resolve.ts's shared TESLA_PLATFORMS
    // set — the one by-design shared-constant edit, guarded by the no-drift test above.)
    type SyntheticIntegration = Integration | 'synthetic_test';

    test('a synthetic adapter dispatches via the table with no edit outside it', () => {
      const synthetic: DialectAdapter = makeAdapter({
        // The factory is integration-agnostic; a real new entry would extend the union.
        integration: 'synthetic_test' as Integration,
        aliasMap: { funky_state: 'charging_status' },
        charging: { spinning_up: 'starting' },
      });

      // The ONLY change a new integration needs: one more table entry.
      const extended: Record<SyntheticIntegration, DialectAdapter> = {
        ...DIALECTS,
        synthetic_test: synthetic,
      };

      // (a) the table dispatches to the new adapter
      expect(extended.synthetic_test).toBe(synthetic);
      expect(extended.synthetic_test.integration).toBe('synthetic_test');
      // (b) its overridden behaviour is live through the table
      expect(extended.synthetic_test.alias('funky_state')).toBe('charging_status');
      expect(extended.synthetic_test.normalizeChargingState('spinning_up')).toBe('starting');
      // …and it still inherits the default behaviour it didn't override
      expect(extended.synthetic_test.normalizeChargingState('Charging')).toBe('charging');
    });

    test('the REAL public API shape is unchanged by the experiment above', () => {
      // The real table is exactly the five integrations — no synthetic leak.
      expect(Object.keys(DIALECTS).sort()).toEqual([...REAL_INTEGRATIONS].sort());
      // Public functions keep their callable shape.
      expect(typeof detectDialect).toBe('function');
      expect(typeof makeAdapter).toBe('function');
      expect(typeof adapterFor).toBe('function');
      expect(typeof normalizeChargingState).toBe('function');
      // Adapter contract surface is stable across every entry.
      for (const a of Object.values(DIALECTS)) {
        for (const fn of ['alias', 'combine', 'split', 'derive', 'normalizeChargingState', 'normalizeLockState', 'normalizeCoverState'] as const) {
          expect(typeof a[fn]).toBe('function');
        }
        expect(a.aliasMap).toBeTypeOf('object');
      }
    });
  });

  // ── Provenance tagging (the adapter stamps what it produces) ────────────────────────
  test('derive() stamps provenance with the producing integration', () => {
    expect(DIALECTS.tesla_fleet.derive(80)).toEqual({
      value: 80,
      provenance: { integration: 'tesla_fleet' },
    });
    expect(DIALECTS.tesla_custom.derive(42, true)).toEqual({
      value: 42,
      provenance: { integration: 'tesla_custom', derived: true },
    });
  });
});
