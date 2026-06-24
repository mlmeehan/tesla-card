import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiLock, mdiLockOpenVariant, mdiFlash } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon, batteryGauge, ageHint, keyAgeHint } from '../ui';
import { carView, carStyles, CLOSED_APERTURES } from './car';
import type { ApertureState, ChargeVisual } from './car';
import { bindFlowModel } from '../flow/binding';
import { HeroSvgRenderer, flowOverlayStyles } from '../flow/hero-svg';
import { resolvePaint } from '../paint';
import { HERO_VIEWBOX } from '../const';
import { normalizeChargingState, normalizeCoverState, normalizeLockState } from '../data/dialect';
import {
  num,
  rawState,
  isAsleep,
  isOn,
  isUnavailable,
  fireEvent,
  formatNumber,
  formatHoursToHM,
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
  // The live energy-flow overlay hub (Story 4.3). Held across renders so it caches
  // the model + precomputed geometry; the element stays thin (composites its
  // `view()`). All mapping/derivation lives in the renderer, not here.
  private readonly _flow = new HeroSvgRenderer();

  private _open(panel: PanelId): void {
    fireEvent<{ panel: PanelId }>(this, 'open-panel', { panel });
  }

  /**
   * Classify the glanceable charge state (AC1/AC2) from the DISCRETE charging-state
   * entity via the Epic-1 canonical normalizer — never signed power, never an inline
   * `=== 'Charging'` (the debt `data/dialect` was built to retire, dialect.ts:78-81).
   * The 7-member `ChargingState` union collapses to the 3 visual states the Hero shows:
   *   charging                                  → 'charging'
   *   starting | stopped | complete | no_power  → 'plugged'  (connected, not drawing)
   *   disconnected                              → 'parked'
   *   unknown                                   → 'parked'   (neutral degrade — never a
   *                                                false Charging/Plugged; NFR-4)
   * `Charging ⇒ plugged` (AC2) is structural: the port-glow/cable renders for BOTH
   * 'plugged' and 'charging' (car.ts), so green is a superset of blue.
   */
  private _chargeVisual(): ChargeVisual {
    const state = normalizeChargingState(
      rawState(this.hass, this.config, 'charging_status')
    );
    switch (state) {
      case 'charging':
        return 'charging';
      case 'starting':
      case 'stopped':
      case 'complete':
      case 'no_power':
        return 'plugged';
      case 'disconnected':
        return 'parked';
      default:
        // 'unknown' → neutral Parked. Corroborate ONLY with the physical cable
        // sensor (real evidence of a connection, never a fabricated charge state):
        // an `on` cable means plugged-idle even when charging_status hasn't reported
        // a usable value. charging_status stays the authority (AC1).
        return isOn(this.hass, this.config, 'charge_cable') ? 'plugged' : 'parked';
    }
  }

  /**
   * Classify the four INDEPENDENT apertures (Story 3.5, AC1/AC3) from the resolved
   * entity keys via the data-boundary helpers — never bare `hass.states` (the
   * `components/` read rule). A flat record of four booleans, NOT a single enum:
   * apertures are physically independent (frunk up + door ajar + window down can
   * all hold at once), so each is read and rendered on its own (linear, never
   * combinatorial — car.ts ApertureState). Mirrors panel-closures.ts's read
   * idiom (`_open` = cover 'open', `_doorOpen` = binary_sensor 'on').
   *
   * Graceful degrade (AC3) is STRUCTURAL: the cover read (`normalizeCoverState`,
   * Story 5.11) and `isOn(...)` both yield `false`/non-open for
   * `undefined` / `unavailable` / any non-open value, so a
   * missing or asleep aperture entity yields `false` (closed/hidden) — NEVER a
   * fabricated "open". Absence reads as closed; the card never asserts an aperture
   * state it can't confirm (the UX-DR18 honesty floor). The aggregate `windows`
   * cover is the clean single window signal (matches the closures panel's window
   * zone); on a Model Y the rear hatch IS the `trunk` cover (the design's "liftgate").
   */
  private _apertures(): ApertureState {
    // Cover apertures route through the dialect seam (`normalizeCoverState`,
    // Story 5.11) instead of an inline fleet-shaped `=== 'open'`; the doors are
    // `binary_sensor` on/off, kept on `isOn` (already canonical). Behaviour-
    // identical for tesla_fleet (the default COVER_MAP is identity for 'open').
    const isCoverOpen = (key: 'frunk' | 'trunk' | 'windows'): boolean =>
      normalizeCoverState(rawState(this.hass, this.config, key)) === 'open';
    return {
      frunk: isCoverOpen('frunk'),
      liftgate: isCoverOpen('trunk'),
      door:
        isOn(this.hass, this.config, 'door_fl') ||
        isOn(this.hass, this.config, 'door_fr') ||
        isOn(this.hass, this.config, 'door_rl') ||
        isOn(this.hass, this.config, 'door_rr'),
      window: isCoverOpen('windows'),
    };
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
    // The single shared last-updated source (ui.ts `ageHint`) — one honest
    // derivation reused by the Hero status sub-line and the commands wake
    // affordance (Story 5.4), so they can never disagree on "updated 47m ago".
    return ageHint(this.hass, this.config);
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
    const visual = this._chargeVisual();
    const locked = normalizeLockState(rawState(this.hass, this.config, 'lock')) === 'locked';
    // Lock sub-line — useful while either parked OR plugged-idle (both stationary).
    const lockSub = html`<span class="lockline">
      ${icon(locked ? mdiLock : mdiLockOpenVariant, { size: 14 })}
      ${locked ? STRINGS.status.locked : STRINGS.status.unlocked}
    </span>`;

    if (visual === 'charging') {
      // Live kW is a DIRECT NaN-safe read of `charger_power` (AC3) — never a
      // flow-balance derivation, so Epic 3 carries no copy of Epic 4's sign
      // convention. A missing / unavailable / 0 power degrades to time-to-full or
      // the plain "Charging" label — never "NaN kW" or a fabricated figure.
      const kw = num(this.hass, this.config, 'charger_power');
      const ttf = num(this.hass, this.config, 'time_to_full_charge');
      const limit = num(this.hass, this.config, 'charge_limit');
      const sub =
        kw !== undefined && kw > 0
          ? `${STRINGS.status.charging} · ${formatNumber(kw, 1)} kW`
          : ttf && ttf > 0
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
    if (visual === 'plugged') {
      // "Plugged-idle" — connected, at rest (ACCENT_SEMANTICS.blue). The blue is
      // ALWAYS paired with the label (a11y: a colour-blind user reads the state
      // from the word, never hue alone). Keep the lock sub-line — lock state is
      // still useful while plugged.
      return {
        dot: 'var(--tc-blue, #38bdf8)',
        label: STRINGS.status.pluggedIdle,
        sub: lockSub,
      };
    }
    return {
      dot: locked ? 'var(--tc-green, #34d399)' : 'var(--tc-amber, #fbbf24)',
      label: STRINGS.status.parked,
      sub: lockSub,
    };
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    // Compact variant (Story 8.10): suppress the flow-overlay kW labels and tighten
    // the silhouette so the hero fits a ~380px column. Strict `=== 'compact'` — unset
    // or garbage reads as full (forward-compat). DOM-level suppression only; the
    // status line, battery gauge, and car silhouette all stay.
    const compact = cfg.variant === 'compact';
    const asleep = isAsleep(this.hass, cfg);
    const name = cfg.name ?? STRINGS.hero.defaultName;
    const image = cfg.image;
    // Compact + asleep "last-known" (follow-on to Story 8.10's compact variant):
    // the in-line My-Home embed is asleep most of the time, and the compact card
    // has no panels — so rather than blank its only readout to "—", fall back to
    // the dedicated CACHED sensors (`usable_battery_level` / `estimate_battery_range`)
    // that the Fleet retains across sleep. This is a DELIBERATE, compact-only
    // exception to the full card's strict "asleep shows —" rule — honest because the
    // value is a REAL cached sensor (never the stale primary, never fabricated),
    // rendered DIMMED (`.tc-stale-copy` numbers + a desaturated gauge) under the
    // existing "updated Nm ago" stamp, and degrading back to "—" when the cache is
    // absent. The FULL card is untouched — its panels carry the detail, so it keeps "—".
    const lastKnown = compact && asleep;

    const battery = asleep
      ? lastKnown
        ? num(this.hass, cfg, 'usable_battery_level')
        : undefined
      : num(this.hass, cfg, 'battery_level');

    // The "updated Nm ago" stamp must describe the value ACTUALLY shown, never a
    // fresher entity (UX-DR18 — the stamp can't overstate the number's age). When we
    // render the cached SoC, source the stamp from that SAME cached sensor; the
    // primary `battery_level` stamp (its last-heard time) backs every other case
    // (awake, full-card asleep, or compact-asleep with no cache → "—").
    const hint =
      lastKnown && battery !== undefined
        ? keyAgeHint(this.hass, cfg, 'usable_battery_level')
        : this._ageHint();
    const status = this._status(asleep, hint);
    const limit = num(this.hass, cfg, 'charge_limit');
    // Classify once: asleep suppresses the charge cue (Story 3.3's isAsleep gate
    // still wins — an asleep car shows no live charge state).
    const charge: ChargeVisual = asleep ? 'parked' : this._chargeVisual();
    const charging = charge === 'charging';
    // Apertures (Story 3.5): asleep suppresses the cues — mirror the charge gate.
    // An asleep car's aperture entities read `unavailable` anyway (→ all-closed),
    // and we never paint state on a dimmed car (Story 3.3's isAsleep still wins).
    const apertures: ApertureState = asleep ? CLOSED_APERTURES : this._apertures();

    // Live energy-flow overlay (Story 4.3). `bindFlowModel` self-resolves the
    // energy entities and returns the model the renderer draws — the renderer
    // never re-reads hass.states. A vehicle-only install ⇒ empty model ⇒ the
    // overlay is omitted entirely (no occluding box). Asleep needs no parallel
    // branch: the binding yields calm `quiescent` edges and the stage opacity dim
    // covers the whole stage (overlay included), while grayscale rides only the
    // overlay so the render keeps its hue (Story 11.1).
    this._flow.update(bindFlowModel(this.hass, cfg));

    // Range mirrors the battery's last-known fallback: the live `battery_range`
    // when awake (or on the full card), the cached `estimate_battery_range` ONLY
    // under compact + asleep. `estimate_*` tracks the live rated `battery_range`
    // closely (never the optimistic `ideal_*`, which reads high and would visibly
    // deflate on wake — overstating freshness). The literal union is an EntityKey.
    const rangeKey = lastKnown ? 'estimate_battery_range' : 'battery_range';
    const rangeNum = num(this.hass, cfg, rangeKey);
    const rangeUnit = unit(this.hass, cfg, rangeKey) || 'mi';

    // AC3 — a STATE-BEARING aria-label (EXPERIENCE.md:176 "Battery 64%, opens
    // charging"): SR users hear the charge + the action. Built from the SETTLED
    // battery value (never an optimistic guess); falls back to the action-only
    // label when the percent is unknown/asleep (no number to overstate).
    // Under compact + asleep the percent is a last-known cache read, so the label
    // says so ("Battery 71% (last known), opens charging") — a11y honesty parity
    // (UX-DR21): a SR user is never told a stale value is live.
    const batteryLabel =
      battery !== undefined
        ? `${STRINGS.hero.battery} ${formatNumber(battery)}%${
            lastKnown ? ` ${STRINGS.hero.lastKnown}` : ''
          }, ${STRINGS.hero.opensCharging}`
        : STRINGS.hero.openCharging;

    return html`
      <div class="hero surface ${compact ? 'compact' : ''}">
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

        <div class="car-stage ${asleep ? 'asleep' : ''}">
          ${carView({
            image,
            name,
            body: cfg.body,
            paint: resolvePaint(this.hass, cfg),
            charge,
            apertures,
          })}
          ${compact || this._flow.empty
            ? nothing
            : html`<svg
                class="tc-flow-overlay"
                viewBox="0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}"
                role="img"
                aria-label=${this._flow.label()}
              >
                ${this._flow.view()}
              </svg>`}
        </div>

        <button
          class="battery ${lastKnown ? 'last-known' : ''}"
          @click=${() => this._open('charging')}
          aria-label=${batteryLabel}
        >
          <div class="bat-top ${lastKnown ? 'tc-stale-copy' : ''}">
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
    flowOverlayStyles,
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
        /* Preserve the asleep fade feel; the dim magnitude itself comes from the
           shared --tc-dim-* tokens (see .car-stage.asleep), not re-hard-coded. */
        transition: opacity 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          filter 0.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      /* ── Asleep re-scope (Story 11.1) ─────────────────────────────────────
         The stage dims via OPACITY ONLY (single-sourced from --tc-dim-opacity),
         so the recolorable render (.car-img/.tc-car) keeps its resolved HUE —
         a dark preset reads as a dim colour, not near-black. Grayscale is
         re-scoped to ride ONLY the Flow overlay (a child cannot un-apply an
         ancestor's filter, so the desaturation must NOT sit on an ancestor of
         the render). The literal .tc-asleep recipe in styles.ts is unchanged;
         this is a re-scope of where the treatment is APPLIED, not the recipe. */
      .car-stage.asleep {
        opacity: var(--tc-dim-opacity, 0.5);
      }
      .car-stage.asleep .tc-flow-overlay {
        filter: grayscale(var(--tc-dim-grayscale, 1));
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

      /* ── compact variant (Story 8.10) ────────────────────────────────
         The "My Home" in-line embed renders the hero in a ~380px load-row
         column (flow-overlay suppressed in render()). Tighten the silhouette
         + stage/hero padding so the surviving silhouette · status · battery
         fit the column with no horizontal overflow. Sizing only — the asleep
         fade, paint, and shadow recipes are inherited unchanged. */
      .hero.compact {
        padding: 14px 14px 16px;
      }
      .hero.compact .car-stage {
        min-height: 120px;
        padding: 6px 0 10px;
      }
      .hero.compact .car-img {
        max-width: min(100%, 300px);
        max-height: 168px;
      }

      /* Compact + asleep "last-known": the cached SoC/range are REAL but not live, so
         the readout reads stale. The headline .bat-pct dims via the --bat-pct-color
         override (a plain .tc-stale-copy on .bat-top can't reach it — .bat-pct self-sets
         its colour; .bat-range is already --tc-text-dim). The gauge desaturates + dims
         to match the .tc-asleep car beside it — informative, yet clearly not a live read
         (the asleep stamp + dimmed car complete the staleness signal). */
      .battery.last-known {
        --bat-pct-color: var(--tc-text-dim, #9aa7b8);
      }
      .battery.last-known .tc-bat {
        opacity: 0.7;
        filter: grayscale(var(--tc-dim-grayscale, 1));
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
        /* Overridable so the .last-known stale dim can recolour WITHOUT a second
           .bat-pct selector (which would shadow the display-face per-element gate). */
        color: var(--bat-pct-color, var(--tc-text, #f1f5f9));
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
