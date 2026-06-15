import { html, css, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import {
  mdiSkipPrevious,
  mdiSkipNext,
  mdiPlay,
  mdiPause,
  mdiVolumeHigh,
  mdiVolumeOff,
  mdiMusicNote,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { icon } from '../ui';
import './slider';
import { stateObj, rawState, attr, isUnavailable, entityId } from '../helpers';

@customElement('tc-panel-media')
export class TcPanelMedia extends TcBase {
  private _call(service: string, data: Record<string, unknown> = {}): void {
    if (!this.hass) return;
    this.hass.callService('media_player', service, {
      entity_id: entityId(this.config, 'media_player'),
      ...data,
    });
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const st = rawState(this.hass, cfg, 'media_player');
    const obj = stateObj(this.hass, cfg, 'media_player');
    const off = isUnavailable(st) || st === 'off' || st === 'idle' || !obj;
    const playing = st === 'playing';

    const title: string = attr(this.hass, cfg, 'media_player', 'media_title') ?? '';
    const artist: string = attr(this.hass, cfg, 'media_player', 'media_artist') ?? '';
    const picture: string | undefined =
      attr(this.hass, cfg, 'media_player', 'entity_picture') ?? undefined;
    const volLevel: number | undefined = attr(this.hass, cfg, 'media_player', 'volume_level');
    const muted: boolean = !!attr(this.hass, cfg, 'media_player', 'is_volume_muted');
    const vol = volLevel !== undefined ? Math.round(volLevel * 100) : undefined;

    return html`
      <section class="surface media">
        <div class="now">
          <div class="art ${off ? 'idle' : ''}">
            ${picture
              ? html`<img src=${picture} alt="" />`
              : icon(mdiMusicNote, { size: 30 })}
          </div>
          <div class="meta">
            <span class="title">${off ? 'Not playing' : title || 'Tesla audio'}</span>
            <span class="artist">${off ? 'Media player idle' : artist || '—'}</span>
          </div>
        </div>

        <div class="transport">
          <button
            class="tbtn"
            ?disabled=${off}
            @click=${() => this._call('media_previous_track')}
            aria-label="Previous"
          >
            ${icon(mdiSkipPrevious, { size: 28 })}
          </button>
          <button
            class="tbtn play"
            ?disabled=${off}
            @click=${() => this._call('media_play_pause')}
            aria-label=${playing ? 'Pause' : 'Play'}
          >
            ${icon(playing ? mdiPause : mdiPlay, { size: 32 })}
          </button>
          <button
            class="tbtn"
            ?disabled=${off}
            @click=${() => this._call('media_next_track')}
            aria-label="Next"
          >
            ${icon(mdiSkipNext, { size: 28 })}
          </button>
        </div>

        <div class="volume">
          <button
            class="mute ${muted ? 'on' : ''}"
            ?disabled=${off}
            @click=${() => this._call('volume_mute', { is_volume_muted: !muted })}
            aria-label="Mute"
          >
            ${icon(muted ? mdiVolumeOff : mdiVolumeHigh, { size: 20 })}
          </button>
          <tc-slider
            class="vol-slider"
            .value=${vol ?? 0}
            .min=${0}
            .max=${100}
            .step=${1}
            unit="%"
            accent="var(--tc-purple, #a78bfa)"
            ?disabled=${off || vol === undefined}
            @value-changed=${(e: CustomEvent<{ value: number }>) =>
              this._call('volume_set', { volume_level: e.detail.value / 100 })}
          ></tc-slider>
        </div>
      </section>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      .media {
        padding: 18px;
        border-radius: var(--tc-radius-lg, 22px);
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .now {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }
      .art {
        flex: 0 0 auto;
        width: 64px;
        height: 64px;
        border-radius: var(--tc-radius-md, 16px);
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
        display: grid;
        place-items: center;
        color: var(--tc-text-dim, #9aa7b8);
        overflow: hidden;
      }
      .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .art.idle {
        opacity: 0.6;
      }
      .meta {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        color: var(--tc-text, #f1f5f9);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .artist {
        font-size: 13px;
        color: var(--tc-text-dim, #9aa7b8);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .transport {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 22px;
      }
      .tbtn {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--tc-text, #f1f5f9);
        cursor: pointer;
        display: grid;
        place-items: center;
        padding: 6px;
        border-radius: 50%;
        transition: transform 0.12s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .tbtn:hover {
        color: var(--tc-text, #f1f5f9);
      }
      .tbtn:active {
        transform: scale(0.9);
      }
      .tbtn[disabled] {
        opacity: 0.35;
        pointer-events: none;
      }
      .tbtn.play {
        width: 64px;
        height: 64px;
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
        border: 1px solid var(--tc-border-strong, rgba(255, 255, 255, 0.16));
      }
      .tbtn.play:hover {
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
      }

      .volume {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .vol-slider {
        flex: 1 1 auto;
      }
      .mute {
        appearance: none;
        flex: 0 0 auto;
        width: 46px;
        height: 46px;
        border-radius: 50%;
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        color: var(--tc-text-dim, #9aa7b8);
        display: grid;
        place-items: center;
        cursor: pointer;
        transition: color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), border-color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .mute.on {
        color: var(--tc-red, #f87171);
        border-color: color-mix(in srgb, var(--tc-red, #f87171) 45%, transparent);
      }
      .mute[disabled] {
        opacity: 0.35;
        pointer-events: none;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-media': TcPanelMedia;
  }
}
