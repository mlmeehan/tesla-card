import { html, svg, css, nothing, type CSSResult, type SVGTemplateResult, type TemplateResult } from 'lit';
import { STRINGS } from '../strings';
import { UNAVAILABLE_STATES } from '../helpers';

/**
 * `weatherVignette` — a living sky/weather vignette for the `tc-solar` card
 * (Story 6.4, Epic 6). This is a RENDER HELPER (the `carView()`/`statTile`
 * pattern: a pure render function + a `CSSResult` styles export), **NOT** a
 * `tc-*` custom element — it registers nothing and is imported only by the card
 * that composes it. It exists so the Solar card's raw kW reading gets *honest
 * visual context*: when the card says "0.2 kW", the sky behind it shows the real
 * overcast/rainy condition that explains why.
 *
 * The data source is HA **core** (`weather.home` condition + `sun.sun`
 * day/night), NOT a Tesla function-slug — so it is not in the Epic-1 registry.
 * The card reads those two user-named entities via `readRaw` (`data/freshness`)
 * and passes the already-RESOLVED values down here; the helper itself never
 * touches `hass` (mirroring how `statTile`/`carView` take resolved inputs). This
 * keeps the `data/ ← flow/ ← components/` direction clean (this module imports
 * only `lit` + `strings`).
 *
 * Honesty discipline (UX-DR15 / UX-DR18): an absent/`unavailable` condition →
 * the vignette is OMITTED (`nothing`), never a fabricated default sunny sky.
 * Reduced-motion FREEZES the animation (the rainy sky still reads rainy) — "kill
 * the motion, keep the data". Art geometry is the decided 2026-06-14 mockup
 * (`myhome-cards-bus.html:988–1056`) ported to Lit `svg`` ` templates.
 */

/**
 * The day/night-RESOLVED weather scene the renderer switches on — the canonical
 * intermediate between HA's raw `weather.home` vocabulary and the SVG art. The 7
 * AC1 treatment families (sun · moon+stars · clouds · rain · pouring · snow ·
 * lightning) instantiate into these 9 day/night scenes: `partlycloudy` and the
 * clear conditions resolve differently by `isDay`, the rest are day/night-neutral.
 */
export type WeatherScene =
  | 'clear-day'
  | 'clear-night'
  | 'partlycloudy-day'
  | 'partlycloudy-night'
  | 'cloudy'
  | 'rainy'
  | 'pouring'
  | 'snowy'
  | 'lightning-rainy';

/**
 * Pure mapping: HA core `weather.home` condition (+ `sun.sun`-derived `isDay`) →
 * a {@link WeatherScene}. No `hass`, no DOM — exhaustively table-tested (AC1).
 *
 * HA's full weather vocabulary is mapped: `sunny`→sun · `clear-night`→moon+stars
 * · `partlycloudy`→clouds-with-sun/moon (by `isDay`) · `cloudy`/`fog`/`windy`/
 * `windy-variant`→overcast clouds · `rainy`→rain · `pouring`→pouring · `snowy`/
 * `snowy-rainy`/`hail`→snow · `lightning`/`lightning-rainy`→lightning ·
 * `exceptional`/unknown → a SAFE NEUTRAL overcast (`cloudy`) — never a fabricated
 * sun for an unrecognized string (honesty: don't overstate clear sky).
 *
 * Defensive: `sunny` at night (degenerate — HA uses `clear-night` for a clear
 * night sky) prefers the moon treatment. `clear-night` is intrinsically a night
 * condition, so it always resolves to moon regardless of `isDay` — this is the
 * night-inference for the no-`sun.sun` case (absent ⇒ `isDay` true, yet a
 * `clear-night` read still shows the moon).
 */
