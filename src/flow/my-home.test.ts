import { describe, expect, test } from 'vitest';
import {
  SCENE_NODES,
  relativeAnchors,
  deriveBusAnchor,
  busAnchorBetweenRows,
  RafCoalescer,
  gatewaySegments,
  sceneAggregates,
  selfPowered,
  ribbonTiles,
  coupledRoles,
  busAxis,
  axisForWidth,
  SCENE_PHONE_MAX,
  BUS_WIDTH_MAX,
  VEHICLE_NODE_ID,
  wcVehicleEdge,
  wcVehicleEdgeFor,
  wcEdgeForVehicle,
} from './my-home';
import { roleOfInstance } from './instances';
import { ENERGY_ROLES, bindFlowModel } from './binding';
import { BUS_NODE_ID, IDLE_KW, buildFlowModel, type FlowModel, type FlowInput } from './model';
import { computeBalance } from './balance';
import { edgeVisual } from './renderer';
import type { EnergyRole } from '../data/registry';
import type { RectLike } from './scene-bus';
import type { HomeAssistant, TeslaCardConfig } from '../types';
import gridImport from '../fixtures/flow-grid-import.json';
import charging from '../fixtures/flow-charging.json';
import islanding from '../fixtures/flow-islanding.json';

const r = (left: number, top: number, width = 100, height = 50): RectLike => ({
  left,
  top,
  width,
  height,
});

/** Build a model from explicit per-role canonical readings (orientation applied by the model). */
const modelOf = (inputs: FlowInput[]): FlowModel => buildFlowModel(inputs);
const measured = (role: EnergyRole, kW: number): FlowInput => ({ role, kW, provenance: 'measured' });

/** Bind a committed fixture through the production path (its own reference_now). */
function fixtureModel(fx: { provenance: { reference_now: string }; states: Record<string, unknown> }): FlowModel {
  const now = Date.parse(fx.provenance.reference_now);
  return bindFlowModel({ states: fx.states } as unknown as HomeAssistant, { type: 'tc' } as TeslaCardConfig, { now });
}

describe('SCENE_NODES — no forked role list', () => {
  test('equals ENERGY_ROLES exactly (same order, no vehicle)', () => {
    expect([...SCENE_NODES]).toEqual([...ENERGY_ROLES]);
    expect(SCENE_NODES).not.toContain('vehicle');
  });
});

describe('relativeAnchors — viewport → container-relative', () => {
  test('subtracts the container origin; sizes pass through', () => {
    const out = relativeAnchors(r(100, 200), { solar: r(150, 260, 80, 40) });
    expect(out.solar).toEqual({ left: 50, top: 60, width: 80, height: 40 });
  });

  test('identity at the origin container', () => {
    const rects = { grid: r(10, 20, 30, 40) };
    expect(relativeAnchors(r(0, 0), rects)).toEqual(rects);
  });

  test('handles multiple anchors independently', () => {
    const out = relativeAnchors(r(5, 5), { a: r(5, 5), b: r(105, 55) });
    expect(out.a).toEqual({ left: 0, top: 0, width: 100, height: 50 });
    expect(out.b).toEqual({ left: 100, top: 50, width: 100, height: 50 });
  });
});

describe('deriveBusAnchor — the star junction', () => {
  test('undefined for no anchors', () => {
    expect(deriveBusAnchor({})).toBeUndefined();
  });

  test('zero-size rect at the centroid of present node centres', () => {
    // Two nodes: centres (50,25) and (250,25) → centroid (150,25).
    const bus = deriveBusAnchor({ solar: r(0, 0), grid: r(200, 0) });
    expect(bus).toEqual({ left: 150, top: 25, width: 0, height: 0 });
  });

  test('excludes an existing BUS_NODE_ID entry (idempotent)', () => {
    const anchors = { solar: r(0, 0), grid: r(200, 0), [BUS_NODE_ID]: r(9999, 9999) };
    const bus = deriveBusAnchor(anchors);
    expect(bus).toEqual({ left: 150, top: 25, width: 0, height: 0 });
  });
});

