import { html, css, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
import { STRINGS } from '../strings';
import { icon } from '../ui';
import './slider';
import { stateObj, rawState, attr, isUnavailable, entityId } from '../helpers';
// The per-tap reconcile fence is single-sourced in quick-actions (Story 5.2) —
// reuse the exported constant rather than copy a second magic number (AR-6).
import { RECONCILE_TIMEOUT_MS } from './quick-actions';

@customElement('tc-panel-media')
export class TcPanelMedia extends TcBase {
  /**
   * Optimistic overrides (Story 5.10, AC2) — control-key → requested value, the
   * same proven shape as Story 5.6 climate / 5.2 quick-actions. Only the three
   * controls with a projectable next-state get a slot: `mute` (boolean), `volume`
   * (number 0–100) and `playpause` (boolean). The SIGHTED render reads
   * `optimistic ?? settled` so a tap feels instant; the SCREEN-READER name
   * (`aria-pressed`/`aria-label`) ignores it and always reflects the settled
   * `hass` truth (UX-DR21 — never announce a change that may not have landed). An
   * entry drops when the live state catches up (reconcile IS the feedback) or its
   * per-tap fence expires (honest revert). Prev/next are deliberately absent:
   * skip-track has no projectable state (the next title/artist is unknown until
   * the player reports it), so they stay fire-and-forget — "where applicable".
   */
  @state() private _optimistic: Record<string, boolean | number> = {};

  /** One-shot reconcile-fence timer per pending key (cleared on reconcile/disconnect). */
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // No orphaned reconcile fences once we leave the DOM (UX-DR23).
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
  }

  /**
   * Reconcile on every `hass` tick: when a pending control's LIVE value now
   * equals its optimistic request, the round-trip landed → drop the override.
   * Re-derived from live state, never a tap-time snapshot.
   */
  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has('hass')) return;
    for (const key of Object.keys(this._optimistic)) {
      if (this._liveValue(key) === this._optimistic[key]) this._reconcile(key);
    }
  }

  /** The current settled value for a pending override key. */
  private _liveValue(key: string): boolean | number | undefined {
    switch (key) {
      case 'mute':
        return !!attr(this.hass, this.config, 'media_player', 'is_volume_muted');
      case 'volume': {
        const vl: number | undefined = attr(this.hass, this.config, 'media_player', 'volume_level');
        return vl !== undefined ? Math.round(vl * 100) : undefined;
      }
      case 'playpause':
        return rawState(this.hass, this.config, 'media_player') === 'playing';
      default:
        return undefined;
    }
  }

  /** Typed read of an optimistic override (undefined when none pending — so a
   * stored `false`/`0` survives a `?? settled` fallthrough). */
  private _opt<T extends boolean | number>(key: string): T | undefined {
    return key in this._optimistic ? (this._optimistic[key] as T) : undefined;
  }

  /** Write an optimistic request + arm a fresh single-shot fence for the key. */
  private _arm(key: string, value: boolean | number): void {
    this._optimistic = { ...this._optimistic, [key]: value };
    this._clearTimer(key);
    this._timers.set(key, setTimeout(() => this._reconcile(key), RECONCILE_TIMEOUT_MS));
  }

  /** Drop a pending override + its fence (reconciled or expired → back to truth). */
  private _reconcile(key: string): void {
    this._clearTimer(key);
    if (!(key in this._optimistic)) return;
    const next = { ...this._optimistic };
    delete next[key];
    this._optimistic = next;
  }

  private _clearTimer(key: string): void {
    const t = this._timers.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      this._timers.delete(key);
    }
  }

  /** Empty-state gate — mirrors `render`'s `off` so handlers never arm an override
   * for a control the user cannot see as active. */
  private _off(): boolean {
    const st = rawState(this.hass, this.config, 'media_player');
    const obj = stateObj(this.hass, this.config, 'media_player');
    return isUnavailable(st) || st === 'off' || st === 'idle' || !obj;
  }

  private _call(service: string, data: Record<string, unknown> = {}): void {
    if (!this.hass) return;
    this.hass.callService('media_player', service, {
      entity_id: entityId(this.config, 'media_player'),
      ...data,
    });
  }

  /** Mute toggle — optimistic binary flip; SR announces the settled mute. */
  private _toggleMute(settledMuted: boolean): void {
    if (this._off()) return; // never optimistic when the player is idle
    this._arm('mute', !settledMuted);
    this._call('volume_mute', { is_volume_muted: !settledMuted });
  }

  /** Play/pause — optimistic icon flip; SR announces the settled transport state. */
  private _togglePlay(settledPlaying: boolean): void {
    if (this._off()) return;
    this._arm('playpause', !settledPlaying);
    this._call('media_play_pause');
  }

  /** Volume — hold the requested level until the round-trip lands (no snap-back).
   * Release-only (the tc-slider contract); never per drag tick. */
  private _setVolume(value: number): void {
    if (this._off()) return;
    this._arm('volume', value);
    this._call('volume_set', { volume_level: value / 100 });
  }

  protected override render(): TemplateResult {
    const cfg = this.config;
    const st = rawState(this.hass, cfg, 'media_player');
    const obj = stateObj(this.hass, cfg, 'media_player');
    const off = isUnavailable(st) || st === 'off' || st === 'idle' || !obj;
    const settledPlaying = st === 'playing';
    const playing = this._opt<boolean>('playpause') ?? settledPlaying; // sighted = optimistic

    const title: string = attr(this.hass, cfg, 'media_player', 'media_title') ?? '';
    const artist: string = attr(this.hass, cfg, 'media_player', 'media_artist') ?? '';
    const picture: string | undefined =
      attr(this.hass, cfg, 'media_player', 'entity_picture') ?? undefined;
    const volLevel: number | undefined = attr(this.hass, cfg, 'media_player', 'volume_level');
    const settledMuted: boolean = !!attr(this.hass, cfg, 'media_player', 'is_volume_muted');
    const muted = this._opt<boolean>('mute') ?? settledMuted; // sighted = optimistic
    const vol = volLevel !== undefined ? Math.round(volLevel * 100) : undefined;
    const volShown = this._opt<number>('volume') ?? (vol ?? 0); // hold requested level

    return html`
      <section class="surface media">
        <div class="now">
          <div class="art ${off ? 'idle' : ''}">
            ${picture
              ? html`<img src=${picture} alt="" />`
              : icon(mdiMusicNote, { size: 30 })}
          </div>
          <div class="meta">
            <span class="title">${off ? STRINGS.media.notPlaying : title || STRINGS.media.defaultTitle}</span>
            <span class="artist">${off ? STRINGS.media.idle : artist || '—'}</span>
          </div>
        </div>

        <div class="transport">
          <button
            class="tbtn"
            ?disabled=${off}
            @click=${() => this._call('media_previous_track')}
            aria-label=${STRINGS.media.previous}
          >
            ${icon(mdiSkipPrevious, { size: 28 })}
          </button>
          <button
            class="tbtn play"
            ?disabled=${off}
            @click=${() => this._togglePlay(settledPlaying)}
            aria-label=${settledPlaying ? STRINGS.media.pause : STRINGS.media.play}
          >
            ${icon(playing ? mdiPause : mdiPlay, { size: 32 })}
          </button>
          <button
            class="tbtn"
            ?disabled=${off}
            @click=${() => this._call('media_next_track')}
            aria-label=${STRINGS.media.next}
          >
            ${icon(mdiSkipNext, { size: 28 })}
          </button>
        </div>

        <div class="volume">
          <button
            class="mute ${muted ? 'on' : ''}"
            ?disabled=${off}
            @click=${() => this._toggleMute(settledMuted)}
            aria-pressed=${settledMuted}
            aria-label=${STRINGS.media.mute}
          >
            ${icon(muted ? mdiVolumeOff : mdiVolumeHigh, { size: 20 })}
          </button>
          <tc-slider
            class="vol-slider"
            .value=${volShown}
            .min=${0}
            .max=${100}
            .step=${1}
            unit="%"
            label=${STRINGS.media.volume}
            accent="var(--tc-purple, #a78bfa)"
            ?disabled=${off || vol === undefined}
            @value-changed=${(e: CustomEvent<{ value: number }>) =>
              this._setVolume(e.detail.value)}
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
        /* UX-DR21 ≥44×44 tap floor — the 28px glyph + 6px padding was ~40px. */
        min-width: 44px;
        min-height: 44px;
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
