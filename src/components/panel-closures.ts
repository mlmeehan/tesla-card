import { html, css, svg, nothing, type TemplateResult, type SVGTemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiLock, mdiLockOpenVariant, mdiWindowClosedVariant } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon, formatAgeHint } from '../ui';
import {
  rawState,
  isUnavailable,
  entityId,
  toggleEntity,
  srState,
} from '../helpers';
import { readKey, referenceNow, type Staleness } from '../data/freshness';
import type { EntityKey } from '../const';

const DOOR = 'var(--tc-red, #f87171)';
const CARGO = 'var(--tc-amber, #fbbf24)';
const GLASS = 'var(--tc-blue, #38bdf8)';

/** Honesty-first three-state closure read (Story 5.7 / AC3): a closure we cannot
 *  confirm is `unknown`, NEVER a false "closed". `state` is the last-known value
 *  for a stale read and `unknown` only when there is no confirmable value. */
type ClosureState = 'open' | 'closed' | 'unknown';
interface Closure {
  state: ClosureState;
  staleness: Staleness;
  available: boolean;
  /** Surviving last-updated stamp (honest staleness source), or undefined. */
  lastUpdated: string | undefined;
}

@customElement('tc-panel-closures')
export class TcPanelClosures extends TcBase {
  /**
   * The single honest read per closure (AC3). Routes through the Epic-1
   * `data/freshness` model — the same model the Hero consumes — so staleness is
   * never re-derived here. `openLiteral` differs by domain: covers report
   * `'open'`, door binary-sensors report `'on'`. `now` is the HA time base,
   * computed once in `render` and threaded down (one `referenceNow` scan, not one
   * per closure). An `unavailable`/absent read becomes `unknown` (neutral), never
   * a confident "closed".
   */
  private _closure(key: EntityKey, openLiteral: 'open' | 'on', now: number): Closure {
    const r = readKey(this.hass, this.config, key, { now });
    if (!r.available) {
      return { state: 'unknown', staleness: r.staleness, available: false, lastUpdated: r.lastUpdated };
    }
    return {
      state: r.value === openLiteral ? 'open' : 'closed',
      staleness: r.staleness,
      available: true,
      lastUpdated: r.lastUpdated,
    };
  }

  /** The honest state word for an aria-label / status noun. */
  private _stateWord(s: ClosureState): string {
    return s === 'open'
      ? STRINGS.closures.openWord
      : s === 'closed'
        ? STRINGS.closures.closedWord
        : STRINGS.closures.unknownWord;
  }

