import type { EntityKey } from './const';
import type { PaintSource } from './paint';
import type { EnergyEntities } from './data/energy';
import type { Integration } from './data/dialect';

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  callService: (
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>
  ) => Promise<unknown>;
  locale?: { language: string };
  themes?: Record<string, unknown>;
  /**
   * One-shot WebSocket command over HA's OWN authenticated connection (Story
   * 8.3 — recorder/history reads). Optional + generic for strictness; the index
   * signature already permits the call, this just types its result. SANCTIONED
   * by `no-network-egress` (rides HA's socket; the card opens none of its own).
   */
  callWS?: <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
  /** Present on the real hass object; typed loosely for runtime access. */
  [key: string]: any;
}

export interface LovelaceCard extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: TeslaCardConfig): void;
  getCardSize?(): number | Promise<number>;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: TeslaCardConfig): void;
}

export type PanelId =
  | 'climate'
  | 'charging'
  | 'energy'
  | 'closures'
  | 'tyres'
  | 'location'
  | 'media';

/** User-facing energy wiring: per-key overrides + an explicit hide switch. */
export interface EnergyConfig {
  /** Override any auto-detected energy/Wall-Connector entity id. */
  entities?: Partial<EnergyEntities>;
  /** Suppress the Energy panel even when an energy site is detected. */
  hide?: boolean;
}

/**
 * Tyre low-pressure check tuning (FR-19). Values are in the sensor's NATIVE
 * unit (bar or psi) — never assume one.
 */
export interface TyresConfig {
  /**
   * Recommended cold pressure. Default: the MAX of the four live corner
   * readings (peer baseline — a cold morning lowers all four together, so a
   * relative check is inherently overnight-temp-robust).
   */
  recommended?: number;
  /**
   * How far below `recommended` a corner must fall to warn. Default tuned to
   * clear a normal overnight temp dip (~0.3 bar / ~4 psi by unit) — NOT a
   * fixed absolute PSI threshold.
   */
  margin?: number;
}

/**
 * @unstable — the published Layer contract (FR-7). PUBLIC SURFACE; its freeze is
 * a one-way door (architecture.md D6), so this shape MAY change before it freezes
 * — bring-your-own pack authors (Story 3.7) must expect it to shift. The
 * machine-checkable half is {@link LAYER_CONTRACT} (`src/layer-contract.ts`); the
 * human contract is `docs/layer-contract.md`. The required/optional split here
 * (`color`/`shade`/`mask` required; `highlight?`/`apertureLayers?`/`chargePort?`
 * optional) MUST match `LAYER_CONTRACT` — `layer-contract.test.ts` asserts it.
 *
 * Layered render for the recolorable body. Flat images served by HA (e.g.
 * `/local/tesla-card/color.webp`). No vehicle artwork ships with the card —
 * bring your own render (the build pipeline lives in the project docs). The card
 * needs zero per-vehicle geometry: it just composites these layers + named nodes.
 * Every layer/overlay must be IDENTICAL pixel size and ALIGNED (registration),
 * shot from a front-right 3/4 camera, anchored to the 1024×687 coordinate
 * contract (`HERO_VIEWBOX`). See `docs/layer-contract.md` for the shape, and
 * `docs/asset-packs.md` for bringing your own render / multi-model packs (WebP
 * externalization, per-model placement, swapping by URL — never committed).
 */
