import { css } from 'lit';

/**
 * Design tokens. Set on the main card host; CSS custom properties inherit
 * through shadow-DOM boundaries, so every child component can use them.
 * Literal values double as defaults when rendered outside Home Assistant
 * (e.g. the demo harness).
 */
export const tokens = css`
  :host {
    --tc-font: var(
      --paper-font-body1_-_font-family,
      var(--primary-font-family, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)
    );
    --tc-text: #f1f5f9;
    --tc-text-dim: #9aa7b8;
    --tc-text-mute: #64748b;

    --tc-surface: rgba(255, 255, 255, 0.045);
    --tc-surface-2: rgba(255, 255, 255, 0.07);
    --tc-surface-3: rgba(255, 255, 255, 0.1);
    --tc-border: rgba(255, 255, 255, 0.09);
    --tc-border-strong: rgba(255, 255, 255, 0.16);

    --tc-blue: #38bdf8;
    --tc-green: #34d399;
    --tc-amber: #fbbf24;
    --tc-red: #f87171;
    --tc-purple: #a78bfa;
    --tc-orange: #fb923c;
    --tc-teal: #2dd4bf;

    --tc-radius-xl: 28px;
    --tc-radius-lg: 22px;
    --tc-radius-md: 16px;
    --tc-radius-sm: 12px;
    --tc-pill: 999px;

    --tc-shadow: 0 18px 48px -16px rgba(0, 0, 0, 0.55);
    --tc-shadow-sm: 0 6px 18px -8px rgba(0, 0, 0, 0.5);

    --tc-gap: 16px;
    --tc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  }
`;

export const sharedStyles = css`
  * {
    box-sizing: border-box;
  }
  :host {
    font-family: var(--tc-font);
    color: var(--tc-text);
  }

  /* ── inline SVG icon ───────────────────────────────────────────────── */
  .tc-ico {
    display: inline-block;
    flex: 0 0 auto;
    fill: currentColor;
    vertical-align: middle;
  }

  /* ── section card / surface ────────────────────────────────────────── */
  .surface {
    background: linear-gradient(
      180deg,
      var(--tc-surface-2),
      var(--tc-surface)
    );
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-xl);
    box-shadow: var(--tc-shadow);
  }

  .label {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--tc-text-dim);
    margin: 0;
  }
  .muted {
    color: var(--tc-text-dim);
  }

  /* ── stat tile (icon + label + value) ──────────────────────────────── */
  .stat {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 13px;
    background: var(--tc-surface);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-md);
    min-width: 0;
    transition: border-color 0.18s var(--tc-ease),
      background 0.18s var(--tc-ease), transform 0.18s var(--tc-ease);
  }
  .stat[role='button'] {
    cursor: pointer;
  }
  .stat[role='button']:hover {
    border-color: var(--tc-border-strong);
    background: var(--tc-surface-2);
  }
  .stat[role='button']:active {
    transform: scale(0.98);
  }
  .stat .ico-wrap {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    background: var(--tc-surface-3);
    color: var(--tc-text-dim);
    flex: 0 0 auto;
  }
  .stat .body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .stat .k {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--tc-text-mute);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stat .v {
    font-size: 15px;
    font-weight: 650;
    color: var(--tc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── circular control button ───────────────────────────────────────── */
  .ctrl {
    appearance: none;
    border: 1px solid var(--tc-border);
    background: var(--tc-surface-2);
    color: var(--tc-text-dim);
    border-radius: 50%;
    width: 58px;
    height: 58px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform 0.16s var(--tc-ease), background 0.16s var(--tc-ease),
      border-color 0.16s var(--tc-ease), color 0.16s var(--tc-ease),
      box-shadow 0.16s var(--tc-ease);
  }
  .ctrl:hover {
    border-color: var(--tc-border-strong);
    transform: translateY(-2px);
  }
  .ctrl:active {
    transform: scale(0.93);
  }
  .ctrl.on {
    color: var(--accent, var(--tc-blue));
    border-color: color-mix(in srgb, var(--accent, var(--tc-blue)) 45%, transparent);
    background: color-mix(in srgb, var(--accent, var(--tc-blue)) 16%, transparent);
    box-shadow: 0 0 0 1px
        color-mix(in srgb, var(--accent, var(--tc-blue)) 25%, transparent),
      0 10px 26px -12px color-mix(in srgb, var(--accent, var(--tc-blue)) 70%, transparent);
  }
  .ctrl-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    min-width: 64px;
  }
  .ctrl-name {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--tc-text-dim);
    text-align: center;
    line-height: 1.15;
  }

  /* ── pill chip ─────────────────────────────────────────────────────── */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border-radius: var(--tc-pill);
    background: var(--tc-surface-2);
    border: 1px solid var(--tc-border);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--tc-text-dim);
    white-space: nowrap;
  }

  /* ── grids ─────────────────────────────────────────────────────────── */
  .grid {
    display: grid;
    gap: 10px;
  }
  .g2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .g3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .g4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .divider {
    height: 1px;
    background: var(--tc-border);
    border: 0;
    margin: 2px 0;
  }

  /* ── battery gauge ─────────────────────────────────────────────────── */
  .tc-bat {
    position: relative;
    width: 100%;
    border-radius: var(--tc-pill);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--tc-border);
    overflow: hidden;
  }
  .tc-bat-fill {
    position: relative;
    height: 100%;
    border-radius: var(--tc-pill);
    background: var(--tc-green);
    overflow: hidden;
    transition: width 0.6s var(--tc-ease), background 0.3s var(--tc-ease);
  }
  .tc-bat.low .tc-bat-fill {
    background: var(--tc-red);
  }
  .tc-bat.mid .tc-bat-fill {
    background: var(--tc-amber);
  }
  .tc-bat.high .tc-bat-fill,
  .tc-bat.charging .tc-bat-fill {
    background: var(--tc-green);
  }
  .tc-bat.unknown .tc-bat-fill {
    background: var(--tc-text-mute);
  }
  .tc-bat-limit {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    transform: translateX(-1px);
    background: var(--tc-blue);
    box-shadow: 0 0 6px var(--tc-blue);
    border-radius: 2px;
  }
  .tc-bat.charging .tc-bat-fill::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      100deg,
      transparent 20%,
      rgba(255, 255, 255, 0.5) 50%,
      transparent 80%
    );
    background-size: 220% 100%;
    animation: tc-shimmer 1.6s linear infinite;
  }

  /* ── progress ring ─────────────────────────────────────────────────── */
  .tc-ring {
    position: relative;
    display: grid;
    place-items: center;
  }
  .tc-ring svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .tc-ring .prog {
    transition: stroke-dashoffset 0.8s var(--tc-ease), stroke 0.3s var(--tc-ease);
  }
  .tc-ring svg.charging .prog {
    animation: tc-pulse 1.9s ease-in-out infinite;
  }
  .tc-ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  .tc-ring-label {
    font-size: 30px;
    font-weight: 750;
    color: var(--tc-text);
    line-height: 1;
  }
  .tc-ring-sub {
    font-size: 12px;
    color: var(--tc-text-dim);
    font-weight: 600;
  }

  @keyframes tc-shimmer {
    from {
      background-position: 120% 0;
    }
    to {
      background-position: -120% 0;
    }
  }
  @keyframes tc-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  @media (max-width: 540px) {
    .g4 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .g3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`;
