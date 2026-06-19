import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  mdiPower,
  mdiBullhorn,
  mdiCarLightHigh,
  mdiGarage,
  mdiKey,
  mdiSpeaker,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon, ageHint } from '../ui';
import type { EntityKey } from '../const';
import { entityId, rawState, isMissing, pressButton, formatAge, prettyText } from '../helpers';
import {
  canWake,
  observedWakeState,
  wakeCooldownRemaining,
  formatCooldown,
  WAKE_COOLDOWN_DEFAULT_MS,
  type WakeOpts,
} from '../data/wake';

interface Command {
  key: EntityKey;
  label: string;
  icon: string;
}

const COMMANDS: Command[] = [
  { key: 'wake', label: STRINGS.commands.wake, icon: mdiPower },
  { key: 'honk', label: STRINGS.commands.honk, icon: mdiBullhorn },
  { key: 'flash', label: STRINGS.commands.flash, icon: mdiCarLightHigh },
  { key: 'homelink', label: STRINGS.commands.homelink, icon: mdiGarage },
  { key: 'keyless', label: STRINGS.commands.keyless, icon: mdiKey },
  { key: 'boombox', label: STRINGS.commands.boombox, icon: mdiSpeaker },
];

@customElement('tc-commands')
export class TcCommands extends TcBase {
  /**
   * Per-instance timestamp (client ms epoch) of the last user-initiated wake. State
   * lives HERE, not in the gate (the gate stays pure — Story 5.4 / AR-9); the
   * shared HA helper is deferred (YAGNI / D3). Drives the cooldown + `waking` state.
   */
  @state() private _lastWakeAt?: number;