export function weatherScene(condition: string | undefined, isDay: boolean): WeatherScene {
  switch (condition) {
    case 'sunny':
      return isDay ? 'clear-day' : 'clear-night';
    case 'clear-night':
      return 'clear-night';
    case 'partlycloudy':
      return isDay ? 'partlycloudy-day' : 'partlycloudy-night';
    case 'cloudy':
    case 'fog':
    case 'windy':
    case 'windy-variant':
      return 'cloudy';
    case 'rainy':
      return 'rainy';
    case 'pouring':
      return 'pouring';
    case 'snowy':
    case 'snowy-rainy':
    case 'hail':
      return 'snowy';
    case 'lightning':
    case 'lightning-rainy':
      return 'lightning-rainy';
    case 'exceptional':
    default:
      // Safe neutral — an unknown/exceptional condition shows honest overcast,
      // NEVER a fabricated clear sky (UX-DR18: don't overstate).
      return 'cloudy';
  }
}

// ── decorative palette (non-accent hexes only) ───────────────────────────────
// VERIFIED: none of these equals one of the 7 canonical accent hexes (the
// ACCENT_SEMANTICS registry in styles.ts), so they pass the styles.test.ts
// raw-accent-hex gate — the `car.ts` neutral-silver precedent. Anything that
// SHOULD read as an accent (rain = blue, bolt = amber) is coloured via a
// `var(--tc-…, #hex)` token in `weatherVignetteStyles`, not a raw fill here.
const C_DAY = '#9fb0c8'; // day cloud
const C_GREY = '#7c8aa0'; // overcast cloud
const C_DARK = '#566076'; // storm cloud

/** Gradient defs (sun / moon / panel) — referenced by `url(#…)` within this SVG. */
const DEFS: SVGTemplateResult = svg`
  <defs>
    <radialGradient id="wx-sung" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#fff4c8" />
      <stop offset="55%" stop-color="#ffd23f" />
      <stop offset="100%" stop-color="#f59e0b" />
    </radialGradient>
    <radialGradient id="wx-moong" cx="40%" cy="36%" r="68%">
      <stop offset="0%" stop-color="#eef3ff" />
      <stop offset="68%" stop-color="#c3cde0" />
      <stop offset="100%" stop-color="#94a1b8" />
    </radialGradient>
    <linearGradient id="wx-panelg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2c3c58" />
      <stop offset="100%" stop-color="#19222f" />
    </linearGradient>
  </defs>
`;

/** A tilted solar panel — keeps the Solar-card identity under every sky. */
function panel(): SVGTemplateResult {
  const TLx = 84,
    TRx = 216,
    BLx = 72,
    BRx = 228,
    ty = 106,
    by = 130;
  const cells: SVGTemplateResult[] = [];
  for (let i = 0; i <= 4; i++) {
    const xt = TLx + ((TRx - TLx) * i) / 4;
    const xb = BLx + ((BRx - BLx) * i) / 4;
    cells.push(svg`<line x1=${xt.toFixed(1)} y1=${ty} x2=${xb.toFixed(1)} y2=${by} stroke="#3a4d6e" stroke-width="1" />`);
  }
  const mlx1 = (TLx + BLx) / 2,
    mlx2 = (TRx + BRx) / 2,
    my = (ty + by) / 2;
  return svg`
    <g opacity="0.97">
      <polygon points=${`${TLx},${ty} ${TRx},${ty} ${BRx},${by} ${BLx},${by}`} fill="url(#wx-panelg)" stroke="#46597a" stroke-width="1.5" />
      ${cells}
      <line x1=${mlx1} y1=${my} x2=${mlx2} y2=${my} stroke="#3a4d6e" stroke-width="1" />
    </g>
  `;
}

/** 12 radial spokes around `(cx, cy)` between radii `r0` and `r1`. */
function rays(cx: number, cy: number, r0: number, r1: number): SVGTemplateResult[] {
  const lines: SVGTemplateResult[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const x0 = cx + Math.cos(a) * r0,
      y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * r1,
      y1 = cy + Math.sin(a) * r1;
    lines.push(svg`<line x1=${x0.toFixed(1)} y1=${y0.toFixed(1)} x2=${x1.toFixed(1)} y2=${y1.toFixed(1)} />`);
  }
  return lines;
}

