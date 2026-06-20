import { html, nothing, type TemplateResult } from 'lit';
import type { HomeAssistant, TeslaCardConfig } from './types';
import type { EntityKey } from './const';
import { clamp, formatAge } from './helpers';
import { readKey, referenceNow } from './data/freshness';
import { STRINGS } from './strings';

/** Inline MDI icon (path from @mdi/js). Colour follows `currentColor`. */
export const icon = (
  path: string,
  opts: { size?: number; cls?: string; color?: string } = {}
): TemplateResult => {
  const s = opts.size ?? 22;
  return html`<svg
    class="tc-ico ${opts.cls ?? ''}"
    style="width:${s}px;height:${s}px${opts.color ? `;color:${opts.color}` : ''}"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d=${path}></path>
  </svg>`;
};

export interface StatTileOpts {
  icon: string;
  label: string;
  /**
   * The readout value. OPTIONAL by contract (Story 5.5 AC1): an `undefined`
   * value means the backing entity is missing, so the tile HIDES (renders
   * `nothing`) rather than showing a lone "—". Callers pass `undefined` (not a
   * baked "—") to opt into the hide; any present string renders unchanged, so
   * existing call-sites are unaffected.
   */
  value?: string;
  color?: string;
  onClick?: (e: Event) => void;
}

/** Compact icon + label + value readout tile; hides when `value` is absent (AC1). */
export const statTile = (o: StatTileOpts): TemplateResult | typeof nothing =>
  o.value === undefined
    ? nothing
    : html`
  <div
    class="stat"
    role=${o.onClick ? 'button' : nothing}
    tabindex=${o.onClick ? '0' : nothing}
    @click=${o.onClick}
  >
    <span
      class="ico-wrap"
      style=${o.color
        ? `color:${o.color};background:color-mix(in srgb, ${o.color} 18%, transparent)`
        : nothing}
    >
      ${icon(o.icon, { size: 19 })}
    </span>
    <span class="body">
      <span class="k">${o.label}</span>
      <span class="v">${o.value}</span>
    </span>
  </div>
`;

/** Horizontal battery gauge (crisp at any width — pure CSS). */
export const batteryGauge = (
  percent: number | undefined,
  opts: { limit?: number; charging?: boolean; height?: number } = {}
): TemplateResult => {
  const known = percent !== undefined;
  const p = clamp(percent ?? 0, 0, 100);
  const cls = !known
    ? 'unknown'
    : opts.charging
      ? 'charging'
      : p <= 20
        ? 'low'
        : p <= 50
          ? 'mid'
          : 'high';
  return html`
    <div class="tc-bat ${cls}" style="height:${opts.height ?? 22}px">
      <div class="tc-bat-fill" style="width:${known ? p : 0}%"></div>
      ${opts.limit !== undefined
        ? html`<div
            class="tc-bat-limit"
            style="left:${clamp(opts.limit, 0, 100)}%"
          ></div>`
        : nothing}
    </div>
  `;
};

/**
 * The single honest "updated Nm ago" FORMATTER (UX-DR18) — the ONE place a
 * last-updated stamp becomes user copy. Age is measured against HA's OWN time
 * base (`now` = `referenceNow` = max server stamp), NEVER `Date.now()`: a naive
 * client subtraction can manufacture phantom freshness, the one unforgivable
 * error. Callers that already hold a freshness read (e.g. the closures panel,
 * Story 5.7) pass its `lastUpdated` straight in — no second `hass.states` scan
 * and no divergent age-formatting path.
 *
 * Returns `"updated 47m ago"` / `STRINGS.hero.justNow`, or `undefined` when no
 * stamp exists (caller omits the hint — never "updated NaN"/a fabricated time).
 */
export const formatAgeHint = (
  lastUpdated: string | undefined,
  now: number
): string | undefined => {
  if (!lastUpdated) return undefined;
  const age = formatAge(now - Date.parse(lastUpdated));
  return age === ''
    ? STRINGS.hero.justNow
    : `${STRINGS.hero.updatedPrefix} ${age} ${STRINGS.hero.ago}`;
};

/**
 * Per-key honest last-updated hint: resolve `key`'s freshness read and format its
 * stamp via {@link formatAgeHint}. `now` defaults to one `referenceNow` scan when
 * the caller has none. The single derivation reused by every car-dependent
 * surface (the Hero's status sub-line, the commands wake affordance, the closures
 * panel's per-closure staleness stamps).
 */
export const keyAgeHint = (
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey,
  now: number = referenceNow(hass)
): string | undefined => formatAgeHint(readKey(hass, config, key, { now }).lastUpdated, now);

/** The Hero/commands last-updated hint, backed by `battery_level` (the headline value). */
export const ageHint = (
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): string | undefined => keyAgeHint(hass, config, 'battery_level');

/** Circular progress ring with a centred label. */
export const ring = (
  percent: number | undefined,
  opts: {
    size?: number;
    stroke?: number;
    color?: string;
    track?: string;
    label?: TemplateResult | string;
    sub?: string;
    charging?: boolean;
  } = {}
): TemplateResult => {
  const size = opts.size ?? 168;
  const stroke = opts.stroke ?? 13;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const p = clamp(percent ?? 0, 0, 100);
  const off = circ * (1 - p / 100);
  const color = opts.color ?? 'var(--tc-green, #34d399)';
  return html`
    <div class="tc-ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" class=${opts.charging ? 'charging' : ''}>
        <circle
          cx=${size / 2}
          cy=${size / 2}
          r=${r}
          fill="none"
          stroke=${opts.track ?? 'var(--tc-border, rgba(255, 255, 255, 0.09))'}
          stroke-width=${stroke}
        ></circle>
        <circle
          class="prog"
          cx=${size / 2}
          cy=${size / 2}
          r=${r}
          fill="none"
          stroke=${color}
          stroke-width=${stroke}
          stroke-linecap="round"
          stroke-dasharray=${circ}
          stroke-dashoffset=${percent === undefined ? circ : off}
          transform="rotate(-90 ${size / 2} ${size / 2})"
        ></circle>
      </svg>
      <div class="tc-ring-center">
        <div class="tc-ring-label">${opts.label ?? ''}</div>
        ${opts.sub ? html`<div class="tc-ring-sub">${opts.sub}</div>` : nothing}
      </div>
    </div>
  `;
};
