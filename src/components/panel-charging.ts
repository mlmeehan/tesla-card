import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import {
  mdiLightningBolt,
  mdiSpeedometer,
  mdiBatteryCharging,
  mdiClockOutline,
  mdiFlashOutline,
  mdiEvStation,
  mdiPowerPlug,
  mdiPowerPlugOff,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { icon, batteryGauge, statTile } from '../ui';
import './slider';
import {
  num,
  attr,
  rawState,
  isUnavailable,
  isOn,
  display,
  entityId,
  setNumber,
  toggleEntity,
  formatNumber,
  formatHoursToHM,
  prettyText,
} from '../helpers';
import type { EntityKey } from '../const';

@customElement('tc-panel-charging')
export class TcPanelCharging extends TcBase {
  private _setNumber(key: EntityKey, value: number): void {
    if (!this.hass) return;
    setNumber(this.hass, entityId(this.config, key), value);
  }

  private _toggleCharge(): void {
    if (!this.hass) return;
    toggleEntity(this.hass, entityId(this.config, 'charge_switch'));
  }

  private _timeToFull(): string {
    const h = num(this.hass, this.config, 'time_to_full_charge');
    if (h === undefined || h <= 0) return '—';
    return formatHoursToHM(h);
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const battery = num(this.hass, cfg, 'battery_level');
    const limit = num(this.hass, cfg, 'charge_limit');
    const status = rawState(this.hass, cfg, 'charging_status');
    const charging = status === 'Charging';
    const rangeNum = num(this.hass, cfg, 'battery_range');
    const rangeUnit = attr(this.hass, cfg, 'battery_range', 'unit_of_measurement') || 'mi';

    const limitMin = num(this.hass, cfg, 'charge_limit') !== undefined
      ? (attr(this.hass, cfg, 'charge_limit', 'min') ?? 50)
      : 50;
    const limitMax = attr(this.hass, cfg, 'charge_limit', 'max') ?? 100;
    const limitStep = attr(this.hass, cfg, 'charge_limit', 'step') ?? 1;

    const amps = num(this.hass, cfg, 'charge_current');
    const ampMin = attr(this.hass, cfg, 'charge_current', 'min') ?? 0;
    const ampMax = attr(this.hass, cfg, 'charge_current', 'max') ?? 48;
    const ampStep = attr(this.hass, cfg, 'charge_current', 'step') ?? 1;

    const chargeOn = isOn(this.hass, cfg, 'charge_switch');
    const chargeAvail = !isUnavailable(rawState(this.hass, cfg, 'charge_switch'));
    const portState = rawState(this.hass, cfg, 'charge_port');

    return html`
      <div class="wrap">
        <!-- battery summary -->
        <section class="surface block">
          <div class="bsum">
            <div class="bnum">
              <span class="big">${battery !== undefined ? formatNumber(battery) : '—'}</span>
              <span class="pct">%</span>
            </div>
            <div class="bmeta">
              <span class="range">${rangeNum !== undefined ? `${formatNumber(rangeNum)} ${rangeUnit}` : '—'}</span>
              <span class="cstatus ${charging ? 'live' : ''}">
                ${charging ? icon(mdiLightningBolt, { size: 14 }) : nothing}
                ${status && !isUnavailable(status) ? prettyText(status) : 'Idle'}
              </span>
            </div>
          </div>
          ${batteryGauge(battery, { limit, charging, height: 18 })}
          ${limit !== undefined
            ? html`<div class="limit-note">
                Charge limit <strong>${formatNumber(limit)}%</strong>
              </div>`
            : nothing}
        </section>

        <!-- start/stop -->
        <button
          class="bigpill ${chargeOn ? 'on' : ''}"
          ?disabled=${!chargeAvail}
          @click=${this._toggleCharge}
        >
          ${icon(chargeOn ? mdiPowerPlugOff : mdiPowerPlug, { size: 20 })}
          <span>${chargeOn ? 'Stop charging' : 'Start charging'}</span>
        </button>

        <!-- charge limit -->
        <section class="block">
          <div class="lbl-row">
            <span class="label">Charge limit</span>
            <span class="val">${limit !== undefined ? `${formatNumber(limit)}%` : '—'}</span>
          </div>
          <tc-slider
            .value=${limit ?? 80}
            .min=${limitMin}
            .max=${limitMax}
            .step=${limitStep}
            unit="%"
            accent="var(--tc-blue, #38bdf8)"
            ?disabled=${limit === undefined}
            @value-changed=${(e: CustomEvent<{ value: number }>) =>
              this._setNumber('charge_limit', e.detail.value)}
          ></tc-slider>
        </section>

        <!-- charge current -->
        <section class="block">
          <div class="lbl-row">
            <span class="label">Charge current</span>
            <span class="val">${amps !== undefined ? `${formatNumber(amps)} A` : '—'}</span>
          </div>
          <tc-slider
            .value=${amps ?? 0}
            .min=${ampMin}
            .max=${ampMax}
            .step=${ampStep}
            unit=" A"
            accent="var(--tc-green, #34d399)"
            ?disabled=${amps === undefined}
            @value-changed=${(e: CustomEvent<{ value: number }>) =>
              this._setNumber('charge_current', e.detail.value)}
          ></tc-slider>
        </section>

        <!-- live stats -->
        <div class="grid g3">
          ${statTile({
            icon: mdiLightningBolt,
            label: 'Power',
            value: display(this.hass, cfg, 'charger_power', { decimals: 1 }),
            color: 'var(--tc-green, #34d399)',
          })}
          ${statTile({
            icon: mdiSpeedometer,
            label: 'Rate',
            value: display(this.hass, cfg, 'charge_rate'),
            color: 'var(--tc-blue, #38bdf8)',
          })}
          ${statTile({
            icon: mdiBatteryCharging,
            label: 'Added',
            value: display(this.hass, cfg, 'charge_energy_added', { decimals: 1 }),
            color: 'var(--tc-teal, #2dd4bf)',
          })}
          ${statTile({
            icon: mdiClockOutline,
            label: 'Time to full',
            value: this._timeToFull(),
            color: 'var(--tc-amber, #fbbf24)',
          })}
          ${statTile({
            icon: mdiFlashOutline,
            label: 'Voltage',
            value: display(this.hass, cfg, 'charger_voltage'),
            color: 'var(--tc-purple, #a78bfa)',
          })}
          ${statTile({
            icon: mdiEvStation,
            label: 'Charge port',
            value: portState && !isUnavailable(portState) ? prettyText(portState) : '—',
            color: portState === 'open' ? 'var(--tc-amber, #fbbf24)' : 'var(--tc-text-dim, #9aa7b8)',
          })}
        </div>
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .wrap {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .block {
        display: flex;
        flex-direction: column;
        gap: 9px;
      }
      section.surface.block {
        padding: 16px;
        border-radius: var(--tc-radius-lg, 22px);
      }
      .bsum {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .bnum {
        display: flex;
        align-items: baseline;
        gap: 2px;
      }
      .bnum .big {
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
        font-size: var(--tc-fs-charging-display, 40px);
        font-weight: var(--tc-fw-charging-display, 780);
        line-height: 1;
        letter-spacing: -0.02em;
      }
      .bnum .pct {
        font-size: 18px;
        font-weight: 700;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .bmeta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
      }
      .range {
        font-size: 15px;
        font-weight: 650;
        color: var(--tc-text, #f1f5f9);
      }
      .cstatus {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .cstatus.live {
        color: var(--tc-green, #34d399);
      }
      .limit-note {
        margin-top: 10px;
        font-size: 12.5px;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .limit-note strong {
        color: var(--tc-text, #f1f5f9);
      }
      .lbl-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .lbl-row .val {
        font-size: 14px;
        font-weight: 700;
        color: var(--tc-text, #f1f5f9);
      }
      .bigpill {
        appearance: none;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        width: 100%;
        padding: 15px;
        border-radius: var(--tc-radius-md, 16px);
        border: 1px solid var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        color: var(--tc-text, #f1f5f9);
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), border-color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .bigpill:hover {
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .bigpill:active {
        transform: scale(0.99);
      }
      .bigpill[disabled] {
        opacity: 0.4;
        pointer-events: none;
      }
      .bigpill.on {
        color: var(--tc-green, #34d399);
        border-color: color-mix(in srgb, var(--tc-green, #34d399) 45%, transparent);
        background: color-mix(in srgb, var(--tc-green, #34d399) 14%, transparent);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-charging': TcPanelCharging;
  }
}
