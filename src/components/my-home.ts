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
import { bindFlowModel, POWER_KEY, ENERGY_ROLES } from '../flow/binding';
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
  chargeOfEdge,
  wcEdgeForVehicle,
  BUS_WIDTH_MAX,
  BUS_TRUNK_PAD,
  type BusAxis,
  type GatewaySegment,
  type RibbonTile,
} from '../flow/my-home';
import { roleInstances, roleOfInstance } from '../flow/instances';
import type { EnergyRole, Role } from '../data/registry';
import type { HomeAssistant, LovelaceCard, TeslaCardConfig, SceneRow } from '../types';

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
 *
 * Story 11.3 (D-11.3-4b): this is the BASELINE threshold, calibrated against the
 * {@link SCENE_TRACK_MIN_PX} floor track. Under the fluid tracks (AC1) the live threshold
 * is derived from the MEASURED track width in `_recomputeGeometry` (a computed-threshold
 * logic change, NOT a CSS swap), so the `.long` classification stays proportionate as
 * tracks widen — see {@link TcMyHome._longLegPx}. At the floor (380px) the derived value
 * is exactly this constant, so the `.long` read is byte-identical at standalone width.
 */
const LONG_LEG_PX = 160;

/**
 * Story 11.3 (D-11.3-1): the composed-Scene fluid track band. The grid tracks are
 * `minmax(SCENE_TRACK_MIN_PX, var(--scene-track-max, SCENE_TRACK_MAX_PX))` — cards grow
 * past the {@link SCENE_TRACK_MIN_PX} floor (never shrinking below standalone size) to
 * fill a wide column, but STOP at the cap (surplus → margin, never the ultrawide `1fr`
 * balloon). The cap is dev-tunable via the `--scene-track-max` custom property. These TS
 * mirrors of the CSS literals drive the two width-relative geometry derivations (the
 * `.subrow.overflow` channel offset and the `.long` threshold above), so a retune stays
 * single-sourced. NOT brand/trade-dress literals — layout constants, like 380px/230px.
 */
const SCENE_TRACK_MIN_PX = 380;
const SCENE_TRACK_MAX_PX = 560;

/** Story 11.3: the bus channel gap (px) between the fluid tracks — the `column-gap`. The
 *  overflow sub-row centres on a near-row channel at `(trackWidth + SCENE_BUS_GAP_PX) / 2`. */
const SCENE_BUS_GAP_PX = 80;

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
const SOURCE_ROW: readonly EnergyRole[] = ['solar', 'powerwall', 'grid', 'generator'];

/**
 * Story 9.3: the load row's ORDERING domain — the two energy loads PLUS the
 * synthetic `'vehicle'` presentation cell, so `energy.nodes.order` can place the car
 * anywhere in the load row (not just trailing). The canonical sequence ENDS in
 * `'vehicle'`, so a defaulted/absent/garbage `order` keeps it trailing — byte-for-byte
 * Story 8.10's behaviour (zero-diff). This is NOT a flow-node list (the vehicle never
 * enters `gatewaySegments`' tap walk — it is not a `FlowNode`); it is purely the
 * load-row CELL packing domain. The canonical load roles are everything in here that
 * is NOT a {@link SOURCE_ROW} member (Story 9.15's `_rowOf` derives the canonical row
 * from these two constants).
 */
const LOAD_ROW_WITH_VEHICLE: readonly Role[] = ['home', 'wall_connector', 'vehicle'];

/**
 * Story 9.15 — the FULL Scene cell vocabulary in canonical (deterministic) base
 * order: every source role, then every load role + the synthetic `'vehicle'`. The
 * effective per-row domain is this list FILTERED by {@link TcMyHome._rowOf} (the
 * one cross-row classifier), so a defaulted node lands in its canonical row exactly
 * as before (zero-diff) and a promotion just re-partitions the same ordered list.
 */
const SCENE_ROW_ORDER: readonly Role[] = [...SOURCE_ROW, ...LOAD_ROW_WITH_VEHICLE];

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
  generator: 'tc-generator',
} as const;

/** Story 9.7 — the per-sub-row card cap (the "default, not a cap" 3-slot grid); beyond it, wrap.
 *  The OVERFLOW sub-row's channel offset is the CSS `.subrow.overflow` padding-left (230px =
 *  (380 column + 80 channel)/2, so each overflow card centres on a near-row channel) — a CSS
 *  literal so the ≤540px phone reset can override it (an inline style could not). */
const WRAP_MAX_PER_ROW = 3;

/** Story 9.8 (AC8) — the SAFE wrap capacity: two sub-rows of {@link WRAP_MAX_PER_ROW}.
 *  Beyond it the overflow sub-row's legs reach past the 3rd bus channel and cross the
 *  primary cards (the 9.7-deferred ">6 cards in a band degrades" item). A band over this
 *  triggers the defensive ≈0-kW clamp — hiding ONLY dead (no-live-flow) excess cards. */
const SAFE_BAND_MAX = 2 * WRAP_MAX_PER_ROW;

/**
 * One rendered Scene cell (Story 9.7) — a present INSTANCE of a role, or the
 * synthetic vehicle cell. The render packs these; `id` is the per-instance
 * `data-node` (the bare role when single — FR-33 zero-diff), `role` drives the
 * child-card tag + accent colour, `title` disambiguates duplicates (Task 7), and
 * `entities` carries the per-instance overrides merged into the child's config.
 */
