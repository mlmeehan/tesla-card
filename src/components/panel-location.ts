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
import { icon, statTile } from '../ui';
import { attr, num, rawState, isUnavailable, display, formatNumber, formatMinutesToHM } from '../helpers';

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
        background: linear-gradient(135deg, #1b2533, #0f1620);
      }
      .map iframe {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        filter: grayscale(0.2) contrast(1.05);
      }
      .map-empty {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--tc-text-mute, #64748b);
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
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-location': TcPanelLocation;
  }
}
