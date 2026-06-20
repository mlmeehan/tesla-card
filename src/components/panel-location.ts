import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import {
  mdiCounter,
  mdiSpeedometer,
  mdiLightningBolt,
  mdiMapMarker,
  mdiMapMarkerDistance,
  mdiClockOutline,
  mdiCarBrakeAlert,
  mdiOpenInNew,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon, statTile, formatAgeHint } from '../ui';
import { attr, num, rawState, isUnavailable, display, formatNumber, formatMinutesToHM } from '../helpers';
import { readKey, referenceNow } from '../data/freshness';

@customElement('tc-panel-location')
export class TcPanelLocation extends TcBase {
  private _coords(): { lat: number; lon: number } | undefined {
    const lat = attr(this.hass, this.config, 'location', 'latitude');
    const lon = attr(this.hass, this.config, 'location', 'longitude');
    if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
    return undefined;
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const coords = this._coords();
    const d = 0.008;

    // Honest freshness (UX-DR18/19): a parked/asleep car shows its LAST-KNOWN
    // location + odometer — the single most freshness-sensitive readout here
    // ("where is my car NOW" vs "where it was 47m ago"). Age is measured against
    // HA's OWN time base (`referenceNow`, computed ONCE and threaded), NEVER
    // `Date.now()` (a naive client subtraction manufactures phantom freshness).
    // Reuse the 5.7 `data/freshness` model + `formatAgeHint` — no second path.
    const now = referenceNow(this.hass);
    const locRead = readKey(this.hass, cfg, 'location', { now });
    const coordStamp =
      locRead.available && locRead.staleness !== 'fresh'
        ? formatAgeHint(locRead.lastUpdated, now)
        : undefined;
    const odoRead = readKey(this.hass, cfg, 'odometer', { now });
    const odoStamp =
      odoRead.available && odoRead.staleness !== 'fresh'
        ? formatAgeHint(odoRead.lastUpdated, now)
        : undefined;

    const distance = num(this.hass, cfg, 'distance_to_arrival');
    const eta = num(this.hass, cfg, 'time_to_arrival');
    const trafficRaw = rawState(this.hass, cfg, 'traffic_delay');
    const hasRoute = distance !== undefined || eta !== undefined;

    return html`
      <div class="wrap">
        <section class="surface map-card">
          <div class="map">
            ${coords
              ? html`<iframe
                  title=${STRINGS.location.mapLabel}
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  src=${`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lon - d}%2C${coords.lat - d}%2C${coords.lon + d}%2C${coords.lat + d}&layer=mapnik&marker=${coords.lat}%2C${coords.lon}`}
                ></iframe>`
              : html`<div class="map-empty">
                  ${icon(mdiMapMarker, { size: 30 })}
                  <span>${STRINGS.location.unavailable}</span>
                </div>`}
          </div>
          <div class="map-foot">
            <span class="coord">
              ${icon(mdiMapMarker, { size: 15 })}
              ${coords
                ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`
                : '—'}
            </span>
            ${coords
              ? html`<a
                  class="maplink"
                  href=${`https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lon}#map=15/${coords.lat}/${coords.lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${STRINGS.location.openMap} ${icon(mdiOpenInNew, { size: 13 })}
                </a>`
              : nothing}
          </div>
          ${coords && coordStamp
            ? html`<div class="map-stale tc-stale-copy">${coordStamp}</div>`
            : nothing}
        </section>

        ${hasRoute
          ? html`<div class="grid g3">
              ${statTile({
                icon: mdiMapMarkerDistance,
                label: STRINGS.location.toArrival,
                value: display(this.hass, cfg, 'distance_to_arrival'),
                color: 'var(--tc-blue, #38bdf8)',
              })}
              ${statTile({
                icon: mdiClockOutline,
                label: STRINGS.location.eta,
                value: eta !== undefined ? formatMinutesToHM(eta) : '—',
                color: 'var(--tc-green, #34d399)',
              })}
              ${statTile({
                icon: mdiCarBrakeAlert,
                label: STRINGS.location.traffic,
                value:
                  trafficRaw && !isUnavailable(trafficRaw)
                    ? `${formatNumber(Number(trafficRaw))} min`
                    : STRINGS.location.none,
                color: 'var(--tc-amber, #fbbf24)',
              })}
            </div>`
          : nothing}

        <div class="grid g3">
          ${statTile({
            icon: mdiCounter,
            label: STRINGS.location.odometer,
            value: display(this.hass, cfg, 'odometer'),
            color: 'var(--tc-purple, #a78bfa)',
          })}
          ${statTile({
            icon: mdiSpeedometer,
            label: STRINGS.location.speed,
            value: display(this.hass, cfg, 'speed'),
            color: 'var(--tc-blue, #38bdf8)',
          })}
          ${statTile({
            icon: mdiLightningBolt,
            label: STRINGS.location.power,
            value: display(this.hass, cfg, 'power'),
            color: 'var(--tc-green, #34d399)',
          })}
        </div>
        ${odoStamp
          ? html`<div class="odo-stale tc-stale-copy">
              ${STRINGS.location.odometer} ${odoStamp}
            </div>`
          : nothing}
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .wrap {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .map-card {
        padding: 0;
        overflow: hidden;
        border-radius: var(--tc-radius-lg, 22px);
      }
      .map {
        position: relative;
        height: 230px;
        /* FR-28 / UX-DR17 SANCTIONED EXCEPTION — the ONE hard-coded colour in the
           whole card, the sole departure from the --tc-* token contract. A
           deliberate chromatic map-card backdrop (raw #1b2533/#0f1620, NOT among
           the 7 accent hexes, so styles.ts' raw-accent-hex scan passes them) sits
           behind the grayscale OSM iframe so an empty/loading tile reads as a map,
           not a void. Deliberately a 135deg angle (NOT .surface's elevation
           recipe) so the single-elevation-gradient gate naturally excludes it. Do
           NOT tokenize, relocate, or add a SECOND raw-hex departure elsewhere —
           styles.test.ts names this as the only one. */
        background: linear-gradient(135deg, #1b2533, #0f1620);
      }
      .map iframe {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        /* AC1 / UX-DR17 — a GRAYSCALE map (grayscale(1), not the prototype's 20%
           desaturation); the slight contrast bump keeps the muted tiles legible. */
        filter: grayscale(1) contrast(1.05);
      }
      .map-empty {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        /* Load-bearing empty-state copy → --tc-text-dim (4.5:1), NEVER
           --tc-text-mute (#64748b fails 4.5:1) — same a11y fix as 5.7/5.8. */
        color: var(--tc-text-dim, #9aa7b8);
        font-size: 13px;
        font-weight: 600;
      }
      .map-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 11px 14px;
      }
      .coord {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .maplink {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12.5px;
        font-weight: 650;
        color: var(--tc-blue, #38bdf8);
        text-decoration: none;
      }
      .maplink:hover {
        text-decoration: underline;
      }
      /* Honest staleness stamps (UX-DR18) — last-known location/odometer on a
         parked/asleep car, annotated "updated Nm ago" in --tc-text-dim (via the
         shared .tc-stale-copy recipe), never presented as live. */
      .map-stale {
        padding: 0 14px 11px;
        font-size: 11.5px;
        font-weight: 600;
      }
      .odo-stale {
        margin-top: -4px;
        font-size: 11.5px;
        font-weight: 600;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-location': TcPanelLocation;
  }
}
