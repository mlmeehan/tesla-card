import {
  LitElement,
  html,
  css,
  svg,
  nothing,
  type PropertyValues,
  type SVGTemplateResult,
  type TemplateResult,
} from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { formatNumber } from '../helpers';
import { formatAgeHint } from '../ui';
import { resolveEntities } from '../data/resolve';
import { resolveEnergyEntities, type EnergyEntities } from '../data/energy';
import { sliceChanged } from '../data/slice';
import { read, referenceNow } from '../data/freshness';
import { bindFlowModel, POWER_KEY } from '../flow/binding';
import { BUS_NODE_ID, IDLE_KW, type FlowEdge, type FlowModel } from '../flow/model';
import { SceneBusRenderer, sceneBusStyles, type RectLike } from '../flow/scene-bus';
import { edgeVisual, NODE_COLOR } from '../flow/renderer';
import {
  relativeAnchors,
  deriveBusAnchor,
  RafCoalescer,
  gatewaySegments,
  sceneAggregates,
  coupledRoles,
  axisForWidth,
  BUS_WIDTH_MAX,
  BUS_TRUNK_PAD,
  type BusAxis,
  type GatewaySegment,
} from '../flow/my-home';
import type { EnergyRole } from '../data/registry';
import type { HomeAssistant, LovelaceCard, TeslaCardConfig } from '../types';

// The five Scene-unaware child cards (Stories 6.2 / 6.3). Side-effect imports so
// `tc-my-home` registers its whole composition from this one module — even though
// the parent `tesla-card.ts` already imports them, this keeps the Scene element
// self-contained. `components ← components` is allowed (no cycle: none of these
// import `my-home`).
import './solar';
import './powerwall';
import './grid';
import './home';
import './wall-connector';

/**
 * The Gateway-bus trunk stroke — the ONE new sanctioned literal this story adds
 * (DESIGN.md:361), a deliberate named exception alongside the `panel-location` map
 * gradient and the `tc-slider` `#fff` thumb. It is the VALUE itself (a cool blue
 * over the navy trunk), NOT a `var(--tc-*)` token, so it carries no DESIGN.md
 * fallback — it is generic (not a brand colour), so the trade-dress gate passes.
 */
const GATEWAY_STROKE = '#cfe2ff';

/**
 * The Scene's two LAYOUT rows (Story 6.6/6.7) — a fixed role partition, NOT the
 * dynamic net-sign source/load (a Powerwall discharging still sits in the top
 * row). The order within each row is canonical (matches `SCENE_NODES`). Each row
 * is packed independently (Story 6.7): only its PRESENT roles render, with no
 * ghost cell — an absent node leaves nothing, so the minimal Grid+Home topology is
 * a single source card over a single load card, centred, not two lonely cards in
 * opposite corners of a three-column grid. Their concatenation IS `SCENE_NODES`
 * order, so `cellTags`/anchor walks are unchanged.
 */
const SOURCE_ROW: readonly EnergyRole[] = ['solar', 'powerwall', 'grid'];
const LOAD_ROW: readonly EnergyRole[] = ['home', 'wall_connector'];

/** node-id (EnergyRole) → the registered child-card tag that renders it. */
const NODE_TAG: Readonly<Record<EnergyRole, string>> = {
  solar: 'tc-solar',
  powerwall: 'tc-powerwall',
  grid: 'tc-grid',
  home: 'tc-home',
  wall_connector: 'tc-wall-connector',
} as const;

