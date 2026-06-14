import { html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import {
  mdiLock,
  mdiLockOpenVariant,
  mdiAirConditioner,
  mdiEvStation,
  mdiCarBack,
  mdiCar,
  mdiShieldCar,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { icon } from '../ui';
import type { EntityKey } from '../const';
import { entityId, rawState, isUnavailable, toggleEntity } from '../helpers';

interface QuickAction {
  key: EntityKey;
  label: string;
  accent: string;
  /** icon shown when "on"/active, and when off. */
  iconOn: string;
  iconOff: string;
  /** is the control in its active/highlighted state? */
  on: (s: string | undefined) => boolean;
}

const ACTIONS: QuickAction[] = [
  {
    key: 'lock',
    label: 'Lock',
    accent: 'var(--tc-green)',
    iconOn: mdiLock,
    iconOff: mdiLockOpenVariant,
    on: (s) => s === 'locked',
  },
  {
    key: 'climate',
    label: 'Climate',
    accent: 'var(--tc-teal)',
    iconOn: mdiAirConditioner,
    iconOff: mdiAirConditioner,
    on: (s) => s !== undefined && s !== 'off' && !isUnavailable(s),
  },
  {
    key: 'charge_port',
    label: 'Port',
    accent: 'var(--tc-blue)',
    iconOn: mdiEvStation,
    iconOff: mdiEvStation,
    on: (s) => s === 'open',
  },
  {
    key: 'frunk',
    label: 'Frunk',
    accent: 'var(--tc-amber)',
    iconOn: mdiCar,
    iconOff: mdiCar,
    on: (s) => s === 'open',
  },
  {
    key: 'trunk',
    label: 'Trunk',
    accent: 'var(--tc-amber)',
    iconOn: mdiCarBack,
    iconOff: mdiCarBack,
    on: (s) => s === 'open',
  },
  {
    key: 'sentry',
    label: 'Sentry',
    accent: 'var(--tc-red)',
    iconOn: mdiShieldCar,
    iconOff: mdiShieldCar,
    on: (s) => s === 'on',
  },
];

@customElement('tc-quick-actions')
export class TcQuickActions extends TcBase {
  private _tap(key: EntityKey): void {
    if (!this.hass) return;
    toggleEntity(this.hass, entityId(this.config, key));
  }

  protected override render(): TemplateResult {
    return html`
      <div class="row">
        ${ACTIONS.map((a) => {
          const s = rawState(this.hass, this.config, a.key);
          const unavailable = isUnavailable(s);
          const active = a.on(s);
          return html`
            <div class="ctrl-wrap">
              <button
                class="ctrl ${active ? 'on' : ''}"
                style="--accent:${a.accent}"
                ?disabled=${unavailable}
                @click=${() => this._tap(a.key)}
                aria-label=${a.label}
                aria-pressed=${active}
              >
                ${icon(active ? a.iconOn : a.iconOff, { size: 24 })}
              </button>
              <span class="ctrl-name">${a.label}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .row {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 8px;
        padding: 4px 2px;
      }
      .ctrl[disabled] {
        opacity: 0.35;
        cursor: default;
        pointer-events: none;
      }
      @media (max-width: 540px) {
        .row {
          grid-template-columns: repeat(3, 1fr);
          gap: 14px 8px;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-quick-actions': TcQuickActions;
  }
}
