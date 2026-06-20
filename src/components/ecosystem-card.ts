import { html, css, nothing, type CSSResult, type TemplateResult } from 'lit';
import { TcBase } from '../base';
import { ACCENT_SEMANTICS } from '../styles';

/**
 * Shared ecosystem-card shell (Story 6.1 — the DAG root of Epic 6).
 *
 * Epic 6 grows the bundle from 1 → ~7 registered custom elements (Vehicle +
 * Solar/Powerwall/Grid/Home + Wall Connector + the `tc-my-home` Scene). This
 * module is the shared chrome those cards stand on — it renders NO real entity
 * itself. Concrete ecosystem cards (`tc-solar`/`tc-powerwall`/… in 6.2/6.3)
 * EXTEND {@link EcosystemCard} and compose {@link ecosystemShellStyles}, so each
 * per-card story stays "registry + component only" (architecture Compute
 * boundary).
 *
 * The shell owns three things and nothing else (UX-DR13 / FR-32):
 *  1. CHROME — the single `.surface` elevation primitive at radius `xl` (28px),
 *     carrying a source-node ACCENT as `--node-accent` (the 7-accent vocabulary).
 *  2. FRESHNESS AFFORDANCE — a slot for an honest last-known + staleness stamp
 *     (rendered with `.tc-stale-copy` → `--tc-text-dim`, the 4.5:1 trust-copy
 *     colour, NEVER `--tc-text-mute`) and a calm-empty content fall-through.
 *  3. PRESENCE-TOLERANCE — the surface ALWAYS renders; an absent peer or an
 *     essentially-empty `hass` degrades to a calm neutral surface, never a crash
 *     or a fabricated reading.
 *
 * Cross-card interlink is the shared injected `hass` ONLY (FR-32): the shell
 * exposes no inter-card event bus, no peer-directed `dispatchEvent`, and no
 * shared mutable singleton. Coherence between cards comes solely from reading the
 * same HA entity state. Concrete entity reads route through `data/` (per-card,
 * 6.2/6.3); the shell takes no `data/` edge so the `data/ ← flow/ ← components/`
 * direction stays clean (no-cycle).
 */

/** The 7-accent semantic vocabulary key (DESIGN.md §Colors / `ACCENT_SEMANTICS`). */
export type Accent = keyof typeof ACCENT_SEMANTICS;

/**
 * Shell accent — the 7-accent vocabulary plus a single `'neutral'` sentinel
 * (Story 6.2, Grid-accent option A). The Scene's `NODE_COLOR.grid` is
 * deliberately a NEUTRAL (`var(--tc-text-dim, #9aa7b8)`), NOT one of the 7
 * `ACCENT_SEMANTICS` keys — so the `tc-grid` card can stay faithful to the
 * Scene's grid node, the one neutral exception is centralized here in the shell
 * (no per-card raw hex). Backward-compatible: no existing caller passes
 * `'neutral'`, so every prior {@link Accent} value behaves exactly as before.
 */
export type ShellAccent = Accent | 'neutral';

/** The one neutral source-node colour (mirrors `flow/renderer.ts` `NODE_COLOR.grid`). */
const NEUTRAL_ACCENT = 'var(--tc-text-dim, #9aa7b8)';

/**
 * Resolve a {@link ShellAccent} to a fallback-carrying CSS custom-property read,
 * e.g. `green → "var(--tc-green, #34d399)"`, `neutral → "var(--tc-text-dim,
 * #9aa7b8)"`. Pure + unit-testable, and the ONE place the accent token is
 * composed: no literal accent hex lives in this file — the fallback hex comes
 * from the `ACCENT_SEMANTICS` contract (or the single sanctioned `--tc-text-dim`
 * fallback for `'neutral'`), so the accent-hex gate (styles.test.ts) only ever
 * sees a sanctioned `var(--tc-*, <hex>)` form, never a raw decorative hex.
 */
export function accentVar(accent: ShellAccent): string {
  return accent === 'neutral'
    ? NEUTRAL_ACCENT
    : `var(--tc-${accent}, ${ACCENT_SEMANTICS[accent].hex})`;
}