function sun(x: number, y: number): SVGTemplateResult {
  return svg`
    <circle class="wx-glow" cx=${x} cy=${y} r="42" fill="url(#wx-sung)" />
    <g class="wx-rays" stroke="#ffd23f" stroke-width="3" stroke-linecap="round">${rays(x, y, 23, 33)}</g>
    <circle cx=${x} cy=${y} r="20" fill="url(#wx-sung)" />
  `;
}

function moon(x: number, y: number): SVGTemplateResult {
  return svg`
    <circle class="wx-glow" cx=${x} cy=${y} r="34" fill="url(#wx-moong)" />
    <circle cx=${x} cy=${y} r="19" fill="url(#wx-moong)" />
    <circle cx=${x + 7} cy=${y - 6} r="4.2" fill="#9fabc2" opacity=".7" />
    <circle cx=${x - 5} cy=${y + 5} r="3" fill="#9fabc2" opacity=".6" />
    <circle cx=${x + 2} cy=${y + 9} r="2.2" fill="#9fabc2" opacity=".5" />
  `;
}

function cloud(x: number, y: number, s: number, fill: string, cls = ''): SVGTemplateResult {
  return svg`
    <g class=${`wx-cloud ${cls}`}>
      <g transform=${`translate(${x},${y}) scale(${s})`}>
        <ellipse cx="0" cy="7" rx="34" ry="14" fill=${fill} />
        <circle cx="-16" cy="3" r="13" fill=${fill} />
        <circle cx="2" cy="-6" r="17" fill=${fill} />
        <circle cx="20" cy="1" r="14" fill=${fill} />
      </g>
    </g>
  `;
}

function rain(heavy: boolean): SVGTemplateResult[] {
  const cols = heavy ? 11 : 7;
  const drops: SVGTemplateResult[] = [];
  for (let i = 0; i < cols; i++) {
    const x = 72 + (i * 156) / (cols - 1);
    const d = (i * 0.13) % 0.9;
    drops.push(
      svg`<line class="wx-drop" x1=${x.toFixed(1)} y1="58" x2=${(x - 6).toFixed(1)} y2="72" style=${`animation-delay:${d.toFixed(2)}s`} />`
    );
  }
  return drops;
}

function snow(): SVGTemplateResult[] {
  const flakes: SVGTemplateResult[] = [];
  for (let i = 0; i < 9; i++) {
    const x = 74 + (i * 152) / 8;
    const d = (i * 0.31) % 2.6;
    const r = 2.1 + (i % 3) * 0.6;
    flakes.push(
      svg`<circle class="wx-flake" cx=${x.toFixed(1)} cy="56" r=${r.toFixed(1)} style=${`animation-delay:${d.toFixed(2)}s`} />`
    );
  }
  return flakes;
}

function stars(): SVGTemplateResult[] {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [40, 30],
    [70, 52],
    [110, 24],
    [150, 44],
    [196, 28],
    [232, 54],
    [258, 34],
    [88, 70],
    [178, 64],
    [214, 18],
  ];
  return pts.map((p, i) => {
    const d = (i * 0.27) % 2.4;
    const r = 1.1 + (i % 3) * 0.5;
    return svg`<circle class="wx-star" cx=${p[0]} cy=${p[1]} r=${r.toFixed(1)} style=${`animation-delay:${d.toFixed(2)}s`} />`;
  });
}

function bolt(x: number): SVGTemplateResult {
  return svg`<polygon class="wx-bolt" points=${`${x},50 ${x - 13},86 ${x - 2},86 ${x - 9},114 ${x + 15},72 ${x + 3},72 ${x + 12},50`} />`;
}

