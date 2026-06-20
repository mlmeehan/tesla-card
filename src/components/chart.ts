import { html, svg, css, nothing, type CSSResult, type TemplateResult } from 'lit';
import { STRINGS } from '../strings';
import { accentVar, type ShellAccent } from './ecosystem-card';
import type { HistorySeries, DayBucket } from '../data/history';

/**
 * `chart` — hand-rolled inline-SVG/CSS history charts for the ecosystem cards
 * (Story 8.3, FR-36 / UX-DR25). This is a RENDER HELPER (the
 * `weather-vignette.ts`/`statTile` mold: pure functions returning a
 * `TemplateResult` + an exported `CSSResult`), **NOT** a `tc-*` custom element —
 * it registers nothing and is imported only by the cards that compose it. No
 * raster, no new runtime dependency (NFR-2 — hand-rolled is the requirement).
 *
 * Two pure functions of already-RESOLVED inputs (no `hass`, no DOM, no fetch):
 *   • {@link sparkline} — today's curve: a filled area + stroke line in a
 *     `320×92 preserveAspectRatio="none"` viewBox.
 *   • {@link dayBars} — the last-N-days bar series (the `.bars`/`.bcol` idiom).
 *
 * Honesty discipline (AC2/AC5 — the chart analogue of "never a false closed"):
 * a short/empty/all-dropped series renders the CALM EMPTY STATE (a muted
 * caption), never a fabricated flat line at 0 or a row of zero-height bars.
 * A genuinely-fetched zero is real and may render; an ABSENT series is empty.
 *
 * Colour (AC1, AC6): the source accent rides in via {@link accentVar} (a
 * `var(--tc-*, #hex)` form), and every token in {@link chartStyles} carries its
 * DESIGN.md fallback — no raw decorative hex. CRITICAL: the bar fill is a FLAT
 * accent (inline `background:${accentVar()}`), NOT `linear-gradient at 180°`
 * (that would add a second 180° gradient and trip the styles.test.ts gate); the
 * sparkline's `<linearGradient>` is an SVG gradient element (x1/y1/x2/y2), which
 * is not a CSS `linear-gradient at 180°` and does not trip the gate.
 *
 * Reduced-motion (AC4): the only motion is a content-free fade-in, FROZEN by the
 * closing `@media (prefers-reduced-motion: reduce)` block — the static chart
 * carries the full data (colour-blind-safe: shape + magnitude, not hue-only).
 */

/** Shared options for both chart helpers — resolved accent + copy. */
export interface ChartOpts {
  accent: ShellAccent;
  /** Section title (centralized copy, e.g. `STRINGS.ecosystem.chartTodayTitle`). */
  title: string;
  /** Optional headline value beside the title (e.g. the current `6.0 kW`). */
  valueLabel?: string;
}

const VBW = 320;
const VBH = 92;
const PAD = 8; // vertical breathing room so the curve never kisses the frame edge

/** Calm empty state — a muted caption, never a fabricated curve (AC2). */
function emptyChart(title: string): TemplateResult {
  return html`<div class="chart">
    ${chartHead(title, undefined)}
    <p class="ct-empty">${STRINGS.ecosystem.chartEmpty}</p>
  </div>`;
}

/** The shared `.ct-head` (title + optional value). */
function chartHead(title: string, valueLabel: string | undefined): TemplateResult {
  return html`<div class="ct-head">
    <span class="ct-t">${title}</span>
    ${valueLabel !== undefined ? html`<span class="ct-v">${valueLabel}</span>` : nothing}
  </div>`;
}

/**
 * Today's area sparkline. Needs ≥2 usable points to draw a line; a shorter series
 * is the calm empty state (AC2). Scales the series into the 320×92 box (time→x,
 * value→y, min/max). A genuinely flat real series draws a flat mid-height line
 * (honest — it is real flat data, not a fabricated zero).
 */
