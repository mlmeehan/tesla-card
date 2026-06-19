import { html, css, nothing, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
import { STRINGS } from '../strings';
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
  srState,
  prettyText,
} from '../helpers';
// The per-tap reconcile fence is single-sourced in quick-actions (Story 5.2) —
// reuse the exported constant rather than copy a second magic number.
import { RECONCILE_TIMEOUT_MS } from './quick-actions';
import type { EntityKey } from '../const';

/** Distinct optimistic-override slot for the numeric setpoint (the 'climate'
 * entity also backs the on/off BOOLEAN slot, so the setpoint needs its own key). */
const TEMP_KEY = 'temperature';

@customElement('tc-panel-climate')
export class TcPanelClimate extends TcBase {
  /**
   * Optimistic overrides (Story 5.6, AC2) — control-key → requested value, one
   * shape across all three kinds: boolean (on/off pill, defrost, cabin-overheat),
   * number (the setpoint, under {@link TEMP_KEY}), string (seat/wheel cycler
   * levels). Generalizes the proven quick-actions pattern. The SIGHTED render
   * reads `optimistic ?? settled` so a control feels instant; the SCREEN-READER
   * name/`aria-pressed` ignores it and always reflects the settled `hass` truth
   * (UX-DR21 — never announce a change that may not have landed). An entry drops
   * when the live state catches up (reconcile IS the feedback) or its per-tap
   * fence expires (honest revert).
   */
  @state() private _optimistic: Record<string, boolean | number | string> = {};

