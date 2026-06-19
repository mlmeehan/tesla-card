import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
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
import { icon } from '../ui';
import type { EntityKey } from '../const';
import { entityId, rawState, isMissing, isAsleep, pressButton } from '../helpers';

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
  private _press(key: EntityKey): void {
    if (!this.hass) return;
    pressButton(this.hass, entityId(this.config, key));
  }

  protected override render(): TemplateResult {
    // Asleep car → the commands ARE the wake affordances (DESIGN §Command button).
    // Reuse the verbatim-tested STRINGS.hero.tapToWake — a calm, honest hint, not
    // an "Offline" alarm (UX-DR18). Presence change = instant cut, no keyframe.
    const asleep = isAsleep(this.hass, this.config);
    return html`
      <section class="block">
        <span class="label">${STRINGS.commands.title}</span>
        ${asleep
          ? html`<span class="wake-hint">${STRINGS.hero.tapToWake}</span>`
          : nothing}
        <div class="row">
          ${COMMANDS.map((c) => {
            // The `button` domain reads 'unknown' until first pressed / after every
            // HA restart, so degrade ONLY on genuinely-missing/'unavailable' (isMissing)
            // — never on 'unknown' (isUnavailable would wrongly disable wake here).
            const missing = isMissing(rawState(this.hass, this.config, c.key));
            return html`
              <button
                class="cmd"
                ?disabled=${missing}
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

  static override styles = [
    sharedStyles,
    css`
      .block {
        display: flex;
        flex-direction: column;
        gap: 10px;
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
      .wake-hint {
        font-size: var(--tc-fs-stat-key, 11.5px);
        color: var(--tc-text-dim, #9aa7b8);
        margin-top: -4px;
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
