import { html, svg, css, type CSSResult, type SVGTemplateResult, type TemplateResult } from 'lit';
import { mdiLightningBolt, mdiPowerPlug } from '@mdi/js';
import { STRINGS } from '../strings';

/**
 * `nodeHero` — hand-rolled inline-SVG hero illustrations for the ecosystem cards
 * (Story 8.2, Epic 8). This is a RENDER HELPER (the `carView()`/`weatherVignette()`
 * pattern: a pure render function + a `CSSResult` styles export), **NOT** a `tc-*`
 * custom element — it registers nothing and is imported only by the cards that
 * compose it. It fills the empty `.eco-hero` slot that Story 8.1 created in
 * `EcosystemCard.renderDetail`, so the Scene reads at a glance like the mockup —
 * a Powerwall stack, a grid pylon, a house, a wall connector — not just numbers.
 *
 * DECORATIVE, NEVER TELEMETRY (AC4). The real numbers are the readout + tiles
 * (Story 8.1); the art carries no live value and must never imply a state it
 * doesn't have. Every fill height / accent here is a FIXED decorative level — the
 * Powerwall "charge" rect is a static mid-fill, not a fabricated SoC. The art
 * lives ONLY on the live `renderDetail` path; the Epic-6 calm-empty `.eco-empty`
 * path (`renderShell`) is untouched.
 *
 * TOKEN-DRIVEN, NO RASTER, NO TRADE DRESS (AC2 / NFR-2 / AR-12). Every colour is
 * a `var(--tc-*, <DESIGN.md fallback>)` driven from `nodeHeroStyles` CSS classes
 * (the weather-vignette idiom — SVG presentation attributes can't read `var()`,
 * so colour lives in CSS, geometry in the template). There is no raster asset, no
 * `<img>`/`href`, no Tesla badge or vehicle render — just inline Lit `svg`` `.
 * The only inner glyphs are `@mdi/js` paths embedded directly (never a sprite
 * `<use href>`). Imports stay within the allowlist (`lit` + `@mdi/js` + strings).
 *
 * Solar is NOT here: it reuses its existing `weatherVignette` hero (Story 6.4) —
 * no duplicate Solar art.
 *
 * Geometry ported from the decided mockup (`myhome-cards-bus.html`: Powerwall
 * 441–453, Grid pylon 514–526, House 590–599, Wall Connector 672–680); the
 * mockup's raw hex + `<use href="#i-…">` sprite refs are mockup-only — converted
 * to tokens + embedded mdi paths here. The DESIGN/EXPERIENCE spine outranks the
 * mockup on conflict. All heroes share `viewBox="0 0 300 138"` (the mockup hero
 * coordinate space).
 */

/** The four nodes that get a hand-rolled hero (Solar reuses its weather vignette). */
export type NodeHeroKind = 'powerwall' | 'grid' | 'home' | 'wall_connector';

/** Map a node to its existing centralized display name (no new strings — reuses `energy.nodes`). */
const NODE_LABEL: Record<NodeHeroKind, string> = {
  powerwall: STRINGS.energy.nodes.powerwall,
  grid: STRINGS.energy.nodes.grid,
  home: STRINGS.energy.nodes.home,
  wall_connector: STRINGS.energy.nodes.wall_connector,
};

/** Embed an `@mdi/js` 24×24 path as a positioned glyph (never a sprite `<use href>`). */
function glyph(path: string, cls: string, tx: number, ty: number, scale: number): SVGTemplateResult {
  return svg`<path class=${cls} transform=${`translate(${tx} ${ty}) scale(${scale})`} d=${path} />`;
}

/**
 * Powerwall → a battery stack: a back unit + a taller front unit showing a FIXED
 * decorative charge fill (never a fabricated SoC) and an accent edge bar, with a
 * lightning glyph. Accent: green.
 */
function powerwallHero(): SVGTemplateResult {
  return svg`
    <ellipse class="nh-shadow" cx="153" cy="129" rx="74" ry="6" />
    <rect class="nh-face-2" x="94" y="24" width="56" height="100" rx="9" />
    <rect class="nh-face" x="150" y="18" width="62" height="106" rx="10" />
    <!-- Decorative fixed mid charge level — NOT live SoC (AC4 honesty). -->
    <rect class="nh-pw-fill" x="156" y="72" width="50" height="46" rx="6" />
    <rect class="nh-pw-edge" x="150" y="18" width="4" height="106" rx="2" />
    ${glyph(mdiLightningBolt, 'nh-glyph-green', 167, 32, 1.18)}
  `;
}

