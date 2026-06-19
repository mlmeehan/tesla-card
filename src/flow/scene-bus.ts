import { svg, css, type SVGTemplateResult } from 'lit';
import type { EnergyRole } from '../data/registry';
import { STRINGS } from '../strings';
import { formatNumber } from '../helpers';
import { BUS_NODE_ID, type FlowEdge, type FlowModel } from './model';
import {
  edgeVisuals,
  NODE_COLOR,
  NODE_ICON,
  type EdgeVisuals,
  type FlowRenderer,
  type RoleVisual,
} from './renderer';

/**
 * D1 — the SECOND {@link FlowRenderer} (Story 4.4, AR-7 SceneBus, R1 pulled
 * forward). It draws the SAME {@link FlowModel} the {@link import('./hero-svg').
 * HeroSvgRenderer} draws, deriving every edge's visual from the ONE shared
 * {@link edgeVisuals} function — so "one model serves both renderers" is proven
 * structurally. The ONLY thing that differs from HeroSvg is the COORDINATE SOURCE:
 * HeroSvg reads a static `NODE_XY`/`BUS_XY` map in the fixed 1024×687 viewBox;
 * SceneBus reads the CENTRES of live `getBoundingClientRect()`-shaped anchors
 * (screen px). It consumes a `FlowModel` only — it NEVER reads `hass.states` or
 * re-resolves entities (the Story-4.2 binding owns that), so `no-bare-hass-states`
 * stays green by construction.
 *
 * Boundary: `flow/` may import `lit` (`svg`/`css`, allowlisted) + `data/` types +
 * sibling `flow/` modules + root leaves (`strings`/`helpers`); it imports NOTHING
 * from `components/` (`no-cycle` enforces the `data → flow → components` arrow).
 *
 * ── AC4 SCOPE BOUNDARY (what this proof does NOT de-risk — Epic 6 / AR-8 owns it) ──
 * This story proves the INTERFACE against STATIC synthetic stub rects only. It does
 * NOT de-risk: live `getBoundingClientRect()` under real element lifecycle,
 * `ResizeObserver`/`IntersectionObserver` geometry coalescing/debounce, the rAF-over-
 * cached-geometry animation loop, or `pointer-events` layering of a live bus overlay.
 * Those remain Epic-6 "live wiring" — NOT "already proven." The Epic-6 wiring feeds
 * REAL rects through the SAME `setAnchors`/`anchorFor` seam and wraps this unchanged
 * core in the rAF/ResizeObserver loop; nothing here builds `tc-my-home`, the six
 * ecosystem `tc-*` cards, a `ResizeObserver`, or an rAF loop.
 */

interface Point {
  x: number;
  y: number;
}

/**
 * The `getBoundingClientRect()` SUBSET SceneBus actually needs — the minimal anchor
 * shape. The SAME code path serves Epic-6 live rects (`el.getBoundingClientRect()`)
 * and this story's static stub rects: only the VALUES differ, never the type. (A real
 * `DOMRect` is a structural superset, so it satisfies `RectLike` with no adapter.)
 */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** An anchor's centre point — the chip/edge attaches here (rect midpoint). */
