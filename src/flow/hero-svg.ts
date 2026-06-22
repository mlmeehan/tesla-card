import { svg, css, type SVGTemplateResult } from 'lit';
import type { EnergyRole } from '../data/registry';
import { HERO_VIEWBOX } from '../const';
import { STRINGS } from '../strings';
import { formatNumber } from '../helpers';
import type { FlowEdge, FlowModel } from './model';
import {
  edgeVisuals,
  NODE_COLOR,
  NODE_ICON,
  type FlowRenderer,
  type RoleVisual,
} from './renderer';

/**
 * D1 — the live {@link FlowRenderer} for the Hero (Story 4.3, AR-7 HeroSvg). It
 * draws the {@link FlowModel} produced by the Story-4.2 binding as a luminous
 * energy overlay composited over the car silhouette, in the FIXED 1024×687
 * {@link HERO_VIEWBOX} coordinate contract every Hero render mode shares (the same
 * space `carView` renders into — Epic 3's coordinate contract). It NEVER reads
 * `hass.states` or re-resolves entities: the binding owns that; this renderer
 * consumes the model only (so `no-bare-hass-states` stays green by construction).
 *
 * Boundary: `flow/` may import `lit` (`svg`/`css`, allowlisted) + `data/` types +
 * sibling `flow/` modules + root leaves (`strings`/`helpers`/`const`); it imports
 * NOTHING from `components/`. `tc-hero` (in `components/`) imports THIS — the
 * allowed `data → flow → components` direction (`no-cycle` enforces it).
 *
 * Thin-element split (architecture.md:575-588): all mapping/derivation lives in
 * this hub class (unit-tested); `tc-hero` stays render-only and composites
 * {@link HeroSvgRenderer.view} into its `.car-stage`. The imperative
 * `update(model): void` seam is what 4.4's `SceneBusRenderer` also implements —
 * here it just caches the model + precomputes static geometry (no DOM, no rAF:
 * the hero overlay's geometry is fixed, so CSS `stroke-dashoffset` is the right
 * tool; rAF over reflowing geometry is the Scene/Story-4.6 concern).
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Node-id → 1024×687 coordinate (NEW geometry for the hero overlay — NOT the
 * `100×102` panel cross copied verbatim). Chips ring the car silhouette so they
 * don't occlude it: solar high, grid/powerwall flanking, home low-centre,
 * wall-connector low-left near the charge-port quarter (`car.ts`
 * `DEFAULT_BODY_CHARGE_PORT {x:180,y:470}`). Every model edge is `role → bus`, so
 * {@link BUS_XY} is the central junction every luminous edge runs to. Keyed by
 * `EnergyRole` so it cannot omit a role.
 */
export const NODE_XY: Readonly<Record<EnergyRole, Point>> = {
  solar: { x: 512, y: 78 },
  grid: { x: 150, y: 232 },
  powerwall: { x: 874, y: 232 },
  home: { x: 512, y: 612 },
  wall_connector: { x: 196, y: 556 },
  // Story 9.14 — a source-band coordinate (upper region) that does not overlap solar
  // (512,78)/grid (150,232)/powerwall (874,232). Presentation metadata only — no math
  // impact (every edge is still role → BUS_XY); a generator is absent unless resolved.
  generator: { x: 330, y: 150 },
} as const;

/** The implicit electrical junction (role-less, no chip) every edge anchors to. */
export const BUS_XY: Point = { x: 512, y: 348 };

/** Glass-chip box (1024×687 units). Pill: `rx = height/2`. */
const CHIP_W = 224;
const CHIP_H = 92;

/**
 * Scale the canonical {@link edgeVisual} width (px-ish, shared with 4.4) into this
 * overlay's 1024-unit viewBox so strokes read at a sane weight once the SVG scales
 * down to the card. The DERIVATION stays shared/identical; only this presentation
 * scale is renderer-local (4.4 draws in screen px, so it uses width directly).
 */
