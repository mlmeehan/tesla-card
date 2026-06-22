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
import { entityId, formatNumber, isAsleep, rawState } from '../helpers';
import { formatAgeHint, icon } from '../ui';
import { resolveEntities } from '../data/resolve';
import { resolveEnergyEntities, type EnergyEntities } from '../data/energy';
import { sliceChanged } from '../data/slice';
import { read, referenceNow } from '../data/freshness';
import { bindFlowModel, POWER_KEY } from '../flow/binding';
import { BUS_NODE_ID, IDLE_KW, type Direction, type FlowEdge, type FlowModel } from '../flow/model';
import { SceneBusRenderer, sceneBusStyles, type RectLike } from '../flow/scene-bus';
import { edgeVisual, NODE_COLOR, NODE_ICON } from '../flow/renderer';
import { computeBalance } from '../flow/balance';
import {
  relativeAnchors,
  busAnchorBetweenRows,
  RafCoalescer,
  gatewaySegments,
  selfPowered,
  ribbonTiles,
  coupledRoles,
  axisForWidth,
  wcVehicleEdge,
  VEHICLE_NODE_ID,
  BUS_WIDTH_MAX,
  BUS_TRUNK_PAD,
  type BusAxis,
  type GatewaySegment,
  type RibbonTile,
} from '../flow/my-home';
import type { EnergyRole, Role } from '../data/registry';
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
 * Story 8.12 (CAP-3): the cross-axis length (container px) above which a node's Gateway
 * leg counts as "long" and earns the `.long` conduit polish. Short hops (~75–90px) stay
 * calm hairlines; a short source card's now-honest leg (Solar — ~400px once its cell
 * stops ballooning under align-items:start, Task 1) crosses this and reads as a deliberate
 * energy conduit, resolving the Longer-Leg Paradox. A layout constant (not a brand/
 * trade-dress literal), a starting point tuned against the desktop screenshot (Task 7).
 */
const LONG_LEG_PX = 160;

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

/**
 * Story 9.3: the load row's ORDERING domain — the two energy loads PLUS the
 * synthetic `'vehicle'` presentation cell, so `energy.nodes.order` can place the car
 * anywhere in the load row (not just trailing). The canonical sequence ENDS in
 * `'vehicle'`, so a defaulted/absent/garbage `order` keeps it trailing — byte-for-byte
 * Story 8.10's behaviour (zero-diff). This is NOT a flow-node list (the vehicle never
 * enters `gatewaySegments`' tap walk — it is not a `FlowNode`); it is purely the
 * load-row CELL packing domain. The energy loads stay `LOAD_ROW` everywhere else.
 */
const LOAD_ROW_WITH_VEHICLE: readonly Role[] = ['home', 'wall_connector', 'vehicle'];

/**
 * Story 9.3 — order a row's PRESENT roles by the user's `order` list. A STABLE
 * PARTITION: `[roles listed in `order` (this row, present, first-occurrence wins)] ++
 * [this row's present roles NOT listed, in canonical order]`. Everything that is not a
 * present member of THIS row drops out by construction — an other-row role (fails the
 * `rowSet` membership), an absent or 9.2-hidden role (fails `presentRoles`), an unknown
 * string and a duplicate (deduped via `seen`). So AC4's "ignore gracefully" needs NO
 * special-casing: an empty/garbage `order` ⇒ `rest` == `canonicalRow.filter(present)`
 * == today's exact packed sequence (zero-diff). PURE (no DOM, no `hass`) — the reorder
 * lever is this VIEW over present roles, never a mutation of the canonical constants.
 */
