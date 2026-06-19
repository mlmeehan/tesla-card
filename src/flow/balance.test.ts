// Co-located unit test for the balance authority (Story 4.1) — the #1 D5
// verification target. Central balance means Hero and Scene "can't disagree", so
// one sign bug would flip every surface: these are PROPERTY tests on the rule
// (sign-convention correctness + conservation/sum-to-zero), driven by the shared
// fixture corpus, incl. the degenerate all-quiescent and absent-node states.
//
// Environment 'node' (no DOM); hermetic (committed fixtures, zero network).
import { describe, expect, test } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from '../types';
import { resolveEnergyEntities, numById, type EnergyEntities } from '../data/energy';
import { adapterFor } from '../data/dialect';
import { BUS_ORIENTATION } from '../data/registry';
import { buildFlowModel, BUS_NODE_ID, type FlowInput, type FlowModel } from './model';
import { flowInputsFrom, POWER_KEY, ENERGY_ROLES } from './binding';
import * as balanceModule from './balance';
import { computeBalance } from './balance';
import awake from '../fixtures/model-y-awake.json';
import asleep from '../fixtures/model-y-asleep.json';
import unresolved from '../fixtures/all-unresolved.json';

function makeHass(states: Record<string, any>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}

// The balance tests bind their inputs through the PRODUCTION binding (Story 4.2,
// `flowInputsFrom`) — there is no test-only stub hand-supplying provenance, and no
// second divergent pipeline. The asleep fixture back-dates every stamp 50 min, so
// we inject its `reference_now` for hermetic staleness (else the reader would call
// the last-known reads fresh); the binding then DERIVES `quiescent` from freshness.
const ASLEEP_NOW = Date.parse(asleep.provenance.reference_now as string);

describe('computeBalance — conservation (Story 4.1, AC4)', () => {
  test('the awake fixture conserves: per-node injections sum to ~0 (Kirchhoff at the bus)', () => {
    const model = buildFlowModel(flowInputsFrom(makeHass(awake.states), cfg()));
    const b = computeBalance(model);
    expect(b.residual).toBeCloseTo(0, 6);
    expect(b.balanced).toBe(true);
    // The bus endpoint carries the negated total (graph identity).
    expect(b.net[BUS_NODE_ID]).toBeCloseTo(-b.residual, 6);
  });

  test('conservation depends on the AC3 sign-flip: skipping it breaks the balance', () => {
    // Same readings, but with the battery sign NOT normalized (raw +discharging
    // fed straight in) — proves the dialect normalization is load-bearing, not
    // decorative: without it the bus no longer balances.
    const hass = makeHass(awake.states);
    const entities = resolveEnergyEntities(hass, cfg());
    const rawInputs: FlowInput[] = ENERGY_ROLES.map((role) => ({
      role,
      kW: numById(hass, entities[POWER_KEY[role]]),
      provenance: 'measured',
    }));
    const b = computeBalance(buildFlowModel(rawInputs));
    expect(b.balanced).toBe(false);
  });
});

describe('computeBalance — sign-convention correctness (Story 4.1, AC4)', () => {
  test('grid import (canonical +) injects into the bus; a charging battery draws', () => {
    // charging powerwall = canonical battery + (post-normalization); it is a SINK.
    const model = buildFlowModel([
      { role: 'grid', kW: 3, provenance: 'measured' }, // +import
      { role: 'powerwall', kW: 2, provenance: 'measured' }, // +charging
    ]);
    const b = computeBalance(model);
    expect(b.net.grid).toBeGreaterThan(0); // grid import injects (+)
    expect(b.net.powerwall).toBeLessThan(0); // charging draws (−)
  });

  test('a discharging battery (canonical −) injects into the bus', () => {
    const b = computeBalance(buildFlowModel([{ role: 'powerwall', kW: -2, provenance: 'measured' }]));
    expect(b.net.powerwall).toBeGreaterThan(0); // discharge is a source (+)
  });
});

describe('computeBalance — degenerate states (Story 4.1, AC4)', () => {
  test('all-quiescent (asleep) still conserves — calm-but-present, never blank', () => {
    const model = buildFlowModel(flowInputsFrom(makeHass(asleep.states), cfg(), { now: ASLEEP_NOW }));
    const b = computeBalance(model);
    expect(b.residual).toBeCloseTo(0, 6);
    expect(b.balanced).toBe(true);
    // Edges exist (present) but carry no live flow sense.
    expect(model.edges.length).toBeGreaterThan(0);
    expect(model.edges.every((e) => e.provenance === 'quiescent')).toBe(true);
    expect(model.edges.every((e) => e.direction === 'none')).toBe(true);
  });

  test('absent nodes (all-unresolved install) → empty graph balances vacuously', () => {
    const inputs = flowInputsFrom(makeHass(unresolved.states), cfg());
    const model = buildFlowModel(inputs);
    expect(model.nodes.every((n) => !n.present)).toBe(true); // all absent
    expect(model.edges).toHaveLength(0);
    const b = computeBalance(model);
    expect(b.residual).toBe(0);
    expect(b.balanced).toBe(true);
  });
});