/**
 * Grid → a transmission pylon: two splayed legs with cross-bracing, two
 * insulator crossarms with dots, and two curved live lines. Accent: neutral
 * (`--tc-text-dim` — the Scene's `NODE_COLOR.grid`, NOT one of the 7 accents).
 */
function gridHero(): SVGTemplateResult {
  return svg`
    <ellipse class="nh-shadow" cx="150" cy="129" rx="58" ry="6" />
    <path class="nh-strut" d="M150 12 L150 24" />
    <path class="nh-strut" d="M124 124 L150 24 L176 124" />
    <path class="nh-strut" d="M137 74 L163 74 M133 96 L167 96" />
    <path class="nh-strut" d="M137 74 L163 96 M163 74 L137 96 M141 52 L159 74 M159 52 L141 74" />
    <path class="nh-line" d="M104 44 L196 44 M114 60 L186 60" />
    <circle class="nh-dot" cx="104" cy="44" r="3.2" />
    <circle class="nh-dot" cx="196" cy="44" r="3.2" />
    <circle class="nh-dot" cx="114" cy="60" r="3" />
    <circle class="nh-dot" cx="186" cy="60" r="3" />
    <path class="nh-line nh-cable" d="M104 44 C 72 70, 60 102, 70 126" />
    <path class="nh-line nh-cable" d="M196 44 C 228 70, 240 102, 230 126" />
    ${glyph(mdiLightningBolt, 'nh-glyph-neutral', 141, 28, 0.78)}
  `;
}

/**
 * Home → a house: pitched roof + body with two lit (amber) windows and a door,
 * plus a small lightning glyph in the gable. Lead accent blue; the warm-amber
 * windows are the mockup's intentional "lights-on" cue (tokenized).
 */
function homeHero(): SVGTemplateResult {
  return svg`
    <ellipse class="nh-shadow" cx="150" cy="127" rx="72" ry="6" />
    <path class="nh-roof" d="M80 66 L150 26 L220 66 Z" />
    <rect class="nh-house-body" x="98" y="66" width="104" height="56" rx="4" />
    <rect class="nh-window" x="112" y="80" width="22" height="20" rx="3" />
    <rect class="nh-window" x="166" y="80" width="22" height="20" rx="3" />
    <rect class="nh-door" x="140" y="92" width="20" height="30" rx="2" />
    ${glyph(mdiLightningBolt, 'nh-glyph-amber', 142, 40, 0.7)}
  `;
}

/**
 * Wall Connector → the wall unit with a pulsing status dot (gated under
 * reduced-motion, AC3), a power-plug glyph, and a curved cable ending in a
 * connector. Accent: teal (charge handle/cable), green status dot.
 */
function wallConnectorHero(): SVGTemplateResult {
  return svg`
    <ellipse class="nh-shadow" cx="150" cy="129" rx="56" ry="6" />
    <rect class="nh-wc-face" x="108" y="14" width="84" height="92" rx="13" />
    <circle class="nh-wc-dot" cx="150" cy="34" r="4.5" />
    ${glyph(mdiPowerPlug, 'nh-glyph-teal', 137, 48, 1.1)}
    <path class="nh-wc-cable" d="M150 106 C 150 122, 196 116, 204 126" />
    <circle class="nh-wc-conn" cx="206" cy="128" r="5" />
  `;
}

const BODY: Record<NodeHeroKind, () => SVGTemplateResult> = {
  powerwall: powerwallHero,
  grid: gridHero,
  home: homeHero,
  wall_connector: wallConnectorHero,
};

/**
 * Render the hand-rolled hero illustration for an ecosystem `node`. Pure function
 * of its single input (no `hass`, no DOM — mirroring `weatherVignette`/`carView`).
 * The art is decorative (`role="img"` + a concise, node-name `aria-label` reusing
 * `STRINGS.energy.nodes.*` — never a live value), so screen-reader users get the
 * telemetry from the readout/tiles + the header's state-bearing label, not here.
 */
