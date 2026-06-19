// Co-located proof for Story 4.5 — "the seven recognizable flow states" (FR-11,
// UX-DR20). These are DELIBERATE states (not edge cases): the card must read
// correctly across every real energy situation — outages and vampire drain
// included — not just the common daytime case. This is a VERIFICATION + FIXTURE
// suite: it adds NO production code, introduces NO second flow-math, no private
// sign flip, and no parallel edgeVisual formula (AC4 / R2 "consume the one
// constant, never a private copy"). Each state binds through the ONE production
// pipeline — `bindFlowModel` → `buildFlowModel` → `computeBalance` / `edgeVisuals`
// (Stories 4.1–4.3) — and is asserted against THAT output only.
//
// Environment 'node' (no DOM): the model assertions are pure data, and the
// renderer glanceability channel reads `HeroSvgRenderer.visuals` — a pure
// precompute (no mount). Hermetic: committed JSON fixtures + injected `now` from
// each fixture's `provenance.reference_now` (never `Date.now()`), zero network.
import { describe, expect, test } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from '../types';
import type { EnergyRole } from '../data/registry';
import { bindFlowModel, DEADBAND } from './binding';
import { computeBalance } from './balance';
import { HeroSvgRenderer } from './hero-svg';
import { NODE_COLOR, edgeVisual } from './renderer';
import type { Direction, FlowModel } from './model';

// The seven states, as committed fixtures (charging vs plugged-idle is one state
// slot, two fixtures — the contrast IS the deliverable). State 1 (zero/quiescent)
// REUSES the already-committed all-quiescent corpus `model-y-asleep.json` (stamps
// back-dated 50 min ⇒ every edge `quiescent`/`none` at its `reference_now`).
import asleep from '../fixtures/model-y-asleep.json';
import gridImport from '../fixtures/flow-grid-import.json';
import gridExport from '../fixtures/flow-grid-export.json';
import solarSurplus from '../fixtures/flow-solar-surplus.json';
import charging from '../fixtures/flow-charging.json';
import pluggedIdle from '../fixtures/flow-plugged-idle.json';
import islanding from '../fixtures/flow-islanding.json';
import vampire from '../fixtures/flow-vampire.json';

interface Fixture {
  provenance: { reference_now: string };
  states: Record<string, unknown>;
}

function makeHass(states: Record<string, unknown>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}

// Bind a fixture through the PRODUCTION path, injecting its own `reference_now` so
// freshly-stamped reads classify `fresh` (measured) and the back-dated asleep
// corpus classifies `quiescent` — hermetic, the `ASLEEP_NOW` pattern (4.1–4.4).
function modelOf(fx: Fixture): FlowModel {
  const now = Date.parse(fx.provenance.reference_now);
  return bindFlowModel(makeHass(fx.states), cfg(), { now });
}

function edgeOf(model: FlowModel, role: EnergyRole) {
  return model.edges.find((e) => e.from === role);
}
function nodeOf(model: FlowModel, role: EnergyRole) {
  return model.nodes.find((n) => n.role === role);
}

/** Per-role expectation: an edge with a direction + |kW|, optionally quiescent. */
interface RoleExpect {
  direction: Direction;
  kW: number;
  /** present-but-calm (provenance:'quiescent') — a deadband or stale read. */
  quiescent?: boolean;
}
interface StateSpec {
  name: string;
  fixture: Fixture;
  /** Present nodes → expected edge read. Roles omitted here must be ABSENT. */
  present: Partial<Record<EnergyRole, RoleExpect>>;
  /** Conservation expectation (the designed fixtures all conserve). */
  balanced: boolean;
}

const ALL_ROLES: EnergyRole[] = ['solar', 'grid', 'powerwall', 'home', 'wall_connector'];

