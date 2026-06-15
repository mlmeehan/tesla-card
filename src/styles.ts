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
    /* Display face: referenced by name only — degrades to the body stack when the
       Plus Jakarta Sans webfont is absent (asset-light bundle: no @import/<link>). */
    --tc-font-display: 'Plus Jakarta Sans',
      var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);

    /* ── type ramp (8 DESIGN.md roles) ───────────────────────────────────
       size (--tc-fs-*) + weight (--tc-fw-*) pairs. Values are the current
       rendered literals (preserved verbatim); names are the DESIGN.md contract.
       Letter-spacing/casing for the two UPPERCASE roles stays inline at the
       call site (.label, .stat .k). */
    --tc-fs-label: 11.5px;
    --tc-fw-label: 700;
    --tc-fs-name: 21px;
    --tc-fw-name: 750;
    --tc-fs-body: 14px;
    --tc-fw-body: 600;
    --tc-fs-stat-key: 11.5px;
    --tc-fw-stat-key: 700;
    --tc-fs-battery: 26px;
    --tc-fw-battery: 760;
    --tc-fs-charging-display: 40px;
    --tc-fw-charging-display: 780;
    --tc-fs-climate-readout: 56px;
    --tc-fw-climate-readout: 760;
    --tc-fs-display: 56px;
    --tc-fw-display: 780;

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

    /* ── spacing scale (4px-based) ──────────────────────────────────────
       --tc-space-4, --tc-gap and the layout "gutter" all resolve to 16px so
       existing layouts stay pixel-exact. Off-scale one-offs (10px/14px) stay
       inline — the scale is not a catch-all. */
    --tc-space-1: 4px;
    --tc-space-2: 8px;
    --tc-space-3: 12px;
    --tc-space-4: 16px;
    --tc-gap: 16px;
    --tc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  }
`;

export const sharedStyles = css`
  * {
    box-sizing: border-box;
  }
  :host {
    font-family: var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    color: var(--tc-text, #f1f5f9);
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
      var(--tc-surface-2, rgba(255, 255, 255, 0.07)),
      var(--tc-surface, rgba(255, 255, 255, 0.045))
    );
    border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
    border-radius: var(--tc-radius-xl, 28px);
    box-shadow: var(--tc-shadow, 0 18px 48px -16px rgba(0, 0, 0, 0.55));
  }

  .label {
    font-size: var(--tc-fs-label, 11.5px);
    font-weight: var(--tc-fw-label, 700);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--tc-text-dim, #9aa7b8);
    margin: 0;
  }
  .muted {
    color: var(--tc-text-dim, #9aa7b8);
  }

  /* ── stat tile (icon + label + value) ──────────────────────────────── */
  .stat {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 13px;
    background: var(--tc-surface, rgba(255, 255, 255, 0.045));
    border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
    border-radius: var(--tc-radius-md, 16px);
    min-width: 0;
    transition: border-color 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
      background 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 0.18s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
  }
  .stat[role='button'] {
    cursor: pointer;
  }
  .stat[role='button']:hover {
    border-color: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
    background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
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
    background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
    color: var(--tc-text-dim, #9aa7b8);
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
    color: var(--tc-text-mute, #64748b);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stat .v {
    font-size: 15px;
    font-weight: 650;
    color: var(--tc-text, #f1f5f9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── circular control button ───────────────────────────────────────── */
  .ctrl {
    appearance: none;
    border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
    background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    color: var(--tc-text-dim, #9aa7b8);
    border-radius: 50%;
    width: 58px;
    height: 58px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
      border-color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
      box-shadow 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
  }
  .ctrl:hover {
    border-color: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
    transform: translateY(-2px);
  }
  .ctrl:active {
    transform: scale(0.93);
  }
  .ctrl.on {
    color: var(--accent, var(--tc-blue, #38bdf8));
    border-color: color-mix(in srgb, var(--accent, var(--tc-blue, #38bdf8)) 45%, transparent);
    background: color-mix(in srgb, var(--accent, var(--tc-blue, #38bdf8)) 16%, transparent);
    box-shadow: 0 0 0 1px
        color-mix(in srgb, var(--accent, var(--tc-blue, #38bdf8)) 25%, transparent),
      0 10px 26px -12px color-mix(in srgb, var(--accent, var(--tc-blue, #38bdf8)) 70%, transparent);
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
    color: var(--tc-text-dim, #9aa7b8);
    text-align: center;
    line-height: 1.15;
  }

  /* ── pill chip ─────────────────────────────────────────────────────── */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border-radius: var(--tc-pill, 999px);
    background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
    font-size: 12.5px;
    font-weight: 600;
    color: var(--tc-text-dim, #9aa7b8);
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
    background: var(--tc-border, rgba(255, 255, 255, 0.09));
    border: 0;
    margin: 2px 0;
  }

  /* ── battery gauge ─────────────────────────────────────────────────── */
  .tc-bat {
    position: relative;
    width: 100%;
    border-radius: var(--tc-pill, 999px);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
    overflow: hidden;
  }
  .tc-bat-fill {
    position: relative;
    height: 100%;
    border-radius: var(--tc-pill, 999px);
    background: var(--tc-green, #34d399);
    overflow: hidden;
    transition: width 0.6s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), background 0.3s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
  }
  .tc-bat.low .tc-bat-fill {
    background: var(--tc-red, #f87171);
  }
  .tc-bat.mid .tc-bat-fill {
    background: var(--tc-amber, #fbbf24);
  }
  .tc-bat.high .tc-bat-fill,
  .tc-bat.charging .tc-bat-fill {
    background: var(--tc-green, #34d399);
  }
  .tc-bat.unknown .tc-bat-fill {
    background: var(--tc-text-mute, #64748b);
  }
  .tc-bat-limit {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    transform: translateX(-1px);
    background: var(--tc-blue, #38bdf8);
    box-shadow: 0 0 6px var(--tc-blue, #38bdf8);
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
    transition: stroke-dashoffset 0.8s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), stroke 0.3s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
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
    color: var(--tc-text, #f1f5f9);
    line-height: 1;
  }
  .tc-ring-sub {
    font-size: 12px;
    color: var(--tc-text-dim, #9aa7b8);
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