const STROKE_SCALE = 1.7;

/** Arrowhead half-spread / length (1024 units). */
const ARROW = 18;

/** One precomputed, ready-to-draw edge. */
interface EdgeRender {
  role: EnergyRole;
  /** Flow source point (where the dash starts). */
  source: Point;
  /** Flow sink point (where the arrowhead sits). */
  sink: Point;
  /** SOURCE-node accent (the `from` node — FR-9: hue says where power comes from). */
  color: string;
  /** Stroke width in viewBox units (canonical × {@link STROKE_SCALE}). */
  width: number;
  /** Dash-flow period (seconds) from {@link edgeVisual}. */
  durSec: number;
  /** The model's resolved sense — surfaced as `data-direction` for a11y/tests. */
  direction: FlowEdge['direction'];
  /** Magnitude label, e.g. `7.4 kW`. */
  kwText: string;
  /** `false` for `direction:'none'` (quiescent/idle) → calm base track, no motion. */
  active: boolean;
}

/** One present node's chip data. */
interface ChipRender {
  role: EnergyRole;
  at: Point;
  color: string;
  icon: string;
  label: string;
  kwText: string;
}

function kwText(kW: number): string {
  return `${formatNumber(Math.abs(kW), 1)} kW`;
}

export class HeroSvgRenderer implements FlowRenderer {
  private _edges: EdgeRender[] = [];
  private _chips: ChipRender[] = [];
  private _visuals: RoleVisual[] = [];

  /**
   * Cache the model and precompute per-edge geometry + per-chip data (pure — no
   * DOM). Honors the model's omission (AC2): only `present` nodes get chips, and
   * only the edges the model emits are drawn — never a synthesized node/edge for
   * an absent role. The bus is role-less (no chip); each edge runs role↔bus.
   */
  update(model: FlowModel): void {
    const edgeByRole = new Map<string, FlowEdge>();
    for (const e of model.edges) edgeByRole.set(e.from, e);

    // The renderer-INDEPENDENT visual half (width/durSec/direction/colour/active)
    // comes from the ONE shared `edgeVisuals` derivation (R1: never a private copy);
    // SceneBus calls the identical function. Only the coordinates + STROKE_SCALE are
    // this renderer's local presentation.
    this._visuals = model.edges.map((e) => ({ role: e.from as EnergyRole, ...edgeVisuals(e) }));

    this._edges = model.edges.map((e) => {
      const role = e.from as EnergyRole;
      const nodePt = NODE_XY[role];
      // Arrow runs source→sink: forward = role→bus, reverse = bus→role. 'none'
      // (quiescent/idle) draws only the calm base track (source/sink unused for
      // the arrowhead). Colour is ALWAYS the `from` (role) node's accent (AC3).
      const forward = e.direction === 'forward';
      const v = edgeVisuals(e);
      return {
        role,
        source: forward ? nodePt : BUS_XY,
        sink: forward ? BUS_XY : nodePt,
        color: v.color,
        width: v.width * STROKE_SCALE,
        durSec: v.durSec,
        direction: v.direction,
        kwText: kwText(e.kW),
        active: v.active,
      };
    });

    this._chips = model.nodes
      .filter((n) => n.present)
      .map((n) => {
        const role = n.role;
        const edge = edgeByRole.get(role);
        return {
          role,
          at: NODE_XY[role],
          color: NODE_COLOR[role],
          icon: NODE_ICON[role],
          label: STRINGS.energy.nodes[role],
          kwText: edge ? kwText(edge.kW) : '—',
        };
      });
  }

  /**
   * `true` when the model has no present nodes (a vehicle-only install ⇒ empty
   * model ⇒ the element draws NOTHING — no `<svg>` chrome, no occluding box; AC2).
   */
  get empty(): boolean {
    return this._chips.length === 0;
  }