describe('computeBalance — sole balance authority (Story 4.1, AC1)', () => {
  test('balance.ts exposes exactly one runtime export — the sole balance function', () => {
    // AC1: balance is the SOLE export (the compute boundary). A leaked helper
    // would give another surface a second place to (mis-)compute balance, the
    // FMEA mode this module exists to prevent. (`Balance` is a type → erased.)
    expect(Object.keys(balanceModule)).toEqual(['computeBalance']);
  });

  test('balance is graph-generic — it ignores FlowNode.role (no per-node-type branch)', () => {
    // Identical ids + edges, DIFFERENT roles → identical balance. Proves balance
    // aggregates purely by graph structure and never reads `role`, so a new
    // energy node is a registry + component edit, never a balance edit (AC1).
    const edges: FlowModel['edges'] = [
      { from: 'a', to: BUS_NODE_ID, kW: 3, direction: 'forward', provenance: 'measured' },
      { from: 'b', to: BUS_NODE_ID, kW: -3, direction: 'reverse', provenance: 'measured' },
    ];
    const m1: FlowModel = {
      nodes: [
        { id: 'a', role: 'solar', present: true },
        { id: 'b', role: 'home', present: true },
      ],
      edges,
    };
    const m2: FlowModel = {
      nodes: [
        { id: 'a', role: 'grid', present: true }, // roles swapped wholesale…
        { id: 'b', role: 'wall_connector', present: true },
      ],
      edges,
    };
    expect(computeBalance(m1)).toEqual(computeBalance(m2)); // …balance is unmoved
  });
});

describe('computeBalance — conservation is the graph RULE, not a fixture literal (Story 4.1, AC4)', () => {
  // Arbitrary input sets (balanced AND deliberately unbalanced) — assert the
  // identities that DEFINE conservation, so the property holds for any model,
  // not just the captured corpus.
  const CASES: ReadonlyArray<readonly FlowInput[]> = [
    [
      { role: 'solar', kW: 5, provenance: 'measured' },
      { role: 'home', kW: 5, provenance: 'measured' }, // perfectly balanced
    ],
    [
      { role: 'grid', kW: 4, provenance: 'measured' },
      { role: 'solar', kW: 2, provenance: 'measured' },
      { role: 'home', kW: 3, provenance: 'measured' },
      { role: 'powerwall', kW: -3, provenance: 'measured' }, // discharge injects
    ],
    [
      { role: 'grid', kW: 7, provenance: 'measured' }, // unbalanced on purpose
      { role: 'home', kW: 2, provenance: 'measured' },
    ],
  ];

  test('residual == Σ(real-node net) and bus carries the negated total — for every case', () => {
    for (const inputs of CASES) {
      const model = buildFlowModel(inputs);
      const b = computeBalance(model);
      const realSum = model.nodes.reduce((s, n) => s + (b.net[n.id] ?? 0), 0);
      expect(b.residual).toBeCloseTo(realSum, 6); // residual IS the real-node sum
      expect(b.net[BUS_NODE_ID]).toBeCloseTo(-realSum, 6); // bus = negated total
      expect(b.balanced).toBe(Math.abs(b.residual) <= 0.05); // flag tracks the rule
    }
  });
});

describe('computeBalance — sign-convention holds on the fixture CORPUS (Story 4.1, AC4)', () => {
  test('each present node nets with its registry orientation on the awake corpus', () => {
    // AC4 asks for sign-convention correctness against the corpus (not only
    // synthetic vectors). Per node: net == orientation × canonical reading, so a
    // source role (orientation +1) injects and a sink role (−1) draws — a real
    // invariant independent of the fixture's exact magnitudes.
    const hass = makeHass(awake.states);
    const entities: EnergyEntities = resolveEnergyEntities(hass, cfg());
    const adapter = adapterFor(hass, cfg());
    const model = buildFlowModel(flowInputsFrom(hass, cfg()));
    const b = computeBalance(model);
    for (const node of model.nodes) {
      if (!node.present) continue;
      const canonical = adapter.normalizePower(node.role, numById(hass, entities[POWER_KEY[node.role]])).value;
      expect(b.net[node.id]).toBeCloseTo(BUS_ORIENTATION[node.role] * (canonical as number), 6);
    }
  });
});
