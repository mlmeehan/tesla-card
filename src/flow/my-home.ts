import type { EnergyRole } from '../data/registry';
import { ENERGY_ROLES } from './binding';
import { BUS_NODE_ID } from './model';
import type { RectLike } from './scene-bus';

/**
 * D4 — "My Home" Scene orchestration HUB (Story 6.5).
 *
 * The pure / DOM-light helpers the `tc-my-home` element (`components/my-home.ts`)
 * delegates to — the "thin element" split: testable logic lives HERE in `flow/`,
 * the element file is render + lifecycle only. This hub does the geometry MATH
 * (anchor relativization, the bus junction, the reflow coalescer); the element
 * does the geometry READS (`getBoundingClientRect()`) and feeds the results here.
 *
 * Boundary: imports only `data/` types + sibling `flow/` + root leaves —
 * NOTHING from `components/` (`no-cycle` enforces the `data/ ← flow/ ←
 * components/` arrow; this is precisely WHY the orchestration logic lives in
 * `flow/`, not in the element). It touches no `hass`/`hass.states` (the element's
 * slice-gate routes through `data/slice`), no `lit`/DOM. `requestAnimationFrame`/
 * `cancelAnimationFrame` are global browser APIs (not imports) and are the ONLY
 * sanctioned loop (D3); the coalescer fires once per `schedule`, never on a timer.
 */

/**
 * The node-id order the Scene lays out and anchors — IS the five flow
 * `ENERGY_ROLES` (solar / powerwall / grid / home / wall_connector), re-exported
 * so the Scene never forks a second role list. There is no `vehicle` role: the
 * wall-connector edge IS the car-charging edge (the composed-view authority
 * split), and the Hero — not a Scene card — is the vehicle. The derived
 * {@link BUS_NODE_ID} junction is the only other anchor the Scene reads.
 */
export const SCENE_NODES: readonly EnergyRole[] = ENERGY_ROLES;

/**
 * Convert ABSOLUTE viewport rects (`getBoundingClientRect()`) to
 * CONTAINER-RELATIVE coordinates by subtracting the container's own origin, so
 * the `pointer-events:none` bus overlay SVG — positioned over the container —
 * draws in the container's own coordinate space (mirrors the mockup's
 * `r.left - cb.left` relativization, `myhome-cards-bus.html:858–864`). Pure +
 * table-testable; widths/heights pass through unchanged (translation only).
 */
export function relativeAnchors(
  container: RectLike,
  rects: Readonly<Record<string, RectLike>>
): Record<string, RectLike> {
  const out: Record<string, RectLike> = {};
  for (const id of Object.keys(rects)) {
    const r = rects[id];
    out[id] = {
      left: r.left - container.left,
      top: r.top - container.top,
      width: r.width,
      height: r.height,
    };
  }
  return out;
}

/**
 * Derive the {@link BUS_NODE_ID} junction rect from the present node anchors — a
 * role-less, zero-size rect at the CENTROID of the present node centres (its
 * `centre()` IS the centroid point the star bus radiates from). The simplest
 * faithful default for 6.5: `SceneBusRenderer` already falls back to the centroid
 * of present anchors when no `'bus'` rect is supplied (`scene-bus.ts:185–198`),
 * so this is the explicit, table-testable version of that junction — supplying it
 * keeps the bus stable across reflows. (Story 6.6 replaces this star-junction with
 * the Gateway trunk — kept deliberately simple here.) Any existing `BUS_NODE_ID`
 * entry is excluded from the centroid so the derivation is idempotent. Returns
 * `undefined` when there are no node anchors (nothing to anchor a junction to).
 */
export function deriveBusAnchor(
  anchors: Readonly<Record<string, RectLike>>
): RectLike | undefined {
  const rects = Object.keys(anchors)
    .filter((k) => k !== BUS_NODE_ID)
    .map((k) => anchors[k]);
  if (!rects.length) return undefined;
  const n = rects.length;
  const cx = rects.reduce((s, r) => s + r.left + r.width / 2, 0) / n;
  const cy = rects.reduce((s, r) => s + r.top + r.height / 2, 0) / n;
  // Zero-size rect: its centre IS (cx, cy) — the role-less junction point.
  return { left: cx, top: cy, width: 0, height: 0 };
}

/**
 * A tiny, dependency-free COALESCING scheduler: collapse a burst of reflow
 * callbacks into ONE rAF-aligned fire. A single pending `requestAnimationFrame`
 * handle — `schedule` is idempotent within a frame (extra calls while one is
 * pending are dropped, the first callback wins), `cancel` clears the pending fire.
 * This is the AR-8 debounce against reflow storms: `ResizeObserver`/
 * `IntersectionObserver` can fire many times in one layout pass, but the geometry
 * recompute runs at most once per frame.
 *
 * `requestAnimationFrame`/`cancelAnimationFrame` are the ONLY sanctioned loop
 * (D3) — and this coalescer never self-perpetuates: it fires once per `schedule`,
 * it does not re-arm itself, so there is no free-running rAF loop to leak (the
 * dash MOTION is pure CSS, `sceneBusStyles`). The rAF/cAF pair is injectable for
 * hermetic unit tests (a fake scheduler), defaulting to the globals at runtime.
 */
export class RafCoalescer {
  private _handle: number | null = null;
  private readonly _raf: (cb: () => void) => number;
  private readonly _caf: (handle: number) => void;

  constructor(
    raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    caf: (handle: number) => void = (h) => cancelAnimationFrame(h)
  ) {
    this._raf = raf;
    this._caf = caf;
  }

  /** Schedule `cb` for the next frame; idempotent while a fire is already pending. */
  schedule(cb: () => void): void {
    if (this._handle !== null) return; // already pending this frame — coalesce
    this._handle = this._raf(() => {
      this._handle = null;
      cb();
    });
  }

  /** Cancel any pending fire (teardown / `disconnectedCallback`). */
  cancel(): void {
    if (this._handle !== null) {
      this._caf(this._handle);
      this._handle = null;
    }
  }

  /** `true` while a fire is pending — for teardown assertions (no leak). */
  get pending(): boolean {
    return this._handle !== null;
  }
}
