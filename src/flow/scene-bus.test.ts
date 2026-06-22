// @vitest-environment jsdom
//
// Co-located gate for Story 4.4 — the SECOND FlowRenderer (SceneBusRenderer) and the
// R1 interface-conformance proof. Drives the renderer from the SAME shared fixture
// corpus THROUGH `bindFlowModel` (awake/asleep/all-unresolved) that the binding /
// balance / hero-svg tests + demo use, feeding the SYNTHETIC stub rects (D5 §5d) as
// anchors instead of any live `getBoundingClientRect()`. The heart of the story is
// the R1 proof: HeroSvgRenderer AND SceneBusRenderer fed the IDENTICAL model derive
// per-edge visuals IDENTICALLY (kW → width/durSec, direction, source colour) and
// differ ONLY in coordinates. Hermetic: committed fixtures, injected `now`, zero
// network, zero live DOM measurement (AC4).
import { describe, expect, test, vi } from 'vitest';
import { html, render } from 'lit';
import { SceneBusRenderer, sceneBusStyles, type RectLike } from './scene-bus';
import { HeroSvgRenderer, NODE_XY, BUS_XY } from './hero-svg';
import { edgeVisual, edgeVisuals, NODE_COLOR, NODE_ICON } from './renderer';
import { bindFlowModel, ENERGY_ROLES } from './binding';
import { buildFlowModel, BUS_NODE_ID, type FlowInput, type FlowModel } from './model';
import { STRINGS } from '../strings';
import { formatNumber } from '../helpers';
import type { HomeAssistant, TeslaCardConfig } from '../types';
import awake from '../fixtures/model-y-awake.json';
import asleep from '../fixtures/model-y-asleep.json';
import unresolved from '../fixtures/all-unresolved.json';
import stubRects from '../fixtures/scene-stub-rects.json';

/** The synthetic stub rects (node-id → RectLike) — the AC2/AC4 anchor substrate. */
const STUB = stubRects.rects as Record<string, RectLike>;

function makeHass(states: Record<string, unknown>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}
const ASLEEP_NOW = Date.parse(asleep.provenance.reference_now as string);

