import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
import { STRINGS } from '../strings';
import { icon, batteryGauge, statTile } from '../ui';
import { adapterFor, classifyChargeState } from '../data/dialect';
import './slider';
import {
  num,
  attr,
  rawState,
  isUnavailable,
  isOn,
  isAsleep,
  display,
  entityId,
  setNumber,
  toggleEntity,
  formatNumber,
  formatHoursToHM,
  prettyText,
} from '../helpers';
import type { EntityKey } from '../const';

// The canonical charge-state WORDS for the coverage-gated status span (Story
// 16.1), keyed by the shared classifier's 3-state visual. Copy SELECTION lives
// HERE beside the STRINGS import — `data/dialect.ts` returns states, never
// user-facing copy (AR-18).
const WORD: Record<'charging' | 'plugged' | 'parked', string> = {
  charging: STRINGS.status.charging,
  plugged: STRINGS.status.pluggedIdle,
  parked: STRINGS.status.parked,
};

@customElement('tc-panel-charging')
export class TcPanelCharging extends TcBase {
  /**
   * Battery-headline display mode (Story 5.5 AC3). Presentation-only — the AC
   * requires the toggle to render + switch live; no config persistence is in
   * scope. 'percent' shows `battery_level` %, 'range' shows `battery_range` + its
   * unit. Defaults to percent (the prototype's only prior readout).
   */
  @state() private _display: 'percent' | 'range' = 'percent';

  private _setNumber(key: EntityKey, value: number): void {
    if (!this.hass) return;
    setNumber(this.hass, entityId(this.config, key), value);
  }

  private _toggleCharge(): void {
    if (!this.hass) return;
    toggleEntity(this.hass, entityId(this.config, 'charge_switch'));
  }

  private _timeToFull(): string | undefined {
    // Missing/unavailable entity → hide the tile (AC1). A PRESENT but ≤0 reading
    // (not charging / already full) is indeterminate, not absent → "—" (reserve
    // the dash for present-but-indeterminate, per the AC1 predicate split).
    if (isUnavailable(rawState(this.hass, this.config, 'time_to_full_charge'))) {
      return undefined;
    }
    const h = num(this.hass, this.config, 'time_to_full_charge');
    if (h === undefined || h <= 0) return '—';
    return formatHoursToHM(h);
  }

