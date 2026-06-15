import { html, nothing, type TemplateResult } from 'lit';
import { clamp } from './helpers';

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
  value: string;
  color?: string;
  onClick?: (e: Event) => void;
}

/** Compact icon + label + value readout tile. */
export const statTile = (o: StatTileOpts): TemplateResult => html`
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
