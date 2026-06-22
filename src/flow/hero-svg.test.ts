// @vitest-environment jsdom
//
// Co-located gate for Story 4.3 — the first FlowRenderer (HeroSvgRenderer). Drives
// the renderer from the SHARED fixture corpus THROUGH `bindFlowModel` (the same
// JSON the binding/balance tests + demo use), then asserts on the rendered overlay
// DOM (chips for present nodes, edge motion/direction/colour, label + kW), never on
// intermediate reads. Lit `render` drives the pure `view()` output into a detached
// container (the carView/car.test.ts pattern) — no custom element needed. Hermetic:
// committed fixtures, injected `now` for the asleep staleness, zero network.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { html, render } from 'lit';
import { mdiGeneratorStationary } from '@mdi/js';
import { HeroSvgRenderer, NODE_XY, BUS_XY, flowOverlayStyles } from './hero-svg';
import { edgeVisual, NODE_COLOR, NODE_ICON } from './renderer';
import { bindFlowModel, ENERGY_ROLES } from './binding';
import { buildFlowModel, type FlowInput } from './model';
import { HERO_VIEWBOX } from '../const';
import { STRINGS } from '../strings';
import type { HomeAssistant, TeslaCardConfig } from '../types';
import awake from '../fixtures/model-y-awake.json';
import asleep from '../fixtures/model-y-asleep.json';
import unresolved from '../fixtures/all-unresolved.json';

function makeHass(states: Record<string, unknown>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}
function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}
// Asleep fixture back-dates every stamp 50 min before this reference (see its
// provenance) so the freshness reader classifies the still-present reads asleep
// when we inject `now` — without it `referenceNow` derives the max stamp = fresh.
const ASLEEP_NOW = Date.parse(asleep.provenance.reference_now as string);

/** Render the renderer's overlay content into a detached <svg> and return it. */
function mount(r: HeroSvgRenderer): SVGSVGElement {
  const container = document.createElement('div');
  render(html`<svg>${r.view()}</svg>`, container);
  return container.querySelector('svg')!;
}
function renderFor(states: Record<string, unknown>, opts?: { now: number }): {
  model: ReturnType<typeof bindFlowModel>;
  svg: SVGSVGElement;
  r: HeroSvgRenderer;
} {
  const model = bindFlowModel(makeHass(states), cfg(), opts ?? {});
  const r = new HeroSvgRenderer();
  r.update(model);
  return { model, svg: mount(r), r };
}

