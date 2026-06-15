import { LitElement, html, css, type TemplateResult } from 'lit';
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

  @state() private _drag?: number;

  private get _dec(): number {
    if (this.decimals !== undefined) return this.decimals;
    return this.step < 1 ? 1 : 0;
  }

  private _pct(v: number): number {
    if (this.max === this.min) return 0;
    return clamp(((v - this.min) / (this.max - this.min)) * 100, 0, 100);
  }

  private _fromClientX(clientX: number): number {
    const track = this.renderRoot.querySelector('.track') as HTMLElement | null;
    if (!track) return this.value;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const raw = this.min + ratio * (this.max - this.min);
    const stepped = Math.round(raw / this.step) * this.step;
    return clamp(Number(stepped.toFixed(this._dec)), this.min, this.max);
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

  private _up = (e: PointerEvent): void => {
    if (this._drag === undefined) return;
    const v = this._drag;
    this._drag = undefined;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
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
        role="slider"
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
      .handle {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 5px;
        height: 26px;
        border-radius: 3px;
        background: #fff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
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
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-slider': TcSlider;
  }
}