interface SceneCell {
  id: string;
  role: Role;
  title?: string;
  entities?: Partial<EnergyEntities>;
  vehicle?: boolean;
  /** Story 9.8: a vehicle cell's per-instance embedded-`tesla-card` config override
   *  (the 2nd car's distinct device / name / paint), merged into the embed. */
  config?: Partial<TeslaCardConfig>;
}

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
  /** Story 9.10 (AC7): the hidden-and-LIVE instances behind the detected-but-hidden
   *  advisory, recomputed in `willUpdate` (read-only over the model — never balance).
   *  Empty ⇒ no banner (zero-diff). */
  private _hiddenLive: { id: string; role: EnergyRole; title?: string }[] = [];

  /** `_config` with `entities` filled by auto-resolution; passed to children. */
  private _resolvedConfig?: TeslaCardConfig;
  /** Auto-detected energy-site entities (the slice the Scene gates on). */
  private _energy?: EnergyEntities;
  /** Cache key on hass/config IDENTITY (mirrors solar.ts — keeps `hass.entities`/
   *  `hass.devices` reads inside `data/`, never bare in this element). */
  private _resolveCache?: { hass: unknown; config: TeslaCardConfig };

  /**
   * Story 9.8 — the embedded detailed vehicle cards (`tesla-card`), keyed by the
   * per-instance id (the config identity). Each present vehicle cell owns its OWN
   * embed, created once and reused across renders — the vehicle's analogue of the five
   * embedded energy cards. `cfg` is the RAW `_config` identity the embed was last
   * `setConfig`'d with (NOT the per-tick resolved cfg — see {@link _vehicleDetailCard}),
   * stored PER ENTRY so a state tick / a sibling car's update never resets another car's
   * open panel. Single-vehicle is one entry keyed by the bare `vehicle` id (zero-diff).
   */
  private readonly _vehDetail = new Map<
    string,
    { el: HTMLElement & { setConfig?(config: TeslaCardConfig): void; hass?: HomeAssistant }; cfg: TeslaCardConfig }
  >();

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
  /** Story 11.3 (D-11.3-4b): the live `.long`-conduit threshold, derived each reflow from
   *  the MEASURED track width so it stays proportionate as the fluid tracks widen (AC5b).
   *  Seeded at {@link LONG_LEG_PX} (the {@link SCENE_TRACK_MIN_PX}-floor baseline) so the
   *  pre-measure render and the floor-width Scene are byte-identical to Story 8.12. */
  private _longLegPx = LONG_LEG_PX;
  /** The hovered/keyboard-focused NODE ID; drives the dim/light highlight (`undefined`
   *  = no focus). Story 8.5 admitted the vehicle cell (`'vehicle'`); Story 9.7 widened
   *  it from a role to a per-instance `data-node` id (`solar:1`), so focusing ONE array
   *  lights that array's tap, never its same-role sibling — `coupledRoles` stays
   *  energy-ROLE-only; the per-instance expansion is computed in {@link _coupledLit}. */
  @state() private _focused?: string;

  /** Story 9.8 (AC8): when `true`, the defensive ≈0-kW overflow clamp is lifted and every
   *  card in an over-capacity band shows (the user tapped "Show all"). Default calm-clamped. */
  @state() private _showAllOverflow = false;

  /** Story 9.10 (AC8): per-instance dismissed detected-but-hidden advisories — a
   *  SESSION set of instance ids (a fresh open re-evaluates; never persisted, never
   *  auto-un-hides). Reset in `setConfig` like {@link _showAllOverflow}. */
  @state() private _dismissedHidden = new Set<string>();

  // ── LovelaceCard contract (AC4) ────────────────────────────────────────────

  public setConfig(config: TeslaCardConfig): void {
    // Forward-compatible (R9): tolerate unknown keys, reject only a falsy config.
    if (!config) throw new Error('Invalid configuration');
    this._config = { ...config };
    // A genuine reconfigure starts CALM-clamped: a stale "Show all" from a prior config's
    // overflow must not auto-expand a new config's band (Story 9.8, AC8).
    this._showAllOverflow = false;
    // …and clears any per-instance advisory dismissals (Story 9.10): a new config
    // re-evaluates which instances are hidden-and-live from scratch.
    this._dismissedHidden = new Set<string>();
  }

  public getCardSize(): number {
    return 12; // a tall multi-card composition
  }

  public static getStubConfig(): TeslaCardConfig {
    // HA's card picker spreads this seed OVER the `custom:tc-my-home` type it
    // assigns, so the seed MUST carry the `custom:` prefix — a bare `tc-my-home`
    // here clobbers it and the picker reports "Unknown type encountered: tc-my-home".
    return { type: 'custom:tc-my-home' };
  }

  // The standalone Scene card reuses the vehicle card's lazy editor: tc-my-home
  // embeds a full `tesla-card` vehicle cell and consumes the same vehicle + energy +
  // Scene-node config, so `tesla-card-editor` is its editor too — its Scene-nodes
  // section IS the My-Home customization GUI. The editor is type-blind (never reads
  // `_config.type`), which is WHY a `custom:tc-my-home` config round-trips intact —
  // but it also means the guided wizard's copy/Tune step and the appearance preview
  // stay vehicle-framed here. Acceptable because the Scene embeds that vehicle; revisit
  // if a Scene-specific editor variant is wanted. Mirrors `TeslaCard.getConfigElement`;
  // the import is lazy so loading the bundle never registers the editor (lazy-by-contract).
  public static async getConfigElement(): Promise<HTMLElement> {
    await import('../editor');
    return document.createElement('tesla-card-editor');
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
        // Story 9.10 (AC7): recompute the hidden-and-live set for the advisory. Read-only
        // over the model (never balance/topology — AR-6/FR-33); `[]` when the toggle is
        // off / nothing hidden / nothing live ⇒ no banner ⇒ zero-diff.
        this._hiddenLive = this._computeHiddenLive(this._config);
      }
    }
  }

  /**
   * Story 9.10 (AC7) — the hidden-and-LIVE instances behind the detected-but-hidden
   * advisory. The "opposite-of-hide" probe: `flowInputsFrom` short-circuits hidden roles
   * to absent BEFORE resolution, so the bound `_model` can't see them — bind an UN-HIDDEN
   * model (`hide:[]`) purely for COMPARISON (never rendered as cards) and intersect its
   * live present nodes with the hidden set, PER INSTANCE (id + title) so a hidden 2nd
   * instance of a shown role still surfaces correctly named. Returns `[]` (no banner,
   * zero-diff) when the global toggle is off, nothing is hidden, or nothing hidden is live.
   * Vehicle is excluded: it is not a flow node and its liveness is the hero's awake/asleep
   * job (a present-but-asleep car must not read "live" — the honesty contract).
   */
  private _computeHiddenLive(
    cfg: TeslaCardConfig
  ): { id: string; role: EnergyRole; title?: string }[] {
    if (!this._notifyHiddenDetected(cfg)) return []; // toggle off ⇒ no compute, no banner
    const hidden = new Set(this._hiddenRoles(cfg));
    if (hidden.size === 0) return [];
    const unhidden = bindFlowModel(this.hass, this._config, {}, []); // comparison only
    const livePresent = new Set(unhidden.nodes.filter((n) => n.present).map((n) => n.id));
    const out: { id: string; role: EnergyRole; title?: string }[] = [];
    for (const role of ENERGY_ROLES) {
      if (!hidden.has(role)) continue;
      for (const inst of roleInstances(cfg, role)) {
        if (livePresent.has(inst.id)) out.push({ id: inst.id, role, title: inst.title });
      }
    }
    return out;
  }

  /** Whether the detected-but-hidden advisory is enabled (Story 9.10 / AC8). Default-ON:
   *  absent / any non-`false` value ⇒ on (FR-24 tolerant); explicit `false` ⇒ off. */
  private _notifyHiddenDetected(cfg: TeslaCardConfig): boolean {
    return cfg.notify_hidden_detected !== false;
  }

  /** Dismiss one instance's advisory (Story 9.10, AC8). A NEW Set ref so the `@state`
   *  change re-renders; session-only (never persisted), and NEVER auto-un-hides the card. */
  private _dismissHidden(id: string): void {
    const next = new Set(this._dismissedHidden);
    next.add(id);
    this._dismissedHidden = next;
  }

  /**
   * Story 9.10 (AC7/AC9) — the calm detected-but-hidden advisory: one line per hidden-
   * and-live instance, labelled by card title (`${role} · ${title}`), amber accent over a
   * `{colors.surface}` strip. A NAMED live region (`role="status"` / `aria-live="polite"`,
   * never assertive). Never auto-un-hides, never animates. Collapses to `nothing` when
   * there are none / all dismissed / the toggle is off (zero-diff).
   */
  private _hiddenAdvisory(): TemplateResult | typeof nothing {
    const items = this._hiddenLive.filter((i) => !this._dismissedHidden.has(i.id));
    if (!items.length) return nothing;
    const n = STRINGS.scene.hiddenNotice;
    return html`
      <div class="hidden-advisory" role="status" aria-live="polite" aria-label=${n.region}>
        ${items.map((i) => {
          const label = i.title
            ? `${STRINGS.energy.nodes[i.role]} · ${i.title}`
            : STRINGS.energy.nodes[i.role];
          return html`
            <div class="hidden-advisory-row">
              <span class="hidden-advisory-text">${label} ${n.detectedSuffix}</span>
              <button
                type="button"
                class="hidden-advisory-dismiss"
                aria-label=${`${n.dismiss} ${label} ${n.noticeWord}`}
                @click=${() => this._dismissHidden(i.id)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          `;
        })}
      </div>
    `;
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
    // Story 9.7: `_energy` is the BASE resolution (covers instance #1 + the global
    // overrides); a per-instance OVERRIDE id (e.g. the 2nd array's own sensor) is NOT
    // in it, so without this a tick on a duplicated instance's sensor would never
    // re-render the Scene (AC8: each instance lastUpdated-gated from shared hass). Add
    // every per-instance entity override id — pure config values, no `hass.states` read.
    const raw = this._config;
    if (raw) {
      for (const role of ENERGY_ROLES) {
        for (const inst of roleInstances(raw, role)) {
          if (inst.entities) ids.push(...Object.values(inst.entities));
        }
      }
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
    // Story 9.7: the key is the per-INSTANCE id sequence, so a count change (solar →
    // solar:1,solar:2) flips it (one reflow), while a value-only tick (same roster)
    // leaves it unchanged (zero reflow) — AC8.
    // Story 9.8: each present vehicle id is already in the load-cell sequence (the
    // expander emits `vehicle`/`vehicle:1`/…), so adding/removing a car flips the key
    // and reflows ONCE — no separate vehicle key. Prune the embed Map to the present
    // vehicle ids so a dropped car's cached `tesla-card` is released (no leak).
    const cfg = this._resolvedConfig ?? this._config;
    const { source, load } = cfg ? this._orderedRows(cfg) : { source: [], load: [] };
    this._pruneVehicleCache(new Set(load.filter((c) => c.vehicle).map((c) => c.id)));
    // Story 9.8: key off the VISIBLE (post-clamp) roster — so toggling "Show all" (which
    // reveals clamped cards / new anchors) flips the key and reflows the overlay ONCE.
    const ids = (cells: SceneCell[]): string => cells.map((c) => c.id).join(',');
    const key = `${ids(this._clampBand(source).visible)}|${ids(this._clampBand(load).visible)}`;
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
    // Story 11.3: the PRIMARY track width (the comb pitch) — the widest cell that is NOT a
    // lone overflow card. A 1-card overflow sub-row balloons to the cap (it has room the
    // 3-card primary row does not), so `max(all cells)` would over-read; the comb must key
    // off the PRIMARY track that sets the channel pitch. Non-wrapped rows have no overflow
    // cell, so this is just the row track.
    let primaryTrack = 0;
    scene.querySelectorAll<HTMLElement>('[data-node]').forEach((cell) => {
      // The `data-node` is the per-instance id (Story 9.7); a wrapped card's cell is
      // found just the same (the query is depth-agnostic across sub-rows).
      const id = cell.dataset.node;
      if (!id) return;
      const rect = cell.getBoundingClientRect();
      abs[id] = rect;
      if (!cell.closest('.subrow.overflow')) primaryTrack = Math.max(primaryTrack, rect.width);
    });
    const rel = relativeAnchors(container, abs);
    // Story-fix (gateway-bus-placement): place the trunk in the inter-row GAP, not
    // at the centroid of card centres (which the tall Powerwall pulls up into the
    // source row). Degrades to the centroid for every degenerate geometry.
    // Story 9.7: pass the present per-INSTANCE ids per band (not the role constants)
    // so multi-instance + wrapped anchors are found; `max(source bottoms)` is the
    // PRIMARY (near) sub-row's bottom, keeping busY just below it.
    // Story 9.15: classify each band by the EFFECTIVE rendered row (the same `_rowOf`
    // the grid packs by), so a promoted node's bottom/top feeds the correct side of the
    // gap line — the trunk re-seats in the NEW inter-row gap. `busAnchorBetweenRows`
    // itself is unchanged (it takes the band id lists as params; only which ids we hand
    // it changes). No `rows` ⇒ canonical ids ⇒ today's busY (zero-diff).
    const cfg = this._resolvedConfig ?? this._config;
    const bus = busAnchorBetweenRows(rel, this._bandIds(cfg, 'source'), this._bandIds(cfg, 'load'));
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
    // Story 11.3 (D-11.3-4a/b): the genuinely width-relative geometry values derive from
    // the MEASURED PRIMARY track width. CSS can't read a JS-measured grid track, so we
    // publish two custom properties the stylesheet consumes (kept STYLESHEET values, not
    // inline, so the ≤540px `@media` resets still win) and one TS value:
    //   • `--scene-track`   — pins the LONE overflow card to the primary track so a wrapped
    //                         band's two sub-rows share ONE pitch (else the 1-card overflow
    //                         row balloons to the cap and its comb leg misses the channel).
    //   • `--subrow-offset` — the overflow channel offset `(track + 80)/2`, so the overflow
    //                         card still centres on a near-row channel at any track width.
    //   • `_longLegPx`      — the `.long` conduit threshold, proportional to the track.
    // Clamp into the [floor, cap] band so a sub-pixel over-measure — or the phone full-width
    // track, never read on the y-axis anyway — can't skew the derivations. At the floor all
    // land on their Story 8.12 / 9.7 literals (380px / 230px / 160), so a standalone-width
    // Scene is byte-identical.
    if (primaryTrack > 0) {
      const trackWidth = Math.min(SCENE_TRACK_MAX_PX, Math.max(SCENE_TRACK_MIN_PX, primaryTrack));
      this._longLegPx = Math.round((trackWidth * LONG_LEG_PX) / SCENE_TRACK_MIN_PX);
      this.style.setProperty('--scene-track', `${trackWidth}px`);
      this.style.setProperty('--subrow-offset', `${(trackWidth + SCENE_BUS_GAP_PX) / 2}px`);
    }
    this.requestUpdate(); // redraw the overlay over the cached geometry
  }

  /** The present per-instance node ids whose EFFECTIVE row (Story 9.15 — `_rowOf`, the
   *  same classifier `_orderedRows` renders by) is `side` — a band's bus-tap anchor keys
   *  (Story 9.7). Classifying by the effective row (not the canonical constant) re-seats
   *  the bus-Y gap when a node is promoted (Hazard A). The vehicle is excluded by
   *  construction (not a `FlowNode`), so the busY derivation stays energy-load-only.
   *  No `rows` ⇒ `_rowOf` returns canonical ⇒ the ids match the pre-9.15 band (zero-diff). */
  private _bandIds(cfg: TeslaCardConfig | undefined, side: SceneRow): string[] {
    return this._model.nodes
      .filter((n) => n.present && this._rowOf(n.role, cfg) === side)
      .map((n) => n.id);
  }

  // ── render (AC1b, AC3d) ─────────────────────────────────────────────────────

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config) return nothing;
    const cfg = this._resolvedConfig ?? this._config;
    // Story 8.5/9.8: the vehicle(s) are present-gated PRESENTATION cells (not flow nodes).
    const vehicleCells = this._vehicleInstanceCells(cfg);
    // The focus coupling (AC3, Story 9.7/9.8): a hovered/focused cell lights itself + every
    // INSTANCE the shared bus couples it to (a source lights all loads, and converse); a
    // focused car lights its FEEDING WC (per-car), a focused WC lights the car(s) it feeds.
    // The rest dim. Per-instance ids — never a hard-coded map (see {@link _coupledLit}).
    const lit = this._coupledLit(vehicleCells);

    // Story 6.7 — PACK each row: render only present cards (no ghost cell). Story 9.3 —
    // WITHIN-ROW order follows `energy.nodes.order`. Story 9.7 — each present role
    // EXPANDS to its instance cells (N cells per duplicated role), each with a unique
    // `data-node`; a band over WRAP_MAX_PER_ROW wraps to a 2nd sub-row ({@link
    // _renderBand}). The Gateway bus follows because `gatewaySegments` taps sort by
    // SPATIAL position, not model order.
    const { source, load } = this._orderedRows(cfg);

    // Layering, back-to-front: the summary RIBBON → the cards → ONE pointer-events:none
    // bus overlay drawing the Gateway running-net trunk + per-instance legs. A
    // vehicle-only / empty model ⇒ `_bus.empty` ⇒ the overlay is omitted.
    return html`
      <div class="scene ${lit ? 'focus' : ''}" role="group" aria-label=${STRINGS.scene.label}>
        ${this._hiddenAdvisory()}
        ${this._ribbon()}
        <div class="scene-grid">
          ${this._renderBand(source, 'source-row', lit, cfg)}
          ${this._renderBand(load, 'load-row', lit, cfg)}
        </div>
        ${this._bus.empty
          ? nothing
          : html`<svg class="scene-bus" role="img" aria-label=${this._bus.label()}>
              ${this._gatewayView(lit)}
            </svg>`}
      </div>
    `;
  }

  /**
   * Render one layout band (source or load). ≤{@link WRAP_MAX_PER_ROW} cards render
   * DIRECTLY in the `bandClass` row — byte-identical to pre-9.7 (FR-33 zero-diff).
   * Beyond it (Story 9.7 / AC5), the band WRAPS: the first 3 stay in a `.subrow.primary`
   * and the extras drop to a `.subrow.overflow` offset (CSS padding-left) into the bus
   * channels so their legs comb to the one trunk without crossing a primary card.
   * DOM/Tab order is primary-then-overflow, L→R (reading order, SC 1.3.2/2.4.3) — the
   * offset + the visual top-placement of the overflow row are CSS-only and MUST NOT
   * reorder the DOM (the bus walk = taps-by-x and the focus walk = reading order are
   * two independent orders). An empty band renders nothing (no channel-eating row).
   *
   * Story 9.8 (AC8): a band over the SAFE wrap capacity ({@link SAFE_BAND_MAX}) defensively
   * CLAMPS its dead (≈0-kW) excess via {@link _clampBand} and surfaces an honest "N cards
   * hidden · Show all" notice. A card with ANY live kW is never clamped (it wraps — clamping
   * a live source fabricates a phantom, INV-1). The ≤2-sub-row wrap shows no notice.
   */
  private _renderBand(
    cells: SceneCell[],
    bandClass: 'source-row' | 'load-row',
    lit: Set<string> | undefined,
    cfg: TeslaCardConfig
  ): TemplateResult | typeof nothing {
    if (!cells.length) return nothing;
    const { visible, hidden } = this._clampBand(cells);
    const draw = (c: SceneCell): TemplateResult =>
      c.vehicle ? this._vehicleCell(c, lit) : this._cell(c, lit, cfg);
    const notice = hidden > 0 ? this._overflowNotice(hidden) : nothing;
    const body =
      visible.length <= WRAP_MAX_PER_ROW
        ? html`<div class="${bandClass}">${visible.map(draw)}</div>`
        : html`<div class="${bandClass} wrapped">
            <div class="subrow primary">${visible.slice(0, WRAP_MAX_PER_ROW).map(draw)}</div>
            <div class="subrow overflow">${visible.slice(WRAP_MAX_PER_ROW).map(draw)}</div>
          </div>`;
    return html`${body}${notice}`;
  }

  /**
   * Story 9.8 (AC8) — the defensive ≈0-kW clamp. A band within the safe wrap capacity is
   * returned untouched (no clamp, no notice — the common path, FR-33 zero-diff). Beyond it,
   * DEAD cards (measured `|net| < IDLE_KW` — an accidental/duplicate cell carrying no live
   * flow) are dropped from the END until the band fits, but a card with ANY live kW is
   * NEVER dropped (it wraps — hiding a live source would fabricate a phantom, INV-1). The
   * gate is the MEASURED magnitude (the shared `FlowModel` net / the per-car WC charge),
   * never a config flag. When the user lifts the clamp (`_showAllOverflow`), every card
   * shows but `hidden` still reports the count (so the notice toggles to "Show fewer").
   */
  private _clampBand(cells: SceneCell[]): { visible: SceneCell[]; hidden: number } {
    if (cells.length <= SAFE_BAND_MAX) return { visible: cells, hidden: 0 };
    const net = computeBalance(this._model).net;
    const vehCells = cells.filter((c) => c.vehicle);
    const liveKw = (c: SceneCell): number => {
      if (!c.vehicle) return Math.abs(net[c.id] ?? 0);
      if (isAsleep(this.hass, this._vehicleResolvedConfig(c.config))) return 0;
      return chargeOfEdge(wcEdgeForVehicle(this._model, vehCells.indexOf(c), vehCells.length)).kW;
    };
    const clamped = [...cells];
    for (let i = clamped.length - 1; i >= 0 && clamped.length > SAFE_BAND_MAX; i--) {
      if (liveKw(clamped[i]) < IDLE_KW) clamped.splice(i, 1); // drop a dead excess card
    }
    const hidden = cells.length - clamped.length;
    return { visible: this._showAllOverflow ? cells : clamped, hidden };
  }

  /** The honest "N cards hidden · Show all/fewer" overflow notice (Story 9.8, AC8). The
   *  `.clamp-note` class is the one the 9.7 wrap e2e already forward-references (asserting
   *  the NORMAL wrap shows none). */
  private _overflowNotice(hidden: number): TemplateResult {
    const o = STRINGS.scene.overflow;
    return html`<div class="clamp-note">
      <span class="clamp-note-count">${hidden} ${hidden === 1 ? o.hiddenOne : o.hidden}</span>
      <button type="button" class="clamp-note-toggle" @click=${this._toggleShowAll}>
        ${this._showAllOverflow ? o.showFewer : o.showAll}
      </button>
    </div>`;
  }
  private _toggleShowAll = (): void => {
    this._showAllOverflow = !this._showAllOverflow;
  };

  /**
   * One energy-instance cell — keyboard-focusable, carrying its unique per-instance
   * `data-node` (the bare role when single — zero-diff) and the focus highlight by id.
   * The child ecosystem card binds this instance's resolved entity set (Story 9.7) via
   * {@link _childCard}.
   */
  private _cell(c: SceneCell, lit: Set<string> | undefined, cfg: TeslaCardConfig): TemplateResult {
    // Story 9.7 (AC7): a duplicated instance carries a disambiguating TITLE badge
    // (accent-coloured, ABOVE the card) + an accessible name folding the title in
    // ("Solar, South Array") — two same-role cards are told apart by TITLE, never a
    // numeric :n badge (the id stays internal). Single-instance ⇒ no badge + no
    // aria-label override (the child card's own name reads) + no `has-title` class, so
    // the cell layout is byte-identical to today (FR-33 zero-diff).
    const title = c.title;
    const role = c.role as EnergyRole;
    const aria = title ? `${STRINGS.energy.nodes[role]}, ${title}` : nothing;
    return html`
      <div
        class="scene-cell ${lit?.has(c.id) ? 'lit' : ''} ${title ? 'has-title' : ''}"
        data-node=${c.id}
        tabindex="0"
        aria-label=${aria}
        @mouseenter=${() => this._focus(c.id)}
        @mouseleave=${this._blur}
        @focusin=${() => this._focus(c.id)}
        @focusout=${this._blur}
      >
        ${title
          ? html`<span class="uc-title" style="color:${NODE_COLOR[role]}">${title}</span>`
          : nothing}
        ${this._childCard(c, cfg)}
      </div>
    `;
  }

  // ── focus-highlight (AC3) ───────────────────────────────────────────────────
  /** Focus a cell by its `data-node` id (a per-instance id, or `VEHICLE_NODE_ID`). */
  private _focus(id: string): void {
    this._focused = id;
  }
  private _blur = (): void => {
    this._focused = undefined;
  };

  // ── the vehicle node(s) (Story 8.5 / 9.8) ───────────────────────────────────

  /**
   * Story 9.8 — expand the `vehicle` role into its PRESENT per-instance {@link SceneCell}s
   * (mirrors {@link _instanceCells} for energy roles, but the Vehicle is NOT a `_model`
   * node, so it is present-gated against `hass.states` directly via {@link
   * _vehiclePresentAt} — `_instanceCells` filters by present MODEL nodes and CANNOT be
   * reused here). Honors the single 9.2 hide gate (hiding `vehicle` drops every car). A
   * config with no `instances.vehicle` ⇒ ONE bare-`vehicle` cell (FR-33 zero-diff): the
   * id, present-gate read and embed config are byte-identical to Story 8.10.
   */
  private _vehicleInstanceCells(cfg: TeslaCardConfig): SceneCell[] {
    if (this._hiddenRoles(cfg).includes('vehicle')) return [];
    return roleInstances(cfg, 'vehicle')
      .filter((inst) => this._vehiclePresentAt(inst.config))
      .map((inst) => ({
        id: inst.id,
        role: 'vehicle' as Role,
        vehicle: true,
        title: inst.title,
        config: inst.config,
      }));
  }

  /**
   * One vehicle instance is present iff its battery entity EXISTS in `hass.states`
   * (`rawState` is `undefined` ONLY when the entity is genuinely absent — an asleep
   * car's `battery_level` reads `'unavailable'`, which IS present). A bare instance
   * (no per-car `config`) reads the already-resolved base config — byte-identical to
   * Story 8.10's single-car gate (zero-diff). A 2nd car declared by its own
   * `device`/`prefix`/`entities` re-resolves through `data/` (`resolveEntities`) so it
   * gates on ITS OWN battery sensor, not car #1's. No bare `hass.states` read here.
   */
  private _vehiclePresentAt(override?: Partial<TeslaCardConfig>): boolean {
    return rawState(this.hass, this._vehicleResolvedConfig(override), 'battery_level') !== undefined;
  }

  /**
   * The fully-resolved config for ONE vehicle instance: the per-car override merged
   * shallow over the RAW base config (the same merge the embed `setConfig` uses), then
   * entities auto-resolved through `data/` so a 2nd car declared by `device`/`prefix`
   * resolves its own sensors. A bare instance returns the already-resolved base (the
   * Story 8.10 path — zero-diff).
   */
  private _vehicleResolvedConfig(override?: Partial<TeslaCardConfig>): TeslaCardConfig {
    if (!override) return this._resolvedConfig ?? this._config;
    const merged = { ...this._config, ...override };
    return { ...merged, entities: resolveEntities(this.hass, merged) };
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
   * Story 9.15 — the cross-row promotion map from `energy.nodes.rows`. Defensive
   * (FR-24), a sibling of {@link _orderList}/{@link _hiddenRoles}: a non-object /
   * array / garbage `rows` degrades to "no promotion" (`{}`), never throws. Values
   * are NOT validated here (an unknown key / invalid value is inert) — {@link _rowOf}
   * validates each value at consumption. Pure config (no `hass.states`, no entity ids
   * — AR-1 safe).
   */
  private _rowOverrides(cfg: TeslaCardConfig | undefined): Partial<Record<Role, SceneRow>> {
    const rows = cfg?.energy?.nodes?.rows;
    return rows && typeof rows === 'object' && !Array.isArray(rows)
      ? (rows as Partial<Record<Role, SceneRow>>)
      : {};
  }

  /**
   * Story 9.15 — the SINGLE source of truth for a role's EFFECTIVE (rendered) layout
   * row: its `rows` override iff that override is exactly `'source'`/`'load'`, else
   * the role's CANONICAL row. BOTH the render ({@link _orderedRows}) and the bus-Y
   * band classification ({@link _bandIds}) consult this one classifier, so they can
   * never disagree (Hazard A). An unknown-string key or an invalid value falls
   * through to canonical — graceful, zero-diff when no `rows`.
   */
  private _rowOf(role: Role, cfg: TeslaCardConfig | undefined): SceneRow {
    const override = this._rowOverrides(cfg)[role];
    if (override === 'source' || override === 'load') return override;
    return (SOURCE_ROW as readonly Role[]).includes(role) ? 'source' : 'load';
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
  private _orderedRows(cfg: TeslaCardConfig): { source: SceneCell[]; load: SceneCell[] } {
    const present = new Set<Role>(this._model.nodes.filter((n) => n.present).map((n) => n.role));
    const order = this._orderList(cfg);
    // Story 9.8: N present vehicle cells (was a single hardcoded cell). The vehicle slot
    // is present iff at least one car resolves; its cells expand in instance order.
    const vehicleCells = this._vehicleInstanceCells(cfg);
    // The synthetic `'vehicle'` cell is present iff a car resolves; energy roles come
    // from the model. Build ONE present-set over the full Scene vocabulary.
    const presentRoles = new Set<Role>(
      SCENE_ROW_ORDER.filter((role) =>
        role === 'vehicle' ? vehicleCells.length > 0 : present.has(role)
      )
    );
    // Story 9.15 — each row's EFFECTIVE domain is the canonical vocabulary filtered by
    // `_rowOf` (the one classifier), NOT the canonical SOURCE_ROW/LOAD_ROW constants —
    // so a promoted node packs in its chosen row. With no `rows`, `_rowOf` returns each
    // role's canonical row ⇒ the domains == SOURCE_ROW / LOAD_ROW_WITH_VEHICLE (filtered
    // to present) ⇒ byte-for-byte today (zero-diff). `orderRow` then positions `order`
    // WITHIN the effective row, and each present role EXPANDS to its instance cells (9.7).
    const sourceDomain = SCENE_ROW_ORDER.filter((role) => this._rowOf(role, cfg) === 'source');
    const loadDomain = SCENE_ROW_ORDER.filter((role) => this._rowOf(role, cfg) === 'load');
    const expand = (role: Role): SceneCell[] =>
      role === 'vehicle' ? vehicleCells : this._instanceCells(cfg, role);
    const source = orderRow(sourceDomain, presentRoles, order).flatMap(expand);
    const load = orderRow(loadDomain, presentRoles, order).flatMap(expand);
    return { source, load };
  }

  /**
   * Expand one PRESENT energy role into its present-instance {@link SceneCell}s (Story
   * 9.7), in instance order, joined to the model: an instance renders iff its node is
   * present (an unresolved instance #2 drops, exactly as an absent role does). A
   * single-instance role yields one cell with the bare `role` id (zero-diff).
   */
  private _instanceCells(cfg: TeslaCardConfig, role: Role): SceneCell[] {
    const presentIds = new Set(
      this._model.nodes.filter((n) => n.role === role && n.present).map((n) => n.id)
    );
    return roleInstances(cfg, role)
      .filter((inst) => presentIds.has(inst.id))
      .map((inst) => ({ id: inst.id, role, title: inst.title, entities: inst.entities }));
  }

  /**
   * The car-charging read for the i-th car's WC→Vehicle overlay edge (Story 9.8) — the
   * {@link chargeOfEdge} of its positionally-paired WC edge ({@link wcEdgeForVehicle}),
   * so the i-th car's drawn edge agrees by construction with the i-th WC it feeds from
   * (AC5). An ASLEEP car is forced inactive (mirrors the Hero, which suppresses the charge
   * cue when asleep), gated on THIS car's own merged config: an asleep car's telemetry is
   * unavailable, so the edge degrades to its calm base line, never a false "Charging"
   * (AC3). Single-car/single-WC (`index 0 / count 1`) is byte-identical to Story 8.5.
   */
  private _vehicleChargeFor(
    cell: SceneCell,
    index: number,
    count: number
  ): { active: boolean; kW: number; direction: Direction } {
    if (isAsleep(this.hass, this._vehicleResolvedConfig(cell.config)))
      return { active: false, kW: 0, direction: 'none' };
    return chargeOfEdge(wcEdgeForVehicle(this._model, index, count));
  }

  /**
   * The focus-coupling set, as per-INSTANCE node ids (Story 9.7/9.8). `coupledRoles`
   * stays ENERGY-ROLE-only (no engine edit) — it returns the coupled ROLES; this
   * wrapper expands them to the present instance ids and adds the per-car vehicle coupling:
   *   • focusing a CAR (`vehicle`/`vehicle:i`) lights `{that car} + its feeding WC instance`
   *     (positional pairing — never a sibling car, never every WC);
   *   • focusing an energy instance lights THAT instance + every present instance of the
   *     OTHER coupled roles (so focusing one array lights it + all loads, NEVER its
   *     same-role sibling — D15 "hover lights that tap, not a same-role aggregate"). When a
   *     WC couples: a focused WC lights ONLY the car(s) IT feeds (positional); a focused
   *     SOURCE lights every present car (all are downstream car-loads).
   * Single-instance ⇒ the ids ARE the roles (zero-diff). Presentation-local — the
   * engine never learns about the vehicle node.
   */
  private _coupledLit(vehicleCells: SceneCell[]): Set<string> | undefined {
    const focused = this._focused;
    if (!focused) return undefined;
    const nodes = this._model.nodes;
    const vehicleIds = vehicleCells.map((c) => c.id);

    // Focusing a CAR: light that car + its positionally-paired feeding WC instance.
    if (roleOfInstance(focused) === 'vehicle') {
      const idx = vehicleIds.indexOf(focused);
      if (idx < 0) return undefined; // car vanished under focus ⇒ no stale dim
      const lit = new Set<string>([focused]);
      const wcId = wcEdgeForVehicle(this._model, idx, vehicleCells.length)?.from;
      if (wcId) lit.add(wcId);
      return lit;
    }
    // Story 9.7: a per-instance focus id can VANISH under reconfigure (e.g. `solar:2`
    // when the count drops to 1). Return undefined (not a self-only set) so the render
    // gate drops `.scene.focus` — otherwise the whole Scene dims with nothing lit until
    // the next pointer event (role-keyed focus could not go stale; per-instance can).
    const focusedRole = nodes.find((n) => n.id === focused)?.role;
    if (!focusedRole) return undefined;
    const coupled = coupledRoles(this._model, focusedRole);
    const lit = new Set<string>([focused]); // the focused instance always lights
    for (const n of nodes) {
      if (!n.present) continue;
      // Other coupled roles light ALL their instances; the focused role lights ONLY
      // the focused instance (already added) — its siblings stay dim.
      if (n.role !== focusedRole && coupled.has(n.role)) lit.add(n.id);
    }
    if (coupled.has('wall_connector')) {
      if (focusedRole === 'wall_connector') {
        // A focused WC lights only the car(s) IT feeds (its positionally-paired cars).
        vehicleCells.forEach((cell, i) => {
          if (wcEdgeForVehicle(this._model, i, vehicleCells.length)?.from === focused) lit.add(cell.id);
        });
      } else {
        for (const id of vehicleIds) lit.add(id); // a source focus lights every present car
      }
    }
    return lit;
  }

  /**
   * The vehicle cell — the Scene's vehicle card, rendered after the energy cells. Like them (which embed
   * `tc-solar`/`tc-powerwall`/… via {@link _childCard}), it REUSES the real detailed
   * card: the registered `tesla-card` element (hero · quick actions · panels ·
   * commands — the full information-rich vehicle surface). The card owns its own
   * charge/asleep degradation, so the in-Scene render agrees with the standalone card
   * for free. The wrapper is unchanged from the energy cells: a keyboard-focusable
   * `scene-cell` carrying `data-node="vehicle"`, whose live rect drives the existing
   * WC→Vehicle edge anchor + focus highlight. Story 9.8: the cell carries its
   * per-INSTANCE id (bare `vehicle` for a single car — zero-diff) and, when duplicated,
   * its disambiguating TITLE badge + accessible name (mirrors {@link _cell}, never a
   * `:n` badge); the embed is looked up / created PER id.
   */
  private _vehicleCell(c: SceneCell, lit?: Set<string>): TemplateResult {
    // Story 9.8 (AC9): a duplicated car carries a title badge + accessible name folding
    // the title in ("Car, Garage"); single-car ⇒ no badge / no aria override / no
    // `has-title` class, so the cell DOM is byte-identical to Story 8.10 (FR-33 zero-diff).
    const title = c.title;
    // The accessible name announces the cell as a CAR (the user-facing label, matching the
    // ribbon "Car" tile), NOT "Wall connector" — a vehicle cell is the car, and "Car, Garage"
    // disambiguates it from the sibling WC energy cell. The title folds in (AC9).
    const aria = title ? `${STRINGS.scene.ribbon.tile.wall_connector}, ${title}` : nothing;
    return html`
      <div
        class="scene-cell veh-cell ${lit?.has(c.id) ? 'lit' : ''} ${title ? 'has-title' : ''}"
        data-node=${c.id}
        tabindex="0"
        aria-label=${aria}
        @mouseenter=${() => this._focus(c.id)}
        @mouseleave=${this._blur}
        @focusin=${() => this._focus(c.id)}
        @focusout=${this._blur}
      >
        ${title
          ? html`<span class="uc-title" style="color:${NODE_COLOR.wall_connector}">${title}</span>`
          : nothing}
        ${this._vehicleDetailCard(c)}
      </div>
    `;
  }

  /**
   * The embedded `tesla-card` instance for ONE vehicle cell — created ONCE per instance
   * id and reused across renders, held in the {@link _vehDetail} Map keyed by `cell.id`
   * (the config identity). It is built imperatively (not a static import): `tesla-card.ts`
   * already imports this module, so importing it back would be an import cycle, and
   * `tesla-card` exposes no public `config` property (config goes in via the Lovelace
   * `setConfig`). `setConfig` runs only when the RAW `_config` identity changes (a genuine
   * YAML edit) — NEVER the per-tick resolved cfg, which HA replaces on every state change
   * (re-`setConfig` each tick would reset the embedded card's open panel). The guard is
   * PER ENTRY, so a state tick or a SIBLING car's update never resets another car's open
   * panel. `hass` is refreshed every render, so each card resolves its own entities and
   * stays live exactly as a standalone card. Story 9.8: the per-car `cell.config` override
   * (a 2nd car's device / name / paint) is merged in — `{ ...this._config, ...cell.config,
   * variant:'compact' }`; a bare car (no override) is byte-identical to Story 8.10.
   */
  private _vehicleDetailCard(c: SceneCell): HTMLElement {
    let entry = this._vehDetail.get(c.id);
    if (!entry) {
      const el = document.createElement('tesla-card') as HTMLElement & {
        setConfig?(config: TeslaCardConfig): void;
        hass?: HomeAssistant;
      };
      entry = { el, cfg: undefined as unknown as TeslaCardConfig };
      this._vehDetail.set(c.id, entry);
    }
    const el = entry.el;
    // `tesla-card` is defined by the bundle entry, so at render time the element is
    // upgraded and `setConfig` is present. The guard keeps the Scene robust if it is
    // ever loaded in isolation (a harness importing `my-home` alone, no `tesla-card`):
    // the cell degrades to an empty element instead of throwing. `setConfig` runs only
    // on a raw `_config` change — NOT the per-tick resolved cfg, which HA replaces on
    // every state change (re-`setConfig` each tick would reset the card's open panel).
    // Story 8.10: the embed renders `variant: 'compact'` (hero + status only) so it fits
    // the 380px load-row track; a standalone `tesla-card` stays full. The guard KEY stays
    // the raw `_config` identity — the spread object is NOT stored as the key (storing it
    // would mismatch every tick and re-`setConfig`, resetting the embed).
    if (typeof el.setConfig === 'function' && entry.cfg !== this._config) {
      el.setConfig({ ...this._config, ...c.config, variant: 'compact' });
      entry.cfg = this._config;
    }
    // `hass` refreshes every render so the card stays live (a plain property set —
    // safe even on an unupgraded element).
    el.hass = this.hass;
    return el;
  }

  /**
   * Prune {@link _vehDetail} Map entries whose id is no longer a present vehicle cell
   * (a reconfigure dropped a car) — keeps the embed cache from leaking across reconfigures.
   * Called from {@link updated}, AFTER the present cell roster is known.
   */
  private _pruneVehicleCache(presentIds: ReadonlySet<string>): void {
    for (const id of [...this._vehDetail.keys()]) {
      if (!presentIds.has(id)) this._vehDetail.delete(id);
    }
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
    const label = r.tile[t.role];
    // Story 9.7 (INV-9 / AC6+AC7): a FOLDED tile (count > 1) carries a visible ×N count
    // chip AND an accessible name announcing the multiplicity + the SUMMED total —
    // "Solar, 2, 3.2 kW total" — so the value is never read as a single instance. A
    // single-instance tile is unchanged (no chip, no aria-label ⇒ Lit omits it; zero-diff).
    const folded = t.count > 1;
    const aria = folded ? `${label}, ${t.count}, ${value} ${r.total}` : nothing;
    return html`
      <div class="rib-tile" aria-label=${aria}>
        <span
          class="rib-ico"
          style="color:${color};background:color-mix(in srgb, ${color} 18%, transparent)"
          >${icon(NODE_ICON[t.role], { size: 18 })}</span
        >
        <span class="rib-tcol">
          <span class="rib-tk"
            >${label}${folded ? html`<span class="rib-fold">×${t.count}</span>` : nothing}</span
          >
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
  private _gatewayView(lit?: Set<string>): SVGTemplateResult {
    const anchors = this._anchors;
    if (!anchors) return svg``;
    const segs = gatewaySegments(this._model, anchors, { axis: this._axis });
    // Story 9.8: ONE WC→Vehicle leg per PRESENT car, each from its positionally-paired WC
    // anchor to its own `vehicle:i` anchor — drawn from the SAME per-car edge view the
    // car's badge consumes (AC5 agree-by-construction). Single-car is a zero-diff (one
    // leg, `data-role="vehicle"`, from the single WC).
    const cells = this._vehicleInstanceCells(this._resolvedConfig ?? this._config);
    const vehEdges = cells.map((cell, i) => this._vehicleEdge(anchors, cell, i, cells.length, lit));
    return svg`${this._trunk(segs)}${this._legs(anchors, lit)}${vehEdges}`;
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
    cell: SceneCell,
    index: number,
    count: number,
    lit?: Set<string>
  ): SVGTemplateResult {
    // Story 9.8: the i-th car's leg anchors to ITS positionally-paired WC instance — the
    // `from` of the same edge its charge is read from ({@link wcEdgeForVehicle}), so the
    // edge, the anchor and the badge all agree by construction. Single-car/single-WC ⇒ the
    // one WC edge from `wall_connector` (zero-diff). The charge view is per-car (asleep gate
    // on this car's own config). `data-role` carries the per-instance id (`vehicle` single).
    const ch = this._vehicleChargeFor(cell, index, count);
    const wcId = wcEdgeForVehicle(this._model, index, count)?.from;
    const wc = wcId ? anchors[wcId] : undefined;
    const veh = anchors[cell.id];
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
      <g class="gw-leg ${lit?.has(cell.id) ? 'on' : ''}" data-role=${cell.id}>
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
  private _legs(anchors: Readonly<Record<string, RectLike>>, lit?: Set<string>): SVGTemplateResult {
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
    // Story 9.7: key edges + anchors by NODE ID (`e.from` IS the instance id now), so
    // a duplicated role draws ONE leg per instance to ITS own tap. The accent COLOUR
    // stays per-role. Single-instance ⇒ id === role (zero-diff).
    const edgeById = new Map<string, FlowEdge>();
    for (const e of this._model.edges) edgeById.set(e.from, e);

    const legs = this._model.nodes
      .filter((n) => n.present && anchors[n.id])
      .map((n) => {
        const rect = anchors[n.id];
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

        const edge = edgeById.get(n.id);
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
        // Story 9.7 (AC7): a DUPLICATED instance's leg carries an always-present identity
        // token (the instance ordinal, e.g. "2") at the card end, so two same-hue legs are
        // separable WITHOUT colour and with motion frozen — the static, non-colour
        // disambiguator the kW pill alone can't guarantee (two arrays can read equal kW).
        // Single-instance legs get NO token (only one leg per role — zero-diff).
        const dup = n.id !== n.role;
        const idToken = dup
          ? svg`<text class="gw-leg-id" style="fill:${color}" x=${horiz ? start.x + 13 : start.x} y=${horiz ? start.y : start.y + 13}>${n.id.slice(n.id.indexOf(':') + 1)}</text>`
          : nothing;
        return svg`
          <g class="gw-leg ${lit?.has(n.id) ? 'on' : ''}" data-role=${n.id}>
            <line class="gw-leg-base ${horiz && len > this._longLegPx ? 'long' : ''}" style="stroke:${color}" x1=${start.x} y1=${start.y} x2=${end.x} y2=${end.y}></line>
            ${flow}
            ${this._terminal(start, color)}
            ${this._tap(end, color)}
            ${idToken}
            ${edge
              ? this._pill(mid, color, `${formatNumber(Math.abs(edge.kW), 1)} ${STRINGS.scene.ribbon.unit}`)
              : nothing}
          </g>
        `;
      });
    return svg`${legs}`;
  }

  /** The Scene-unaware child for one role — same shared `.hass` + resolved `.config`. */
  private _childCard(c: SceneCell, cfg: TeslaCardConfig): TemplateResult {
    // Story 9.7: the child binds THIS instance's resolved entity set. The per-instance
    // override rides a config spread (`energy.entities` merged, instance wins) — the
    // child already resolves `config.energy.entities` through the registry path
    // (`resolveEnergyEntities`, AR-1), so NO child-component change is needed; an
    // instance with no override gets the shared resolved cfg (a zero-diff, stable
    // object — see {@link _childCfg}).
    const childCfg = this._childCfg(c, cfg);
    const tag = NODE_TAG[c.role as EnergyRole];
    switch (tag) {
      case 'tc-solar':
        return html`<tc-solar .hass=${this.hass} .config=${childCfg}></tc-solar>`;
      case 'tc-powerwall':
        return html`<tc-powerwall .hass=${this.hass} .config=${childCfg}></tc-powerwall>`;
      case 'tc-grid':
        return html`<tc-grid .hass=${this.hass} .config=${childCfg}></tc-grid>`;
      case 'tc-home':
        return html`<tc-home .hass=${this.hass} .config=${childCfg}></tc-home>`;
      case 'tc-generator':
        return html`<tc-generator .hass=${this.hass} .config=${childCfg}></tc-generator>`;
      default:
        return html`<tc-wall-connector .hass=${this.hass} .config=${childCfg}></tc-wall-connector>`;
    }
  }

  /** Memoized per-instance config — `energy.entities` merged with the instance's
   *  overrides (instance wins). Cached by instance id under the base-config identity
   *  so geometry-only redraws keep the SAME object (the child's resolve cache holds);
   *  an instance with no override returns the shared cfg unchanged (zero-diff). */
  private _childCfgCache?: { base: TeslaCardConfig; map: Map<string, TeslaCardConfig> };
  private _childCfg(c: SceneCell, cfg: TeslaCardConfig): TeslaCardConfig {
    if (!c.entities) return cfg;
    let cache = this._childCfgCache;
    if (!cache || cache.base !== cfg) cache = this._childCfgCache = { base: cfg, map: new Map() };
    let childCfg = cache.map.get(c.id);
    if (!childCfg) {
      childCfg = { ...cfg, energy: { ...cfg.energy, entities: { ...cfg.energy?.entities, ...c.entities } } };
      cache.map.set(c.id, childCfg);
    }
    return childCfg;
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

      /* ── Detected-but-hidden advisory (Story 9.10, AC7/AC9) — a calm amber strip
         above the ribbon. {colors.surface} strip + {colors.amber} accent (NEVER the
         {colors.red} alarm role), no animation (reduced-motion-safe by construction).
         Dismiss + text sit at --tc-text-dim (≥4.5:1). */
      .hidden-advisory {
        display: flex;
        flex-direction: column;
        gap: var(--tc-space-1, 4px);
        margin-bottom: var(--tc-space-3, 12px);
        padding: var(--tc-space-2, 8px) var(--tc-space-3, 12px);
        border-radius: var(--tc-radius-md, 16px);
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
        border-left: 3px solid var(--tc-amber, #fbbf24);
      }
      .hidden-advisory-row {
        display: flex;
        align-items: center;
        gap: var(--tc-space-2, 8px);
      }
      .hidden-advisory-text {
        flex: 1;
        font-size: 13px;
        line-height: 1.4;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .hidden-advisory-dismiss {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* ≥44×44 keyboard/touch target (AC9), no motion */
        min-width: 44px;
        min-height: 44px;
        padding: 0;
        border: none;
        border-radius: var(--tc-radius-sm, 12px);
        background: transparent;
        color: var(--tc-text-dim, #9aa7b8);
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
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
      /* Story 9.7 — the folded-instance count chip (×N) beside a duplicated role's key.
         A quiet accent badge; all token-only (no raw hex). */
      .rib-fold {
        margin-left: var(--tc-space-1, 4px);
        font-weight: var(--tc-fw-stat-key, 700);
        color: var(--tc-amber, #fbbf24);
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
      /* Story 11.3 (D-11.3-3): align-items center -> STRETCH. The rows are flex items of
         this column; STRETCH clamps each row to the container width so the fluid
         minmax(380, ...) tracks size against the AVAILABLE width -- growing past the floor
         to fill a wide column, shrinking back to the floor on a narrow one. (align-items:
         center would size each row to its max-content cap instead, OVERFLOWING a column
         narrower than N x cap.) NOTE the two align-items do opposite jobs: THIS one
         (the flex column cross-axis) is the one that changes; the rows' OWN
         align-items:start below (the grid cross-axis, the 8.12 bus-Y invariant) must
         NOT change (AC3). */
      .scene-grid {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        row-gap: 150px;
      }
      /* Story 11.3 (D-11.3-1): CAPPED fluid tracks minmax(380px, var(--scene-track-max,
         560px)) -- cards grow past the 380px floor to fill the width but STOP at a sane
         per-card cap, so surplus on an ultrawide column becomes outer MARGIN, never the
         unbounded 1fr balloon. The 380px floor keeps a card from ever shrinking below
         standalone size. justify-content:center is RETAINED (NOT dropped): once the row is
         stretched full-width and the tracks hit their cap, it is what distributes the
         surplus as symmetric outer margin (the row reads centred-calm, never left-jammed).
         This is the "retained centring on the grid container" the UX gate (D-11.3-3) named
         as the resolution to the drop-justify-content-vs-stay-centred tension -- below the
         cap there is no surplus so it is inert (zero-diff at the floor). */
      .source-row,
      .load-row {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(380px, var(--scene-track-max, 560px));
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
      /* Story 9.7 (AC7): a duplicated instance stacks a disambiguating TITLE badge above
         its card (gated by .has-title so single-instance cells stay byte-identical). The
         title colour is the node accent, set inline (NODE_COLOR — gate-safe). */
      .scene-cell.has-title {
        display: flex;
        flex-direction: column;
        gap: var(--tc-space-2, 8px);
      }
      .uc-title {
        font-size: var(--tc-fs-label, 11.5px);
        font-weight: var(--tc-fw-label, 700);
        letter-spacing: 0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ── Story 9.8 (AC8) — the defensive ≈0-kW overflow notice. Shown only when a band
         exceeds the safe wrap capacity AND dead (no-live-flow) cards were clamped: an honest
         "N cards hidden · Show all" toggle, NOT a silent truncation. Calm, low-emphasis. */
      .clamp-note {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-top: 8px;
        font-size: var(--tc-fs-label, 11.5px);
        color: var(--tc-text-dim, #9aa7b8);
      }
      .clamp-note-toggle {
        min-height: 44px;
        min-width: 44px;
        padding: 0 12px;
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        border-radius: var(--tc-radius-sm, 12px);
        background: transparent;
        color: var(--tc-text, #f1f5f9);
        font: inherit;
        cursor: pointer;
      }
      .clamp-note-toggle:hover {
        background: color-mix(in srgb, var(--tc-text, #f1f5f9) 10%, transparent);
      }

      /* ── Story 9.7 — WRAP overflow (AC5 / D15). A band over WRAP_MAX_PER_ROW (3)
         cards splits into stacked sub-rows: the band becomes a CENTRED vertical stack
         and each .subrow is the SAME 380px×N grid as an un-wrapped row (cards never
         shrink below standalone size). The OVERFLOW sub-row renders VISUALLY FIRST
         (order:-1 → on top, furthest from the trunk) and is offset 230px = (380 column
         + 80 channel)/2 so each overflow card CENTRES on a near-row channel — its leg
         then combs straight down through the 80px gap to the one trunk WITHOUT crossing
         a primary card. DOM/Tab order stays primary→overflow (reading order, SC 1.3.2/
         2.4.3): the order flip + padding-left are PRESENTATION ONLY and never reorder
         the DOM (the bus walk = taps-by-x and the focus walk = reading order are two
         independent orders). No notice, no clamp — the band just reflows taller. */
      .source-row.wrapped,
      .load-row.wrapped {
        display: flex;
        flex-direction: column;
        /* The band shrinks to its widest (primary) sub-row and centres as a whole;
           its sub-rows share a LEFT origin (flex-start), so the overflow padding-left
           offsets predictably into the channels — NOT re-centred per sub-row.
           Story 11.3 (D-11.3-1): width:max-content -> FIT-CONTENT so the band is
           responsive — it caps at the (now fluid) content width on a wide column and
           shrinks to the available width on a narrow one (max-content would freeze it at
           the per-card cap and overflow a narrower column). margin:0 auto is RETAINED: a
           multi-sub-row band must stay LEFT-origin internally for the overflow comb, so
           centring the band AS A WHOLE via auto margins is the only mechanism that keeps it
           centred-calm without breaking the comb (the "auto margins" resolution the UX gate
           named). The phone @media overrides this to width:100%. */
        align-items: flex-start;
        width: fit-content;
        margin: 0 auto;
        row-gap: 60px;
      }
      .subrow {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(380px, var(--scene-track-max, 560px));
        column-gap: 80px;
        justify-content: start;
        align-items: start;
      }
      .subrow.overflow {
        order: -1; /* the FAR (top) sub-row, visually — DOM order is unchanged (a11y) */
        /* Story 11.3 (D-11.3-4a): pin the LONE overflow card to the measured PRIMARY track
           (--scene-track) so both sub-rows share ONE pitch — without this a 1-card overflow
           row grows to the cap (it has room the 3-card primary row does not) and its comb
           leg misses the channel. Fluid fallback (minmax) before first measure. */
        grid-auto-columns: var(--scene-track, minmax(380px, var(--scene-track-max, 560px)));
        /* The channel offset is fluid — (trackWidth + 80)/2 from the live reflow
           measurement, published as --subrow-offset so each overflow card still centres on
           a near-row channel at any track width. A STYLESHEET value (not inline) with the
           230px floor-width literal as fallback, so the ≤540px @media reset to
           padding-left:0 still wins (an inline style could not be overridden). */
        padding-left: var(--subrow-offset, 230px); /* floor: (380 + 80)/2 = 230 */
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
      /* Story 9.7 (AC7): the per-leg instance-identity token — a small always-present
         ordinal at the card end of a DUPLICATED instance's leg, so same-hue legs separate
         without colour (motion frozen). Static SVG text (no @media, no keyframe), colour
         set inline from NODE_COLOR. */
      .gw-leg-id {
        font-family: var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
        font-size: 11px;
        font-weight: 800;
        text-anchor: middle;
        dominant-baseline: central;
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
        /* Story 9.7: at phone width the Scene is a single vertical column (one-column
           bus) — wrap is a desktop/tablet-kiosk rule. Collapse a wrapped band's sub-rows
           to one stacked column and DROP the channel offset + the visual order flip, so
           every card reads top-to-bottom in DOM order (no near/far split, no horizontal
           offset). The 230px padding-left lives in the stylesheet (not inline) precisely
           so this media query can override it. */
        .source-row.wrapped,
        .load-row.wrapped {
          row-gap: var(--tc-space-4, 16px);
          width: 100%;
        }
        .subrow {
          grid-auto-flow: row;
          grid-template-columns: 1fr;
          grid-auto-columns: auto;
          column-gap: 0;
          row-gap: var(--tc-space-4, 16px);
          width: 100%;
        }
        .subrow.overflow {
          order: 0;
          padding-left: 0;
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