describe('busAnchorBetweenRows — the trunk lives in the inter-row GAP, not the centroid', () => {
  const SRC = ['solar', 'powerwall', 'grid'] as const;
  const LOAD = ['home', 'wall_connector'] as const;
  // Unequal-height two-row fixture: a TALL Powerwall (h=400) flanked by short
  // Solar/Grid (h=80) over a short load row at top=500. Source span 0..400, load
  // span 500..580 — a clean 400→500 gap. This is the geometry that breaks the
  // centroid: its cy is dragged DOWN by the tall Powerwall INTO the source span.
  const twoRow: Record<string, RectLike> = {
    solar: r(0, 0, 100, 80),
    powerwall: r(140, 0, 100, 400),
    grid: r(280, 0, 100, 80),
    home: r(70, 500, 100, 80),
    wall_connector: r(210, 500, 100, 80),
  };
  const MAX_BOTTOM = 400; // max(source top+height) = Powerwall bottom
  const MIN_TOP = 500; //    min(load top)        = load row top

  test('two-row unequal heights — DISCRIMINATING: old centroid sits over a source card, new top in the gap', () => {
    const centroid = deriveBusAnchor(twoRow)!;
    const bus = busAnchorBetweenRows(twoRow, SRC, LOAD)!;
    // The BUG: the old centroid cy falls INSIDE the source row's vertical span —
    // specifically within the tall Powerwall card (top 0 .. bottom 400) — so the
    // 6.6 trunk drew over it.
    expect(centroid.top).toBeGreaterThanOrEqual(twoRow.powerwall.top);
    expect(centroid.top).toBeLessThanOrEqual(twoRow.powerwall.top + twoRow.powerwall.height);
    // The FIX: the new top lands strictly in the inter-row gap (maxBottom..minTop).
    expect(bus.top).toBeGreaterThan(MAX_BOTTOM);
    expect(bus.top).toBeLessThan(MIN_TOP);
    expect(bus.top).toBe((MAX_BOTTOM + MIN_TOP) / 2); // 450 — the channel centre
    // left preserved from the centroid (the only field axis:'y' reads); zero-size.
    expect(bus.left).toBe(centroid.left);
    expect(bus.width).toBe(0);
    expect(bus.height).toBe(0);
  });

  test('single-row (only sources anchored) → honest centroid', () => {
    const anchors = { solar: r(0, 0, 100, 80), powerwall: r(140, 0, 100, 400) };
    expect(busAnchorBetweenRows(anchors, SRC, LOAD)).toEqual(deriveBusAnchor(anchors));
  });

  test('single-row (only loads anchored) → honest centroid', () => {
    const anchors = { home: r(70, 500, 100, 80), wall_connector: r(210, 500, 100, 80) };
    expect(busAnchorBetweenRows(anchors, SRC, LOAD)).toEqual(deriveBusAnchor(anchors));
  });

  test('rows overlap (maxBottom >= minTop, mid-layout) → honest centroid, never a line inside a card', () => {
    const anchors: Record<string, RectLike> = {
      ...twoRow,
      home: r(70, 100, 100, 80), // load top 100 is ABOVE the Powerwall bottom 400
      wall_connector: r(210, 100, 100, 80),
    };
    expect(busAnchorBetweenRows(anchors, SRC, LOAD)).toEqual(deriveBusAnchor(anchors));
  });

  test('non-finite rect is DROPPED (empty ≠ zero) — gap computed from the remaining finite rects', () => {
    const anchors: Record<string, RectLike> = {
      ...twoRow,
      powerwall: r(140, 0, 100, NaN), // unmeasured height → dropped, not read as 0
    };
    const bus = busAnchorBetweenRows(anchors, SRC, LOAD)!;
    // Powerwall dropped ⇒ maxBottom = max(solar 80, grid 80) = 80; minTop = 500.
    expect(bus.top).toBe((80 + 500) / 2); // 290 — finite gap despite a NaN-cornered centroid
    expect(Number.isFinite(bus.top)).toBe(true);
  });

  test('finite all-zeros / unlaid-out rect slips past the finite-filter but the OVERLAP guard catches it (distinct from NaN)', () => {
    // An in-DOM-but-not-yet-laid-out child returns {0,0,0,0} — FINITE, so the
    // Number.isFinite filter keeps it. minTop then collapses to 0 ≤ maxBottom →
    // overlap guard → honest centroid. Proves the guard is the safety net the
    // finite-filter alone is NOT, and that the result is a clean centroid (no NaN).
    const anchors: Record<string, RectLike> = {
      ...twoRow,
      home: { left: 0, top: 0, width: 0, height: 0 },
    };
    const bus = busAnchorBetweenRows(anchors, SRC, LOAD)!;
    expect(bus).toEqual(deriveBusAnchor(anchors));
    expect(Number.isFinite(bus.top)).toBe(true);
  });

  test('no anchors → undefined (same as deriveBusAnchor — no bus drawn)', () => {
    expect(busAnchorBetweenRows({}, SRC, LOAD)).toBeUndefined();
  });

  test('a present vehicle cell does NOT move the gap line (in neither row, excluded from the centroid)', () => {
    const withVeh: Record<string, RectLike> = { ...twoRow, [VEHICLE_NODE_ID]: r(350, 500, 100, 80) };
    expect(busAnchorBetweenRows(withVeh, SRC, LOAD)).toEqual(busAnchorBetweenRows(twoRow, SRC, LOAD));
  });

  test('integration (axis:x): gatewaySegments cross lands strictly between source max-bottom and load min-top', () => {
    const model = topology({ solar: 3, powerwall: -1, grid: 2, home: 3, wall_connector: 1 });
    const anchors: Record<string, RectLike> = { ...twoRow };
    anchors[BUS_NODE_ID] = busAnchorBetweenRows(anchors, SRC, LOAD)!;
    const segs = gatewaySegments(model, anchors, { axis: 'x' });
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.cross).toBeGreaterThan(MAX_BOTTOM);
      expect(s.cross).toBeLessThan(MIN_TOP);
    }
  });

  test('integration (axis:y, phone): cross is unchanged from the centroid x — the corrected top is inert', () => {
    const model = topology({ solar: 3, powerwall: -1, grid: 2, home: 3, wall_connector: 1 });
    const centroid = deriveBusAnchor(twoRow)!;
    const anchors: Record<string, RectLike> = { ...twoRow };
    anchors[BUS_NODE_ID] = busAnchorBetweenRows(anchors, SRC, LOAD)!;
    const segs = gatewaySegments(model, anchors, { axis: 'y' });
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) expect(s.cross).toBeCloseTo(centroid.left, 6);
  });
});

