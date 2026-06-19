import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiLock, mdiLockOpenVariant, mdiFlash } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon, batteryGauge } from '../ui';
import { carView, carStyles } from './car';
import { resolvePaint } from '../paint';
import { readKey, referenceNow } from '../data/freshness';
import {
  num,
  rawState,
  isAsleep,
  isUnavailable,
  fireEvent,
  formatNumber,
  formatHoursToHM,
  formatAge,
  unit,
} from '../helpers';
import type { PanelId } from '../types';

interface HeroStatus {
  dot: string;
  label: string;
  sub: string | TemplateResult;
}

@customElement('tc-hero')
export class TcHero extends TcBase {
  private _open(panel: PanelId): void {
    fireEvent<{ panel: PanelId }>(this, 'open-panel', { panel });
  }

  private _isCharging(): boolean {
    return rawState(this.hass, this.config, 'charging_status') === 'Charging';
  }

  /**
   * The honest "updated Nm ago" hint (AC1/AC4) — the Hero is the FIRST consumer
   * of the Epic-1 freshness read-model (R6 sequencing `data → freshness → … →
   * hero`). Backing signal: `battery_level` — the headline value the battery row
   * shows; even when it reads `unavailable` (asleep) its `last_updated` stamp
   * still tells us WHEN it last reported (precisely the "47m ago"). `readKey`
   * resolves the function-key via the registry then delegates to `read` — no
   * bare `hass.states` reaches this component (the read happens inside `data/`).
   *
   * Age is measured against HA's OWN time base (`referenceNow` = max server
   * stamp across states), NEVER `Date.now()`: a naive client subtraction can
   * manufacture phantom freshness, the one unforgivable error (UX-DR18).
   * Graceful omission: no stamp → `undefined` (caller omits the hint entirely;
   * never "updated NaN"/a fabricated time).
   */
  private _ageHint(): string | undefined {
    // Compute HA's server time base ONCE and reuse it for both the freshness read
    // (which classifies staleness against it internally) and the displayed age —
    // one O(n) scan of hass.states per render, not two, and a single consistent
    // reference for both derivations.
    const now = referenceNow(this.hass);
    const r = readKey(this.hass, this.config, 'battery_level', { now });
    if (!r.lastUpdated) return undefined;
    const age = formatAge(now - Date.parse(r.lastUpdated));
    return age === ''
      ? STRINGS.hero.justNow
      : `${STRINGS.hero.updatedPrefix} ${age} ${STRINGS.hero.ago}`;
  }

