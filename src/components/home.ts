import { html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiHomeLightningBolt } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, type EnergyEntities } from '../data/energy';
import { read, referenceNow } from '../data/freshness';
import { formatNumber } from '../helpers';
import type { LovelaceCard, TeslaCardConfig } from '../types';

/**
 * `tc-home` — standalone Home consumption card (Story 6.2). Stands on the 6.1
 * shell ({@link EcosystemCard}); resolves `load_power` (home consumption, ≥0) by
 * function-name, reads it NaN-safe with honest staleness, and presents the RAW
 * reading. No balance math (that is the Scene, 6.5/6.6). Standalone or composed
 * (Scene-unaware child on the same shared `hass`) — FR-29 / FR-30.
 */
@customElement('tc-home')
export class TcHome extends EcosystemCard implements LovelaceCard {
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
    const id = this._energy?.load_power;
    const accent = 'blue' as const;
    const label = STRINGS.energy.nodes.home;

    const value = numById(hass, id);
    if (value === undefined) {
      return this.renderShell(
        { accent, label, ariaLabel: `${label} — ${STRINGS.ecosystem.home.empty}` },
        html`<p class="eco-empty">${STRINGS.ecosystem.home.empty}</p>`
      );
    }

    const now = referenceNow(hass);
    const r = read(hass, id!);
    const stamp = r.staleness === 'fresh' ? undefined : formatAgeHint(r.lastUpdated, now);
    const kw = `${formatNumber(value, 1)} kW`;
    const state = stamp ? 'stale' : value > 0.05 ? 'live' : 'idle';

    // Home exposes no clean single energy-today/peak entity on this integration,
    // so the detail layout is honestly lead-only (the stat grid stays empty and
    // is omitted) — the minimal-install path AC2 calls out, by construction.
    return this.renderDetail(
      { accent, label, stamp, state, kind: 'sensor', ariaLabel: `${label} ${kw}` },
      {
        readout: statTile({
          icon: mdiHomeLightningBolt,
          label: STRINGS.ecosystem.home.consumption,
          value: kw,
          color: accentVar(accent),
        }),
      }
    );
  }

  static override styles = [sharedStyles, ecosystemShellStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-home': TcHome;
  }
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tc-home',
  name: STRINGS.energy.nodes.home,
  description: STRINGS.ecosystem.home.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});