  /**
   * The per-edge SHARED derived visuals (`{role, width, durSec, direction, color,
   * active}`) — the PRE-presentation half (no `STROKE_SCALE`). Exposed so the Story
   * 4.4 R1 proof can compare this renderer's derivation against `SceneBusRenderer`'s
   * directly and assert they are IDENTICAL (only coordinates differ).
   */
  get visuals(): readonly RoleVisual[] {
    return this._visuals;
  }

  /**
   * STATE-BEARING aria-label for the overlay (UX-DR18 honesty floor, the same
   * principle AC4 cites for "readable without colour"). Mirrors `carView`'s
   * Story-3.5 `carLabel` ("Model Y · open: frunk, door"): the sibling surface in
   * the SAME `.car-stage` already announces its state, so the energy overlay must
   * too — a screen-reader / colour-blind user reads the present nodes + their kW
   * from WORDS, never the luminous hues alone. Appends the per-chip "Label kW"
   * read to the base flow label, e.g. "Energy power flow · Solar 6.0 kW, Home 1.2
   * kW". When empty the overlay isn't rendered, so the bare label is the floor.
   */
  label(): string {
    if (!this._chips.length) return STRINGS.energy.flowLabel;
    const read = this._chips.map((c) => `${c.label} ${c.kwText}`).join(', ');
    return `${STRINGS.energy.flowLabel} · ${read}`;
  }

  /**
   * The overlay's SVG-namespaced content (edges drawn first so chips sit on top).
   * `tc-hero` composites this inside its `<svg class="tc-flow-overlay">` so the
   * element stays thin. Returns the children only — the element owns the `<svg>`
   * root, viewBox + `pointer-events:none` (mirrors the `carView`/`carStyles`
   * primitive pattern: a render function + exported `css`, not a `tc-*` element).
   */
  view(): SVGTemplateResult {
    return svg`${this._edges.map((e) => this._edge(e))}${this._chips.map((c) =>
      this._chip(c)
    )}`;
  }

  /** A faint base track + (when active) a coloured animated dash with arrowhead. */
  private _edge(e: EdgeRender): SVGTemplateResult {
    const { source: s, sink: k } = e;
    const dx = k.x - s.x;
    const dy = k.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;

    const track = svg`<line
      class="fo-track"
      x1=${s.x}
      y1=${s.y}
      x2=${k.x}
      y2=${k.y}
    ></line>`;
    if (!e.active) {
      return svg`<g class="fo-edge" data-role=${e.role} data-direction=${e.direction}>${track}</g>`;
    }

    // Stop the dash short of the arrowhead, then draw the arrowhead at the sink
    // pointing along the flow (perpendicular = (−uy, ux)).
    const bx = k.x - ARROW * ux;
    const by = k.y - ARROW * uy;
    const px = -uy;
    const py = ux;
    const w = ARROW * 0.62;
    return svg`
      <g class="fo-edge" data-role=${e.role} data-direction=${e.direction}>
        ${track}
        <line
          class="fo-flow"
          style="stroke:${e.color};animation-duration:${e.durSec}s"
          stroke-width=${e.width}
          x1=${s.x}
          y1=${s.y}
          x2=${bx}
          y2=${by}
        ></line>
        <path
          class="fo-head"
          style="fill:${e.color}"
          d="M ${k.x} ${k.y} L ${bx + w * px} ${by + w * py} L ${bx - w * px} ${by - w * py} Z"
        ></path>
      </g>
    `;
  }

