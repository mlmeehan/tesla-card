import type { FlowModel } from './model';

/**
 * D1 — Balance authority (the #1 verification target).
 *
 * This module is the SINGLE place per-node net + edge balance are computed. Every
 * energy surface (Epic 3 Hero, Epic 5 panels, Epic 6 Scene) derives from THIS
 * result; renderers consume it and never recompute. Concentrating the math here
 * is deliberate: central balance means Hero and Scene physically "can't disagree"
 * — but they also can't disagree when both wrong, so one sign bug would flip every
 * surface at once. That FMEA mode is exactly why balance is the priority test
 * target (sign-convention + conservation property tests, incl. quiescent/absent).
 *
 * ── The sign / unit convention, declared ONCE, here ──────────────────────────
 * Any surface that infers flow direction from signed power consumes THIS module's
 * convention — never a private copy:
 *   • power is in **kW everywhere** (never W);
 *   • **battery `+` = charging** (power into the Powerwall);
 *   • **grid `+` = import** (power drawn from the grid);
 *   • an edge's **`direction` from → to is the positive-flow sense** (a positive
 *     `FlowEdge.kW` runs `from → to`).
 * Raw sensors that disagree (tesla_fleet/powerwall report battery `−` = charging)
 * are normalized to this convention at the `data/dialect` boundary BEFORE a value
 * ever reaches the FlowModel — so balance only ever sees canonical signs.
 *
 * Role-genericity: balance reads `FlowEdge.kW` (already oriented bus-ward by the
 * model via the registry's `BUS_ORIENTATION`) and aggregates by node id. It has
 * NO per-node-type branch — a new energy node is a registry + component edit,
 * never a balance edit (the compute boundary). Pure logic: no `lit`/DOM, no
 * `hass`, no upward import.
 */

/**
 * Conservation tolerance (kW). Kirchhoff at the bus is exact in the fixture
 * corpus; real measured readings carry rounding/sampling noise, so "balanced"
 * means within this band rather than bit-exact zero. A documented engineering
 * choice — the property tests assert the conservation RULE relative to it, not
 * this constant as ground truth.
 */
const EPSILON_KW = 0.05;

/** The balance result: per-node net + the conservation check. */
export interface Balance {
  /**
   * Per-node net, kW, keyed by node id. For a real energy node this is its
   * signed injection into the bus (`+` = source/discharge/export, `−` =
   * sink/charge/import-consumed); the implicit `bus` endpoint carries the
   * negated total. Renderers read this; they never recompute it.
   */
  net: Record<string, number>;
  /**
   * Conservation residual, kW: the signed sum of the real nodes' net injections
   * (Kirchhoff at the bus). `0` ⇔ perfectly balanced; non-zero = unmodelled or
   * mis-signed flow.
   */
  residual: number;
  /** `true` when `|residual| ≤ EPSILON_KW` — the bus balances within tolerance. */
  balanced: boolean;
}

/**
 * Compute per-node net + the conservation residual for a {@link FlowModel}.
 * Graph-generic: net[id] aggregates every incident edge (`+kW` where the node is
 * the edge's `from`, `−kW` where it is the `to`), so the implicit bus endpoint
 * accumulates the negated total. The residual sums net over the model's REAL
 * nodes (the bus is excluded — including it would make the sum a trivial zero):
 * that sum is the bus imbalance, which conservation requires to be ~0.
 */
export function computeBalance(model: FlowModel): Balance {
  const net: Record<string, number> = {};
  for (const edge of model.edges) {
    net[edge.from] = (net[edge.from] ?? 0) + edge.kW;
    net[edge.to] = (net[edge.to] ?? 0) - edge.kW;
  }
  let residual = 0;
  for (const node of model.nodes) residual += net[node.id] ?? 0;
  return { net, residual, balanced: Math.abs(residual) <= EPSILON_KW };
}
