import { html, svg, css, nothing, type TemplateResult, type SVGTemplateResult } from 'lit';
import type { BodyLayers } from '../types';
import { HERO_VIEWBOX } from '../const';
import { LAYER_CONTRACT } from '../layer-contract';
import { log } from '../log';
import { STRINGS } from '../strings';

// ─── Hero render-path types (Story 7.1 relocation, E9/AC1) ──────────────────
// These describe the living-hero render opts and are owned by the Hero render
// path (this module + `hero.ts`), NOT the public config surface — so they live
// with their owner here, not in `types.ts` (which is PUBLIC `TeslaCardConfig`
// only). The Hero classifier (`hero.ts`) and `carView` (below) are the only
// consumers; both import them from here.

/**
 * The three glanceable charge states the Hero renders (Story 3.4, FR-5/UX-DR10):
 * `parked` (neutral, not plugged), `plugged` (connected, at rest — blue port glow
 * + cable) and `charging` (live kW — green port glow + cable + pulsing halo).
 * Derived from the discrete charging-state entity via `normalizeChargingState`
 * (NOT signed power). `charging ⇒ plugged` (AC2) is structural: the port-glow/cable
 * renders for BOTH `plugged` and `charging`, so green is a superset of blue. Shared
 * by the Hero (classifier) and `carView` (the render opt).
 */
export type ChargeVisual = 'parked' | 'plugged' | 'charging';

/**
 * The four apertures the Hero reflects (Story 3.5, FR-6): frunk (front clamshell),
 * liftgate (rear hatch — the `trunk` cover on a Model Y), door (any of the four
 * door binary_sensors) and window (the aggregate `windows` cover). The car answers
 * "is my car open?" at a wall-glance.
 */
export type ApertureKey = 'frunk' | 'liftgate' | 'door' | 'window';

/**
 * Aperture open-state: a FLAT record of four independent booleans (AC1 — linear,
 * NOT combinatorial). Apertures are physically independent — a frunk can be up
 * while a door is ajar and a window is down — so each is its own toggle, never
 * collapsed into a single enum (that was right for `ChargeVisual`, where exactly
 * one of parked/plugged/charging holds; it is WRONG here). Four overlays, four
 * toggles, runtime-composed — never a state set of all 2⁴ combinations. Shared by
 * the Hero (the `_apertures()` classifier) and `carView` (the render opt).
 */
export type ApertureState = Record<ApertureKey, boolean>;

/** Neutral silver — matches a typical source render, reads as "no tint applied". */
const DEFAULT_PAINT = '#c6c8c9';
/** Dark cavity behind an opened panel — reuses the generic EV's glass/shadow neutral. */
const APERTURE_CAVITY = '#10141a';

/**
 * Default charge-port anchor for the body-layers render (Story 3.6), in the
 * 1024×687 (`HERO_VIEWBOX`) coordinate contract. The body contract assumes a
 * front-right 3/4 camera (aperture-render-spec.md:15) — a DIFFERENT coordinate
 * space from the generic EV's nested 1024×480 left-profile art, so this is its
 * own constant, NOT the generic EV's `(900, 300)`. A Tesla charge port is
 * rear-driver-side, so in a front-right 3/4 view it reads at the rear-left
 * quarter. A body pack whose port sits elsewhere overrides via `body.chargePort`;
 * tune this default against a real 3/4 render in the demo.
 */
const DEFAULT_BODY_CHARGE_PORT = { x: 180, y: 470 } as const;

/**
 * Is `body` a CONFORMING render per the published Layer contract (AC3)? True only
 * when every `LAYER_CONTRACT.requiredLayers` key (`color`/`shade`/`mask`) is a
 * non-empty string. Driven off the contract map (single source of truth) — if the
 * contract grows a required layer, this guard follows automatically. A non-
 * conforming body must NOT reach the recolor render (it would emit a broken
 * `<image href=undefined>`); `carView` falls it through the render-mode priority.
 */
