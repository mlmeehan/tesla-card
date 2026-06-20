import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mdiSolarPower, mdiExport } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { weatherVignette, weatherVignetteStyles } from './weather-vignette';
import { sparkline, dayBars, barLabels, chartStyles } from './chart';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, unitById, type EnergyEntities } from '../data/energy';
import { read, readRaw, referenceNow } from '../data/freshness';
import { fetchCardHistory, type CardHistory } from '../data/history';
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
  /** One-shot recorder history (Story 8.3), id-gated so unrelated hass ticks never re-fetch. */
  @state() private _charts?: CardHistory;
  private _lastChartKey?: string;

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
    if (changed.has('hass') || changed.has('config')) {
      this._resolve();
      this._fetchCharts();
    }
  }

  /**
   * One-shot, id-gated history fetch (AC3). HA replaces `hass` on every tick, but
   * the cached series is reused across unrelated ticks — a fetch fires ONLY when
   * the resolved charted entity-id set changes (never polled, never re-fetched on
   * a stable id). `nowMs` is `referenceNow(hass)` (HA's time base), not `Date.now`.
   */
  private _fetchCharts(): void {
    const e = this._energy ?? {};
    const ids = { today: e.solar_power, cumulative: e.solar_generated };
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

    // Lead readout = production kW (unchanged tile, now in the readout row).
    const production = statTile({
      icon: mdiSolarPower,
      label: STRINGS.ecosystem.solar.production,
      value: kw,
      color: accentVar(accent),
    });

    // Detail stat-grid: cumulative energy totals, resolved by function-name and
    // hide-when-missing (NaN-safe). Unit read live from the entity (the totals
    // are kWh on this integration; never assume).
    const e = this._energy ?? {};
    const tiles: Array<TemplateResult | typeof nothing> = [
      this._kwhTile(e.solar_generated, mdiSolarPower, STRINGS.ecosystem.solar.generated),
      this._kwhTile(e.solar_exported, mdiExport, STRINGS.ecosystem.solar.exported),
    ];

    // Status dot: live while producing, idle at rest, stale on old data.
    const state = stamp ? 'stale' : value > 0.05 ? 'live' : 'idle';

    // Inline charts (Story 8.3): today's power sparkline + the 7-day generated-kWh
    // bars (daily delta of the cumulative counter). Each is included only when its
    // source id resolves; an absent/short series renders the chart's calm empty
    // state (AC2/AC5), never a fabricated curve.
    const days = this._charts?.days ?? [];
    const charts: Array<TemplateResult | typeof nothing> = [
      id
        ? sparkline(this._charts?.today ?? [], {
            accent,
            title: STRINGS.ecosystem.chartTodayTitle,
            valueLabel: kw,
          })
        : nothing,
      e.solar_generated
        ? dayBars(
            days.map((d) => d.value),
            barLabels(days, STRINGS.ecosystem.weekdays),
            { accent, title: STRINGS.ecosystem.chartHistoryTitle }
          )
        : nothing,
    ];

    return this.renderDetail(
      { accent, label, stamp, state, kind: 'sensor', ariaLabel: `${label} ${kw}` },
      // Vignette is the card's hero-art slot (8.2 reuses it); the kW is the lead.
      { hero: vignette, readout: production, tiles, charts }
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
      color: accentVar('amber'),
    });
  }

  static override styles = [sharedStyles, ecosystemShellStyles, weatherVignetteStyles, chartStyles];
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
