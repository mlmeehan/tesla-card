import type { EnergyRole } from '../data/registry';
import { ENERGY_ROLES } from './binding';
import { BUS_NODE_ID, IDLE_KW, type Direction, type FlowModel } from './model';
import { computeBalance, type Balance } from './balance';
import { edgeVisual } from './renderer';
import type { RectLike } from './scene-bus';

/**
 * D4 — "My Home" Scene orchestration HUB (Story 6.5).
 *
 * The pure / DOM-light helpers the `tc-my-home` element (`components/my-home.ts`)
 * delegates to — the "thin element" split: testable logic lives HERE in `flow/`,
 * the element file is render + lifecycle only. This hub does the geometry MATH
 * (anchor relativization, the bus junction, the reflow coalescer); the element
 * does the geometry READS (`getBoundingClientRect()`) and feeds the results here.
 *
 * Boundary: imports only `data/` types + sibling `flow/` + root leaves —
 * NOTHING from `components/` (`no-cycle` enforces the `data/ ← flow/ ←
 * components/` arrow; this is precisely WHY the orchestration logic lives in
 * `flow/`, not in the element). It touches no `hass`/`hass.states` (the element's
 * slice-gate routes through `data/slice`), no `lit`/DOM. `requestAnimationFrame`/
 * `cancelAnimationFrame` are global browser APIs (not imports) and are the ONLY
 * sanctioned loop (D3); the coalescer fires once per `schedule`, never on a timer.
 */

/**
 * The node-id order the Scene lays out and anchors — IS the five flow
 * `ENERGY_ROLES` (solar / powerwall / grid / home / wall_connector), re-exported
 * so the Scene never forks a second role list. There is no `vehicle` role: the
 * wall-connector edge IS the car-charging edge (the composed-view authority
 * split), and the Hero — not a Scene card — is the vehicle. The derived
 * {@link BUS_NODE_ID} junction is the only other anchor the Scene reads.
 */
export const SCENE_NODES: readonly EnergyRole[] = ENERGY_ROLES;

/**
 * The Scene's vehicle PRESENTATION-anchor id (Story 8.5). It is the `data-node`
 * value of the compact vehicle cell so the element's live-rect read captures it —
 * but it is deliberately NOT a flow node: there is no `vehicle` {@link
 * import('../data/registry').EnergyRole}, no `BUS_ORIENTATION` entry, no sixth
 * `FlowNode`. The car's charge comes from the EXISTING Wall-Connector edge
 * ({@link wcVehicleEdge}) — the composed-view authority split (FR-33 / AR-6: the
 * WC edge IS the car-charging edge). Distinct from {@link BUS_NODE_ID} so the two
 * non-tap anchors are filtered out of the trunk junction / axis math below.
 */
export const VEHICLE_NODE_ID = 'vehicle';

/**
 * The car-charging read (Story 8.5, AC2 — the #1 test target) — a PURE VIEW of the
 * UNCHANGED Epic-4 model's existing Wall-Connector edge, the SINGLE source both the
 * vehicle cell's charging badge AND the WC→Vehicle overlay edge consume (so the
 * shown "Charging · N.N kW" and the drawn edge AGREE BY CONSTRUCTION — the
 * Hero-halo-vs-edge authority class). This is NOT a FR-33-frozen engine edit: like
 * {@link gatewaySegments}/{@link sceneAggregates} it derives a presentation value
 * from `model.edges`, never a second balance / sign convention / sixth node.
 *
 * The WC edge is `{ from:'wall_connector', to:'bus', kW }` where `kW =
 * BUS_ORIENTATION.wall_connector(−1) × canonical wc_power` — so a CHARGING WC reads
 * NEGATIVE kW (it DRAWS from the bus to feed the car). The sign already encodes the
 * bus-direction; the magnitude the cell shows is the charge RATE, so we return
 * `Math.abs(kW)` — never re-deriving sign or orientation here. Charging is active
 * iff the edge exists and `direction !== 'none'`; an absent/idle WC ⇒ inactive
 * (the cell then falls back to the discrete `charging_status` for plugged/parked).
 */
export function wcVehicleEdge(model: FlowModel): { active: boolean; kW: number; direction: Direction } {
  const e = model.edges.find((x) => x.from === 'wall_connector');
  if (!e || e.direction === 'none') return { active: false, kW: 0, direction: 'none' };
  return { active: true, kW: Math.abs(e.kW), direction: e.direction };
}