// ───────────────────────────────────────────────────────────────────────────
// AC3 — the shared kW→visual derivation (the contract 4.4 asserts IDENTICAL).
// ───────────────────────────────────────────────────────────────────────────
describe('edgeVisual — the exact architecture D1.1b formulas (4.4 reuse point)', () => {
  const cases: Array<{ kW: number; width: number; durSec: number }> = [
    { kW: 0, width: 1.6, durSec: 1.7 }, // no kW → thinnest + slowest
    { kW: 1, width: 1.6 + 1 * 0.55, durSec: 1.7 - 1 * 0.16 },
    { kW: 5, width: 1.6 + 5 * 0.55, durSec: 1.7 - 5 * 0.16 },
    { kW: 20, width: 1.6 + 20 * 0.55, durSec: 0.5 }, // dur clamped at 0.5 (1.7−3.2<0.5)
  ];
  for (const c of cases) {
    test(`edgeVisual(${c.kW}) = width ${c.width}, dur ${c.durSec}`, () => {
      const v = edgeVisual(c.kW);
      expect(v.width).toBeCloseTo(c.width, 9);
      expect(v.durSec).toBeCloseTo(c.durSec, 9);
    });
  }
  test('magnitude-driven (sign-agnostic): |kW| drives the visual, not the sign', () => {
    expect(edgeVisual(-5)).toEqual(edgeVisual(5));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC3/AC4 — awake corpus → present `measured` edges animate.
// ───────────────────────────────────────────────────────────────────────────
describe('awake corpus → animated edges + glass chips (AC1, AC3, AC4)', () => {
  test('one glass chip per present node, each carrying its label + kW magnitude', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    const present = model.nodes.filter((n) => n.present);
    const chips = svg.querySelectorAll('.fo-chip');
    expect(chips.length).toBe(present.length);
    for (const n of present) {
      const chip = svg.querySelector(`.fo-chip[data-role="${n.role}"]`)!;
      expect(chip).toBeTruthy();
      // AC4 — colour-blind safe: the node-anchored LABEL + its kW are both present.
      expect(chip.querySelector('.fo-chip-label')!.textContent).toBe(
        STRINGS.energy.nodes[n.role]
      );
      expect(chip.querySelector('.fo-chip-val')!.textContent).toMatch(/[\d.]+ kW/);
    }
  });

  test('every active edge: width/duration derive from edgeVisual(kW); arrow matches direction; colour = source node accent', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    const ratios: number[] = [];
    for (const edge of model.edges) {
      const g = svg.querySelector(`.fo-edge[data-role="${edge.from}"]`)!;
      expect(g).toBeTruthy();
      // Direction follows the MODEL's resolved sense (never re-derived here).
      expect(g.getAttribute('data-direction')).toBe(edge.direction);
      if (edge.direction === 'none') continue;
      const flow = g.querySelector('.fo-flow')!;
      const style = flow.getAttribute('style') ?? '';
      // Duration is the shared derivation verbatim (no presentation scale on dur).
      expect(style).toContain(`animation-duration:${edgeVisual(edge.kW).durSec}s`);
      // Colour encodes the SOURCE (from) node — FR-9 (hue says where power comes from).
      expect(style).toContain(NODE_COLOR[edge.from as keyof typeof NODE_COLOR]);
      // Magnitude → thickness is a pure scaling of the shared width.
      const sw = Number(flow.getAttribute('stroke-width'));
      ratios.push(sw / edgeVisual(edge.kW).width);
      // An active edge draws an arrowhead at the sink.
      expect(g.querySelector('.fo-head')).toBeTruthy();
    }
    // All active edges scale width by the SAME constant (one shared derivation).
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 9);
    expect(ratios.length).toBeGreaterThan(0);
  });

  test('solar edge is forward (role→bus) and amber (the source-node accent)', () => {
    const { svg } = renderFor(awake.states as Record<string, unknown>);
    const g = svg.querySelector('.fo-edge[data-role="solar"]')!;
    expect(g.getAttribute('data-direction')).toBe('forward');
    expect(g.querySelector('.fo-flow')!.getAttribute('style')).toContain(NODE_COLOR.solar);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2/AC4 — asleep corpus → present but calm (quiescent → no motion).
// ───────────────────────────────────────────────────────────────────────────
describe('asleep corpus → edges present but NO motion (quiescent, AC4)', () => {
  test('chips render (present-and-calm), every edge direction:none, zero animated dashes', () => {
    const { model, svg } = renderFor(asleep.states as Record<string, unknown>, {
      now: ASLEEP_NOW,
    });
    // Present-and-calm: chips still drawn (last-known echo), never blank.
    expect(svg.querySelectorAll('.fo-chip').length).toBeGreaterThan(0);
    // One edge group per model edge, all calm (direction none) — and crucially NO
    // animated `.fo-flow` dash (the data survives, the motion does not).
    expect(svg.querySelectorAll('.fo-edge').length).toBe(model.edges.length);
    expect(
      [...svg.querySelectorAll('.fo-edge')].every(
        (g) => g.getAttribute('data-direction') === 'none'
      )
    ).toBe(true);
    expect(svg.querySelectorAll('.fo-flow').length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — vehicle-only install → empty model → no overlay drawn.
// ───────────────────────────────────────────────────────────────────────────
describe('all-unresolved corpus → empty overlay (AC2)', () => {
  test('a vehicle-only install yields an empty renderer (no chips, no edges)', () => {
    const { svg, r } = renderFor(unresolved.states as Record<string, unknown>);
    expect(r.empty).toBe(true);
    expect(svg.querySelectorAll('.fo-chip').length).toBe(0);
    expect(svg.querySelectorAll('.fo-edge').length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1 — coordinates map into the fixed 1024×687 HERO_VIEWBOX contract.
// ───────────────────────────────────────────────────────────────────────────
describe('coordinate map → the 1024×687 HERO_VIEWBOX contract (AC1)', () => {
  test('every node coordinate (+ the bus) falls inside 1024×687', () => {
    for (const p of [...Object.values(NODE_XY), BUS_XY]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(HERO_VIEWBOX.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(HERO_VIEWBOX.height);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QA gap-fill (bmad-qa-generate-e2e-tests, Story 4.3). The suite above proves the
// happy paths (awake-animated, asleep-calm, empty, the edgeVisual contract, the
// coordinate box). These close the AC-aligned holes the corpus extremes don't
// reach: per-node OMISSION at the render tier (AC2), the monoline-MDI-not-raster
// chip icon (AC4), the source/sink SWAP a reverse edge must perform (AC3), the
// reduced-motion dash-halt + glass style contract (AC4/AC7), the role-keyed maps'
// completeness (AC1), and the held renderer clearing stale overlay on re-update.
// ═══════════════════════════════════════════════════════════════════════════

/** Build + render a partial FlowModel straight from per-role inputs (no fixture). */
function renderModel(inputs: FlowInput[]): {
  model: ReturnType<typeof buildFlowModel>;
  svg: SVGSVGElement;
  r: HeroSvgRenderer;
} {
  const model = buildFlowModel(inputs);
  const r = new HeroSvgRenderer();
  r.update(model);
  return { model, svg: mount(r), r };
}

// ───────────────────────────────────────────────────────────────────────────
// AC2 — per-node omission at the RENDER tier (not just the all/none extremes).
// ───────────────────────────────────────────────────────────────────────────
describe('partial install → only present roles drawn; absent omit chip AND edge (AC2)', () => {
  const PRESENT = ['solar', 'grid'] as const;
  const ABSENT = ['powerwall', 'home', 'wall_connector'] as const;
  // solar + grid present (measured kW); the other three absent (kW undefined).
  const inputs: FlowInput[] = [
    { role: 'solar', kW: 4.2, provenance: 'measured' },
    { role: 'grid', kW: 1.1, provenance: 'measured' },
    { role: 'powerwall', kW: undefined, provenance: 'measured' },
    { role: 'home', kW: undefined, provenance: 'measured' },
    { role: 'wall_connector', kW: undefined, provenance: 'measured' },
  ];

  test('exactly the present roles get a chip + edge; absent roles get NEITHER', () => {
    const { model, svg } = renderModel(inputs);
    // Sanity: the model itself omits per-role (5 nodes, 2 present, 2 edges).
    expect(model.nodes.filter((n) => n.present).map((n) => n.role).sort()).toEqual(
      [...PRESENT].sort()
    );
    expect(model.edges.length).toBe(PRESENT.length);

    // The RENDERER honors it: a chip + edge per present role, NONE synthesized.
    expect(svg.querySelectorAll('.fo-chip').length).toBe(PRESENT.length);
    expect(svg.querySelectorAll('.fo-edge').length).toBe(PRESENT.length);
    for (const role of PRESENT) {
      expect(svg.querySelector(`.fo-chip[data-role="${role}"]`)).toBeTruthy();
      expect(svg.querySelector(`.fo-edge[data-role="${role}"]`)).toBeTruthy();
    }
    for (const role of ABSENT) {
      expect(svg.querySelector(`.fo-chip[data-role="${role}"]`)).toBeNull();
      expect(svg.querySelector(`.fo-edge[data-role="${role}"]`)).toBeNull();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 — chip icon is a monoline MDI named path, never raster.
// ───────────────────────────────────────────────────────────────────────────
describe('chip icon → monoline MDI path (currentColor), never raster (AC4)', () => {
  test('each present chip renders its NODE_ICON path; no <image> raster anywhere', () => {
    const { model, svg } = renderModel([
      { role: 'solar', kW: 6, provenance: 'measured' },
      { role: 'home', kW: -1, provenance: 'measured' },
    ]);
    for (const n of model.nodes.filter((x) => x.present)) {
      const path = svg.querySelector(`.fo-chip[data-role="${n.role}"] .fo-chip-ico path`);
      expect(path).toBeTruthy();
      // The exact named @mdi/js path — not an arbitrary/raster glyph.
      expect(path!.getAttribute('d')).toBe(NODE_ICON[n.role]);
    }
    // Belt-and-braces: the overlay ships zero raster art (trade-dress + AC4).
    expect(svg.querySelector('image')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC3 — direction drives the source/sink SWAP (arrowhead lands at the sink).
// ───────────────────────────────────────────────────────────────────────────
describe('direction swaps source/sink: forward = role→bus, reverse = bus→role (AC3)', () => {
  // awake corpus: solar injects (forward, role→bus), home draws (reverse, bus→role)
  // — one of each, with the orientation/sign already resolved by the binding.
  test('a forward edge flows from the node; a reverse edge flows from the bus', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    const fwd = model.edges.find((e) => e.from === 'solar')!;
    const rev = model.edges.find((e) => e.from === 'home')!;
    expect(fwd.direction).toBe('forward');
    expect(rev.direction).toBe('reverse');

    const flowOf = (role: string) =>
      svg.querySelector(`.fo-edge[data-role="${role}"] .fo-flow`)!;
    const fwdFlow = flowOf('solar');
    const revFlow = flowOf('home');

    // Forward: the dash STARTS at the source node's coordinate (sink = bus).
    expect(Number(fwdFlow.getAttribute('x1'))).toBe(NODE_XY.solar.x);
    expect(Number(fwdFlow.getAttribute('y1'))).toBe(NODE_XY.solar.y);
    // Reverse: the SAME node, but the dash now STARTS at the bus (sink = node).
    expect(Number(revFlow.getAttribute('x1'))).toBe(BUS_XY.x);
    expect(Number(revFlow.getAttribute('y1'))).toBe(BUS_XY.y);

    // The arrowhead apex sits at the SINK — bus for forward, the node for reverse.
    const headStart = (role: string) =>
      svg
        .querySelector(`.fo-edge[data-role="${role}"] .fo-head`)!
        .getAttribute('d')!
        .match(/^M\s+([\d.-]+)\s+([\d.-]+)/)!;
    const [, fhx, fhy] = headStart('solar');
    expect([Number(fhx), Number(fhy)]).toEqual([BUS_XY.x, BUS_XY.y]);
    const [, rhx, rhy] = headStart('home');
    expect([Number(rhx), Number(rhy)]).toEqual([NODE_XY.home.x, NODE_XY.home.y]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4/AC7 — reduced-motion halts the dash; glass-chip surface; token fallbacks.
// ───────────────────────────────────────────────────────────────────────────
describe('overlay style contract: reduced-motion halt + glass chips (AC4, AC7)', () => {
  const cssText = flowOverlayStyles.cssText;

  test('prefers-reduced-motion halts the dash animation (kill the motion, keep the data)', () => {
    expect(cssText).toContain('prefers-reduced-motion: reduce');
    // The halt targets the flow dash specifically — the stroke/arrowhead/label stay.
    const block = cssText.slice(cssText.indexOf('prefers-reduced-motion'));
    expect(block).toContain('.fo-flow');
    expect(block).toContain('animation: none');
  });

  // ── Story 4.6 AC2 — the legible STATIC read (FR-12/UX-DR12) ──────────────────
  // The DoD reduced-motion rule hero-svg.ts deferred to THIS story: not just halt
  // the motion, but make the halted edge read as a clean static DIRECTED line.
  test('AC2: the reduced-motion block drops the dash → a clean static directed line, not a frozen gap', () => {
    const block = cssText.slice(cssText.indexOf('prefers-reduced-motion'));
    // The motion is killed AND the dash pattern removed — so what remains is a
    // solid coloured stroke (a directed line), never a frozen mid-cycle dash gap.
    expect(block).toContain('stroke-dasharray: none');
    // Still scoped to the flow stroke only (chips/arrowhead untouched by the @media).
    expect(block).toContain('.fo-flow');
  });

  test('AC2: an active edge still emits the arrowhead + chip kW (the data survives the motion kill)', () => {
    // The arrowhead (direction) + chip kW (magnitude) render unconditionally for an
    // ACTIVE edge regardless of motion — under reduced-motion they ARE the read.
    const { svg } = renderFor(awake.states as Record<string, unknown>);
    const active = svg.querySelector('.fo-edge .fo-flow')!.closest('.fo-edge')!;
    // Direction is legible from shape: the arrowhead <path> is present on the edge.
    expect(active.querySelector('.fo-head')).toBeTruthy();
    // Magnitude is legible from text: every present chip carries a kW value.
    const vals = [...svg.querySelectorAll('.fo-chip .fo-chip-val')];
    expect(vals.length).toBeGreaterThan(0);
    for (const v of vals) expect(v.textContent).toMatch(/[\d.]+ kW/);
  });

  // ── QA gap-fill (bmad-qa-generate-e2e-tests, Story 4.6) ──────────────────────
  // AC2 enumerates FOUR survivors of the motion kill: "the coloured stroke +
  // arrowhead + the chip's node-label + kW magnitude all remain". The test above
  // pins the arrowhead + kW; the node-LABEL (the colour-blind-safe "what node is
  // this") was unasserted — close it so the full enumerated data set is proven.
  test('AC2 gap: the chip node-label (not just the kW) also survives the motion kill', () => {
    const { model, svg } = renderFor(awake.states as Record<string, unknown>);
    const present = model.nodes.filter((n) => n.present);
    expect(present.length).toBeGreaterThan(0);
    // Every present node keeps its named label — direction(arrowhead) + magnitude(kW)
    // + identity(label) is the full static read AC2 demands.
    for (const n of present) {
      const label = svg.querySelector(`.fo-chip[data-role="${n.role}"] .fo-chip-label`);
      expect(label, n.role).toBeTruthy();
      expect(label!.textContent).toBe(STRINGS.energy.nodes[n.role]);
    }
  });

  // AC2 "keep the data" is enforced by CSS (@media), but jsdom does NOT evaluate
  // @media — the render-tier tests above prove the nodes are in the DOM, NOT that
  // the reduced-motion block leaves them visible. A future edit hiding the
  // arrowhead/chip INSIDE the @media (`display:none`/`visibility:hidden`/`opacity:0`)
  // would kill the data yet pass every render-tier test. This string-level guard
  // makes the rule regression-proof: the block may only HALT motion + flatten the
  // dash — it must never hide a survivor nor blank the flow stroke.
  test('AC2 gap: the reduced-motion block hides NOTHING (no display:none / visibility:hidden / opacity:0)', () => {
    const block = cssText.slice(cssText.indexOf('prefers-reduced-motion'));
    expect(block).not.toMatch(/display\s*:\s*none/i);
    expect(block).not.toMatch(/visibility\s*:\s*hidden/i);
    expect(block).not.toMatch(/opacity\s*:\s*0(?![.\d])/i);
    // It must not blank the flow stroke either (the directed line stays coloured) —
    // the only stroke-* it touches is the dash pattern (flattened to a solid line).
    expect(block).not.toMatch(/stroke\s*:\s*(none|transparent)/i);
  });

  test('chips are glass (--tc-surface-2 + --tc-border) and every var carries a fallback', () => {
    expect(cssText).toContain('--tc-surface-2');
    expect(cssText).toContain('--tc-border');
    // The styles.test.ts hard gate scans src+bundle, but assert it locally too: no
    // bare `var(--tc-x)` in THIS block — every consumption has a `, fallback`.
    const bare = cssText.match(/var\(\s*--tc-[a-z0-9-]+\s*\)/gi);
    expect(bare).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 4.6 AC3 — animation runs over CACHED geometry (~60fps, NFR-1): no per-tick
// layout thrash. The hero overlay's geometry is FIXED in the 1024×687 viewBox, so
// `update()` precomputes per-edge geometry ONCE and CSS animates `stroke-dashoffset`
// on the compositor — the non-thrashing equivalent of D4's "rAF over cached
// geometry". rAF-over-live-rects is the Scene renderer's concern (Epic 6).
// ═══════════════════════════════════════════════════════════════════════════
describe('AC3 — cached geometry + compositor-CSS motion (no per-tick thrash)', () => {
  test('update() caches: re-reading view() does NOT recompute (stable, side-effect-free output)', () => {
    const r = new HeroSvgRenderer();
    r.update(bindFlowModel(makeHass(awake.states as Record<string, unknown>), cfg(), {}));
    // Two reads of the SAME cached model render byte-for-byte identical SVG — view()
    // is a pure read of the precomputed `_edges`/`_chips`, never a recompute.
    expect(mount(r).innerHTML).toBe(mount(r).innerHTML);
  });

  test('motion is CSS-keyframe-driven, not JS-tick-driven: per-edge animation-duration is set inline', () => {
    const { svg } = renderFor(awake.states as Record<string, unknown>);
    const flow = svg.querySelector('.fo-edge .fo-flow')!;
    // The animation is declared in CSS (`animation: fo-flow-dash …` in the stylesheet)
    // and only its PERIOD is set inline per edge — there is no JS animation loop.
    expect(flow.getAttribute('style')).toMatch(/animation-duration:[\d.]+s/);
    expect(flowOverlayStyles.cssText).toContain('@keyframes fo-flow-dash');
    expect(flowOverlayStyles.cssText).toContain('animation: fo-flow-dash');
  });

  test('the Hero overlay module contains NO rAF / getBoundingClientRect (non-thrashing by construction)', () => {
    // Grep-style assertion on the module source (mirrors the no-bare-hass-states
    // discipline): the Hero path animates fixed geometry via compositor CSS, so it
    // introduces no JS animation loop and reads no live layout rect. (Those belong
    // to the Scene renderer over live cards — Epic 6, not here.)
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'hero-svg.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/requestAnimationFrame/);
    expect(src).not.toMatch(/getBoundingClientRect/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 — the overlay aria-label is STATE-BEARING (UX-DR18 honesty), mirroring the
// sibling carView's Story-3.5 state-bearing label: a screen-reader user reads the
// present nodes + kW from words, never the luminous hues alone.
// ───────────────────────────────────────────────────────────────────────────
describe('overlay aria-label is state-bearing (AC4, UX-DR18 honesty)', () => {
  test('awake → the label names each present node and its kW magnitude', () => {
    const { model, r } = renderFor(awake.states as Record<string, unknown>);
    const label = r.label();
    expect(label.startsWith(STRINGS.energy.flowLabel)).toBe(true);
    for (const n of model.nodes.filter((x) => x.present)) {
      expect(label).toContain(STRINGS.energy.nodes[n.role]);
    }
    expect(label).toMatch(/[\d.]+ kW/);
  });

  test('empty model → the bare flow label is the floor (no fabricated state)', () => {
    const { r } = renderFor(unresolved.states as Record<string, unknown>);
    expect(r.empty).toBe(true);
    expect(r.label()).toBe(STRINGS.energy.flowLabel);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1 — the role-keyed maps cover every EnergyRole (cannot silently omit a role).
// ───────────────────────────────────────────────────────────────────────────
describe('role-keyed maps are complete over EnergyRole (AC1)', () => {
  test('NODE_XY / NODE_COLOR / NODE_ICON each key exactly the energy roles', () => {
    const roles = [...ENERGY_ROLES].sort();
    expect(Object.keys(NODE_XY).sort()).toEqual(roles);
    expect(Object.keys(NODE_COLOR).sort()).toEqual(roles);
    expect(Object.keys(NODE_ICON).sort()).toEqual(roles);
  });

  // Story 9.14 — pin the generator's presentation metadata VALUES (the role-keyed
  // maps proving completeness above can't catch a wrong-but-present entry). The
  // copper accent MUST carry its DESIGN.md fallback (the styles.test.ts bare-var gate)
  // AND the token must be a real `--tc-copper` decl (the Epic-8 gate blind-spot lesson;
  // styles.test.ts enforces the decl exists). The icon is the verified `@mdi/js` path.
  test('the generator role pins copper NODE_COLOR + the mdiGeneratorStationary icon', () => {
    expect(NODE_COLOR.generator).toBe('var(--tc-copper, #c2855b)');
    expect(NODE_ICON.generator).toBe(mdiGeneratorStationary);
    // A source-band coordinate that does not collide with the other source nodes.
    for (const role of ['solar', 'grid', 'powerwall'] as const) {
      expect(NODE_XY.generator).not.toEqual(NODE_XY[role]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC2 — the renderer is HELD across renders (hero.ts): re-update must REPLACE,
// never accumulate, and an empty model must clear a previously-drawn overlay.
// ───────────────────────────────────────────────────────────────────────────
describe('held renderer: re-update replaces state and clears stale overlay (AC1, AC2)', () => {
  test('update(awake) → 5 chips; update(empty) on the SAME instance → empty, 0 chips', () => {
    const r = new HeroSvgRenderer();
    r.update(bindFlowModel(makeHass(awake.states as Record<string, unknown>), cfg(), {}));
    expect(mount(r).querySelectorAll('.fo-chip').length).toBe(5);
    expect(r.empty).toBe(false);

    // Same held instance, now fed a vehicle-only model → no stale chips linger.
    r.update(bindFlowModel(makeHass(unresolved.states as Record<string, unknown>), cfg(), {}));
    expect(r.empty).toBe(true);
    expect(mount(r).querySelectorAll('.fo-chip').length).toBe(0);
    expect(mount(r).querySelectorAll('.fo-edge').length).toBe(0);
  });
});