function isConformingBody(body: BodyLayers | undefined): body is BodyLayers {
  return (
    !!body &&
    LAYER_CONTRACT.requiredLayers.every(
      (k) => typeof body[k] === 'string' && body[k] !== ''
    )
  );
}

/**
 * Charge-port overlay node (glow + cable + core) — Story 3.4's `.tc-port` markup,
 * factored into a shared helper (Story 3.6) so BOTH the bundled generic EV and the
 * body-layers render emit the SAME node (DRY — never a second charge overlay).
 * Colour is driven entirely by the `.tc-car.<state>` CSS hook in `carStyles` (blue
 * plugged / green charging), so the node carries NO inline colour and the `--tc-*`
 * fallback gate stays satisfied (one place owns the colours). Anchored at `(x, y)`
 * in the caller's coordinate space (the generic EV's nested 1024×480 art, or the
 * body's 1024×687 viewBox). The cable path is built RELATIVE to `(x, y)`, so at the
 * generic EV's `(900, 300)` it reproduces the original Story 3.4 path byte-for-byte
 * (behaviour-preserving extraction).
 */
function chargePortOverlay(x: number, y: number): SVGTemplateResult {
  return svg`
      <g class="tc-port">
        <circle class="tc-port-glow" cx=${x} cy=${y} r="34" />
        <path
          class="tc-port-cable"
          d="M ${x} ${y + 8} C ${x + 12} ${y + 60} ${x + 2} ${y + 108} ${x - 28} ${y + 152}"
          fill="none"
        />
        <circle class="tc-port-core" cx=${x} cy=${y} r="13" />
      </g>`;
}

/** All-closed aperture state — the default, and what an asleep car shows (Story 3.5). */
export const CLOSED_APERTURES: ApertureState = {
  frunk: false,
  liftgate: false,
  door: false,
  window: false,
};

export interface CarViewOpts {
  /** Flat fallback image, used when `body` layers are absent. */
  image?: string;
  /** Recolorable layer set; when present the body is painted to `paint`. */
  body?: BodyLayers;
  /** Paint colour — any CSS colour. Defaults to neutral silver. */
  paint?: string;
  /** Accessible label / alt text. */
  name?: string;
  /**
   * Glanceable charge state (Story 3.4): `plugged`/`charging` add the charge-port
   * glow + cable (blue vs green); `charging` additionally pulses the body halo.
   * Defaults to `parked` (neither). Drives the `.tc-car.<state>` style hook.
   */
  charge?: ChargeVisual;
  /**
   * Open-aperture state (Story 3.5): four INDEPENDENT booleans (frunk / liftgate
   * / door / window) — any combination can be open at once (AC1, linear not
   * combinatorial). Each toggles its own crossfading `.ap-<name>` overlay via a
   * `.tc-car.<aperture>-open` class hook. Defaults to all-closed.
   */
  apertures?: ApertureState;
}

/**
 * Compose the `.tc-car` class list: the static base + the charge-state hook +
 * one `<aperture>-open` hook per open aperture (Story 3.5, AC1). Each open
 * aperture is its own independent class (never a combined token), so the four
 * overlays toggle independently.
 */
