// Co-located unit test for the flow data-model assembler (Story 4.1).
//
// Pure-hub test (environment 'node', no DOM): asserts buildFlowModel's SHAPE and
// role-generic edge orientation. The balance math is asserted in balance.test.ts
// (the #1 verification target); here we pin that the assembler produces the right
// nodes/edges and the documented direction representation.
import { describe, expect, test } from 'vitest';
import { BUS_ORIENTATION, type EnergyRole } from '../data/registry';
import { buildFlowModel, BUS_NODE_ID, type FlowInput } from './model';

const measured = (role: EnergyRole, kW: number | undefined): FlowInput => ({
  role,
  kW,
  provenance: 'measured',
});

describe('buildFlowModel (Story 4.1)', () => {
  test('every input becomes a FlowNode keyed/typed by its role; present reflects kW', () => {
    const model = buildFlowModel([
      measured('solar', 6),
      measured('home', undefined), // absent
    ]);
    expect(model.nodes).toEqual([
      { id: 'solar', role: 'solar', present: true },
      { id: 'home', role: 'home', present: false },
    ]);
  });

  test('a present node gets one edge node→bus; an absent node gets none', () => {
    const model = buildFlowModel([measured('solar', 6), measured('home', undefined)]);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]).toMatchObject({ from: 'solar', to: BUS_NODE_ID });
  });

  test('edge kW is the canonical reading oriented bus-ward (registry BUS_ORIENTATION)', () => {
    // sources inject (+), sinks draw (−) — driven purely by the registry table,
    // proving role-genericity (no per-node-type branch in the assembler).
    for (const role of ['solar', 'grid', 'powerwall', 'home', 'wall_connector'] as const) {
      const [edge] = buildFlowModel([measured(role, 4)]).edges;
      expect(edge.kW).toBe(BUS_ORIENTATION[role] * 4);
    }
  });

  test('direction is from→to positive-flow sense (forward=into bus, reverse=out)', () => {
    // grid importing (canonical +) injects → forward; charging powerwall draws → reverse.
    expect(buildFlowModel([measured('grid', 2)]).edges[0].direction).toBe('forward');
    expect(buildFlowModel([measured('powerwall', 2)]).edges[0].direction).toBe('reverse');
    // A discharging powerwall (canonical −) injects → forward.
    expect(buildFlowModel([measured('powerwall', -2)]).edges[0].direction).toBe('forward');
  });

  test('a near-zero flow is idle (direction:none) and quiescent kills the live sense', () => {
    expect(buildFlowModel([measured('solar', 0.01)]).edges[0].direction).toBe('none');
    const quiescent = buildFlowModel([{ role: 'solar', kW: 6, provenance: 'quiescent' }]);
    // The value is carried, but there is no live flow to animate.
    expect(quiescent.edges[0].kW).toBe(6);
    expect(quiescent.edges[0].direction).toBe('none');
    expect(quiescent.edges[0].provenance).toBe('quiescent');
  });

  test('the idle threshold is exact: |kW| at 0.05 is none, just beyond resolves a sense', () => {
    // Pins the IDLE_KW boundary (the `> IDLE_KW` deadband) so a renderer never
    // flickers on sensor noise. solar (orientation +1) keeps the input's sign.
    expect(buildFlowModel([measured('solar', 0.05)]).edges[0].direction).toBe('none'); // == threshold
    expect(buildFlowModel([measured('solar', -0.05)]).edges[0].direction).toBe('none');
    expect(buildFlowModel([measured('solar', 0.06)]).edges[0].direction).toBe('forward'); // just over
    expect(buildFlowModel([measured('solar', -0.06)]).edges[0].direction).toBe('reverse');
  });

  test('all five energy roles assemble into one bus-attached edge each (role vocabulary parity)', () => {
    const model = buildFlowModel(
      (['solar', 'grid', 'powerwall', 'home', 'wall_connector'] as const).map((r) => measured(r, 3)),
    );
    expect(model.nodes).toHaveLength(5);
    expect(model.edges).toHaveLength(5);
    expect(model.edges.every((e) => e.to === BUS_NODE_ID)).toBe(true);
  });
});
