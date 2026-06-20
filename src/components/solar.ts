import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiSolarPower } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { weatherVignette, weatherVignetteStyles } from './weather-vignette';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, type EnergyEntities } from '../data/energy';
import { read, readRaw, referenceNow } from '../data/freshness';
import { formatNumber } from '../helpers';
import type { LovelaceCard, TeslaCardConfig } from '../types';

/**
 * `tc-solar` — standalone Solar production card (Story 6.2, Epic 6 ecosystem
 * suite). Stands on the 6.1 shell ({@link EcosystemCard}); "registry + component
 * only" — it resolves `solar_power` by function-name (`data/energy`), reads it
 * NaN-safe with honest staleness, and presents the RAW reading. NO balance math
 * / flow engine (that is the Scene, 6.5/6.6). Renders standalone (its own
 * resolution from injected `hass` + `config`) or composed into the Scene as a
 * Scene-unaware child reading the same shared `hass` (FR-29 / FR-30).
 */
@customElement('tc-solar')
export class TcSolar extends EcosystemCard implements LovelaceCard {
  /** Auto-detected energy-site entities (cached; recomputed only when hass/config change). */
  private _energy?: EnergyEntities;
  private _resolveCache?: { hass: unknown; config: TeslaCardConfig };

  public setConfig(config: TeslaCardConfig): void {
    // Forward-compatible (R9): store as-is, tolerate unknown keys; reject only
    // a falsy config. No per-key validation — reads stay narrow at render.
    if (!config) throw new Error('Invalid configuration');
    this.config = { ...config };
  }

  public getCardSize(): number {
    return 3;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') || changed.has('config')) this._resolve();
  }

  /**
   * Resolve energy entities once per hass/config change (mirrors tesla-card's
   * `_resolve` cache discipline). The parent keys its cache on the
   * `hass.entities`/`hass.devices` registries, but those reads are confined to
   * `src/data/` + the baselined parent (the `no-bare-hass.states` boundary); a
   * standalone card keys on the `hass`/`config` object identities instead — HA
   * replaces `hass` only when state changed, so this still skips the redundant
   * re-resolve when only an unrelated reactive prop updated.
   */
  private _resolve(): void {
    if (!this.config) return;
    const c = this._resolveCache;
    if (c && c.hass === this.hass && c.config === this.config) return;
    this._energy = resolveEnergyEntities(this.hass, this.config);
    this._resolveCache = { hass: this.hass, config: this.config };
  }

  protected override render(): TemplateResult {
    const hass = this.hass;
    const id = this._energy?.solar_power;
    const accent = 'amber' as const;
    const label = STRINGS.energy.nodes.solar;

    const value = numById(hass, id); // NaN-safe: absent/non-numeric → undefined
    if (value === undefined) {
      // Calm, specific empty state — never blank / crash / a fabricated `0 kW`.
      // The vignette is deliberately NOT shown here: the existing empty-state path
      // is unchanged (AC4); the sky is honest context for a REAL production read.
      return this.renderShell(
        { accent, label, ariaLabel: `${label} — ${STRINGS.ecosystem.solar.empty}` },
        html`<p class="eco-empty">${STRINGS.ecosystem.solar.empty}</p>`
      );
    }

    // Live-weather vignette (Story 6.4) — honest visual context for the reading.
    // Read HA CORE entities (NOT Tesla function-slugs) via the sanctioned
    // arbitrary-entity reader `readRaw`; the helper takes RESOLVED values (no hass).
    // Absent weather → readRaw returns undefined; an `unavailable`/`unknown`
    // sentinel arrives as that literal string → the helper's honesty gate omits
    // the vignette in both cases (never a fabricated sky). `config.weather.hide`
    // suppresses it.
    const wxId = this.config?.weather?.entity ?? 'weather.home';
    const sunId = this.config?.weather?.sun ?? 'sun.sun';
    const condition = readRaw(hass, wxId);
    const sunState = readRaw(hass, sunId); // 'above_horizon' | 'below_horizon' | undefined
    const isDay = sunState !== 'below_horizon';
    const vignette = this.config?.weather?.hide
      ? nothing
      : weatherVignette({ condition, isDay, sources: { weather: wxId, sun: sunId } });

    // Honest staleness: stamp only when the read is NOT fresh, from a real
    // last_updated (formatAgeHint returns undefined when no stamp). Server-now =
    // referenceNow (max stamp), never Date.now().
    const now = referenceNow(hass);
    const r = read(hass, id!);
    const stamp = r.staleness === 'fresh' ? undefined : formatAgeHint(r.lastUpdated, now);
    const kw = `${formatNumber(value, 1)} kW`;

    return this.renderShell(
      { accent, label, stamp, ariaLabel: `${label} ${kw}` },
      // Vignette is the card's "hero" context; the kW reading sits below it.
      html`${vignette}${statTile({
        icon: mdiSolarPower,
        label: STRINGS.ecosystem.solar.production,
        value: kw,
        color: accentVar(accent),
      })}`
    );
  }

  static override styles = [sharedStyles, ecosystemShellStyles, weatherVignetteStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-solar': TcSolar;
  }
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tc-solar',
  name: STRINGS.energy.nodes.solar,
  description: STRINGS.ecosystem.solar.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});
