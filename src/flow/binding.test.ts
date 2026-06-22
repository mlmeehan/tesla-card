// Co-located unit test for the Story-4.2 binding layer — the seam that turns
// `(hass, config)` into the canonical `FlowModel` the renderers (4.3/4.4) consume.
// Drives from the SHARED fixture corpus (the same JSON balance/demo use) and
// asserts on the resulting FlowModel (presence / provenance / direction / sign),
// never on intermediate reads. Environment 'node' (no DOM); hermetic (committed
// fixtures, injected `now`, zero network).
import { describe, expect, test } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from '../types';
import type { EnergyRole, Role } from '../data/registry';
import { bindFlowModel, flowInputsFrom, POWER_KEY, ENERGY_ROLES, DEADBAND } from './binding';
import { computeBalance } from './balance';
import awake from '../fixtures/model-y-awake.json';
import asleep from '../fixtures/model-y-asleep.json';
import unresolved from '../fixtures/all-unresolved.json';
import flowGridImport from '../fixtures/flow-grid-import.json';
import flowGridExport from '../fixtures/flow-grid-export.json';
import flowSolarSurplus from '../fixtures/flow-solar-surplus.json';
import flowCharging from '../fixtures/flow-charging.json';
import flowPluggedIdle from '../fixtures/flow-plugged-idle.json';
import flowIslanding from '../fixtures/flow-islanding.json';
import flowVampire from '../fixtures/flow-vampire.json';

function makeHass(states: Record<string, unknown>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}
// The asleep fixture back-dates every stamp 50 min before this reference, so the
// freshness reader classifies the (still-present) last-known reads asleep when we
// inject `now`. Without it `referenceNow` would derive the max stamp and call them
// fresh (the documented hermetic-staleness requirement of the fixture).
const ASLEEP_NOW = Date.parse(asleep.provenance.reference_now as string);

describe('binding — auto-detect measured edges (AC1, AC3)', () => {
  test('awake corpus → present `measured` edges with canonical signs', () => {
    const model = bindFlowModel(makeHass(awake.states as Record<string, unknown>), cfg());
    // Every energy role resolves on the awake corpus → 5 present nodes + 5 edges.
    expect(model.nodes.length).toBe(ENERGY_ROLES.length);
    expect(model.nodes.every((n) => n.present)).toBe(true);
    expect(model.edges.length).toBe(ENERGY_ROLES.length);
    // Fresh + above the deadband ⇒ measured (a sign-flip is normalization, not
    // inference — never `inferred`), and a live direction (not 'none').
    expect(model.edges.every((e) => e.provenance === 'measured')).toBe(true);
    expect(model.edges.some((e) => e.direction !== 'none')).toBe(true);
    expect(model.edges.every((e) => e.provenance !== 'inferred')).toBe(true);
  });

  test('canonical sign: a discharging Powerwall normalizes to canonical − (AC3)', () => {
    // Raw battery_power = +1.5 (tesla_fleet: + = discharging). The dialect flips
    // it → canonical −1.5 (battery + = charging). A pure sign-flip stays MEASURED.
    const inputs = flowInputsFrom(makeHass(awake.states as Record<string, unknown>), cfg());
    const pw = inputs.find((i) => i.role === 'powerwall');
    expect(pw?.kW).toBeCloseTo(-1.5, 6);
    expect(pw?.provenance).toBe('measured');
  });
});

describe('binding — freshness → quiescent coupling (AC2)', () => {
  test('asleep corpus → edges present but `quiescent` + `direction:none`', () => {
    const model = bindFlowModel(makeHass(asleep.states as Record<string, unknown>), cfg(), {
      now: ASLEEP_NOW,
    });
    // Quiescent still CARRIES a value (last-known echo) → the edge is present, not
    // dropped — present-and-calm, never blank.
    expect(model.edges.length).toBe(ENERGY_ROLES.length);
    expect(model.edges.every((e) => e.provenance === 'quiescent')).toBe(true);
    expect(model.edges.every((e) => e.direction === 'none')).toBe(true);
  });
});