  /** One-shot re-render at cooldown expiry (so "available in Nm" reaches actionable). */
  private _cooldownTimer?: ReturnType<typeof setTimeout>;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._clearCooldownTimer();
  }

  /** Cooldown window (ms) from `config.wake_cooldown` (minutes), else the default. */
  private _cooldownMs(): number {
    const min = this.config.wake_cooldown;
    return typeof min === 'number' && Number.isFinite(min) && min > 0
      ? min * 60_000
      : WAKE_COOLDOWN_DEFAULT_MS;
  }

  private _wakeOpts(): WakeOpts {
    return { lastWakeAt: this._lastWakeAt, cooldownMs: this._cooldownMs() };
  }

  private _press(key: EntityKey): void {
    if (!this.hass) return;
    if (key === 'wake') {
      this._wake();
      return;
    }
    // The other five commands are fire-and-forget (Story 5.3) — unchanged.
    pressButton(this.hass, entityId(this.config, key));
  }

  /**
   * The wake path with its safety + honesty layer (Story 5.4). The HARD gate
   * (`canWake`) blocks `online`/`waking` — a wake is NEVER issued under an observed
   * online/waking state (AC1/AC5). An explicit wake of an asleep car is never
   * blocked (AR-9). On a real wake we stamp the per-instance last-wake timestamp
   * and arm a single bounded expiry re-render (no `setInterval`, no polling — AC4).
   */
  private _wake(): void {
    if (!this.hass) return;
    const opts = this._wakeOpts();
    if (!canWake(this.hass, this.config, opts)) return; // never wake online/waking
    pressButton(this.hass, entityId(this.config, 'wake'));
    this._lastWakeAt = Date.now();
    this._armCooldownTimer(this._cooldownMs());
  }

  private _armCooldownTimer(cooldownMs: number): void {
    this._clearCooldownTimer();
    // A single bounded one-shot (the quick-actions per-tap fence shape), cleared on
    // disconnect — never a repeating polling timer (banned by a11y.test.ts). The
    // countdown itself is recomputed from the timestamp on each hass tick; this only
    // covers the gap to the moment the window expires so the affordance re-enables.
    this._cooldownTimer = setTimeout(() => {
      this._cooldownTimer = undefined;
      this.requestUpdate();
    }, cooldownMs);
  }

  private _clearCooldownTimer(): void {
    if (this._cooldownTimer !== undefined) {
      clearTimeout(this._cooldownTimer);
      this._cooldownTimer = undefined;
    }
  }

  /** "Woken 1m ago" / "Woken just now" — the last-wake time in the triad. */
  private _wokenText(): string | undefined {
    if (this._lastWakeAt === undefined) return undefined;
    const age = formatAge(Date.now() - this._lastWakeAt);
    return age === ''
      ? STRINGS.wake.wokenJustNow
      : `${STRINGS.wake.wokenPrefix} ${age} ${STRINGS.hero.ago}`;
  }

  protected override render(): TemplateResult {
    // The observed-state gate + cooldown drive the wake button AND the bundled
    // sparse-data affordance (the triad: refresh/wake control + cooldown
    // reason/last-wake + last-updated). The wake button reads as the affordance
    // (Story 5.3); 5.4 makes it honest + safe.
    const opts = this._wakeOpts();
    const wakeState = observedWakeState(this.hass, this.config, opts);
    const cooldownRemaining = wakeCooldownRemaining(
      this._lastWakeAt,
      this._cooldownMs(),
      Date.now()
    );
    const cooling = cooldownRemaining > 0;
    const wakeBlocked = !canWake(this.hass, this.config, opts); // online || waking
    // Wakeable surfaces (asleep / unknown-degrade-safe, not cooling) read as the
    // wake affordance; online/cooling show the resting reason instead.
    const wakeable = wakeState === 'asleep' || wakeState === 'unknown';

    return html`
      <section class="block">
        <span class="label">${STRINGS.commands.title}</span>
        ${this._affordance(wakeState, cooling, cooldownRemaining, wakeable)}
        <div class="row">
          ${COMMANDS.map((c) => {
            // The `button` domain reads 'unknown' until first pressed / after every
            // HA restart, so degrade ONLY on genuinely-missing/'unavailable' (isMissing)
            // — never on 'unknown' (isUnavailable would wrongly disable wake here).
            const missing = isMissing(rawState(this.hass, this.config, c.key));
            const isWake = c.key === 'wake';
            // Wake is non-actionable under the hard gate (online/waking); the other
            // five only degrade on missing/unavailable.
            const disabled = missing || (isWake && wakeBlocked);
            return html`
              <button
                class="cmd"
                ?disabled=${disabled}
                aria-label=${isWake ? this._wakeName(wakeState, cooling, cooldownRemaining) : nothing}
                @click=${() => this._press(c.key)}
              >
                ${icon(c.icon, { size: 20 })}
                <span>${c.label}</span>
              </button>
            `;
          })}
        </div>
      </section>
    `;
  }

  /**
   * State-bearing accessible name for the wake button (UX-DR21): "Wake" (asleep,
   * available), "Wake — available in 2m" (cooling down), "Awake" (online,
   * non-actionable). Reflects the SETTLED gate state, never an in-flight guess.
   */
  private _wakeName(wakeState: string, cooling: boolean, remaining: number): string {
    if (wakeState === 'online') return STRINGS.wake.online;
    if (cooling) {
      return `${STRINGS.commands.wake} — ${STRINGS.wake.availableIn} ${formatCooldown(remaining)}`;
    }
    return STRINGS.commands.wake;
  }

  /**
   * The bundled sparse-data affordance (AC3) — the triad rendered TOGETHER, co-
   * located with the wake control: (a) the resting reason / wake hint, (b) the
   * last-wake time, (c) the last-updated time. All staleness copy is `.tc-stale-copy`
   * (→ --tc-text-dim, the AA floor; never --tc-text-mute). Reduced-motion safe:
   * pure text, no keyframe (a countdown is data, not decoration).
   */
  private _affordance(
    wakeState: string,
    cooling: boolean,
    remaining: number,
    wakeable: boolean
  ): TemplateResult {
    const age = ageHint(this.hass, this.config); // (c) last-updated — the one shared source
    const woken = this._wokenText(); // (b) last-wake time
    // (a) the resting reason: counting down → "Available in 2m"; online → "Awake";
    // otherwise the honest asleep wake hint (verbatim STRINGS.hero.tapToWake, 5.3).
    const reason = cooling
      ? prettyText(`${STRINGS.wake.availableIn} ${formatCooldown(remaining)}`)
      : wakeState === 'online'
        ? STRINGS.wake.online
        : wakeable
          ? STRINGS.hero.tapToWake
          : undefined;
    const meta = [woken, age].filter((p): p is string => Boolean(p)).join(' · ');
    if (!reason && !meta) return html`${nothing}`;
    return html`
      <div class="wake-affordance">
        ${reason ? html`<span class="wake-reason">${reason}</span>` : nothing}
        ${meta ? html`<span class="wake-meta tc-stale-copy">${meta}</span>` : nothing}
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .block {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      /* The bundled sparse-data triad (Story 5.4): resting reason + last-wake +
         last-updated, co-located above the command row. */
      .wake-affordance {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: -4px;
      }
      .wake-reason {
        font-size: var(--tc-fs-stat-key, 11.5px);
        color: var(--tc-text-dim, #9aa7b8);
      }
      .wake-meta {
        font-size: var(--tc-fs-stat-key, 11.5px);
      }
      .row {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 8px;
      }
      .cmd {
        appearance: none;
        font-family: inherit;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        padding: 13px 6px;
        border-radius: var(--tc-radius-md, 16px);
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        color: var(--tc-text-dim, #9aa7b8);
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          border-color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      /* Label = DESIGN {typography.label}: UPPERCASE / 700 / +0.1em (token-driven
         with DESIGN.md fallbacks). Scoped to the <span> so the icon is untouched. */
      .cmd span {
        font-size: var(--tc-fs-label, 11.5px);
        font-weight: var(--tc-fw-label, 700);
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .cmd:hover {
        color: var(--tc-text, #f1f5f9);
        border-color: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .cmd:active {
        transform: scale(0.95);
      }
      .cmd[disabled] {
        opacity: 0.4;
        pointer-events: none;
      }
      /* 540 = BREAKPOINTS.compact (styles.ts) — canonical source of truth. */
      @media (max-width: 540px) {
        .row {
          grid-template-columns: repeat(3, 1fr);
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-commands': TcCommands;
  }
}
