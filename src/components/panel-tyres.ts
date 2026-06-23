import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiAlertCircle } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon, formatAgeHint } from '../ui';
import { num, unit as unitOf, isOn, formatNumber } from '../helpers';
import { readKey, referenceNow } from '../data/freshness';
import type { EntityKey } from '../const';

interface Corner {
  key: EntityKey;
  warn: EntityKey;
  label: string;
  pos: string;
}

const CORNERS: Corner[] = [
  { key: 'tire_fl', warn: 'tire_warn_fl', label: STRINGS.tyres.corners.fl, pos: 'fl' },
  { key: 'tire_fr', warn: 'tire_warn_fr', label: STRINGS.tyres.corners.fr, pos: 'fr' },
  { key: 'tire_rl', warn: 'tire_warn_rl', label: STRINGS.tyres.corners.rl, pos: 'rl' },
  { key: 'tire_rr', warn: 'tire_warn_rr', label: STRINGS.tyres.corners.rr, pos: 'rr' },
];

/**
 * Unit-aware default margin (Story 5.8 / AC2). NOT a fixed PSI constant: a corner
 * warns at `recommended − margin`, and `margin` lives in the sensor's native unit.
 * ~0.3 bar ≈ ~4 psi ≈ ~30 kPa — enough to clear a normal overnight cold-soak dip
 * (~0.1–0.2 bar) while still catching a real slow leak. Falls through to the psi
 * value for an unknown/absent unit (harmless — `recommended` is undefined with no
 * present corners, so no computed warn can fire anyway).
 */
function defaultMargin(u: string): number {
  if (/bar/i.test(u)) return 0.3;
  if (/kpa/i.test(u)) return 30;
  return 4; // psi (and the conservative fallback)
}

/** Exact bar↔psi factor (the ONE conversion constant — Story 9.13 / Tune). */
const PSI_PER_BAR = 14.5038;

/**
 * DISPLAY-ONLY unit conversion for a corner read-out (Story 9.13). `pref` is the
 * `config.tyres.units` display preference. ABSENT ⇒ the native value/unit verbatim,
 * byte-for-byte today's render (SM-C4 / FR-33 zero-diff). When set, the native value
 * is converted to the chosen unit FOR DISPLAY ONLY (the low-pressure comparison still
 * runs in native unit upstream). An unrecognised native unit — or an absent value —
 * cannot be converted honestly, so the native value/unit is shown unchanged (never a
 * fabricated number, never a mislabelled one). `isBar` drives the decimal precision.
 */
function displayPressure(
  value: number | undefined,
  nativeUnit: string,
  pref: 'psi' | 'bar' | undefined
): { value: number | undefined; unit: string; isBar: boolean } {
  if (!pref) return { value, unit: nativeUnit, isBar: /bar/i.test(nativeUnit) };
  const from = /bar/i.test(nativeUnit)
    ? 'bar'
    : /kpa/i.test(nativeUnit)
      ? 'kpa'
      : /psi/i.test(nativeUnit)
        ? 'psi'
        : undefined;
  if (value === undefined || from === undefined)
    return { value, unit: nativeUnit, isBar: /bar/i.test(nativeUnit) };
  const bar = from === 'bar' ? value : from === 'psi' ? value / PSI_PER_BAR : value / 100;
  return { value: pref === 'bar' ? bar : bar * PSI_PER_BAR, unit: pref, isBar: pref === 'bar' };
}

/** One corner's raw read — computed once per render BEFORE the peer baseline, so
 *  the baseline can be derived from the fresh subset (see `render`). */
interface CornerRead {
  c: Corner;
  value: number | undefined;
  unit: string;
  isBar: boolean;
  /** Read is available AND `fresh` (the only state a computed warn / baseline may use). */
  fresh: boolean;
  /** Present but `stale`/`asleep` (annotate, don't assert). */
  stale: boolean;
  /** The integration's own TPMS `binary_sensor` warning. */
  tpms: boolean;
  /** Freshness stamp for the staleness hint. */
  lastUpdated: string | undefined;
}

/** One corner's derived render state (computed once in render, reused by the summary). */
interface CornerView {
  c: Corner;
  value: number | undefined;
  unit: string;
  isBar: boolean;
  /** TPMS binary_sensor warn OR the computed low-pressure margin warn. */
  warn: boolean;
  /** This corner is present but its read is stale/asleep (annotate, don't assert). */
  stale: boolean;
  /** Honest "updated Nm ago" stamp, or undefined when fresh / no stamp. */
  ageHint: string | undefined;
}