/**
 * Convert ABSOLUTE viewport rects (`getBoundingClientRect()`) to
 * CONTAINER-RELATIVE coordinates by subtracting the container's own origin, so
 * the `pointer-events:none` bus overlay SVG — positioned over the container —
 * draws in the container's own coordinate space (mirrors the mockup's
 * `r.left - cb.left` relativization, `myhome-cards-bus.html:858–864`). Pure +
 * table-testable; widths/heights pass through unchanged (translation only).
 */
export function relativeAnchors(
  container: RectLike,
  rects: Readonly<Record<string, RectLike>>
): Record<string, RectLike> {
  const out: Record<string, RectLike> = {};
  for (const id of Object.keys(rects)) {
    const r = rects[id];
    out[id] = {
      left: r.left - container.left,
      top: r.top - container.top,
      width: r.width,
      height: r.height,
    };
  }
  return out;
}

/**
 * Derive the {@link BUS_NODE_ID} junction rect from the present node anchors — a
 * role-less, zero-size rect at the CENTROID of the present node centres (its
 * `centre()` IS the centroid point the star bus radiates from). The simplest
 * faithful default for 6.5: `SceneBusRenderer` already falls back to the centroid
 * of present anchors when no `'bus'` rect is supplied (`scene-bus.ts:185–198`),
 * so this is the explicit, table-testable version of that junction — supplying it
 * keeps the bus stable across reflows. (Story 6.6 replaces this star-junction with
 * the Gateway trunk — kept deliberately simple here.) Any existing `BUS_NODE_ID`
 * entry is excluded from the centroid so the derivation is idempotent. Returns
 * `undefined` when there are no node anchors (nothing to anchor a junction to).
 */
export function deriveBusAnchor(
  anchors: Readonly<Record<string, RectLike>>
): RectLike | undefined {
  // Exclude both non-tap anchors: the bus junction (idempotency) and the vehicle
  // presentation cell (Story 8.5 — it has a data-node but is NOT a bus tap, so it
  // must not move the trunk junction / flip the axis).
  const rects = Object.keys(anchors)
    .filter((k) => k !== BUS_NODE_ID && k !== VEHICLE_NODE_ID)
    .map((k) => anchors[k]);
  if (!rects.length) return undefined;
  const n = rects.length;
  const cx = rects.reduce((s, r) => s + r.left + r.width / 2, 0) / n;
  const cy = rects.reduce((s, r) => s + r.top + r.height / 2, 0) / n;
  // Zero-size rect: its centre IS (cx, cy) — the role-less junction point.
  return { left: cx, top: cy, width: 0, height: 0 };
}

/**
 * A tiny, dependency-free COALESCING scheduler: collapse a burst of reflow
 * callbacks into ONE rAF-aligned fire. A single pending `requestAnimationFrame`
 * handle — `schedule` is idempotent within a frame (extra calls while one is
 * pending are dropped, the first callback wins), `cancel` clears the pending fire.
 * This is the AR-8 debounce against reflow storms: `ResizeObserver`/
 * `IntersectionObserver` can fire many times in one layout pass, but the geometry
 * recompute runs at most once per frame.
 *
 * `requestAnimationFrame`/`cancelAnimationFrame` are the ONLY sanctioned loop
 * (D3) — and this coalescer never self-perpetuates: it fires once per `schedule`,
 * it does not re-arm itself, so there is no free-running rAF loop to leak (the
 * dash MOTION is pure CSS, `sceneBusStyles`). The rAF/cAF pair is injectable for
 * hermetic unit tests (a fake scheduler), defaulting to the globals at runtime.
 */
export class RafCoalescer {
  private _handle: number | null = null;
  private readonly _raf: (cb: () => void) => number;
  private readonly _caf: (handle: number) => void;

  constructor(
    raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    caf: (handle: number) => void = (h) => cancelAnimationFrame(h)
  ) {
    this._raf = raf;
    this._caf = caf;
  }

  /** Schedule `cb` for the next frame; idempotent while a fire is already pending. */
  schedule(cb: () => void): void {
    if (this._handle !== null) return; // already pending this frame — coalesce
    this._handle = this._raf(() => {
      this._handle = null;
      cb();
    });
  }

  /** Cancel any pending fire (teardown / `disconnectedCallback`). */
  cancel(): void {
    if (this._handle !== null) {
      this._caf(this._handle);
      this._handle = null;
    }
  }

