import {
  LitElement,
  html,
  css,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { resolveEntities } from '../data/resolve';
import { resolveEnergyEntities, type EnergyEntities } from '../data/energy';
import { sliceChanged } from '../data/slice';
import { bindFlowModel } from '../flow/binding';
import { BUS_NODE_ID, type FlowModel } from '../flow/model';
import { SceneBusRenderer, sceneBusStyles, type RectLike } from '../flow/scene-bus';
import { SCENE_NODES, relativeAnchors, deriveBusAnchor, RafCoalescer } from '../flow/my-home';
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
    this.requestUpdate(); // redraw the overlay over the cached geometry
  }

  // ── render (AC1b, AC3d) ─────────────────────────────────────────────────────

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config) return nothing;
    const cfg = this._resolvedConfig ?? this._config;
    const present = new Set(this._model.nodes.filter((n) => n.present).map((n) => n.role));
    // Render a card ONLY for present nodes — an absent node is omitted with its
    // bus edge (AC4), never an empty card holding a grid cell + a dead anchor.
    const cards = SCENE_NODES.filter((role) => present.has(role)).map(
      (role) => html`
        <div class="scene-cell" data-node=${role}>${this._childCard(role, cfg)}</div>
      `
    );

    // Layering, back-to-front: the cards (each composites its own vignette
    // internally — no Scene-level vignette layer) → ONE pointer-events:none bus
    // overlay SVG. The overlay draws in container-relative px (no viewBox), so the
    // live anchors line up 1:1 with the cards beneath. A vehicle-only / empty model
    // ⇒ `_bus.empty` ⇒ the overlay is omitted (no occluding box).
    return html`
      <div class="scene" role="group" aria-label=${STRINGS.scene.label}>
        <div class="scene-grid">${cards}</div>
        ${this._bus.empty
          ? nothing
          : html`<svg class="scene-bus" role="img" aria-label=${this._bus.label()}>
              ${this._bus.view()}
            </svg>`}
      </div>
    `;
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
      /* A functional responsive grid (6.5). The polished 380px×3 / 80px-gap layout
         and the phone-reflow single-column vertical bus are Story 6.6. */
      .scene-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: var(--tc-space-4, 16px);
      }
      .scene-cell {
        min-width: 0;
      }
      /* ONE overlay, strictly pass-through so taps reach the cards' own controls
         beneath (AC3d). No viewBox: it draws in the container's own px space. */
      .scene-bus {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
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