export function sparkline(series: HistorySeries, opts: ChartOpts): TemplateResult {
  if (series.length < 2) return emptyChart(opts.title);

  const xs = series.map((s) => s.t);
  const vs = series.map((s) => s.v);
  const tMin = Math.min(...xs);
  const tMax = Math.max(...xs);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const tSpan = tMax - tMin || 1;
  const vSpan = vMax - vMin || 1;

  const x = (t: number): number => ((t - tMin) / tSpan) * VBW;
  // Flat series (vSpan originally 0) → mid-height; else map min→bottom, max→top.
  const y = (v: number): number =>
    vMax === vMin ? VBH / 2 : VBH - PAD - ((v - vMin) / vSpan) * (VBH - 2 * PAD);

  const pts = series.map((s) => `${x(s.t).toFixed(1)},${y(s.v).toFixed(1)}`);
  const linePath = `M${pts.join(' L')}`;
  const areaPath = `M${x(tMin).toFixed(1)},${VBH} L${pts.join(' L')} L${x(tMax).toFixed(1)},${VBH} Z`;

  // Shadow-scoped gradient id (per accent; each card is its own shadow root, so
  // two cards never collide). The fill is an SVG <linearGradient>, NOT a CSS
  // 180° gradient — it does not trip the single-elevation-gradient gate.
  const gid = `spark-${opts.accent}`;
  const stroke = accentVar(opts.accent);
  // SR honesty ("keep the data"): carry the headline value into the label when we
  // have one, so the chart is not a value-less "Today" image to a screen reader.
  const ariaLabel = opts.valueLabel ? `${opts.title} ${opts.valueLabel}` : opts.title;

  return html`<div class="chart">
    ${chartHead(opts.title, opts.valueLabel)}
    <svg
      class="spark"
      viewBox="0 0 ${VBW} ${VBH}"
      preserveAspectRatio="none"
      role="img"
      aria-label=${ariaLabel}
    >
      ${svg`<defs>
        <linearGradient id=${gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color=${stroke} stop-opacity="0.4" />
          <stop offset="100%" stop-color=${stroke} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="ct-area" d=${areaPath} fill=${`url(#${gid})`} />
      <path class="ct-line" d=${linePath} fill="none" stroke=${stroke} />`}
    </svg>
  </div>`;
}

/**
 * Multi-day bar series. `values`/`labels` are aligned arrays (one per day). An
 * empty `values` is the calm empty state (AC2); a non-empty series of genuinely
 * fetched zeros renders flat-but-real. Bar height = `value / max · 100%`; the
 * fill is a FLAT accent (inline — keeps `chartStyles` free of any 180° gradient).
 */
export function dayBars(values: number[], labels: string[], opts: ChartOpts): TemplateResult {
  if (!values.length) return emptyChart(opts.title);

  const max = Math.max(...values, 0);
  const fill = accentVar(opts.accent);
  const cols = values.map((v, i) => {
    const pct = max > 0 ? (v / max) * 100 : 0;
    const label = labels[i] ?? '';
    return html`<div class="bcol">
      <i style=${`height:${pct.toFixed(1)}%;background:${fill}`}></i>
      <span>${label}</span>
    </div>`;
  });

  return html`<div class="chart">
    ${chartHead(opts.title, opts.valueLabel)}
    <div class="bars" role="img" aria-label=${opts.title}>${cols}</div>
  </div>`;
}

/**
 * Map per-day buckets → weekday labels for {@link dayBars}, using a Sun-indexed
 * `weekdays` array (`STRINGS.ecosystem.weekdays`) — no Intl dependency. Single
 * definition so every card labels its bars identically.
 */
export function barLabels(days: DayBucket[], weekdays: readonly string[]): string[] {
  return days.map((d) => weekdays[new Date(d.day).getDay()] ?? '');
}

/**
 * Component-local chart styles — composed by each card via
 * `static styles = [sharedStyles, ecosystemShellStyles, chartStyles, …]` (the
 * `carStyles`/`weatherVignetteStyles` idiom). Every `var(--tc-*)` carries its
 * DESIGN.md fallback (hard gate). NO 180° gradient (the bar fill is a flat
 * inline accent), NO raw decorative hex, NO `border-radius`/elevation recipe that
 * would duplicate `.surface`. The `.chart` panel is a nested surface (it uses
 * `--tc-surface`/`--tc-border`/`--tc-radius-md` directly — NOT the `.surface`
 * class), so the cards carry no extra `class="surface"` literal.
 *
 * AC4 reduced-motion: the closing `@media (prefers-reduced-motion: reduce)` block
 * freezes the content-free fade-in (`animation: none`) — the static chart is
 * fully legible. `chartIn` is a LOCAL keyframe (outside `sharedStyles`' locked
 * {tc-pulse, tc-shimmer} a11y corpus).
 */
export const chartStyles: CSSResult = css`
  .chart {
    display: flex;
    flex-direction: column;
    gap: var(--tc-space-2, 8px);
    padding: var(--tc-space-3, 12px);
    background: var(--tc-surface, rgba(255, 255, 255, 0.045));
    border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
    border-radius: var(--tc-radius-md, 16px);
  }
  .ct-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--tc-space-2, 8px);
  }
  .ct-t {
    font-size: var(--tc-fs-label, 11.5px);
    font-weight: var(--tc-fw-body, 600);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--tc-text-dim, #9aa7b8);
  }
  .ct-v {
    font-size: var(--tc-fs-body, 13.5px);
    font-weight: var(--tc-fw-label, 700);
    color: var(--tc-text, #f1f5f9);
    white-space: nowrap;
  }
  /* Calm empty caption — quiet trust-copy, never a fabricated curve (AC2). */
  .ct-empty {
    margin: 0;
    color: var(--tc-text-mute, #64748b);
    font-size: var(--tc-fs-label, 11.5px);
    font-weight: var(--tc-fw-body, 600);
  }
  .spark {
    display: block;
    width: 100%;
    height: 64px;
    animation: chartIn 0.5s ease both;
  }
  .ct-line {
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    /* preserveAspectRatio="none" stretches strokes — keep it visually even. */
    vector-effect: non-scaling-stroke;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--tc-space-1, 4px);
    height: 64px;
    animation: chartIn 0.5s ease both;
  }
  .bcol {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    height: 100%;
    min-width: 0;
  }
  .bcol i {
    display: block;
    width: 60%;
    min-height: 2px;
    border-radius: var(--tc-radius-sm, 12px);
    /* background (flat accent) is set inline per-bar via accentVar — keeps this
       sheet free of any accent hex AND of any 180° gradient (gate traps). */
  }
  .bcol span {
    font-size: var(--tc-fs-label, 11.5px);
    color: var(--tc-text-mute, #64748b);
  }
  @keyframes chartIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    /* AC4 — freeze the content-free fade-in; the static chart keeps the data. */
    .spark,
    .bars {
      animation: none;
    }
  }
`;
