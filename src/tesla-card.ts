import {
  LitElement,
  html,
  css,
  nothing,
  type TemplateResult,
  type PropertyValues,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  mdiThermometer,
  mdiEvStation,
  mdiCarDoor,
  mdiCarTireAlert,
  mdiMapMarkerRadius,
  mdiPlayCircleOutline,
} from '@mdi/js';
import { CARD_VERSION } from './const';
import { resolveEntities } from './resolve';
import { tokens, sharedStyles } from './styles';
import { icon } from './ui';
import type {
  HomeAssistant,
  TeslaCardConfig,
  LovelaceCard,
  PanelId,
  OpenPanelDetail,
} from './types';

import './components/hero';
import './components/quick-actions';
import './components/commands';
import './components/panel-climate';
import './components/panel-charging';
import './components/panel-closures';
import './components/panel-tyres';
import './components/panel-location';
import './components/panel-media';

const PANELS: { id: PanelId; name: string; icon: string }[] = [
  { id: 'climate', name: 'Climate', icon: mdiThermometer },
  { id: 'charging', name: 'Charging', icon: mdiEvStation },
  { id: 'closures', name: 'Closures', icon: mdiCarDoor },
  { id: 'tyres', name: 'Tyres', icon: mdiCarTireAlert },
  { id: 'location', name: 'Location', icon: mdiMapMarkerRadius },
  { id: 'media', name: 'Media', icon: mdiPlayCircleOutline },
];

@customElement('tesla-card')
export class TeslaCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config!: TeslaCardConfig;
  @state() private _panel: PanelId = 'charging';

  /** `_config` with `entities` filled in by auto-resolution; passed to children. */
  private _resolvedConfig?: TeslaCardConfig;
  /** Inputs the cached resolution was computed from, to skip redundant work. */
  private _resolveCache?: {
    entities: unknown;
    devices: unknown;
    config: TeslaCardConfig;
  };

  public setConfig(config: TeslaCardConfig): void {
    if (!config) throw new Error('Invalid configuration');
    this._config = { ...config };
    if (config.default_panel) this._panel = config.default_panel;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') || changed.has('_config')) this._resolve();
  }

  /** Resolve entities by stable function-name; memoised on registry/config. */
  private _resolve(): void {
    if (!this._config) return;
    const entities = this.hass?.entities;
    const devices = this.hass?.devices;
    const cache = this._resolveCache;
    if (
      cache &&
      cache.entities === entities &&
      cache.devices === devices &&
      cache.config === this._config
    ) {
      return; // registry + config unchanged → keep the cached resolution
    }
    this._resolvedConfig = {
      ...this._config,
      entities: resolveEntities(this.hass, this._config),
    };
    this._resolveCache = { entities, devices, config: this._config };
  }

  public getCardSize(): number {
    return 16;
  }

  public static getStubConfig(): TeslaCardConfig {
    return { type: 'custom:tesla-card' };
  }

  public static async getConfigElement(): Promise<HTMLElement> {
    await import('./editor');
    return document.createElement('tesla-card-editor');
  }

  private _openPanel = (e: CustomEvent<OpenPanelDetail>): void => {
    this._panel = e.detail.panel;
  };

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass) return nothing;
    const cfg = this._resolvedConfig ?? this._config;
    return html`
      <div class="root">
        <tc-hero
          .hass=${this.hass}
          .config=${cfg}
          @open-panel=${this._openPanel}
        ></tc-hero>

        ${cfg.hide_quick_actions
          ? nothing
          : html`<tc-quick-actions
              .hass=${this.hass}
              .config=${cfg}
              @open-panel=${this._openPanel}
            ></tc-quick-actions>`}

        ${cfg.hide_panels
          ? nothing
          : html`
              <div class="tabs" role="tablist">
                ${PANELS.map(
                  (p) => html`
                    <button
                      class="tab ${this._panel === p.id ? 'active' : ''}"
                      role="tab"
                      aria-selected=${this._panel === p.id}
                      @click=${() => (this._panel = p.id)}
                    >
                      ${icon(p.icon, { size: 18 })}<span>${p.name}</span>
                    </button>
                  `
                )}
              </div>
              <div class="panel">${this._renderPanel(cfg)}</div>
            `}

        ${cfg.hide_commands
          ? nothing
          : html`<tc-commands
              .hass=${this.hass}
              .config=${cfg}
            ></tc-commands>`}
      </div>
    `;
  }

  private _renderPanel(cfg: TeslaCardConfig): TemplateResult {
    switch (this._panel) {
      case 'climate':
        return html`<tc-panel-climate .hass=${this.hass} .config=${cfg}></tc-panel-climate>`;
      case 'charging':
        return html`<tc-panel-charging .hass=${this.hass} .config=${cfg}></tc-panel-charging>`;
      case 'closures':
        return html`<tc-panel-closures .hass=${this.hass} .config=${cfg}></tc-panel-closures>`;
      case 'tyres':
        return html`<tc-panel-tyres .hass=${this.hass} .config=${cfg}></tc-panel-tyres>`;
      case 'location':
        return html`<tc-panel-location .hass=${this.hass} .config=${cfg}></tc-panel-location>`;
      case 'media':
        return html`<tc-panel-media .hass=${this.hass} .config=${cfg}></tc-panel-media>`;
    }
  }

  static override styles = [
    tokens,
    sharedStyles,
    css`
      :host {
        display: block;
      }
      .root {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 1080px;
        margin: 0 auto;
        padding: 2px;
      }

      .tabs {
        display: flex;
        gap: 6px;
        padding: 6px;
        background: var(--tc-surface);
        border: 1px solid var(--tc-border);
        border-radius: var(--tc-pill);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .tabs::-webkit-scrollbar {
        display: none;
      }
      .tab {
        flex: 0 1 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 10px 13px;
        border: 0;
        background: transparent;
        color: var(--tc-text-dim);
        border-radius: var(--tc-pill);
        font-family: inherit;
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
        white-space: nowrap;
        transition: color 0.16s var(--tc-ease), background 0.16s var(--tc-ease),
          flex-grow 0.16s var(--tc-ease);
      }
      .tab:hover:not(.active) {
        color: var(--tc-text);
      }
      .tab.active {
        flex: 1 1 auto;
        background: var(--tc-surface-3);
        color: var(--tc-text);
        box-shadow: var(--tc-shadow-sm);
      }
      .tab .tc-ico {
        opacity: 0.95;
      }
      /* Compact bars: only the active tab shows its label; the rest are
         icon-only. Above 760px every label is shown. */
      .tab span {
        display: none;
      }
      .tab.active span {
        display: inline;
      }
      @media (min-width: 760px) {
        .tab {
          flex: 1 1 auto;
        }
        .tab span {
          display: inline;
        }
      }
    `,
  ];
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tesla-card',
  name: 'Tesla Card',
  description: 'A Tesla-app-inspired vehicle card for Tesla Fleet / Teslemetry.',
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});

/* eslint-disable no-console */
console.info(
  `%c TESLA-CARD %c v${CARD_VERSION} `,
  'background:#e82127;color:#fff;font-weight:700;border-radius:4px 0 0 4px;padding:2px 6px',
  'background:#1f2937;color:#fff;border-radius:0 4px 4px 0;padding:2px 6px'
);

declare global {
  interface HTMLElementTagNameMap {
    'tesla-card': TeslaCard;
  }
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}
