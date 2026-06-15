import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiAlertCircle } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { icon } from '../ui';
import { num, attr, rawState, isOn, formatNumber } from '../helpers';
import type { EntityKey } from '../const';

interface Corner {
  key: EntityKey;
  warn: EntityKey;
  label: string;
  pos: string;
}

const CORNERS: Corner[] = [
  { key: 'tire_fl', warn: 'tire_warn_fl', label: 'Front L', pos: 'fl' },
  { key: 'tire_fr', warn: 'tire_warn_fr', label: 'Front R', pos: 'fr' },
  { key: 'tire_rl', warn: 'tire_warn_rl', label: 'Rear L', pos: 'rl' },
  { key: 'tire_rr', warn: 'tire_warn_rr', label: 'Rear R', pos: 'rr' },
];

@customElement('tc-panel-tyres')
export class TcPanelTyres extends TcBase {
  private _corner(c: Corner): TemplateResult {
    const value = num(this.hass, this.config, c.key);
    const unit: string = attr(this.hass, this.config, c.key, 'unit_of_measurement') ?? '';
    const isBar = /bar/i.test(unit);
    const warn = isOn(this.hass, this.config, c.warn);
    const text =
      value !== undefined ? formatNumber(value, isBar ? 1 : 0) : '—';
    return html`
      <div class="corner ${c.pos} ${warn ? 'warn' : ''}">
        <span class="c-label">${c.label}</span>
        <span class="c-val">
          ${text}<span class="c-unit">${value !== undefined ? unit : ''}</span>
        </span>
        ${warn
          ? html`<span class="c-warn">${icon(mdiAlertCircle, { size: 13 })} Low</span>`
          : nothing}
      </div>
    `;
  }

  protected override render(): TemplateResult {
    const anyWarn = CORNERS.some((c) => isOn(this.hass, this.config, c.warn));
    const anyData = CORNERS.some(
      (c) => rawState(this.hass, this.config, c.key) !== undefined
    );

    return html`
      <section class="surface block">
        <div class="head">
          <span class="label">Tyre pressure</span>
          <span class="summary ${anyWarn ? 'warn' : anyData ? 'good' : ''}">
            ${anyWarn ? 'Check pressure' : anyData ? 'All normal' : 'No data'}
          </span>
        </div>

        <div class="layout">
          ${this._corner(CORNERS[0])} ${this._corner(CORNERS[1])}
          <div class="car">
            <svg viewBox="0 0 120 200" aria-hidden="true">
              <rect x="28" y="14" width="64" height="172" rx="26"></rect>
              <polygon points="40,40 80,40 74,66 46,66"></polygon>
              <rect x="46" y="74" width="28" height="58" rx="8"></rect>
              <polygon points="46,140 74,140 80,166 40,166"></polygon>
            </svg>
          </div>
          ${this._corner(CORNERS[2])} ${this._corner(CORNERS[3])}
        </div>
      </section>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .block {
        padding: 18px;
        border-radius: var(--tc-radius-lg, 22px);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .summary {
        font-size: 12.5px;
        font-weight: 650;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .summary.good {
        color: var(--tc-green, #34d399);
      }
      .summary.warn {
        color: var(--tc-red, #f87171);
      }

      .layout {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        grid-template-rows: auto auto;
        align-items: center;
        justify-items: center;
        gap: 18px 10px;
      }
      .car {
        grid-column: 2;
        grid-row: 1 / span 2;
        opacity: 0.6;
      }
      .car svg {
        width: 86px;
        height: 150px;
        display: block;
      }
      .car rect {
        fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        stroke-width: 1.5;
      }
      .car polygon,
      .car rect:not(:first-child) {
        fill: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .car polygon {
        stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
        stroke-width: 1;
      }

      .corner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 12px 18px;
        border-radius: var(--tc-radius-md, 16px);
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        min-width: 92px;
        transition: border-color 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), background 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .corner.fl {
        grid-column: 1;
        grid-row: 1;
      }
      .corner.fr {
        grid-column: 3;
        grid-row: 1;
      }
      .corner.rl {
        grid-column: 1;
        grid-row: 2;
      }
      .corner.rr {
        grid-column: 3;
        grid-row: 2;
      }
      .corner.warn {
        border-color: color-mix(in srgb, var(--tc-red, #f87171) 55%, transparent);
        background: color-mix(in srgb, var(--tc-red, #f87171) 12%, transparent);
      }
      .c-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--tc-text-mute, #64748b);
      }
      .c-val {
        font-size: 24px;
        font-weight: 750;
        letter-spacing: -0.02em;
        color: var(--tc-text, #f1f5f9);
        display: inline-flex;
        align-items: baseline;
        gap: 3px;
      }
      .c-unit {
        font-size: 12px;
        font-weight: 600;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .c-warn {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 11px;
        font-weight: 700;
        color: var(--tc-red, #f87171);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-tyres': TcPanelTyres;
  }
}
