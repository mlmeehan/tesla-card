// Co-located unit test for the freshness read-model (Story 1.5).
//
// Pure-hub test (D5/F3 "hubs get Vitest"): environment 'node' (reads hass.states,
// no DOM — no jsdom pragma); hermetic — reuses the committed model-y-awake.json
// (every entity stamped at one instant) for the FRESH path, and synthesizes
// back-dated / future-dated states for stale/asleep/unavailable/skew. ZERO network.
//
// DISCIPLINE: assert the classification MECHANISM relative to INJECTED thresholds
// and an INJECTED/derived reference, never a production wall-clock constant as
// ground truth (the 1.3/1.4 "assert the mechanism, not the magic number" rule).
import { describe, expect, test } from 'vitest';
import fixture from '../fixtures/model-y-awake.json';
import type { HomeAssistant, HassEntity, TeslaCardConfig } from '../types';
import { UNAVAILABLE_STATES } from '../helpers';
import {
  DEFAULT_STALENESS_THRESHOLDS,
  isQuiescent,
  read,
  readKey,
  referenceNow,
  type FreshnessRead,
  type Staleness,
} from './freshness';

/** The committed awake snapshot: states-only, every stamp at one instant. */
const FIXTURE_STATES = fixture.states as Record<string, HassEntity>;
/** The single instant every fixture entity is stamped at. */
const FIXTURE_NOW = Date.parse('2026-06-15T14:41:00Z');
/** An entity-id known to be present, available and numeric in the fixture. */
const PRESENT_ID = 'sensor.garage_model_y_battery_level';

/** A HomeAssistant carrying just the states map the reader reads. */
function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}

/** A valid card config (the contract requires `type`). */
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}

/** A minimal available entity stamped at `iso`. */
function entity(id: string, state: string, iso: string): HassEntity {
  return { entity_id: id, state, attributes: {}, last_updated: iso, last_changed: iso };
}

const freshHass = makeHass(FIXTURE_STATES);

describe('AC1 — shape + unavailable classification', () => {
  test('a present, recent entity returns the four exact fields, available + fresh', () => {
    const r = read(freshHass, PRESENT_ID, { now: FIXTURE_NOW });
    // Exactly the four canonical fields, no more.
    expect(Object.keys(r).sort()).toEqual(['available', 'lastUpdated', 'staleness', 'value']);
    expect(r).toEqual<FreshnessRead>({
      value: '72',
      lastUpdated: '2026-06-15T14:41:00Z',
      available: true,
      staleness: 'fresh',
    });
  });

  test('an absent entity-id → available:false, staleness:unavailable, value undefined, NO throw', () => {
    const r = read(freshHass, 'sensor.does_not_exist', { now: FIXTURE_NOW });
    expect(r).toEqual<FreshnessRead>({
      value: undefined,
      lastUpdated: undefined,
      available: false,
      staleness: 'unavailable',
    });
  });

  test('each of unavailable/unknown/none/"" → available:false, staleness:unavailable', () => {
    for (const sentinel of UNAVAILABLE_STATES) {
      const id = 'sensor.sentinel';
      const hass = makeHass({ [id]: entity(id, sentinel, '2026-06-15T14:41:00Z') });
      const r = read(hass, id, { now: FIXTURE_NOW });
      expect(r.available).toBe(false);
      expect(r.staleness).toBe<Staleness>('unavailable');
      // lastUpdated is still surfaced honestly even when unavailable.
      expect(r.lastUpdated).toBe('2026-06-15T14:41:00Z');
    }
  });

  test('readKey resolves a function-key then delegates (battery_level → fixture state)', () => {
    const r = readKey(freshHass, cfg(), 'battery_level', { now: FIXTURE_NOW });
    expect(r).toEqual<FreshnessRead>({
      value: '72',
      lastUpdated: '2026-06-15T14:41:00Z',
      available: true,
      staleness: 'fresh',
    });
  });
});

