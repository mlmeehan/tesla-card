import { html, css, nothing, type CSSResult, type TemplateResult } from 'lit';
import { mdiOpenInNew } from '@mdi/js';
import { TcBase } from '../base';
import { ACCENT_SEMANTICS } from '../styles';
import { STRINGS } from '../strings';
import { icon } from '../ui';
import { fireEvent } from '../helpers';

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

/**
 * Options for {@link EcosystemCard.renderDetail} — the Story 8.1 full detail
 * layout. Extends {@link ShellOpts} (accent/label/stamp/ariaLabel) with the three
 * detail-only affordances. Type-only (compiler-erased): adding it does NOT widen
 * the module's runtime export surface (FR-32 — the shell exposes only
 * EcosystemCard/accentVar/ecosystemShellStyles at runtime).
 */
export interface DetailOpts extends ShellOpts {
  /**
   * Read-vs-control honesty (UX-DR24 / AC3). `'sensor'` cards (Solar/Grid/Home/
   * Wall-Connector — and Powerwall until its controls land in 8.4) present
   * telemetry + the deep-link ONLY, and the header carries a "Sensor" mark.
   */
  kind?: 'sensor' | 'control';
  /** Status-dot state: live (accent), idle (at rest / sub-deadband), stale (old data). */
  state?: 'live' | 'idle' | 'stale';
  /** Optional short sub-status beside the label (e.g. the card's direction word). */
  subStatus?: string;
}

/**
 * Content slots for {@link EcosystemCard.renderDetail}. Every slot is optional and
 * hide-when-missing by construction: an absent hero/readout simply omits its row,
 * and `tiles` are `statTile` results that each return `nothing` when their entity
 * is missing — so a minimal install renders a calm, sparse-but-correct card.
 */
export interface DetailParts {
  /** Hero-art slot (Solar's weather vignette today; an empty placeholder otherwise — 8.2 fills it). */
  hero?: TemplateResult | typeof nothing;
  /** Lead readout row — the card's headline value (kW / SoC ring / direction tile). */
  readout?: TemplateResult | typeof nothing;
  /**
   * Write-control slot (Story 8.4) — Powerwall's segmented operation-mode +
   * backup-reserve `tc-slider`, rendered in a `.eco-controls` region AFTER the
   * lead readout and BEFORE the stat grid (mockup order: SoC readout → controls →
   * stat grid → charts). Hide-when-empty by construction (`nothing` → the region
   * collapses). Additive to the live path only — the calm-empty `renderShell`
   * path is untouched (AC3). The control chrome lives in the concrete card's own
   * `css` (powerwall.ts); the shell owns only the layout order + stacking. The
   * field is type-only (compiler-erased) → invisible to the FR-32 export-list gate
   * exactly as 8.1's `tiles`/8.3's `charts` were.
   */
  controls?: TemplateResult | typeof nothing;
  /** Stat-grid tiles (`.grid.g3`); each `statTile` hides itself (`nothing`) when its entity is absent. */
  tiles?: Array<TemplateResult | typeof nothing>;
  /**
   * Inline history charts (Story 8.3) — `sparkline`/`dayBars` results from
   * `components/chart.ts`, rendered in a `.eco-charts` region AFTER the stat grid
   * and BEFORE the deep-link chip. Hide-when-empty by construction (a chart whose
   * series is absent returns its own calm empty state, or the card passes nothing
   * for a chart it can't source). Additive to the live path only — the calm-empty
   * `renderShell` path is untouched (AC5).
   */
  charts?: Array<TemplateResult | typeof nothing>;
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

  /**
   * Render the Story 8.1 full DETAIL layout inside the shared `.surface`: a status
   * header (state dot + label + optional sub-status + honest Sensor mark + stamp),
   * a hero-art slot, an optional lead readout row, a `.grid.g3` stat-grid region
   * (reusing the existing responsive grid — it already collapses to 2 columns
   * ≤540px via `BREAKPOINTS.compact`, so NO new breakpoint is authored), and a
   * dashed deep-link chip to HA's built-in Energy dashboard.
   *
   * This is ADDITIVE to the live path only (AC4): the calm-empty path keeps
   * calling {@link renderShell} unchanged, so Epic-6 presence-tolerance is intact.
   * Every slot is hide-when-missing, so a minimal install reads calm and sparse.
   */
  protected renderDetail(opts: DetailOpts, parts: DetailParts): TemplateResult {
    const tiles = parts.tiles ?? [];
    const hasTiles = tiles.some((t) => t !== nothing);
    const hasReadout = parts.readout !== undefined && parts.readout !== nothing;
    const charts = parts.charts ?? [];
    const hasCharts = charts.some((c) => c !== nothing);
    const hasControls = parts.controls !== undefined && parts.controls !== nothing;
    return html`
      <section
        class="surface eco-card eco-detail"
        style=${`--node-accent: ${accentVar(opts.accent)}`}
        aria-label=${opts.ariaLabel ?? nothing}
      >
        <header class="eco-status">
          <span class="eco-dot ${opts.state ?? 'live'}" aria-hidden="true"></span>
          ${opts.label !== undefined ? html`<span class="label">${opts.label}</span>` : nothing}
          ${opts.subStatus !== undefined
            ? html`<span class="eco-sub">${opts.subStatus}</span>`
            : nothing}
          <span class="eco-spacer"></span>
          ${opts.kind === 'sensor'
            ? html`<span class="eco-kind">${STRINGS.ecosystem.sensorTag}</span>`
            : nothing}
          ${opts.stamp !== undefined
            ? html`<span class="eco-stamp tc-stale-copy">${opts.stamp}</span>`
            : nothing}
        </header>
        <div class="eco-hero">${parts.hero ?? nothing}</div>
        ${hasReadout ? html`<div class="eco-readout">${parts.readout}</div>` : nothing}
        ${hasControls ? html`<div class="eco-controls">${parts.controls}</div>` : nothing}
        ${hasTiles ? html`<div class="grid g3 eco-grid">${tiles}</div>` : nothing}
        ${hasCharts ? html`<div class="eco-charts">${charts}</div>` : nothing}
        ${this._deepLinkChip()}
      </section>
    `;
  }

