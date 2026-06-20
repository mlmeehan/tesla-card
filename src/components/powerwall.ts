import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiHomeBattery, mdiBatteryLock, mdiCogOutline, mdiBatteryPlus, mdiBatteryMinus } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { nodeHero, nodeHeroStyles } from './node-hero';
import { sparkline, dayBars, barLabels, chartStyles } from './chart';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, ring, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, stateById, unitById, type EnergyEntities } from '../data/energy';
import { read, referenceNow } from '../data/freshness';
import { fetchCardHistory, type CardHistory } from '../data/history';
import { formatNumber, prettyText, isUnavailable } from '../helpers';
import type { LovelaceCard, TeslaCardConfig } from '../types';

/** Power magnitude (kW) below which Powerwall flow reads as idle (mirrors panel-energy `THRESH`). */
const THRESH = 0.05;

/**
 * `tc-powerwall` — standalone Powerwall card (Story 6.2). Stands on the 6.1
 * shell ({@link EcosystemCard}), accent green. Shows state of charge
 * (`powerwall_level` %, via the shared `ring`) and flow direction read directly
 * from the RAW `battery_power` sign (`−` = charging / `+` = discharging —
 * `data/energy`'s documented raw convention, like `panel-energy.ts`, NOT the
 * Epic-4 FlowModel canonical sign). Optional backup-reserve / operation-mode
 * tiles hide when missing. No balance math (that is the Scene, 6.5/6.6).
 */
@customElement('tc-powerwall')
export class TcPowerwall extends EcosystemCard implements LovelaceCard {
  private _energy?: EnergyEntities;
  private _resolveCache?: { hass: unknown; config: TeslaCardConfig };
  /** One-shot recorder history (Story 8.3), id-gated so unrelated hass ticks never re-fetch. */
  @state() private _charts?: CardHistory;
  private _lastChartKey?: string;

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

    const reserve = numById(hass, e.backup_reserve);
    const reserveTile =
      reserve === undefined
        ? nothing
        : statTile({
            icon: mdiBatteryLock,
            label: STRINGS.energy.reserve,
            value: `${formatNumber(reserve, 0)}%`,
            color: accentVar(accent),
          });

    const mode = stateById(hass, e.operation_mode);
    const modeTile =
      !mode || isUnavailable(mode)
        ? nothing
        : statTile({
            icon: mdiCogOutline,
            label: STRINGS.energy.mode,
            value: prettyText(mode),
            color: 'var(--tc-purple, #a78bfa)',
          });

    // Detail stat-grid: reserve + mode (read-only — controls are 8.4) plus the
    // cumulative charge/discharge energy totals (kWh), all hide-when-missing.
    const tiles: Array<TemplateResult | typeof nothing> = [
      reserveTile,
      modeTile,
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

    // Powerwall stays a SENSOR in this story — its writable mode/reserve controls
    // land in 8.4; here mode/reserve remain read-only telemetry tiles (AC3).
    return this.renderDetail(
      { accent, label, stamp, state, subStatus: dir, kind: 'sensor', ariaLabel },
      { hero: nodeHero('powerwall'), readout: html`${soc}${flow}`, tiles, charts }
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

  static override styles = [sharedStyles, ecosystemShellStyles, nodeHeroStyles, chartStyles];
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