// The exact fixture + assertion spec (Dev Notes "Seven-state design" table).
// |kW| magnitudes are `Math.abs(edge.kW)`; directions are the model's resolved
// `senseOf(orientation × canonical)`. Any role NOT in `present` is asserted ABSENT.
const STATES: StateSpec[] = [
  {
    // State 2 — grid import.
    name: 'grid import',
    fixture: gridImport,
    present: {
      grid: { direction: 'forward', kW: 2.0 },
      home: { direction: 'reverse', kW: 2.0 },
    },
    balanced: true,
  },
  {
    // State 3 — grid export.
    name: 'grid export',
    fixture: gridExport,
    present: {
      solar: { direction: 'forward', kW: 5.0 },
      grid: { direction: 'reverse', kW: 3.0 },
      home: { direction: 'reverse', kW: 2.0 },
    },
    balanced: true,
  },
  {
    // State 4 — solar surplus (charges Powerwall + feeds home; grid ~0 quiescent).
    name: 'solar surplus',
    fixture: solarSurplus,
    present: {
      solar: { direction: 'forward', kW: 6.0 },
      powerwall: { direction: 'reverse', kW: 3.0 },
      home: { direction: 'reverse', kW: 3.0 },
      grid: { direction: 'none', kW: 0.0, quiescent: true },
    },
    balanced: true,
  },
  {
    // State 5a — charging (wall_connector ACTIVE, drawing).
    name: 'charging',
    fixture: charging,
    present: {
      solar: { direction: 'forward', kW: 2.0 },
      grid: { direction: 'forward', kW: 6.0 },
      home: { direction: 'reverse', kW: 1.0 },
      wall_connector: { direction: 'reverse', kW: 7.0 },
    },
    balanced: true,
  },
  {
    // State 5b — plugged-idle (wall_connector PRESENT but quiescent).
    name: 'plugged-idle',
    fixture: pluggedIdle,
    present: {
      grid: { direction: 'forward', kW: 1.0 },
      home: { direction: 'reverse', kW: 1.0 },
      wall_connector: { direction: 'none', kW: 0.0, quiescent: true },
    },
    balanced: true,
  },
  {
    // State 6 — storm-watch / islanding (grid ABSENT, Powerwall islands).
    name: 'islanding',
    fixture: islanding,
    present: {
      powerwall: { direction: 'forward', kW: 2.0 },
      home: { direction: 'reverse', kW: 2.0 },
    },
    balanced: true,
  },
  {
    // State 7 — vampire drain (sub-1 kW but ABOVE deadband ⇒ measured/animated).
    name: 'vampire drain',
    fixture: vampire,
    present: {
      powerwall: { direction: 'forward', kW: 0.3 },
      home: { direction: 'reverse', kW: 0.3 },
      grid: { direction: 'none', kW: 0.0, quiescent: true },
    },
    balanced: true,
  },
];