describe('RafCoalescer — coalesce a reflow burst into one fire', () => {
  /** A controllable fake rAF: queue callbacks; `flush()` fires them. */
  function fakeRaf() {
    const queue = new Map<number, () => void>();
    let id = 0;
    return {
      raf: (cb: () => void): number => {
        id += 1;
        queue.set(id, cb);
        return id;
      },
      caf: (handle: number): void => {
        queue.delete(handle);
      },
      flush(): void {
        const fns = [...queue.values()];
        queue.clear();
        for (const fn of fns) fn();
      },
      get size() {
        return queue.size;
      },
    };
  }

  test('N schedule calls in a frame produce exactly ONE callback', () => {
    const f = fakeRaf();
    const c = new RafCoalescer(f.raf, f.caf);
    let calls = 0;
    c.schedule(() => (calls += 1));
    c.schedule(() => (calls += 1));
    c.schedule(() => (calls += 1));
    expect(f.size).toBe(1); // only one rAF handle pending
    expect(c.pending).toBe(true);
    f.flush();
    expect(calls).toBe(1);
    expect(c.pending).toBe(false);
  });

  test('cancel prevents the pending fire', () => {
    const f = fakeRaf();
    const c = new RafCoalescer(f.raf, f.caf);
    let calls = 0;
    c.schedule(() => (calls += 1));
    expect(c.pending).toBe(true);
    c.cancel();
    expect(c.pending).toBe(false);
    f.flush();
    expect(calls).toBe(0);
  });

  test('re-arms after a fire (a later reflow schedules again)', () => {
    const f = fakeRaf();
    const c = new RafCoalescer(f.raf, f.caf);
    let calls = 0;
    c.schedule(() => (calls += 1));
    f.flush();
    expect(calls).toBe(1);
    c.schedule(() => (calls += 1)); // a new burst
    f.flush();
    expect(calls).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 6.6 — the Gateway running-net derivation (Task 1, the #1 test target).
// PURE: a FlowModel + synthetic relativized anchors in, a plain segment array out
// (no DOM). Every segment net is cross-checked against the ONE balance authority
// (computeBalance.net) — never a second sign convention.
// ═══════════════════════════════════════════════════════════════════════════
describe('busAxis — the trunk runs along the wider anchor spread (Task 5)', () => {
  test('a wide horizontal spread ⇒ x', () => {
    expect(busAxis({ a: r(0, 0), b: r(400, 5) })).toBe('x');
  });
  test('a tall vertical spread ⇒ y (the phone reflow)', () => {
    expect(busAxis({ a: r(0, 0), b: r(5, 400) })).toBe('y');
  });
  test('fewer than two anchors defaults to x', () => {
    expect(busAxis({ a: r(0, 0) })).toBe('x');
    expect(busAxis({})).toBe('x');
  });
});

describe('gatewaySegments — running net = Σ(+source/−load), sourced from balance.net', () => {
  test('per-segment net is the running sum of net[role], cross-checked against computeBalance', () => {
    // grid import: grid +2 (source/inject), home −2 (load/draw).
    const model = fixtureModel(gridImport);
    const net = computeBalance(model).net;
    const anchors = { grid: r(0, 0), home: r(200, 0) };
    const segs = gatewaySegments(model, anchors, { axis: 'x' });
    // taps L→R: grid(+2) then home(−2). Running: +2, then 0.
    expect(segs).toHaveLength(2);
    expect(segs[0].net).toBeCloseTo(net['grid'], 6); // +2
    expect(segs[1].net).toBeCloseTo(net['grid'] + net['home'], 6); // 0
  });

  test('sign sets direction; magnitude sets width=min(W_max, edgeVisual.width) and dur=edgeVisual.durSec', () => {
    const model = modelOf([measured('grid', 3), measured('home', 3)]); // grid +3, home −3
    const segs = gatewaySegments(model, { grid: r(0, 0), home: r(200, 0) }, { axis: 'x' });
    const ev = edgeVisual(3);
    expect(segs[0].net).toBeCloseTo(3, 6);
    expect(segs[0].direction).toBe('forward'); // +net ⇒ toward increasing position
    expect(segs[0].width).toBeCloseTo(Math.min(BUS_WIDTH_MAX, ev.width), 6);
    expect(segs[0].durSec).toBeCloseTo(ev.durSec, 6);
  });

  test('the W_max ceiling actually clamps a very-high-kW segment; the dur floor holds', () => {
    const model = modelOf([measured('grid', 30), measured('home', 30)]); // net +30 crossing seg 0
    const segs = gatewaySegments(model, { grid: r(0, 0), home: r(200, 0) }, { axis: 'x' });
    expect(segs[0].net).toBeCloseTo(30, 6);
    expect(edgeVisual(30).width).toBeGreaterThan(BUS_WIDTH_MAX); // unclamped would overflow
    expect(segs[0].width).toBe(BUS_WIDTH_MAX); // ceiling clamps
    expect(segs[0].durSec).toBe(0.5); // floor (max(0.5, …)) holds at high kW
  });

  test('a sub-deadband segment is a DEAD rail — calm, no motion (a balanced cut)', () => {
    const model = fixtureModel(gridImport);
    const segs = gatewaySegments(model, { grid: r(0, 0), home: r(200, 0) }, { axis: 'x' });
    const last = segs[segs.length - 1];
    expect(Math.abs(last.net)).toBeLessThan(IDLE_KW); // running net ~0 after the last tap
    expect(last.active).toBe(false);
    expect(last.direction).toBe('none');
  });

  test('arrows CONVERGE on a load fed from both sides (the running net flips sign across it)', () => {
    // source A(+2) · load(−5) · source B(+3): running +2 (→load), then −3 (←load).
    const model = modelOf([measured('grid', 2), measured('home', 5), measured('solar', 3)]);
    const anchors = { grid: r(0, 0), home: r(200, 0), solar: r(400, 0) };
    const segs = gatewaySegments(model, anchors, { axis: 'x' });
    expect(segs[0].direction).toBe('forward'); // grid → home : points right, AT home
    expect(segs[1].direction).toBe('reverse'); // solar-side → home : points left, AT home
    expect(segs[0].to).toBe(250); // the home tap centre (200 + 100/2)
    expect(segs[1].from).toBe(250); // both segments meet at the home tap → converge
  });

  test('no anchors ⇒ no segments (empty)', () => {
    expect(gatewaySegments(fixtureModel(gridImport), {}, { axis: 'x' })).toEqual([]);
  });

  test('the running net is geometry-agnostic — vertical axis walks taps top→bottom identically', () => {
    const model = fixtureModel(gridImport);
    const net = computeBalance(model).net;
    const segs = gatewaySegments(model, { grid: r(0, 0), home: r(0, 200) }, { axis: 'y' });
    expect(segs[0].net).toBeCloseTo(net['grid'], 6);
    expect(segs[1].net).toBeCloseTo(0, 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.3 — the bus follows GEOMETRY, not model order (reorder-invariance).
//
// AC1/AC2's load-bearing claim: `energy.nodes.order` reorders the rendered CELLS,
// which moves their DOM anchors, and the Gateway bus follows because `gatewaySegments`
// taps sort by SPATIAL position — never by `SCENE_NODES`/model order. The element
// suite (`components/my-home.test.ts`) pins the cell SEQUENCE and the e2e proves the
// taps walk the reordered spatial order at live geometry; this is the PURE, deterministic
// proof of the engine guarantee underneath: feed the SAME model with anchors in a
// reordered spatial order and the walk (and any both-sides-fed convergence) tracks the
// anchors, not the registry order — with the running-sum balance unchanged node-for-node.
// `gatewaySegments` itself is NOT edited by 9.3; this proves it already reorders for free.
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 9.3 — gatewaySegments walks by anchor geometry, not model/SCENE_NODES order', () => {
  test('AC1/AC2 — same model, anchors REORDERED ⇒ the tap walk follows the anchors (not the model order)', () => {
    // Model order (buildFlowModel ⇒ ENERGY_ROLES): solar, grid, home. Distinct nets so
    // the FIRST segment alone distinguishes a geometry walk from a model-order walk.
    const model = modelOf([measured('solar', 3), measured('grid', 2), measured('home', 5)]);
    const net = computeBalance(model).net; // solar +3, grid +2, home −5
    // Anchors place GRID leftmost — the opposite of the model's solar-first order.
    const segs = gatewaySegments(model, { grid: r(0, 0), solar: r(200, 0), home: r(400, 0) }, { axis: 'x' });
    // Taps emitted strictly left→right by anchor centre (50, 250, 450) — the spatial sort.
    expect(segs.map((s) => s.from)).toEqual([50, 250, 450]);
    // The leftmost segment's running net is GRID's (+2), proving the walk read the anchor
    // x, not the model's solar-first order (which would give +3 here). Then +5, then 0.
    expect(segs[0].net).toBeCloseTo(net['grid'], 6); // +2 (geometry), not +3 (model order)
    expect(segs[1].net).toBeCloseTo(net['grid'] + net['solar'], 6); // +5
    expect(segs[2].net).toBeCloseTo(0, 6); // balanced tail
  });

  test('AC2 — a both-sides-fed load CONVERGES at its tap regardless of which flanking source is left vs right', () => {
    // grid +2, solar +3, home −5: home is fed from both sides, so the running net flips
    // sign across its tap ⇒ the adjacent segments converge ON home. Swapping the two
    // SOURCE anchors left↔right must NOT move (or flip) that convergence — it is a
    // geometry-faithful Kirchhoff read, invariant to the source reorder (AC2: reorder
    // never flips a sign). Home is held at the middle position in both layouts.
    const model = modelOf([measured('grid', 2), measured('solar', 3), measured('home', 5)]);
    const homeTap = 250; // 200 + 100/2 — the middle anchor's centre in both layouts

    // Layout A: grid · home · solar.
    const a = gatewaySegments(model, { grid: r(0, 0), home: r(200, 0), solar: r(400, 0) }, { axis: 'x' });
    expect(a[0].direction).toBe('forward'); // left source → home : points right, AT home
    expect(a[0].to).toBe(homeTap);
    expect(a[1].direction).toBe('reverse'); // right source → home : points left, AT home
    expect(a[1].from).toBe(homeTap);

    // Layout B: the two sources SWAPPED (solar · home · grid). The convergence is identical.
    const b = gatewaySegments(model, { solar: r(0, 0), home: r(200, 0), grid: r(400, 0) }, { axis: 'x' });
    expect(b[0].direction).toBe('forward'); // converges from the left, still AT home
    expect(b[0].to).toBe(homeTap);
    expect(b[1].direction).toBe('reverse'); // converges from the right, still AT home
    expect(b[1].from).toBe(homeTap);

    // The whole-home balance is invariant to the reorder — the tail closes at 0 either way.
    expect(a[a.length - 1].net).toBeCloseTo(0, 6);
    expect(b[b.length - 1].net).toBeCloseTo(0, 6);
  });
});

describe('sceneAggregates — ribbon totals derived from the ONE balance net', () => {
  test('grid import: generation/consumption sum the sources/loads; net is the grid term', () => {
    const agg = sceneAggregates(fixtureModel(gridImport));
    expect(agg.generation).toBeCloseTo(2, 6); // grid inject
    expect(agg.consumption).toBeCloseTo(2, 6); // home draw
    expect(agg.gridPresent).toBe(true);
    expect(agg.gridNet).toBeCloseTo(2, 6); // + = importing
  });

  test('islanding: grid absent ⇒ self-supplied (gridNet 0); Powerwall sources, home draws', () => {
    const agg = sceneAggregates(fixtureModel(islanding));
    expect(agg.gridPresent).toBe(false);
    expect(agg.gridNet).toBe(0);
    expect(agg.generation).toBeCloseTo(2, 6);
    expect(agg.consumption).toBeCloseTo(2, 6);
  });

  test('Story 9.7 — generation sums ACROSS a role’s instances (by id), so self-powered counts both arrays (AC6)', () => {
    const model = buildFlowModel([
      { role: 'solar', id: 'solar:1', kW: 2.0, provenance: 'measured' },
      { role: 'solar', id: 'solar:2', kW: 1.2, provenance: 'measured' },
      { role: 'home', kW: 3.2, provenance: 'measured' },
    ]);
    const agg = sceneAggregates(model);
    // BOTH arrays feed generation (3.2 total) — a role-keyed read (net['solar'] is
    // undefined under per-instance ids) would silently under-count to 0.
    expect(agg.generation).toBeCloseTo(3.2, 6);
    expect(agg.consumption).toBeCloseTo(3.2, 6);
    // No grid ⇒ fully self-powered, both arrays counted.
    expect(selfPowered(model).pct).toBe(100);
  });
});

describe('coupledRoles — shared-bus focus coupling, computed not hard-coded (Task 4)', () => {
  test('focusing a SOURCE lights all present loads + itself', () => {
    const model = fixtureModel(charging); // sources: solar/grid; loads: home/wall_connector
    const lit = coupledRoles(model, 'solar');
    expect(lit.has('solar')).toBe(true); // itself
    expect(lit.has('home')).toBe(true);
    expect(lit.has('wall_connector')).toBe(true);
    expect(lit.has('grid')).toBe(false); // another source — not coupled
  });

  test('focusing a LOAD lights all present sources + itself', () => {
    const model = fixtureModel(charging);
    const lit = coupledRoles(model, 'home');
    expect(lit.has('home')).toBe(true);
    expect(lit.has('solar')).toBe(true);
    expect(lit.has('grid')).toBe(true);
    expect(lit.has('wall_connector')).toBe(false); // another load — not coupled
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 6.7 — arbitrary-topology tolerance (minimal → full), the #1 new gate.
//
// "Free by construction" (DESIGN.md:362): every subset from minimal Grid+Home to
// the full five renders correctly with ONE render path — no baked subset matrix,
// no ghost hardware. The model layer ALREADY delivers present-gating; this sweep
// PROVES it exhaustively + cross-checks the bus running net against the ONE balance
// authority for each topology. (The packing + axis are the element/CSS half; here
// we pin the pure hub that drives them.)
// ═══════════════════════════════════════════════════════════════════════════

/** Build a FULL five-role model from a partial present map (absent roles → present:false, no edge). */
const absent = (role: EnergyRole): FlowInput => ({ role, kW: undefined, provenance: 'measured' });
function topology(present: Partial<Record<EnergyRole, number>>): FlowModel {
  return buildFlowModel(
    ENERGY_ROLES.map((role) => (role in present ? measured(role, present[role] as number) : absent(role)))
  );
}
/** Lay the present roles out along an axis at distinct positions (synthetic anchors — the hub is pure). */
function anchorsFor(roles: readonly EnergyRole[], axis: 'x' | 'y' = 'x'): Record<string, RectLike> {
  const out: Record<string, RectLike> = {};
  roles.forEach((role, i) => {
    out[role] = axis === 'x' ? r(i * 200, 0) : r(0, i * 200);
  });
  return out;
}

// Canonical readings per role: grid + = import (source), home + = load, solar + =
// produce (source), powerwall + = charging so a DISCHARGE (source) is negative,
// wall_connector + = charging draw (load). buildFlowModel applies BUS_ORIENTATION,
// so net[] signs come out +source / −load — but we ALWAYS cross-check against
// computeBalance, never re-derive a sign here.
const SUBSETS: ReadonlyArray<{ name: string; present: Partial<Record<EnergyRole, number>> }> = [
  { name: 'minimal Grid+Home', present: { grid: 2, home: 2 } },
  { name: 'Grid+Home+Solar', present: { solar: 3, grid: 1, home: 4 } },
  { name: 'Powerwall+Home (islanding shape)', present: { powerwall: -2, home: 2 } },
  { name: 'Solar+Powerwall+Grid+Home', present: { solar: 3, powerwall: -1, grid: 1, home: 5 } },
  { name: 'full five', present: { solar: 4, powerwall: -1, grid: 1, home: 4, wall_connector: 2 } },
];

describe('topology sweep — present-gating holds from minimal Grid+Home to the full five (AC1)', () => {
  for (const { name, present } of SUBSETS) {
    const presentRoles = ENERGY_ROLES.filter((role) => role in present);

    test(`${name}: model present-gates exactly the subset (absent ⇒ present:false, no edge)`, () => {
      const model = topology(present);
      // Every role is a node; exactly the subset is present.
      expect(model.nodes.map((n) => n.role)).toEqual([...ENERGY_ROLES]);
      expect(model.nodes.filter((n) => n.present).map((n) => n.role)).toEqual(presentRoles);
      // An absent node carries NO edge (no phantom zero-kW term).
      for (const node of model.nodes) {
        const edge = model.edges.find((e) => e.from === node.role);
        if (node.present) expect(edge).toBeTruthy();
        else expect(edge).toBeUndefined();
      }
      // sceneAggregates only sums present nodes; an absent grid ⇒ self-supplied.
      const agg = sceneAggregates(model);
      expect(agg.gridPresent).toBe('grid' in present);
      if (!('grid' in present)) expect(agg.gridNet).toBe(0);
    });

    test(`${name}: gatewaySegments walks ONLY present taps; per-segment net = running Σ balance.net (AC1/AC2)`, () => {
      const model = topology(present);
      const net = computeBalance(model).net;
      const anchors = anchorsFor(presentRoles, 'x');
      const segs = gatewaySegments(model, anchors, { axis: 'x' });
      // (a) one segment per present tap — never a segment for an absent node.
      expect(segs).toHaveLength(presentRoles.length);
      // (b) each segment net = the running sum of the present taps' net[role] L→R.
      let run = 0;
      presentRoles.forEach((role, i) => {
        run += net[role];
        expect(segs[i].net).toBeCloseTo(run, 6);
        expect(Number.isFinite(segs[i].net)).toBe(true);
      });
      // (d) a sub-IDLE_KW running net is a dead/calm segment (the balanced tail).
      const last = segs[segs.length - 1];
      if (Math.abs(last.net) < IDLE_KW) {
        expect(last.active).toBe(false);
        expect(last.direction).toBe('none');
      }
    });
  }

  test('(c) islanding reroute: Powerwall sources, Home draws — the single active Powerwall→Home segment', () => {
    // The canonical reroute proof (EXPERIENCE.md:152): grid absent, Powerwall left
    // of Home → the running net is +2 across the only inter-tap segment (forward,
    // Powerwall→Home), then 0 on the balanced tail.
    const model = topology({ powerwall: -2, home: 2 });
    const segs = gatewaySegments(model, { powerwall: r(0, 0), home: r(200, 0) }, { axis: 'x' });
    expect(segs).toHaveLength(2);
    expect(segs[0].direction).toBe('forward'); // Powerwall → Home
    expect(segs[0].net).toBeCloseTo(2, 6);
    expect(segs[1].active).toBe(false); // balanced tail — dead rail
  });

  test('the running net is geometry-agnostic across the full sweep (x and y walks agree)', () => {
    for (const { present } of SUBSETS) {
      const presentRoles = ENERGY_ROLES.filter((role) => role in present);
      const model = topology(present);
      const xs = gatewaySegments(model, anchorsFor(presentRoles, 'x'), { axis: 'x' }).map((s) => s.net);
      const ys = gatewaySegments(model, anchorsFor(presentRoles, 'y'), { axis: 'y' }).map((s) => s.net);
      ys.forEach((n, i) => expect(n).toBeCloseTo(xs[i], 6));
    }
  });
});

describe('axisForWidth — the trunk axis follows the LAYOUT BREAKPOINT, not the raw spread (Task 2, AC2)', () => {
  test('a wide desktop container ⇒ horizontal x (even at the minimal 2-node topology)', () => {
    expect(axisForWidth(1100)).toBe('x');
    expect(axisForWidth(760)).toBe('x');
    expect(axisForWidth(SCENE_PHONE_MAX + 1)).toBe('x'); // just above the breakpoint
  });
  test('the ≤540px phone container ⇒ vertical y (the single-column reflow)', () => {
    expect(axisForWidth(540)).toBe('y');
    expect(axisForWidth(460)).toBe('y');
    expect(axisForWidth(SCENE_PHONE_MAX)).toBe('y'); // inclusive at the breakpoint
  });
  test('the breakpoint is the documented 540px (the ONE TS mirror of the CSS @media)', () => {
    expect(SCENE_PHONE_MAX).toBe(540);
  });
  test('it does NOT consult the anchor spread — a near-degenerate packed minimal Scene stays horizontal', () => {
    // The exact bug Task 2 fixes: a packed Grid+Home stacks both cards at ~the same
    // x, so the spread-based busAxis would return 'y' (vertical desktop trunk) —
    // axisForWidth(wide) overrides that to 'x'. Both helpers still coexist (busAxis
    // is the spread fallback for the geometry math, kept + tested above).
    const stacked = { grid: r(100, 0), home: r(100, 400) };
    expect(busAxis(stacked)).toBe('y'); // spread says vertical (the trap)…
    expect(axisForWidth(1100)).toBe('x'); // …the breakpoint keeps the desktop horizontal
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 6.7 — half-alive = NORMAL (AC3): live local energy + an asleep/quiescent
// read is the calm steady state, never an error. Quiescent edges are present-and-
// calm (direction:'none'); the live half is NOT zeroed; the running net stays
// finite (no NaN, no throw) on a mixed / empty / single-node model.
// ═══════════════════════════════════════════════════════════════════════════
describe('half-alive model — mixed measured + quiescent reads stay calm (AC3)', () => {
  const quiescent = (role: EnergyRole, kW: number): FlowInput => ({ role, kW, provenance: 'quiescent' });

  test('quiescent edges read direction:none (present, calm); the live edges keep their measured sense', () => {
    // The asleep-car-no-session case: wall_connector quiescent while the energy
    // nodes read fresh. senseOf maps quiescent → 'none' (a present, dead leg).
    const model = buildFlowModel([
      measured('solar', 3),
      measured('grid', 1),
      measured('home', 4),
      quiescent('wall_connector', 0.5),
      absent('powerwall'),
    ]);
    const edgeOf = (role: EnergyRole) => model.edges.find((e) => e.from === role)!;
    expect(edgeOf('wall_connector').provenance).toBe('quiescent');
    expect(edgeOf('wall_connector').direction).toBe('none'); // calm, no motion
    expect(edgeOf('solar').direction).toBe('forward'); // a live source still flows
    expect(edgeOf('home').direction).toBe('reverse'); // a live load still draws
  });

  test('the live half is NOT zeroed by the quiescent node; the running net stays finite', () => {
    const model = buildFlowModel([
      measured('solar', 3),
      measured('grid', 1),
      measured('home', 4),
      quiescent('wall_connector', 0.5),
      absent('powerwall'),
    ]);
    const agg = sceneAggregates(model);
    expect(agg.generation).toBeCloseTo(4, 6); // live sources solar(+3)+grid(+1) — not zeroed
    expect(Number.isFinite(agg.consumption)).toBe(true);
    const segs = gatewaySegments(model, anchorsFor(['solar', 'grid', 'home', 'wall_connector']), { axis: 'x' });
    expect(segs.every((s) => Number.isFinite(s.net))).toBe(true); // no NaN
  });

  test('an empty model and a single-node model produce no throw and a valid (possibly empty) net', () => {
    const empty: FlowModel = { nodes: [], edges: [] };
    expect(() => gatewaySegments(empty, {}, { axis: 'x' })).not.toThrow();
    expect(gatewaySegments(empty, {}, { axis: 'x' })).toEqual([]);
    expect(sceneAggregates(empty)).toEqual({ generation: 0, consumption: 0, gridNet: 0, gridPresent: false });

    const single = topology({ home: 2 });
    const segs = gatewaySegments(single, anchorsFor(['home']), { axis: 'x' });
    expect(() => gatewaySegments(single, anchorsFor(['home']), { axis: 'x' })).not.toThrow();
    expect(segs).toHaveLength(1); // the lone tap's trailing segment
    expect(Number.isFinite(segs[0].net)).toBe(true);
  });

  test('a FULLY-quiescent model: every edge is calm (direction:none), nothing animates', () => {
    const model = buildFlowModel([
      quiescent('solar', 3),
      quiescent('grid', 1),
      quiescent('home', 4),
      absent('powerwall'),
      absent('wall_connector'),
    ]);
    expect(model.edges.length).toBeGreaterThan(0);
    expect(model.edges.every((e) => e.provenance === 'quiescent')).toBe(true);
    expect(model.edges.every((e) => e.direction === 'none')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.5 — the vehicle node: the WC→Vehicle agreement view + the anchor
// exclusion. wcVehicleEdge is the SINGLE source the cell badge + the overlay edge
// consume, so they agree by construction (AC2); the vehicle anchor must NOT move
// the trunk junction / axis (AC4 — it is a presentation cell, not a bus tap).
// ═══════════════════════════════════════════════════════════════════════════
describe('wcVehicleEdge — the WC edge IS the car-charging edge (AC2 agree-by-construction)', () => {
  test('a charging WC ⇒ active, magnitude = |WC edge kW| (never re-signed), direction carried', () => {
    // wall_connector + = charging draw; buildFlowModel applies BUS_ORIENTATION(−1),
    // so the WC edge kW is NEGATIVE (drawing from the bus to feed the car).
    const model = modelOf([measured('wall_connector', 7.4)]);
    const wcEdge = model.edges.find((e) => e.from === 'wall_connector')!;
    expect(wcEdge.kW).toBeLessThan(0); // charging WC draws from the bus
    const ch = wcVehicleEdge(model);
    expect(ch.active).toBe(true);
    expect(ch.direction).toBe(wcEdge.direction); // carried, never re-derived
    // The #1 agreement assertion: the cell's shown magnitude == |the WC edge kW|.
    expect(ch.kW).toBeCloseTo(Math.abs(wcEdge.kW), 6);
    expect(ch.kW).toBeCloseTo(7.4, 6);
  });

  test('charging fixture: agreement holds through the production binding path', () => {
    const model = fixtureModel(charging);
    const wcEdge = model.edges.find((e) => e.from === 'wall_connector')!;
    const ch = wcVehicleEdge(model);
    expect(ch.active).toBe(true);
    expect(ch.kW).toBeCloseTo(Math.abs(wcEdge.kW), 6);
  });

  test('an idle (sub-deadband) WC ⇒ inactive, kW 0 — never a false charge', () => {
    const ch = wcVehicleEdge(modelOf([measured('wall_connector', 0)]));
    expect(ch).toEqual({ active: false, kW: 0, direction: 'none' });
  });

  test('an absent WC (no edge) ⇒ inactive, kW 0', () => {
    expect(wcVehicleEdge(modelOf([absent('wall_connector')]))).toEqual({
      active: false,
      kW: 0,
      direction: 'none',
    });
    expect(wcVehicleEdge({ nodes: [], edges: [] })).toEqual({ active: false, kW: 0, direction: 'none' });
  });

  test('Story 9.7 multi-WC: prefers the CHARGING WC edge over an idle sibling (no first-WC mask)', () => {
    // Two Wall Connectors, the FIRST idle and the SECOND charging the (single) car.
    // The car edge must follow the charging WC — a first-but-idle WC must not read
    // "not charging" while the second feeds the car (a halo-vs-edge mismatch).
    const model = modelOf([
      { role: 'wall_connector', id: 'wall_connector:1', kW: 0, provenance: 'measured' }, // idle
      { role: 'wall_connector', id: 'wall_connector:2', kW: 7.4, provenance: 'measured' }, // charging
    ]);
    const ch = wcVehicleEdge(model);
    expect(ch.active).toBe(true);
    expect(ch.kW).toBeCloseTo(7.4, 6);
    expect(ch.direction).not.toBe('none');
  });
});

describe('wcVehicleEdgeFor / wcEdgeForVehicle — per-car positional WC pairing (Story 9.8, Task 5)', () => {
  // Two WCs feeding two cars: WC:1 idle, WC:2 charging. Positional pairing means car #0
  // reads WC:1 (idle) and car #1 reads WC:2 (charging) — NOT "the charging one for both".
  const twoWc = (): FlowModel =>
    modelOf([
      { role: 'wall_connector', id: 'wall_connector:1', kW: 0, provenance: 'measured' }, // idle
      { role: 'wall_connector', id: 'wall_connector:2', kW: 7.4, provenance: 'measured' }, // charging
    ]);

  test('2 WC + 2 cars: car i reads WC i (positional), NOT the shared active-preferred read', () => {
    const model = twoWc();
    expect(wcVehicleEdgeFor(model, 0, 2).active).toBe(false); // car #0 ↔ WC:1 (idle)
    const car1 = wcVehicleEdgeFor(model, 1, 2); // car #1 ↔ WC:2 (charging)
    expect(car1.active).toBe(true);
    expect(car1.kW).toBeCloseTo(7.4, 6);
    // The returned edge's `from` IS the paired WC node id (so the anchor follows it).
    expect(wcEdgeForVehicle(model, 0, 2)?.from).toBe('wall_connector:1');
    expect(wcEdgeForVehicle(model, 1, 2)?.from).toBe('wall_connector:2');
  });

  test('1 WC + 2 cars: BOTH cars fall back to the single shared WC (counts differ)', () => {
    const model = modelOf([measured('wall_connector', 7.4)]); // one WC, charging
    expect(wcEdgeForVehicle(model, 0, 2)?.from).toBe('wall_connector');
    expect(wcEdgeForVehicle(model, 1, 2)?.from).toBe('wall_connector');
    expect(wcVehicleEdgeFor(model, 0, 2).kW).toBeCloseTo(7.4, 6);
    expect(wcVehicleEdgeFor(model, 1, 2).kW).toBeCloseTo(7.4, 6);
  });

  test('single-car/single-WC is a zero-diff: wcVehicleEdge === wcVehicleEdgeFor(_,0,1)', () => {
    const model = modelOf([measured('wall_connector', 7.4)]);
    expect(wcVehicleEdge(model)).toEqual(wcVehicleEdgeFor(model, 0, 1));
    // …and 2 WC + 1 car keeps the 9.7 "prefer the charging WC" fallback.
    expect(wcVehicleEdgeFor(twoWc(), 0, 1).kW).toBeCloseTo(7.4, 6);
  });
});

describe('VEHICLE_NODE_ID is excluded from the trunk junction & axis math (Task 2, AC4)', () => {
  const base = { grid: r(0, 0), home: r(200, 0), wall_connector: r(400, 0) };
  // A vehicle anchor placed far off the tap line — if it leaked into the centroid
  // or the spread it would visibly move the junction / could flip the axis.
  const withVehicle = { ...base, [VEHICLE_NODE_ID]: r(600, 500) };

  test('deriveBusAnchor is identical with vs without a present vehicle anchor', () => {
    expect(deriveBusAnchor(withVehicle)).toEqual(deriveBusAnchor(base));
  });

  test('busAxis is identical with vs without a present vehicle anchor', () => {
    expect(busAxis(withVehicle)).toBe(busAxis(base));
  });

  test('the off-axis vehicle anchor does NOT flip the axis (would, if counted)', () => {
    // Taps spread wide on x ⇒ axis x. A vehicle anchor with a huge y would pull the
    // y-spread above the x-spread if (wrongly) counted — it must not.
    const taps = { grid: r(0, 0), home: r(400, 0) };
    const withTallVehicle = { ...taps, [VEHICLE_NODE_ID]: r(0, 5000) };
    expect(busAxis(taps)).toBe('x');
    expect(busAxis(withTallVehicle)).toBe('x'); // unchanged — vehicle excluded
  });
});

describe('EVERY vehicle:n anchor is excluded from the trunk junction & axis math (Story 9.8, Task 2)', () => {
  // Story 9.8: a DUPLICATED car gets a `vehicle:1`/`vehicle:2` anchor. The two filters
  // generalize from the bare-id equality `k !== VEHICLE_NODE_ID` to the ROLE test
  // `roleOfInstance(k) !== 'vehicle'`, so a 2nd car never leaks into the centroid / axis
  // (the bug class 9.7 fixed for the `abs[role]` collision). The :n suffix appears only
  // for genuine duplicates, so single-vehicle output is byte-identical (covered above).
  const base = { grid: r(0, 0), home: r(200, 0), wall_connector: r(400, 0) };
  // Two cars placed far off the tap line — if EITHER leaked it would move the junction.
  const withTwoCars = { ...base, 'vehicle:1': r(600, 500), 'vehicle:2': r(800, 700) };

  test('roleOfInstance recovers `vehicle` from a duplicated car id', () => {
    expect(roleOfInstance('vehicle')).toBe('vehicle');
    expect(roleOfInstance('vehicle:1')).toBe('vehicle');
    expect(roleOfInstance('vehicle:2')).toBe('vehicle');
  });

  test('deriveBusAnchor is identical with vs without TWO present vehicle anchors', () => {
    expect(deriveBusAnchor(withTwoCars)).toEqual(deriveBusAnchor(base));
  });

  test('busAxis is identical with vs without TWO present vehicle anchors', () => {
    // Both cars carry a huge off-axis spread — neither may flip the axis.
    const taps = { grid: r(0, 0), home: r(400, 0) };
    const withTallCars = { ...taps, 'vehicle:1': r(0, 5000), 'vehicle:2': r(0, 9000) };
    expect(busAxis(taps)).toBe('x');
    expect(busAxis(withTallCars)).toBe('x');
  });

  test('busAnchorBetweenRows ignores both cars (gap line driven by the taps only)', () => {
    const twoRowTwoCars = {
      grid: r(0, 0, 100, 80),
      home: r(0, 300, 100, 80),
      wall_connector: r(150, 300, 100, 80),
      'vehicle:1': r(300, 300, 100, 80),
      'vehicle:2': r(450, 300, 100, 80),
    };
    const noCars = { grid: r(0, 0, 100, 80), home: r(0, 300, 100, 80), wall_connector: r(150, 300, 100, 80) };
    const SRC = ['grid'];
    const LOAD = ['home', 'wall_connector'];
    // The gap line's `top` (the inter-row channel) must match the no-cars layout exactly;
    // the cars sit in the load row but are NOT bus taps, so they never enter the math.
    expect(busAnchorBetweenRows(twoRowTwoCars, SRC, LOAD)?.top).toBe(
      busAnchorBetweenRows(noCars, SRC, LOAD)?.top
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.7 — the self-powered % + per-node tiles: pure VIEWS of the ONE balance
// net (the #1 test target). No second engine, no re-signed net (FR-33 / AR-6).
// ═══════════════════════════════════════════════════════════════════════════
describe('selfPowered — the self-powered-now % (Story 8.7, AC1/AC2)', () => {
  // The mockup fixture (canonical NET): solar +3.0, battery discharge +4.6, grid
  // import +4.0 (all sources), home −4.2, car/WC −7.4 (loads) ⇒ consumption 11.6,
  // gridImport 4.0, selfKw 7.6, pct round(7.6/11.6×100) = 66%.
  const mockup = (): FlowModel =>
    modelOf([
      measured('solar', 3),
      measured('powerwall', -4.6), // discharge ⇒ net +4.6 (source)
      measured('grid', 4), // import ⇒ net +4.0
      measured('home', 4.2), // ⇒ net −4.2 (load)
      measured('wall_connector', 7.4), // ⇒ net −7.4 (load)
    ]);

  test('(a) grid-import: pct = round((consumption − gridImport)/consumption); selfKw + gridImport = totalKw', () => {
    const sp = selfPowered(mockup());
    expect(sp.totalKw).toBeCloseTo(11.6, 6);
    expect(sp.selfKw).toBeCloseTo(7.6, 6);
    expect(sp.pct).toBe(66);
    expect(sp.selfKw + 4).toBeCloseTo(sp.totalKw, 6); // gridImport 4.0 closes the books
  });

  test('(a) it is a VIEW of the SAME net sceneAggregates uses (one computeBalance, threaded)', () => {
    const model = mockup();
    const balance = computeBalance(model);
    const sp = selfPowered(model, balance);
    const agg = sceneAggregates(model, balance);
    expect(sp.totalKw).toBe(agg.consumption); // pure view — never a recomputed/second net
  });

  test('(b) grid EXPORT ⇒ no import covers load ⇒ pct 100 (honest, not fabricated)', () => {
    const model = modelOf([
      measured('solar', 8),
      measured('grid', -3), // exporting ⇒ net −3 (gridImport clamps to 0)
      measured('home', 5),
      absent('powerwall'),
      absent('wall_connector'),
    ]);
    expect(selfPowered(model).pct).toBe(100);
  });

  test('(b) ISLANDING (grid absent) ⇒ pct 100 (all load self-supplied)', () => {
    const model = modelOf([
      measured('powerwall', -4), // discharge ⇒ source
      measured('home', 4),
      absent('solar'),
      absent('grid'),
      absent('wall_connector'),
    ]);
    expect(selfPowered(model).pct).toBe(100);
  });

  test('(c) NO live load (sub-IDLE_KW consumption) ⇒ pct undefined — never a divide-by-zero 0/100', () => {
    const model = modelOf([
      measured('solar', 0.02),
      measured('home', 0.03),
      absent('powerwall'),
      absent('grid'),
      absent('wall_connector'),
    ]);
    const sp = selfPowered(model);
    expect(sp.pct).toBeUndefined();
    expect(sp.totalKw).toBeLessThanOrEqual(IDLE_KW);
  });

  test('(c) generation-only tick (a lone source, no load) ⇒ consumption 0 ⇒ pct undefined', () => {
    const model = modelOf([
      measured('solar', 5),
      absent('powerwall'),
      absent('grid'),
      absent('home'),
      absent('wall_connector'),
    ]);
    expect(selfPowered(model).pct).toBeUndefined();
  });

  test('(d) fully grid-supplied (load exists, all from grid import) ⇒ pct 0 — an HONEST 0, never undefined', () => {
    // The honesty boundary the `—` branch must NOT swallow: there IS a live load to
    // be a percentage of (so pct is DEFINED), but none of it is self-supplied ⇒ 0%.
    // Distinct from no-load (undefined) — confusing the two would either fabricate a
    // figure or hide a real one.
    const model = modelOf([
      measured('grid', 4), // import ⇒ net +4 (covers the whole load)
      measured('home', 4), // ⇒ net −4 (the only consumption)
      absent('solar'),
      absent('powerwall'),
      absent('wall_connector'),
    ]);
    const sp = selfPowered(model);
    expect(sp.pct).toBe(0); // defined 0 — NOT undefined
    expect(sp.selfKw).toBeCloseTo(0, 6);
    expect(sp.totalKw).toBeCloseTo(4, 6);
  });
});

describe('ribbonTiles — one tile per present node, canonical order, from the one net (Story 8.7, AC3)', () => {
  test('one entry per present node in SCENE_NODES order; kW = |net|, signed carries the grid sign', () => {
    const model = modelOf([
      measured('solar', 3),
      measured('grid', 4),
      measured('home', 4.2),
      measured('wall_connector', 7.4),
      absent('powerwall'),
    ]);
    const net = computeBalance(model).net;
    const tiles = ribbonTiles(model);
    // canonical SCENE_NODES order, powerwall absent ⇒ no tile.
    expect(tiles.map((t) => t.role)).toEqual(['solar', 'grid', 'home', 'wall_connector']);
    for (const t of tiles) {
      expect(t.signed).toBeCloseTo(net[t.role], 6);
      expect(t.kW).toBeCloseTo(Math.abs(net[t.role]), 6);
    }
    expect(tiles.find((t) => t.role === 'grid')!.signed).toBeGreaterThan(0); // import ⇒ +
  });

  test('all five present ⇒ five tiles in canonical source-then-load order (solar·powerwall·grid·home·wall_connector)', () => {
    const tiles = ribbonTiles(
      modelOf([
        // deliberately built out of order — the fn must impose SCENE_NODES order.
        measured('home', 4.2),
        measured('grid', 4),
        measured('wall_connector', 7.4),
        measured('solar', 3),
        measured('powerwall', -4.6),
      ])
    );
    expect(tiles.map((t) => t.role)).toEqual([
      'solar',
      'powerwall',
      'grid',
      'home',
      'wall_connector',
    ]);
  });

  test('present-gating: a minimal Grid+Home model yields exactly two tiles (no fabricated 0)', () => {
    const tiles = ribbonTiles(
      modelOf([
        measured('grid', 2),
        measured('home', 2),
        absent('solar'),
        absent('powerwall'),
        absent('wall_connector'),
      ])
    );
    expect(tiles.map((t) => t.role)).toEqual(['grid', 'home']);
  });

  test('uses the SAME balance net as the lead/bus (threaded balance, one computeBalance)', () => {
    const model = modelOf([
      measured('solar', 3),
      measured('grid', 1),
      measured('home', 4),
      absent('powerwall'),
      absent('wall_connector'),
    ]);
    const balance = computeBalance(model);
    const net = balance.net;
    for (const t of ribbonTiles(model, balance)) expect(t.signed).toBe(net[t.role]);
  });
});

describe('ribbonTiles — Story 9.7 FOLDS instances by role (INV-9, AC6)', () => {
  /** A FlowInput carrying an explicit instance id (a duplicated role). */
  const inst = (role: EnergyRole, id: string, kW: number): FlowInput => ({
    role,
    id,
    kW,
    provenance: 'measured',
  });

  test('two solar instances fold to ONE Solar tile whose value is the SUM (count 2)', () => {
    const model = modelOf([inst('solar', 'solar:1', 2.0), inst('solar', 'solar:2', 1.2), measured('home', 3.2)]);
    const tiles = ribbonTiles(model);
    const solar = tiles.filter((t) => t.role === 'solar');
    expect(solar).toHaveLength(1); // ONE folded tile, never one-per-instance
    expect(solar[0].kW).toBeCloseTo(3.2, 6); // 2.0 + 1.2 — never one array, never under-count
    expect(solar[0].count).toBe(2);
    // a single-instance load is unchanged (count 1).
    expect(tiles.find((t) => t.role === 'home')!.count).toBe(1);
  });

  test('the folded value reads from net BY ID — net[role] would be undefined (the "ribbon lies" failure it forbids)', () => {
    const model = modelOf([inst('solar', 'solar:1', 2.0), inst('solar', 'solar:2', 1.2), measured('home', 3.2)]);
    const net = computeBalance(model).net;
    // net is keyed by INSTANCE id; there is NO `net['solar']` — folding by role-key
    // would silently drop both arrays.
    expect(net['solar']).toBeUndefined();
    expect(ribbonTiles(model).find((t) => t.role === 'solar')!.signed).toBeCloseTo(
      (net['solar:1'] ?? 0) + (net['solar:2'] ?? 0),
      6,
    );
  });

  test('single-instance roles keep count 1 + signed = net[role] (zero-diff)', () => {
    const model = modelOf([measured('solar', 3), measured('home', 3)]);
    const net = computeBalance(model).net;
    for (const t of ribbonTiles(model)) {
      expect(t.count).toBe(1);
      expect(t.signed).toBeCloseTo(net[t.role], 6);
    }
  });

  // Story 9.8 (AC6) — the ribbon's "Car" tile IS the wall_connector tile, so TWO cars fed
  // by TWO WCs already aggregate through 9.7's same-role WC fold: no new vehicle tile, no
  // second engine. This PROVES the whole-home net does not under-report multiple cars.
  test('Story 9.8: two charging WCs (two cars) FOLD to ONE Car tile = the SUM, no under-report', () => {
    const model = modelOf([
      inst('wall_connector', 'wall_connector:1', 7.4), // car #1 drawing
      inst('wall_connector', 'wall_connector:2', 3.6), // car #2 drawing
      measured('home', 2.0),
    ]);
    const tiles = ribbonTiles(model);
    const car = tiles.filter((t) => t.role === 'wall_connector');
    expect(car).toHaveLength(1); // ONE "Car" tile (the WC tile), never one-per-car
    expect(car[0].kW).toBeCloseTo(11.0, 6); // 7.4 + 3.6 — BOTH cars counted (no under-report)
    expect(car[0].count).toBe(2);
    // No vehicle node ever enters the ribbon (the Vehicle is not a flow node / role).
    expect(tiles.some((t) => (t.role as string) === 'vehicle')).toBe(false);
  });
});
