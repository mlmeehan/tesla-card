import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import {
  mdiMinus,
  mdiPlus,
  mdiThermometerLow,
  mdiThermometer,
  mdiCarSeatHeater,
  mdiSteering,
  mdiCarDefrostFront,
  mdiPower,
  mdiSnowflake,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { icon, statTile } from '../ui';
import {
  attr,
  rawState,
  isUnavailable,
  isOn,
  display,
  entityId,
  selectOption,
  toggleEntity,
  clamp,
} from '../helpers';
import type { EntityKey } from '../const';

@customElement('tc-panel-climate')
export class TcPanelClimate extends TcBase {
  private _climateOn(): boolean {
    const s = rawState(this.hass, this.config, 'climate');
    return s !== undefined && s !== 'off' && !isUnavailable(s);
  }

  private _setTemp(next: number): void {
    if (!this.hass) return;
    const min = attr(this.hass, this.config, 'climate', 'min_temp') ?? 15;
    const max = attr(this.hass, this.config, 'climate', 'max_temp') ?? 28;
    this.hass.callService('climate', 'set_temperature', {
      entity_id: entityId(this.config, 'climate'),
      temperature: clamp(next, min, max),
    });
  }

  private _toggleClimate(): void {
    if (!this.hass) return;
    toggleEntity(this.hass, entityId(this.config, 'climate'));
  }

  private _toggle(key: EntityKey): void {
    if (!this.hass) return;
    toggleEntity(this.hass, entityId(this.config, key));
  }

  /** Cycle a heater select (Off → Low → … → highest → Off). */
  private _cycleSeat(key: EntityKey): void {
    if (!this.hass) return;
    const options: string[] | undefined = attr(this.hass, this.config, key, 'options');
    const cur = rawState(this.hass, this.config, key);
    if (!options || options.length === 0 || cur === undefined) return;
    const i = options.indexOf(cur);
    const next = options[(i + 1) % options.length];
    selectOption(this.hass, entityId(this.config, key), next);
  }

  private _seatTile(key: EntityKey, label: string, glyph = mdiCarSeatHeater): TemplateResult {
    const options: string[] | undefined = attr(this.hass, this.config, key, 'options');
    const cur = rawState(this.hass, this.config, key);
    const unavailable = isUnavailable(cur) || !options;
    const levels = options ? options.length - 1 : 3;
    const idx = options && cur ? Math.max(0, options.indexOf(cur)) : 0;
    const intensity = levels > 0 ? idx / levels : 0;
    const active = idx > 0;
    return html`
      <button
        class="seat ${active ? 'on' : ''}"
        ?disabled=${unavailable}
        style=${active
          ? `--lvl:${intensity};background:color-mix(in srgb, var(--tc-orange, #fb923c) ${8 + intensity * 26}%, transparent);border-color:color-mix(in srgb, var(--tc-orange, #fb923c) ${40 + intensity * 30}%, transparent)`
          : nothing}
        @click=${() => this._cycleSeat(key)}
      >
        ${icon(glyph, { size: 22, color: active ? 'var(--tc-orange, #fb923c)' : undefined })}
        <span class="seat-name">${label}</span>
        <span class="bars">
          ${[0, 1, 2].map(
            (b) => html`<span class="bar ${b < idx ? 'fill' : ''}"></span>`
          )}
        </span>
      </button>
    `;
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const on = this._climateOn();
    const targetTemp: number | undefined = attr(this.hass, cfg, 'climate', 'temperature');
    const step = attr(this.hass, cfg, 'climate', 'target_temp_step') ?? 0.5;
    const climateAvail = !isUnavailable(rawState(this.hass, cfg, 'climate'));

    const defrostOn = isOn(this.hass, cfg, 'defrost');
    const copOn = (() => {
      const s = rawState(this.hass, cfg, 'cabin_overheat_protection');
      return s !== undefined && s !== 'off' && !isUnavailable(s);
    })();

    return html`
      <div class="wrap">
        <!-- temperature -->
        <section class="surface temp-card">
          <div class="ambient">
            ${statTile({
              icon: mdiThermometer,
              label: 'Inside',
              value: display(this.hass, cfg, 'inside_temp', { decimals: 0 }),
              color: 'var(--tc-amber, #fbbf24)',
            })}
            ${statTile({
              icon: mdiThermometerLow,
              label: 'Outside',
              value: display(this.hass, cfg, 'outside_temp', { decimals: 0 }),
              color: 'var(--tc-blue, #38bdf8)',
            })}
          </div>

          <div class="stepper">
            <button
              class="step"
              ?disabled=${!on || targetTemp === undefined}
              @click=${() => targetTemp !== undefined && this._setTemp(targetTemp - step)}
              aria-label="Lower temperature"
            >
              ${icon(mdiMinus, { size: 26 })}
            </button>
            <div class="readout ${on ? '' : 'off'}">
              <span class="t">${targetTemp !== undefined ? targetTemp.toFixed(targetTemp % 1 ? 1 : 0) : '—'}</span>
              <span class="deg">°</span>
            </div>
            <button
              class="step"
              ?disabled=${!on || targetTemp === undefined}
              @click=${() => targetTemp !== undefined && this._setTemp(targetTemp + step)}
              aria-label="Raise temperature"
            >
              ${icon(mdiPlus, { size: 26 })}
            </button>
          </div>

          <button
            class="bigpill ${on ? 'on' : ''}"
            ?disabled=${!climateAvail}
            @click=${this._toggleClimate}
          >
            ${icon(mdiPower, { size: 19 })}
            <span>${on ? 'Climate on' : 'Climate off'}</span>
          </button>
        </section>

        <!-- seats -->
        <section class="block">
          <span class="label">Seat &amp; wheel heating</span>
          <div class="grid g3 seats">
            ${this._seatTile('seat_fl', 'Front L')}
            ${this._seatTile('seat_fr', 'Front R')}
            ${this._seatTile('steering_wheel_heater', 'Wheel', mdiSteering)}
            ${this._seatTile('seat_rl', 'Rear L')}
            ${this._seatTile('seat_rc', 'Rear C')}
            ${this._seatTile('seat_rr', 'Rear R')}
          </div>
        </section>

        <!-- extras -->
        <div class="grid g2">
          <button
            class="toggle-tile ${defrostOn ? 'on' : ''}"
            style="--accent:var(--tc-blue, #38bdf8)"
            ?disabled=${isUnavailable(rawState(this.hass, cfg, 'defrost'))}
            @click=${() => this._toggle('defrost')}
          >
            ${icon(mdiCarDefrostFront, { size: 22 })}
            <span>Defrost</span>
          </button>
          <button
            class="toggle-tile ${copOn ? 'on' : ''}"
            style="--accent:var(--tc-teal, #2dd4bf)"
            ?disabled=${isUnavailable(rawState(this.hass, cfg, 'cabin_overheat_protection'))}
            @click=${() => this._toggle('cabin_overheat_protection')}
          >
            ${icon(mdiSnowflake, { size: 22 })}
            <span>Cabin overheat</span>
          </button>
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
        gap: 10px;
      }
      .temp-card {
        padding: 16px;
        border-radius: var(--tc-radius-lg, 22px);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .ambient {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .stepper {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 4px 0;
      }
      .step {
        appearance: none;
        flex: 0 0 auto;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: 1px solid var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        color: var(--tc-text, #f1f5f9);
        display: grid;
        place-items: center;
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .step:hover {
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .step:active {
        transform: scale(0.92);
      }
      .step[disabled] {
        opacity: 0.35;
        pointer-events: none;
      }
      .readout {
        display: flex;
        align-items: baseline;
        justify-content: center;
        flex: 1 1 auto;
      }
      .readout .t {
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
        font-size: var(--tc-fs-climate-readout, 56px);
        font-weight: var(--tc-fw-climate-readout, 760);
        letter-spacing: -0.03em;
        line-height: 1;
        color: var(--tc-text, #f1f5f9);
      }
      .readout .deg {
        font-size: 26px;
        font-weight: 700;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .readout.off .t,
      .readout.off .deg {
        color: var(--tc-text-mute, #64748b);
      }

      .seats {
        gap: 8px;
      }
      .seat {
        appearance: none;
        font-family: inherit;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 12px 6px 10px;
        border-radius: var(--tc-radius-md, 16px);
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
        color: var(--tc-text-dim, #9aa7b8);
        cursor: pointer;
        transition: background 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), border-color 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), color 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .seat:hover {
        border-color: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
      }
      .seat:active {
        transform: scale(0.97);
      }
      .seat.on {
        color: var(--tc-text, #f1f5f9);
      }
      .seat[disabled] {
        opacity: 0.4;
        pointer-events: none;
      }
      .seat-name {
        font-size: 12px;
        font-weight: 650;
      }
      .bars {
        display: flex;
        gap: 3px;
      }
      .bar {
        width: 13px;
        height: 4px;
        border-radius: 2px;
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .bar.fill {
        background: var(--tc-orange, #fb923c);
      }

      .toggle-tile {
        appearance: none;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        padding: 15px;
        border-radius: var(--tc-radius-md, 16px);
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        color: var(--tc-text-dim, #9aa7b8);
        font-size: 14px;
        font-weight: 650;
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), border-color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .toggle-tile:hover {
        border-color: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
      }
      .toggle-tile:active {
        transform: scale(0.98);
      }
      .toggle-tile[disabled] {
        opacity: 0.4;
        pointer-events: none;
      }
      .toggle-tile.on {
        color: var(--accent, var(--tc-blue, #38bdf8));
        border-color: color-mix(in srgb, var(--accent, var(--tc-blue, #38bdf8)) 45%, transparent);
        background: color-mix(in srgb, var(--accent, var(--tc-blue, #38bdf8)) 14%, transparent);
      }

      .bigpill {
        appearance: none;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        width: 100%;
        padding: 14px;
        border-radius: var(--tc-radius-md, 16px);
        border: 1px solid var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        color: var(--tc-text, #f1f5f9);
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
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
        color: var(--tc-teal, #2dd4bf);
        border-color: color-mix(in srgb, var(--tc-teal, #2dd4bf) 45%, transparent);
        background: color-mix(in srgb, var(--tc-teal, #2dd4bf) 14%, transparent);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-climate': TcPanelClimate;
  }
}
