// Co-located unit test for the dialect-adapter layer (Story 1.4).
//
// Pure-hub test (D5/F3 "hubs get Vitest"): environment 'node' (reads hass.entities,
// no DOM); hermetic — reuses the committed tesla_fleet fixture and synthesizes
// minimal hass.entities for the other-platform / ambiguity cases. ZERO network.
//
// HONESTY NOTE (updated Story 14.1): the per-dialect entity-name spellings are now
// CONFIRMED-by-source-read (research 2026-07-03 §4/§5 — the alandtse/tesla type-string
// naming + Fleet-family divergences), NOT corpus-captured (we still hold no live
// tessie/teslemetry/tesla_custom install). The forward-direction resolver tables
// (DIALECT_ENTITY_ALIASES / DIALECT_ABSENT) are the mechanism resolveEntities reads;
// the legacy reverse `aliasMap`/`.alias()` field is now unpopulated + unconsumed.
import { describe, expect, test } from 'vitest';
import fixture from '../fixtures/model-y-awake.json';
import { TESLA_PLATFORMS } from './platforms';
import {
  DIALECTS,
  DIALECT_ENTITY_ALIASES,
  DIALECT_ABSENT,
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
  // ── Single source of truth: the table + precedence track platforms.ts's set ──────────
  test('DIALECTS keys exactly match platforms.ts TESLA_PLATFORMS (no drift)', () => {
    expect(new Set(Object.keys(DIALECTS))).toEqual(new Set(TESLA_PLATFORMS));
    // And every real integration has an adapter (degrade-or-first-class, none missing).
    for (const i of REAL_INTEGRATIONS) expect(DIALECTS[i]?.integration).toBe(i);
  });

  // ── Story 14.1 — the forward resolver tables never carry a tesla_fleet key ──────────
  test('DIALECT_ENTITY_ALIASES / DIALECT_ABSENT have NO tesla_fleet entry (byte-identical guarantee)', () => {
    // No fleet key in either table ⇒ resolveEntities takes the unchanged fleet path
    // for a fleet install (the data-level half of the AC6 byte-identical guarantee).
    expect(DIALECT_ENTITY_ALIASES.tesla_fleet).toBeUndefined();
    expect(DIALECT_ABSENT.tesla_fleet).toBeUndefined();
    // The known divergent dialects DO carry entries (sanity: the tables aren't empty).
    expect(Object.keys(DIALECT_ENTITY_ALIASES.tesla_custom ?? {}).length).toBeGreaterThan(0);
    expect((DIALECT_ABSENT.tessie?.size ?? 0)).toBeGreaterThan(0);
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

  // ── AC5 — tesla_custom charging = a CAPABILITY difference (boolean-derived) ───────────
  //
  // Story 14.1 RETIRED the two REFUTED tesla_custom assumptions this block used to pin:
  //   • the reverse `TESLA_CUSTOM_ALIASES` placeholder (`.alias`/`.aliasMap` are dead —
  //     zero consumers; the resolver reads the forward DIALECT_ENTITY_ALIASES table);
  //   • the dead `TESLA_CUSTOM_CHARGING = {charge_complete → complete}` override (the
  //     token exists nowhere in the integration — it could never fire).
  // What remains, CONFIRMED by §5: tesla_custom exposes charging ONLY as a boolean
  // binary_sensor.charging (on/off), so its adapter derives charging from that boolean.
  describe('AC5 — tesla_custom charging derives from the boolean (capability difference)', () => {
    test("the tesla_custom adapter maps the boolean vocabulary (on→charging, off→'unknown' [Story 15.1])", () => {
      expect(DIALECTS.tesla_custom.normalizeChargingState('on')).toBe('charging');
      // Story 15.1 refinement (supersedes the shipped off→'stopped'): teslajsonpy's
      // `off` covers Stopped/Complete/DISCONNECTED alike, so it must map to
      // 'unknown' — routing the consumer to its cable corroboration — never a
      // claimed connected state ('stopped' would render an uncabled parked car as
      // a false 'Plugged' via the Hero's `case 'stopped' → plugged`).
      expect(DIALECTS.tesla_custom.normalizeChargingState('off')).toBe('unknown');
      expect(DIALECTS.tesla_custom.normalizeChargingState('off')).not.toBe('stopped');
      // The override map is normKey'd — spelling/case variants collapse the same way.
      expect(DIALECTS.tesla_custom.normalizeChargingState('On')).toBe('charging');
      expect(DIALECTS.tesla_custom.normalizeChargingState('OFF')).toBe('unknown');
      // It still inherits the default mappings it didn't override.
      expect(DIALECTS.tesla_custom.normalizeChargingState('Charging')).toBe('charging');
    });

    test('the dead charge_complete override is GONE — both the adapter and default return unknown', () => {
      expect(DIALECTS.tesla_custom.normalizeChargingState('charge_complete')).toBe('unknown');
      expect(normalizeChargingState('charge_complete')).toBe('unknown');
    });

    test('the legacy reverse aliasMap is unpopulated for every dialect (forward table is the mechanism)', () => {
      // The type field + `.alias()` method survive (out-of-scope to remove) but carry
      // no data now — no dialect populates them; resolution reads DIALECT_ENTITY_ALIASES.
      for (const a of Object.values(DIALECTS)) {
        expect(a.aliasMap).toEqual({});
        expect(a.alias('anything')).toBe('anything'); // pure passthrough
      }
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
        for (const fn of ['alias', 'combine', 'split', 'derive', 'normalizePower', 'normalizeChargingState', 'normalizeLockState', 'normalizeCoverState'] as const) {
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

// ── Raw→canonical power-sign normalization (Story 4.1, AC3) ───────────────────
//
// Property tests on the RULE, not single vectors: tesla_fleet/powerwall reports
// `battery − = charging`; the canonical convention the FlowModel sees is
// `battery + = charging`, so the powerwall sign is flipped while every other
// role passes through. A flip is a derivation (provenance.derived = true).
describe('normalizePower — raw battery sign → canonical (Story 4.1)', () => {
  // A spread of signed magnitudes, incl. the load-bearing sign boundaries.
  const SAMPLES = [-7.4, -1.5, -0.05, 0, 0.05, 1.5, 6, 11.5];

  test('powerwall: raw −charging ⇒ canonical +charging (sign flipped) for every value', () => {
    for (const raw of SAMPLES) {
      const out = DIALECTS.tesla_fleet.normalizePower('powerwall', raw);
      expect(out.value).toBeCloseTo(-raw, 10); // the RULE: canonical = −raw
      expect(out.provenance).toEqual({ integration: 'tesla_fleet', derived: true });
    }
    // Concretely: a charging Powerwall (raw −X) reads canonical +X (≥0 ⇒ charging).
    expect(DIALECTS.tesla_fleet.normalizePower('powerwall', -3).value).toBe(3);
  });

  test('the flip is idempotent under the declared rule (its own inverse)', () => {
    for (const raw of SAMPLES) {
      const once = DIALECTS.tesla_fleet.normalizePower('powerwall', raw).value;
      const twice = DIALECTS.tesla_fleet.normalizePower('powerwall', once).value;
      expect(twice).toBeCloseTo(raw, 10); // flip∘flip = identity
    }
  });

  test('grid/solar/home/wall_connector pass through unchanged (not derived)', () => {
    for (const role of ['grid', 'solar', 'home', 'wall_connector'] as const) {
      for (const raw of SAMPLES) {
        const out = DIALECTS.tesla_fleet.normalizePower(role, raw);
        expect(out.value).toBe(raw);
        expect(out.provenance).toEqual({ integration: 'tesla_fleet' }); // no derivation
      }
    }
  });

  test('undefined in → undefined out (NaN-safe upstream owns the read)', () => {
    expect(DIALECTS.tesla_fleet.normalizePower('powerwall', undefined).value).toBeUndefined();
    expect(DIALECTS.tesla_fleet.normalizePower('grid', undefined).value).toBeUndefined();
  });

  test('every dialect degrades to the default flip set (no dialect overrides flipPower)', () => {
    for (const a of Object.values(DIALECTS)) {
      expect(a.normalizePower('powerwall', -2).value).toBe(2); // flipped everywhere
      expect(a.normalizePower('grid', 2).value).toBe(2); // passthrough everywhere
    }
  });
});

// ── Story 15.1 AC6 — Fleet-family adapters ≡ the module-default normalizers ────
//
// The component conversion (hero/panel → `adapterFor(...).normalize*`) is
// behaviour-preserving for the Fleet family BY CONSTRUCTION: no Fleet-family
// adapter carries a charging/lock/cover override, so `makeAdapter`'s normalizer
// is the module default. This table PINS that equivalence over the FULL raw
// vocabulary — every map key/spelling, the ABSENT sentinels, garbage, and the
// boolean tokens — so a future adapter entry that silently diverges a Fleet
// dialect fails here, not in a user's dashboard. Lock/cover are included for ALL
// five dialects (tesla_custom carries no lock/cover override either), covering
// the Task-3 co-located conversion.
describe('Story 15.1 AC6 — Fleet-family adapter normalizers ≡ module defaults (full vocab)', () => {
  // Derived from the DIALECTS registry, never hand-maintained: a future dialect
  // added to the table lands in these equivalence pins AUTOMATICALLY (a deliberate
  // divergence must then consciously exclude itself here — drift-catch by design).
  const ALL_DIALECTS = Object.keys(DIALECTS) as Integration[];
  const FLEET_FAMILY: Integration[] = ALL_DIALECTS.filter((i) => i !== 'tesla_custom');

  // Every CHARGING_MAP key/spelling + ABSENT sentinels + garbage + the boolean
  // vocabulary (which the Fleet family maps to 'unknown' — only tesla_custom
  // overrides it, and it is deliberately EXCLUDED from the charging half).
  const CHARGING_VOCAB: Array<string | undefined> = [
    'Charging', 'charging', 'CHARGING',
    'Starting', 'ChargeStarting', 'charge_starting',
    'Stopped', 'stopped',
    'Complete', 'complete', 'Charged',
    'Disconnected', 'disconnected',
    'NoPower', 'no_power',
    'on', 'off', 'On', 'Off',
    '', 'unavailable', 'unknown', 'none', 'null',
    'garbage-token', 'charge_complete',
    undefined,
  ];
  const LOCK_VOCAB: Array<string | undefined> = [
    'locked', 'Locked', 'unlocked', 'Unlocked',
    'on', 'off', 'jammed',
    '', 'unavailable', 'unknown', 'none', 'null',
    undefined,
  ];
  const COVER_VOCAB: Array<string | undefined> = [
    'open', 'Open', 'closed', 'Closed',
    'on', 'off', 'On', 'Off', 'ajar',
    '', 'unavailable', 'unknown', 'none', 'null',
    undefined,
  ];

  test('charging: each Fleet-family adapter matches the module default for every raw value', () => {
    for (const i of FLEET_FAMILY) {
      for (const raw of CHARGING_VOCAB) {
        expect(
          DIALECTS[i].normalizeChargingState(raw),
          `${i}.normalizeChargingState(${JSON.stringify(raw)})`
        ).toBe(normalizeChargingState(raw));
      }
    }
  });

  test('lock: EVERY dialect (incl. tesla_custom) matches the module default for every raw value', () => {
    for (const i of ALL_DIALECTS) {
      for (const raw of LOCK_VOCAB) {
        expect(
          DIALECTS[i].normalizeLockState(raw),
          `${i}.normalizeLockState(${JSON.stringify(raw)})`
        ).toBe(normalizeLockState(raw));
      }
    }
  });

  test('cover: EVERY dialect (incl. tesla_custom) matches the module default for every raw value', () => {
    for (const i of ALL_DIALECTS) {
      for (const raw of COVER_VOCAB) {
        expect(
          DIALECTS[i].normalizeCoverState(raw),
          `${i}.normalizeCoverState(${JSON.stringify(raw)})`
        ).toBe(normalizeCoverState(raw));
      }
    }
  });

  test("the OBSERVABLE divergence is exactly tesla_custom charging 'on' (nothing else)", () => {
    // The complement proof: the one deliberate capability override, nowhere else.
    // 'on' → 'charging' vs the default's 'unknown' — the live-green enabler.
    expect(DIALECTS.tesla_custom.normalizeChargingState('on')).toBe('charging');
    expect(normalizeChargingState('on')).toBe('unknown');
    // 'off' → 'unknown' is VALUE-IDENTICAL to the default (the Story 15.1
    // refinement's whole point: off makes no claim, so it lands where an
    // unmapped raw lands — the map entry documents intent, not divergence).
    expect(DIALECTS.tesla_custom.normalizeChargingState('off')).toBe(normalizeChargingState('off'));
    // Everywhere else tesla_custom charging matches the default too.
    for (const raw of CHARGING_VOCAB) {
      const k = (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (k === 'on') continue;
      expect(DIALECTS.tesla_custom.normalizeChargingState(raw)).toBe(normalizeChargingState(raw));
    }
  });
});

// ── Story 15.1 AC4 — the stamp short-circuit is genuinely ZERO-scan ──────────
//
// The per-render cost story rests on `detectDialect` returning from its override
// branch BEFORE any registry read (the parent-stamped `integration:` makes
// `adapterFor` an O(1) table dispatch — "zero per-render registry scan", AC4).
// Pin it with a registry that THROWS on access: if a future edit consults
// `hass.entities` before honouring the override, these fail loudly instead of
// silently regressing every stamped component render to a full registry scan.
describe('Story 15.1 AC4 — a stamped/override config short-circuits before ANY registry read', () => {
  /** hass whose registry EXPLODES if touched — the zero-scan tripwire. */
  const trapHass = {
    get entities(): never {
      throw new Error(
        'hass.entities read on the override branch — the stamp short-circuit is broken'
      );
    },
  } as unknown as HomeAssistant;

  test('detectDialect returns the override report without touching hass.entities', () => {
    expect(detectDialect(trapHass, cfg({ integration: 'tesla_custom' }))).toEqual({
      integration: 'tesla_custom',
      source: 'override',
      ambiguous: false,
      candidates: ['tesla_custom'],
    });
  });

  test('adapterFor dispatches the stamped dialect without touching hass.entities', () => {
    expect(adapterFor(trapHass, cfg({ integration: 'tesla_custom' })).integration).toBe(
      'tesla_custom'
    );
  });
});

// ── Story 14.2 — device-scoped dialect probe (the optional `scope` param) ────────
//
// The probe gains an optional `scope` (the resolved vehicle device's entity ids):
// when supplied it counts ONLY entities in that set, so a split-platform household
// probes per-device (no false ambiguity); when omitted it counts registry-wide,
// exactly as before (unscoped editor/adapterFor callers unchanged).
describe('Story 14.2 — detectDialect device scope', () => {
  /** A split household registry: a tesla_custom car device + a tesla_fleet Powerwall. */
  function splitHousehold(): { entities: Record<string, any>; car: string[]; pw: string[] } {
    const car = ['sensor.car_battery', 'sensor.car_range', 'binary_sensor.car_charging'];
    const pw = ['sensor.pw_battery_power', 'sensor.pw_solar_power', 'sensor.pw_load_power', 'sensor.pw_grid_power'];
    const entities: Record<string, any> = {};
    for (const id of car) entities[id] = { entity_id: id, platform: 'tesla_custom', device_id: 'car1' };
    for (const id of pw) entities[id] = { entity_id: id, platform: 'tesla_fleet', device_id: 'pw1' };
    return { entities, car, pw };
  }

  test('scoped to the car device → its single dialect, not ambiguous', () => {
    const { entities, car } = splitHousehold();
    const r = detectDialect(makeHass({ entities }), cfg(), new Set(car));
    expect(r.integration).toBe('tesla_custom');
    expect(r.ambiguous).toBe(false);
    expect(r.candidates).toEqual(['tesla_custom']);
    expect(r.source).toBe('probe');
  });

  test('scoped to the Powerwall device → tesla_fleet, not ambiguous', () => {
    const { entities, pw } = splitHousehold();
    const r = detectDialect(makeHass({ entities }), cfg(), new Set(pw));
    expect(r.integration).toBe('tesla_fleet');
    expect(r.ambiguous).toBe(false);
  });

  test('UNSCOPED over the same registry → ambiguous (registry-wide sees both platforms)', () => {
    const { entities } = splitHousehold();
    const r = detectDialect(makeHass({ entities }), cfg());
    expect(r.ambiguous).toBe(true);
    expect(new Set(r.candidates)).toEqual(new Set(['tesla_custom', 'tesla_fleet']));
  });

  test('scoped to a same-device two-platform set → STILL ambiguous (the retained guard case)', () => {
    const entities: Record<string, any> = {
      'sensor.d_battery': { entity_id: 'sensor.d_battery', platform: 'tesla_custom', device_id: 'd1' },
      'sensor.d_odometer': { entity_id: 'sensor.d_odometer', platform: 'tesla_fleet', device_id: 'd1' },
    };
    const r = detectDialect(makeHass({ entities }), cfg(), new Set(Object.keys(entities)));
    expect(r.ambiguous).toBe(true);
  });

  test('an EMPTY scope is NOT the same as omitting it — empty ⇒ zero-count default, omit ⇒ registry-wide', () => {
    // Guards AC5: resolve.ts must OMIT (not pass an empty Set) for registry-less installs.
    const { entities } = splitHousehold();
    const scopedEmpty = detectDialect(makeHass({ entities }), cfg(), new Set<string>());
    expect(scopedEmpty.source).toBe('default');
    expect(scopedEmpty.integration).toBe('tesla_fleet');
    const omitted = detectDialect(makeHass({ entities }), cfg());
    expect(omitted.source).toBe('probe'); // registry-wide, sees the platforms
  });

  test('back-compat: the override short-circuit still wins even when a scope is passed', () => {
    const { entities, pw } = splitHousehold();
    // A scope alongside config.integration is (correctly) ignored — override runs first.
    const r = detectDialect(makeHass({ entities }), cfg({ integration: 'tesla_custom' }), new Set(pw));
    expect(r.integration).toBe('tesla_custom');
    expect(r.source).toBe('override');
  });
});