describe('binding — absent node omitted with its edge (AC4)', () => {
  test('all-unresolved install → every node present:false, zero edges', () => {
    const model = bindFlowModel(makeHass(unresolved.states as Record<string, unknown>), cfg());
    expect(model.nodes.length).toBe(ENERGY_ROLES.length);
    expect(model.nodes.every((n) => !n.present)).toBe(true);
    expect(model.edges).toHaveLength(0);
  });
});

describe('binding — magnitude deadband → quiescent (AC5, jitter guard)', () => {
  test('a sub-deadband FRESH read is tagged quiescent (so jitter never animates)', () => {
    const stamp = '2026-06-15T14:41:00Z';
    const now = Date.parse(stamp); // age 0 ⇒ fresh, so only the deadband can quiesce it
    const tiny = (DEADBAND / 2).toString(); // |kW| < DEADBAND
    const hass = makeHass({
      'sensor.my_home_solar_power': {
        entity_id: 'sensor.my_home_solar_power',
        state: tiny,
        attributes: {},
        last_changed: stamp,
        last_updated: stamp,
      },
    });
    const model = bindFlowModel(hass, cfg(), { now });
    const solar = model.edges.find((e) => e.from === 'solar');
    expect(solar).toBeDefined();
    expect(solar?.provenance).toBe('quiescent'); // present but calm, not a sub-idle "measured" edge
    expect(solar?.direction).toBe('none');
  });
});

describe('binding — config.energy.entities override wins (AC1)', () => {
  test('an explicit entity override binds that sensor (not auto-detect)', () => {
    const stamp = '2026-06-15T14:41:00Z';
    const now = Date.parse(stamp);
    const hass = makeHass({
      'sensor.my_custom_pv': {
        entity_id: 'sensor.my_custom_pv',
        state: '4.2',
        attributes: {},
        last_changed: stamp,
        last_updated: stamp,
      },
    });
    const override: TeslaCardConfig = cfg({
      energy: { entities: { solar_power: 'sensor.my_custom_pv' } },
    });
    const inputs = flowInputsFrom(hass, override, { now });
    const solar = inputs.find((i) => i.role === 'solar');
    expect(solar?.kW).toBeCloseTo(4.2, 6); // bound the overridden sensor's value
    expect(solar?.provenance).toBe('measured');
  });
});

