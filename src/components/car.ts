import { html, svg, css, nothing, type TemplateResult } from 'lit';
import type { BodyLayers } from '../types';

/** Neutral silver — matches a typical source render, reads as "no tint applied". */
const DEFAULT_PAINT = '#c6c8c9';

export interface CarViewOpts {
  /** Flat fallback image, used when `body` layers are absent. */
  image?: string;
  /** Recolorable layer set; when present the body is painted to `paint`. */
  body?: BodyLayers;
  /** Paint colour — any CSS colour. Defaults to neutral silver. */
  paint?: string;
  /** Accessible label / alt text. */
  name?: string;
  /** Charging → adds a subtle energy-glow accent. */
  charging?: boolean;
}

/**
 * Render the hero vehicle. Three modes, in priority order:
 *
 *   1. `body` layers  → composite a recolorable photoreal stack tinted to
 *      `paint` (bring-your-own assets — see docs/recolorable-body.md).
 *   2. `image`        → today's flat `<img>` (a render the user points at).
 *   3. neither        → the bundled generic-EV silhouette, recoloured to
 *      `paint`. This is the zero-config default, so a fresh install shows a
 *      clean car instead of a broken image.
 *
 * Recolor stack (mode 1): the `color` base keeps its real glass / wheels /
 * lights / shadow pixels, then inside the `mask` (white = paint region) the
 * card stacks `paint`, `shade` (×multiply, so form survives any colour) and an
 * optional `highlight` (×screen, so clearcoat glints stay bright). The mask
 * carries all per-vehicle geometry, so this renderer never hard-codes a
 * coordinate.
 */
export function carView(opts: CarViewOpts): TemplateResult {
  const { body, name = 'Vehicle', charging } = opts;
  const paint = opts.paint ?? DEFAULT_PAINT;

  if (body) {
    const w = body.width ?? 1024;
    const h = body.height ?? 687;

    // id is scoped to this card's shadow root, so multiple cards never collide.
    return html`
      <svg
        class="car-img tc-car ${charging ? 'charging' : ''}"
        viewBox="0 0 ${w} ${h}"
        style="--tc-paint:${paint}"
        role="img"
        aria-label=${name}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask
            id="tc-paintmask"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width=${w}
            height=${h}
          >
            <image href=${body.mask} x="0" y="0" width=${w} height=${h} />
          </mask>
        </defs>

        <image href=${body.color} x="0" y="0" width=${w} height=${h} />

        <g mask="url(#tc-paintmask)" style="isolation:isolate">
          <rect x="0" y="0" width=${w} height=${h} fill="var(--tc-paint)" />
          <image
            href=${body.shade}
            x="0"
            y="0"
            width=${w}
            height=${h}
            style="mix-blend-mode:multiply"
          />
          ${body.highlight
            ? svg`<image
                href=${body.highlight}
                x="0"
                y="0"
                width=${w}
                height=${h}
                style="mix-blend-mode:screen"
              />`
            : nothing}
        </g>
      </svg>
    `;
  }

  if (opts.image) {
    return html`<img
      class="car-img"
      src=${opts.image}
      alt=${name}
      draggable="false"
    />`;
  }

  return genericCar(paint, name, !!charging);
}

/**
 * The bundled, zero-config default hero: a clean side-profile EV that recolours
 * to any `paint`. It's a deliberately generic illustration (not modelled on any
 * specific vehicle), so it's safe to ship — the recolorable photoreal pipeline
 * is the optional upgrade.
 *
 * Recolouring without per-colour assets: the body is a single flat fill set to
 * `paint`, and dimension comes from translucent **white** (top sheen) and
 * **black** (lower shade) overlays clipped to the body. Because those overlays
 * are alpha-composited white/black — not fixed colours — the form reads
 * correctly on any paint, from white through to black.
 */