/** Build the sky body (everything but the panel) for a resolved {@link WeatherScene}. */
function sceneBody(scene: WeatherScene): SVGTemplateResult | SVGTemplateResult[] {
  switch (scene) {
    case 'clear-day':
      return sun(150, 52);
    case 'clear-night':
      return [...stars(), moon(150, 50)];
    case 'partlycloudy-day':
      return [sun(118, 46), cloud(178, 62, 1, C_DAY), cloud(122, 80, 0.74, C_DAY, 'c2')];
    case 'partlycloudy-night':
      return [...stars(), moon(118, 46), cloud(180, 64, 1, C_GREY)];
    case 'cloudy':
      return [cloud(108, 52, 1.05, C_GREY), cloud(188, 64, 0.9, C_DAY, 'c2'), cloud(150, 40, 0.82, C_GREY)];
    case 'rainy':
      return [cloud(150, 42, 1.15, C_GREY), cloud(96, 54, 0.7, C_GREY, 'c2'), ...rain(false)];
    case 'pouring':
      return [cloud(150, 40, 1.2, C_DARK), cloud(100, 54, 0.8, C_DARK, 'c2'), ...rain(true)];
    case 'snowy':
      return [cloud(150, 42, 1.15, C_GREY), cloud(98, 56, 0.72, C_DAY, 'c2'), ...snow()];
    case 'lightning-rainy':
      return [cloud(150, 40, 1.2, C_DARK), cloud(100, 54, 0.8, C_DARK, 'c2'), ...rain(true), bolt(150)];
  }
}

/** Options for {@link weatherVignette} — already-RESOLVED values (no `hass`). */
export interface WeatherVignetteOpts {
  /** HA core `weather.home` state string, or `undefined` (absent/`unavailable`/non-string). */
  condition: string | undefined;
  /** Day flag derived from `sun.sun` by the card (`above_horizon`/absent ⇒ day). */
  isDay: boolean;
  /** The RESOLVED source entity-ids for the honest provenance chip (override-reflecting). */
  sources: { weather: string; sun: string };
}

/**
 * Render the live-weather vignette for the Solar card. Returns `nothing` when
 * `condition` is absent (AC4 — OMIT, never fabricate a sky). Otherwise builds the
 * inline-SVG sky for `weatherScene(condition, isDay)`, a human-readable condition
 * name, and an honest provenance chip naming the REAL resolved source ids.
 */
export function weatherVignette(opts: WeatherVignetteOpts): TemplateResult | typeof nothing {
  // AC4 honesty gate — OMIT, never fabricate. `readRaw` returns the literal HA
  // sentinel string for an `unavailable`/`unknown`/`none`/empty entity (those ARE
  // strings, so they don't arrive as `undefined`); treating them as a real
  // condition would map through the `default` arm to a fabricated `cloudy` sky.
  // The helper is the single omission point, so the guard lives here (defends
  // every caller, incl. the future My-Home scene slot).
  if (opts.condition === undefined || UNAVAILABLE_STATES.includes(opts.condition)) return nothing;

  const scene = weatherScene(opts.condition, opts.isDay);
  const name = STRINGS.ecosystem.solar.weather.names[scene];
  const provenance = `${opts.sources.weather}${STRINGS.ecosystem.solar.weather.provenanceSep}${opts.sources.sun}`;

  return html`
    <div class="wx">
      <svg class="wx-art" viewBox="0 0 300 138" role="img" aria-label=${name}>
        ${DEFS}${sceneBody(scene)}${panel()}
      </svg>
      <div class="wx-chips">
        <span class="wx-name">${name}</span>
        <span class="wx-pre">${provenance}</span>
      </div>
    </div>
  `;
}

