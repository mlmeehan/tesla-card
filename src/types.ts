import type { EntityKey } from './const';

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
  | 'closures'
  | 'tyres'
  | 'location'
  | 'media';

export interface TeslaCardConfig {
  type: string;
  /** Displayed vehicle name (defaults to "Model Y"). */
  name?: string;
  /** URL of the car render image (defaults to /local/model_y.png). */
  image?: string;
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