export interface BodyLayers {
  /** Base layer — glass, wheels, lights and ground shadow keep their real pixels. */
  color: string;
  /** Grayscale luminance, composited `multiply` — reproduces form on any paint. */
  shade: string;
  /** Clearcoat glints, composited `screen` — stay near-white on any paint. Optional. */
  highlight?: string;
  /** Luminance mask (white = the paint region) confining the recolor to the body. */
  mask: string;
  /** Intrinsic layer size for the SVG viewBox (defaults to the `HERO_VIEWBOX` contract, 1024×687). */
  width?: number;
  height?: number;
  /**
   * Optional per-aperture photoreal overlay URLs (Story 3.5 slot). Each is a
   * neutral-silver inpainted overlay served by HA (e.g. `/local/tesla-card/
   * aperture-frunk.webp`) — NEVER bundled (no vehicle artwork ships). When an
   * aperture's asset is supplied, `carView` renders it as a crossfading
   * `<image class="ap ap-<name>">` layer above the recolor stack, below the
   * charge overlay; when absent it renders nothing for that aperture (graceful).
   * The photoreal assets, the asset pipeline, and the formal inclusion of
   * apertures in the published `@unstable` Layer contract are Stories 3.6/3.7 —
   * this story wires the slot + ships the bundled generic-EV indications (the
   * primary verification target), exactly as Story 3.4 deferred its body-layers
   * charge overlay.
   */
  apertureLayers?: { frunk?: string; liftgate?: string; door?: string; window?: string };
  /**
   * Named contract NODE (not a paint layer): the charge-port anchor in 1024×687
   * space (`HERO_VIEWBOX`) for the body-mode charge overlay (Story 3.6 — fulfils
   * the Story 3.4 body-layers deferral). When omitted, `carView` uses a contract
   * default (`DEFAULT_BODY_CHARGE_PORT`, a sensible rear-quarter point for a
   * front-right 3/4 view); a pack whose port reads elsewhere overrides it. Absent
   * ⇒ no failure — the default anchors the cue (graceful by construction).
   */
  chargePort?: { x: number; y: number };
}

/**
 * The single public, **forward-compatible** card configuration (AR-14, FR-29,
 * R9). This is the ONE public type the card exposes; every Lovelace YAML config
 * is a `TeslaCardConfig`. It grew field-by-field across Epics 1–6 (D2 `integration`,
 * D3 `tyres`, D6 `body`/`paint` layer-pack refs, plus energy/weather/visibility
 * tuning) and is consolidated here (Story 7.1) into one coherent, reviewed surface.
 *
 * **Forward-compatibility contract (the R9 back-compat obligation):** unknown keys
 * are TOLERATED, never rejected. `setConfig` spreads the config (`{ ...config }`)
 * and validates only what it consumes, so a NEWER YAML carrying a field this build
 * doesn't know still renders on an OLDER build, and OLD YAML never breaks on a
 * NEWER build. Optional fields all degrade by auto-detection (FR-24 / NFR-4) — a
 * missing/garbage key fills from live entity resolution rather than throwing.
 *
 * Surface keys are **snake_case** (F4); the card consumes them directly (no
 * camelCase mapping layer — none is needed today). Fields are grouped below:
 * identity → render/paint → entity-resolution → panels/visibility → per-feature.
 */
export interface TeslaCardConfig {
  // ── Identity / display ────────────────────────────────────────────────────
  /** Lovelace card type discriminator, e.g. `custom:tesla-card`. */
  type: string;
  /** Displayed vehicle name (defaults to "Model Y"). */
  name?: string;

  // ── Render / paint (the hero) ─────────────────────────────────────────────
  /**
   * URL of the flat car render image. Has NO default — used only when `body` is
   * unset; when both are absent the card shows the bundled generic-EV silhouette
   * (never a `/local/...` fallback that 404s on a fresh install). The flat `image`
   * mode ignores `paint` (only the recolorable `body`/bundled renders recolour).
   */
  image?: string;
  /**
   * Recolorable body render. When set, the hero paints the body to `paint`
   * instead of showing the flat `image`. See {@link BodyLayers}.
   */
  body?: BodyLayers;
  /**
   * Paint colour for the recolorable body. Either a literal CSS colour
   * (`#23519e`), a generic colour name (`"blue"`), or a {@link PaintSource}
   * that reads the colour live from an entity/attribute. Recolours both the
   * `body` layer stack and the bundled generic-EV default; only the flat
   * `image` mode ignores it. Defaults to a neutral silver.
   */
  paint?: string | PaintSource;

