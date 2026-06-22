import type { EntityKey } from './const';
import type { PaintSource } from './paint';
import type { EnergyEntities } from './data/energy';
import type { Integration } from './data/dialect';
// Type-only import of the canonical node-key vocabulary (AR-1 safe: registry.ts is
// a pure leaf in src/data/ that imports nothing upward, so this cannot form a cycle
// and reads no hass.states). `Role` is the SIX suite nodes INCLUDING `vehicle`
// (NOT `EnergyRole`, which excludes the car) — exactly the keyspace Epic 9's node
// customization needs. Reusing it keeps the customization keyspace from drifting
// from the registry's single source of truth.
import type { Role } from './data/registry';

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

/**
 * My-Home Scene node/card customization (Epic 9 / CAP-5, FR-41 to ratify).
 *
 * ADDITIVE + OPTIONAL: omit ⇒ today's auto-detect/present-gated Scene, exactly
 * (SM-C4). Its keyspace is {@link Role} — the six suite nodes INCLUDING `vehicle`
 * — NOT `EnergyRole`, which structurally excludes the car. Unknown strings in any
 * list are tolerated and ignored downstream, never thrown (forward-compat / R9).
 * Precedence: a node listed in BOTH `hide` and `order` is HIDDEN (hide wins).
 *
 * Semver back-compat: these keys are purely additive/optional — omitted ⇒ today's
 * behavior — and every future build MUST keep tolerating them (and any unknown
 * extras within), riding the top-level `TeslaCardConfig` forward-compat contract
 * (R9: `setConfig` spreads, validates only what it consumes, never throws). This
 * is the public, JSDoc-pinned 9.1 contract (a fuller user doc lands with the 9.4
 * GUI editor); `types.test.ts` + `tesla-card.config.test.ts` keep it from regressing.
 *
 * SCHEMA-ONLY in Story 9.1 — this declares the stable public home; it ships ZERO
 * consumption. The keys are read later: `hide` by 9.2 (at the `flow/binding.ts`
 * `flowInputsFrom` model seam, so the one shared `FlowModel` drops the node by
 * construction — never a render-only filter), `order` by 9.3 (geometry-driven
 * grid-row packing), `instances` by 9.7 (multi-instance — GATED on a product +
 * UX pass; typed forward-compatibly here, do NOT consume it in 9.1–9.6).
 *
 * REVIEW NOTE (AC1 — "final shape decided in review"): `vehicle` is a Scene NODE,
 * not an energy role, yet this nests node customization under `energy`. The
 * reviewer may prefer to HOIST this to a top-level `nodes?:` key on
 * `TeslaCardConfig`; default here follows the epic's proposed `energy.nodes?`
 * home. Non-blocking — the proposed shape ships as-is.
 */
/**
 * One instance of a duplicated Scene node (Story 9.7). The {@link
 * NodeCustomization.instances} list is a per-instance DESCRIPTOR list — its array
 * LENGTH is the instance count, and each entry carries that instance's
 * disambiguating card `title` + its own per-instance `entities` overrides. Both
 * fields are optional: an empty `{}` is a bare instance that auto-resolves exactly
 * as today's single node does. The FIRST instance auto-resolves (today's single
 * match); instance #2+ SHOULD supply at least the power sensor in `entities`, or it
 * resolves the SAME entity as #1 (a duplicate reading — graceful, not a crash).
 */
export interface InstanceSpec {
  /**
   * Human card title that disambiguates this instance ("South Array") — surfaced
   * as the card title + folded into the accessible name. NOT a numeric `:1`/`:2`
   * badge (the internal instance id stays internal). Omit ⇒ the card shows its
   * status line as today.
   */
  title?: string;
  /**
   * Per-instance entity overrides — the SAME shape `energy.entities` uses, resolved
   * through the same registry-keyed path (AR-1). Wins over auto-resolution for the
   * keys it sets; unset keys still auto-resolve.
   */
  entities?: Partial<EnergyEntities>;
  /**
   * Per-instance embedded-card config override (Story 9.8) — CONSUMED ONLY for the
   * `vehicle` role. A 2nd/3rd car's identity is its own `tesla-card` config (distinct
   * vehicle `device`/`entities`/`name`/`paint`/panels) — a surface `entities:
   * Partial<EnergyEntities>` (the five ENERGY roles' sensor sets) cannot express. It
   * is merged per car into the embedded card as `{ ...baseConfig, ...config, variant:
   * 'compact' }`. Additive + forward-compatible (R9): the energy roles IGNORE it (they
   * resolve via `entities`); omit ⇒ today's single auto-detected Vehicle, byte-identical.
   */
  config?: Partial<TeslaCardConfig>;
}

export interface NodeCustomization {
  /** Nodes to remove from the Scene — each behaves EXACTLY as if absent (9.2 consumes). */
  hide?: Role[];
  /** Left-to-right node order WITHIN a row (sources stay over loads); unlisted nodes keep their order (9.3 consumes). */
  order?: Role[];
  /**
   * Multi-instance / duplicate-role descriptor list (9.7). Keyed by {@link Role};
   * each value is an {@link InstanceSpec}[] whose LENGTH is the instance count and
   * whose entries carry per-instance title + entity overrides. Forward-compatible:
   * a stale count-shaped value (the 9.1 placeholder `Partial<Record<Role, number>>`)
   * or any garbage is TOLERATED — only a valid non-empty array is consumed; anything
   * else degrades to "no instances declared" = today's single auto-resolved node
   * (graceful, FR-24 / R9). A `vehicle` entry is CONSUMED (Story 9.8): each spec's
   * {@link InstanceSpec.config} is the per-car embedded-`tesla-card` override.
   */
  instances?: Partial<Record<Role, InstanceSpec[]>>;
}

/** User-facing energy wiring: per-key overrides + an explicit hide switch. */
export interface EnergyConfig {
  /** Override any auto-detected energy/Wall-Connector entity id. */
  entities?: Partial<EnergyEntities>;
  /** Suppress the Energy panel even when an energy site is detected. */
  hide?: boolean;
  /**
   * My-Home Scene node/card customization (Epic 9 / CAP-5). Additive + optional:
   * omit ⇒ today's auto-detect Scene (SM-C4). See {@link NodeCustomization}.
   */
  nodes?: NodeCustomization;
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
  /**
   * Render density. `'full'` (default, also the value used when omitted or set to
   * any unknown/garbage string — forward-compat, no eager validation) renders the
   * complete card. `'compact'` renders the hero + status line + battery gauge ONLY:
   * it implies `hide_quick_actions` + `hide_panels` + `hide_commands` (regardless of
   * those flags' own values) AND suppresses the hero's flow-overlay kW labels, so the
   * card fits a ~380px column. The single switch the "My Home" in-line embed sets;
   * a standalone card stays `'full'`. When the vehicle is asleep the compact gauge
   * additionally falls back to the cached last-known SoC/range (dimmed via
   * `.tc-stale-copy`) instead of blanking to "—" — a deliberate, compact-only
   * exception to the full card's strict asleep behavior (see `hero.ts`).
   */
  variant?: 'full' | 'compact';

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