export function nodeHero(node: NodeHeroKind): TemplateResult {
  return html`
    <svg class="nh-art" viewBox="0 0 300 138" role="img" aria-label=${NODE_LABEL[node]}>
      ${BODY[node]()}
    </svg>
  `;
}

/**
 * Component-local styles for the node heroes — composed by each card via
 * `static override styles = [sharedStyles, ecosystemShellStyles, nodeHeroStyles]`
 * (the `carStyles`/`weatherVignetteStyles` idiom). Colour lives HERE (not in SVG
 * presentation attributes, which can't read `var()`); every `var(--tc-*)` carries
 * its DESIGN.md fallback (hard gate) and only REAL tokens from `styles.ts` are
 * used. Structural neutrals map to `--tc-surface-2`/`--tc-border-strong`/
 * `--tc-text-dim`; node accents to the card's accent token.
 *
 * AC3 reduced-motion: the closing `@media (prefers-reduced-motion: reduce)` block
 * FREEZES the only motion (the WC status-dot pulse) — the dot stays fully legible,
 * only the pulse stops ("kill the motion, keep the data"). Every hero reads the
 * same node statically.
 */
export const nodeHeroStyles: CSSResult = css`
  .nh-art {
    display: block;
    width: 100%;
    max-width: 232px;
    margin: 0 auto;
  }
  /* Structural neutrals — panel faces, strokes, ground shadow. */
  .nh-shadow {
    fill: var(--tc-text-dim, #9aa7b8);
    opacity: 0.14;
  }
  .nh-face {
    fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
    stroke-width: 1.5;
  }
  .nh-face-2 {
    fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
    stroke-width: 1.5;
    opacity: 0.62;
  }
  /* Powerwall — green accent (fill is a FIXED decorative level, not live SoC). */
  .nh-pw-fill {
    fill: var(--tc-green, #34d399);
    opacity: 0.28;
  }
  .nh-pw-edge {
    fill: var(--tc-green, #34d399);
    opacity: 0.85;
  }
  .nh-glyph-green {
    fill: var(--tc-green, #34d399);
  }
  /* Grid — neutral source-node accent (--tc-text-dim, NOT a 7-accent key). */
  .nh-strut {
    stroke: var(--tc-text-dim, #9aa7b8);
    stroke-width: 2.4;
    stroke-linecap: round;
    fill: none;
  }
  .nh-line {
    stroke: var(--tc-text-dim, #9aa7b8);
    stroke-width: 2;
    stroke-linecap: round;
    fill: none;
  }
  .nh-cable {
    opacity: 0.7;
  }
  .nh-dot {
    fill: var(--tc-text-dim, #9aa7b8);
  }
  .nh-glyph-neutral {
    fill: var(--tc-text-dim, #9aa7b8);
  }
  /* House — neutral roof/body, warm-amber lit windows + glyph, dim door. */
  .nh-roof,
  .nh-house-body {
    fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
    stroke-width: 1.5;
  }
  .nh-window {
    fill: var(--tc-amber, #fbbf24);
    opacity: 0.55;
  }
  .nh-door {
    fill: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
  }
  .nh-glyph-amber {
    fill: var(--tc-amber, #fbbf24);
  }
  /* Wall Connector — teal cable/handle, green status dot, neutral unit face. */
  .nh-wc-face {
    fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
    stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
    stroke-width: 1.5;
  }
  .nh-wc-cable {
    stroke: var(--tc-teal, #2dd4bf);
    stroke-width: 3;
    stroke-linecap: round;
    fill: none;
  }
  .nh-wc-conn {
    fill: var(--tc-teal, #2dd4bf);
  }
  .nh-glyph-teal {
    fill: var(--tc-teal, #2dd4bf);
  }
  .nh-wc-dot {
    fill: var(--tc-green, #34d399);
    animation: nhPulse 1.6s ease-in-out infinite;
  }
  @keyframes nhPulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    /* AC3 — freeze the only motion (the WC status-dot pulse). The dot stays a
       fully legible static read; the node art is unchanged. "Kill the motion,
       keep the data" — the direct analogue of weather-vignette.ts:464. */
    .nh-wc-dot {
      animation: none;
    }
  }
`;