  // ── Entity resolution ─────────────────────────────────────────────────────
  /**
   * Vehicle device, by registry id or (user) name. Used to auto-resolve
   * entities by function-name. Auto-detected from the Tesla integration when
   * omitted.
   */
  device?: string;
  /**
   * Entity-id prefix slug to force, e.g. "model_y" for `sensor.model_y_*`.
   * Overrides the slug derived from the device name; rarely needed.
   */
  prefix?: string;
  /** Per-key entity overrides; anything omitted is auto-resolved, then falls back to DEFAULT_ENTITIES. */
  entities?: Partial<Record<EntityKey, string>>;
  /** Force the integration dialect; auto-detected from the Tesla integration when omitted (D2). */
  integration?: Integration;

  // ── Panels / visibility ───────────────────────────────────────────────────
  /** Which detail panel is open initially (default "charging"); an absent/hidden id falls back to the first available panel. */
  default_panel?: PanelId;
  /** Hide the detail tabs entirely (hero + quick actions only). */
  hide_panels?: boolean;
  /** Hide the quick-action buttons row. */
  hide_quick_actions?: boolean;
  /** Hide the command buttons (wake/honk/flash/…) under the panels. */
  hide_commands?: boolean;

  // ── Per-feature tuning ────────────────────────────────────────────────────
  /**
   * Tesla energy site + Wall Connector wiring for the Energy panel. Entities
   * are auto-detected from the `tesla_fleet`/`powerwall` integration; override
   * any here, or set `hide: true` to suppress the panel even when detected.
   */
  energy?: EnergyConfig;
  /**
   * Per-instance wake cooldown in MINUTES (Story 5.4 / AR-9). After a wake, repeat
   * taps within this window are rate-limited (treated as in-flight) and the
   * affordance surfaces "available in Nm" — it never permanently locks the user
   * out (it expires) and never blocks a wake of a car that has settled back to
   * asleep. Defaults to a short built-in window (1 min) when unset/≤0.
   *
   * D3 forward-compat note: an OPT-IN shared-HA-wake-helper ref (a single helper
   * entity coordinating wakes across multiple cards) is a deliberately DEFERRED
   * future field — YAGNI until a real double-wake is observed (architecture D3,
   * §451–453). It is intentionally NOT yet added; the tolerant schema means it
   * can land later without breaking old YAML. Per-instance cooldown is the shipped
   * mechanism today.
   */
  wake_cooldown?: number;
  /**
   * Tyre low-pressure check tuning (Story 5.8 / FR-19). When omitted, the panel
   * derives a peer-baseline `recommended` (max of the four live corners) and a
   * unit-aware default `margin` — values are in the sensor's NATIVE unit. See
   * {@link TyresConfig}.
   */
  tyres?: TyresConfig;
  /**
   * Live-weather vignette tuning for the Solar card (Story 6.4 / UX-DR15). The
   * vignette reads HA CORE `weather.home` (condition) + `sun.sun` (day/night) by
   * default; `entity`/`sun` override those ids (the provenance chip reflects the
   * override honestly). `hide: true` suppresses the vignette even when present.
   */
  weather?: { entity?: string; sun?: string; hide?: boolean };
}

// ─── Relocated internal types (Story 7.1, E9/AC1) ───────────────────────────
// Hero render-path enums (`ChargeVisual`, `ApertureKey`, `ApertureState`) now
// live with their owner in `components/car.ts`; the panel-switch event detail
// (`OpenPanelDetail`) lives with the panel-orchestration parent in
// `tesla-card.ts`. They are NOT part of the public config surface, so they no
// longer sit in this file — keeping `types.ts` the home of the PUBLIC
// `TeslaCardConfig` (+ its sub-shapes) and the platform HA interfaces only.
