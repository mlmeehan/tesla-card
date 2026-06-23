import { html, css, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiHomeBattery, mdiBatteryPlus, mdiBatteryMinus } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { nodeHero, nodeHeroStyles } from './node-hero';
import { sparkline, dayBars, barLabels, chartStyles } from './chart';
import './slider'; // registers <tc-slider> (the backup-reserve control) for side-effect
// The per-tap reconcile fence is single-sourced in quick-actions (Story 5.2) —
// import the exported constant, never copy a second magic-number timeout.
import { RECONCILE_TIMEOUT_MS } from './quick-actions';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, ring, formatAgeHint } from '../ui';
import {
  resolveEnergyEntities,
  numById,
  stateById,
  unitById,
  attrById,
  type EnergyEntities,
} from '../data/energy';
import { read, referenceNow } from '../data/freshness';
import { fetchCardHistory, type CardHistory } from '../data/history';
import { formatNumber, prettyText, isUnavailable, setNumber, selectOption } from '../helpers';
import type { LovelaceCard, TeslaCardConfig } from '../types';

/** Power magnitude (kW) below which Powerwall flow reads as idle (mirrors panel-energy `THRESH`). */
const THRESH = 0.05;

/** Stable optimistic-override keys for the two Powerwall write controls (Story 8.4). */
const MODE_KEY = 'operation_mode';
const RESERVE_KEY = 'backup_reserve';

/**
 * `tc-powerwall` — standalone Powerwall card (Story 6.2). Stands on the 6.1
 * shell ({@link EcosystemCard}), accent green. Shows state of charge
 * (`powerwall_level` %, via the shared `ring`) and flow direction read directly
 * from the RAW `battery_power` sign (`−` = charging / `+` = discharging —
 * `data/energy`'s documented raw convention, like `panel-energy.ts`, NOT the
 * Epic-4 FlowModel canonical sign). Carries the integration's two genuine write
 * controls (Story 8.4 — a segmented `operation_mode` select + a `backup_reserve`
 * `tc-slider`), which hide when missing and flip the card `kind: 'sensor' →
 * 'control'`. No balance math (that is the Scene, 6.5/6.6).
 */
@customElement('tc-powerwall')
export class TcPowerwall extends EcosystemCard implements LovelaceCard {
  private _energy?: EnergyEntities;
  private _resolveCache?: { hass: unknown; config: TeslaCardConfig };
  /** One-shot recorder history (Story 8.3), id-gated so unrelated hass ticks never re-fetch. */
  @state() private _charts?: CardHistory;
  private _lastChartKey?: string;

  /**
   * Optimistic control overrides (Story 8.4, AC2) — control-key → requested
   * value, the same generalized shape proven in `panel-climate.ts` (number for
   * the reserve %, string for the operation mode). The SIGHTED render reads
   * `optimistic ?? settled` so a control feels instant; the SCREEN-READER state
   * (`aria-pressed`) ignores it and always reflects the settled `hass` truth
   * (UX-DR21 — never announce a change that may not have landed). An entry drops
   * when the live state catches up (reconcile IS the feedback) or its per-tap
   * fence expires. NO new feedback machine — mirror climate, single-source
   * {@link RECONCILE_TIMEOUT_MS}.
   */
  @state() private _optimistic: Record<string, number | string> = {};