@customElement('tc-panel-tyres')
export class TcPanelTyres extends TcBase {
  /** Read one corner once (freshness + value + unit + TPMS), reused for both the
   *  baseline derivation and the per-corner view — no repeated `hass.states` walks. */
  private _read(c: Corner, now: number): CornerRead {
    const r = readKey(this.hass, this.config, c.key, { now });
    const value = num(this.hass, this.config, c.key);
    const u = unitOf(this.hass, this.config, c.key);
    return {
      c,
      value,
      unit: u,
      isBar: /bar/i.test(u),
      fresh: r.available && r.staleness === 'fresh',
      stale: r.available && r.staleness !== 'fresh',
      tpms: isOn(this.hass, this.config, c.warn),
      lastUpdated: r.lastUpdated,
    };
  }

  /**
   * Derive one corner's render state. The low signal is the integration's TPMS
   * `binary_sensor` (`tpms`) OR-ed with a computed margin check — the computed
   * check AUGMENTS the car's own sensor, never replaces it (we must not under-warn
   * vs. the vehicle). The computed warn fires ONLY on a fresh, present reading with
   * a derivable `recommended`: an absent/`unavailable` value or an underivable
   * baseline must never ghost-trip (`num` is NaN-safe → `undefined`, never `NaN`),
   * and we do NOT assert a confident fresh-looking alarm on a stale read we cannot
   * confirm (UX-DR18 — annotate staleness instead). The car's own TPMS warn still
   * stands on stale data (that is the vehicle's assertion, not ours).
   */
  private _view(read: CornerRead, now: number, recommended: number | undefined, margin: number): CornerView {
    // The computed low-pressure check runs in the NATIVE unit (value/recommended/
    // margin all native) — `units` is a DISPLAY preference and never moves the warn
    // threshold (Story 9.13). Conversion happens ONLY for the rendered value/unit.
    const computedLow =
      read.fresh &&
      read.value !== undefined &&
      recommended !== undefined &&
      read.value < recommended - margin;
    const disp = displayPressure(read.value, read.unit, this.config.tyres?.units);
    return {
      c: read.c,
      value: disp.value,
      unit: disp.unit,
      isBar: disp.isBar,
      warn: read.tpms || computedLow,
      stale: read.stale,
      ageHint: read.stale ? formatAgeHint(read.lastUpdated, now) : undefined,
    };
  }

  private _corner(v: CornerView): TemplateResult {
    const text = v.value !== undefined ? formatNumber(v.value, v.isBar ? 1 : 0) : '—';
    return html`
      <div class="corner ${v.c.pos} ${v.warn ? 'warn' : ''}">
        <span class="c-label">${v.c.label}</span>
        <span class="c-val">
          ${text}<span class="c-unit">${v.value !== undefined ? v.unit : ''}</span>
        </span>
        ${v.warn
          ? html`<span class="c-warn">${icon(mdiAlertCircle, { size: 13 })} ${STRINGS.tyres.low}</span>`
          : nothing}
        ${v.ageHint
          ? html`<span class="c-stale tc-stale-copy">${v.ageHint}</span>`
          : nothing}
      </div>
    `;
  }