function genericCar(
  paint: string,
  name: string,
  charging: boolean,
): TemplateResult {
  return html`
    <svg
      class="car-img tc-car tc-ev ${charging ? 'charging' : ''}"
      viewBox="0 0 1024 480"
      style="--tc-paint:${paint}"
      role="img"
      aria-label=${name}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="tc-ev-hi" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.30" />
          <stop offset="0.4" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="tc-ev-sh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.52" stop-color="#000000" stop-opacity="0" />
          <stop offset="1" stop-color="#000000" stop-opacity="0.24" />
        </linearGradient>
        <linearGradient id="tc-ev-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a4651" />
          <stop offset="1" stop-color="#1a1f26" />
        </linearGradient>
        <radialGradient id="tc-ev-rim" cx="0.5" cy="0.42" r="0.58">
          <stop offset="0" stop-color="#eceff2" />
          <stop offset="0.65" stop-color="#c4c9ce" />
          <stop offset="1" stop-color="#969ca2" />
        </radialGradient>
        <path
          id="tc-ev-body"
          d="M 100 360 C 56 354 44 326 58 286 C 80 250 150 232 250 220 L 360 210 L 384 200 L 458 100 Q 470 92 490 92 L 640 92 Q 666 92 680 104 L 826 196 L 858 200 C 928 206 968 214 982 248 C 992 274 990 312 974 338 C 964 354 950 360 920 360 L 884 360 A 92 92 0 0 0 700 360 L 348 360 A 92 92 0 0 0 164 360 L 100 360 Z"
        />
        <clipPath id="tc-ev-clip"><use href="#tc-ev-body" /></clipPath>
      </defs>

      <ellipse cx="520" cy="450" rx="440" ry="22" fill="#000000" opacity="0.2" />
      <use href="#tc-ev-body" fill="var(--tc-paint)" />

      <path d="M 400 196 L 462 108 L 634 108 L 810 196 Z" fill="url(#tc-ev-glass)" />
      <path d="M 546 109 L 558 109 L 558 195 L 546 195 Z" fill="#10141a" opacity="0.55" />

      <g clip-path="url(#tc-ev-clip)">
        <rect x="0" y="86" width="1024" height="280" fill="url(#tc-ev-hi)" />
        <rect x="0" y="86" width="1024" height="280" fill="url(#tc-ev-sh)" />
        <path d="M 70 268 C 320 252 720 252 980 280" stroke="#000000" stroke-opacity="0.1" stroke-width="6" fill="none" />
        <path d="M 470 200 L 474 350" stroke="#000000" stroke-opacity="0.12" stroke-width="3" fill="none" />
        <path d="M 648 200 L 652 350" stroke="#000000" stroke-opacity="0.12" stroke-width="3" fill="none" />
      </g>

      <path d="M 74 261 L 128 255 L 130 265 L 76 272 Z" fill="#e4eef8" opacity="0.82" />
      <path d="M 924 254 L 974 250 L 976 261 L 926 266 Z" fill="#cf3b3b" opacity="0.9" />

      <g>
        <circle cx="256" cy="350" r="92" fill="#16181b" />
        <circle cx="256" cy="350" r="70" fill="#20242a" />
        <circle cx="256" cy="350" r="54" fill="url(#tc-ev-rim)" />
        <circle cx="256" cy="350" r="54" fill="none" stroke="#888e95" stroke-width="2" />
        <g stroke="#969ca2" stroke-width="9" stroke-linecap="round">
          <line x1="256" y1="350" x2="256" y2="302" />
          <line x1="256" y1="350" x2="302" y2="365" />
          <line x1="256" y1="350" x2="284" y2="392" />
          <line x1="256" y1="350" x2="228" y2="392" />
          <line x1="256" y1="350" x2="210" y2="365" />
        </g>
        <circle cx="256" cy="350" r="15" fill="#82888f" />
      </g>
      <g>
        <circle cx="792" cy="350" r="92" fill="#16181b" />
        <circle cx="792" cy="350" r="70" fill="#20242a" />
        <circle cx="792" cy="350" r="54" fill="url(#tc-ev-rim)" />
        <circle cx="792" cy="350" r="54" fill="none" stroke="#888e95" stroke-width="2" />
        <g stroke="#969ca2" stroke-width="9" stroke-linecap="round">
          <line x1="792" y1="350" x2="792" y2="302" />
          <line x1="792" y1="350" x2="838" y2="365" />
          <line x1="792" y1="350" x2="820" y2="392" />
          <line x1="792" y1="350" x2="764" y2="392" />
          <line x1="792" y1="350" x2="746" y2="365" />
        </g>
        <circle cx="792" cy="350" r="15" fill="#82888f" />
      </g>
    </svg>
  `;
}

/** Recolor-specific styles; sizing is shared with the `<img>` via `.car-img`. */
export const carStyles = css`
  .tc-car {
    /* SVG honours its viewBox aspect ratio; preserveAspectRatio defaults to
       meet (contain), matching the <img> object-fit. */
    height: auto;
  }
  .tc-car .tc-car-paint {
    fill: var(--tc-paint);
  }
  .tc-car.charging {
    animation: tc-car-charge 2.4s var(--tc-ease) infinite;
  }
  @keyframes tc-car-charge {
    0%,
    100% {
      filter: drop-shadow(0 22px 30px rgba(0, 0, 0, 0.45));
    }
    50% {
      filter: drop-shadow(0 0 16px var(--tc-green))
        drop-shadow(0 22px 30px rgba(0, 0, 0, 0.45));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tc-car.charging {
      animation: none;
    }
  }
`;
