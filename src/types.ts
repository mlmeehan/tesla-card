import type { EntityKey } from './const';
import type { PaintSource } from './paint';
import type { EnergyEntities } from './energy';
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
 * Layered render for the recolorable body. Four flat images served by HA (e.g.
 * `/local/tesla-card/color.webp`). No vehicle artwork ships with the card —
 * bring your own render (the build pipeline lives in the project docs). The card
 * needs zero per-vehicle geometry: it just composites these four layers.
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
}

export interface TeslaCardConfig {
  type: string;
  /** Displayed vehicle name (defaults to "Model Y"). */
  name?: string;
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
  /**
   * Tesla energy site + Wall Connector wiring for the Energy panel. Entities
   * are auto-detected from the `tesla_fleet`/`powerwall` integration; override
   * any here, or set `hide: true` to suppress the panel even when detected.
   */
  energy?: EnergyConfig;
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
  /** Force the integration dialect; auto-detected from the Tesla integration when omitted. */
  integration?: Integration;
  /** Which detail panel is open initially (default "charging"). */
  default_panel?: PanelId;
  /** Hide the detail tabs entirely (hero + quick actions only). */
  hide_panels?: boolean;
  /** Hide the quick-action buttons row. */
  hide_quick_actions?: boolean;
  /** Hide the command buttons (wake/honk/flash/…) under the panels. */
  hide_commands?: boolean;
}

/** Detail emitted when the hero / quick actions request a panel switch. */
export interface OpenPanelDetail {
  panel: PanelId;
}

/**
 * The three glanceable charge states the Hero renders (Story 3.4, FR-5/UX-DR10):
 * `parked` (neutral, not plugged), `plugged` (connected, at rest — blue port glow
 * + cable) and `charging` (live kW — green port glow + cable + pulsing halo).
 * Derived from the discrete charging-state entity via `normalizeChargingState`
 * (NOT signed power). `charging ⇒ plugged` (AC2) is structural: the port-glow/cable
 * renders for BOTH `plugged` and `charging`, so green is a superset of blue. Shared
 * by the Hero (classifier) and `carView` (the render opt).
 */
export type ChargeVisual = 'parked' | 'plugged' | 'charging';