// ───────────────────────────────────────────────────────────────────────────
// AC1 + AC3 — each state reads correctly in the FlowModel: presence + direction +
// magnitude for every present node, absence for every omitted node.
// ───────────────────────────────────────────────────────────────────────────
describe('the seven states — FlowModel reads correctly (AC1, AC3, AC4)', () => {
  for (const s of STATES) {
    test(`${s.name}: presence + direction + magnitude`, () => {
      const model = modelOf(s.fixture);
      const presentRoles = new Set(Object.keys(s.present) as EnergyRole[]);

      for (const role of ALL_ROLES) {
        const node = nodeOf(model, role);
        expect(node, `node ${role} exists in the 5-role model`).toBeDefined();

        if (presentRoles.has(role)) {
          const want = s.present[role] as RoleExpect;
          const edge = edgeOf(model, role);
          expect(node!.present, `${role} present`).toBe(true);
          expect(edge, `${role} has an edge`).toBeDefined();
          expect(edge!.direction, `${role} direction`).toBe(want.direction);
          expect(Math.abs(edge!.kW), `${role} |kW|`).toBeCloseTo(want.kW, 6);
          if (want.quiescent) {
            expect(edge!.provenance, `${role} quiescent`).toBe('quiescent');
          } else {
            expect(edge!.provenance, `${role} measured`).toBe('measured');
          }
        } else {
          // Absent node: present:false and NO edge (AC4 — never a phantom 0-kW edge).
          expect(node!.present, `${role} absent`).toBe(false);
          expect(edgeOf(model, role), `${role} has no edge`).toBeUndefined();
        }
      }
    });
  }

  test('state 1 — zero/quiescent (reuse asleep corpus): all present, all calm', () => {
    // Every present edge `quiescent`/`none` via FRESHNESS (stamps held 50 min) —
    // present-but-calm, never blank (AC1.1). Distinct mechanism from the deadband
    // path the surplus/vampire/plugged-idle fixtures exercise.
    const model = modelOf(asleep as Fixture);
    expect(model.edges.length).toBeGreaterThan(0);
    expect(model.edges.every((e) => e.provenance === 'quiescent')).toBe(true);
    expect(model.edges.every((e) => e.direction === 'none')).toBe(true);
    expect(model.nodes.every((n) => n.present)).toBe(true); // all five present
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — room-glanceable: distinguishable by colour + shape + motion ALONE. We
// read the renderer's DERIVED visuals (`active`/`direction`/`color`) — never the
// numeric labels — and prove the seven produce visibly different overlays.
// ───────────────────────────────────────────────────────────────────────────
describe('the seven states — room-glanceable via HeroSvgRenderer (AC2)', () => {
  /** The visual signature: present roles → (direction + active), from the renderer. */
  function signatureOf(fx: Fixture): string {
    const r = new HeroSvgRenderer();
    r.update(modelOf(fx));
    return [...r.visuals]
      .map((v) => `${v.role}:${v.direction}:${v.active ? 'motion' : 'calm'}`)
      .sort()
      .join('|');
  }

  const NAMED: Array<{ name: string; fx: Fixture }> = [
    { name: 'zero/quiescent', fx: asleep as Fixture },
    ...STATES.map((s) => ({ name: s.name, fx: s.fixture })),
  ];

  test('all eight fixtures (seven states) produce DISTINCT visual signatures', () => {
    const sigs = new Map<string, string>();
    for (const { name, fx } of NAMED) {
      const sig = signatureOf(fx);
      const clash = sigs.get(sig);
      expect(clash, `${name} signature "${sig}" must be unique (clashes with ${clash})`).toBeUndefined();
      sigs.set(sig, name);
    }
    expect(sigs.size).toBe(NAMED.length);
  });

  test('source colour follows the source node (NODE_COLOR), never re-derived', () => {
    // Spot-check the hue channel: a charging overlay carries solar=amber,
    // grid=neutral-dim, home=blue, wall_connector=teal — straight from NODE_COLOR.
    const r = new HeroSvgRenderer();
    r.update(modelOf(charging));
    for (const v of r.visuals) {
      expect(v.color).toBe(NODE_COLOR[v.role]);
    }
  });

  test('motion tracks magnitude+sign: active edges are exactly the non-quiescent ones', () => {
    // `active === (direction !== 'none')` is the motion channel; assert it lines up
    // with the model for a representative active state (charging).
    const model = modelOf(charging);
    const r = new HeroSvgRenderer();
    r.update(model);
    for (const v of r.visuals) {
      expect(v.active).toBe(v.direction !== 'none');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 headline — charging vs plugged-idle is the sharpest contrast: the SAME
// wall_connector node, the ONLY visual difference is that edge's active/direction.
// ───────────────────────────────────────────────────────────────────────────
describe('charging vs plugged-idle — the contrast IS the deliverable (AC2, FR-11)', () => {
  test('same wall_connector node present in both; only the wc edge differs', () => {
    const cModel = modelOf(charging);
    const pModel = modelOf(pluggedIdle);

    // Both have the wall_connector node PRESENT.
    expect(nodeOf(cModel, 'wall_connector')!.present).toBe(true);
    expect(nodeOf(pModel, 'wall_connector')!.present).toBe(true);

    const cWc = edgeOf(cModel, 'wall_connector')!;
    const pWc = edgeOf(pModel, 'wall_connector')!;

    // Charging: active, drawing (reverse), real magnitude.
    expect(cWc.direction).toBe('reverse');
    expect(cWc.provenance).toBe('measured');
    expect(Math.abs(cWc.kW)).toBeCloseTo(7.0, 6);

    // Plugged-idle: present but quiescent — no motion, no direction.
    expect(pWc.direction).toBe('none');
    expect(pWc.provenance).toBe('quiescent');

    // Render both: the wc visual is the discriminator.
    const cr = new HeroSvgRenderer();
    cr.update(cModel);
    const pr = new HeroSvgRenderer();
    pr.update(pModel);
    const cVis = [...cr.visuals].find((v) => v.role === 'wall_connector')!;
    const pVis = [...pr.visuals].find((v) => v.role === 'wall_connector')!;
    expect(cVis.active).toBe(true);
    expect(pVis.active).toBe(false);
    // Same source colour (same node) — only motion/direction tells them apart.
    expect(cVis.color).toBe(pVis.color);
    expect(cVis.color).toBe(NODE_COLOR.wall_connector);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 — conservation sanity REUSES the one balance authority (`computeBalance`),
// never a second balance computation. The designed fixtures all conserve.
// ───────────────────────────────────────────────────────────────────────────
describe('the seven states — conservation via the ONE balance authority (AC4)', () => {
  for (const s of STATES) {
    test(`${s.name}: bus balances within tolerance`, () => {
      const b = computeBalance(modelOf(s.fixture));
      expect(b.balanced).toBe(s.balanced);
      expect(b.residual).toBeCloseTo(0, 6);
    });
  }

  test('state 1 — zero/quiescent conserves (all calm; reuses the balanced asleep corpus)', () => {
    // NOTE (cross-fixture coupling): quiescent edges still carry their last-known
    // kW, so this is NOT a vacuous balance — it sums `model-y-asleep.json`'s real
    // energy readings, which that corpus is DESIGNED to conserve (sources
    // solar+powerwall-discharge+grid-import = sinks home+wc). This suite reuses a
    // fixture it does not own (per the story's "state 1 reuses asleep" decision);
    // an edit to that fixture's energy values that broke its balance would surface
    // HERE — which is the intended early-warning, not a brittle assertion.
    const b = computeBalance(modelOf(asleep as Fixture));
    expect(b.balanced).toBe(true);
    expect(b.residual).toBeCloseTo(0, 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QA gap-closure (Story 4.5 qa-generate-e2e-tests) — the suite above proves the
// hue + arrow-sense + motion-on/off channels of AC2 and the presence/direction/
// magnitude of AC1/AC3. These blocks close the AC channels the original suite
// left UNASSERTED, all against the SAME production output (no private math, AC4):
//   A. AC2 "shape + motion SPEED" — width/durSec track |kW| (vampire thin/slow vs
//      charging thick/fast); the existing signature only captured direction+active.
//   B. AC2 / UX-DR12 "source is never hue-only" — the label+kW honesty floor.
//   C. AC1.1 "present-but-calm, NEVER blank" — quiescent edges still echo a value.
//   D. Dev Notes — islanding reads from POWER TOPOLOGY, not the grid_status sensor.
// ═══════════════════════════════════════════════════════════════════════════

describe('AC2 gap — magnitude reads as SHAPE (width) + MOTION SPEED (durSec) (FR-11)', () => {
  // Dev Notes: "a high-kW charging edge animates fast/thick, a 0.3-kW vampire edge
  // animates slow/thin." The original signature captured only direction+active, so
  // two same-direction states would look identical despite very different power.
  test('renderer width/durSec ARE the production edgeVisual(|kW|) output (consume the one constant, AC4)', () => {
    // Import the SHARED formula from production and compare — never re-derive it
    // locally (that would be the private copy AC4/R2 forbids).
    const model = modelOf(charging);
    const r = new HeroSvgRenderer();
    r.update(model);
    for (const v of r.visuals) {
      const want = edgeVisual(edgeOf(model, v.role)!.kW);
      expect(v.width, `${v.role} width`).toBeCloseTo(want.width, 6);
      expect(v.durSec, `${v.role} durSec`).toBeCloseTo(want.durSec, 6);
    }
  });

  test('vampire (0.3 kW) draws THINNER and animates SLOWER than charging (7 kW) — both active', () => {
    const vr = new HeroSvgRenderer();
    vr.update(modelOf(vampire));
    const cr = new HeroSvgRenderer();
    cr.update(modelOf(charging));
    const vamp = [...vr.visuals].find((v) => v.role === 'powerwall')!; // 0.3 kW drain
    const chg = [...cr.visuals].find((v) => v.role === 'wall_connector')!; // 7.0 kW draw
    // Both ABOVE the deadband ⇒ both active — so the discriminator is shape+speed,
    // not on/off. This is precisely what separates a tiny real drain from a big draw.
    expect(vamp.active).toBe(true);
    expect(chg.active).toBe(true);
    expect(vamp.width).toBeLessThan(chg.width); // thinner stroke = less power
    expect(vamp.durSec).toBeGreaterThan(chg.durSec); // longer period = slower dash-flow
  });

  test('a quiescent edge still gets a sane base-track width (calm, not invisible)', () => {
    // present-but-calm: the asleep corpus animates nothing, yet every edge keeps a
    // drawable width so the track still reads as "present" (AC1.1 / AC2).
    const r = new HeroSvgRenderer();
    r.update(modelOf(asleep as Fixture));
    for (const v of r.visuals) {
      expect(v.active).toBe(false);
      expect(v.width).toBeGreaterThan(0);
    }
  });
});

describe('AC2 gap — source is never hue-only: the label+kW honesty floor (UX-DR12)', () => {
  test('label() emits every PRESENT node with its kW; an ABSENT node is omitted', () => {
    const r = new HeroSvgRenderer();
    r.update(modelOf(charging));
    const label = r.label();
    expect(label).toContain('Energy power flow');
    // charging: solar/grid/home/wall_connector present, powerwall ABSENT.
    expect(label).toContain('Solar 2.0 kW');
    expect(label).toContain('Grid 6.0 kW');
    expect(label).toContain('Home 1.0 kW');
    expect(label).toContain('Wall connector 7.0 kW');
    expect(label).not.toContain('Powerwall'); // absent → no chip → not in the floor
  });
});

describe('AC1.1 gap — quiescent is present-but-calm, NEVER blank (last-known value survives)', () => {
  test('asleep edges are all calm yet still carry a non-zero last-known kW (binding.ts:95-96)', () => {
    const model = modelOf(asleep as Fixture);
    expect(model.edges.every((e) => e.direction === 'none')).toBe(true); // all calm
    // ...but the last-known reading is ECHOED, not zeroed — calm ≠ blank.
    expect(model.edges.some((e) => Math.abs(e.kW) > DEADBAND)).toBe(true);
  });

  test('label() of a calm corpus still shows real kW figures (never the "—" blank)', () => {
    const r = new HeroSvgRenderer();
    r.update(modelOf(asleep as Fixture));
    const label = r.label();
    expect(label).toMatch(/\d\.\d kW/); // at least one concrete kW read survives
    expect(label).not.toContain('—'); // never the blank placeholder for a present node
  });
});

describe('islanding gap — read from POWER TOPOLOGY, not the discrete grid_status sensor', () => {
  // Dev Notes: the FlowModel is power-only (POWER_KEY maps each role to one *_power
  // sensor); grid_status:'off_grid' is energy-panel metadata, NOT a flow input. Prove
  // it — mutating/removing grid_status must leave the bound model IDENTICAL: grid stays
  // ABSENT (its grid_power is 'unavailable'), the Powerwall still islands.
  function edgeSig(model: FlowModel): string {
    return model.edges
      .map((e) => `${e.from}->${e.to}:${e.direction}:${e.kW.toFixed(3)}:${e.provenance}`)
      .sort()
      .join('|');
  }
  function withGridStatus(state: string | null): Fixture {
    const base = islanding as Fixture;
    const states: Record<string, unknown> = { ...base.states };
    if (state === null) delete states['sensor.grid_status'];
    else {
      const prev = states['sensor.grid_status'] as Record<string, unknown>;
      states['sensor.grid_status'] = { ...prev, state };
    }
    return { provenance: base.provenance, states };
  }

  test('grid stays absent + Powerwall islands regardless of grid_status value', () => {
    const offGrid = edgeSig(modelOf(islanding as Fixture)); // grid_status:'off_grid'
    const onGrid = edgeSig(modelOf(withGridStatus('on_grid')));
    const removed = edgeSig(modelOf(withGridStatus(null)));
    expect(onGrid).toBe(offGrid); // flipping the discrete sensor changes NOTHING
    expect(removed).toBe(offGrid); // removing it changes NOTHING

    // ...and the islanding topology itself is read from power alone:
    const m = modelOf(withGridStatus('on_grid'));
    expect(edgeOf(m, 'grid')).toBeUndefined(); // grid tap dead → absent
    expect(nodeOf(m, 'grid')!.present).toBe(false);
    expect(edgeOf(m, 'powerwall')!.direction).toBe('forward'); // Powerwall injects
  });
});