function centre(r: RectLike): Point {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function kwText(kW: number): string {
  return `${formatNumber(Math.abs(kW), 1)} kW`;
}

/** Arrowhead half-spread / length (screen px — SceneBus draws in px, not viewBox units). */
const ARROW = 10;

/** One precomputed edge: the SHARED derived visual + role + magnitude label. */
interface SceneEdge extends EdgeVisuals {
  role: EnergyRole;
  /** Magnitude label, e.g. `7.4 kW`. */
  kwText: string;
}

/** One present node's chip data (geometry resolved from its anchor at draw time). */
interface SceneChip {
  role: EnergyRole;
  color: string;
  icon: string;
  label: string;
  kwText: string;
}

/** Glass-chip box (screen px). Pill: `rx = height/2`. */
const CHIP_W = 132;
const CHIP_H = 54;

export class SceneBusRenderer implements FlowRenderer {
  private _edges: SceneEdge[] = [];
  private _chips: SceneChip[] = [];
  private _visuals: RoleVisual[] = [];
  private _anchors: Record<string, RectLike> = {};

  /**
   * Cache the model + precompute per-edge visuals (via the SHARED {@link edgeVisuals})
   * and per-chip data — pure, NO DOM (mirrors `HeroSvgRenderer.update`). Geometry is
   * NOT computed here: the anchor source is a SEPARATE, swappable input
   * ({@link setAnchors}/{@link anchorFor}), so `update(model)` stays DOM-free and the
   * same precompute serves any rect substrate. Honors the model's omission (AC2):
   * only `present` nodes get chips, only the edges the model emits are drawn.
   */
  update(model: FlowModel): void {
    const edgeByRole = new Map<string, FlowEdge>();
    for (const e of model.edges) edgeByRole.set(e.from, e);

    // Derive each edge's shared visual ONCE (the one `edgeVisuals` call) and reuse it
    // for both the proof-facing `_visuals` and the draw-facing `_edges` — same data,
    // no double-compute, no chance the two views drift.
    this._visuals = model.edges.map((e) => ({ role: e.from as EnergyRole, ...edgeVisuals(e) }));

    this._edges = this._visuals.map((v, i) => ({
      ...v,
      kwText: kwText(model.edges[i].kW),
    }));

    this._chips = model.nodes
      .filter((n) => n.present)
      .map((n) => {
        const edge = edgeByRole.get(n.role);
        return {
          role: n.role,
          color: NODE_COLOR[n.role],
          icon: NODE_ICON[n.role],
          label: STRINGS.energy.nodes[n.role],
          kwText: edge ? kwText(edge.kW) : '—',
        };
      });
  }

  /**
   * Supply the anchor rects (node-id → {@link RectLike}). This is the ONE input that
   * differs from HeroSvg's static map — Epic 6 calls it with live
   * `el.getBoundingClientRect()` rects through this SAME seam; this proof calls it
   * with static synthetic stub rects. Includes the {@link BUS_NODE_ID} junction's
   * rect (optional — see {@link _busPoint} for the centroid fallback).
   */
  setAnchors(rects: Readonly<Record<string, RectLike>>): void {
    this._anchors = { ...rects };
  }

  /** The current anchor for a node-id (or `null` if none supplied) — the pluggable lookup. */
  anchorFor(nodeId: string): RectLike | null {
    return this._anchors[nodeId] ?? null;
  }

  /**
   * `true` when the model has no present nodes (a vehicle-only / empty model ⇒
   * nothing drawn — mirrors HeroSvg AC2).
   */
  get empty(): boolean {
    return this._chips.length === 0;
  }

  /**
   * The per-edge SHARED derived visuals (`{role, width, durSec, direction, color,
   * active}`) — the PRE-presentation half. SceneBus draws in screen px and uses
   * `width` DIRECTLY (no `STROKE_SCALE`), so this IS what it renders. Exposed so the
   * R1 proof compares it against `HeroSvgRenderer.visuals` and asserts they are
   * IDENTICAL (the committed evidence that neither renderer forked the math).
   */
  get visuals(): readonly RoleVisual[] {
    return this._visuals;
  }

  /**
   * STATE-BEARING aria-label (UX-DR18 honesty floor) — identical grammar to HeroSvg:
   * names each present node + its kW so the state reads from WORDS, never hue alone.
   */
  label(): string {
    if (!this._chips.length) return STRINGS.energy.flowLabel;
    const read = this._chips.map((c) => `${c.label} ${c.kwText}`).join(', ');
    return `${STRINGS.energy.flowLabel} · ${read}`;
  }

  /**
   * The bus junction's point: the provided `'bus'` anchor centre if supplied, else
   * the CENTROID of the present node anchors (a sensible role-less junction when the
   * host gives node rects but no explicit bus rect). `null` when no present anchors
   * exist at all (nothing to draw).
   */
  private _busPoint(): Point | null {
    const bus = this._anchors[BUS_NODE_ID];
    if (bus) return centre(bus);
    const pts = this._chips
      .map((c) => this._anchors[c.role])
      .filter((r): r is RectLike => Boolean(r))
      .map(centre);
    if (!pts.length) return null;
    const n = pts.length;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }

  /**
   * The drawn output (SVG-namespaced children — edges first, chips on top), parallel
   * to HeroSvg's `view()` so the proof can mount it with Lit `render` WITHOUT any live
   * DOM measurement. Edges/chips for nodes whose anchor is missing are simply not
   * drawn (AC1: "absent nodes / missing anchors are not drawn").
   */
  view(): SVGTemplateResult {
    const bus = this._busPoint();
    const edges =
      bus === null
        ? []
        : this._edges
            .filter((e) => this._anchors[e.role])
            .map((e) => this._edge(e, this._anchors[e.role], bus));
    const chips = this._chips
      .filter((c) => this._anchors[c.role])
      .map((c) => this._chip(c, this._anchors[c.role]));
    return svg`${edges}${chips}`;
  }

  /**
   * A faint base track + (when active) a coloured animated dash with arrowhead —
   * IDENTICAL grammar/logic to HeroSvg's `_edge`, sourcing the two points from rect
   * CENTRES instead of `NODE_XY`/`BUS_XY`. `forward` = role→bus, `reverse` = bus→role,
   * `none` = calm track only (no motion). Width is the shared `edgeVisual` width
   * DIRECTLY (screen px — no presentation scale).
   */
  private _edge(e: SceneEdge, rect: RectLike, bus: Point): SVGTemplateResult {
    const node = centre(rect);
    const forward = e.direction === 'forward';
    const s = forward ? node : bus;
    const k = forward ? bus : node;

    const track = svg`<line
      class="sb-track"
      x1=${s.x}
      y1=${s.y}
      x2=${k.x}
      y2=${k.y}
    ></line>`;
    if (!e.active) {
      return svg`<g class="sb-edge" data-role=${e.role} data-direction=${e.direction}>${track}</g>`;
    }

    const dx = k.x - s.x;
    const dy = k.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const bx = k.x - ARROW * ux;
    const by = k.y - ARROW * uy;
    const px = -uy;
    const py = ux;
    const w = ARROW * 0.62;
    return svg`
      <g class="sb-edge" data-role=${e.role} data-direction=${e.direction}>
        ${track}
        <line
          class="sb-flow"
          style="stroke:${e.color};animation-duration:${e.durSec}s"
          stroke-width=${e.width}
          x1=${s.x}
          y1=${s.y}
          x2=${bx}
          y2=${by}
        ></line>
        <path
          class="sb-head"
          style="fill:${e.color}"
          d="M ${k.x} ${k.y} L ${bx + w * px} ${by + w * py} L ${bx - w * px} ${by - w * py} Z"
        ></path>
      </g>
    `;
  }

  /** A glass pill anchored at the node's rect centre: surface fill + border, MDI icon, label + kW. */
  private _chip(c: SceneChip, rect: RectLike): SVGTemplateResult {
    const at = centre(rect);
    const x = at.x - CHIP_W / 2;
    const y = at.y - CHIP_H / 2;
    const iconSize = 22;
    return svg`
      <g class="sb-chip" data-role=${c.role} style="--sb-c:${c.color}" transform="translate(${x} ${y})">
        <rect class="sb-chip-bg" x="0" y="0" width=${CHIP_W} height=${CHIP_H} rx=${CHIP_H / 2}></rect>
        <g class="sb-chip-ico" transform="translate(16 ${CHIP_H / 2 - iconSize / 2}) scale(${iconSize / 24})">
          <path d=${c.icon}></path>
        </g>
        <text class="sb-chip-label" x="48" y=${CHIP_H / 2 - 4}>${c.label}</text>
        <text class="sb-chip-val" x="48" y=${CHIP_H / 2 + 16}>${c.kwText}</text>
      </g>
    `;
  }
}

/**
 * Scene-bus CSS — the SceneBus equivalent of `flowOverlayStyles`. Same luminous
 * grammar (dashed `stroke-dashoffset` edges, glass chips, monoline icons via
 * `fill: currentColor`), drawn in screen px. Every `var(--tc-*)` carries its
 * DESIGN.md fallback (the `styles.test.ts` hard gate). The `sb-flow-dash` keyframe
 * lives OUTSIDE the locked `sharedStyles` `{tc-pulse, tc-shimmer}` a11y corpus.
 *
 * Reduced-motion (AC4): the dash MOTION halts while the coloured stroke, arrowhead,
 * label + kW stay legible — kill the motion, keep the data.
 *
 * NOTE: SceneBus has no host element this epic (it's wired into `tc-my-home` in
 * Epic 6). These styles ship with that host later; they are exported now so the
 * one renderer owns its presentation contract alongside its markup.
 */
export const sceneBusStyles = css`
  .sb-track {
    stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
    stroke-width: 2;
    stroke-linecap: round;
  }
  .sb-flow {
    stroke-linecap: round;
    stroke-dasharray: 8 12;
    animation: sb-flow-dash 1s linear infinite;
    filter: drop-shadow(0 0 3px currentColor);
  }
  .sb-head {
    stroke: none;
  }
  @keyframes sb-flow-dash {
    to {
      stroke-dashoffset: -20;
    }
  }

  .sb-chip-bg {
    fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
    stroke-width: 1.5;
    filter: drop-shadow(var(--tc-shadow-sm, 0 6px 18px -8px rgba(0, 0, 0, 0.5)));
  }
  .sb-chip-ico path {
    fill: var(--sb-c, var(--tc-text-dim, #9aa7b8));
  }
  .sb-chip-label {
    fill: var(--tc-text-dim, #9aa7b8);
    font-family: var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    font-size: 14px;
    font-weight: 650;
    letter-spacing: 0.01em;
  }
  .sb-chip-val {
    fill: var(--tc-text, #f1f5f9);
    font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
    font-size: 17px;
    font-weight: 760;
    letter-spacing: -0.01em;
  }

  @media (prefers-reduced-motion: reduce) {
    .sb-flow {
      animation: none;
    }
  }
`;