/**
 * Component-local styles for the vignette — composed by the Solar card via
 * `static styles = [sharedStyles, ecosystemShellStyles, weatherVignetteStyles]`
 * (the `carStyles` idiom). New keyframes live HERE, OUTSIDE `sharedStyles`'
 * locked `{tc-pulse, tc-shimmer}` a11y corpus. Every `var(--tc-*)` carries its
 * DESIGN.md fallback (hard gate). Ported from the decided mockup CSS
 * (`myhome-cards-bus.html:248–274`), with bare `var()`s given fallbacks.
 *
 * AC3 reduced-motion: the closing `@media (prefers-reduced-motion: reduce)` block
 * FREEZES every `wx-*` animation (`animation: none`) — the condition art stays
 * fully legible, only the motion stops ("kill the motion, keep the data").
 */
export const weatherVignetteStyles: CSSResult = css`
  .wx {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .wx-art {
    display: block;
    width: 100%;
    max-width: 226px;
  }
  .wx-glow {
    animation: wxGlow 3.6s ease-in-out infinite;
  }
  @keyframes wxGlow {
    0%,
    100% {
      opacity: 0.32;
    }
    50% {
      opacity: 0.62;
    }
  }
  .wx-rays {
    animation: wxRays 4.6s ease-in-out infinite;
  }
  @keyframes wxRays {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 0.92;
    }
  }
  .wx-cloud {
    animation: wxDrift 9s ease-in-out infinite alternate;
  }
  .wx-cloud.c2 {
    animation-duration: 13s;
    animation-delay: -4s;
    animation-direction: alternate-reverse;
  }
  @keyframes wxDrift {
    from {
      transform: translateX(-9px);
    }
    to {
      transform: translateX(12px);
    }
  }
  .wx-drop {
    stroke: var(--tc-blue, #38bdf8);
    stroke-width: 2.4;
    stroke-linecap: round;
    animation: wxRain 0.9s linear infinite;
  }
  @keyframes wxRain {
    0% {
      transform: translateY(-6px);
      opacity: 0;
    }
    15% {
      opacity: 0.85;
    }
    100% {
      transform: translateY(34px);
      opacity: 0;
    }
  }
  .wx-flake {
    fill: #dbe7fb;
    animation: wxSnow 2.9s linear infinite;
  }
  @keyframes wxSnow {
    0% {
      transform: translateY(-6px);
      opacity: 0;
    }
    15% {
      opacity: 0.95;
    }
    100% {
      transform: translateY(36px);
      opacity: 0;
    }
  }
  .wx-star {
    fill: #cdd8ec;
    animation: wxTw 2.4s ease-in-out infinite;
  }
  @keyframes wxTw {
    0%,
    100% {
      opacity: 0.18;
    }
    50% {
      opacity: 1;
    }
  }
  .wx-bolt {
    fill: var(--tc-amber, #fbbf24);
    animation: wxFlash 3.2s steps(1, end) infinite;
  }
  @keyframes wxFlash {
    0%,
    88%,
    100% {
      opacity: 0;
    }
    90%,
    96% {
      opacity: 0.95;
    }
    93% {
      opacity: 0.25;
    }
  }
  .wx-chips {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    margin: 6px 2px 0;
  }
  /* Condition name — quiet trust-copy (--tc-text-dim, 4.5:1), never an accent. */
  .wx-name {
    font-size: var(--tc-fs-label, 11.5px);
    font-weight: var(--tc-fw-body, 600);
    color: var(--tc-text-dim, #9aa7b8);
  }
  /* Honest provenance chip — the dimmer caption colour (--tc-text-mute), the
     resolved source ids; decorative, so the 3:1 mute colour is correct here. */
  .wx-pre {
    font-size: var(--tc-fs-label, 11.5px);
    color: var(--tc-text-mute, #64748b);
  }

  @media (prefers-reduced-motion: reduce) {
    /* AC3 — freeze ALL motion; the condition art stays fully legible (the rainy
       sky still reads rainy). "Kill the motion, keep the data" — the direct
       analogue of car.ts:455/515. */
    .wx-glow,
    .wx-rays,
    .wx-cloud,
    .wx-drop,
    .wx-flake,
    .wx-star,
    .wx-bolt {
      animation: none;
    }
  }
`;