  /** `true` while a fire is pending — for teardown assertions (no leak). */
  get pending(): boolean {
    return this._handle !== null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Story 6.6 — the Gateway running-net bus (a VIEW of the balance authority).
//
// FR-33 ↔ UX-DR14: the running-net is a RENDERING-LAYER derivation of the shared
// `FlowModel` node-nets, NOT a new engine. `computeBalance(model).net[role]` is
// each present node's signed bus injection (`+` source / `−` load — already
// oriented by the registry `BUS_ORIENTATION`); walking the present taps along the
// bus axis and accumulating those values IS the per-segment running net. No second
// balance, no copied sign convention, no `flow/{model,balance,binding}` edit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The trunk-flow WIDTH ceiling (`W_max`, canonical units) — the ONLY new constant
 * this story introduces. It clamps a very-high-kW segment's `edgeVisual` width so a
 * thick flow never overflows the bus trunk (whose neutral rail is {@link
 * BUS_TRUNK_WIDTH} px), MIRRORING the intent of `edgeVisual`'s existing `dur` floor
 * (a magnitude clamp at the high end). The kW→visual math itself stays the shared
 * {@link edgeVisual} — we only cap its `width` output here, never fork the formula.
 */
export const BUS_WIDTH_MAX = 7;

/** The neutral Gateway trunk rail width (px) — the channel the per-segment flows ride. */
export const BUS_TRUNK_WIDTH = 7;

/** Padding (px) the neutral rail extends past the outermost taps (the mockup pads the trunk). */
export const BUS_TRUNK_PAD = 24;

/** Which world axis the Gateway trunk runs along: `x` = horizontal (desktop), `y` = vertical (phone). */
export type BusAxis = 'x' | 'y';

/** A segment's flow sense: `forward` = toward increasing position (right/down), `reverse` = the converse. */
export type SegDirection = 'forward' | 'reverse' | 'none';

/**
 * One trunk segment between two consecutive taps — geometry-AGNOSTIC: `from`/`to`
 * are positions ALONG the bus axis and `cross` is the trunk's constant cross-axis
 * coordinate, so the SAME walk serves the desktop horizontal bus (`axis:'x'` →
 * `from`/`to` are x, `cross` is busY) and the phone vertical bus (`axis:'y'` →
 * `from`/`to` are y, `cross` is busX). `net` is the running sum crossing this cut.
 */
export interface GatewaySegment {
  /** Running net (kW, signed) crossing this segment: `+source / −load` accumulated along the axis. */
  net: number;
  /** Segment start position ALONG the bus axis (px). */
  from: number;
  /** Segment end position ALONG the bus axis (px) — the next tap, or the padded trunk end. */
  to: number;
  /** The trunk's constant CROSS-axis coordinate (px): busY for `axis:'x'`, busX for `axis:'y'`. */
  cross: number;
  /** Stroke width: `min(BUS_WIDTH_MAX, edgeVisual(net).width)` (the shared math + the new ceiling). */
  width: number;
  /** Dash-flow period (s): `edgeVisual(net).durSec` (the shared math — floor preserved). */
  durSec: number;
  /** Sign → sense: `net > 0` ⇒ `forward`, `net < 0` ⇒ `reverse`, `|net| < IDLE_KW` ⇒ `none`. */
  direction: SegDirection;
  /** `false` for a sub-deadband segment (`|net| < IDLE_KW`) — a dead/calm rail, no motion. */
  active: boolean;
}

/** A node anchor's centre coordinate along the chosen axis. */
function centreAlong(r: RectLike, axis: BusAxis): number {
  return axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
}

/**
 * Pick the bus axis from the present anchor SPREAD: the trunk runs along whichever
 * world axis the taps are spread WIDER on (Task 5 — "drive the trunk orientation
 * off the anchor spread"). The desktop `380px×3` grid spreads wide on x ⇒ `x`; the
 * `≤540px` single-column reflow stacks tall on y ⇒ `y`. The reflow itself is what
 * re-runs this (the 6.5 `ResizeObserver` → recompute), never a `hass` tick.
 */
export function busAxis(anchors: Readonly<Record<string, RectLike>>): BusAxis {
  // Exclude the bus junction AND the vehicle presentation cell (Story 8.5) — the
  // spread that picks the axis must be the BUS TAPS' spread, not perturbed by the
  // non-tap vehicle anchor.
  const rects = Object.keys(anchors)
    .filter((k) => k !== BUS_NODE_ID && k !== VEHICLE_NODE_ID)
    .map((k) => anchors[k]);
  if (rects.length < 2) return 'x';
  const xs = rects.map((r) => r.left + r.width / 2);
  const ys = rects.map((r) => r.top + r.height / 2);
  const xr = Math.max(...xs) - Math.min(...xs);
  const yr = Math.max(...ys) - Math.min(...ys);
  return xr >= yr ? 'x' : 'y';
}

/**
 * The Scene's `≤540px` single-column phone breakpoint (Story 6.7) — the literal
 * the element's axis selection keys off. Same value as the CSS `@media
 * (max-width:540px)` rule (DESIGN.md:256) and the 6.6 grid breakpoint, kept here
 * as the ONE TS constant so the layout-axis decision and the CSS reflow can never
 * drift onto different widths. CSS `@media` can't read a `--tc-*` prop and this
 * `BREAKPOINTS`-style constant is tree-shaken, so the literal lives in both — by
 * design (the 6.6 rule), not by duplication oversight.
 */
export const SCENE_PHONE_MAX = 540;

/**
 * Pick the Gateway trunk axis from the LAYOUT BREAKPOINT (Story 6.7), not the raw
 * anchor spread: desktop ⇒ horizontal `x` (sources-over-loads), the `≤540px` phone
 * single-column reflow ⇒ vertical `y`. PURE (container width in, axis out) — the
 * element calls this from its reflow path (`_recomputeGeometry`) with the live
 * container width the `ResizeObserver` reports.
 *
 * Why this exists: once the grid PACKS the present cards (Task 1), the minimal
 * 1-source-over-1-load topology stacks both cards at ~the same x, collapsing the
 * x-spread below the y-spread — so the spread-based {@link busAxis} would flip the
 * desktop trunk VERTICAL at the minimal topology, contradicting "desktop =
 * horizontal Gateway bus" (6.6 AC4). Driving the axis off the breakpoint keeps the
 * minimal Scene reading sources-over-loads with a horizontal trunk. `busAxis` is
 * unchanged — it stays the spread-based geometry helper (and its `opts.axis ??`
 * fallback in {@link gatewaySegments}); the element now CHOOSES the layout axis
 * explicitly. The math is untouched; only the axis SELECTION moved (FR-33).
 */
export function axisForWidth(width: number): BusAxis {
  return width <= SCENE_PHONE_MAX ? 'y' : 'x';
}

/**
 * The Gateway running-net derivation (Task 1 — the #1 test target). PURE: a
 * `FlowModel` (+ optional precomputed {@link Balance}) and relativized anchors in,
 * a plain {@link GatewaySegment}[] out — no DOM, no `hass`.
 *
 * Algorithm (mirrors `myhome-cards-bus.html:907–917`, but sourced from `net[]`, not
 * a hand-built tap array): take each present, anchored node's signed injection from
 * `computeBalance(model).net[role]` (called ONCE — never twice, never re-signed),
 * sort the taps by centre-position along the axis, walk them accumulating `run +=
 * net[role]`, and emit a segment per consecutive pair carrying that running `run`.
 * Each segment's width/dur come from the SHARED {@link edgeVisual} applied to the
 * segment net, with the new {@link BUS_WIDTH_MAX} ceiling on width; its sign sets
 * `direction`; a sub-`IDLE_KW` net is a dead rail (`active:false`). Where the
 * running net flips sign across a load fed from both sides, the adjacent segments'
 * directions CONVERGE on it — a truthful Kirchhoff read (falls out of the walk).
 */
export function gatewaySegments(
  model: FlowModel,
  anchors: Readonly<Record<string, RectLike>>,
  opts: { balance?: Balance; axis?: BusAxis } = {}
): GatewaySegment[] {
  const net = (opts.balance ?? computeBalance(model)).net;
  const axis = opts.axis ?? busAxis(anchors);

  // Present, anchored taps — each tap's value IS its signed bus injection net[role]
  // (do NOT re-apply orientation: BUS_ORIENTATION already baked +source/−load in).
  const taps = model.nodes
    .filter((n) => n.present && anchors[n.role])
    .map((n) => ({ pos: centreAlong(anchors[n.role], axis), k: net[n.role] ?? 0 }))
    .sort((a, b) => a.pos - b.pos);
  if (!taps.length) return [];

  // The trunk's cross-axis line: the bus-junction centre (reuse deriveBusAnchor's
  // centroid when no explicit BUS_NODE_ID rect was supplied).
  const bus = anchors[BUS_NODE_ID] ?? deriveBusAnchor(anchors);
  const cross = bus ? (axis === 'x' ? bus.top + bus.height / 2 : bus.left + bus.width / 2) : 0;
  const trunkEnd = taps[taps.length - 1].pos + BUS_TRUNK_PAD;

  let run = 0;
  const segs: GatewaySegment[] = [];
  for (let i = 0; i < taps.length; i++) {
    run += taps[i].k;
    const netRun = run;
    const to = i + 1 < taps.length ? taps[i + 1].pos : trunkEnd;
    const mag = Math.abs(netRun);
    const active = mag >= IDLE_KW;
    const { width, durSec } = edgeVisual(netRun);
    segs.push({
      net: netRun,
      from: taps[i].pos,
      to,
      cross,
      width: Math.min(BUS_WIDTH_MAX, width),
      durSec,
      direction: !active ? 'none' : netRun > 0 ? 'forward' : 'reverse',
      active,
    });
  }
  return segs;
}

/** Whole-home aggregates for the summary ribbon — derived from the ONE balance net. */
export interface SceneAggregates {
  /** Σ of the positive node nets (sources injecting into the bus), kW. */
  generation: number;
  /** Σ of the |negative node nets| (loads drawing from the bus), kW. */
  consumption: number;
  /** The grid's signed net (`+` import / `−` export), kW; `0` when grid is absent. */
  gridNet: number;
  /** `true` when a grid node is present (else the site is islanded / self-supplied). */
  gridPresent: boolean;
}

/**
 * Compute the ribbon aggregates from `computeBalance(model).net` — the SAME source
 * the bus segments walk, so the ribbon and bus AGREE BY CONSTRUCTION (a mismatch
 * would be a defect, the Hero halo-vs-edge authority class). Role-generic: source
 * vs load is read off the net SIGN (the registry orientation), never a per-role
 * branch. The grid term is the honest "net" headline (import/export, or
 * self-supplied when the grid is absent).
 */
export function sceneAggregates(model: FlowModel, balance?: Balance): SceneAggregates {
  const net = (balance ?? computeBalance(model)).net;
  let generation = 0;
  let consumption = 0;
  let gridPresent = false;
  for (const node of model.nodes) {
    if (!node.present) continue;
    if (node.role === 'grid') gridPresent = true;
    const v = net[node.role] ?? 0;
    if (v > IDLE_KW) generation += v;
    else if (v < -IDLE_KW) consumption += -v;
  }
  return { generation, consumption, gridNet: gridPresent ? (net['grid'] ?? 0) : 0, gridPresent };
}

/** A node's role THIS tick, by net sign (Powerwall flips source↔load honestly). */
export type RoleKind = 'source' | 'load' | 'idle';

/** Classify a role as a source/load/idle by its signed net (`> IDLE_KW` / `< −IDLE_KW`). */
export function roleKind(net: Readonly<Record<string, number>>, role: EnergyRole): RoleKind {
  const n = net[role] ?? 0;
  if (n > IDLE_KW) return 'source';
  if (n < -IDLE_KW) return 'load';
  return 'idle';
}

/**
 * The focus-highlight coupling (Task 4), COMPUTED from the present model — never a
 * hard-coded 6-node map (the mockup `HILITE`). On a shared bus every present source
 * couples to every present load (and the converse): focusing a source lights all
 * current loads; focusing a load lights all current sources. The focused node is
 * always in the set. An idle-tick node (sub-deadband) lights only itself. Returns
 * the set of roles to LIGHT (the rest dim).
 */
export function coupledRoles(model: FlowModel, focused: EnergyRole, balance?: Balance): Set<EnergyRole> {
  const net = (balance ?? computeBalance(model)).net;
  const present = model.nodes.filter((n) => n.present).map((n) => n.role);
  const lit = new Set<EnergyRole>([focused]);
  const kind = roleKind(net, focused);
  if (kind === 'source') {
    for (const r of present) if (roleKind(net, r) === 'load') lit.add(r);
  } else if (kind === 'load') {
    for (const r of present) if (roleKind(net, r) === 'source') lit.add(r);
  }
  return lit;
}