describe('binding — shared role→power-key map (no fork)', () => {
  test('POWER_KEY covers exactly the five energy roles', () => {
    const roles = Object.keys(POWER_KEY) as EnergyRole[];
    expect(roles.sort()).toEqual(['grid', 'home', 'powerwall', 'solar', 'wall_connector']);
    expect(ENERGY_ROLES.length).toBe(5);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// QA gap coverage (4.2) — added by qa-generate-e2e-tests. These fill the edges
// the happy-path corpus tests above don't reach: the NaN-safe "no usable value"
// branch (distinct from stale-but-numeric quiescent), per-node (not all-or-
// nothing) omission, the deadband boundary, and dialect passthrough. Same
// hermetic style: committed states, injected `now`, assertions on the FlowModel.
// ───────────────────────────────────────────────────────────────────────────

const FRESH_STAMP = '2026-06-15T14:41:00Z';
const FRESH_NOW = Date.parse(FRESH_STAMP);
function sensor(id: string, state: string): Record<string, unknown> {
  return {
    [id]: { entity_id: id, state, attributes: {}, last_changed: FRESH_STAMP, last_updated: FRESH_STAMP },
  };
}

describe('binding — NaN-safe: unusable value → ABSENT, not a phantom edge (AC2, AC4)', () => {
  // An `unavailable` source is NOT a stale last-known value: numById can't make a
  // finite number of it, so kW is undefined ⇒ the node is absent with NO edge.
  // This is the boundary the asleep corpus (a numeric last-known echo → quiescent)
  // does not exercise — there the value survives; here there is nothing to carry.
  test('a `unavailable` solar source → present:false, no solar edge', () => {
    const model = bindFlowModel(makeHass(sensor('sensor.my_home_solar_power', 'unavailable')), cfg(), {
      now: FRESH_NOW,
    });
    const solar = model.nodes.find((n) => n.role === 'solar');
    expect(solar?.present).toBe(false);
    expect(model.edges.find((e) => e.from === 'solar')).toBeUndefined();
  });

  test('a non-numeric ("unknown") solar state → NaN-safe undefined → absent, never NaN', () => {
    const model = bindFlowModel(makeHass(sensor('sensor.my_home_solar_power', 'unknown')), cfg(), {
      now: FRESH_NOW,
    });
    expect(model.nodes.find((n) => n.role === 'solar')?.present).toBe(false);
    expect(model.edges).toHaveLength(0); // and no edge carries a NaN kW
    expect(model.edges.every((e) => Number.isFinite(e.kW))).toBe(true);
  });
});

describe('binding — per-node omission on a partial install (AC4)', () => {
  // Omission is per-role, not all-or-nothing: a half-resolved install (solar +
  // grid present, the other three absent) emits exactly the present roles' edges.
  test('only the resolved roles get nodes:present + edges; the rest are present:false', () => {
    const states = {
      ...sensor('sensor.my_home_solar_power', '4.0'),
      ...sensor('sensor.my_home_grid_power', '1.0'),
    };
    const model = bindFlowModel(makeHass(states), cfg(), { now: FRESH_NOW });
    expect(model.nodes.length).toBe(ENERGY_ROLES.length); // always one node per role
    const present = model.nodes.filter((n) => n.present).map((n) => n.role).sort();
    expect(present).toEqual(['grid', 'solar']);
    expect(model.edges.map((e) => e.from).sort()).toEqual(['grid', 'solar']);
  });
});

describe('binding — deadband boundary: real flow stays measured (AC5 complement)', () => {
  // The sub-deadband test proves jitter is quiesced; this proves the deadband does
  // NOT over-quiesce — a fresh read at/above the deadband stays `measured` with a
  // live direction. (Mirror of the jitter-guard case, so the threshold cuts once.)
  test('a fresh read ≥ DEADBAND is `measured` with a live direction', () => {
    const above = (DEADBAND * 20).toString(); // comfortably above the deadband
    const model = bindFlowModel(makeHass(sensor('sensor.my_home_solar_power', above)), cfg(), {
      now: FRESH_NOW,
    });
    const solar = model.edges.find((e) => e.from === 'solar');
    expect(solar?.provenance).toBe('measured');
    expect(solar?.direction).not.toBe('none');
  });

  test('a sub-deadband NEGATIVE read is quiescent too (magnitude, not sign)', () => {
    const tinyNeg = (-(DEADBAND / 2)).toString(); // |kW| < DEADBAND, grid passes sign through
    const inputs = flowInputsFrom(makeHass(sensor('sensor.my_home_grid_power', tinyNeg)), cfg(), {
      now: FRESH_NOW,
    });
    expect(inputs.find((i) => i.role === 'grid')?.provenance).toBe('quiescent');
  });
});

describe('binding — dialect passthrough stays measured with sign intact (AC3)', () => {
  // Complement to the powerwall-flip case: a non-flipped role (grid) keeps its raw
  // sign through normalize and is `measured` — confirming only powerwall flips and
  // a passthrough is still normalization (never `inferred`).
  test('a fresh positive grid read passes through canonical + measured', () => {
    const inputs = flowInputsFrom(makeHass(sensor('sensor.my_home_grid_power', '2.5')), cfg(), {
      now: FRESH_NOW,
    });
    const grid = inputs.find((i) => i.role === 'grid');
    expect(grid?.kW).toBeCloseTo(2.5, 6); // sign preserved (grid is passthrough)
    expect(grid?.provenance).toBe('measured');
  });
});

// AC3 — measured-vs-inferred: `inferred` is a RESERVED Provenance value (model.ts)
// for genuinely back-computed kW (e.g. a future Solar→Vehicle split). The present
// node→bus binding produces NO inferred edge — only `measured` (fresh) or
// `quiescent` (not-fresh / sub-deadband). The awake case above pins this for one
// fixture; this sweep pins it as a CORPUS-WIDE invariant across every committed
// flow-state, so the reserved-but-unused status is enforced, not just asserted once.
// If anyone later wires real inference, this test goes RED at the binding layer and
// forces them to add the matching coverage (closes the 4.2-AC3 traceability note).
describe('binding — `inferred` is reserved-but-unused: no committed fixture yields it (AC3)', () => {
  const CORPUS: ReadonlyArray<{ name: string; states: Record<string, unknown> }> = [
    { name: 'awake', states: awake.states as Record<string, unknown> },
    { name: 'asleep', states: asleep.states as Record<string, unknown> },
    { name: 'flow-grid-import', states: flowGridImport.states as Record<string, unknown> },
    { name: 'flow-grid-export', states: flowGridExport.states as Record<string, unknown> },
    { name: 'flow-solar-surplus', states: flowSolarSurplus.states as Record<string, unknown> },
    { name: 'flow-charging', states: flowCharging.states as Record<string, unknown> },
    { name: 'flow-plugged-idle', states: flowPluggedIdle.states as Record<string, unknown> },
    { name: 'flow-islanding', states: flowIslanding.states as Record<string, unknown> },
    { name: 'flow-vampire', states: flowVampire.states as Record<string, unknown> },
  ];

  for (const { name, states } of CORPUS) {
    test(`${name} → every edge provenance ∈ {measured, quiescent}, never inferred`, () => {
      const model = bindFlowModel(makeHass(states), cfg());
      expect(model.edges.length, 'the fixture yields at least one edge to check').toBeGreaterThan(0);
      for (const e of model.edges) {
        expect(['measured', 'quiescent'], `${name}: ${e.from}→${e.to} provenance`).toContain(e.provenance);
        expect(e.provenance).not.toBe('inferred');
      }
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Story 9.2 — the node-hide seam (AC1). A role in the opt-in `hide` set is forced
// to the SAME `kW:undefined` absence already produces, so `buildFlowModel` emits
// `present:false` with no edge. This is the AC1 unit proof AT the seam: hidden ==
// absent by construction (no separate "hidden" branch), the Hero (zero-arg call)
// stays a zero-diff, and garbage in `hide` is inert (FR-24).
// ───────────────────────────────────────────────────────────────────────────
describe('binding — Story 9.2: a hidden energy role drops at the model seam (AC1)', () => {
  const awakeStates = awake.states as Record<string, unknown>;

  test('a hidden energy role → present:false with NO edge (the absent-node contract, reused)', () => {
    const model = bindFlowModel(makeHass(awakeStates), cfg(), {}, ['solar']);
    expect(model.nodes.find((n) => n.role === 'solar')?.present).toBe(false);
    expect(model.edges.find((e) => e.from === 'solar')).toBeUndefined();
    // exactly one fewer present node + edge than the un-hidden baseline (precise drop)
    expect(model.nodes.filter((n) => n.present).length).toBe(ENERGY_ROLES.length - 1);
    expect(model.edges.length).toBe(ENERGY_ROLES.length - 1);
  });

  test('only the named role drops — every other role still binds its live reading', () => {
    const inputs = flowInputsFrom(makeHass(awakeStates), cfg(), {}, ['solar']);
    expect(inputs.find((i) => i.role === 'solar')?.kW).toBeUndefined();
    for (const role of ENERGY_ROLES.filter((r) => r !== 'solar')) {
      expect(inputs.find((i) => i.role === role)?.kW, `${role} unaffected`).toBeDefined();
    }
  });

  test('multiple hidden roles all drop together', () => {
    const model = bindFlowModel(makeHass(awakeStates), cfg(), {}, ['solar', 'grid']);
    const present = model.nodes.filter((n) => n.present).map((n) => n.role).sort();
    expect(present).toEqual(['home', 'powerwall', 'wall_connector']);
  });

  test('an unknown string in hide is ignored — no throw, nothing dropped (FR-24)', () => {
    const build = () =>
      bindFlowModel(makeHass(awakeStates), cfg(), {}, ['not_a_node'] as unknown as readonly Role[]);
    expect(build).not.toThrow();
    expect(build().nodes.filter((n) => n.present).length).toBe(ENERGY_ROLES.length); // full roster intact
  });

  test("hiding 'vehicle' is inert at the binding seam (it is not an energy/flow node — AC2 owns it)", () => {
    const model = bindFlowModel(makeHass(awakeStates), cfg(), {}, ['vehicle']);
    expect(model.nodes.filter((n) => n.present).length).toBe(ENERGY_ROLES.length);
  });

  test('the Hero zero-arg bindFlowModel is UNCHANGED — no hide applied without the param (zero-diff guard)', () => {
    const heroModel = bindFlowModel(makeHass(awakeStates), cfg()); // EXACTLY the Hero's call (hero.ts:261)
    expect(heroModel.nodes.every((n) => n.present)).toBe(true);
    expect(heroModel.edges.length).toBe(ENERGY_ROLES.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Story 9.7 — the multi-instance expansion (AC3). The MIRROR of 9.2's hide at the
// SAME seam: instead of removing a role's input, expand it to N. Each instance
// binds its OWN resolved entity set (instance override wins), carries its
// instanceId, and produces an independent FlowInput → independent present node →
// independent bus tap. Balance is keyed BY NODE ID, so N same-role taps sum
// Kirchhoff-honestly with NO `flow/balance.ts` edit (INV-1 / AR-6).
// ───────────────────────────────────────────────────────────────────────────
describe('binding — Story 9.7: a role expands to N instances at the seam (AC3)', () => {
  // Hermetic fresh stamp so the synthetic reads classify `measured` (not stale).
  const NOW = '2026-01-01T00:00:00.000Z';
  const nowMs = Date.parse(NOW);
  const st = (v: string) => ({ state: v, last_changed: NOW, last_updated: NOW, attributes: {} });

  // Two solar arrays, each on its OWN sensor; #1 base id pinned, #2 per-instance override.
  const twoSolar = makeHass({
    'sensor.solar_south_power': st('2.0'),
    'sensor.solar_garage_power': st('1.2'),
  });
  const twoSolarCfg = cfg({
    energy: {
      entities: { solar_power: 'sensor.solar_south_power' }, // instance #1 base resolution
      nodes: {
        instances: {
          solar: [{}, { entities: { solar_power: 'sensor.solar_garage_power' } }],
        },
      },
    },
  });

  test('a 2-instance solar role → 2 FlowInputs with distinct instance ids (solar:1, solar:2)', () => {
    const inputs = flowInputsFrom(twoSolar, twoSolarCfg, { now: nowMs });
    const solar = inputs.filter((i) => i.role === 'solar');
    expect(solar.map((i) => i.id)).toEqual(['solar:1', 'solar:2']);
    // role stays `solar` on both (balance/orientation reads role, not id).
    expect(solar.every((i) => i.role === 'solar')).toBe(true);
  });

  test('each instance reads its OWN power sensor — the per-instance override wins (AC3)', () => {
    const inputs = flowInputsFrom(twoSolar, twoSolarCfg, { now: nowMs });
    const byId = new Map(inputs.map((i) => [i.id, i]));
    expect(byId.get('solar:1')?.kW).toBeCloseTo(2.0, 6); // base (auto-resolution)
    expect(byId.get('solar:2')?.kW).toBeCloseTo(1.2, 6); // override
    expect(byId.get('solar:1')?.provenance).toBe('measured');
  });

  test('the model carries 2 present solar nodes + 2 edges — one tap each (AC4)', () => {
    const model = bindFlowModel(twoSolar, twoSolarCfg, { now: nowMs });
    const solarNodes = model.nodes.filter((n) => n.role === 'solar' && n.present);
    expect(solarNodes.map((n) => n.id)).toEqual(['solar:1', 'solar:2']);
    expect(model.edges.filter((e) => e.from === 'solar:1' || e.from === 'solar:2')).toHaveLength(2);
  });

  test('a single-instance role with `[{}]` (or no instances) is a zero-diff bare-id input', () => {
    // An explicit one-element list and an omitted instances key both yield the bare `solar` id.
    const explicit = flowInputsFrom(twoSolar, cfg({
      energy: { entities: { solar_power: 'sensor.solar_south_power' }, nodes: { instances: { solar: [{}] } } },
    }), { now: nowMs });
    const omitted = flowInputsFrom(twoSolar, cfg({
      energy: { entities: { solar_power: 'sensor.solar_south_power' } },
    }), { now: nowMs });
    expect(explicit.filter((i) => i.role === 'solar').map((i) => i.id)).toEqual(['solar']);
    expect(omitted.filter((i) => i.role === 'solar').map((i) => i.id)).toEqual(['solar']);
  });

  test('a hidden role drops ALL its instances (hide composes with instances)', () => {
    const model = bindFlowModel(twoSolar, twoSolarCfg, { now: nowMs }, ['solar']);
    expect(model.nodes.filter((n) => n.role === 'solar' && n.present)).toHaveLength(0);
    expect(model.edges.filter((e) => e.from.startsWith('solar'))).toHaveLength(0);
  });

  test('CONSERVATION: N same-role taps sum into balance BY ID — Kirchhoff-honest, no balance.ts edit (INV-1)', () => {
    // A balanced island: 2 solar arrays (2.0 + 1.2 = 3.2 kW injected) feed a 3.2 kW
    // home load. Balance keys net BY NODE ID, so the two arrays are TWO independent
    // injections (net['solar:1'], net['solar:2']) — never one merged `net['solar']`
    // — and the running total over the role = the sum of their nets, with the bus
    // balancing to ~0. Role-genericity proven without touching the balance compute.
    const island = makeHass({
      'sensor.solar_south_power': st('2.0'),
      'sensor.solar_garage_power': st('1.2'),
      'sensor.home_load_power': st('3.2'),
    });
    const islandCfg = cfg({
      energy: {
        entities: { solar_power: 'sensor.solar_south_power', load_power: 'sensor.home_load_power' },
        nodes: { instances: { solar: [{}, { entities: { solar_power: 'sensor.solar_garage_power' } }] } },
      },
    });
    const model = bindFlowModel(island, islandCfg, { now: nowMs });
    const bal = computeBalance(model);
    // Each instance is its OWN net entry (keyed by instance id, never merged by role).
    expect(bal.net['solar:1']).toBeCloseTo(2.0, 6);
    expect(bal.net['solar:2']).toBeCloseTo(1.2, 6);
    expect(bal.net['solar']).toBeUndefined(); // no role-merged tap exists
    // The role's running total = the sum of its instances' nets (the ribbon-fold math).
    expect((bal.net['solar:1'] ?? 0) + (bal.net['solar:2'] ?? 0)).toBeCloseTo(3.2, 6);
    // Home draws the matching 3.2 kW → the bus balances within tolerance (sources = loads).
    expect(bal.net['home']).toBeCloseTo(-3.2, 6);
    expect(bal.balanced).toBe(true);
  });
});