function orderRow<R extends Role>(
  canonicalRow: readonly R[],
  presentRoles: ReadonlySet<Role>,
  order: readonly Role[]
): R[] {
  const rowSet = new Set<Role>(canonicalRow);
  const seen = new Set<Role>();
  const listed: R[] = [];
  for (const role of order) {
    if (rowSet.has(role) && presentRoles.has(role) && !seen.has(role)) {
      seen.add(role);
      listed.push(role as R);
    }
  }
  const rest = canonicalRow.filter((role) => presentRoles.has(role) && !seen.has(role));
  return [...listed, ...rest];
}

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

  /** The embedded detailed vehicle card (`tesla-card`), created once and reused
   *  across renders — the vehicle's analogue of the five embedded energy cards. */
  private _vehDetail?: HTMLElement & { setConfig?(config: TeslaCardConfig): void; hass?: HomeAssistant };
  /** RAW `_config` identity the embedded card was last `setConfig`'d with (NOT the
   *  per-tick resolved cfg — see {@link _vehicleDetailCard}). */
  private _vehDetailCfg?: TeslaCardConfig;

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
  /** The hovered/keyboard-focused role; drives the dim/light highlight (`undefined` = no
   *  focus). Story 8.5 widened it to {@link Role} (incl. `'vehicle'`) so the vehicle
   *  cell can participate in focus WITHOUT becoming a flow node — `coupledRoles`
   *  stays energy-only; the vehicle coupling is computed in {@link _coupledLit}. */
  @state() private _focused?: Role;

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
        // The single shared model — the same `bindFlowModel` the Hero calls
        // (hero.ts:261), but Scene-scoped: we pass our hidden-node set so a node the
        // user hid via `energy.nodes.hide` drops at the MODEL seam (→ present:false),
        // exactly as an absent entity would — the grid cell, bus tap, leg, ribbon
        // contribution and focus-coupling then all fall away together by construction
        // (Story 9.2 / FR-33). The Hero stays a zero-diff (it passes no hide set).
        // Cheap (resolve → NaN-safe read → balance); geometry is NOT touched here.
        this._model = bindFlowModel(this.hass, this._config, {}, this._hiddenRoles(this._config));
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
    // Story 8.5 (the 6.5 full-union lesson): the vehicle cell reads these vehicle
    // ids — gating on the energy `*_power` union ALONE would FREEZE the cell (and it
    // would never reflow when the car appears/disappears). Add exactly the ids the
    // cell surfaces; keep truly-unrelated vehicle entities (climate/doors/media…) OUT
    // (they don't render in the Scene) so the AC3c anti-thrash invariant still holds.
    const cfg = this._resolvedConfig ?? this._config;
    if (cfg) {
      ids.push(
        entityId(cfg, 'battery_level'),
        entityId(cfg, 'charging_status'),
        entityId(cfg, 'battery_range'),
        entityId(cfg, 'status')
      );
    }
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
    // Recompute geometry when the RENDERED CELL SEQUENCE changes (a card appeared /
    // vanished, or — Story 9.3 — the user REORDERED the row), NOT on a value-only
    // `hass` tick (AC3a: geometry is reflow-driven, never tick-driven).
    // Story 8.5: the vehicle appearing/disappearing is a genuine reflow (the load row
    // gains/loses a 380px card → the WC→Vehicle anchor changes).
    // Story 9.3 (AC5 — the design hazard): the key is derived from the ORDERED present
    // sequence the render packs ({@link _orderedRows}), NOT the canonical `_model.nodes`
    // order — so a reorder-only config change (same present-set, new order) flips the
    // key, fires the rAF-coalesced reflow EXACTLY once, and the cached geometry (legs,
    // bus tap walk) re-measures the moved anchors. One signature captures hide, unhide,
    // reorder AND vehicle-slot moves — no second key to keep in sync.
    const cfg = this._resolvedConfig ?? this._config;
    const { source, load } = cfg ? this._orderedRows(cfg) : { source: [], load: [] };
    const key = `${source.join(',')}|${load.join(',')}`;
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
    // Story-fix (gateway-bus-placement): place the trunk in the inter-row GAP, not
    // at the centroid of card centres (which the tall Powerwall pulls up into the
    // source row). Degrades to the centroid for every degenerate geometry.
    const bus = busAnchorBetweenRows(rel, SOURCE_ROW, LOAD_ROW);
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
    // Story 8.5: the vehicle is a present-gated PRESENTATION cell (not a flow node),
    // present iff its battery entity exists in states.
    const vehiclePresent = this._vehiclePresent(cfg);
    // The focus coupling (Task 4): when a card is hovered/focused, light it + every
    // node the shared bus couples it to (a source lights all loads, and converse);
    // the rest dim. Computed from the present model — never a hard-coded map. Widened
    // to {@link Role} so the vehicle participates (energy `coupledRoles` unchanged).
    const lit = this._coupledLit(present, vehiclePresent);

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
    // Story 6.7 — PACK each row: render only the present cards, so an absent node
    // leaves NOTHING (no 380px ghost cell, no dead `veh` slot). A row with no present
    // card is omitted entirely (no empty row eating the bus channel). The two packed,
    // centred rows keep sources-over-loads by construction.
    // Story 9.3 — the WITHIN-ROW order follows `energy.nodes.order` via {@link
    // _orderedRows} (a stable partition: listed roles in user order, then unlisted in
    // canonical order). A defaulted/absent `order` ⇒ today's exact canonical packing
    // (zero-diff). Moving the cells moves their DOM anchors; the Gateway bus follows
    // because `gatewaySegments` taps sort by SPATIAL position, not by model order.
    const { source, load } = this._orderedRows(cfg);
    const sourceCells = source.map(cell);
    // Story 8.10/9.3: the vehicle is a load-row cell embedding the real `tesla-card` in
    // `variant: 'compact'` (hero + status only, kW overlay suppressed). It is folded
    // INTO the load-row ordering (not always-trailing), so `order` can place the car
    // anywhere in the row; a defaulted `order` keeps it last (canonical sequence ends in
    // `'vehicle'`). Present-gated: an absent/hidden car leaves no cell (and no WC→Vehicle
    // edge). It never enters the bus tap walk — reordering it changes zero energy math.
    const loadCells = load.map((role) =>
      role === 'vehicle' ? this._vehicleCell(lit) : cell(role)
    );

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
  private _focus(role: Role): void {
    this._focused = role;
  }
  private _blur = (): void => {
    this._focused = undefined;
  };

  // ── the vehicle node (Story 8.5) ────────────────────────────────────────────

  /**
   * The vehicle cell is present iff its battery entity EXISTS in `hass.states`
   * (`rawState` is `undefined` ONLY when the entity is genuinely absent — an asleep
   * car's `battery_level` reads the string `'unavailable'`, which IS present). The
   * read routes through `rawState` (helpers → resolve → stateObj inside `data/`), so
   * no bare `hass.states` reaches this `components/` module.
   */
  private _vehiclePresent(cfg: TeslaCardConfig): boolean {
    // Story 9.2: the Vehicle is NOT a flow node — it cannot drop at the binding
    // seam, so its hide is honored HERE, the single gate for both the presentation
    // cell (render line 412) and, transitively, the WC→Vehicle overlay edge (drawn
    // only when the vehicle anchor exists, i.e. only when the cell renders — see
    // `_vehicleEdge`). Hiding the Vehicle does NOT touch the Wall-Connector energy
    // node: the WC keeps feeding the bus, just without the car leg (AC2).
    if (this._hiddenRoles(cfg).includes('vehicle')) return false;
    return rawState(this.hass, cfg, 'battery_level') !== undefined;
  }

  /**
   * The Scene's hidden-node set from `energy.nodes.hide` (Story 9.2). Defensive
   * (FR-24): a non-array / garbage `hide` degrades to "nothing hidden", never throws.
   * Energy-role members flow to the binding seam (→ `present:false`); `'vehicle'` is
   * honored in {@link _vehiclePresent}; unknown strings are inert at both seams. The
   * list is passed THROUGH to `bindFlowModel` unfiltered — the binding only acts on
   * `ENERGY_ROLES` members, so non-energy entries no-op there by construction.
   */
  private _hiddenRoles(cfg: TeslaCardConfig): readonly Role[] {
    const hide = cfg.energy?.nodes?.hide;
    return Array.isArray(hide) ? (hide as readonly Role[]) : [];
  }

  /**
   * The Scene's left-to-right node order from `energy.nodes.order` (Story 9.3).
   * Defensive (FR-24), a sibling of {@link _hiddenRoles}: a non-array / garbage
   * `order` degrades to "no reorder" (`[]` ⇒ canonical order), never throws. The
   * list is consumed ONLY through {@link orderRow}, which filters to roles present in
   * the row being packed, so unknown strings, other-row roles, absent/hidden roles and
   * duplicates are all inert by construction (no entity IDs, pure config — AR-1 safe).
   */
  private _orderList(cfg: TeslaCardConfig): readonly Role[] {
    const order = cfg.energy?.nodes?.order;
    return Array.isArray(order) ? (order as readonly Role[]) : [];
  }

  /**
   * Story 9.3 — the SINGLE source of truth for the rendered, order-applied cell
   * sequence of each row. {@link render} packs its cells from this, and {@link updated}
   * derives the geometry reflow signature (`_presentKey`) from it — so a reorder-only
   * config change (same present-set, new order) flips the key and trips EXACTLY ONE
   * rAF-coalesced reflow (AC5), keeping the bus tap walk + legs in sync with the moved
   * cards. The source row orders over `SOURCE_ROW`; the load row orders over
   * {@link LOAD_ROW_WITH_VEHICLE} with `'vehicle'` present iff {@link _vehiclePresent}
   * (which already honors 9.2 hide — so "hide wins over order" falls out for free).
   */
  private _orderedRows(cfg: TeslaCardConfig): { source: EnergyRole[]; load: Role[] } {
    const present = new Set<Role>(this._model.nodes.filter((n) => n.present).map((n) => n.role));
    const order = this._orderList(cfg);
    const source = orderRow(SOURCE_ROW, present, order);
    const loadPresent = new Set<Role>(LOAD_ROW.filter((role) => present.has(role)));
    if (this._vehiclePresent(cfg)) loadPresent.add('vehicle');
    const load = orderRow(LOAD_ROW_WITH_VEHICLE, loadPresent, order);
    return { source, load };
  }

  /**
   * The car-charging read both the cell badge AND the WC→Vehicle overlay edge
   * consume (AC2 agree-by-construction) — a single gated call to {@link
   * wcVehicleEdge}. An ASLEEP car is forced inactive (mirrors the Hero, which
   * suppresses the charge cue when asleep): an asleep car's telemetry is
   * unavailable, so the card never asserts a live charge — the WC→Vehicle edge then
   * degrades to its calm base line (quiescent), never a false "Charging" (AC3).
   */
  private _vehicleCharge(cfg: TeslaCardConfig): { active: boolean; kW: number; direction: Direction } {
    if (isAsleep(this.hass, cfg)) return { active: false, kW: 0, direction: 'none' };
    return wcVehicleEdge(this._model);
  }

  /**
   * The focus-coupling set, widened to {@link Role} (Task 4). `coupledRoles` stays
   * ENERGY-ONLY (no edit); the vehicle coupling is computed here as a thin wrapper:
   * focusing the VEHICLE lights `{vehicle, wall_connector}` (its only feed); focusing
   * the WALL_CONNECTOR also lights the vehicle (the WC edge feeds it). Presentation-
   * local — the engine never learns about the vehicle node.
   */
  private _coupledLit(present: Set<EnergyRole>, vehiclePresent: boolean): Set<Role> | undefined {
    const focused = this._focused;
    if (!focused) return undefined;
    if (focused === 'vehicle') {
      const lit = new Set<Role>(['vehicle']);
      if (present.has('wall_connector')) lit.add('wall_connector');
      return lit;
    }
    const lit = new Set<Role>(coupledRoles(this._model, focused));
    if (vehiclePresent && lit.has('wall_connector')) lit.add('vehicle');
    return lit;
  }

  /**
   * The vehicle cell — the SIXTH Scene card. Like the five energy cells (which embed
   * `tc-solar`/`tc-powerwall`/… via {@link _childCard}), it REUSES the real detailed
   * card: the registered `tesla-card` element (hero · quick actions · panels ·
   * commands — the full information-rich vehicle surface). The card owns its own
   * charge/asleep degradation, so the in-Scene render agrees with the standalone card
   * for free. The wrapper is unchanged from the energy cells: a keyboard-focusable
   * `scene-cell` carrying `data-node="vehicle"`, whose live rect drives the existing
   * WC→Vehicle edge anchor + focus highlight.
   */
  private _vehicleCell(lit?: Set<Role>): TemplateResult {
    return html`
      <div
        class="scene-cell veh-cell ${lit?.has('vehicle') ? 'lit' : ''}"
        data-node=${VEHICLE_NODE_ID}
        tabindex="0"
        @mouseenter=${() => this._focus('vehicle')}
        @mouseleave=${this._blur}
        @focusin=${() => this._focus('vehicle')}
        @focusout=${this._blur}
      >
        ${this._vehicleDetailCard()}
      </div>
    `;
  }

  /**
   * The embedded `tesla-card` instance — created ONCE and reused across renders. It is
   * built imperatively (not a static import): `tesla-card.ts` already imports this
   * module, so importing it back would be an import cycle, and `tesla-card` exposes no
   * public `config` property (config goes in via the Lovelace `setConfig`). `setConfig`
   * runs only when the RAW `_config` identity changes (a genuine YAML edit) — NEVER the
   * per-tick resolved cfg, which HA replaces on every state change (re-`setConfig` each
   * tick would reset the embedded card's open panel). `hass` is refreshed every render,
   * so the card resolves its own entities and stays live exactly as a standalone card.
   */
  private _vehicleDetailCard(): HTMLElement {
    let el = this._vehDetail;
    if (!el) {
      el = this._vehDetail = document.createElement('tesla-card') as HTMLElement & {
        setConfig?(config: TeslaCardConfig): void;
        hass?: HomeAssistant;
      };
    }
    // `tesla-card` is defined by the bundle entry, so at render time the element is
    // upgraded and `setConfig` is present. The guard keeps the Scene robust if it is
    // ever loaded in isolation (a harness importing `my-home` alone, no `tesla-card`):
    // the cell degrades to an empty element instead of throwing. `setConfig` runs only
    // on a raw `_config` change — NOT the per-tick resolved cfg, which HA replaces on
    // every state change (re-`setConfig` each tick would reset the card's open panel).
    // Story 8.10: the embed renders `variant: 'compact'` (hero + status only) so it
    // fits the 380px load-row track; a standalone `tesla-card` stays full. The guard
    // KEY stays the raw `_config` identity — the spread object is NOT stored as the key
    // (storing it would mismatch every tick and re-`setConfig`, resetting the embed).
    if (typeof el.setConfig === 'function' && this._vehDetailCfg !== this._config) {
      el.setConfig({ ...this._config, variant: 'compact' });
      this._vehDetailCfg = this._config;
    }
    // `hass` refreshes every render so the card stays live (a plain property set —
    // safe even on an unupgraded element).
    el.hass = this.hass;
    return el;
  }

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

    // Story 8.7: compute the balance ONCE per render and thread it into every
    // consumer — the self-powered lead, the per-node tiles, AND (via the bus's own
    // per-render balance) the trunk all read the SAME net, so they can never
    // disagree (the 6.6 agree-by-construction invariant, extended). No second
    // engine, no re-signed net (FR-33 / AR-6).
    const balance = computeBalance(this._model);
    const sp = selfPowered(this._model, balance);
    const tiles = ribbonTiles(this._model, balance);
    const quiescent =
      this._model.edges.length > 0 && this._model.edges.every((e) => e.provenance === 'quiescent');
    const ageHint = quiescent ? this._sceneAgeHint() : undefined;
    const r = STRINGS.scene.ribbon;

    return html`
      <div class="ribbon ${quiescent ? 'dim' : ''}">
        <div class="ribbon-lead">
          <span class="rib-cap">${r.selfPowered}</span>
          <span class="rib-big"
            >${sp.pct === undefined ? '—' : html`${sp.pct}<small>%</small>`}</span
          >
          ${sp.pct === undefined
            ? nothing
            : html`<span class="rib-sub"
                >${formatNumber(sp.selfKw, 1)} ${r.coveringOf} ${formatNumber(sp.totalKw, 1)}
                ${r.unit}</span
              >`}
        </div>
        <div class="ribbon-tiles">${tiles.map((t) => this._ribbonTile(t))}</div>
        ${ageHint ? html`<span class="ribbon-age">${ageHint}</span>` : nothing}
      </div>
    `;
  }

  /**
   * One per-node aggregate tile (Story 8.7, AC3): an accent icon chip
   * (`NODE_ICON[role]` glyph tinted by `NODE_COLOR[role]`, set INLINE — the same
   * gate-safe `var(--tc-*, #hex)` pattern `_legs` uses), an UPPERCASE key, and the
   * node's net value. The GRID tile is the only genuinely bidirectional one, so it
   * carries an honest `in`/`out` direction suffix (from the canonical `signed` net
   * sign); every other role shows the magnitude. Copy + colour live HERE
   * (presentation); the pure {@link ribbonTiles} returns only roles + numbers.
   */
  private _ribbonTile(t: RibbonTile): TemplateResult {
    const r = STRINGS.scene.ribbon;
    const color = NODE_COLOR[t.role];
    const kw = `${formatNumber(t.kW, 1)} ${r.unit}`;
    const value =
      t.role === 'grid'
        ? t.signed > IDLE_KW
          ? `${kw} ${r.in}`
          : t.signed < -IDLE_KW
            ? `${kw} ${r.out}`
            : kw
        : kw;
    return html`
      <div class="rib-tile">
        <span
          class="rib-ico"
          style="color:${color};background:color-mix(in srgb, ${color} 18%, transparent)"
          >${icon(NODE_ICON[t.role], { size: 18 })}</span
        >
        <span class="rib-tcol">
          <span class="rib-tk">${r.tile[t.role]}</span>
          <span class="rib-tv">${value}</span>
        </span>
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
  private _gatewayView(lit?: Set<Role>): SVGTemplateResult {
    const anchors = this._anchors;
    if (!anchors) return svg``;
    const segs = gatewaySegments(this._model, anchors, { axis: this._axis });
    // Story 8.5: the WC→Vehicle leg is drawn alongside the trunk + node legs, from
    // the SAME `wcVehicleEdge` view the cell badge consumes (AC2 agree-by-construction).
    const ch = this._vehicleCharge(this._resolvedConfig ?? this._config);
    return svg`${this._trunk(segs)}${this._legs(anchors, lit)}${this._vehicleEdge(anchors, ch, lit)}`;
  }

  /**
   * The WC→Vehicle overlay edge (Story 8.5/8.10, AC7): a short leg joining the
   * Wall-Connector card to the Vehicle card — the WC's power CONTINUING to the car
   * (coloured `NODE_COLOR.wall_connector` teal so it reads as the SAME edge continuing:
   * "the WC edge IS the car-charging edge"). AXIS-AWARE like {@link _legs}/{@link
   * _trunk}: in the desktop load row the cards sit side-by-side so the leg runs
   * HORIZONTALLY across the inter-card gap (the WC's vehicle-facing edge → the vehicle's
   * WC-facing edge); at the ≤540px phone reflow the load row collapses to one column so
   * the cards STACK and the leg drops VERTICALLY down the collapsed gap. Either
   * orientation joins the cards at their OVERLAP centre on the cross axis, so the leg
   * lands ON both card edges and never floats off a stretched-cell midpoint (the load
   * row is `align-items:start`, so neither card is ballooned to the other's height — the
   * WC node card and the compact card have different natural heights). Present only when
   * BOTH anchors exist (WC + vehicle). A calm base
   * `<line>` always; when `ch.active`, an `sb-flow` dash from the SHARED {@link
   * edgeVisual} (never a forked formula, clamped by {@link BUS_WIDTH_MAX}) that CARRIES
   * the WC→vehicle direction in its `stroke-dashoffset` animation — NO separate arrowhead
   * (the gap is too small to hold a 64px pill AND an arrow; `_legs` is likewise
   * dash-only). Reduced-motion freezes the dash (inherited from `sceneBusStyles` — no new
   * animation source). The leg touches NO trunk, so it gets TWO terminals (one per card
   * end) + one pill at mid, NO tap — all on a `.gw-veh-dec` wrapper inside the `gw-leg`
   * group, so the focus coupling still dims/lights them AND the ≤540px @media can HIDE
   * them (the collapsed gap can't hold a pill + two terminals without spilling into the
   * stacked cards — a CSS hide, NOT an axis branch, because jsdom's zero-width recompute
   * reports the phone axis even for the desktop unit assertions).
   */
  private _vehicleEdge(
    anchors: Readonly<Record<string, RectLike>>,
    ch: { active: boolean; kW: number; direction: Direction },
    lit?: Set<Role>
  ): SVGTemplateResult {
    const wc = anchors['wall_connector'];
    const veh = anchors[VEHICLE_NODE_ID];
    if (!wc || !veh) return svg``; // both anchors required (WC + vehicle present)
    // Axis-aware leg (see the doc comment): HORIZONTAL across the inter-card gap when the
    // cards sit side-by-side (desktop), VERTICAL down the collapsed gap when they stack
    // (≤540px phone). Either way it meets the cards at their OVERLAP centre on the cross
    // axis, so it lands ON both card edges even though the compact vehicle card is much
    // taller than the WC card. The vehicle is the trailing load cell, so along the main
    // axis it sits after the WC (to its right when in-line / below it when stacked).
    const horiz = this._axis === 'x';
    const color = NODE_COLOR.wall_connector;
    const wcCx = wc.left + wc.width / 2;
    const vehCx = veh.left + veh.width / 2;
    const wcCy = wc.top + wc.height / 2;
    const vehCy = veh.top + veh.height / 2;
    let start: { x: number; y: number };
    let end: { x: number; y: number };
    if (horiz) {
      // Cross axis = vertical: meet at the cards' vertical OVERLAP centre (= the SHORTER
      // card's centre when their tops align under `align-items:start`), so the leg lands
      // within BOTH cards regardless of which one is taller.
      const y = (Math.max(wc.top, veh.top) + Math.min(wc.top + wc.height, veh.top + veh.height)) / 2;
      start = { x: wcCx < vehCx ? wc.left + wc.width : wc.left, y };
      end = { x: wcCx < vehCx ? veh.left : veh.left + veh.width, y };
    } else {
      // Cross axis = horizontal: meet at the cards' horizontal OVERLAP centre (= the
      // shared column centre when both fill the 1fr phone track).
      const x = (Math.max(wc.left, veh.left) + Math.min(wc.left + wc.width, veh.left + veh.width)) / 2;
      start = { x, y: wcCy < vehCy ? wc.top + wc.height : wc.top };
      end = { x, y: wcCy < vehCy ? veh.top : veh.top + veh.height };
    }
    // When charging: the sb-flow dash rides the base line and CARRIES the WC→vehicle
    // direction in its stroke-dashoffset animation (no separate arrowhead). Both flow and
    // base consume the SHARED edgeVisual — never a forked formula.
    const flow = ch.active
      ? svg`<line
            class="sb-flow"
            style="stroke:${color};animation-duration:${edgeVisual(ch.kW).durSec}s"
            stroke-width=${Math.min(BUS_WIDTH_MAX, edgeVisual(ch.kW).width)}
            x1=${start.x} y1=${start.y} x2=${end.x} y2=${end.y}
          ></line>`
      : nothing;
    // Story 8.6/8.10: the WC→Vehicle leg touches NO trunk — so it gets TWO terminals (one
    // per card end) + one pill at mid, and NO tap. The pill shows `wcVehicleEdge(model).kW`
    // (= `ch.kW`), agreeing by construction with the cell's "Charging · N.N kW" (both read
    // the one `wcVehicleEdge`). Terminals + pill ride a `.gw-veh-dec` wrapper INSIDE the leg
    // group (so the widened (Role) focus coupling still dims/lights them) that the ≤540px
    // @media hides — the collapsed 16px gap can't hold a 26px pill + two terminals without
    // spilling into the stacked cards.
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return svg`
      <g class="gw-leg ${lit?.has('vehicle') ? 'on' : ''}" data-role=${VEHICLE_NODE_ID}>
        <line class="gw-leg-base" style="stroke:${color}" x1=${start.x} y1=${start.y} x2=${end.x} y2=${end.y}></line>
        ${flow}
        <g class="gw-veh-dec">
          ${this._terminal(start, color)}
          ${this._terminal(end, color)}
          ${this._pill(mid, color, `${formatNumber(Math.abs(ch.kW), 1)} ${STRINGS.scene.ribbon.unit}`)}
        </g>
      </g>
    `;
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

  // ── Story 8.6: enriched-leg decorations (kW pill · terminal · tap) ────────────
  // Static SVG primitives, drawn INSIDE each `.gw-leg` group (so the focus
  // dim/light inherits, and reduced-motion keeps them as the legible read). Colour
  // is always the leg's node accent (`NODE_COLOR[role]`/`GATEWAY_STROKE`) set INLINE
  // — the same gate-safe `var(--tc-*, #hex)` pattern `_trunk`/`_legs` already use;
  // no new raw hex, no new animation source, no recomputed magnitude.

  /**
   * A kW pill at a leg's midpoint (mockup `pill`, ~64×26, `rx≈13`) — a rounded,
   * token-filled rect + the node-accent-coloured `${kwText}` centred on it. The
   * NUMBER is the colour-blind-safe magnitude floor (AC4): with motion off the leg
   * reads from this text, never hue alone. `_legs`/`_vehicleEdge` pass the SAME
   * `edge.kW` the flow already uses — the pill never invents a second value.
   */
  private _pill(at: { x: number; y: number }, color: string, kwText: string): SVGTemplateResult {
    const W = 64;
    const H = 26;
    return svg`
      <g class="gw-pill" transform="translate(${at.x - W / 2} ${at.y - H / 2})">
        <rect class="gw-pill-bg" width=${W} height=${H} rx="13"></rect>
        <text class="gw-pill-txt" x=${W / 2} y=${H / 2} style="fill:${color}">${kwText}</text>
      </g>
    `;
  }

  /**
   * A terminal at the CARD-facing end of a leg (mockup `term`): an accent-stroked
   * ring (r≈7) + a small filled centre dot (r≈ ring·0.34). Marks where the leg meets
   * its card.
   */
  private _terminal(at: { x: number; y: number }, color: string): SVGTemplateResult {
    const r = 7;
    return svg`
      <circle class="gw-term" style="stroke:${color}" cx=${at.x} cy=${at.y} r=${r}></circle>
      <circle class="gw-term-dot" style="fill:${color}" cx=${at.x} cy=${at.y} r=${r * 0.34}></circle>
    `;
  }

  /**
   * A tap at the TRUNK-facing end of a leg (mockup `tap`): a small filled dot (r≈5)
   * where the leg meets the bus rail. The WC→Vehicle leg has no tap (it never touches
   * the trunk).
   */
  private _tap(at: { x: number; y: number }, color: string): SVGTemplateResult {
    return svg`<circle class="gw-tap" style="fill:${color}" cx=${at.x} cy=${at.y} r="5"></circle>`;
  }

  /**
   * Each present node's leg: from the card edge FACING the trunk to the trunk line,
   * in the node's accent colour (motion when its edge is active). Source cards sit
   * one side of the trunk and load cards the other, so the near edge (and thus the
   * leg's down/up sense) falls straight out of the anchor's position vs the trunk.
   */
  private _legs(anchors: Readonly<Record<string, RectLike>>, lit?: Set<Role>): SVGTemplateResult {
    const horiz = this._axis === 'x';
    const bus = anchors[BUS_NODE_ID];
    // Story 9.5 (C increment, FR-33 zero-diff): a leg with no bus junction to tap is
    // degenerate — without this guard `cross` fell back to 0, so a desktop near-edge at
    // y>160 would draw a `.long` conduit clear to y=0. Refuse to draw it rather than draw
    // a false leg. Unreachable in steady state (node anchors present ⟺ bus defined), so
    // output is byte-identical today; the guard makes the regression impossible if a future
    // anchor-derivation rework (9.7) ever drops the bus independently of node anchors.
    if (!bus) return svg``;
    const cross = horiz ? bus.top + bus.height / 2 : bus.left + bus.width / 2;
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
        // Story 8.6: the leg's enriched decorations — all INSIDE the `.gw-leg`
        // group so the focus dim/light (AC3) applies to them by construction, and
        // all STATIC SVG so reduced-motion (AC4) keeps them as the legible read.
        // The pill shows the SAME `edge.kW` the flow uses (never a recomputed
        // value); an absent edge draws NO pill (AC2 honesty — but a present leg
        // always carries an edge, so this is a defensive guard).
        const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        // Story 8.12 (CAP-3): the leg's cross-axis length (start/end differ only on the
        // cross axis, so |near - cross|). Over LONG_LEG_PX it earns the .long conduit
        // polish below — a length-aware bump, never a global one (short hops stay calm).
        // GATED to the horizontal (desktop) bus (AC4): at the ≤540px phone reflow the rows
        // stack full-width, so EVERY vertical leg spans ~half the card width (well over the
        // threshold) — an un-gated .long would bolden every phone leg, changing the phone
        // layout. The long-conduit read is a desktop-bus affordance anyway (a short source
        // card dropping a long way to the horizontal trunk); the e2e pins zero .long legs
        // at phone width.
        const len = Math.abs(near - cross);
        return svg`
          <g class="gw-leg ${lit?.has(n.role) ? 'on' : ''}" data-role=${n.role}>
            <line class="gw-leg-base ${horiz && len > LONG_LEG_PX ? 'long' : ''}" style="stroke:${color}" x1=${start.x} y1=${start.y} x2=${end.x} y2=${end.y}></line>
            ${flow}
            ${this._terminal(start, color)}
            ${this._tap(end, color)}
            ${edge
              ? this._pill(mid, color, `${formatNumber(Math.abs(edge.kW), 1)} ${STRINGS.scene.ribbon.unit}`)
              : nothing}
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
        align-items: center;
        gap: var(--tc-space-4, 16px);
        margin-bottom: var(--tc-space-4, 16px);
      }
      /* The self-powered lead (Story 8.7): cap · big % · honest sub-line, divided
         from the per-node tiles by a hairline. All token-only with fallbacks (no
         raw hex, no gradient). */
      .ribbon-lead {
        display: flex;
        flex-direction: column;
        gap: var(--tc-space-1, 4px);
        padding-right: var(--tc-space-4, 16px);
        border-right: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
      }
      .rib-cap {
        font-size: var(--tc-fs-label, 11.5px);
        font-weight: var(--tc-fw-label, 700);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .rib-big {
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, sans-serif));
        font-size: var(--tc-fs-battery, 26px);
        font-weight: var(--tc-fw-battery, 760);
        color: var(--tc-text, #f1f5f9);
        line-height: 1;
      }
      .rib-big small {
        font-size: var(--tc-fs-body, 14px);
        font-weight: var(--tc-fw-body, 600);
        color: var(--tc-text-dim, #9aa7b8);
        margin-left: 2px;
      }
      .rib-sub {
        font-size: var(--tc-fs-label, 11.5px);
        font-weight: var(--tc-fw-label, 700);
        color: var(--tc-text-dim, #9aa7b8);
      }
      /* The per-node aggregate tile row — one chip+key+value per present node. A
         reflow-friendly flex-wrap row (collapses cleanly ≤540px, UX-DR22). */
      .ribbon-tiles {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--tc-space-4, 16px);
      }
      .rib-tile {
        display: flex;
        align-items: center;
        gap: var(--tc-space-2, 8px);
      }
      /* The accent icon chip — colour + 18% tint set INLINE per tile (NODE_COLOR
         [role] + its color-mix), so no raw hex/token is hard-coded in CSS. */
      .rib-ico {
        width: 32px;
        height: 32px;
        border-radius: var(--tc-radius-md, 16px);
        display: grid;
        place-items: center;
        flex: 0 0 auto;
      }
      .rib-tcol {
        display: flex;
        flex-direction: column;
        gap: var(--tc-space-1, 4px);
      }
      .rib-tk {
        font-size: var(--tc-fs-stat-key, 11.5px);
        font-weight: var(--tc-fw-stat-key, 700);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--tc-text-mute, #64748b);
      }
      .rib-tv {
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, sans-serif));
        font-size: var(--tc-fs-body, 14px);
        font-weight: var(--tc-fw-body, 600);
        color: var(--tc-text, #f1f5f9);
      }
      .ribbon-age {
        font-size: var(--tc-fs-label, 11.5px);
        /* Staleness copy uses --tc-text-dim, NEVER --tc-text-mute (UX-DR18 / DoD
           honesty rule) — the freshness-honest 4.5:1 tone every other stale stamp
           (.tc-stale-copy → .veh-age/.eco-stamp) already uses. Story 8.8 R6 depth
           audit closed this lone outlier: the "updated Nm ago" stamp is a freshness
           disclosure, not a decorative caption, so it must not render at the lowest-
           contrast mute tone. */
        color: var(--tc-text-dim, #9aa7b8);
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
      /* Story 8.12: top-align BOTH rows. SOURCE-row reason: a short Solar cell under the
         grid-default align-items:stretch balloons to its tallest row-mate's (Powerwall)
         height, so the cell's MEASURED bottom drops far below the visible artwork — and
         with it the Gateway terminal, which _legs anchors at the cell's near edge
         rect.top + rect.height. align-items:start shrinks the cell to its content, so the
         ring rises to the card's TRUE visible bottom (the _legs near-edge math is
         unchanged). Bus-Y is INVARIANT to align-items: the grid row TRACK height = the
         tallest card's height whether items stretch or start (align positions items WITHIN
         the track, it does not resize the track), so busAnchorBetweenRows' maxBottom
         (flow/my-home.ts) is unchanged and the inter-row trunk does NOT move — the retired
         "stretch is tuned for the bus" claim was stale. The source row now reads with
         RAGGED bottoms (short Solar beside tall Powerwall): the accepted trade — terminal
         proximity over a tidy equal-height row, mirroring the load-row precedent — not a
         regression. The durable forward-contract for node customization is that bus-Y
         depends only on the TALLEST card per row (adding a taller card still shifts it). A
         long source leg then earns the .long conduit polish below.
         Story 8.10 (LOAD-row) reason, still in force: the load row mixes the Home/WC node
         cards with the compact vehicle card at different natural heights; stretch would
         balloon the shorter cells (dead space + an over-tall focus ring) and the
         WC->Vehicle leg would anchor to the stretched-cell midpoint, off the shorter card's
         content. start keeps each card its natural height with tops aligned, so the leg
         lands at the cards' true overlap centre. */
      .source-row,
      .load-row {
        align-items: start;
      }
      .scene-cell {
        min-width: 0;
      }

      /* Story 8.10: the vehicle is the trailing load-row cell again — the embedded
         compact tesla-card fills the 380px grid track. width:100% makes the host fill
         its cell; the host's own .root max-width:1080px never widens the cell past the
         380px track (the compact hero is sized to the column in hero.ts). The card
         brings its own surface chrome + styles (shadow DOM). */
      .veh-cell > tesla-card {
        display: block;
        width: 100%;
      }
      /* Keyboard focus ring — the 2px blue outline (EXPERIENCE.md:175 a11y floor),
         never the hairline border alone. */
      .scene-cell:focus-visible {
        outline: 2px solid var(--tc-blue, #38bdf8);
        outline-offset: 2px;
        border-radius: var(--tc-radius-md, 16px);
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
      /* Story 8.12 (CAP-3): a length-aware bump for a LONG leg (over LONG_LEG_PX in
         _legs) so it reads as a deliberate energy conduit — the Solar leg, now honest
         after the source-row top-align (Task 1), instead of a faint lonely thread. Same
         KIND of literal as the sibling .gw-leg-base — direct SVG stroke props (NOT a
         --tc-* token, NOT a gradient) — but a deliberate bump FROM the sibling's
         stroke-width 2 / opacity 0.45 TO 2.5 / 0.6; opacity + stroke-width only, no
         gradient/taper (the codebase avoids gradients). Length-aware so short hops never
         gain body. The leg reads by day via its sb-flow dash and by night via the kW pill
         + this bolder base. Tunable starting values (SPEC Open Question, Task 7). */
      .gw-leg-base.long {
        opacity: 0.6;
        stroke-width: 2.5;
      }
      /* ── Story 8.6: enriched-leg decorations (kW pill · terminal · tap). All
         STATIC SVG (no @media, no keyframe) so reduced-motion keeps them as the
         "keep the data" read; colours come INLINE from NODE_COLOR/GATEWAY_STROKE
         (gate-safe var(--tc-*, #hex) reads), so no new raw hex is introduced. The
         pill bg is a FLAT token fill (mirrors sb-chip-bg), never a gradient. */
      .gw-pill-bg {
        fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
        stroke-width: 1;
      }
      .gw-pill-txt {
        font-family: var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
        font-size: 13px;
        font-weight: 700;
        text-anchor: middle;
        dominant-baseline: central;
      }
      .gw-term {
        fill: none;
        stroke-width: 2;
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
        /* Story 8.10: at phone width the load row stacks to one column, so the WC->Vehicle
           leg drops VERTICALLY down the collapsed 16px gap. That gap cannot hold the 26px
           kW pill + two terminals without spilling into the stacked cards, so hide the
           decorations here; the base line + flow dash stay as the calm vertical connector.
           A CSS hide (jsdom ignores @media, so the desktop unit assertions still see the
           two terminals). */
        .gw-veh-dec {
          display: none;
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
