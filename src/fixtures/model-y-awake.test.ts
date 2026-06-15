// Smoke test (Story 1.1, Step-0 harness). Doubles as:
//   • AC-1 — proves the Vitest runner executes against src/ (≥1 passing test).
//   • AC-2 — proves the shared fixture imports as PURE JSON with capture-provenance.
//   • AC-4 — hermetic: imports only the committed fixture, makes ZERO network calls.
import { describe, expect, test } from 'vitest';
import fixture from './model-y-awake.json';

describe('verification harness (Story 1.1 Step-0)', () => {
  test('Vitest runs', () => {
    expect(true).toBe(true);
  });

  test('fixture imports as an object carrying capture-provenance', () => {
    expect(fixture).toBeTypeOf('object');
    expect(fixture.provenance).toBeTruthy();
    expect(fixture.provenance.scenario).toBe('awake');
    expect(fixture.provenance.source_integration).toBe('tesla_fleet');
    expect(fixture.provenance.entity_count).toBeGreaterThan(0);
  });

  test('states is a non-empty map with anchored AND bare-device entity ids', () => {
    const ids = Object.keys(fixture.states);
    expect(ids.length).toBeGreaterThan(0);
    // provenance.entity_count is the contract — it must match the actual corpus.
    expect(fixture.provenance.entity_count).toBe(ids.length);
    // The bare-device quirk is real: sensor.odometer is NOT garage_model_y_* prefixed.
    expect(fixture.states['sensor.odometer']).toBeTruthy();
    expect(fixture.states['sensor.odometer'].state).toBe('12345');
    expect(ids).toContain('cover.sunroof'); // another bare-device id
    // …and anchored ids are present too (the resolver's real mixed corpus).
    expect(ids.some((id) => id.startsWith('sensor.garage_model_y_'))).toBe(true);
  });

  test('every state carries the full HA shape with ISO-8601 timestamps (not Dates)', () => {
    for (const [id, st] of Object.entries(fixture.states)) {
      expect(st.entity_id).toBe(id);
      expect(typeof st.state).toBe('string');
      expect(typeof st.last_updated).toBe('string'); // ISO string, JSON-safe
      expect(st.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test('fixture is pure JSON — survives serialize/clone round-trips (no functions/Dates)', () => {
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
    expect(structuredClone(fixture)).toEqual(fixture);
  });
});
