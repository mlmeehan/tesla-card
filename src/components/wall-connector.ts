import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiPowerPlug, mdiFlash, mdiCounter, mdiCurrentAc, mdiSineWave, mdiThermometer } from '@mdi/js';
import { EcosystemCard, ecosystemShellStyles, accentVar } from './ecosystem-card';
import { nodeHero, nodeHeroStyles } from './node-hero';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { statTile, formatAgeHint } from '../ui';
import { resolveEnergyEntities, numById, stateById, unitById, type EnergyEntities } from '../data/energy';
import { read, referenceNow } from '../data/freshness';
import { formatNumber, prettyText, isUnavailable } from '../helpers';
import type { LovelaceCard, TeslaCardConfig } from '../types';

/** Power magnitude (kW) below which the Wall Connector reads as not-charging (mirrors panel-energy `THRESH`). */
const THRESH = 0.05;

/**
 * `wc_status` enum values that mean "not plugged in". A status present and NOT in
 * this set (and not `unavailable`) is treated as a connected/plugged hint — the
 * binary `wc_connected` sensor stays the primary plug signal, this is the
 * secondary one (`panel-energy.ts` shows the same status enum verbatim).
 */
const DISCONNECTED_STATUSES = new Set([
  'disconnected',
  'unplugged',
  'available',
  'idle',
  'not_connected',
  'no_vehicle',
]);

/**
 * `tc-wall-connector` — standalone Wall Connector card (Story 6.3, the fifth and
 * final Epic-6 ecosystem card). Stands on the 6.1 shell ({@link EcosystemCard}),
 * accent teal (mirrors the Scene's `NODE_COLOR.wall_connector`). "Registry +
 * component only": it resolves `wc_power`/`wc_session`/`wc_connected`/`wc_status`
 * by function-name (`data/energy`, already in `EnergyEntities`), reads them
 * NaN-safe with honest staleness, and presents the RAW standalone readings —
 * exactly like the Wall-Connector tiles in `panel-energy.ts`. NO balance math /
 * FlowModel sign convention (that is the Scene, 6.5/6.6): `wc_power` is a
 * non-negative magnitude, consumed directly. Renders standalone (its own
 * resolution from injected `hass` + `config`) or composed into the Scene as a
 * Scene-unaware child reading the same shared `hass` (FR-29 / FR-32).
 */
@customElement('tc-wall-connector')
export class TcWallConnector extends EcosystemCard implements LovelaceCard {
  /** Auto-detected energy-site entities (cached; recomputed only when hass/config change). */
  private _energy?: EnergyEntities;
  private _resolveCache?: { hass: unknown; config: TeslaCardConfig };