  private _status(asleep: boolean, hint: string | undefined): HeroStatus {
    if (asleep) {
      // "Asleep · updated 47m ago" (AC4) — the last-updated hint is the asleep
      // sub. Falls back to the wake affordance only when no stamp exists (cold
      // paint / absent entity), never a fabricated time.
      return {
        dot: 'var(--tc-text-mute, #64748b)',
        label: STRINGS.status.asleep,
        sub: hint ?? STRINGS.hero.tapToWake,
      };
    }
    const shift = rawState(this.hass, this.config, 'shift_state');
    const charging = this._isCharging();
    const locked = rawState(this.hass, this.config, 'lock') === 'locked';

    if (charging) {
      const ttf = num(this.hass, this.config, 'time_to_full_charge');
      const limit = num(this.hass, this.config, 'charge_limit');
      const sub =
        ttf && ttf > 0
          ? `${STRINGS.status.charging} · ${formatHoursToHM(ttf)}${limit ? ` to ${formatNumber(limit)}%` : ''}`
          : STRINGS.status.charging;
      return { dot: 'var(--tc-green, #34d399)', label: STRINGS.status.charging, sub };
    }
    if (shift && !isUnavailable(shift) && shift !== 'P') {
      const speed = num(this.hass, this.config, 'speed');
      const map: Record<string, string> = {
        D: STRINGS.status.driving,
        R: STRINGS.status.reverse,
        N: STRINGS.status.neutral,
      };
      const sub =
        speed !== undefined
          ? `${formatNumber(speed)} ${unit(this.hass, this.config, 'speed') || 'mph'}`
          : STRINGS.status.inMotion;
      return { dot: 'var(--tc-blue, #38bdf8)', label: map[shift] ?? STRINGS.status.driving, sub };
    }
    return {
      dot: locked ? 'var(--tc-green, #34d399)' : 'var(--tc-amber, #fbbf24)',
      label: STRINGS.status.parked,
      sub: html`<span class="lockline">
        ${icon(locked ? mdiLock : mdiLockOpenVariant, { size: 14 })}
        ${locked ? STRINGS.status.locked : STRINGS.status.unlocked}
      </span>`,
    };
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const asleep = isAsleep(this.hass, cfg);
    const name = cfg.name ?? STRINGS.hero.defaultName;
    const image = cfg.image;
    const hint = this._ageHint();
    const status = this._status(asleep, hint);

    const battery = asleep ? undefined : num(this.hass, cfg, 'battery_level');
    const limit = num(this.hass, cfg, 'charge_limit');
    const charging = !asleep && this._isCharging();
    const rangeNum = num(this.hass, cfg, 'battery_range');
    const rangeUnit = unit(this.hass, cfg, 'battery_range') || 'mi';

    // AC3 — a STATE-BEARING aria-label (EXPERIENCE.md:176 "Battery 64%, opens
    // charging"): SR users hear the charge + the action. Built from the SETTLED
    // battery value (never an optimistic guess); falls back to the action-only
    // label when the percent is unknown/asleep (no number to overstate).
    const batteryLabel =
      battery !== undefined
        ? `${STRINGS.hero.battery} ${formatNumber(battery)}%, ${STRINGS.hero.opensCharging}`
        : STRINGS.hero.openCharging;

    return html`
      <div class="hero surface">
        <div class="head">
          <div class="title">
            <span class="name">${name}</span>
            <span class="status">
              <span class="dot" style="background:${status.dot}"></span>
              <span class="st-label">${status.label}</span>
              <span class="st-sep">·</span>
              <span class="st-sub">${status.sub}</span>
              ${!asleep && hint
                ? html`<span class="st-sep">·</span><span class="st-sub">${hint}</span>`
                : nothing}
            </span>
          </div>
        </div>

        <div class="car-stage ${asleep ? 'tc-asleep' : ''}">
          ${carView({
            image,
            name,
            body: cfg.body,
            paint: resolvePaint(this.hass, cfg),
            charging,
          })}
        </div>

        <button
          class="battery"
          @click=${() => this._open('charging')}
          aria-label=${batteryLabel}
        >
          <div class="bat-top">
            <span class="bat-pct">
              ${charging ? icon(mdiFlash, { size: 22, color: 'var(--tc-green, #34d399)' }) : nothing}
              ${battery !== undefined ? `${formatNumber(battery)}%` : '—'}
            </span>
            <span class="bat-range">
              ${rangeNum !== undefined ? `${formatNumber(rangeNum)} ${rangeUnit}` : '—'}
            </span>
          </div>
          ${batteryGauge(battery, { limit, charging, height: 14 })}
        </button>
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    carStyles,
    css`
      .hero {
        padding: 18px 20px 20px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
      }
      .title {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .name {
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
        font-size: var(--tc-fs-name, 21px);
        font-weight: var(--tc-fw-name, 750);
        letter-spacing: -0.01em;
        color: var(--tc-text, #f1f5f9);
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--tc-text-dim, #9aa7b8);
        flex-wrap: wrap;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
        box-shadow: 0 0 8px currentColor;
      }
      .st-label {
        font-weight: 650;
        color: var(--tc-text, #f1f5f9);
      }
      .st-sep {
        opacity: 0.5;
      }
      .lockline {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }

      /* ── car render ──────────────────────────────────────────────── */
      .car-stage {
        position: relative;
        display: grid;
        place-items: center;
        padding: 10px 0 14px;
        min-height: 160px;
        /* Preserve the asleep fade feel; the dim/grayscale magnitudes themselves
           come from the shared .tc-asleep recipe (--tc-dim-*), not re-hard-coded. */
        transition: opacity 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          filter 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .car-stage::after {
        content: '';
        position: absolute;
        bottom: 8px;
        left: 50%;
        transform: translateX(-50%);
        width: 58%;
        height: 26px;
        background: radial-gradient(
          ellipse at center,
          rgba(0, 0, 0, 0.5),
          transparent 72%
        );
        filter: blur(7px);
        z-index: 0;
      }
      .car-img {
        position: relative;
        z-index: 1;
        display: block;
        margin: 0 auto;
        max-width: min(100%, 470px);
        max-height: 232px;
        width: 100%;
        object-fit: contain;
        filter: drop-shadow(0 22px 30px rgba(0, 0, 0, 0.45));
        transition: opacity 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), filter 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }

      /* ── battery row ─────────────────────────────────────────────── */
      .battery {
        appearance: none;
        border: 0;
        background: transparent;
        color: inherit;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 6px;
        margin: -6px;
        border-radius: var(--tc-radius-md, 16px);
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .battery:hover {
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
      }
      .bat-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .bat-pct {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
        font-size: var(--tc-fs-battery, 26px);
        font-weight: var(--tc-fw-battery, 760);
        letter-spacing: -0.02em;
        color: var(--tc-text, #f1f5f9);
        line-height: 1;
      }
      .bat-pct .tc-ico {
        margin-bottom: -2px;
      }
      .bat-range {
        font-size: 15px;
        font-weight: 650;
        color: var(--tc-text-dim, #9aa7b8);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-hero': TcHero;
  }
}