function carClasses(base: string, charge: ChargeVisual, ap: ApertureState): string {
  return [
    base,
    charge,
    ap.frunk ? 'frunk-open' : '',
    ap.liftgate ? 'liftgate-open' : '',
    ap.door ? 'door-open' : '',
    ap.window ? 'window-open' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * State-bearing aria-label (Story 3.5, DoD a11y / EXPERIENCE.md:176): when any
 * aperture is open, append the open list ("Model Y · open: frunk, door") so a
 * screen-reader / colour-blind user reads the open state from words, never the
 * silver overlay alone. When all closed, the plain `name` (the hero doesn't
 * announce "all closed" — the closures panel owns that detail).
 */
function carLabel(name: string, ap: ApertureState): string {
  const open: string[] = [];
  if (ap.frunk) open.push(STRINGS.hero.aperture.frunk);
  if (ap.liftgate) open.push(STRINGS.hero.aperture.liftgate);
  if (ap.door) open.push(STRINGS.hero.aperture.door);
  if (ap.window) open.push(STRINGS.hero.aperture.window);
  return open.length
    ? `${name} · ${STRINGS.hero.aperture.open}: ${open.join(', ')}`
    : name;
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
  const { body, name = 'Vehicle', charge = 'parked', apertures = CLOSED_APERTURES } = opts;
  const paint = opts.paint ?? DEFAULT_PAINT;
  const label = carLabel(name, apertures);

  if (body && isConformingBody(body)) {
    // Per-vehicle overrides win; otherwise the body layers fill the shared
    // 1024×687 coordinate contract (HERO_VIEWBOX) every render mode anchors to.
    const w = body.width ?? HERO_VIEWBOX.width;
    const h = body.height ?? HERO_VIEWBOX.height;
    // Charge-port anchor — a named contract NODE (Story 3.6); default when omitted.
    const port = body.chargePort ?? DEFAULT_BODY_CHARGE_PORT;

    // id is scoped to this card's shadow root, so multiple cards never collide.
    return html`
      <svg
        class=${carClasses('car-img tc-car', charge, apertures)}
        viewBox="0 0 ${w} ${h}"
        style="--tc-paint:${paint}"
        role="img"
        aria-label=${label}
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
          <rect x="0" y="0" width=${w} height=${h} fill="var(--tc-paint, #c6c8c9)" />
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

        ${bodyApertureLayers(body, w, h)}

        ${charge !== 'parked'
          ? // Body-mode charge overlay (Story 3.6 — fulfils the Story 3.4 body-
            // layers deferral at car.ts genericCar). Z-order: TOPMOST cue, rendered
            // AFTER bodyApertureLayers (aperture-render-spec.md:58-59 — apertures
            // above the recolor stack, charge above apertures). Same shared node +
            // .tc-car.<state> colour hook as the generic EV (DRY), anchored at the
            // body's chargePort node (or the contract default) in 1024×687 space.
            chargePortOverlay(port.x, port.y)
          : nothing}
      </svg>
    `;
  }

  // AC3 — a body that is PRESENT but missing a required named layer must never
  // reach the recolor render (it would emit a broken <image href=undefined>).
  // Fall THROUGH the render-mode priority (body → image → bundled EV) and warn
  // ONCE, naming the missing layer(s) — honest, never silent (UX-DR18). A fully-
  // absent body is the normal zero-config path (→ bundled EV), so it never warns.
  if (body) {
    const missing = LAYER_CONTRACT.requiredLayers.filter(
      (k) => typeof body[k] !== 'string' || body[k] === ''
    );
    log.warn('body render ignored — missing required layer(s):', missing.join(', '));
  }

  if (opts.image) {
    return html`<img
      class="car-img"
      src=${opts.image}
      alt=${label}
      draggable="false"
    />`;
  }

  return genericCar(paint, label, charge, apertures);
}

/**
 * Body-layers aperture overlays (Story 3.5 slot — assets DEFERRED to 3.6/3.7).
 *
 * Each supplied bring-your-own neutral-silver inpainted overlay renders as a
 * crossfading `<image class="ap ap-<name>">` layer ABOVE the recolor stack and
 * BELOW the charge overlay (aperture-render-spec.md z-order; the body-mode charge
 * overlay itself lands in 3.6). When an aperture's asset is absent we render
 * NOTHING for it (graceful) — the node only exists once an asset backs it, so the
 * crossfade has both endpoints. Opacity + reduced-motion cut live in `carStyles`
 * (one shared `.ap` rule covers both render modes, DRY). The photoreal assets +
 * the formal `@unstable` Layer-contract inclusion are Stories 3.6/3.7 — this
 * story ships the mechanism; the bundled generic EV is the primary target.
 */
function bodyApertureLayers(body: BodyLayers, w: number, h: number): SVGTemplateResult {
  const a = body.apertureLayers;
  if (!a) return svg`${nothing}`;
  const layer = (name: string, href: string | undefined): SVGTemplateResult =>
    href
      ? svg`<image class="ap ap-${name}" href=${href} x="0" y="0" width=${w} height=${h} />`
      : svg`${nothing}`;
  return svg`${layer('frunk', a.frunk)}${layer('liftgate', a.liftgate)}${layer(
    'door',
    a.door
  )}${layer('window', a.window)}`;
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
  charge: ChargeVisual,
  apertures: ApertureState,
): TemplateResult {
  // The hand-tuned artwork is authored in its own intrinsic 1024×480 space; we
  // do NOT redraw those ~80 coordinates. Instead the outer <svg> adopts the
  // shared 1024×687 coordinate contract (HERO_VIEWBOX) and a nested <svg> places
  // the 1024×480 art inside it with `preserveAspectRatio="xMidYMid meet"` — so it
  // is centred and aspect-preserved (never stretched), sharing the same
  // coordinate space the body layers and Epic 4's overlays anchor to.
  return html`
    <svg
      class=${carClasses('car-img tc-car tc-ev', charge, apertures)}
      viewBox="0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}"
      style="--tc-paint:${paint}"
      role="img"
      aria-label=${name}
      xmlns="http://www.w3.org/2000/svg"
    >
      <svg
        viewBox="0 0 1024 480"
        width=${HERO_VIEWBOX.width}
        height=${HERO_VIEWBOX.height}
        preserveAspectRatio="xMidYMid meet"
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
      <use href="#tc-ev-body" fill="var(--tc-paint, #c6c8c9)" />

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

      <!-- ── aperture open-state overlays (Story 3.5, AC1/AC2) ──────────────
           Four INDEPENDENT open-state shapes anchored in the art's 1024×480
           coordinate space, one per aperture. Unlike the charge port (a single
           conditional node), these are ALWAYS present in the DOM at opacity 0 —
           a crossfade needs both endpoints, and an absent node can't fade (the
           one deliberate divergence from 3.4). Each fades in only when its
           .tc-car.<aperture>-open class is set (carStyles). The opened panel
           skin is NEUTRAL SILVER (#c6c8c9, "panel ajar") — deliberately NOT the
           --tc-paint recolor: per-aperture recolor of newly-exposed paint is v2
           (DESIGN.md:316).
           The exposed cavity/gap reuses the dark glass neutral (#10141a). -->
      <g class="ap ap-frunk">
        <!-- frunk: front clamshell raised up-left over the cowl (x≈300–410) -->
        <path d="M 296 210 L 404 205 L 404 218 L 296 224 Z" fill=${APERTURE_CAVITY} opacity="0.85" />
        <path d="M 298 208 L 312 150 L 412 134 L 406 204 Z" fill=${DEFAULT_PAINT} stroke="#9aa0a6" stroke-width="2" />
      </g>
      <g class="ap ap-liftgate">
        <!-- liftgate: rear hatch raised up-right over the tail (x≈648–828) -->
        <path d="M 648 206 L 822 188 L 824 202 L 648 220 Z" fill=${APERTURE_CAVITY} opacity="0.85" />
        <path d="M 648 200 L 660 100 L 830 168 L 824 212 Z" fill=${DEFAULT_PAINT} stroke="#9aa0a6" stroke-width="2" />
      </g>
      <g class="ap ap-door">
        <!-- door: front cabin door ajar, swung outward with a dark hinge gap (x≈524–650) -->
        <path d="M 524 216 L 536 216 L 542 350 L 530 350 Z" fill=${APERTURE_CAVITY} opacity="0.9" />
        <path d="M 538 216 L 652 228 L 652 352 L 544 350 Z" fill=${DEFAULT_PAINT} stroke="#9aa0a6" stroke-width="2" />
      </g>
      <g class="ap ap-window">
        <!-- window: front glass dropped — dark cabin showing through (over the glass path) -->
        <path d="M 410 188 L 466 118 L 556 118 L 556 188 Z" fill=${APERTURE_CAVITY} opacity="0.92" />
      </g>

      <!-- Charge-port glow + cable (Story 3.4, AC1/AC2). Anchored at the rear
           quarter just aft of the rear wheel (cx≈900) in the art's nested 1024×480
           coordinate space. The node + its .tc-car.<state> colour hook live in the
           shared chargePortOverlay() helper (Story 3.6 extraction) so the body-
           layers render emits the SAME node (DRY); colour stays in carStyles (blue
           plugged / green charging) so the --tc-* fallback gate is satisfied.
           Present for BOTH plugged and charging — charging ⇒ plugged (AC2). -->
      ${charge !== 'parked' ? chargePortOverlay(900, 300) : nothing}
      </svg>
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
    fill: var(--tc-paint, #c6c8c9);
  }
  .tc-car.charging {
    animation: tc-car-charge 2.4s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)) infinite;
  }
  @keyframes tc-car-charge {
    0%,
    100% {
      filter: drop-shadow(0 22px 30px rgba(0, 0, 0, 0.45));
    }
    50% {
      filter: drop-shadow(0 0 16px var(--tc-green, #34d399))
        drop-shadow(0 22px 30px rgba(0, 0, 0, 0.45));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    /* AC4 — the loop does not run, but the green must REMAIN (EXPERIENCE.md:174:
       "the pulsing charge halo becomes a static glow … not removed"). Pin a static
       green drop-shadow so the information (current is flowing) survives without
       motion; without this the base filter loses all green. The plugged-idle blue
       glow is inherently static (no keyframe), so it needs no guard. */
    .tc-car.charging {
      animation: none;
      filter: drop-shadow(0 0 14px var(--tc-green, #34d399))
        drop-shadow(0 22px 30px rgba(0, 0, 0, 0.45));
    }
  }

  /* ── charge-port glow + cable (Story 3.4) ──────────────────────────────
     Colour by state via the .tc-car.<state> hook (one place keeps the --tc-*
     fallbacks; the SVG nodes carry no inline hex). Blue = plugged (connected, at
     rest); green = charging (drawing). Both render the same nodes — charging ⇒
     plugged (AC2). */
  .tc-car.plugged .tc-port-glow,
  .tc-car.plugged .tc-port-core {
    fill: var(--tc-blue, #38bdf8);
  }
  .tc-car.plugged .tc-port-cable {
    stroke: var(--tc-blue, #38bdf8);
  }
  .tc-car.charging .tc-port-glow,
  .tc-car.charging .tc-port-core {
    fill: var(--tc-green, #34d399);
  }
  .tc-car.charging .tc-port-cable {
    stroke: var(--tc-green, #34d399);
  }
  .tc-port-glow {
    opacity: 0.4;
    filter: blur(7px);
  }
  .tc-port-cable {
    stroke-width: 7;
    stroke-linecap: round;
    opacity: 0.85;
  }

  /* ── aperture open-state crossfade (Story 3.5, AC1/AC4) ────────────────
     Each overlay is always in the DOM at opacity 0 and crossfades in via an
     opacity TRANSITION (EXPERIENCE.md:162 "Layers, never page reloads") — a
     transition, never a new keyframe (the locked a11y corpus {tc-pulse,
     tc-shimmer} stays untouched; this rule lives in carStyles, not
     sharedStyles). One .ap base rule covers BOTH render modes (the bundled
     generic-EV groups and the body-layers image.ap), DRY. Reuse the
     shared --tc-ease token WITH its fallback (the fallback-value gate is hard). */
  .ap {
    opacity: 0;
    transition: opacity 0.3s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
  }
  .tc-car.frunk-open .ap-frunk,
  .tc-car.liftgate-open .ap-liftgate,
  .tc-car.door-open .ap-door,
  .tc-car.window-open .ap-window {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    /* AC4 — the crossfade becomes an INSTANT CUT (EXPERIENCE.md:174 "aperture and
       charge-state crossfades become instant cuts"). The open/closed information
       is fully preserved (opacity still flips 0↔1); only the fade is removed.
       Kill the motion, keep the data — the direct analogue of 3.4's reduced-motion
       fix. */
    .ap {
      transition: none;
    }
  }
`;
