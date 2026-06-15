import { html, css, svg, nothing, type TemplateResult, type SVGTemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { mdiLock, mdiLockOpenVariant, mdiWindowClosedVariant } from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { icon } from '../ui';
import {
  rawState,
  isUnavailable,
  entityId,
  toggleEntity,
  moreInfo,
} from '../helpers';
import type { EntityKey } from '../const';

const DOOR = 'var(--tc-red, #f87171)';
const CARGO = 'var(--tc-amber, #fbbf24)';
const GLASS = 'var(--tc-blue, #38bdf8)';

@customElement('tc-panel-closures')
export class TcPanelClosures extends TcBase {
  private _open(key: EntityKey): boolean {
    return rawState(this.hass, this.config, key) === 'open';
  }
  private _doorOpen(key: EntityKey): boolean {
    return rawState(this.hass, this.config, key) === 'on';
  }
  private _avail(key: EntityKey): boolean {
    return !isUnavailable(rawState(this.hass, this.config, key));
  }
  private _toggle(key: EntityKey): void {
    if (!this.hass || !this._avail(key)) return;
    toggleEntity(this.hass, entityId(this.config, key));
  }
  private _info(key: EntityKey): void {
    if (!this.hass) return;
    moreInfo(this, entityId(this.config, key));
  }

  private _fill(open: boolean, color: string): string {
    return open ? `color-mix(in srgb, ${color} 34%, transparent)` : 'var(--tc-surface-2, rgba(255, 255, 255, 0.07))';
  }
  private _stroke(open: boolean, color: string): string {
    return open ? color : 'var(--tc-border-strong, rgba(255, 255, 255, 0.16))';
  }

  /** A tappable cover zone (frunk / trunk / windows / charge port). */
  private _zone(
    key: EntityKey,
    color: string,
    shape: (fill: string, stroke: string) => SVGTemplateResult,
    label: string
  ): SVGTemplateResult {
    const open = this._open(key);
    const avail = this._avail(key);
    return svg`<g
      class="zone ${avail ? '' : 'na'}"
      @click=${() => this._toggle(key)}
      role="button"
      aria-label=${`${label} ${open ? 'open' : 'closed'}`}
    >${shape(this._fill(open, color), this._stroke(open, color))}</g>`;
  }

  /** A door indicator (read-only binary sensor). */
  private _door(key: EntityKey, x: number, y: number): SVGTemplateResult {
    const open = this._doorOpen(key);
    return svg`<rect
      class="zone door"
      @click=${() => this._info(key)}
      x=${x} y=${y} width="20" height="52" rx="7"
      style="fill:${this._fill(open, DOOR)};stroke:${this._stroke(open, DOOR)}"
    ></rect>`;
  }

  private _statusLine(): { text: string; tone: string } {
    const locked = rawState(this.hass, this.config, 'lock') === 'locked';
    const openNames: string[] = [];
    if (this._open('frunk')) openNames.push('frunk');
    if (this._open('trunk')) openNames.push('trunk');
    if (this._open('windows')) openNames.push('windows');
    if (this._open('charge_port')) openNames.push('charge port');
    (
      [
        ['door_fl', 'front-left door'],
        ['door_fr', 'front-right door'],
        ['door_rl', 'rear-left door'],
        ['door_rr', 'rear-right door'],
      ] as [EntityKey, string][]
    ).forEach(([k, n]) => this._doorOpen(k) && openNames.push(n));

    if (openNames.length === 0) {
      return {
        text: locked ? 'All closed · Locked' : 'All closed · Unlocked',
        tone: locked ? 'good' : 'warn',
      };
    }
    const list =
      openNames.length <= 2
        ? openNames.join(' & ')
        : `${openNames.length} open`;
    return { text: `Open: ${list}`, tone: 'warn' };
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const locked = rawState(this.hass, cfg, 'lock') === 'locked';
    const lockAvail = !isUnavailable(rawState(this.hass, cfg, 'lock'));
    const status = this._statusLine();
    const sunroofAvail = this._avail('sunroof');

    return html`
      <div class="wrap">
        <section class="surface diagram">
          <svg viewBox="0 0 220 384" class="car" aria-label="Vehicle closures">
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
              'Frunk'
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
              'Windows'
            )}
            ${sunroofAvail
              ? this._zone(
                  'sunroof',
                  GLASS,
                  (fill, stroke) =>
                    svg`<rect x="86" y="140" width="48" height="84" rx="9"
                      style="fill:${fill};stroke:${stroke}"></rect>`,
                  'Sunroof'
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
              'Trunk'
            )}

            <!-- doors -->
            ${this._door('door_fl', 42, 128)}
            ${this._door('door_rl', 42, 186)}
            ${this._door('door_fr', 158, 128)}
            ${this._door('door_rr', 158, 186)}

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
              'Charge port'
            )}

            <!-- centre lock glyph -->
            <g
              class="zone lock-glyph ${lockAvail ? '' : 'na'}"
              @click=${() => lockAvail && toggleEntity(this.hass!, entityId(cfg, 'lock'))}
              role="button"
              aria-label=${locked ? 'Locked' : 'Unlocked'}
            >
              <circle
                cx="110" cy="182" r="22"
                style="fill:${locked
                  ? 'color-mix(in srgb, var(--tc-green, #34d399) 22%, transparent)'
                  : 'color-mix(in srgb, var(--tc-amber, #fbbf24) 22%, transparent)'};stroke:${locked
                  ? 'var(--tc-green, #34d399)'
                  : 'var(--tc-amber, #fbbf24)'}"
              ></circle>
              <path
                transform="translate(98 170) scale(1)"
                d=${locked ? mdiLock : mdiLockOpenVariant}
                style="fill:${locked ? 'var(--tc-green, #34d399)' : 'var(--tc-amber, #fbbf24)'}"
              ></path>
            </g>
          </svg>

          <div class="status ${status.tone}">${status.text}</div>
        </section>

        <!-- primary lock control -->
        <button
          class="bigpill ${locked ? 'locked' : 'unlocked'}"
          ?disabled=${!lockAvail}
          @click=${() => this._toggle('lock')}
        >
          ${icon(locked ? mdiLock : mdiLockOpenVariant, { size: 20 })}
          <span>${locked ? 'Locked — tap to unlock' : 'Unlocked — tap to lock'}</span>
        </button>

        <button
          class="bigpill subtle"
          ?disabled=${!this._avail('windows')}
          @click=${() => this._toggle('windows')}
        >
          ${icon(mdiWindowClosedVariant, { size: 19 })}
          <span>${this._open('windows') ? 'Close windows' : 'Vent windows'}</span>
        </button>

        <p class="hint">Tap the frunk, trunk, windows or charge port on the diagram to open or close. Doors are status-only.</p>
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
      .zone {
        cursor: pointer;
      }
      .zone[role='button'],
      .zone.door {
        cursor: pointer;
      }
      .zone rect,
      .zone path,
      .zone circle,
      .zone polygon {
        stroke-width: 1.6;
        transition: fill 0.2s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), stroke 0.2s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .zone:hover :is(rect, path, circle, polygon) {
        filter: brightness(1.35);
      }
      .zone:active {
        transform: scale(0.99);
        transform-origin: center;
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