  protected override render(): TemplateResult {
    const now = referenceNow(this.hass);
    const reads = CORNERS.map((c) => this._read(c, now));

    // Peer baseline: recommended defaults to the MAX of the FRESH corners only. A
    // cold morning lowers all four together so the gap stays small (nothing trips);
    // a real slow leak makes one corner diverge below `max − margin`. We use only
    // FRESH values (spec: "max of the four LIVE corner readings"): a stale
    // last-known reading is not confirmable, so it must NOT inflate the baseline and
    // false-trip a fresh, uniformly-lower corner (UX-DR18 — never assert off
    // unconfirmable data). An explicit `config.tyres.recommended` overrides. ≤1
    // fresh ⇒ derived recommended is the lone value (no corner is `< itself − margin`)
    // ⇒ no computed warn — only TPMS.
    const freshVals = reads
      .filter((x) => x.fresh && x.value !== undefined)
      .map((x) => x.value as number);
    // Margin unit is the native unit of the first FRESH corner (else any present, else '').
    const unitSrc =
      reads.find((x) => x.fresh && x.value !== undefined) ??
      reads.find((x) => x.value !== undefined);
    const unitStr = unitSrc ? unitSrc.unit : '';
    const recommended =
      this.config.tyres?.recommended ?? (freshVals.length >= 1 ? Math.max(...freshVals) : undefined);
    const margin = this.config.tyres?.margin ?? defaultMargin(unitStr);

    const views = reads.map((x) => this._view(x, now, recommended, margin));

    const anyWarn = views.some((v) => v.warn);
    const present_ = views.filter((v) => v.value !== undefined);
    const anyData = present_.length > 0;
    // Freshness-honest summary: "All normal" ONLY when every present corner is
    // confirmable (not stale) and not warning; any stale corner surfaces
    // "Some readings unconfirmed" instead of a confident all-clear (UX-DR18).
    const anyStale = present_.some((v) => v.stale);
    const summaryTone = anyWarn ? 'warn' : !anyData ? '' : anyStale ? 'dim' : 'good';
    const summaryText = anyWarn
      ? STRINGS.tyres.checkPressure
      : !anyData
        ? STRINGS.tyres.noData
        : anyStale
          ? STRINGS.tyres.someUnconfirmed
          : STRINGS.tyres.allNormal;

    return html`
      <section class="surface block">
        <div class="head">
          <span class="label">${STRINGS.tyres.title}</span>
          <span class="summary ${summaryTone}">${summaryText}</span>
        </div>

        <div class="layout">
          ${this._corner(views[0])} ${this._corner(views[1])}
          <div class="car">
            <svg viewBox="0 0 120 200" aria-hidden="true">
              <rect x="28" y="14" width="64" height="172" rx="26"></rect>
              <polygon points="40,40 80,40 74,66 46,66"></polygon>
              <rect x="46" y="74" width="28" height="58" rx="8"></rect>
              <polygon points="46,140 74,140 80,166 40,166"></polygon>
            </svg>
          </div>
          ${this._corner(views[2])} ${this._corner(views[3])}
        </div>
      </section>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .block {
        padding: 18px;
        border-radius: var(--tc-radius-lg, 22px);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .summary {
        font-size: 12.5px;
        font-weight: 650;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .summary.good {
        color: var(--tc-green, #34d399);
      }
      .summary.warn {
        color: var(--tc-red, #f87171);
      }
      /* Honest unconfirmed-summary tone (UX-DR18) — dim, never confident green. */
      .summary.dim {
        color: var(--tc-text-dim, #9aa7b8);
      }

      .layout {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        grid-template-rows: auto auto;
        align-items: center;
        justify-items: center;
        gap: 18px 10px;
      }
      .car {
        grid-column: 2;
        grid-row: 1 / span 2;
        opacity: 0.6;
      }
      .car svg {
        width: 86px;
        height: 150px;
        display: block;
      }
      .car rect {
        fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        stroke-width: 1.5;
      }
      .car polygon,
      .car rect:not(:first-child) {
        fill: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .car polygon {
        stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
        stroke-width: 1;
      }

      .corner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 12px 18px;
        border-radius: var(--tc-radius-md, 16px);
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        min-width: 92px;
        transition: border-color 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), background 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .corner.fl {
        grid-column: 1;
        grid-row: 1;
      }
      .corner.fr {
        grid-column: 3;
        grid-row: 1;
      }
      .corner.rl {
        grid-column: 1;
        grid-row: 2;
      }
      .corner.rr {
        grid-column: 3;
        grid-row: 2;
      }
      .corner.warn {
        border-color: color-mix(in srgb, var(--tc-red, #f87171) 55%, transparent);
        background: color-mix(in srgb, var(--tc-red, #f87171) 12%, transparent);
      }
      .c-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--tc-text-mute, #64748b);
      }
      .c-val {
        font-size: 24px;
        font-weight: 750;
        letter-spacing: -0.02em;
        color: var(--tc-text, #f1f5f9);
        display: inline-flex;
        align-items: baseline;
        gap: 3px;
      }
      .c-unit {
        font-size: 12px;
        font-weight: 600;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .c-warn {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 11px;
        font-weight: 700;
        color: var(--tc-red, #f87171);
      }
      /* Honest per-corner staleness stamp (UX-DR18) — colour via .tc-stale-copy
         (--tc-text-dim), NEVER --tc-text-mute (fails 4.5:1 for load-bearing copy). */
      .c-stale {
        font-size: 10.5px;
        font-weight: 600;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-tyres': TcPanelTyres;
  }
}
