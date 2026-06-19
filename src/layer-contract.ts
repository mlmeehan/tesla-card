// The published `@unstable` Layer contract (FR-7 / AR-13; architecture.md D6).
//
// This is the machine-checkable HALF of the Layer contract — the project's
// established pattern for a published surface (mirror `styles.ts`'s
// `ACCENT_SEMANTICS`/`FRESHNESS_STATES`/`BREAKPOINTS`: an `as const` map IS the
// machine-checkable contract, the comments are the human half; the prose half is
// `docs/layer-contract.md`). A test (`layer-contract.test.ts`) asserts this map's
// shape AND that it agrees with the `BodyLayers` type, so the contract cannot
// silently drift from its consumers (`car.ts`'s `isConformingBody`, `types.ts`).
//
// `unstable: true` is load-bearing: the contract is designed + consumed
// internally this phase but its PUBLIC FREEZE is a ONE-WAY DOOR (architecture.md
// :39-40, :121, :183, :508-509, :806, :1070) gated behind asset-pipeline
// productionization. Story 3.7 (bring-your-own renders / WebP packs) builds on
// this shape; the freeze comes later. Say so loudly: pack authors must know the
// shape MAY shift before it freezes.
//
// Leaf module: imports only `./const` for `HERO_VIEWBOX` — no `data/`/`flow/`/
// `components/` edge, so `no-cycle` stays trivially green and `car.ts` can import
// it without a cross-layer cycle. Keep it generic — NO Tesla names, NO brand hex
// (the trade-dress denylist scans `src/`); the contract describes a generic 3/4
// EV render, never a specific vehicle.

import { HERO_VIEWBOX } from './const';

/**
 * @unstable — published Layer contract (FR-7). Public surface; its freeze is a
 * one-way door (architecture.md D6), so this MAY change before it freezes.
 *
 * A conforming body render is a set of identically-sized, registration-aligned
 * layers + named overlay nodes, all anchored to the 1024×687 coordinate contract
 * (`HERO_VIEWBOX`, Story 3.1) and shot from a front-right 3/4 camera. The
 * constraints exist so overlays composite correctly:
 *
 * - `requiredLayers` (`color`/`shade`/`mask`) — the minimum a recolorable body
 *   needs: `color` base (real glass/wheels/lights/shadow), `shade` (×multiply
 *   form) and `mask` (white = paint region). Drop any and the recolor stack
 *   renders a broken `<image>` — so `isConformingBody` rejects a body missing one.
 * - `optionalLayers` (`highlight`) — clearcoat glints (×screen); absent = matte.
 * - `nodes` (`apertureLayers`/`chargePort`) — named overlay anchors, not paint
 *   layers; absent = that cue simply doesn't render (graceful by construction).
 * - identical pixel size + alignment (registration) — every layer/overlay must
 *   share the same canvas, car position/scale, camera & lens (aperture-render-
 *   spec.md:17-20); mis-registered layers composite wrong.
 * - `viewBox` = `HERO_VIEWBOX` (1024×687) + `camera` '3/4' — the coordinate
 *   contract the `chargePort` anchor and aperture regions are measured in.
 */
export const LAYER_CONTRACT = {
  /** Contract revision — bump on any shape change while `unstable` (no back-compat owed yet). */
  version: 1,
  /** Public freeze is a ONE-WAY DOOR (architecture.md:183) — deferred behind the asset pipeline. */
  unstable: true,
  /** Every layer & overlay node anchors to the 1024×687 coordinate contract (Story 3.1). */
  viewBox: HERO_VIEWBOX,
  /** Front-right 3/4 camera — fixed across every conforming render (aperture-render-spec.md:15). */
  camera: '3/4',
  /** The minimum recolorable stack; a body missing any of these is non-conforming. */
  requiredLayers: ['color', 'shade', 'mask'] as const,
  /** Clearcoat glints (×screen); omit for a matte finish. */
  optionalLayers: ['highlight'] as const,
  /** Named overlay anchors (not paint layers) — absent ⇒ that cue doesn't render. */
  nodes: ['apertureLayers', 'chargePort'] as const,
} as const;