/**
 * `tc-my-home` — the "My Home" Scene orchestrator (Story 6.5, the Epic-6
 * centrepiece). It COMPOSES the six ecosystem cards into one live Scene driven by
 * the SAME Epic-4 energy model (FR-33: no Scene-specific flow engine), and it is
 * the FIRST place in the card to touch live DOM geometry — `getBoundingClientRect()`,
 * `ResizeObserver`/`IntersectionObserver`, an rAF-coalesced recompute.
 *
 * It owns exactly ONE {@link FlowModel} (via the unchanged `bindFlowModel`) and ONE
 * {@link SceneBusRenderer}, feeding the renderer LIVE rects through the same
 * `setAnchors` seam Story 4.4 proved against static stub rects. The children are
 * Scene-UNAWARE (FR-32): they read the shared `hass`, never each other; only
 * `tc-my-home` reads child rects (D4 layout interlink).
 *
 * Thin element (architecture 608–609): render + lifecycle here; the testable
 * geometry math lives in `flow/my-home.ts`, the state comparison in `data/slice.ts`.
 *
 * Scope fence: this is the orchestrator skeleton + live SceneBus STAR topology.
 * The Gateway running-net trunk, summary ribbon, focus-highlight, polished grid
 * and phone-reflow breakpoint are Story 6.6 — built on top of this, not here.
 */
