import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  HomeAssistant,
  TeslaCardConfig,
  LovelaceCardEditor,
  PanelId,
} from './types';
import { STRINGS } from './strings';

const PANELS: { id: PanelId; name: string }[] = [
  { id: 'climate', name: STRINGS.tabs.climate },
  { id: 'charging', name: STRINGS.tabs.charging },
  { id: 'closures', name: STRINGS.tabs.closures },
  { id: 'tyres', name: STRINGS.tabs.tyres },
  { id: 'location', name: STRINGS.tabs.location },
  { id: 'media', name: STRINGS.tabs.media },
];

@customElement('tesla-card-editor')
export class TeslaCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config!: TeslaCardConfig;

  public setConfig(config: TeslaCardConfig): void {
    this._config = { ...config };
  }

  private _patch(patch: Partial<TeslaCardConfig>): void {
    this._config = { ...this._config, ...patch };
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _text(e: Event, key: 'name' | 'image'): void {
    const v = (e.target as HTMLInputElement).value.trim();
    const next = { ...this._config };
    if (v) next[key] = v;
    else delete next[key];
    this._patch(next);
  }

  private _bool(key: 'hide_quick_actions' | 'hide_panels' | 'hide_commands', e: Event): void {
    this._patch({ [key]: (e.target as HTMLInputElement).checked });
  }

  protected override render(): TemplateResult {
    if (!this._config) return html``;
    const c = this._config;
    return html`
      <div class="form">
        <label class="field">
          <span>${STRINGS.editor.vehicleName}</span>
          <input
            type="text"
            .value=${c.name ?? ''}
            placeholder=${STRINGS.editor.namePlaceholder}
            @change=${(e: Event) => this._text(e, 'name')}
          />
        </label>

        <label class="field">
          <span>${STRINGS.editor.imageUrl}</span>
          <input
            type="text"
            .value=${c.image ?? ''}
            placeholder=${STRINGS.editor.imagePlaceholder}
            @change=${(e: Event) => this._text(e, 'image')}
          />
        </label>

        <label class="field">
          <span>${STRINGS.editor.defaultPanel}</span>
          <select
            .value=${c.default_panel ?? 'charging'}
            @change=${(e: Event) =>
              this._patch({ default_panel: (e.target as HTMLSelectElement).value as PanelId })}
          >
            ${PANELS.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
          </select>
        </label>

        <label class="check">
          <input
            type="checkbox"
            .checked=${!!c.hide_quick_actions}
            @change=${(e: Event) => this._bool('hide_quick_actions', e)}
          />
          <span>${STRINGS.editor.hideQuickActions}</span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            .checked=${!!c.hide_panels}
            @change=${(e: Event) => this._bool('hide_panels', e)}
          />
          <span>${STRINGS.editor.hidePanels}</span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            .checked=${!!c.hide_commands}
            @change=${(e: Event) => this._bool('hide_commands', e)}
          />
          <span>${STRINGS.editor.hideCommands}</span>
        </label>

        <p class="note">
          ${STRINGS.editor.noteBefore}
          <code>entities:</code> ${STRINGS.editor.noteAfter}
        </p>
      </div>
    `;
  }

  static override styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 4px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color, #e1e1e1);
    }
    input[type='text'],
    select {
      padding: 9px 11px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      background: var(--card-background-color, rgba(127, 127, 127, 0.08));
      color: var(--primary-text-color, inherit);
      font-family: inherit;
      font-size: 14px;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color, #e1e1e1);
      cursor: pointer;
    }
    .check input {
      width: 18px;
      height: 18px;
    }
    .note {
      margin: 4px 0 0;
      font-size: 12px;
      line-height: 1.45;
      color: var(--secondary-text-color, #9aa7b8);
    }
    code {
      font-family: ui-monospace, monospace;
      background: rgba(127, 127, 127, 0.18);
      padding: 1px 5px;
      border-radius: 4px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'tesla-card-editor': TeslaCardEditor;
  }
}
