import { describe, expect, test } from 'vitest';
import {
  instanceId,
  roleOfInstance,
  instanceSpecs,
  roleInstances,
} from './instances';
import type { TeslaCardConfig } from '../types';

/**
 * Story 9.7 Task 2 — the per-instance identity scheme + config parse. Pure unit
 * pins: a single-instance role keeps its BARE `role` id (FR-33 zero-diff, the
 * load-bearing reason `id === role` can be killed without perturbing today's
 * output); a duplicated role carries `role:1`/`role:2`; every garbage `instances`
 * shape degrades to one bare instance (FR-24), never throws.
 */

const cfg = (instances?: unknown): TeslaCardConfig =>
  ({
    type: 'custom:tesla-card',
    energy: { nodes: { instances } },
  }) as unknown as TeslaCardConfig;

describe('instanceId — bare for single, role:n for duplicates', () => {
  test('count <= 1 ⇒ the bare role (zero-diff)', () => {
    expect(instanceId('solar', 0, 1)).toBe('solar');
    expect(instanceId('solar', 0, 0)).toBe('solar'); // count 0 (graceful) still bare
    expect(instanceId('powerwall', 0, -3)).toBe('powerwall'); // negative ⇒ bare
  });

  test('count >= 2 ⇒ 1-based role:n suffix', () => {
    expect(instanceId('solar', 0, 2)).toBe('solar:1');
    expect(instanceId('solar', 1, 2)).toBe('solar:2');
    expect(instanceId('wall_connector', 2, 3)).toBe('wall_connector:3');
  });
});

describe('roleOfInstance — recover the role from an instance id', () => {
  test('bare and suffixed ids both yield the role', () => {
    expect(roleOfInstance('solar')).toBe('solar');
    expect(roleOfInstance('solar:1')).toBe('solar');
    expect(roleOfInstance('wall_connector:2')).toBe('wall_connector');
  });
});

describe('instanceSpecs — tolerant parse, defaults to one bare instance', () => {
  test('absent instances ⇒ [{}] (zero-diff single node)', () => {
    expect(instanceSpecs({ type: 'custom:tesla-card' }, 'solar')).toEqual([{}]);
    expect(instanceSpecs(cfg(undefined), 'solar')).toEqual([{}]);
  });

  test('a stale COUNT-shaped value (the 9.1 placeholder) ⇒ [{}] (not an array, graceful)', () => {
    expect(instanceSpecs(cfg({ solar: 2 }), 'solar')).toEqual([{}]);
  });

  test('a valid non-empty array is returned as-is', () => {
    const specs = [{ title: 'South' }, { title: 'Garage', entities: { solar_power: 'sensor.g' } }];
    expect(instanceSpecs(cfg({ solar: specs }), 'solar')).toEqual(specs);
  });

  test('an empty array ⇒ [{}] (count 0 degrades to one default instance, never hides)', () => {
    expect(instanceSpecs(cfg({ solar: [] }), 'solar')).toEqual([{}]);
  });

  test('non-object / array entries are dropped; all-garbage ⇒ [{}]', () => {
    expect(instanceSpecs(cfg({ solar: [null, 7, 'x', []] }), 'solar')).toEqual([{}]);
    expect(instanceSpecs(cfg({ solar: [{ title: 'Keep' }, 42] }), 'solar')).toEqual([
      { title: 'Keep' },
    ]);
  });
});

describe('roleInstances — id + sanitized title/entities per instance', () => {
  test('a single-instance role keeps the bare id, count 1 (zero-diff)', () => {
    expect(roleInstances({ type: 'custom:tesla-card' }, 'solar')).toEqual([
      { id: 'solar', index: 0, count: 1, title: undefined, entities: undefined },
    ]);
  });

  test('a 2-instance role yields solar:1 / solar:2 with their specs', () => {
    const out = roleInstances(
      cfg({ solar: [{ title: 'South' }, { title: 'Garage', entities: { solar_power: 'sensor.g' } }] }),
      'solar'
    );
    expect(out).toEqual([
      { id: 'solar:1', index: 0, count: 2, title: 'South', entities: undefined },
      { id: 'solar:2', index: 1, count: 2, title: 'Garage', entities: { solar_power: 'sensor.g' } },
    ]);
  });

  test('garbage title/entities are sanitized to undefined (never propagated as-is)', () => {
    const out = roleInstances(
      cfg({ home: [{ title: 7, entities: 'nope' }, { title: 'Real' }] }) as TeslaCardConfig,
      'home'
    );
    expect(out).toEqual([
      { id: 'home:1', index: 0, count: 2, title: undefined, entities: undefined },
      { id: 'home:2', index: 1, count: 2, title: 'Real', entities: undefined },
    ]);
  });

  test('GB5 (review): an ARRAY `entities` is rejected to undefined — mirrors the config guard, no numeric-key spread', () => {
    const out = roleInstances(cfg({ solar: [{ entities: ['x', 'y'] }] }) as TeslaCardConfig, 'solar');
    expect(out[0].entities).toBeUndefined();
  });
});