  public setConfig(config: TeslaCardConfig): void {
    // Forward-compatible (R9): store as-is, tolerate unknown keys; reject only a
    // falsy config. No per-key validation — reads stay narrow at render.
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
    const accent = 'teal' as const;
    const label = STRINGS.energy.nodes.wall_connector;

    const wc = numById(hass, e.wc_power); // kW ≥ 0, NaN-safe
    const session = numById(hass, e.wc_session); // kWh, NaN-safe
    const rawStatus = stateById(hass, e.wc_status);
    const wcStatus = rawStatus && !isUnavailable(rawStatus) ? rawStatus : undefined;
    const rawConnected = stateById(hass, e.wc_connected);
    const wcConnected = rawConnected && !isUnavailable(rawConnected) ? rawConnected : undefined;

    // Calm empty only when NONE of the WC reads resolve — never blank/crash, and
    // never a fabricated `0 kW`/`0 kWh` for a WC that simply isn't reporting.
    if (wc === undefined && session === undefined && wcStatus === undefined && wcConnected === undefined) {
      return this.renderShell(
        { accent, label, ariaLabel: `${label} — ${STRINGS.ecosystem.wallConnector.empty}` },
        html`<p class="eco-empty">${STRINGS.ecosystem.wallConnector.empty}</p>`
      );
    }

    // Three-state classification (AC4) from the RAW reads — `wc_power` is a
    // non-negative magnitude, NOT a FlowModel sign. The 0.05 kW deadband means
    // sensor jitter reads as not-charging, never a flicker.
    const charging = wc !== undefined && wc > THRESH;
    const statusPlugged = wcStatus !== undefined && !DISCONNECTED_STATUSES.has(wcStatus.toLowerCase());
    const connected = !charging && (wcConnected === 'on' || statusPlugged);
    const stateLabel = charging
      ? STRINGS.ecosystem.wallConnector.charging
      : connected
        ? STRINGS.ecosystem.wallConnector.connected
        : STRINGS.ecosystem.wallConnector.available;

    // State/connector tile — label = the derived state; value = the raw connector
    // detail (status enum, else connected/unplugged), falling back to the derived
    // state so the tile always renders the live plug state. Mirrors panel-energy.
    const connectorDetail = wcStatus
      ? prettyText(wcStatus)
      : wcConnected
        ? wcConnected === 'on'
          ? STRINGS.energy.connected
          : STRINGS.energy.unplugged
        : stateLabel;
    const stateTile = statTile({
      icon: mdiPowerPlug,
      label: stateLabel,
      value: connectorDetail,
      color: accentVar(accent),
    });

    const kw = wc === undefined ? undefined : `${formatNumber(wc, 1)} kW`;
    const powerTile = statTile({
      icon: mdiFlash,
      label: STRINGS.energy.nodes.wall_connector,
      value: kw,
      color: accentVar(accent),
    });

    const sessionTile = statTile({
      icon: mdiCounter,
      label: STRINGS.energy.session,
      value: session === undefined ? undefined : `${formatNumber(session, 1)} kWh`,
      color: accentVar(accent),
    });

    // Honest stamp: prefer the power read's freshness, else session, else status.
    const stampId = e.wc_power ?? e.wc_session ?? e.wc_status;
    let stamp: string | undefined;
    if (stampId) {
      const now = referenceNow(hass);
      const r = read(hass, stampId);
      if (r.staleness !== 'fresh') stamp = formatAgeHint(r.lastUpdated, now);
    }

    const ariaLabel = `${label} — ${stateLabel}${kw ? ` ${kw}` : ''}`;

    // Detail stat-grid: live electrical measurements. Units read from each entity
    // (the handle temperature is °F on some installs, °C on others — never assume).
    const tiles: Array<TemplateResult | typeof nothing> = [
      this._measTile(e.wc_voltage, mdiCurrentAc, STRINGS.ecosystem.wallConnector.voltage, 0, 'V'),
      this._measTile(e.wc_frequency, mdiSineWave, STRINGS.ecosystem.wallConnector.frequency, 1, 'Hz'),
      this._measTile(e.wc_temperature, mdiThermometer, STRINGS.ecosystem.wallConnector.temperature, 0, '°'),
    ];

    const state = stamp !== undefined ? 'stale' : charging ? 'live' : 'idle';

    return this.renderDetail(
      { accent, label, stamp, state, subStatus: stateLabel, kind: 'sensor', ariaLabel },
      { hero: nodeHero('wall_connector'), readout: html`${stateTile}${powerTile}${sessionTile}`, tiles }
    );
  }

  /** A NaN-safe measurement stat tile (unit read live from the entity); hides when absent. */
  private _measTile(
    id: string | undefined,
    iconPath: string,
    label: string,
    decimals: number,
    fallbackUnit: string
  ): TemplateResult | typeof nothing {
    const v = numById(this.hass, id);
    return statTile({
      icon: iconPath,
      label,
      value:
        v === undefined ? undefined : `${formatNumber(v, decimals)} ${unitById(this.hass, id) ?? fallbackUnit}`,
      color: accentVar('teal'),
    });
  }

  static override styles = [sharedStyles, ecosystemShellStyles, nodeHeroStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-wall-connector': TcWallConnector;
  }
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tc-wall-connector',
  name: STRINGS.energy.nodes.wall_connector,
  description: STRINGS.ecosystem.wallConnector.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});
