import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiHomeBattery, mdiBatteryLock, mdiCogOutline } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, ring, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, stateById, type EnergyEntities } from '../data/energy';
import { read, referenceNow } from '../data/freshness';
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

  public setConfig(config: TeslaCardConfig): void {
    if (!config) throw new Error('Invalid configuration');
    this.config = { ...config };
  }

  public getCardSize(): number {
    return 3;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') || changed.has('config')) this._resolve();
  }

  /** Resolve once per hass/config change — see `tc-solar` for the cache-key rationale. */
  private _resolve(): void {
    if (!this.config) return;
    const c = this._resolveCache;
    if (c && c.hass === this.hass && c.config === this.config) return;
    this._energy = resolveEnergyEntities(this.hass, this.config);
    this._resolveCache = { hass: this.hass, config: this.config };
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

    const ariaLabel =
      level === undefined ? `${label} ${dir}` : `${label} ${formatNumber(level, 0)}% ${dir}`;

    return this.renderShell(
      { accent, label, stamp, ariaLabel },
      html`${soc}${flow}${reserveTile}${modeTile}`
    );
  }

  static override styles = [sharedStyles, ecosystemShellStyles];
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
