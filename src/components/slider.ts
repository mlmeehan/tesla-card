import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles';
import { clamp } from '../helpers';

/**
 * Chunky pointer-draggable bar slider (tablet-friendly). Shows its live value
 * centred inside the bar and fires `value-changed` { value } only on release,
 * so dragging never floods Home Assistant with service calls.
 */
@customElement('tc-slider')
export class TcSlider extends LitElement {
  @property({ type: Number }) public value = 0;
  @property({ type: Number }) public min = 0;
  @property({ type: Number }) public max = 100;
  @property({ type: Number }) public step = 1;
  @property({ type: Boolean }) public disabled = false;
  @property({ type: Number }) public decimals?: number;
  @property() public unit = '';
  @property() public accent = 'var(--tc-blue, #38bdf8)';
  /** State-bearing accessible name (UX-DR21), e.g. "Charge limit". */
  @property() public label = '';

  @state() private _drag?: number;

  private get _dec(): number {
    if (this.decimals !== undefined) return this.decimals;
    return this.step < 1 ? 1 : 0;
  }

  private _pct(v: number): number {
    if (this.max === this.min) return 0;
    return clamp(((v - this.min) / (this.max - this.min)) * 100, 0, 100);
  }

  /** Snap a raw value to the step grid, clamped to [min, max] (drag + keyboard). */
  private _round(raw: number): number {
    const stepped = Math.round(raw / this.step) * this.step;
    return clamp(Number(stepped.toFixed(this._dec)), this.min, this.max);
  }

  private _fromClientX(clientX: number): number {
    const track = this.renderRoot.querySelector('.track') as HTMLElement | null;
    if (!track) return this.value;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return this._round(this.min + ratio * (this.max - this.min));
  }

  private _down = (e: PointerEvent): void => {
    if (this.disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this._drag = this._fromClientX(e.clientX);
  };

  private _move = (e: PointerEvent): void => {
    if (this._drag === undefined) return;
    this._drag = this._fromClientX(e.clientX);
  };

  // The ONE release/commit path — shared by pointer-up/cancel AND keyboard
  // keyup/blur. Holding the lone `value-changed` dispatch here (never in `_move`
  // or `_key`) keeps the commit-on-release contract identical across input modes
  // and the a11y static gate (exactly one dispatch, in `_up`) intact. `e` is
  // `Event` so a KeyboardEvent/FocusEvent can settle the same pending value; the
  // pointer-capture release is wrapped (a no-op / throw for non-pointer events).
  private _up = (e: Event): void => {
    if (this._drag === undefined) return;
    const v = this._drag;
    this._drag = undefined;
    try {
      (e.target as HTMLElement).releasePointerCapture((e as PointerEvent).pointerId);
    } catch {
      /* capture may already be released, or `e` is not a pointer event */
    }
    if (v !== this.value) {
      this.dispatchEvent(
        new CustomEvent('value-changed', {
          detail: { value: v },
          bubbles: true,
          composed: true,
        })
      );
    }
  };

  // Keyboard operability (AC2 / UX-DR21, SC 2.1.1): arrow keys = ±step, Home/End
  // = bounds. Mirrors the drag contract — each keydown moves the DISPLAYED value
  // (`_drag`) live, but the commit waits for `_up` on keyup/blur. NEVER one
  // `value-changed` per keydown: that would flood the metered Fleet API (the whole
  // reason the slider is commit-on-release). Disabled → inert (and not focusable).
  private _key = (e: KeyboardEvent): void => {
    if (this.disabled) return;
    const base = this._drag ?? this.value;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = base + this.step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = base - this.step;
        break;
      case 'Home':
        next = this.min;
        break;
      case 'End':
        next = this.max;
        break;
      default:
        return; // ignore non-slider keys (Tab, etc.) — no preventDefault, no commit
    }
    e.preventDefault();
    this._drag = this._round(next);
  };

  protected override render(): TemplateResult {
    const shown = this._drag ?? this.value;
    const pct = this._pct(shown);
    return html`
      <div
        class="track ${this.disabled ? 'disabled' : ''} ${this._drag !== undefined
          ? 'dragging'
          : ''}"
        style="--accent:${this.accent}"
        @pointerdown=${this._down}
        @pointermove=${this._move}
        @pointerup=${this._up}
        @pointercancel=${this._up}
        @keydown=${this._key}
        @keyup=${this._up}
        @blur=${this._up}
        role="slider"
        tabindex=${this.disabled ? nothing : '0'}
        aria-label=${this.label || nothing}
        aria-valuenow=${shown}
        aria-valuemin=${this.min}
        aria-valuemax=${this.max}
      >
        <div class="fill" style="width:${pct}%"></div>
        <div class="handle" style="left:${pct}%"></div>
        <div class="val">${shown.toFixed(this._dec)}${this.unit}</div>
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        touch-action: none;
      }
      .track {
        position: relative;
        height: 46px;
        border-radius: var(--tc-radius-md, 16px);
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        overflow: hidden;
        cursor: pointer;
        user-select: none;
      }
      .track.disabled {
        opacity: 0.4;
        pointer-events: none;
      }
      .fill {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--accent) 55%, transparent),
          color-mix(in srgb, var(--accent) 82%, transparent)
        );
        transition: width 0.12s linear;
      }
      .track.dragging .fill {
        transition: none;
      }
      /* ~18px circular white thumb (DESIGN.md §Slider / decision-log D9) — the
         legacy 5px sliver was illegible at wall-kiosk distance. Soft shadow +
         hairline ring; the 46px .track stays the hit-area (handle is inert). */
      .handle {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        border: 1px solid var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        pointer-events: none;
        transition: left 0.12s linear;
      }
      .track.dragging .handle {
        transition: none;
      }
      .val {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: 15px;
        font-weight: 700;
        color: var(--tc-text, #f1f5f9);
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
        pointer-events: none;
      }
      /* Reduced motion (NFR-6 / UX-DR23): the fill/thumb ease is decoration that
         tracks the VALUE (keyboard step + hass reconcile). Drag is already instant
         via .track.dragging; this makes the non-drag value change an instant set
         too — "kill the motion, keep the data". No keyframes here, only transitions. */
      @media (prefers-reduced-motion: reduce) {
        .fill,
        .handle {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-slider': TcSlider;
  }
}
