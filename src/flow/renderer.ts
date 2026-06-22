import {
  mdiSolarPower,
  mdiHomeBattery,
  mdiTransmissionTower,
  mdiHomeLightningBolt,
  mdiEvStation,
  mdiGeneratorStationary,
} from '@mdi/js';
import type { EnergyRole } from '../data/registry';
import type { Direction, FlowEdge, FlowModel } from './model';

/**
 * D1 — the renderer SEAM (Story 4.3). `interface FlowRenderer { update(model) }`
 * is the ONE contract every energy renderer implements: `HeroSvgRenderer` (4.3,
 * static 1024×687 coords) and `SceneBusRenderer` (4.4, live `getBoundingClientRect`
 * anchors) both take a {@link FlowModel} and draw it — only the COORDINATE SOURCE
 * differs, never the data path or the kW→visual math.
 *
 * `@unstable` / INTERNAL: this is NOT part of the public `TeslaCardConfig` surface.
 * The freeze is deferred to the Epic-6 Scene-bus productionization (architecture.md
 * :1070) — do not grow a public renderer API before then.
 *
 * `update(model): void` is deliberately DOM-free: it hands the renderer a fresh
 * model and the renderer caches it (HeroSvg precomputes static geometry; SceneBus
 * will re-anchor against live rects). A renderer exposes its drawn output through a
 * renderer-specific accessor (HeroSvg's `view()`), so the interface never forces a
 * DOM root on a declarative Lit consumer.
 */
export interface FlowRenderer {
  /** Feed the renderer a fresh model. Pure cache/precompute — no DOM required. */
  update(model: FlowModel): void;
}

/** The width/duration an edge's |kW| maps to — the shared visual encoding. */
export interface EdgeVisual {
  /** Stroke width (canonical units) — thicker = more power. */
  width: number;
  /** Dash-flow animation period (seconds) — shorter = faster = more power. */
  durSec: number;
}

/**
 * The CANONICAL kW→visual derivation (architecture D1.1b — the EXACT formulas):
 *   width = 1.6 + |kW|·0.55   (magnitude → thickness)
 *   dur   = max(0.5, 1.7 − |kW|·0.16)  (magnitude → speed; clamped so a huge kW
 *           never animates faster than 0.5s)
 *
 * This is the "one model, two renderers, IDENTICAL math" guarantee: Story 4.4's
 * `SceneBusRenderer` imports THIS function verbatim and a 4.4 test asserts the two
 * renderers derive edge visuals identically — only the coordinate source differs.
 * So the math MUST live here, shared, never inlined where 4.4 can't reach it.
 *
 * Pure & sign-agnostic: it consumes |kW| (the SIGN drives `direction`, not the
 * visual weight). A `quiescent`/`direction:'none'` edge gets NO motion — the
 * RENDERER suppresses the animation, not this formula (it still returns a width so
 * a calm base track has a sane thickness).
 */
export function edgeVisual(kW: number): EdgeVisual {
  const mag = Math.abs(kW);
  return {
    width: 1.6 + mag * 0.55,
    durSec: Math.max(0.5, 1.7 - mag * 0.16),
  };
}

/**
 * The full per-edge DERIVED visual — the renderer-INDEPENDENT half of drawing an
 * edge (everything EXCEPT the `source`/`sink` coordinates, which are the ONE thing
 * a renderer owns locally). `width`/`durSec` are the canonical {@link edgeVisual}
 * output (PRE any renderer presentation scale — HeroSvg's `STROKE_SCALE`, SceneBus's
 * none); `color` is the source-node accent; `direction` is the model's resolved
 * sense (never re-derived); `active` is `direction !== 'none'` (quiescent ⇒ calm).
 */
export interface EdgeVisuals {
  width: number;
  durSec: number;
  direction: Direction;
  /** SOURCE-node accent (`NODE_COLOR[edge.from]`) — hue says where power comes from. */
  color: string;
  /** `false` for `direction:'none'` (quiescent/idle) → calm base track, no motion. */
  active: boolean;
}

/**
 * The ONE shared per-edge visual derivation (Story 4.4, R1 "consume the one
 * constant" discipline). BOTH `HeroSvgRenderer` and `SceneBusRenderer` call THIS —
 * never a private re-implementation — so the AC3 "two renderers derive identically"
 * property holds STRUCTURALLY (one call site), not by parallel formulas that could
 * silently drift. The coordinate `source`/`sink` points stay renderer-local; this
 * derives only the model-dependent visual (a function of the edge alone). A sign bug
 * here would flip every renderer at once — which is exactly why it lives in one place.
 */
export function edgeVisuals(edge: FlowEdge): EdgeVisuals {
  const { width, durSec } = edgeVisual(edge.kW);
  return {
    width,
    durSec,
    direction: edge.direction,
    color: NODE_COLOR[edge.from as EnergyRole],
    active: edge.direction !== 'none',
  };
}

/** A {@link EdgeVisuals} tagged with its source role — the shape both renderers expose. */
export type RoleVisual = { role: EnergyRole } & EdgeVisuals;

/**
 * Node → accent colour (FR-9, the {@link import('../styles').ACCENT_SEMANTICS}
 * contract): solar→amber, grid→neutral-dim, powerwall→green, home→blue,
 * wall_connector→teal. Values are full `var(--tc-*, hex)` reads (DESIGN.md fallback
 * carried — the `styles.test.ts` hard gate). The edge takes its SOURCE node's
 * colour (the `from` node of each edge), so the hue says where power comes from.
 * Keyed by `EnergyRole` so the map can never omit a role (mirrors panel-energy `N`).
 */
export const NODE_COLOR: Readonly<Record<EnergyRole, string>> = {
  solar: 'var(--tc-amber, #fbbf24)',
  grid: 'var(--tc-text-dim, #9aa7b8)',
  powerwall: 'var(--tc-green, #34d399)',
  home: 'var(--tc-blue, #38bdf8)',
  wall_connector: 'var(--tc-teal, #2dd4bf)',
  generator: 'var(--tc-copper, #c2855b)', // Story 9.14 — the 8th accent (generator / fuel)
} as const;

/**
 * Node → monoline MDI icon path (`@mdi/js` named paths only — never raster;
 * rendered `fill: currentColor`). Keyed by `EnergyRole` so it cannot omit a role.
 */
export const NODE_ICON: Readonly<Record<EnergyRole, string>> = {
  solar: mdiSolarPower,
  grid: mdiTransmissionTower,
  powerwall: mdiHomeBattery,
  home: mdiHomeLightningBolt,
  wall_connector: mdiEvStation,
  generator: mdiGeneratorStationary,
} as const;
