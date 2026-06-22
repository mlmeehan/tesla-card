import { html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiGeneratorStationary } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, type EnergyEntities } from '../data/energy';
import { read, referenceNow } from '../data/freshness';
import { formatNumber } from '../helpers';
import type { LovelaceCard, TeslaCardConfig } from '../types';

/** Power magnitude (kW) below which a generator reads as idle (mirrors the sibling cards' THRESH). */
const THRESH = 0.05;

/**
 * `tc-generator` — standalone Generator card (Story 9.14, the FIRST new node TYPE).
 * Stands on the Story-6.1 shell ({@link EcosystemCard}) carrying the NEW copper
 * source-node accent (`--tc-copper`, the 8th semantic accent). It resolves
 * `generator_power` by function-name through the registry-keyed `data/energy` path
 * (AR-1), reads it NaN-safe with honest staleness, and presents the RAW reading.
 *
 * Modeled on the SIMPLE single-reading cards (`grid.ts`/`home.ts`), NOT `solar.ts`
 * — no weather vignette, no history charts (this integration exposes no honest
 * cumulative generator counter), no balance math (that is the Scene, 6.5/6.6).
 * Standalone or composed (a Scene-unaware child on the same shared `hass`).
 */
@customElement('tc-generator')
export class TcGenerator extends EcosystemCard implements LovelaceCard {
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
    if (changed.has('hass') || changed.has('config')) {
      this._resolve();
    }
  }

  /** Resolve once per hass/config change — see `tc-grid` for the cache-key rationale. */
  private _resolve(): void {
    if (!this.config) return;
    const c = this._resolveCache;
    if (c && c.hass === this.hass && c.config === this.config) return;
    this._energy = resolveEnergyEntities(this.hass, this.config);
    this._resolveCache = { hass: this.hass, config: this.config };
  }

  protected override render(): TemplateResult {
    const hass = this.hass;
    const id = this._energy?.generator_power;
    const accent = 'copper' as const;
    const label = STRINGS.energy.nodes.generator;

    const value = numById(hass, id);
    if (value === undefined) {
      return this.renderShell(
        { accent, label, ariaLabel: `${label} — ${STRINGS.ecosystem.generator.empty}` },
        html`<p class="eco-empty">${STRINGS.ecosystem.generator.empty}</p>`
      );
    }

    const now = referenceNow(hass);
    const r = read(hass, id!);
    const stamp = r.staleness === 'fresh' ? undefined : formatAgeHint(r.lastUpdated, now);
    const kw = `${formatNumber(value, 1)} kW`;
    const state = stamp ? 'stale' : value > THRESH ? 'live' : 'idle';
    const dir = value > THRESH ? STRINGS.ecosystem.generator.running : STRINGS.ecosystem.generator.idle;

    return this.renderDetail(
      { accent, label, stamp, state, subStatus: dir, kind: 'sensor', ariaLabel: `${label} ${kw}` },
      {
        readout: statTile({
          icon: mdiGeneratorStationary,
          label: STRINGS.ecosystem.generator.output,
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
    'tc-generator': TcGenerator;
  }
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tc-generator',
  name: STRINGS.energy.nodes.generator,
  description: STRINGS.ecosystem.generator.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});