  /** A glass pill: surface-2 fill + border, monoline MDI icon, label + kW text. */
  private _chip(c: ChipRender): SVGTemplateResult {
    const x = c.at.x - CHIP_W / 2;
    const y = c.at.y - CHIP_H / 2;
    const iconSize = 36;
    return svg`
      <g class="fo-chip" data-role=${c.role} style="--fo-c:${c.color}" transform="translate(${x} ${y})">
        <rect class="fo-chip-bg" x="0" y="0" width=${CHIP_W} height=${CHIP_H} rx=${CHIP_H / 2}></rect>
        <g class="fo-chip-ico" transform="translate(24 ${CHIP_H / 2 - iconSize / 2}) scale(${iconSize / 24})">
          <path d=${c.icon}></path>
        </g>
        <text class="fo-chip-label" x="78" y=${CHIP_H / 2 - 8}>${c.label}</text>
        <text class="fo-chip-val" x="78" y=${CHIP_H / 2 + 26}>${c.kwText}</text>
      </g>
    `;
  }
}

/**
 * Overlay CSS — added to `tc-hero`'s `static styles` (the `carStyles` pattern).
 * Luminous dashed edges (`tc-flow-overlay` `stroke-dashoffset` grammar, per-edge
 * `animation-duration` set inline from {@link edgeVisual}), glass chips, monoline
 * icons (`fill: currentColor`). Every `var(--tc-*)` carries its DESIGN.md fallback
 * (the `styles.test.ts` hard gate). The `fo-flow-dash` keyframe lives OUTSIDE the
 * locked `sharedStyles` `{tc-pulse, tc-shimmer}` a11y corpus.
 *
 * Reduced-motion (FR-12 / UX-DR12, Story 4.6): the dash MOTION halts
 * (`animation: none`) AND the dash pattern is dropped (`stroke-dasharray: none`) so
 * the active edge reads as a clean STATIC directed line — not a frozen mid-cycle
 * dash gap. The coloured stroke, the always-on arrowhead (`.fo-head`) and the chip's
 * node-label + kW (`.fo-chip-val`) all stay legible — kill the motion, keep the data.
 */
export const flowOverlayStyles = css`
  .tc-flow-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2; /* above carView (z:1), below the battery button (separate block) */
    pointer-events: none; /* never captures taps — battery + car taps still work */
    overflow: visible;
  }
  .tc-flow-overlay .fo-track {
    stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
    stroke-width: 2;
    stroke-linecap: round;
  }
  .tc-flow-overlay .fo-flow {
    stroke-linecap: round;
    stroke-dasharray: 10 14;
    animation: fo-flow-dash 1s linear infinite;
    filter: drop-shadow(0 0 3px currentColor);
  }
  .tc-flow-overlay .fo-head {
    stroke: none;
  }
  @keyframes fo-flow-dash {
    to {
      stroke-dashoffset: -24;
    }
  }

  .tc-flow-overlay .fo-chip-bg {
    fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
    stroke-width: 1.5;
    filter: drop-shadow(var(--tc-shadow-sm, 0 6px 18px -8px rgba(0, 0, 0, 0.5)));
  }
  .tc-flow-overlay .fo-chip-ico path {
    fill: var(--fo-c, var(--tc-text-dim, #9aa7b8));
  }
  .tc-flow-overlay .fo-chip-label {
    fill: var(--tc-text-dim, #9aa7b8);
    font-family: var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    font-size: 22px;
    font-weight: 650;
    letter-spacing: 0.01em;
  }
  .tc-flow-overlay .fo-chip-val {
    fill: var(--tc-text, #f1f5f9);
    font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
    font-size: 28px;
    font-weight: 760;
    letter-spacing: -0.01em;
  }

  @media (prefers-reduced-motion: reduce) {
    /* AC2 (FR-12/UX-DR12 "kill the motion, keep the data") — the full static read
       hero-svg.ts deferred to THIS story. Halting the dash alone froze a mid-cycle
       dash GAP; also drop the dash pattern so the active edge reads as a clean SOLID
       directed line. Direction is then carried by the always-on arrowhead (fo-head)
       and magnitude by the chip kW (fo-chip-val) — both render unconditionally for
       an active edge, so the data survives the motion kill. */
    .tc-flow-overlay .fo-flow {
      animation: none;
      stroke-dasharray: none;
    }
  }
`;
