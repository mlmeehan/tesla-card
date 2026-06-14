import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import type { HomeAssistant, TeslaCardConfig } from './types';

/**
 * Shared base for every child component. Each receives the live `hass`
 * object and the resolved card `config` from the parent <tesla-card>.
 * Design tokens are set on the <tesla-card> host and inherit down through
 * shadow-DOM boundaries (CSS custom properties are inherited), so children
 * only need `sharedStyles` plus their own rules.
 */
export class TcBase extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @property({ attribute: false }) public config!: TeslaCardConfig;
}