  /** One-shot reconcile-fence timer per pending key (cleared on reconcile/disconnect). */
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // No orphaned reconcile fences once we leave the DOM (UX-DR23).
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
  }

  /**
   * Reconcile on every `hass` tick: when a pending control's LIVE value now
   * equals its optimistic request, the round-trip landed → drop the override (and
   * its fence). Re-derived from the live state, never a tap-time snapshot, so a
   * change made elsewhere reconciles correctly. A still-disagreeing tick is the
   * expected in-flight window; only a matching tick or the fence clears it.
   */
  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has('hass')) return;
    for (const key of Object.keys(this._optimistic)) {
      if (this._liveValue(key) === this._optimistic[key]) this._reconcile(key);
    }
  }

  /** The current settled value for a pending override key (boolean | number | string). */
  private _liveValue(key: string): boolean | number | string | undefined {
    switch (key) {
      case 'climate':
        return this._climateOn();
      case 'cabin_overheat_protection':
        return this._copOn();
      case 'defrost':
        return isOn(this.hass, this.config, 'defrost');
      case TEMP_KEY:
        return attr(this.hass, this.config, 'climate', 'temperature');
      default:
        return rawState(this.hass, this.config, key as EntityKey); // seat/wheel selects
    }
  }

  /** Typed read of an optimistic override (undefined when none pending — so a
   * stored `false`/`0`/`''` survives a `?? settled` fallthrough). */
  private _opt<T extends boolean | number | string>(key: string): T | undefined {
    return key in this._optimistic ? (this._optimistic[key] as T) : undefined;
  }

  /** Write an optimistic request + arm a fresh single-shot fence for the key. */
  private _arm(key: string, value: boolean | number | string): void {
    this._optimistic = { ...this._optimistic, [key]: value };
    this._clearTimer(key);
    this._timers.set(key, setTimeout(() => this._reconcile(key), RECONCILE_TIMEOUT_MS));
  }

  /** Drop a pending override + its fence (reconciled or expired → back to truth). */
  private _reconcile(key: string): void {
    this._clearTimer(key);
    if (!(key in this._optimistic)) return;
    const next = { ...this._optimistic };
    delete next[key];
    this._optimistic = next;
  }

  private _clearTimer(key: string): void {
    const t = this._timers.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      this._timers.delete(key);
    }
  }

  private _climateOn(): boolean {
    const s = rawState(this.hass, this.config, 'climate');
    return s !== undefined && s !== 'off' && !isUnavailable(s);
  }

  /** Cabin-overheat-protection is a `climate`-domain entity → on = not off/unavailable. */
  private _copOn(): boolean {
    const s = rawState(this.hass, this.config, 'cabin_overheat_protection');
    return s !== undefined && s !== 'off' && !isUnavailable(s);
  }

  private _setTemp(next: number): void {
    if (!this.hass) return;
    const min = attr(this.hass, this.config, 'climate', 'min_temp') ?? 15;
    const max = attr(this.hass, this.config, 'climate', 'max_temp') ?? 28;
    const target = clamp(next, min, max);
    this._arm(TEMP_KEY, target); // optimistic: the readout jumps to the requested temp instantly
    this.hass.callService('climate', 'set_temperature', {
      entity_id: entityId(this.config, 'climate'),
      temperature: target,
    });
  }

  private _toggleClimate(): void {
    if (!this.hass) return;
    if (isUnavailable(rawState(this.hass, this.config, 'climate'))) return; // never optimistic when disabled
    this._arm('climate', !this._climateOn());
    toggleEntity(this.hass, entityId(this.config, 'climate'));
  }

  /** Toggle a boolean control (defrost switch, cabin-overheat climate entity). */
  private _toggle(key: EntityKey): void {
    if (!this.hass) return;
    if (isUnavailable(rawState(this.hass, this.config, key))) return;
    const cur =
      key === 'cabin_overheat_protection' ? this._copOn() : isOn(this.hass, this.config, key);
    this._arm(key, !cur);
    toggleEntity(this.hass, entityId(this.config, key));
  }

  /** Cycle a heater select (Off → Low → … → highest → Off). */
  private _cycleSeat(key: EntityKey): void {
    if (!this.hass) return;
    const options: string[] | undefined = attr(this.hass, this.config, key, 'options');
    const cur = rawState(this.hass, this.config, key);
    if (!options || options.length === 0 || isUnavailable(cur)) return;
    // Advance from the DISPLAYED level (optimistic ?? settled) so rapid taps step.
    const displayed = this._opt<string>(key) ?? cur;
    const i = displayed !== undefined ? options.indexOf(displayed) : -1;
    const next = options[(i + 1) % options.length];
    this._arm(key, next); // optimistic: the tile shows the requested level instantly
    selectOption(this.hass, entityId(this.config, key), next);
  }

  private _seatTile(key: EntityKey, label: string, glyph = mdiCarSeatHeater): TemplateResult {
    const options: string[] | undefined = attr(this.hass, this.config, key, 'options');
    const settled = rawState(this.hass, this.config, key);
    const unavailable = isUnavailable(settled) || !options;
    // Sighted level is optimistic; SR name is the settled level (UX-DR21).
    const displayed = this._opt<string>(key) ?? settled;
    const levels = options ? options.length - 1 : 3;
    const idx = options && displayed ? Math.max(0, options.indexOf(displayed)) : 0;
    const intensity = levels > 0 ? idx / levels : 0;
    const active = idx > 0;
    const name = `${label} ${STRINGS.climate.heater}`;
    const srLabel =
      unavailable || settled === undefined ? name : srState(name, prettyText(settled));
    return html`
      <button
        class="seat ${active ? 'on' : ''}"
        ?disabled=${unavailable}
        aria-label=${srLabel}
        style=${active
          ? `--lvl:${intensity};background:color-mix(in srgb, var(--tc-orange, #fb923c) ${8 + intensity * 26}%, transparent);border-color:color-mix(in srgb, var(--tc-orange, #fb923c) ${40 + intensity * 30}%, transparent)`
          : nothing}
        @click=${() => this._cycleSeat(key)}
      >
        ${icon(glyph, { size: 22, color: active ? 'var(--tc-orange, #fb923c)' : undefined })}
        <span class="seat-name">${label}</span>
        <span class="bars" aria-hidden="true">
          ${[0, 1, 2].map(
            (b) => html`<span class="bar ${b < idx ? 'fill' : ''}"></span>`
          )}
        </span>
      </button>
    `;
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const climateAvail = !isUnavailable(rawState(this.hass, cfg, 'climate'));
    const settledOn = this._climateOn();
    const on = this._opt<boolean>('climate') ?? settledOn; // sighted = optimistic
    // An unavailable climate has no confident setpoint → "—", never a stale figure.
    const settledTemp: number | undefined = climateAvail
      ? attr(this.hass, cfg, 'climate', 'temperature')
      : undefined;
    const targetTemp = this._opt<number>(TEMP_KEY) ?? settledTemp; // sighted readout value
    const step = attr(this.hass, cfg, 'climate', 'target_temp_step') ?? 0.5;

    const defrostSettled = isOn(this.hass, cfg, 'defrost');
    const defrostOn = this._opt<boolean>('defrost') ?? defrostSettled;
    const defrostAvail = !isUnavailable(rawState(this.hass, cfg, 'defrost'));
    const copSettled = this._copOn();
    const copOn = this._opt<boolean>('cabin_overheat_protection') ?? copSettled;
    const copAvail = !isUnavailable(rawState(this.hass, cfg, 'cabin_overheat_protection'));

    // Ambient temps HIDE when missing (Story 5.5 statTile contract / EXPERIENCE.md
    // L117): pass `undefined` (not a baked "—") so the tile renders `nothing`.
    const ambient = (key: EntityKey): string | undefined =>
      isUnavailable(rawState(this.hass, cfg, key))
        ? undefined
        : display(this.hass, cfg, key, { decimals: 0 });

    return html`
      <div class="wrap">
        <!-- temperature -->
        <section class="surface temp-card">
          <div class="ambient">
            ${statTile({
              icon: mdiThermometer,
              label: STRINGS.climate.inside,
              value: ambient('inside_temp'),
              color: 'var(--tc-amber, #fbbf24)',
            })}
            ${statTile({
              icon: mdiThermometerLow,
              label: STRINGS.climate.outside,
              value: ambient('outside_temp'),
              color: 'var(--tc-blue, #38bdf8)',
            })}
          </div>

          <!-- role=group names the readout the live region announces (UX-DR21). -->
          <div class="stepper" role="group" aria-label=${STRINGS.climate.setpoint}>
            <button
              class="step"
              ?disabled=${!on || targetTemp === undefined}
              @click=${() => targetTemp !== undefined && this._setTemp(targetTemp - step)}
              aria-label=${STRINGS.climate.lowerTemp}
            >
              ${icon(mdiMinus, { size: 26 })}
            </button>
            <div class="readout ${on ? '' : 'off'}" aria-live="polite">
              <span class="t">${targetTemp !== undefined ? targetTemp.toFixed(targetTemp % 1 ? 1 : 0) : '—'}</span>
              <span class="deg">°</span>
            </div>
            <button
              class="step"
              ?disabled=${!on || targetTemp === undefined}
              @click=${() => targetTemp !== undefined && this._setTemp(targetTemp + step)}
              aria-label=${STRINGS.climate.raiseTemp}
            >
              ${icon(mdiPlus, { size: 26 })}
            </button>
          </div>

          <button
            class="bigpill ${on ? 'on' : ''}"
            ?disabled=${!climateAvail}
            @click=${this._toggleClimate}
            aria-pressed=${settledOn}
            aria-label=${climateAvail
              ? srState(STRINGS.climate.climate, settledOn ? STRINGS.climate.stateOn : STRINGS.climate.stateOff)
              : STRINGS.climate.climate}
          >
            ${icon(mdiPower, { size: 19 })}
            <span>${on ? STRINGS.climate.on : STRINGS.climate.off}</span>
          </button>
        </section>

        <!-- seats -->
        <section class="block">
          <span class="label">${STRINGS.climate.seatHeating}</span>
          <div class="grid g3 seats">
            ${this._seatTile('seat_fl', STRINGS.climate.seats.fl)}
            ${this._seatTile('seat_fr', STRINGS.climate.seats.fr)}
            ${this._seatTile('steering_wheel_heater', STRINGS.climate.seats.wheel, mdiSteering)}
            ${this._seatTile('seat_rl', STRINGS.climate.seats.rl)}
            ${this._seatTile('seat_rc', STRINGS.climate.seats.rc)}
            ${this._seatTile('seat_rr', STRINGS.climate.seats.rr)}
          </div>
        </section>

        <!-- extras -->
        <div class="grid g2">
          <button
            class="toggle-tile ${defrostOn ? 'on' : ''}"
            style="--accent:var(--tc-blue, #38bdf8)"
            ?disabled=${!defrostAvail}
            @click=${() => this._toggle('defrost')}
            aria-pressed=${defrostSettled}
            aria-label=${defrostAvail
              ? srState(STRINGS.climate.defrost, defrostSettled ? STRINGS.climate.stateOn : STRINGS.climate.stateOff)
              : STRINGS.climate.defrost}
          >
            ${icon(mdiCarDefrostFront, { size: 22 })}
            <span>${STRINGS.climate.defrost}</span>
          </button>
          <button
            class="toggle-tile ${copOn ? 'on' : ''}"
            style="--accent:var(--tc-teal, #2dd4bf)"
            ?disabled=${!copAvail}
            @click=${() => this._toggle('cabin_overheat_protection')}
            aria-pressed=${copSettled}
            aria-label=${copAvail
              ? srState(STRINGS.climate.cabinOverheat, copSettled ? STRINGS.climate.stateOn : STRINGS.climate.stateOff)
              : STRINGS.climate.cabinOverheat}
          >
            ${icon(mdiSnowflake, { size: 22 })}
            <span>${STRINGS.climate.cabinOverheat}</span>
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