  /**
   * The dashed deep-link chip → HA's built-in Energy dashboard (`/energy`). A real
   * keyboard-operable button (`role="button"`, `tabindex="0"`, Enter/Space) with a
   * ≥44×44 hit area and a state-bearing aria-label. Lives on the live detail layout
   * only (never the calm empty state — AC4). Copy is centralized in `STRINGS`.
   */
  private _deepLinkChip(): TemplateResult {
    return html`<div class="eco-deeplink-row">
      <span
        class="eco-deeplink"
        role="button"
        tabindex="0"
        aria-label=${STRINGS.ecosystem.deepLink}
        @click=${(e: Event) => this._openEnergy(e)}
        @keydown=${(e: KeyboardEvent) => this._onDeepLinkKey(e)}
      >
        ${icon(mdiOpenInNew, { size: 16 })}
        <span class="eco-deeplink-t">${STRINGS.ecosystem.deepLink}</span>
      </span>
    </div>`;
  }

  /**
   * Navigate to `/energy` the HA-standard way: push the route, then let the
   * `<home-assistant>` root pick it up via `location-changed` (bubbles + composed,
   * supplied by `fireEvent`). Deliberately NOT `<a href>`/`location.href` — those
   * trigger a full page reload.
   */
  private _openEnergy(e: Event): void {
    e.preventDefault();
    history.pushState(null, '', '/energy');
    fireEvent(this, 'location-changed', { replace: false });
  }

  /** Keyboard activation for the deep-link chip: Enter or Space (Space prevented to avoid scroll). */
  private _onDeepLinkKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this._openEnergy(e);
    }
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

  /* ── Story 8.1 detail layout (LAYOUT ONLY — the rounded primitives .eco-dot/
     .eco-kind/.eco-deeplink live in styles.ts sharedStyles, since the shell
     declares no rounding/elevation recipe of its own; those belong to .surface).
     The detail layout is additive to the live path only (AC4). ── */
  .eco-status {
    display: flex;
    align-items: center;
    gap: var(--tc-space-2, 8px);
  }
  /* Pushes the Sensor mark + staleness stamp to the trailing edge. */
  .eco-spacer {
    flex: 1 1 auto;
  }
  .eco-sub {
    color: var(--tc-text-dim, #9aa7b8);
    font-size: var(--tc-fs-label, 11.5px);
    font-weight: var(--tc-fw-body, 600);
  }
  /* Hero-art slot — an empty placeholder this story (8.2 fills it). Collapses to
     zero height when empty so a minimal card stays compact; Solar passes its
     weather vignette here. */
  .eco-hero:empty {
    display: none;
  }
  .eco-readout {
    display: flex;
    flex-direction: column;
    gap: var(--tc-space-2, 8px);
    min-width: 0;
  }
  /* Story 8.4 write-controls region (Powerwall mode + reserve) — stacking +
     rhythm ONLY. The control chrome (segmented buttons, reserve block) lives in
     the concrete card's own css (powerwall.ts), the way quick-actions/panel-
     climate own theirs. NO radius/elevation/gradient here (those belong to
     .surface — re-declaring them trips the styles gates). Collapses when empty. */
  .eco-controls {
    display: flex;
    flex-direction: column;
    gap: var(--tc-space-3, 12px);
  }
  .eco-controls:empty {
    display: none;
  }
  /* Stat-grid region uses the shared responsive .grid.g3 (collapses to 2-col
     ≤540px via BREAKPOINTS.compact) — only the vertical rhythm is set here. */
  .eco-grid {
    margin-top: var(--tc-space-1, 4px);
  }
  /* Story 8.3 inline-charts region — stacking + rhythm ONLY (the .chart panel's
     own surface/radius live in chartStyles, a nested panel, NOT the .surface
     elevation recipe). Collapses to nothing when no chart resolves. */
  .eco-charts {
    display: flex;
    flex-direction: column;
    gap: var(--tc-space-3, 12px);
  }
  .eco-charts:empty {
    display: none;
  }
  .eco-deeplink-row {
    display: flex;
    justify-content: flex-start;
  }
`;