  private _avail(key: EntityKey): boolean {
    return !isUnavailable(rawState(this.hass, this.config, key));
  }
  private _open(key: EntityKey): boolean {
    return rawState(this.hass, this.config, key) === 'open';
  }
  private _toggle(key: EntityKey): void {
    if (!this.hass || !this._avail(key)) return;
    // Fire-and-forget (DELIBERATE non-goal: no optimistic flip — a physical
    // closure takes seconds and can fail; an optimistic "open" would paint
    // certainty we don't have, the exact sin this panel prevents). The UI
    // reflects the REAL reconciled state on the next `hass` tick.
    toggleEntity(this.hass, entityId(this.config, key));
  }
  /** Enter/Space actuation for the focusable SVG zones (DoD a11y floor). */
  private _zoneKey(e: KeyboardEvent, key: EntityKey): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space would otherwise scroll the page
      this._toggle(key);
    }
  }

  private _zoneFill(c: Closure, color: string): string {
    if (c.state === 'unknown') return 'transparent'; // neutral — never the closed surface
    return c.state === 'open'
      ? `color-mix(in srgb, ${color} 34%, transparent)`
      : 'var(--tc-surface-2, rgba(255, 255, 255, 0.07))';
  }
  private _zoneStroke(c: Closure, color: string): string {
    if (c.state === 'unknown') return 'var(--tc-text-dim, #9aa7b8)'; // dim, dashed (see styles)
    return c.state === 'open' ? color : 'var(--tc-border-strong, rgba(255, 255, 255, 0.16))';
  }

  /** A tappable + keyboard-operable cover zone (frunk / trunk / windows / sunroof / charge port). */
  private _zone(
    key: EntityKey,
    color: string,
    shape: (fill: string, stroke: string) => SVGTemplateResult,
    label: string,
    now: number
  ): SVGTemplateResult {
    const c = this._closure(key, 'open', now);
    const stale = c.available && c.staleness !== 'fresh';
    // Only an available zone is a live control: focusable + actuable. An
    // unavailable zone is a dead control — non-focusable, pointer-events:none.
    return svg`<g
      class="zone ${c.state}${c.available ? '' : ' na'}${stale ? ' stale' : ''}"
      @click=${() => this._toggle(key)}
      @keydown=${(e: KeyboardEvent) => this._zoneKey(e, key)}
      role="button"
      tabindex=${c.available ? '0' : nothing}
      aria-label=${srState(label, this._stateWord(c.state))}
    >${shape(this._zoneFill(c, color), this._zoneStroke(c, color))}</g>`;
  }

  /** A door indicator — status-only (AC1): rendered + coloured by state, NOT
   *  tappable and NOT focusable. Announces a read-only state to SR (L176). */
  private _door(key: EntityKey, x: number, y: number, name: string, now: number): SVGTemplateResult {
    const c = this._closure(key, 'on', now);
    const stale = c.available && c.staleness !== 'fresh';
    return svg`<rect
      class="zone door ${c.state}${c.available ? '' : ' na'}${stale ? ' stale' : ''}"
      x=${x} y=${y} width="20" height="52" rx="7"
      role="img"
      aria-label=${srState(name, this._stateWord(c.state))}
      style="fill:${this._zoneFill(c, DOOR)};stroke:${this._zoneStroke(c, DOOR)}"
    ></rect>`;
  }

  /**
   * The freshness-honest status line (AC3). "All closed" may ONLY be claimed when
   * every closure is `available && closed`; any `unknown` (unconfirmable) closure
   * surfaces staleness instead. A `lock` we cannot read reads neutral, never a
   * confident "Unlocked".
   */
  private _statusLine(now: number): { text: string; tone: string } {
    const lock = readKey(this.hass, this.config, 'lock', { now });
    const lockWord = !lock.available
      ? STRINGS.closures.lockUnavailable
      : lock.value === 'locked'
        ? STRINGS.status.locked
        : STRINGS.status.unlocked;

    const items: { name: string; c: Closure }[] = [
      { name: STRINGS.closures.parts.frunk, c: this._closure('frunk', 'open', now) },
      { name: STRINGS.closures.parts.trunk, c: this._closure('trunk', 'open', now) },
      { name: STRINGS.closures.parts.windows, c: this._closure('windows', 'open', now) },
      { name: STRINGS.closures.parts.chargePort, c: this._closure('charge_port', 'open', now) },
      { name: STRINGS.closures.parts.doorFL, c: this._closure('door_fl', 'on', now) },
      { name: STRINGS.closures.parts.doorFR, c: this._closure('door_fr', 'on', now) },
      { name: STRINGS.closures.parts.doorRL, c: this._closure('door_rl', 'on', now) },
      { name: STRINGS.closures.parts.doorRR, c: this._closure('door_rr', 'on', now) },
    ];
    // The sunroof counts toward honesty ONLY when the install has one (entity
    // present): a sunroof we render `unknown` must block a false "All closed",
    // but an absent sunroof on a car without one must not invent doubt.
    const sunroof = readKey(this.hass, this.config, 'sunroof', { now });
    if (sunroof.value !== undefined) {
      items.push({ name: STRINGS.closures.zones.sunroof, c: this._closure('sunroof', 'open', now) });
    }

    const openNames = items.filter((i) => i.c.state === 'open').map((i) => i.name);
    if (openNames.length > 0) {
      const list =
        openNames.length <= 2
          ? openNames.join(' & ')
          : `${openNames.length} ${STRINGS.closures.openWord}`;
      return { text: `${STRINGS.closures.openPrefix}: ${list}`, tone: 'warn' };
    }

    // Nothing open. If any closure is unconfirmable, never claim "All closed".
    if (items.some((i) => i.c.state === 'unknown')) {
      return { text: `${STRINGS.closures.someUnconfirmed} · ${lockWord}`, tone: 'dim' };
    }

    // Every closure is available + closed → the honest "All closed". But reserve
    // the confident GREEN for FRESH reads only: a stale last-known "All closed"
    // keeps the (spec-permitted) text + its staleness stamp, yet must NOT paint a
    // confident green — "a green 'Closed' on stale data" is the named failure
    // (UX-DR18 / EXPERIENCE L101). Any stale closure degrades the tone to dim.
    const anyStale = items.some((i) => i.c.available && i.c.staleness !== 'fresh');
    return {
      text: `${STRINGS.closures.allClosed} · ${lockWord}`,
      tone: !lock.available || anyStale ? 'dim' : lock.value === 'locked' ? 'good' : 'warn',
    };
  }

  /**
   * The visible staleness stamp (AC3 / UX-DR18) — the oldest "updated Nm ago"
   * among any stale-or-unknown closure, or undefined when every read is fresh.
   * Rendered in `--tc-text-dim` (via `.tc-stale-copy`), NEVER `--tc-text-mute`.
   */
  private _staleNote(now: number): string | undefined {
    const keys: [EntityKey, 'open' | 'on'][] = [
      ['frunk', 'open'], ['trunk', 'open'], ['windows', 'open'], ['sunroof', 'open'],
      ['charge_port', 'open'], ['door_fl', 'on'], ['door_fr', 'on'], ['door_rl', 'on'], ['door_rr', 'on'],
    ];
    let oldest: string | undefined;
    for (const [key] of keys) {
      const r = readKey(this.hass, this.config, key, { now });
      if (r.staleness === 'fresh') continue; // only annotate the unconfirmed
      if (!r.lastUpdated) continue;
      if (oldest === undefined || Date.parse(r.lastUpdated) < Date.parse(oldest)) {
        oldest = r.lastUpdated;
      }
    }
    return formatAgeHint(oldest, now);
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const now = referenceNow(this.hass);
    const lock = readKey(this.hass, cfg, 'lock', { now });
    const lockAvail = lock.available;
    const locked = lockAvail && lock.value === 'locked';
    const status = this._statusLine(now);
    const staleNote = this._staleNote(now);
    // Show the sunroof zone whenever the entity is PRESENT (value defined) — even
    // when unavailable it renders `unknown` so the user learns the sensor exists
    // but is unconfirmed (Task 5). Absent from the install → hidden.
    const sunroof = readKey(this.hass, cfg, 'sunroof', { now });
    const showSunroof = sunroof.value !== undefined;
    const lockWord = !lockAvail
      ? STRINGS.closures.lockUnavailable
      : locked
        ? STRINGS.status.locked
        : STRINGS.status.unlocked;

    return html`
      <div class="wrap">
        <section class="surface diagram">
          <svg viewBox="0 0 220 384" class="car" aria-label=${STRINGS.closures.diagramLabel}>
            <!-- wheels -->
            <g class="wheels">
              <rect x="22" y="96" width="16" height="52" rx="8"></rect>
              <rect x="182" y="96" width="16" height="52" rx="8"></rect>
              <rect x="22" y="248" width="16" height="52" rx="8"></rect>
              <rect x="182" y="248" width="16" height="52" rx="8"></rect>
            </g>

            <!-- body -->
            <rect
              class="body"
              x="40" y="24" width="140" height="336" rx="48"
            ></rect>

            <!-- frunk -->
            ${this._zone(
              'frunk',
              CARGO,
              (fill, stroke) =>
                svg`<path d="M52 56 q0 -28 28 -28 h60 q28 0 28 28 v22 h-116 z"
                  style="fill:${fill};stroke:${stroke}"></path>`,
              STRINGS.closures.zones.frunk,
              now
            )}

            <!-- windshield -->
            <polygon class="glasspane" points="62,92 158,92 148,120 72,120"></polygon>

            <!-- cabin / windows -->
            ${this._zone(
              'windows',
              GLASS,
              (fill, stroke) =>
                svg`<rect x="70" y="124" width="80" height="116" rx="12"
                  style="fill:${fill};stroke:${stroke}"></rect>`,
              STRINGS.closures.zones.windows,
              now
            )}
            ${showSunroof
              ? this._zone(
                  'sunroof',
                  GLASS,
                  (fill, stroke) =>
                    svg`<rect x="86" y="140" width="48" height="84" rx="9"
                      style="fill:${fill};stroke:${stroke}"></rect>`,
                  STRINGS.closures.zones.sunroof,
                  now
                )
              : nothing}

            <!-- rear window -->
            <polygon class="glasspane" points="72,244 148,244 158,272 62,272"></polygon>

            <!-- trunk -->
            ${this._zone(
              'trunk',
              CARGO,
              (fill, stroke) =>
                svg`<path d="M52 328 v-22 h116 v22 q0 28 -28 28 h-60 q-28 0 -28 -28 z"
                  style="fill:${fill};stroke:${stroke}"></path>`,
              STRINGS.closures.zones.trunk,
              now
            )}

            <!-- doors (status-only) -->
            ${this._door('door_fl', 42, 128, STRINGS.closures.parts.doorFL, now)}
            ${this._door('door_rl', 42, 186, STRINGS.closures.parts.doorRL, now)}
            ${this._door('door_fr', 158, 128, STRINGS.closures.parts.doorFR, now)}
            ${this._door('door_rr', 158, 186, STRINGS.closures.parts.doorRR, now)}

            <!-- mirrors -->
            <g class="mirror">
              <rect x="32" y="126" width="9" height="13" rx="3"></rect>
              <rect x="179" y="126" width="9" height="13" rx="3"></rect>
            </g>

            <!-- charge port -->
            ${this._zone(
              'charge_port',
              GLASS,
              (fill, stroke) =>
                svg`<circle cx="50" cy="258" r="8"
                  style="fill:${fill};stroke:${stroke}"></circle>`,
              STRINGS.closures.zones.chargePort,
              now
            )}

            <!-- centre lock glyph -->
            <g
              class="zone lock-glyph ${lockAvail ? '' : 'na'}"
              @click=${() => lockAvail && toggleEntity(this.hass!, entityId(cfg, 'lock'))}
              @keydown=${(e: KeyboardEvent) =>
                lockAvail &&
                (e.key === 'Enter' || e.key === ' ') &&
                (e.preventDefault(), toggleEntity(this.hass!, entityId(cfg, 'lock')))}
              role="button"
              tabindex=${lockAvail ? '0' : nothing}
              aria-label=${lockWord}
            >
              <circle
                cx="110" cy="182" r="22"
                style="fill:${!lockAvail
                  ? 'transparent'
                  : locked
                    ? 'color-mix(in srgb, var(--tc-green, #34d399) 22%, transparent)'
                    : 'color-mix(in srgb, var(--tc-amber, #fbbf24) 22%, transparent)'};stroke:${!lockAvail
                  ? 'var(--tc-text-dim, #9aa7b8)'
                  : locked
                    ? 'var(--tc-green, #34d399)'
                    : 'var(--tc-amber, #fbbf24)'}"
              ></circle>
              <path
                transform="translate(98 170) scale(1)"
                d=${locked ? mdiLock : mdiLockOpenVariant}
                style="fill:${!lockAvail
                  ? 'var(--tc-text-dim, #9aa7b8)'
                  : locked
                    ? 'var(--tc-green, #34d399)'
                    : 'var(--tc-amber, #fbbf24)'}"
              ></path>
            </g>
          </svg>

          <div class="status ${status.tone}">${status.text}</div>
          ${staleNote
            ? html`<div class="stale-note tc-stale-copy">${staleNote}</div>`
            : nothing}
        </section>

        <!-- primary lock control -->
        <!-- primary lock control — the visible span IS the state-bearing
             accessible name (neutralised to "Lock unavailable" when unreadable). -->
        <button
          class="bigpill ${locked ? 'locked' : 'unlocked'}"
          ?disabled=${!lockAvail}
          @click=${() => this._toggle('lock')}
        >
          ${icon(locked ? mdiLock : mdiLockOpenVariant, { size: 20 })}
          <span
            >${!lockAvail
              ? STRINGS.closures.lockUnavailable
              : locked
                ? STRINGS.closures.lockedTapToUnlock
                : STRINGS.closures.unlockedTapToLock}</span
          >
        </button>

        <button
          class="bigpill subtle"
          ?disabled=${!this._avail('windows')}
          @click=${() => this._toggle('windows')}
        >
          ${icon(mdiWindowClosedVariant, { size: 19 })}
          <span>${this._open('windows') ? STRINGS.closures.closeWindows : STRINGS.closures.ventWindows}</span>
        </button>

        <p class="hint">${STRINGS.closures.hint}</p>
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
      .diagram {
        padding: 16px 16px 12px;
        border-radius: var(--tc-radius-lg, 22px);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }
      .car {
        width: auto;
        height: 320px;
        max-width: 100%;
        display: block;
      }
      .body {
        fill: var(--tc-surface, rgba(255, 255, 255, 0.045));
        stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        stroke-width: 1.5;
      }
      .wheels rect {
        fill: rgba(0, 0, 0, 0.45);
      }
      .mirror rect {
        fill: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .glasspane {
        fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
        stroke-width: 1;
      }
      /* Only the tappable zones (role=button) are interactive; status-only doors
         (role=img) carry no pointer affordance. */
      .zone[role='button'] {
        cursor: pointer;
      }
      .zone rect,
      .zone path,
      .zone circle,
      .zone polygon {
        stroke-width: 1.6;
        transition: fill 0.2s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), stroke 0.2s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      /* Unknown = neutral indeterminate, NEVER the closed look: dashed dim outline. */
      .zone.unknown :is(rect, path, circle, polygon) {
        stroke-dasharray: 4 4;
      }
      /* Stale = last-known, visibly de-emphasised (confident colour is fresh-only). */
      .zone.stale :is(rect, path, circle, polygon) {
        opacity: 0.6;
      }
      .zone[role='button']:hover :is(rect, path, circle, polygon) {
        filter: brightness(1.35);
      }
      .zone[role='button']:active {
        transform: scale(0.99);
        transform-origin: center;
      }
      /* Visible keyboard focus on the SVG group — an SVG <g> doesn't reliably
         paint the host :focus-visible outline, so mark the inner shape. The 2px
         corpus outline (sharedStyles :focus-visible) still applies on top. */
      .zone[role='button']:focus-visible :is(rect, path, circle, polygon) {
        stroke: var(--tc-blue, #38bdf8);
        stroke-width: 3;
      }
      .zone.na {
        opacity: 0.35;
        pointer-events: none;
      }
      .lock-glyph circle {
        stroke-width: 2;
      }

      .status {
        font-size: 13px;
        font-weight: 650;
      }
      .status.good {
        color: var(--tc-green, #34d399);
      }
      .status.warn {
        color: var(--tc-amber, #fbbf24);
      }
      .status.dim {
        color: var(--tc-text-dim, #9aa7b8);
      }
      /* Honest staleness stamp (UX-DR18) — --tc-text-dim via .tc-stale-copy. */
      .stale-note {
        font-size: 11.5px;
        font-weight: 600;
      }

      .bigpill {
        appearance: none;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        width: 100%;
        padding: 14px;
        border-radius: var(--tc-radius-md, 16px);
        border: 1px solid var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        color: var(--tc-text, #f1f5f9);
        font-size: 14.5px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .bigpill:hover {
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
      }
      .bigpill:active {
        transform: scale(0.99);
      }
      .bigpill[disabled] {
        opacity: 0.4;
        pointer-events: none;
      }
      .bigpill.locked {
        color: var(--tc-green, #34d399);
        border-color: color-mix(in srgb, var(--tc-green, #34d399) 45%, transparent);
        background: color-mix(in srgb, var(--tc-green, #34d399) 14%, transparent);
      }
      .bigpill.unlocked {
        color: var(--tc-amber, #fbbf24);
        border-color: color-mix(in srgb, var(--tc-amber, #fbbf24) 45%, transparent);
        background: color-mix(in srgb, var(--tc-amber, #fbbf24) 14%, transparent);
      }
      .bigpill.subtle {
        font-weight: 650;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .hint {
        margin: 2px 2px 0;
        font-size: 11.5px;
        line-height: 1.4;
        color: var(--tc-text-mute, #64748b);
        text-align: center;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-closures': TcPanelClosures;
  }
}
