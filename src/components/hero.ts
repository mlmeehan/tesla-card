import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiLock, mdiLockOpenVariant, mdiFlash } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { icon, batteryGauge } from '../ui';
import { carView, carStyles } from './car';
import { resolvePaint } from '../paint';
import {
  num,
  rawState,
  isAsleep,
  isUnavailable,
  fireEvent,
  formatNumber,
  formatHoursToHM,
  unit,
} from '../helpers';
import type { PanelId } from '../types';

interface HeroStatus {
  dot: string;
  label: string;
  sub: string | TemplateResult;
}

@customElement('tc-hero')
export class TcHero extends TcBase {
  private _open(panel: PanelId): void {
    fireEvent<{ panel: PanelId }>(this, 'open-panel', { panel });
  }

  private _isCharging(): boolean {
    return rawState(this.hass, this.config, 'charging_status') === 'Charging';
  }

  private _status(asleep: boolean): HeroStatus {
    if (asleep) {
      return { dot: 'var(--tc-text-mute, #64748b)', label: 'Asleep', sub: 'Tap a command to wake' };
    }
    const shift = rawState(this.hass, this.config, 'shift_state');
    const charging = this._isCharging();
    const locked = rawState(this.hass, this.config, 'lock') === 'locked';

    if (charging) {
      const ttf = num(this.hass, this.config, 'time_to_full_charge');
      const limit = num(this.hass, this.config, 'charge_limit');
      const sub =
        ttf && ttf > 0
          ? `Charging · ${formatHoursToHM(ttf)}${limit ? ` to ${formatNumber(limit)}%` : ''}`
          : 'Charging';
      return { dot: 'var(--tc-green, #34d399)', label: 'Charging', sub };
    }
    if (shift && !isUnavailable(shift) && shift !== 'P') {
      const speed = num(this.hass, this.config, 'speed');
      const map: Record<string, string> = { D: 'Driving', R: 'Reverse', N: 'Neutral' };
      const sub =
        speed !== undefined
          ? `${formatNumber(speed)} ${unit(this.hass, this.config, 'speed') || 'mph'}`
          : 'In motion';
      return { dot: 'var(--tc-blue, #38bdf8)', label: map[shift] ?? 'Driving', sub };
    }
    return {
      dot: locked ? 'var(--tc-green, #34d399)' : 'var(--tc-amber, #fbbf24)',
      label: 'Parked',
      sub: html`<span class="lockline">
        ${icon(locked ? mdiLock : mdiLockOpenVariant, { size: 14 })}
        ${locked ? 'Locked' : 'Unlocked'}
      </span>`,
    };
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const asleep = isAsleep(this.hass, cfg);
    const name = cfg.name ?? 'Model Y';
    const image = cfg.image;
    const status = this._status(asleep);

    const battery = asleep ? undefined : num(this.hass, cfg, 'battery_level');
    const limit = num(this.hass, cfg, 'charge_limit');
    const charging = !asleep && this._isCharging();
    const rangeNum = num(this.hass, cfg, 'battery_range');
    const rangeUnit = unit(this.hass, cfg, 'battery_range') || 'mi';

    return html`
      <div class="hero surface">
        <div class="head">
          <div class="title">
            <span class="name">${name}</span>
            <span class="status">
              <span class="dot" style="background:${status.dot}"></span>
              <span class="st-label">${status.label}</span>
              <span class="st-sep">·</span>
              <span class="st-sub">${status.sub}</span>
            </span>
          </div>
        </div>

        <div class="car-stage ${asleep ? 'asleep' : ''}">
          ${carView({
            image,
            name,
            body: cfg.body,
            paint: resolvePaint(this.hass, cfg),
            charging,
          })}
        </div>

        <button
          class="battery"
          @click=${() => this._open('charging')}
          aria-label="Open charging"
        >
          <div class="bat-top">
            <span class="bat-pct">
              ${charging ? icon(mdiFlash, { size: 22, color: 'var(--tc-green, #34d399)' }) : nothing}
              ${battery !== undefined ? `${formatNumber(battery)}%` : '—'}
            </span>
            <span class="bat-range">
              ${rangeNum !== undefined ? `${formatNumber(rangeNum)} ${rangeUnit}` : '—'}
            </span>
          </div>
          ${batteryGauge(battery, { limit, charging, height: 14 })}
        </button>
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    carStyles,
    css`
      .hero {
        padding: 18px 20px 20px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
      }
      .title {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .name {
        font-size: var(--tc-fs-name, 21px);
        font-weight: var(--tc-fw-name, 750);
        letter-spacing: -0.01em;
        color: var(--tc-text, #f1f5f9);
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--tc-text-dim, #9aa7b8);
        flex-wrap: wrap;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
        box-shadow: 0 0 8px currentColor;
      }
      .st-label {
        font-weight: 650;
        color: var(--tc-text, #f1f5f9);
      }
      .st-sep {
        opacity: 0.5;
      }
      .lockline {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }

      /* ── car render ──────────────────────────────────────────────── */
      .car-stage {
        position: relative;
        display: grid;
        place-items: center;
        padding: 10px 0 14px;
        min-height: 160px;
      }
      .car-stage::after {
        content: '';
        position: absolute;
        bottom: 8px;
        left: 50%;
        transform: translateX(-50%);
        width: 58%;
        height: 26px;
        background: radial-gradient(
          ellipse at center,
          rgba(0, 0, 0, 0.5),
          transparent 72%
        );
        filter: blur(7px);
        z-index: 0;
      }
      .car-img {
        position: relative;
        z-index: 1;
        display: block;
        margin: 0 auto;
        max-width: min(100%, 470px);
        max-height: 232px;
        width: 100%;
        object-fit: contain;
        filter: drop-shadow(0 22px 30px rgba(0, 0, 0, 0.45));
        transition: opacity 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), filter 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .car-stage.asleep .car-img {
        opacity: 0.5;
        filter: grayscale(0.4) drop-shadow(0 16px 22px rgba(0, 0, 0, 0.4));
      }

      /* ── battery row ─────────────────────────────────────────────── */
      .battery {
        appearance: none;
        border: 0;
        background: transparent;
        color: inherit;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 6px;
        margin: -6px;
        border-radius: var(--tc-radius-md, 16px);
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .battery:hover {
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
      }
      .bat-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .bat-pct {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--tc-fs-battery, 26px);
        font-weight: var(--tc-fw-battery, 760);
        letter-spacing: -0.02em;
        color: var(--tc-text, #f1f5f9);
        line-height: 1;
      }
      .bat-pct .tc-ico {
        margin-bottom: -2px;
      }
      .bat-range {
        font-size: 15px;
        font-weight: 650;
        color: var(--tc-text-dim, #9aa7b8);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-hero': TcHero;
  }
}
