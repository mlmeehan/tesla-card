import { describe, expect, test } from 'vitest';
import { sliceChanged } from './slice';
import type { HassEntity, HomeAssistant } from '../types';

function hass(states: Record<string, Partial<HassEntity>>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}

const A = 'sensor.a';
const B = 'sensor.b';

describe('sliceChanged (AC3c slice-gate — data/ owns the hass.states read)', () => {
  test('same hass object short-circuits to false', () => {
    const h = hass({ [A]: { state: '1', last_updated: 't0' } });
    expect(sliceChanged(h, h, [A])).toBe(false);
  });

  test('detects a state change on a watched id', () => {
    const prev = hass({ [A]: { state: '1', last_updated: 't0' } });
    const next = hass({ [A]: { state: '2', last_updated: 't1' } });
    expect(sliceChanged(prev, next, [A])).toBe(true);
  });

  test('detects a re-publish at the SAME value (last_updated moved)', () => {
    const prev = hass({ [A]: { state: '1', last_updated: 't0' } });
    const next = hass({ [A]: { state: '1', last_updated: 't1' } });
    expect(sliceChanged(prev, next, [A])).toBe(true);
  });

  test('falls back to last_changed when last_updated is absent', () => {
    const prev = hass({ [A]: { state: '1', last_changed: 't0' } });
    const next = hass({ [A]: { state: '1', last_changed: 't1' } });
    expect(sliceChanged(prev, next, [A])).toBe(true);
  });

  test('ignores changes to ids NOT in the slice', () => {
    const prev = hass({ [A]: { state: '1', last_updated: 't0' }, [B]: { state: '9', last_updated: 't0' } });
    const next = hass({ [A]: { state: '1', last_updated: 't0' }, [B]: { state: '8', last_updated: 't1' } });
    expect(sliceChanged(prev, next, [A])).toBe(false);
  });

  test('undefined / absent ids contribute no gate', () => {
    const prev = hass({ [A]: { state: '1', last_updated: 't0' } });
    const next = hass({ [A]: { state: '1', last_updated: 't0' } });
    expect(sliceChanged(prev, next, [undefined, 'sensor.missing'])).toBe(false);
  });

  test('first paint (prev undefined) reports a change for a present id', () => {
    const next = hass({ [A]: { state: '1', last_updated: 't0' } });
    expect(sliceChanged(undefined, next, [A])).toBe(true);
  });

  test('both undefined → false', () => {
    expect(sliceChanged(undefined, undefined, [A])).toBe(false);
  });
});
