import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiLock, mdiLockOpenVariant, mdiFlash } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon, batteryGauge, ageHint, keyAgeHint } from '../ui';
import { carView, carStyles, CLOSED_APERTURES } from './car';
import type { ApertureState, ChargeVisual } from './car';
import { resolvePaint } from '../paint';
import { adapterFor } from '../data/dialect';
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
  private _open(panel: PanelId): void {
    fireEvent<{ panel: PanelId }>(this, 'open-panel', { panel });
  }

  /**
   * Classify the glanceable charge state (AC1/AC2) from the DISCRETE charging-state
   * entity via the VEHICLE DIALECT's adapter normalizer (Story 15.1 / D-DGT-2:
   * `adapterFor` on the parent-stamped resolved config — the stamp short-circuits
   * detection on its override branch, an O(1) table dispatch with zero per-render
   * registry scan) — never signed power, never an inline `=== 'Charging'` (the
   * debt `data/dialect`'s canonical-vocabulary section was built to retire).
   * The 7-member `ChargingState` union collapses to the 3 visual states the Hero shows:
   *   charging                                  → 'charging'
   *   starting | stopped | complete | no_power  → 'plugged'  (connected, not drawing)
   *   disconnected                              → 'parked'
   *   unknown                                   → 'parked'   (neutral degrade — never a
   *                                                false Charging/Plugged; NFR-4)
   * `Charging ⇒ plugged` (AC2) is structural: the port-glow/cable renders for BOTH
   * 'plugged' and 'charging' (car.ts), so green is a superset of blue.
   * On tesla_custom the source is a BOOLEAN (`on` → 'charging'; `off` → 'unknown',
   * because teslajsonpy's off covers Stopped/Complete/Disconnected alike) — the
   * default branch's cable corroboration below then classifies off+cabled as
   * 'plugged' and off+uncabled as 'parked', from real physical evidence.
   */
  private _chargeVisual(): ChargeVisual {
    const state = adapterFor(this.hass, this.config).normalizeChargingState(
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
    // Cover apertures route through the dialect seam — since Story 15.1 the
    // VEHICLE DIALECT's adapter normalizer (the parent-stamped `integration`
    // short-circuits detection), superseding the Story-5.11 module-default read;
    // the doors are `binary_sensor` on/off, kept on `isOn` (already canonical).
    // Behaviour-identical for every current dialect (no adapter carries a cover
    // override — pinned by the AC6 equivalence table in dialect.test.ts).
    const adapter = adapterFor(this.hass, this.config);
    const isCoverOpen = (key: 'frunk' | 'trunk' | 'windows'): boolean =>
      adapter.normalizeCoverState(rawState(this.hass, this.config, key)) === 'open';
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
   * Story 11.2 — the compact cell's lock/security glance chip state, derived
   * DIRECTLY from the raw lock + door + window entity states. NOT from the
   * `apertures` const, which is force-suppressed to `CLOSED_APERTURES` when asleep
   * (render(), hero.ts:253) and would falsely read "all closed/locked" on the
   * cell where the chip lives almost all the time. The `lock` entity retains its
   * last-known value across sleep, so the chip stays informative (dimmed) when
   * asleep without ever fabricating freshness.
   *
   * Escalation priority — door > window > unlocked > locked: the chip is calm by
   * default and only shouts (amber `--tc-amber`, the existing exception token) on
   * a door/window exception. The state is carried by the WORD (+ the lock glyph),
   * NEVER hue alone (extends the suite's "never hue-only" rule). The exception copy
   * is a GENERIC SINGULAR — "Door open"/"Window open" regardless of how many are
   * ajar (a glance; the closures panel carries per-door detail).
   *
   * Returns `null` when there is NO resolvable signal (lock `unknown` AND nothing
   * reads open) — the chip is OMITTED gracefully (honest absence, never a "—" chip).
   */
  private _security(): {
    word: string;
    glyph: string;
    tone: 'calm' | 'muted' | 'exception';
  } | null {
    // Lock/cover reads through the vehicle dialect's adapter (Story 15.1) —
    // behaviour-identical today (no adapter overrides lock/cover; AC6-pinned).
    const adapter = adapterFor(this.hass, this.config);
    const lockState = adapter.normalizeLockState(rawState(this.hass, this.config, 'lock'));
    const doorOpen =
      isOn(this.hass, this.config, 'door_fl') ||
      isOn(this.hass, this.config, 'door_fr') ||
      isOn(this.hass, this.config, 'door_rl') ||
      isOn(this.hass, this.config, 'door_rr');
    const windowOpen =
      adapter.normalizeCoverState(rawState(this.hass, this.config, 'windows')) === 'open';
    // Omit when nothing is resolvable — never a fabricated dash for lock state.
    if (lockState === 'unknown' && !doorOpen && !windowOpen) return null;
    // Escalation: door > window > unlocked > locked.
    if (doorOpen)
      return { word: STRINGS.hero.security.doorOpen, glyph: mdiLockOpenVariant, tone: 'exception' };
    if (windowOpen)
      return { word: STRINGS.hero.security.windowOpen, glyph: mdiLockOpenVariant, tone: 'exception' };
    if (lockState === 'unlocked')
      return { word: STRINGS.status.unlocked, glyph: mdiLockOpenVariant, tone: 'muted' };
    return { word: STRINGS.status.locked, glyph: mdiLock, tone: 'calm' };
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
    const locked =
      adapterFor(this.hass, this.config).normalizeLockState(
        rawState(this.hass, this.config, 'lock')
      ) === 'locked';
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
    // Compact variant (Story 8.10): tighten the silhouette so the hero fits a ~380px
    // column. Strict `=== 'compact'` — unset or garbage reads as full (forward-compat).
    // Sizing only; the status line, battery gauge, and car silhouette all stay.
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
    // Compact-cell lock/security chip (Story 11.2) — gated on `compact` ONLY (shows
    // awake too; security-at-a-glance is not asleep-only). `null` ⇒ omitted (no cache
    // to show). Derived from the RAW lock/door/window entities (see `_security`),
    // never the asleep-suppressed `apertures` const below.
    const security = compact ? this._security() : null;
    const limit = num(this.hass, cfg, 'charge_limit');
    // Classify once: asleep suppresses the charge cue (Story 3.3's isAsleep gate
    // still wins — an asleep car shows no live charge state).
    const charge: ChargeVisual = asleep ? 'parked' : this._chargeVisual();
    const charging = charge === 'charging';
    // Apertures (Story 3.5): asleep suppresses the cues — mirror the charge gate.
    // An asleep car's aperture entities read `unavailable` anyway (→ all-closed),
    // and we never paint state on a dimmed car (Story 3.3's isAsleep still wins).
    const apertures: ApertureState = asleep ? CLOSED_APERTURES : this._apertures();

    // Range mirrors the battery's last-known fallback: the live `battery_range`
    // when awake (or on the full card), the cached `estimate_battery_range` ONLY
    // under compact + asleep. `estimate_*` tracks the live rated `battery_range`
    // closely (never the optimistic `ideal_*`, which reads high and would visibly
    // deflate on wake — overstating freshness). The literal union is an EntityKey.
    //
    // Story 11.2 — an ADDED RUNG, not a swap: under compact + asleep, if the cached
    // `estimate_battery_range` is unmapped/absent (`num` → undefined — investigation
    // #2's root cause), fall back to last-known `battery_range` rather than blanking
    // to "—". The awake / full-card branch still resolves `battery_range` unchanged.
    // `—` survives only when BOTH keys are absent. `rangeFrom` returns the value AND
    // the unit from the SAME resolving key, so the unit never reads off a key that
    // produced no value. Same dimmed `.tc-stale-copy` skin as the SoC — no new stamp.
    const rangeFrom = (
      key: 'estimate_battery_range' | 'battery_range'
    ): { value: number; unit: string } | undefined => {
      const value = num(this.hass, cfg, key);
      return value === undefined
        ? undefined
        : { value, unit: unit(this.hass, cfg, key) || 'mi' };
    };
    const range = lastKnown
      ? rangeFrom('estimate_battery_range') ?? rangeFrom('battery_range')
      : rangeFrom('battery_range');
    const rangeNum = range?.value;
    const rangeUnit = range?.unit ?? 'mi';

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
        </div>

        ${security
          ? html`<button
              class="security-chip ${security.tone} ${lastKnown ? 'last-known' : ''}"
              @click=${() => this._open('closures')}
              aria-label="${security.word}${
                lastKnown ? ` ${STRINGS.hero.lastKnown}` : ''
              }, ${STRINGS.hero.opensClosures}"
            >
              ${icon(security.glyph, { size: 16 })}
              <span class="sec-word ${lastKnown ? 'tc-stale-copy' : ''}">${security.word}</span>
            </button>`
          : nothing}

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
         a dark preset reads as a dim colour, not near-black. Grayscale must NOT
         sit on the stage (an ancestor of the render) or it would desaturate the
         car; the .tc-asleep recipe in styles.ts is unchanged. */
      .car-stage.asleep {
        opacity: var(--tc-dim-opacity, 0.5);
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
         column. Tighten the silhouette + stage/hero padding so the silhouette ·
         status · battery fit the column with no horizontal overflow. Sizing
         only — the asleep fade, paint, and shadow recipes are inherited unchanged. */
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

      /* ── compact lock/security chip (Story 11.2) ─────────────────────────
         The second glance affordance — a real button → closures, sibling
         between the car stage and the battery readout, rendered ONLY under the
         compact variant. Calm (neutral text) by default; .muted dims the
         unlocked state; .exception paints the door/window-open WORD amber
         (--tc-amber, the existing exception token — never a new colour, never
         hue alone: the word carries the state). Clears the 44x44 tap floor via
         min-height + inline padding (cf. the .battery margin/padding approach). */
      .security-chip {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--tc-text, #f1f5f9);
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 4px 10px;
        margin: 0 -10px;
        border-radius: var(--tc-radius-md, 16px);
        font-size: 14px;
        font-weight: 650;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .security-chip:hover {
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
      }
      .security-chip .sec-word {
        line-height: 1;
      }
      .security-chip.muted {
        color: var(--tc-text-dim, #9aa7b8);
      }
      .security-chip.exception {
        color: var(--tc-amber, #fbbf24);
      }
      /* Asleep last-known skin: the same --tc-text-dim stale treatment the
         SoC/range use (the .tc-stale-copy on .sec-word dims the word; this dims
         the glyph to match so an asleep exception reads calm-stale, not a live
         amber). Ordered AFTER .exception so the dim wins at equal specificity. */
      .security-chip.last-known {
        color: var(--tc-text-dim, #9aa7b8);
      }
      .security-chip.last-known .tc-ico {
        opacity: 0.7;
        filter: grayscale(var(--tc-dim-grayscale, 1));
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