@customElement('tc-my-home')
export class TcMyHome extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config!: TeslaCardConfig;

  @query('.scene') private _scene?: HTMLElement;

  /** The ONE renderer instance, held across renders (caches model + precompute). */
  private readonly _bus = new SceneBusRenderer();
  /** The ONE shared flow model, rebound on hass/config change in `willUpdate`. */
  private _model: FlowModel = { nodes: [], edges: [] };

  /** `_config` with `entities` filled by auto-resolution; passed to children. */
  private _resolvedConfig?: TeslaCardConfig;
  /** Auto-detected energy-site entities (the slice the Scene gates on). */
  private _energy?: EnergyEntities;
  /** Cache key on hass/config IDENTITY (mirrors solar.ts — keeps `hass.entities`/
   *  `hass.devices` reads inside `data/`, never bare in this element). */
  private _resolveCache?: { hass: unknown; config: TeslaCardConfig };

  // ── live-geometry lifecycle machinery (AR-8; no precedent in the codebase) ──
  private readonly _coalescer = new RafCoalescer();
  private _resizeObs?: ResizeObserver;
  private _intersectionObs?: IntersectionObserver;
  /** Visibility gate: an off-screen Scene does no geometry work. */
  private _visible = true;
  /** The present-node set the grid last rendered — geometry recomputes when it changes. */
  private _presentKey = '';

  // ── Story 6.6 — Gateway bus + focus-highlight state ─────────────────────────
  /** The latest container-relative anchors (incl. the {@link BUS_NODE_ID} junction) the overlay draws from. */
  private _anchors?: Record<string, RectLike>;
  /** The bus axis the last reflow resolved (`x` desktop horizontal / `y` phone vertical) — geometry-driven. */
  private _axis: BusAxis = 'x';
  /** The hovered/keyboard-focused role; drives the dim/light highlight (`undefined` = no focus). */
  @state() private _focused?: EnergyRole;

  // ── LovelaceCard contract (AC4) ────────────────────────────────────────────

  public setConfig(config: TeslaCardConfig): void {
    // Forward-compatible (R9): tolerate unknown keys, reject only a falsy config.
    if (!config) throw new Error('Invalid configuration');
    this._config = { ...config };
  }

  public getCardSize(): number {
    return 12; // a tall multi-card composition
  }

  public static getStubConfig(): TeslaCardConfig {
    return { type: 'tc-my-home' };
  }

  // ── model binding (AC1, AC2) — the UNCHANGED Epic-4 pipeline ────────────────

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') || changed.has('_config')) {
      this._resolve();
      if (this._config) {
        // The single shared model — same `bindFlowModel` the Hero calls (hero.ts:231).
        // Cheap (resolve → NaN-safe read → balance); geometry is NOT touched here.
        this._model = bindFlowModel(this.hass, this._config);
        this._bus.update(this._model);
      }
    }
  }

  /**
   * Slice-gating (AC3c): only re-render the Scene (and thus re-pass props to the
   * children) when a RELEVANT energy slice actually changed — unrelated entity
   * churn must not thrash the composition. Geometry recompute is reflow-driven and
   * lives outside this path entirely. An internal `requestUpdate()` (geometry →
   * overlay redraw) carries no gated prop, so it always renders.
   */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (!this.hasUpdated || changed.has('_config')) return true;
    if (!changed.has('hass')) return true; // internal redraw (geometry / overlay)
    const prev = changed.get('hass') as HomeAssistant | undefined;
    return sliceChanged(prev, this.hass, this._sliceIds());
  }

  /**
   * The resolved entity ids whose change must re-render the Scene — the UNION of
   * every entity the composed children actually read, NOT just the five `*_power`
   * sensors. The children also surface SOC / backup-reserve / operation-mode
   * (Powerwall), grid-status (Grid), session+plug+status (Wall Connector) and the
   * Solar weather vignette (6.4); gating on power alone would FREEZE those —
   * several of them PRIMARY readings — in the composed view until a coincidental
   * power tick. Truly-unrelated entities (lights, climate, the vehicle slice, …)
   * are absent from this union and still gate away, preserving the AC3c
   * anti-thrash invariant. (`Object.values` of `EnergyEntities` is exactly the
   * resolved energy ids; the children read nothing else outside it but weather/sun.)
   */
  private _sliceIds(): readonly (string | undefined)[] {
    const ids: (string | undefined)[] = this._energy ? Object.values(this._energy) : [];
    // The Solar card's vignette reads HA CORE entities (not energy function-slugs).
    const w = this._config?.weather;
    ids.push(w?.entity ?? 'weather.home', w?.sun ?? 'sun.sun');
    return ids;
  }

  /**
   * Resolve vehicle + energy entities once per hass/config change, keyed on object
   * identity (HA replaces `hass` only on a state change). Resolution reads the
   * registries INSIDE `data/` (`resolveEntities`/`resolveEnergyEntities`) — this
   * element never reads `hass.states`/`.entities`/`.devices` directly.
   */
  private _resolve(): void {
    if (!this._config) return;
    const c = this._resolveCache;
    if (c && c.hass === this.hass && c.config === this._config) return;
    this._resolvedConfig = {
      ...this._config,
      entities: resolveEntities(this.hass, this._config),
    };
    this._energy = resolveEnergyEntities(this.hass, this._config);
    this._resolveCache = { hass: this.hass, config: this._config };
  }

  // ── live-geometry lifecycle (AC3a/b, AC4 teardown) ──────────────────────────

  public override connectedCallback(): void {
    super.connectedCallback();
    this._ensureObservers();
    // Reconnected (already rendered once) → re-observe now; first connect waits
    // for `firstUpdated` (the `.scene` element does not exist before first render).
    if (this.hasUpdated) this._observeScene();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Bounded teardown (the Story-5.2 `RECONCILE_TIMEOUT_MS` discipline): no leaked
    // observer / rAF on a detached element.
    this._resizeObs?.disconnect();
    this._intersectionObs?.disconnect();
    this._resizeObs = undefined;
    this._intersectionObs = undefined;
    this._coalescer.cancel();
  }

  protected override firstUpdated(): void {
    this._observeScene();
    this._scheduleGeometry(); // initial layout
  }

  protected override updated(): void {
    // Recompute geometry when the PRESENT-NODE SET changes (a card appeared /
    // vanished — a genuine reflow), NOT on a value-only `hass` tick (AC3a:
    // geometry is reflow-driven, never tick-driven).
    const key = this._model.nodes
      .filter((n) => n.present)
      .map((n) => n.role)
      .join(',');
    if (key !== this._presentKey) {
      this._presentKey = key;
      this._scheduleGeometry();
    }
  }

  /** Construct observers lazily (jsdom lacks them — feature-detect, never throw). */
  private _ensureObservers(): void {
    if (!this._resizeObs && typeof ResizeObserver !== 'undefined') {
      this._resizeObs = new ResizeObserver(() => this._scheduleGeometry());
    }
    if (!this._intersectionObs && typeof IntersectionObserver !== 'undefined') {
      this._intersectionObs = new IntersectionObserver((entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        const became = visible && !this._visible;
        this._visible = visible;
        if (became) this._scheduleGeometry(); // recompute when it comes back on-screen
      });
    }
  }

  private _observeScene(): void {
    const scene = this._scene;
    if (!scene) return;
    this._resizeObs?.observe(scene);
    this._intersectionObs?.observe(scene);
  }

  /** Debounce a reflow burst into one rAF-aligned geometry recompute (AR-8). */
  private _scheduleGeometry(): void {
    if (!this._visible) return; // off-screen ⇒ no work
    this._coalescer.schedule(() => this._recomputeGeometry());
  }

  /**
   * Read each present child host's live rect, relativize to the container, derive
   * the bus junction, feed the renderer, and request an overlay redraw from the
   * (now cached) geometry. The ONLY `getBoundingClientRect()` reads in the card —
   * DOM geometry, not a `hass.states` read, so they belong in the element.
   */
  private _recomputeGeometry(): void {
    const scene = this._scene;
    if (!scene) return;
    const container = scene.getBoundingClientRect();
    const abs: Record<string, RectLike> = {};
    scene.querySelectorAll<HTMLElement>('[data-node]').forEach((cell) => {
      const role = cell.dataset.node;
      if (role) abs[role] = cell.getBoundingClientRect();
    });
    const rel = relativeAnchors(container, abs);
    const bus = deriveBusAnchor(rel);
    if (bus) rel[BUS_NODE_ID] = bus;
    this._bus.setAnchors(rel);
    // Story 6.6: cache the relativized anchors for the Gateway overlay.
    this._anchors = rel;
    // Story 6.7: the trunk axis follows the LAYOUT BREAKPOINT (the live container
    // width the ResizeObserver reports), NOT the raw anchor spread. Once the grid
    // packs (Task 1), the minimal 1-source/1-load topology stacks both cards at
    // ~the same x — a spread-based `busAxis` would flip the DESKTOP trunk vertical.
    // `axisForWidth` keeps desktop horizontal and flips to vertical only at the
    // `≤540px` phone reflow. Still reflow-driven (this runs ONLY here), never a
    // per-`hass`-tick recompute; the underlying geometry math is unchanged (FR-33).
    this._axis = axisForWidth(container.width);
    this.requestUpdate(); // redraw the overlay over the cached geometry
  }

  // ── render (AC1b, AC3d) ─────────────────────────────────────────────────────

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config) return nothing;
    const cfg = this._resolvedConfig ?? this._config;
    const present = new Set(this._model.nodes.filter((n) => n.present).map((n) => n.role));
    // The focus coupling (Task 4): when a card is hovered/focused, light it + every
    // node the shared bus couples it to (a source lights all loads, and converse);
    // the rest dim. Computed from the present model — never a hard-coded map.
    const lit = this._focused ? coupledRoles(this._model, this._focused) : undefined;

    // Render a card ONLY for present nodes — an absent node is omitted with its
    // bus edge (AC1), never an empty card holding a grid cell + a dead anchor.
    // Each cell is keyboard-focusable (`tabindex=0`) and drives the SAME highlight
    // on hover (`mouseenter`) and keyboard focus (`focusin`) — the a11y floor.
    const cell = (role: EnergyRole): TemplateResult => html`
      <div
        class="scene-cell ${lit?.has(role) ? 'lit' : ''}"
        data-node=${role}
        tabindex="0"
        @mouseenter=${() => this._focus(role)}
        @mouseleave=${this._blur}
        @focusin=${() => this._focus(role)}
        @focusout=${this._blur}
      >
        ${this._childCard(role, cfg)}
      </div>
    `;
    // Story 6.7 — PACK each row: render only the present cards in canonical order,
    // so an absent node leaves NOTHING (no 380px ghost cell, no dead `veh` slot).
    // A row with no present card is omitted entirely (no empty row eating the bus
    // channel). The two packed, centred rows keep sources-over-loads by construction.
    const sourceCells = SOURCE_ROW.filter((role) => present.has(role)).map(cell);
    const loadCells = LOAD_ROW.filter((role) => present.has(role)).map(cell);

    // Layering, back-to-front: the summary RIBBON (whole-home aggregates, above the
    // cards) → the cards (each composites its own vignette internally) → ONE
    // pointer-events:none bus overlay SVG drawing the Gateway running-net trunk. The
    // overlay draws in container-relative px (no viewBox), so the live anchors line
    // up 1:1 with the cards beneath. A vehicle-only / empty model ⇒ `_bus.empty` ⇒
    // the overlay is omitted (no occluding box).
    return html`
      <div class="scene ${this._focused ? 'focus' : ''}" role="group" aria-label=${STRINGS.scene.label}>
        ${this._ribbon()}
        <div class="scene-grid">
          ${sourceCells.length ? html`<div class="source-row">${sourceCells}</div>` : nothing}
          ${loadCells.length ? html`<div class="load-row">${loadCells}</div>` : nothing}
        </div>
        ${this._bus.empty
          ? nothing
          : html`<svg class="scene-bus" role="img" aria-label=${this._bus.label()}>
              ${this._gatewayView(lit)}
            </svg>`}
      </div>
    `;
  }

  // ── focus-highlight (AC3) ───────────────────────────────────────────────────
  private _focus(role: EnergyRole): void {
    this._focused = role;
  }
  private _blur = (): void => {
    this._focused = undefined;
  };

  // ── the summary ribbon (AC1b) ───────────────────────────────────────────────
  /**
   * The whole-home aggregate ribbon, derived from the SAME `computeBalance` net the
   * Gateway bus walks (so ribbon and bus agree by construction — a mismatch would be
   * a defect). Freshness-honest: a fully-quiescent (stale/asleep) Scene de-emphasizes
   * the confident tone (`.dim`) AND shows a last-known "updated Nm ago" stamp (via
   * `referenceNow`/`formatAgeHint`, never `Date.now()`) — never overstating freshness.
   */
  private _ribbon(): TemplateResult | typeof nothing {
    const presentNodes = this._model.nodes.filter((n) => n.present);
    if (!presentNodes.length) return nothing; // empty Scene ⇒ no ribbon (calm)

    const agg = sceneAggregates(this._model);
    const quiescent =
      this._model.edges.length > 0 && this._model.edges.every((e) => e.provenance === 'quiescent');
    const ageHint = quiescent ? this._sceneAgeHint() : undefined;
    const r = STRINGS.scene.ribbon;
    const kw = (v: number): string => `${formatNumber(Math.abs(v), 1)} ${r.unit}`;

    const netValue = !agg.gridPresent
      ? r.selfSupplied
      : agg.gridNet > IDLE_KW
        ? `${r.importing} ${kw(agg.gridNet)}`
        : agg.gridNet < -IDLE_KW
          ? `${r.exporting} ${kw(agg.gridNet)}`
          : r.selfSupplied;

    return html`
      <div class="ribbon ${quiescent ? 'dim' : ''}">
        <div class="ribbon-tile">
          <span class="rk">${r.generation}</span><span class="rv">${kw(agg.generation)}</span>
        </div>
        <div class="ribbon-tile">
          <span class="rk">${r.consumption}</span><span class="rv">${kw(agg.consumption)}</span>
        </div>
        <div class="ribbon-tile net">
          <span class="rk">${r.net}</span><span class="rv">${netValue}</span>
        </div>
        ${ageHint ? html`<span class="ribbon-age">${ageHint}</span>` : nothing}
      </div>
    `;
  }

  /**
   * The freshest "updated Nm ago" stamp across the present energy power reads — the
   * honest last-known hint when the Scene is quiescent. Routes the `hass.states`
   * access through `data/freshness` `read` (the sanctioned subtree) and measures age
   * against `referenceNow` (HA's own clock), never `Date.now()`.
   */
  private _sceneAgeHint(): string | undefined {
    if (!this._energy) return undefined;
    const now = referenceNow(this.hass);
    let newest: string | undefined;
    for (const node of this._model.nodes) {
      if (!node.present) continue;
      const id = this._energy[POWER_KEY[node.role]];
      if (!id) continue;
      const lu = read(this.hass, id, { now }).lastUpdated;
      if (lu && (!newest || Date.parse(lu) > Date.parse(newest))) newest = lu;
    }
    return formatAgeHint(newest, now);
  }

  // ── the Gateway running-net overlay (AC2) — drawn from the Task-1 segments ────
  /**
   * The Gateway bus overlay: ONE neutral trunk rail with per-segment Kirchhoff flows
   * (the {@link gatewaySegments} running net) + each present node's leg tapping onto
   * it. Option (b) of Task 2 — drawn in the element overlay from the pure segments,
   * leaving the Epic-4 engine files (`scene-bus.ts` data path) untouched (the
   * cleanest FR-33 story). The state-bearing colour-blind-safe text floor stays the
   * renderer's `label()` (the overlay's `aria-label`).
   */
  private _gatewayView(lit?: Set<EnergyRole>): SVGTemplateResult {
    const anchors = this._anchors;
    if (!anchors) return svg``;
    const segs = gatewaySegments(this._model, anchors, { axis: this._axis });
    return svg`${this._trunk(segs)}${this._legs(anchors, lit)}`;
  }

  /** The neutral trunk rail + per-segment animated flows + Kirchhoff arrowheads. */
  private _trunk(segs: GatewaySegment[]): SVGTemplateResult {
    if (!segs.length) return svg``;
    const horiz = this._axis === 'x';
    // Map an (along-axis pos, cross) pair to (x, y) for the chosen orientation.
    const P = (pos: number, cross: number): { x: number; y: number } =>
      horiz ? { x: pos, y: cross } : { x: cross, y: pos };

    const first = segs[0];
    const last = segs[segs.length - 1];
    const a = P(first.from - BUS_TRUNK_PAD, first.cross);
    const b = P(last.to, last.cross);
    const rail = svg`<line
      class="gw-trunk-base"
      x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y}
    ></line>`;

    const flows = segs.map((sg) => {
      if (!sg.active) return svg``; // dead rail (balanced cut) — calm, no flow
      const forward = sg.direction === 'forward';
      const s = P(forward ? sg.from : sg.to, sg.cross);
      const k = P(forward ? sg.to : sg.from, sg.cross);
      const mid = P((sg.from + sg.to) / 2, sg.cross);
      return svg`
        <line
          class="sb-flow"
          style="stroke:${GATEWAY_STROKE};animation-duration:${sg.durSec}s"
          stroke-width=${sg.width}
          x1=${s.x} y1=${s.y} x2=${k.x} y2=${k.y}
        ></line>
        ${this._arrow(mid, k, GATEWAY_STROKE)}
      `;
    });
    return svg`<g class="gw-trunk">${rail}${flows}</g>`;
  }

  /** A small arrowhead at `at`, pointing from `at` toward `toward`. */
  private _arrow(at: { x: number; y: number }, toward: { x: number; y: number }, color: string): SVGTemplateResult {
    const dx = toward.x - at.x;
    const dy = toward.y - at.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const px = -uy;
    const py = ux;
    const L = 9; // tip length
    const W = 5; // half-spread
    const tx = at.x + ux * L;
    const ty = at.y + uy * L;
    return svg`<path
      class="gw-head"
      style="fill:${color}"
      d="M ${tx} ${ty} L ${at.x + px * W} ${at.y + py * W} L ${at.x - px * W} ${at.y - py * W} Z"
    ></path>`;
  }

  /**
   * Each present node's leg: from the card edge FACING the trunk to the trunk line,
   * in the node's accent colour (motion when its edge is active). Source cards sit
   * one side of the trunk and load cards the other, so the near edge (and thus the
   * leg's down/up sense) falls straight out of the anchor's position vs the trunk.
   */
  private _legs(anchors: Readonly<Record<string, RectLike>>, lit?: Set<EnergyRole>): SVGTemplateResult {
    const horiz = this._axis === 'x';
    const bus = anchors[BUS_NODE_ID];
    const cross = bus ? (horiz ? bus.top + bus.height / 2 : bus.left + bus.width / 2) : 0;
    const edgeByRole = new Map<string, FlowEdge>();
    for (const e of this._model.edges) edgeByRole.set(e.from, e);

    const legs = this._model.nodes
      .filter((n) => n.present && anchors[n.role])
      .map((n) => {
        const rect = anchors[n.role];
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const pos = horiz ? cx : cy; // along-axis position of this tap
        // Near edge of the card (the one facing the trunk) along the cross axis.
        const near = horiz
          ? cy < cross
            ? rect.top + rect.height
            : rect.top
          : cx < cross
            ? rect.left + rect.width
            : rect.left;
        const start = horiz ? { x: pos, y: near } : { x: near, y: pos };
        const end = horiz ? { x: pos, y: cross } : { x: cross, y: pos };

        const edge = edgeByRole.get(n.role);
        const active = !!edge && edge.direction !== 'none';
        const color = NODE_COLOR[n.role];
        const flow = active
          ? svg`<line
              class="sb-flow"
              style="stroke:${color};animation-duration:${edgeVisual(edge!.kW).durSec}s"
              stroke-width=${Math.min(BUS_WIDTH_MAX, edgeVisual(edge!.kW).width)}
              x1=${start.x} y1=${start.y} x2=${end.x} y2=${end.y}
            ></line>`
          : nothing;
        return svg`
          <g class="gw-leg ${lit?.has(n.role) ? 'on' : ''}" data-role=${n.role}>
            <line class="gw-leg-base" style="stroke:${color}" x1=${start.x} y1=${start.y} x2=${end.x} y2=${end.y}></line>
            ${flow}
          </g>
        `;
      });
    return svg`${legs}`;
  }

  /** The Scene-unaware child for one role — same shared `.hass` + resolved `.config`. */
  private _childCard(role: EnergyRole, cfg: TeslaCardConfig): TemplateResult {
    const tag = NODE_TAG[role];
    switch (tag) {
      case 'tc-solar':
        return html`<tc-solar .hass=${this.hass} .config=${cfg}></tc-solar>`;
      case 'tc-powerwall':
        return html`<tc-powerwall .hass=${this.hass} .config=${cfg}></tc-powerwall>`;
      case 'tc-grid':
        return html`<tc-grid .hass=${this.hass} .config=${cfg}></tc-grid>`;
      case 'tc-home':
        return html`<tc-home .hass=${this.hass} .config=${cfg}></tc-home>`;
      default:
        return html`<tc-wall-connector .hass=${this.hass} .config=${cfg}></tc-wall-connector>`;
    }
  }

  static override styles = [
    sharedStyles,
    // The bus CSS (luminous dashes, glass chips, reduced-motion freeze) is reused
    // verbatim from the renderer — NOT re-authored here.
    sceneBusStyles,
    css`
      :host {
        display: block;
      }
      /* The positioning context for the absolute overlay; the live anchors are
         read relative to THIS box. */
      .scene {
        position: relative;
      }

      /* ── The summary ribbon (AC1b) — whole-home aggregates ABOVE the cards, so
         the cards stay the detail layer. Scene-local tiles (NOT a surface class, so
         the styles.test surface consumer gate stays untouched — the 6.2-6.5 trap). */
      .ribbon {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--tc-space-4, 16px);
        margin-bottom: var(--tc-space-4, 16px);
      }
      .ribbon-tile {
        display: flex;
        flex-direction: column;
        gap: var(--tc-space-1, 4px);
      }
      .ribbon .rk {
        font-size: var(--tc-fs-xs, 12px);
        font-weight: var(--tc-fw-medium, 550);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .ribbon .rv {
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, sans-serif));
        font-size: var(--tc-fs-lg, 20px);
        font-weight: var(--tc-fw-bold, 760);
        color: var(--tc-text, #f1f5f9);
      }
      .ribbon-tile.net .rv {
        color: var(--tc-blue, #38bdf8);
      }
      .ribbon-age {
        font-size: var(--tc-fs-xs, 12px);
        color: var(--tc-text-mute, #6b7787);
        margin-left: auto;
        align-self: center;
      }
      /* Honest freshness (UX-DR18): a fully-quiescent (stale/asleep) Scene
         de-emphasizes the confident tone — never overstates freshness. Reuse the
         canonical stale-dim token (--tc-dim-opacity, the same one the asleep card
         treatment uses) so the ribbon's de-emphasis matches the rest of the card. */
      .ribbon.dim {
        opacity: var(--tc-dim-opacity, 0.5);
      }

      /* ── The PACKED two-row source/load layout (Story 6.7, AC1/AC2): sources
         (Solar · Powerwall · Grid) over loads (Home · Wall Connector) — the wide
         row-gap is the channel the Gateway bus threads through. Each row PACKS its
         present cards (auto-flow column, fixed 380px tracks, 80px column gap,
         centred) so an absent node leaves NOTHING — no 380px ghost cell, no dead
         veh slot (the 6.6 role-fixed template-area placement is retired). The
         minimal Grid+Home topology is one source card centred over one load card,
         not two lonely cards in opposite corners. The canvas centres (a glance
         surface, not full-bleed). */
      .scene-grid {
        display: flex;
        flex-direction: column;
        align-items: center;
        row-gap: 150px;
      }
      .source-row,
      .load-row {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 380px;
        column-gap: 80px;
        justify-content: center;
      }
      .scene-cell {
        min-width: 0;
      }
      /* Keyboard focus ring — the 2px blue outline (EXPERIENCE.md:175 a11y floor),
         never the hairline border alone. */
      .scene-cell:focus-visible {
        outline: 2px solid var(--tc-blue, #38bdf8);
        outline-offset: 2px;
        border-radius: var(--tc-radius, 14px);
      }

      /* ── Focus-highlight (AC3): hover/keyboard focus dims the rest and lights the
         active legs + endpoint cards. A dim/light enhancement over the always-
         complete view — NO page change (the baked crossfade is retired). */
      .scene.focus .scene-cell {
        /* The mockup-specified focus de-emphasis (.4) — a distinct interaction value,
           not the stale-dim token; a literal like the sibling .gw-leg opacities. */
        opacity: 0.4;
        transition: opacity 0.18s ease;
      }
      .scene.focus .scene-cell.lit {
        opacity: 1;
      }

      /* ── The Gateway bus overlay (AC2): ONE pass-through SVG over the container
         (AC3d — taps reach the cards beneath). No viewBox: container px space. */
      .scene-bus {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
      }
      /* The neutral trunk rail (the navy channel the #cfe2ff flows ride). */
      .gw-trunk-base {
        stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        stroke-width: 7;
        stroke-linecap: round;
      }
      .gw-head {
        stroke: none;
      }
      /* Each present node's leg: a calm base in the node accent + (when active) a
         flowing sb-flow dash (reused from sceneBusStyles). */
      .gw-leg-base {
        stroke-width: 2;
        stroke-linecap: round;
        opacity: 0.45;
      }
      /* Focus: legs fade back; the coupled legs stay lit. Reduced-motion = instant
         cut (kill the motion, keep the data). */
      .scene.focus .gw-leg {
        opacity: 0.12;
        transition: opacity 0.18s ease;
      }
      .scene.focus .gw-leg.on {
        opacity: 1;
      }
      @media (prefers-reduced-motion: reduce) {
        .scene.focus .scene-cell,
        .scene.focus .gw-leg {
          transition: none;
        }
      }

      /* ── Phone reflow (AC2, ≤540px): both packed rows collapse to ONE full-width
         column (source cards then load cards, canonical order); the Gateway bus
         re-routes VERTICALLY (the element's axis selection flips to y at this same
         breakpoint — Story 6.7 axisForWidth, reflow-driven, no per-hass recompute).
         CSS @media can't read the --tc-* props, so the literal 540px (the
         established breakpoint, DESIGN.md:256) is used directly — the ONE TS mirror
         is SCENE_PHONE_MAX in flow/my-home.ts (the 6.6 rule). */
      @media (max-width: 540px) {
        .scene-grid {
          row-gap: var(--tc-space-4, 16px);
        }
        .source-row,
        .load-row {
          grid-auto-flow: row;
          grid-template-columns: 1fr;
          grid-auto-columns: auto;
          column-gap: 0;
          row-gap: var(--tc-space-4, 16px);
          width: 100%;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-my-home': TcMyHome;
  }
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tc-my-home',
  name: STRINGS.scene.name,
  description: STRINGS.scene.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});