  /**
   * A stat tile's value, or `undefined` when the entity is absent so the tile
   * HIDES (AC1). The predicate mirrors `display`'s "—" trigger (`isUnavailable`):
   * an asleep/unavailable sensor shows FEWER tiles, not a wall of dashes. A
   * present-but-non-numeric value still renders (display() prettyTexts it).
   */
  private _tileVal(key: EntityKey, opts?: { decimals?: number }): string | undefined {
    if (isUnavailable(rawState(this.hass, this.config, key))) return undefined;
    return display(this.hass, this.config, key, opts);
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const battery = num(this.hass, cfg, 'battery_level');
    const limit = num(this.hass, cfg, 'charge_limit');
    const status = rawState(this.hass, cfg, 'charging_status');
    // Classify ONCE (Story 16.1) — the VEHICLE DIALECT's adapter normalizer
    // (Story 15.1: `adapterFor` short-circuits on the parent-stamped
    // `integration`, an O(1) table dispatch) through the SHARED
    // `classifyChargeState` collapse (the Hero's 7→3 table + cable
    // corroboration, declared once in data/dialect). The bolt cue
    // (`.cstatus.live`), the battery gauge AND the status word all derive from
    // THIS one classified value — the span and the bolt can never disagree.
    // The live-green cue is `charging` ONLY ('starting'/'complete'/etc. read as
    // connected-but-not-drawing — 'plugged', mirroring the Hero); the cue
    // predicate is value-identical to the pre-16.1 `normalize === 'charging'`
    // for every dialect (dialect.test.ts equivalence pins). On tesla_custom the
    // source is the boolean `binary_sensor.charging` (`on` → 'charging'; `off`
    // → 'unknown' → cable-corroborated 'plugged'/'parked'), and the coverage
    // gate below swaps the raw "On"/"Off" for the canonical STRINGS word.
    // NaN-safe: the normalizer returns 'unknown' for absent/'unavailable'.
    //
    // ASLEEP outranks the classification entirely (Story 17.1 — the whole-card
    // asleep posture, EXPERIENCE.md "Hero / whole card"): a sleeping car's
    // cached charging state may stay *available* ("Charging" the moment it
    // slept), so classifying the raw value would claim a connected state the
    // Hero contradicts. The gate is the hero.ts mold — force the classified
    // visual to 'parked' from the SAME `isAsleep` predicate the Hero consults,
    // so cue, bolt and gauge all follow dark from the one shared `charging`
    // const; the span gets its own asleep-first branch below (it must also
    // outrank the `unavailable`→"Idle" short-circuit — one rule, no split
    // brain). Tiles/sliders/pill keep their own isUnavailable degradation.
    const asleep = isAsleep(this.hass, cfg);
    const adapter = adapterFor(this.hass, cfg);
    const visual = asleep
      ? 'parked'
      : classifyChargeState(
          adapter.normalizeChargingState(status),
          isOn(this.hass, cfg, 'charge_cable')
        );
    const charging = visual === 'charging';
    const rangeNum = num(this.hass, cfg, 'battery_range');
    const rangeUnit = attr(this.hass, cfg, 'battery_range', 'unit_of_measurement') || 'mi';
    const showRange = this._display === 'range';

    // attr() on a missing/absent entity already yields undefined → the ?? default,
    // so no separate presence guard is needed (the slider is disabled when
    // `limit === undefined` regardless of these bounds).
    const limitMin = attr(this.hass, cfg, 'charge_limit', 'min') ?? 50;
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
              <span class="big"
                >${showRange
                  ? rangeNum !== undefined
                    ? formatNumber(rangeNum)
                    : '—'
                  : battery !== undefined
                    ? formatNumber(battery)
                    : '—'}</span
              >
              <span class="pct">${showRange ? rangeUnit : '%'}</span>
            </div>
            <div class="bmeta">
              <!-- range-vs-% display toggle (AC3) — presentation-only @state -->
              <div class="seg" role="group" aria-label=${STRINGS.charging.display}>
                <button
                  type="button"
                  class="seg-opt ${!showRange ? 'sel' : ''}"
                  aria-pressed=${!showRange}
                  aria-label=${STRINGS.charging.percent}
                  @click=${() => (this._display = 'percent')}
                >
                  %
                </button>
                <button
                  type="button"
                  class="seg-opt ${showRange ? 'sel' : ''}"
                  aria-pressed=${showRange}
                  @click=${() => (this._display = 'range')}
                >
                  ${STRINGS.charging.range}
                </button>
              </div>
              <span class="cstatus ${charging ? 'live' : ''}">
                ${charging ? icon(mdiLightningBolt, { size: 14 }) : nothing}
                ${asleep
                  ? STRINGS.status.asleep
                  : status && !isUnavailable(status)
                    ? adapter.chargingOverrideCovers(status)
                      ? WORD[visual]
                      : prettyText(status)
                    : STRINGS.charging.idle}
              </span>
            </div>
          </div>
          ${batteryGauge(battery, { limit, charging, height: 18 })}
          <!-- charge-target line (AC3): honest "Target N%" the car stops at; the
               --tc-blue gauge tick above marks the same position. Both hide when
               charge_limit is absent (graceful). -->
          ${limit !== undefined
            ? html`<div class="limit-note">
                ${STRINGS.charging.target} <strong>${formatNumber(limit)}%</strong>
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
          <span>${chargeOn ? STRINGS.charging.stop : STRINGS.charging.start}</span>
        </button>

        <!-- charge limit -->
        <section class="block">
          <div class="lbl-row">
            <span class="label">${STRINGS.charging.chargeLimit}</span>
            <span class="val">${limit !== undefined ? `${formatNumber(limit)}%` : '—'}</span>
          </div>
          <tc-slider
            .value=${limit ?? 80}
            .min=${limitMin}
            .max=${limitMax}
            .step=${limitStep}
            unit="%"
            label=${STRINGS.charging.chargeLimit}
            accent="var(--tc-blue, #38bdf8)"
            ?disabled=${limit === undefined}
            @value-changed=${(e: CustomEvent<{ value: number }>) =>
              this._setNumber('charge_limit', e.detail.value)}
          ></tc-slider>
        </section>

        <!-- charge current -->
        <section class="block">
          <div class="lbl-row">
            <span class="label">${STRINGS.charging.chargeCurrent}</span>
            <span class="val">${amps !== undefined ? `${formatNumber(amps)} A` : '—'}</span>
          </div>
          <tc-slider
            .value=${amps ?? 0}
            .min=${ampMin}
            .max=${ampMax}
            .step=${ampStep}
            unit=" A"
            label=${STRINGS.charging.chargeCurrent}
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
            label: STRINGS.charging.power,
            value: this._tileVal('charger_power', { decimals: 1 }),
            color: 'var(--tc-green, #34d399)',
          })}
          ${statTile({
            icon: mdiSpeedometer,
            label: STRINGS.charging.rate,
            value: this._tileVal('charge_rate'),
            color: 'var(--tc-blue, #38bdf8)',
          })}
          ${statTile({
            icon: mdiBatteryCharging,
            label: STRINGS.charging.added,
            value: this._tileVal('charge_energy_added', { decimals: 1 }),
            color: 'var(--tc-teal, #2dd4bf)',
          })}
          ${statTile({
            icon: mdiClockOutline,
            label: STRINGS.charging.timeToFull,
            value: this._timeToFull(),
            color: 'var(--tc-amber, #fbbf24)',
          })}
          ${statTile({
            icon: mdiFlashOutline,
            label: STRINGS.charging.voltage,
            value: this._tileVal('charger_voltage'),
            color: 'var(--tc-purple, #a78bfa)',
          })}
          ${statTile({
            icon: mdiEvStation,
            label: STRINGS.charging.chargePort,
            // Present (open/closed/etc.) → prettyText; missing/unavailable → hide (AC1).
            value: portState && !isUnavailable(portState) ? prettyText(portState) : undefined,
            // Open-state cue routes through the dialect seam — the vehicle
            // dialect's adapter since Story 15.1 (behaviour-identical: no adapter
            // carries a cover override, AC6-pinned) — never an inline `=== 'open'`.
            color: adapter.normalizeCoverState(portState) === 'open' ? 'var(--tc-amber, #fbbf24)' : 'var(--tc-text-dim, #9aa7b8)',
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
        gap: 6px;
      }
      /* range-vs-% segmented toggle (AC3) — calm pill from .surface tokens. */
      .seg {
        display: inline-flex;
        padding: 3px;
        gap: 2px;
        border-radius: var(--tc-pill, 999px);
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
      }
      .seg-opt {
        appearance: none;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* ≥44px hit target (UX-DR21) without bloating the calm pill visually. */
        min-width: 44px;
        min-height: 30px;
        padding: 4px 12px;
        border: 0;
        border-radius: var(--tc-pill, 999px);
        background: transparent;
        color: var(--tc-text-dim, #9aa7b8);
        font-size: 12.5px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .seg-opt:hover {
        color: var(--tc-text, #f1f5f9);
      }
      .seg-opt.sel {
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
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