/** A rect's centre point — what SceneBus anchors chips/edges to. */
const centre = (r: RectLike) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Render the renderer's overlay content into a detached <svg> and return it. */
function mount(r: SceneBusRenderer): SVGSVGElement {
  const container = document.createElement('div');
  render(html`<svg>${r.view()}</svg>`, container);
  return container.querySelector('svg')!;
}
function renderFor(
  states: Record<string, unknown>,
  opts?: { now: number }
): { model: ReturnType<typeof bindFlowModel>; svg: SVGSVGElement; r: SceneBusRenderer } {
  const model = bindFlowModel(makeHass(states), cfg(), opts ?? {});
  const r = new SceneBusRenderer();
  r.update(model);
  r.setAnchors(STUB);
  return { model, svg: mount(r), r };
}

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC3/AC4 — awake corpus → present `measured` edges animate from rect centres.
// ───────────────────────────────────────────────────────────────────────────
describe('awake corpus → animated edges + glass chips from stub rects (AC1, AC3, AC4)', () => {
  test('one glass chip per present node, each carrying its label + kW magnitude', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    const present = model.nodes.filter((n) => n.present);
    const chips = svg.querySelectorAll('.sb-chip');
    expect(chips.length).toBe(present.length);
    for (const n of present) {
      const chip = svg.querySelector(`.sb-chip[data-role="${n.role}"]`)!;
      expect(chip).toBeTruthy();
      expect(chip.querySelector('.sb-chip-label')!.textContent).toBe(
        STRINGS.energy.nodes[n.role]
      );
      expect(chip.querySelector('.sb-chip-val')!.textContent).toMatch(/[\d.]+ kW/);
    }
  });

  test('every active edge: width = edgeVisual(kW).width DIRECTLY (no presentation scale); dur/colour/direction from the shared derivation', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    let actives = 0;
    for (const edge of model.edges) {
      const g = svg.querySelector(`.sb-edge[data-role="${edge.from}"]`)!;
      expect(g).toBeTruthy();
      // Direction follows the MODEL's resolved sense (never re-derived here).
      expect(g.getAttribute('data-direction')).toBe(edge.direction);
      if (edge.direction === 'none') continue;
      actives++;
      const flow = g.querySelector('.sb-flow')!;
      const style = flow.getAttribute('style') ?? '';
      // Duration is the shared derivation verbatim.
      expect(style).toContain(`animation-duration:${edgeVisual(edge.kW).durSec}s`);
      // Colour encodes the SOURCE (from) node — FR-9.
      expect(style).toContain(NODE_COLOR[edge.from as keyof typeof NODE_COLOR]);
      // SceneBus draws in screen px → stroke-width IS edgeVisual(kW).width (no scale).
      expect(Number(flow.getAttribute('stroke-width'))).toBeCloseTo(
        edgeVisual(edge.kW).width,
        9
      );
      // An active edge draws an arrowhead at the sink.
      expect(g.querySelector('.sb-head')).toBeTruthy();
    }
    expect(actives).toBeGreaterThan(0);
  });

  test('a forward edge sources at the node-rect centre; a reverse edge sources at the bus-rect centre (AC1 anchor)', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    const fwd = model.edges.find((e) => e.from === 'solar')!;
    const rev = model.edges.find((e) => e.from === 'home')!;
    expect(fwd.direction).toBe('forward');
    expect(rev.direction).toBe('reverse');

    const flowOf = (role: string) =>
      svg.querySelector(`.sb-edge[data-role="${role}"] .sb-flow`)!;
    const busC = centre(STUB[BUS_NODE_ID]);

    // Forward: the dash STARTS at the source node's rect centre (sink = bus).
    expect(Number(flowOf('solar').getAttribute('x1'))).toBeCloseTo(centre(STUB.solar).x, 9);
    expect(Number(flowOf('solar').getAttribute('y1'))).toBeCloseTo(centre(STUB.solar).y, 9);
    // Reverse: the SAME node, but the dash now STARTS at the bus centre (sink = node).
    expect(Number(flowOf('home').getAttribute('x1'))).toBeCloseTo(busC.x, 9);
    expect(Number(flowOf('home').getAttribute('y1'))).toBeCloseTo(busC.y, 9);

    // The arrowhead apex sits at the SINK — bus for forward, the node for reverse.
    const headStart = (role: string) =>
      svg
        .querySelector(`.sb-edge[data-role="${role}"] .sb-head`)!
        .getAttribute('d')!
        .match(/^M\s+([\d.-]+)\s+([\d.-]+)/)!;
    const [, fhx, fhy] = headStart('solar');
    expect([Number(fhx), Number(fhy)]).toEqual([busC.x, busC.y]);
    const [, rhx, rhy] = headStart('home');
    expect([Number(rhx), Number(rhy)]).toEqual([centre(STUB.home).x, centre(STUB.home).y]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2/AC4 — asleep corpus → present but calm (quiescent → no motion).
// ───────────────────────────────────────────────────────────────────────────
describe('asleep corpus → edges present but NO motion (quiescent, AC2/AC4)', () => {
  test('chips render (present-and-calm), every edge direction:none, zero animated dashes', () => {
    const { model, svg } = renderFor(asleep.states as Record<string, unknown>, {
      now: ASLEEP_NOW,
    });
    expect(svg.querySelectorAll('.sb-chip').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('.sb-edge').length).toBe(model.edges.length);
    expect(
      [...svg.querySelectorAll('.sb-edge')].every(
        (g) => g.getAttribute('data-direction') === 'none'
      )
    ).toBe(true);
    expect(svg.querySelectorAll('.sb-flow').length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — vehicle-only install → empty model → nothing drawn.
// ───────────────────────────────────────────────────────────────────────────
describe('all-unresolved corpus → empty renderer (AC2)', () => {
  test('a vehicle-only install yields an empty renderer (no chips, no edges)', () => {
    const { svg, r } = renderFor(unresolved.states as Record<string, unknown>);
    expect(r.empty).toBe(true);
    expect(svg.querySelectorAll('.sb-chip').length).toBe(0);
    expect(svg.querySelectorAll('.sb-edge').length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — THE R1 PROOF: one model, two renderers, IDENTICAL derivation. This is the
// committed evidence that "one model serves both renderers" — both call the ONE
// shared `edgeVisuals`/`edgeVisual`/`NODE_COLOR`, so the visual half is identical
// edge-for-edge; only the coordinates (NODE_XY/BUS_XY vs stub-rect centres) differ.
// ═══════════════════════════════════════════════════════════════════════════
describe('R1 — both renderers derive edge visuals IDENTICALLY, differing only in coordinates (AC3)', () => {
  function bothFrom(states: Record<string, unknown>, opts?: { now: number }) {
    const model = bindFlowModel(makeHass(states), cfg(), opts ?? {});
    const hero = new HeroSvgRenderer();
    hero.update(model);
    const scene = new SceneBusRenderer();
    scene.update(model);
    scene.setAnchors(STUB);
    return { model, hero, scene };
  }

  test('per-edge {width, durSec, direction, colour, active} are identical across renderers AND equal the shared derivation', () => {
    const { model, hero, scene } = bothFrom(awake.states as Record<string, unknown>);
    // Same edge order (both map over model.edges), so the visual arrays are equal.
    expect(scene.visuals).toEqual(hero.visuals);
    expect(scene.visuals.length).toBe(model.edges.length);

    // And neither forked the math: each renderer's visual equals the ONE shared
    // `edgeVisuals` / `edgeVisual` / `NODE_COLOR` output for that edge.
    model.edges.forEach((e, i) => {
      const shared = edgeVisuals(e);
      for (const v of [hero.visuals[i], scene.visuals[i]]) {
        expect(v.role).toBe(e.from);
        expect(v).toEqual({ role: e.from, ...shared });
        // Pre-scale width is the canonical edgeVisual(kW).width (the AC3 contract).
        expect(v.width).toBeCloseTo(edgeVisual(e.kW).width, 9);
        expect(v.durSec).toBeCloseTo(edgeVisual(e.kW).durSec, 9);
        expect(v.direction).toBe(e.direction);
        expect(v.color).toBe(NODE_COLOR[e.from as keyof typeof NODE_COLOR]);
        expect(v.active).toBe(e.direction !== 'none');
      }
    });
  });

  test('only the COORDINATES differ: HeroSvg sources from NODE_XY/BUS_XY, SceneBus from stub-rect centres', () => {
    const { hero, scene } = bothFrom(awake.states as Record<string, unknown>);
    const heroSvg = (() => {
      const c = document.createElement('div');
      render(html`<svg>${hero.view()}</svg>`, c);
      return c.querySelector('svg')!;
    })();
    const sceneSvg = mount(scene);

    const heroSolar = heroSvg.querySelector('.fo-edge[data-role="solar"] .fo-flow')!;
    const sceneSolar = sceneSvg.querySelector('.sb-edge[data-role="solar"] .sb-flow')!;
    // Hero: solar (forward) sources at the static NODE_XY coordinate.
    expect(Number(heroSolar.getAttribute('x1'))).toBe(NODE_XY.solar.x);
    expect(Number(heroSolar.getAttribute('y1'))).toBe(NODE_XY.solar.y);
    // SceneBus: solar sources at the stub-rect centre — a DIFFERENT coordinate space.
    expect(Number(sceneSolar.getAttribute('x1'))).toBeCloseTo(centre(STUB.solar).x, 9);
    expect(Number(sceneSolar.getAttribute('x1'))).not.toBe(NODE_XY.solar.x);
    // Sanity: the two coordinate substrates genuinely differ (not an accidental alias).
    expect(centre(STUB.solar).x).not.toBe(NODE_XY.solar.x);
    expect(BUS_XY.x).not.toBe(centre(STUB[BUS_NODE_ID]).x);
  });

  test('a quiescent (asleep) model → both renderers calm, every edge direction:none, no motion', () => {
    const { model, hero, scene } = bothFrom(asleep.states as Record<string, unknown>, {
      now: ASLEEP_NOW,
    });
    expect(scene.visuals).toEqual(hero.visuals);
    expect(model.edges.every((e) => e.direction === 'none')).toBe(true);
    expect(scene.visuals.every((v) => v.active === false)).toBe(true);
    expect(hero.visuals.every((v) => v.active === false)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 — SCOPE GUARD: the proof uses STATIC stub rects only. It does NOT measure live
// layout: no getBoundingClientRect() on a live element, no ResizeObserver, no rAF.
// ───────────────────────────────────────────────────────────────────────────
describe('AC4 scope guard: static stub rects, no live layout measurement', () => {
  test('rendering never calls getBoundingClientRect or requestAnimationFrame on the live document', () => {
    const gbcr = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');

    const { svg } = renderFor(awake.states as Record<string, unknown>);
    // The overlay drew (proof ran)…
    expect(svg.querySelectorAll('.sb-edge').length).toBeGreaterThan(0);
    // …yet NOTHING measured live layout — geometry came purely from the stub rects.
    expect(gbcr).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();

    gbcr.mockRestore();
    raf.mockRestore();
  });

  test('the stub-rect corpus is static, hermetic data (plain RectLike numbers, no live capture)', () => {
    // Every covered node-id is a plain {left, top, width, height} of finite numbers —
    // no function, no getter, nothing that could reach into a live DOM.
    for (const id of [...ENERGY_ROLES, BUS_NODE_ID]) {
      const r = STUB[id];
      expect(r).toBeTruthy();
      for (const k of ['left', 'top', 'width', 'height'] as const) {
        expect(Number.isFinite(r[k])).toBe(true);
      }
    }
    expect((stubRects.provenance as { synthetic: boolean }).synthetic).toBe(true);
  });

  test('SceneBusRenderer builds NO ResizeObserver/IntersectionObserver and runs no rAF loop (Epic-6 surface)', () => {
    // The renderer is a pure hub: instantiating + updating + viewing it touches no
    // geometry-observer constructor. (Epic 6 wraps THIS unchanged core in the
    // rAF/observer loop; this story explicitly does not pull that forward — AC4.)
    let roConstructed = 0;
    const realRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = function () {
      roConstructed++;
    };
    try {
      const { r } = renderFor(awake.states as Record<string, unknown>);
      r.view();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realRO;
    }
    expect(roConstructed).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC2 — anchor-seam behaviours: missing anchors omit drawing; the bus falls back
// to the centroid of present node anchors when no explicit bus rect is supplied; the
// held renderer replaces (never accumulates) state across re-update.
// ───────────────────────────────────────────────────────────────────────────
describe('anchor seam: missing anchors omit, bus centroid fallback, held re-update (AC1, AC2)', () => {
  function renderModel(inputs: FlowInput[], anchors: Record<string, RectLike>) {
    const model = buildFlowModel(inputs);
    const r = new SceneBusRenderer();
    r.update(model);
    r.setAnchors(anchors);
    return { model, svg: mount(r), r };
  }

  test('a present node with NO supplied anchor is simply not drawn (chip + edge omitted)', () => {
    // solar + grid present, but only solar gets an anchor → grid is undrawable.
    const { svg } = renderModel(
      [
        { role: 'solar', kW: 4.2, provenance: 'measured' },
        { role: 'grid', kW: 1.1, provenance: 'measured' },
      ],
      { solar: STUB.solar, bus: STUB[BUS_NODE_ID] }
    );
    expect(svg.querySelector('.sb-chip[data-role="solar"]')).toBeTruthy();
    expect(svg.querySelector('.sb-edge[data-role="solar"]')).toBeTruthy();
    expect(svg.querySelector('.sb-chip[data-role="grid"]')).toBeNull();
    expect(svg.querySelector('.sb-edge[data-role="grid"]')).toBeNull();
  });

  test('no explicit bus rect → the bus point falls back to the centroid of present node anchors', () => {
    // Two symmetric node anchors, no bus rect → centroid is their midpoint, and the
    // forward edge's sink (arrowhead apex) lands there.
    const a: RectLike = { left: 0, top: 0, width: 100, height: 100 }; // centre (50,50)
    const b: RectLike = { left: 200, top: 200, width: 100, height: 100 }; // centre (250,250)
    const { svg } = renderModel(
      [
        { role: 'solar', kW: 4.2, provenance: 'measured' }, // forward → sink at bus
        { role: 'grid', kW: 1.1, provenance: 'measured' },
      ],
      { solar: a, grid: b }
    );
    const head = svg
      .querySelector('.sb-edge[data-role="solar"] .sb-head')!
      .getAttribute('d')!
      .match(/^M\s+([\d.-]+)\s+([\d.-]+)/)!;
    // Centroid of (50,50) and (250,250) = (150,150).
    expect(Number(head[1])).toBeCloseTo(150, 9);
    expect(Number(head[2])).toBeCloseTo(150, 9);
  });

  test('held renderer: update(awake) → chips; update(empty) on the SAME instance → empty, nothing drawn', () => {
    const r = new SceneBusRenderer();
    r.setAnchors(STUB);
    r.update(bindFlowModel(makeHass(awake.states as Record<string, unknown>), cfg(), {}));
    expect(mount(r).querySelectorAll('.sb-chip').length).toBe(5);
    expect(r.empty).toBe(false);

    r.update(bindFlowModel(makeHass(unresolved.states as Record<string, unknown>), cfg(), {}));
    expect(r.empty).toBe(true);
    expect(mount(r).querySelectorAll('.sb-chip').length).toBe(0);
    expect(mount(r).querySelectorAll('.sb-edge').length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1 — the renderer implements the FlowRenderer interface; state-bearing label.
// ───────────────────────────────────────────────────────────────────────────
describe('FlowRenderer conformance + state-bearing label (AC1, AC4)', () => {
  test('update(model) is the only required method; anchors are a separate input', () => {
    const r = new SceneBusRenderer();
    // DOM-free contract: update + setAnchors + accessors, never a live element.
    expect(typeof r.update).toBe('function');
    expect(typeof r.setAnchors).toBe('function');
    expect(typeof r.anchorFor).toBe('function');
    r.update(buildFlowModel([{ role: 'solar', kW: 6, provenance: 'measured' }]));
    expect(r.anchorFor('solar')).toBeNull(); // no anchors yet
    r.setAnchors({ solar: STUB.solar });
    expect(r.anchorFor('solar')).toEqual(STUB.solar);
  });

  test('awake → the label names each present node + its kW; empty → the bare flow label floor', () => {
    const { model, r } = renderFor(awake.states as Record<string, unknown>);
    const label = r.label();
    expect(label.startsWith(STRINGS.energy.flowLabel)).toBe(true);
    for (const n of model.nodes.filter((x) => x.present)) {
      expect(label).toContain(STRINGS.energy.nodes[n.role]);
    }
    expect(label).toMatch(/[\d.]+ kW/);

    const { r: empty } = renderFor(unresolved.states as Record<string, unknown>);
    expect(empty.label()).toBe(STRINGS.energy.flowLabel);
  });

  test('Story 9.7: a DUPLICATED role names each instance with its OWN kW — never `—` (a11y)', () => {
    // Regression: the chip kwText looks the edge up by NODE ID (not role). With the
    // model keyed by instance id (`solar:1`/`solar:2`), a bare-role lookup misses both
    // → "Solar —, Solar —" in the live overlay aria-label. Pin the per-instance read.
    const r = new SceneBusRenderer();
    r.update(
      buildFlowModel([
        { role: 'solar', id: 'solar:1', kW: 2, provenance: 'measured' },
        { role: 'solar', id: 'solar:2', kW: 1, provenance: 'measured' },
      ])
    );
    const label = r.label();
    expect(label).not.toContain('—'); // the bug read both chips as a no-value dash
    expect(label).toContain('2.0 kW'); // solar:1's own reading
    expect(label).toContain('1.0 kW'); // solar:2's own reading
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC7 — style contract: reduced-motion halts the dash; glass chips; token fallbacks.
// ───────────────────────────────────────────────────────────────────────────
describe('sceneBusStyles contract: reduced-motion halt + glass chips + token fallbacks (AC7)', () => {
  const cssText = sceneBusStyles.cssText;

  test('prefers-reduced-motion halts the dash animation (kill the motion, keep the data)', () => {
    expect(cssText).toContain('prefers-reduced-motion: reduce');
    const block = cssText.slice(cssText.indexOf('prefers-reduced-motion'));
    expect(block).toContain('.sb-flow');
    expect(block).toContain('animation: none');
  });

  test('chips are glass (--tc-surface-2 + --tc-border) and every var carries a fallback', () => {
    expect(cssText).toContain('--tc-surface-2');
    expect(cssText).toContain('--tc-border');
    const bare = cssText.match(/var\(\s*--tc-[a-z0-9-]+\s*\)/gi);
    expect(bare).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1 — role-keyed maps cover every EnergyRole (shared with the hero proof).
// ───────────────────────────────────────────────────────────────────────────
describe('stub-rect corpus covers every EnergyRole + the bus (AC1)', () => {
  test('the stub corpus keys exactly the 5 energy roles + the bus junction', () => {
    expect(Object.keys(STUB).sort()).toEqual([...ENERGY_ROLES, BUS_NODE_ID].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QA gap pass (bmad-qa-generate-e2e-tests) — branches/behaviours the AC suite
// above leaves uncovered. The signed-kW magnitude is the R2 bug surface; the
// remaining cases pin the inactive-edge grammar, chip icon/colour wiring, the
// defensive '—' fallback, and the null-bus short-circuit.
// ═══════════════════════════════════════════════════════════════════════════
describe('QA gap pass — signed magnitude, inactive grammar, chip wiring, defensive branches', () => {
  // Gap 1 (AC1/AC3) — a REVERSE edge carries a NEGATIVE signed kW; the chip value
  // and edge magnitude must show |kW| (a sign bug would otherwise leak a "-" into
  // the user-facing read). The existing regex `/[\d.]+ kW/` matches inside "-7.4 kW",
  // so it can't catch this — assert the exact abs-formatted string + no minus sign.
  test('reverse (negative-kW) edge → chip value shows |kW|, never a leading minus', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    const home = model.edges.find((e) => e.from === 'home')!;
    expect(home.direction).toBe('reverse');
    expect(home.kW).toBeLessThan(0); // signed-negative by construction
    const val = svg.querySelector('.sb-chip[data-role="home"] .sb-chip-val')!.textContent!;
    expect(val).toBe(`${formatNumber(Math.abs(home.kW), 1)} kW`);
    expect(val).not.toContain('-');
  });

  // Gap 2 (AC2/AC4) — an inactive (direction:'none') edge draws the calm base track
  // ONLY: no animated `.sb-flow` dash AND no `.sb-head` arrowhead. The asleep test
  // checks the dash count but not the arrowhead — pin both for every quiescent edge.
  test('inactive edge renders the base track but neither a flow dash nor an arrowhead', () => {
    const { svg } = renderFor(asleep.states as Record<string, unknown>, { now: ASLEEP_NOW });
    const edges = [...svg.querySelectorAll('.sb-edge')];
    expect(edges.length).toBeGreaterThan(0);
    for (const g of edges) {
      expect(g.getAttribute('data-direction')).toBe('none');
      expect(g.querySelector('.sb-track')).toBeTruthy(); // calm track stays
      expect(g.querySelector('.sb-flow')).toBeNull(); // no motion
      expect(g.querySelector('.sb-head')).toBeNull(); // no arrowhead
    }
  });

  // Gap 3 (AC1/FR-9) — the R1 proof asserts EDGE colour wiring; chips are unverified.
  // Each chip must carry its role's MDI icon path (NODE_ICON) and source accent
  // (NODE_COLOR) via the `--sb-c` custom prop — the chip half of "hue says source".
  test('each present chip wires its NODE_ICON path + NODE_COLOR accent (--sb-c)', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    for (const n of model.nodes.filter((x) => x.present)) {
      const chip = svg.querySelector(`.sb-chip[data-role="${n.role}"]`)!;
      expect(chip.querySelector('.sb-chip-ico path')!.getAttribute('d')).toBe(NODE_ICON[n.role]);
      expect(chip.getAttribute('style')).toContain(`--sb-c:${NODE_COLOR[n.role]}`);
    }
  });

  // Gap 4 (defensive) — buildFlowModel always pairs a present node with an edge, so
  // the chip's `edge ? kwText : '—'` fallback is unreachable via the assembler. Drive
  // it directly with a hand-built model (present node, no edge) to pin the fallback.
  test('present node with NO matching edge → chip value falls back to "—"', () => {
    const model: FlowModel = { nodes: [{ id: 'solar', role: 'solar', present: true }], edges: [] };
    const r = new SceneBusRenderer();
    r.update(model);
    r.setAnchors({ solar: STUB.solar });
    const svg = mount(r);
    expect(svg.querySelector('.sb-chip[data-role="solar"] .sb-chip-val')!.textContent).toBe('—');
  });

  // Gap 5 (AC1) — present data but ZERO anchors → `_busPoint()` returns null, so the
  // view short-circuits edges to []; chips are anchor-filtered to none too. The data
  // is still present (`empty === false`) — nothing is DRAWN, but the model isn't empty.
  test('present model + no anchors → nothing drawn (null bus), yet empty stays false', () => {
    const r = new SceneBusRenderer();
    r.update(bindFlowModel(makeHass(awake.states as Record<string, unknown>), cfg(), {}));
    r.setAnchors({}); // no anchors at all → bus point is null
    const svg = mount(r);
    expect(r.empty).toBe(false); // the model HAS present nodes…
    expect(svg.querySelectorAll('.sb-edge').length).toBe(0); // …but nothing is drawable
    expect(svg.querySelectorAll('.sb-chip').length).toBe(0);
  });
});
