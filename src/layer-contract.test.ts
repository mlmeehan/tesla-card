// The published `@unstable` Layer contract (Story 3.6, AC1). LAYER_CONTRACT is the
// machine-checkable HALF of the contract (the `styles.ts` ACCENT_SEMANTICS pattern)
// — these tests are the guard that keeps it honest: its shape is pinned, and it is
// asserted to AGREE with the `BodyLayers` type (required vs optional split), so the
// contract can never silently drift from its consumers (car.ts's isConformingBody,
// types.ts). expectTypeOf locks the type half at compile time; runtime asserts the
// value half.
import { describe, expect, test, expectTypeOf } from 'vitest';
import { LAYER_CONTRACT } from './layer-contract';
import { HERO_VIEWBOX } from './const';
import type { BodyLayers } from './types';

describe('AC1 — LAYER_CONTRACT is the published @unstable contract map', () => {
  test('marked unstable (the public freeze is a one-way door)', () => {
    expect(LAYER_CONTRACT.unstable).toBe(true);
  });

  test('anchored to the 1024×687 coordinate contract (HERO_VIEWBOX, Story 3.1)', () => {
    expect(LAYER_CONTRACT.viewBox).toBe(HERO_VIEWBOX);
    expect(LAYER_CONTRACT.viewBox).toEqual({ width: 1024, height: 687 });
  });

  test('assumes a front-right 3/4 camera', () => {
    expect(LAYER_CONTRACT.camera).toBe('3/4');
  });

  test('names the required layers exactly (color, shade, mask)', () => {
    expect(LAYER_CONTRACT.requiredLayers).toEqual(['color', 'shade', 'mask']);
  });

  test('names the optional layers (highlight) and overlay nodes (apertureLayers, chargePort)', () => {
    expect(LAYER_CONTRACT.optionalLayers).toEqual(['highlight']);
    expect(LAYER_CONTRACT.nodes).toEqual(['apertureLayers', 'chargePort']);
  });

  test('carries a version (revisable while unstable)', () => {
    expect(typeof LAYER_CONTRACT.version).toBe('number');
  });

  // Trade-dress gate (AC1): the contract map ships GENERIC — no brand hex, no
  // Tesla marketing names. (The denylist scans src/ too; this is a belt-and-braces
  // assertion that the map itself is clean.)
  test('the map is generic — no brand hex / Tesla names', () => {
    const blob = JSON.stringify(LAYER_CONTRACT).toLowerCase();
    expect(blob).not.toContain('tesla');
    expect(blob).not.toMatch(/#e82127|ppsw|pbsb|pmng|pn00/);
  });
});

// The contract map MUST agree with the BodyLayers type — the required layers are
// non-optional string fields; the optional layers/nodes are optional. expectTypeOf
// proves a value with ONLY the required layers type-checks, and that dropping any
// required layer is a type error — so the type and the map cannot diverge.
describe('AC1 — LAYER_CONTRACT agrees with the BodyLayers type', () => {
  test('a body with only the required layers is a valid BodyLayers', () => {
    // The typed assignment itself proves a required-only body type-checks (a
    // missing required layer here would be a compile error caught by typecheck).
    const minimal: BodyLayers = { color: 'c', shade: 's', mask: 'm' };
    expect(Object.keys(minimal)).toEqual(['color', 'shade', 'mask']);
    // Every required-layer key is a (required, non-optional) string on the type.
    expectTypeOf<BodyLayers>().toHaveProperty('color').toEqualTypeOf<string>();
    expectTypeOf<BodyLayers>().toHaveProperty('shade').toEqualTypeOf<string>();
    expectTypeOf<BodyLayers>().toHaveProperty('mask').toEqualTypeOf<string>();
  });

  test('the optional layer/nodes are optional on the type', () => {
    expectTypeOf<BodyLayers>().toHaveProperty('highlight').toEqualTypeOf<string | undefined>();
    expectTypeOf<BodyLayers>()
      .toHaveProperty('chargePort')
      .toEqualTypeOf<{ x: number; y: number } | undefined>();
  });
});
