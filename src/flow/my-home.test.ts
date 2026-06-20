import { describe, expect, test } from 'vitest';
import {
  SCENE_NODES,
  relativeAnchors,
  deriveBusAnchor,
  RafCoalescer,
  gatewaySegments,
  sceneAggregates,
  coupledRoles,
  busAxis,
  BUS_WIDTH_MAX,
} from './my-home';
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
