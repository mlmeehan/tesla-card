import { html, css, type TemplateResult } from 'lit';
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
import { entityId, rawState, isUnavailable, pressButton } from '../helpers';

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
    return html`
      <section class="block">
        <span class="label">${STRINGS.commands.title}</span>
        <div class="row">
          ${COMMANDS.map((c) => {
            const unavailable = isUnavailable(rawState(this.hass, this.config, c.key));
            return html`
              <button
                class="cmd"
                ?disabled=${unavailable}
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
        font-size: 11.5px;
        font-weight: 650;
        cursor: pointer;
        transition: background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          border-color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
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
