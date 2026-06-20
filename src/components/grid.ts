import { html, css, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiTransmissionTower, mdiImport, mdiExport } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, stateById, unitById, type EnergyEntities } from '../data/energy';
import { read, referenceNow } from '../data/freshness';
import { formatNumber, prettyText, isUnavailable } from '../helpers';
import type { LovelaceCard, TeslaCardConfig } from '../types';

/** Power magnitude (kW) below which a grid flow reads as idle (mirrors panel-energy `THRESH`). */
const THRESH = 0.05;

/**
 * `tc-grid` — standalone Grid card (Story 6.2). Stands on the 6.1 shell
 * ({@link EcosystemCard}) carrying the **neutral** source-node accent (option A:
 * the Scene's `NODE_COLOR.grid` is a deliberate neutral, not one of the 7
 * accents — the shell maps `'neutral'` → `var(--tc-text-dim, …)`). Presents
 * `grid_power` with a human-readable direction read **directly from the RAW
 * sensor sign** (`+` = importing / `−` = exporting — `data/energy`'s documented
 * raw convention, exactly like `panel-energy.ts`, NOT the Epic-4 FlowModel
 * canonical sign), plus a `grid_status` chip. No balance math.
 */
@customElement('tc-grid')
export class TcGrid extends EcosystemCard implements LovelaceCard {
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
    const accent = 'neutral' as const;
    const label = STRINGS.energy.nodes.grid;

    const power = numById(hass, e.grid_power);
    const chip = this._gridChip();

    // Calm empty only when BOTH the power AND the status are absent — a grid with
    // status-only still has something honest to say.
    if (power === undefined && chip === nothing) {
      return this.renderShell(
        { accent, label, ariaLabel: `${label} — ${STRINGS.ecosystem.grid.empty}` },
        html`<p class="eco-empty">${STRINGS.ecosystem.grid.empty}</p>`
      );
    }

    // Direction from the RAW sign (+ import / − export); sub-deadband → idle so
    // sensor jitter never reads as a false direction.
    const dir =
      power === undefined || Math.abs(power) <= THRESH
        ? STRINGS.ecosystem.grid.idle
        : power > 0
          ? STRINGS.ecosystem.grid.importing
          : STRINGS.ecosystem.grid.exporting;

    let stamp: string | undefined;
    if (e.grid_power) {
      const now = referenceNow(hass);
      const r = read(hass, e.grid_power);
      if (r.staleness !== 'fresh') stamp = formatAgeHint(r.lastUpdated, now);
    }

    const tile =
      power === undefined
        ? nothing
        : statTile({
            icon: mdiTransmissionTower,
            label: dir,
            value: `${formatNumber(Math.abs(power), 1)} kW`,
            color: accentVar(accent),
          });

    // Status dot: live while importing/exporting, idle sub-deadband, stale on age.
    const state =
      stamp !== undefined
        ? 'stale'
        : power !== undefined && Math.abs(power) > THRESH
          ? 'live'
          : 'idle';

    // Detail stat-grid: cumulative grid energy totals (kWh), hide-when-missing.
    const tiles: Array<TemplateResult | typeof nothing> = [
      this._kwhTile(e.grid_imported, mdiImport, STRINGS.ecosystem.grid.imported),
      this._kwhTile(e.grid_exported, mdiExport, STRINGS.ecosystem.grid.exported),
    ];

    return this.renderDetail(
      { accent, label, stamp, state, subStatus: dir, kind: 'sensor', ariaLabel: `${label} ${dir}` },
      { readout: html`${chip}${tile}`, tiles }
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
      color: accentVar('neutral'),
    });
  }

  /** Grid-status chip — ok/warn dot, reusing the `panel-energy._gridChip` pattern. */
  private _gridChip(): TemplateResult | typeof nothing {
    const status = stateById(this.hass, this._energy?.grid_status);
    if (!status || isUnavailable(status)) return nothing;
    const ok = status.toLowerCase().includes('on');
    return html`<span class="gchip ${ok ? 'ok' : 'warn'}">
      <span class="gdot"></span>${prettyText(status)}
    </span>`;
  }

  static override styles = [
    sharedStyles,
    ecosystemShellStyles,
    css`
      .gchip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: var(--tc-pill, 999px);
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        font-size: var(--tc-fs-label, 11.5px);
        font-weight: var(--tc-fw-body, 600);
        color: var(--tc-text-dim, #9aa7b8);
        white-space: nowrap;
      }
      .gdot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--tc-text-mute, #64748b);
        box-shadow: 0 0 7px currentColor;
      }
      .gchip.ok .gdot {
        background: var(--tc-green, #34d399);
        color: var(--tc-green, #34d399);
      }
      .gchip.warn .gdot {
        background: var(--tc-amber, #fbbf24);
        color: var(--tc-amber, #fbbf24);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-grid': TcGrid;
  }
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tc-grid',
  name: STRINGS.energy.nodes.grid,
  description: STRINGS.ecosystem.grid.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});