  /** One-shot reconcile-fence timer per pending key (cleared on reconcile/disconnect). */
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // No orphaned reconcile fences once we leave the DOM (UX-DR23 — the fence is
    // the safety net, not polling).
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
  }

  /** Typed read of an optimistic override (undefined when none pending — so a
   * stored `0`/`''` survives a `?? settled` fallthrough). */
  private _opt<T extends number | string>(key: string): T | undefined {
    return key in this._optimistic ? (this._optimistic[key] as T) : undefined;
  }

  /** Write an optimistic request + arm a fresh single-shot fence for the key. */
  private _arm(key: string, value: number | string): void {
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

  /**
   * Reconcile each pending override against its LIVE value (re-derived every
   * `hass` tick, never a tap-time snapshot): when the round-trip landed — the live
   * mode equals the requested mode, the live reserve equals the requested % — drop
   * the override (and its fence). `_resolve()` ran first in `willUpdate`, so
   * `this._energy` is current here.
   */
  private _reconcilePending(): void {
    const e = this._energy ?? {};
    for (const key of Object.keys(this._optimistic)) {
      const live =
        key === MODE_KEY
          ? stateById(this.hass, e.operation_mode)
          : key === RESERVE_KEY
            ? numById(this.hass, e.backup_reserve)
            : undefined;
      if (live !== undefined && live === this._optimistic[key]) this._reconcile(key);
    }
  }

  /** Backup-reserve write (number) — optimistic, commits via the existing helper. */
  private _setReserve(value: number): void {
    if (!this.hass || !this._energy?.backup_reserve) return;
    this._arm(RESERVE_KEY, value); // optimistic: the readout + slider jump to the request
    setNumber(this.hass, this._energy.backup_reserve, value);
  }

  /** Operation-mode write (select) — optimistic-sighted / settled-SR; mirrors climate's guard. */
  private _setMode(opt: string): void {
    if (!this.hass || !this._energy?.operation_mode) return;
    if (isUnavailable(stateById(this.hass, this._energy.operation_mode))) return; // never optimistic when disabled
    this._arm(MODE_KEY, opt);
    selectOption(this.hass, this._energy.operation_mode, opt);
  }

  public setConfig(config: TeslaCardConfig): void {
    if (!config) throw new Error('Invalid configuration');
    this.config = { ...config };
  }

  public getCardSize(): number {
    return 3;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') || changed.has('config')) {
      this._resolve();
      this._fetchCharts();
    }
    // Reconcile pending optimistic control requests against the live state on
    // every hass tick (reconcile IS the feedback — UX-DR21). `_resolve()` ran
    // above, so `this._energy` is current before we compare.
    if (changed.has('hass')) this._reconcilePending();
  }

  /** Resolve once per hass/config change — see `tc-solar` for the cache-key rationale. */
  private _resolve(): void {
    if (!this.config) return;
    const c = this._resolveCache;
    if (c && c.hass === this.hass && c.config === this.config) return;
    this._energy = resolveEnergyEntities(this.hass, this.config);
    this._resolveCache = { hass: this.hass, config: this.config };
  }

  /**
   * One-shot, id-gated history fetch (AC3) — see `tc-solar._fetchCharts`. Charts
   * the SoC % today (`powerwall_level`) + the 7-day charged-kWh bars (daily delta
   * of `battery_charged`).
   */
  private _fetchCharts(): void {
    const e = this._energy ?? {};
    const ids = { today: e.powerwall_level, cumulative: e.battery_charged };
    const key = `${ids.today ?? ''}|${ids.cumulative ?? ''}`;
    if (key === this._lastChartKey) return;
    this._lastChartKey = key;
    if (!ids.today && !ids.cumulative) {
      this._charts = undefined;
      return;
    }
    void fetchCardHistory(this.hass, ids, referenceNow(this.hass)).then((h) => {
      this._charts = h;
    });
  }

  protected override render(): TemplateResult {
    const hass = this.hass;
    const e = this._energy ?? {};
    const accent = 'green' as const;
    const label = STRINGS.energy.nodes.powerwall;

    const level = numById(hass, e.powerwall_level);
    const batt = numById(hass, e.battery_power);

    // Calm empty only when NEITHER the SoC nor the flow resolves.
    if (level === undefined && batt === undefined) {
      return this.renderShell(
        { accent, label, ariaLabel: `${label} — ${STRINGS.ecosystem.powerwall.empty}` },
        html`<p class="eco-empty">${STRINGS.ecosystem.powerwall.empty}</p>`
      );
    }

    // Direction from the RAW sign (− charging / + discharging); sub-deadband → idle.
    const dir =
      batt === undefined || Math.abs(batt) <= THRESH
        ? STRINGS.ecosystem.powerwall.idle
        : batt < 0
          ? STRINGS.ecosystem.powerwall.charging
          : STRINGS.ecosystem.powerwall.discharging;
    const charging = batt !== undefined && batt < -THRESH;

    // Honest stamp: prefer the SoC read's freshness, else the flow read's.
    const stampId = e.powerwall_level ?? e.battery_power;
    let stamp: string | undefined;
    if (stampId) {
      const now = referenceNow(hass);
      const r = read(hass, stampId);
      if (r.staleness !== 'fresh') stamp = formatAgeHint(r.lastUpdated, now);
    }

    const soc =
      level === undefined
        ? nothing
        : ring(level, {
            size: 96,
            stroke: 9,
            label: `${formatNumber(level, 0)}%`,
            sub: STRINGS.ecosystem.powerwall.charge,
            color: accentVar(accent),
            charging,
          });

    const flow =
      batt === undefined
        ? nothing
        : statTile({
            icon: mdiHomeBattery,
            label: dir,
            value: `${formatNumber(Math.abs(batt), 1)} kW`,
            color: accentVar(accent),
          });

    // ── Story 8.4: the two genuine write controls ───────────────────────────
    // Reserve (number) and mode (select) are now LIVE controls, not read-only
    // tiles. Each renders only when its entity resolves and is not `unavailable`
    // (AC3 hide-when-missing — never a fake disabled control); when absent the
    // control simply doesn't render and there is nothing to fall back to.

    // Reserve %: a commit-on-release tc-slider. min/max/step read live by id
    // (NaN-safe, defaulting to the honest 0/100/1 reserve range).
    const reserveId = e.backup_reserve;
    const liveReserve = numById(hass, reserveId);
    const reserveAvail = reserveId !== undefined && !isUnavailable(stateById(hass, reserveId));
    const resMin = Number(attrById(hass, reserveId, 'min'));
    const resMax = Number(attrById(hass, reserveId, 'max'));
    const resStep = Number(attrById(hass, reserveId, 'step'));
    const rMin = Number.isFinite(resMin) ? resMin : 0;
    const rMax = Number.isFinite(resMax) ? resMax : 100;
    const rStep = Number.isFinite(resStep) && resStep > 0 ? resStep : 1;
    // Sighted value tracks the optimistic request; the slider's aria-valuenow
    // follows .value (the requested target — acceptable for a slider, per AC2).
    const reserveShown = this._opt<number>(RESERVE_KEY) ?? liveReserve;
    const reserveCtl = reserveAvail
      ? html`<div class="pw-control">
          <div class="lbl-row">
            <span class="pw-lbl">${STRINGS.ecosystem.powerwall.backupReserve}</span>
            ${reserveShown === undefined
              ? nothing
              : html`<span class="pw-val">${formatNumber(reserveShown, 0)}%</span>`}
          </div>
          <tc-slider
            .value=${reserveShown ?? rMin}
            .min=${rMin}
            .max=${rMax}
            .step=${rStep}
            unit="%"
            accent=${accentVar(accent)}
            label=${STRINGS.ecosystem.powerwall.backupReserve}
            @value-changed=${(ev: CustomEvent<{ value: number }>) =>
              this._setReserve(ev.detail.value)}
          ></tc-slider>
        </div>`
      : nothing;

    // Operation mode: one <button class="seg"> per LIVE option (never a hard-coded
    // three — forward-compatible). Sighted highlight = optimistic ?? settled
    // (instant); each segment's aria-pressed = settled live truth only (UX-DR21).
    const modeId = e.operation_mode;
    const liveMode = stateById(hass, modeId);
    const modeAvail = modeId !== undefined && !isUnavailable(liveMode);
    const options = (attrById(hass, modeId, 'options') as string[] | undefined) ?? [];
    const shownMode = this._opt<string>(MODE_KEY) ?? liveMode;
    const modeLabels = STRINGS.ecosystem.powerwall.modes as Record<string, string>;
    const modeLabel = (opt: string): string => modeLabels[opt] ?? prettyText(opt);
    const modeCtl =
      modeAvail && options.length > 0
        ? html`<div class="pw-control">
            <span class="pw-lbl">${STRINGS.ecosystem.powerwall.operationMode}</span>
            <div class="seg-ctl" role="group" aria-label=${STRINGS.ecosystem.powerwall.operationMode}>
              ${options.map(
                (opt) => html`<button
                  class="seg ${opt === shownMode ? 'on' : ''}"
                  aria-pressed=${opt === liveMode}
                  aria-label=${modeLabel(opt)}
                  @click=${() => this._setMode(opt)}
                >
                  ${modeLabel(opt)}
                </button>`
              )}
            </div>
          </div>`
        : nothing;

    const hasControls = reserveAvail || (modeAvail && options.length > 0);
    // Story 9.13 (Tune): the user can hide the write controls even when present
    // (`energy.hide_powerwall_controls`). Absent/false ⇒ today's present-gated
    // behaviour, byte-for-byte (SM-C4 zero-diff). A pure visibility gate — no
    // balance/sign change (AR-6 / FR-33).
    const hideControls = this.config?.energy?.hide_powerwall_controls === true;
    // Mockup order: operation-mode block → backup-reserve block.
    const controls = hasControls && !hideControls ? html`${modeCtl}${reserveCtl}` : nothing;

    // Detail stat-grid: the cumulative charge/discharge energy totals (kWh) only
    // — reserve + mode are now the live controls above (no double-render). All
    // hide-when-missing.
    const tiles: Array<TemplateResult | typeof nothing> = [
      this._kwhTile(e.battery_charged, mdiBatteryPlus, STRINGS.ecosystem.powerwall.charged),
      this._kwhTile(e.battery_discharged, mdiBatteryMinus, STRINGS.ecosystem.powerwall.discharged),
    ];

    const state =
      stamp !== undefined ? 'stale' : batt !== undefined && Math.abs(batt) > THRESH ? 'live' : 'idle';

    const ariaLabel =
      level === undefined ? `${label} ${dir}` : `${label} ${formatNumber(level, 0)}% ${dir}`;

    // Inline charts (Story 8.3): today's SoC % sparkline + the 7-day charged-kWh
    // bars (daily delta). Each included only when its source id resolves.
    const days = this._charts?.days ?? [];
    const charts: Array<TemplateResult | typeof nothing> = [
      e.powerwall_level
        ? sparkline(this._charts?.today ?? [], {
            accent,
            title: STRINGS.ecosystem.chartTodayTitle,
            valueLabel: level === undefined ? undefined : `${formatNumber(level, 0)}%`,
          })
        : nothing,
      e.battery_charged
        ? dayBars(
            days.map((d) => d.value),
            barLabels(days, STRINGS.ecosystem.weekdays),
            { accent, title: STRINGS.ecosystem.chartHistoryTitle }
          )
        : nothing,
    ];

    // Story 8.4: Powerwall flips to a CONTROL card the moment either write
    // control resolves (drops the "Sensor" mark — UX-DR24 read-vs-control
    // honesty); it stays a read-only Sensor on an install without those entities.
    return this.renderDetail(
      {
        accent,
        label,
        stamp,
        state,
        subStatus: dir,
        kind: hasControls ? 'control' : 'sensor',
        ariaLabel,
      },
      { hero: nodeHero('powerwall'), readout: html`${soc}${flow}`, controls, tiles, charts }
    );
  }

  /** A NaN-safe cumulative-energy (kWh) stat tile; hides when its entity is absent. */
  private _kwhTile(
    id: string | undefined,
    iconPath: string,
    label: string
  ): TemplateResult | typeof nothing {
    const v = numById(this.hass, id);
    return statTile({
      icon: iconPath,
      label,
      value: v === undefined ? undefined : `${formatNumber(v, 1)} ${unitById(this.hass, id) ?? 'kWh'}`,
      color: accentVar('green'),
    });
  }

  static override styles = [
    sharedStyles,
    ecosystemShellStyles,
    nodeHeroStyles,
    chartStyles,
    // Story 8.4 control chrome — owned here (the only consumer), the way
    // quick-actions/panel-climate own their control CSS. Flat accent fills only:
    // NO 180° elevation gradient (the single sanctioned one is .surface in styles.ts), no
    // class="surface" literal, no raw decorative hex — the green is composed via
    // accentVar()/--tc-green. Each .seg is ≥44px (the accessibility floor; the
    // mockup's ~36px is bumped) and gets the shared :focus-visible ring.
    css`
      .pw-control {
        display: flex;
        flex-direction: column;
        gap: var(--tc-space-2, 8px);
        min-width: 0;
      }
      .lbl-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--tc-space-2, 8px);
      }
      .pw-lbl {
        font-size: var(--tc-fs-label, 11.5px);
        font-weight: var(--tc-fw-body, 600);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .pw-val {
        font-size: var(--tc-fs-body, 14px);
        font-weight: var(--tc-fw-stat-key, 700);
        color: var(--tc-text, #f1f5f9);
      }
      .seg-ctl {
        display: flex;
        gap: var(--tc-space-1, 4px);
        padding: 4px;
        border-radius: var(--tc-radius-md, 16px);
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
      }
      .seg {
        appearance: none;
        font-family: inherit;
        flex: 1 1 0;
        min-height: 44px;
        padding: 9px 6px;
        border: 0;
        border-radius: var(--tc-radius-sm, 12px);
        background: transparent;
        color: var(--tc-text-dim, #9aa7b8);
        font-size: var(--tc-fs-body, 14px);
        font-weight: var(--tc-fw-body, 600);
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .seg:hover {
        color: var(--tc-text, #f1f5f9);
      }
      .seg.on {
        color: var(--tc-text, #f1f5f9);
        background: color-mix(in srgb, var(--tc-green, #34d399) 16%, transparent);
      }
      @media (prefers-reduced-motion: reduce) {
        .seg {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-powerwall': TcPowerwall;
  }
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tc-powerwall',
  name: STRINGS.energy.nodes.powerwall,
  description: STRINGS.ecosystem.powerwall.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});