describe('AC2 — HA time base, not the client clock', () => {
  test('referenceNow over the fixture equals the fixture max last_updated (server-derived)', () => {
    // Independent of the test runner's wall clock: it is the max server stamp.
    expect(referenceNow(freshHass)).toBe(FIXTURE_NOW);
  });

  test('referenceNow falls back to client Date.now() only when states are empty', () => {
    const before = Date.now();
    const got = referenceNow(makeHass({}));
    const after = Date.now();
    expect(got).toBeGreaterThanOrEqual(before);
    expect(got).toBeLessThanOrEqual(after);
  });

  test('an injected now crosses each threshold: fresh → stale → asleep', () => {
    const id = 'sensor.x';
    const stampedAt = '2026-06-15T14:41:00Z';
    const base = Date.parse(stampedAt);
    const hass = makeHass({ [id]: entity(id, '1', stampedAt) });
    const t = { fresh: 60_000, asleep: 600_000 }; // injected, hermetic windows

    // age 0 ≤ fresh → fresh
    expect(read(hass, id, { now: base, thresholds: t }).staleness).toBe('fresh');
    // fresh < age ≤ asleep → stale (just past the fresh edge)
    expect(read(hass, id, { now: base + 60_001, thresholds: t }).staleness).toBe('stale');
    expect(read(hass, id, { now: base + 600_000, thresholds: t }).staleness).toBe('stale');
    // age > asleep → asleep
    expect(read(hass, id, { now: base + 600_001, thresholds: t }).staleness).toBe('asleep');
  });

  test('CLOCK-SKEW PROOF: classification uses the server reference, not clientNow − lastUpdated', () => {
    // Both entities are stamped in the FUTURE relative to the real wall clock, so
    // a naive `Date.now() − lastUpdated` would yield a negative age and (under our
    // negative→fresh guard) call BOTH 'fresh'. The server-derived reference is the
    // MAX stamp (entity A), so entity B — older than A by more than the asleep
    // window — must classify 'asleep'. A regression to naive subtraction fails here.
    const farFuture = Date.now() + 365 * 24 * 60 * 60_000; // +1 year, ahead of any client clock
    const t = { fresh: 60_000, asleep: 600_000 };
    const aIso = new Date(farFuture).toISOString();
    const bIso = new Date(farFuture - (t.asleep + 60_000)).toISOString(); // still in the future
    const hass = makeHass({
      'sensor.a': entity('sensor.a', '1', aIso),
      'sensor.b': entity('sensor.b', '2', bIso),
    });

    // No injected `now`: prove the DERIVED server reference is used.
    expect(referenceNow(hass)).toBe(farFuture);
    // A is the freshest possible (it IS the reference) — fresh, never negative-age garbage.
    expect(read(hass, 'sensor.a', { thresholds: t }).staleness).toBe('fresh');
    // B is genuinely old relative to the server reference → asleep (naive client subtraction would say 'fresh').
    expect(read(hass, 'sensor.b', { thresholds: t }).staleness).toBe('asleep');
  });

  test('a missing/unparseable lastUpdated on an available entity degrades to fresh (documented guard)', () => {
    const id = 'sensor.nostamp';
    const hass = makeHass({
      [id]: { entity_id: id, state: '5', attributes: {} }, // no last_updated/last_changed
    });
    const r = read(hass, id, { now: FIXTURE_NOW });
    expect(r.available).toBe(true);
    expect(r.lastUpdated).toBeUndefined();
    expect(r.staleness).toBe('fresh'); // unknown age is not misrepresented as old
  });
});

describe('AC2 — thresholds: global default + per-quantity override', () => {
  test('the SAME age reclassifies under a per-key override vs the default (override is consulted)', () => {
    // A mid-age value: older than the default fresh window, classified relative to
    // injected windows — never a hard-coded production constant as ground truth.
    const stampedAt = '2026-06-15T14:00:00Z';
    const base = Date.parse(stampedAt);
    const age = DEFAULT_STALENESS_THRESHOLDS.fresh + 60_000; // just past the default fresh edge
    const now = base + age;

    // Default window: this age is past `fresh` → not fresh.
    const id = 'sensor.speed'; // resolved default for the `speed` key (bare device id)
    const hass = makeHass({ [id]: entity(id, '42', stampedAt) });
    expect(read(hass, id, { now }).staleness).not.toBe('fresh');

    // A wider override (fresh window > age) reclassifies the SAME age as fresh —
    // proving the override is applied, not ignored.
    const wide = { fresh: age + 60_000, asleep: age + 120_000 };
    expect(read(hass, id, { now, thresholds: wide }).staleness).toBe('fresh');
  });

  test('readKey applies the per-key STALENESS_OVERRIDES map (odometer tolerates a long gap)', () => {
    // odometer has a wide override (parked for an hour is not "stale"); the same
    // gap under the default windows would already be 'asleep'. readKey must consult
    // the per-key override automatically.
    const stampedAt = '2026-06-15T14:00:00Z';
    const base = Date.parse(stampedAt);
    const now = base + 40 * 60_000; // 40 min gap
    const id = 'sensor.odometer'; // bare-device default id for the odometer key
    const hass = makeHass({ [id]: entity(id, '12345', stampedAt) });

    // Under the global default (asleep at 30 min) a 40-min gap would be 'asleep'…
    expect(read(hass, id, { now }).staleness).toBe('asleep');
    // …but readKey consults the odometer override (asleep at 24 h) → still 'fresh'.
    expect(readKey(hass, cfg(), 'odometer', { now }).staleness).toBe('fresh');
  });
});

describe('AC3 — quiescent derivation (forward-enabling, pure)', () => {
  // The single {stale,asleep,unavailable} → quiescent mapping the Epic-4 FlowModel
  // imports to set FlowEdge.provenance = 'quiescent'. Pure function of `staleness`:
  // no hass/flow import is needed to call it (asserted by constructing reads inline).
  const mk = (staleness: Staleness): FreshnessRead => ({
    value: undefined,
    lastUpdated: undefined,
    available: staleness !== 'unavailable',
    staleness,
  });

  test('isQuiescent is false ONLY for fresh', () => {
    expect(isQuiescent(mk('fresh'))).toBe(false);
  });

  test('isQuiescent is true for each of stale / asleep / unavailable', () => {
    for (const s of ['stale', 'asleep', 'unavailable'] as Staleness[]) {
      expect(isQuiescent(mk(s))).toBe(true);
    }
  });
});

describe('boundary / regression guard (mirrors 1.4 no-drift discipline)', () => {
  // The structural gate itself is Story 1.7; here we pin the invariant by reading
  // the module source — freshness.ts must import NOTHING from flow/ or components/,
  // keeping it the pure, node-testable, sole hass.states reader. A regression that
  // pulls a flow/component type up into data/ fails this.
  test('freshness.ts imports nothing from flow/ or components/', async () => {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const here = url.fileURLToPath(new URL('./freshness.ts', import.meta.url));
    const src = await fs.readFile(here, 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.some((p) => p.includes('flow/'))).toBe(false);
    expect(imports.some((p) => p.includes('components/'))).toBe(false);
    // It reads hass.states (its job — the sole reader) but imports no lit/DOM.
    expect(imports.some((p) => p === 'lit' || p.startsWith('lit/'))).toBe(false);
  });
});