/** Options for {@link EcosystemCard.renderShell}. Copy/values are the concrete card's job. */
export interface ShellOpts {
  /** Source-node accent — sets `--node-accent` on the surface. Accepts the
   * 7-accent vocabulary plus the single `'neutral'` sentinel (grid node). */
  accent: ShellAccent;
  /** Optional uppercase section label (`.label`). Per-card copy is 6.2/6.3. */
  label?: string | TemplateResult;
  /**
   * Optional honest last-updated stamp, ALREADY formatted via
   * `formatAgeHint`/`keyAgeHint` (e.g. "updated 47m ago"). Rendered with
   * `.tc-stale-copy`. Pass `undefined` for a fresh read — never fabricate one.
   */
  stamp?: string;
  /** State-bearing aria-label for the surface (composed by the concrete card). */
  ariaLabel?: string;
}

export class EcosystemCard extends TcBase {
  /**
   * Render the shared ecosystem chrome: the `.surface` primitive (radius `xl`,
   * gradient + hairline + `--tc-shadow` — all inherited from `sharedStyles`,
   * never re-declared here) carrying the source-node `--node-accent`, an optional
   * header (label + honest staleness stamp), and a content slot.
   *
   * The surface ALWAYS renders (presence-tolerant, AC4); `content` of `nothing`
   * is a calm empty body, never blank/crash/fabricated (AC2). The concrete card
   * decides what (if anything) to show in the body — typically a hide-when-
   * missing `statTile` so an absent entity simply leaves the body empty.
   */
  protected renderShell(
    opts: ShellOpts,
    content: TemplateResult | typeof nothing
  ): TemplateResult {
    const hasHead = opts.label !== undefined || opts.stamp !== undefined;
    return html`
      <section
        class="surface eco-card"
        style=${`--node-accent: ${accentVar(opts.accent)}`}
        aria-label=${opts.ariaLabel ?? nothing}
      >
        ${hasHead
          ? html`<header class="eco-head">
              ${opts.label !== undefined
                ? html`<span class="label">${opts.label}</span>`
                : nothing}
              ${opts.stamp !== undefined
                ? html`<span class="eco-stamp tc-stale-copy">${opts.stamp}</span>`
                : nothing}
            </header>`
          : nothing}
        <div class="eco-body">${content ?? nothing}</div>
      </section>
    `;
  }
}

/**
 * Style primitive for the ecosystem shell — the Lit idiom used by `carStyles`:
 * a concrete card does `static override styles = [sharedStyles,
 * ecosystemShellStyles, css\`…\`]`. Deliberately adds NO elevation recipe of its
 * own (radius/gradient/shadow all come from `.surface` in `sharedStyles`, the
 * single elevation primitive — re-declaring a `border-radius`/180° gradient here
 * would trip the styles gates), only ecosystem-specific layout. Every
 * `var(--tc-*)` carries its DESIGN.md fallback (hard gate).
 */
export const ecosystemShellStyles: CSSResult = css`
  .eco-card {
    /* .surface (sharedStyles) supplies the xl-radius elevation primitive; the
       source-node accent rides as --node-accent for the card's own accents. */
    display: flex;
    flex-direction: column;
    gap: var(--tc-space-3, 12px);
    padding: var(--tc-space-4, 16px);
  }
  .eco-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--tc-space-2, 8px);
  }
  /* Honest last-updated stamp. Colour is pinned by .tc-stale-copy (→
     --tc-text-dim, 4.5:1) in sharedStyles — this only sizes it. */
  .eco-stamp {
    font-size: var(--tc-fs-label, 11.5px);
    font-weight: var(--tc-fw-body, 600);
    white-space: nowrap;
  }
  .eco-body {
    display: flex;
    flex-direction: column;
    gap: var(--tc-space-2, 8px);
    min-width: 0;
  }
  /* Calm, specific empty-state sentence (the concrete cards' AC2 fall-through):
     a quiet trust-copy line, never a blank body or a fabricated "0 kW". */
  .eco-empty {
    margin: 0;
    color: var(--tc-text-dim, #9aa7b8);
    font-size: var(--tc-fs-body, 13.5px);
    font-weight: var(--tc-fw-body, 600);
  }
`;
