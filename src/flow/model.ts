import type { EnergyRole } from '../data/registry';
import { BUS_ORIENTATION } from '../data/registry';

/**
 * D1 — Flow data-model (the canonical shapes every energy surface derives from).
 *
 * This module owns the SHAPES (`FlowNode` / `FlowEdge` / `FlowModel`) and a
 * role-generic assembler (`buildFlowModel`) that turns per-role canonical
 * readings into nodes + edges. It computes NO balance: per-node net and the
 * conservation check are the SOLE export of `flow/balance.ts` (the compute
 * boundary — renderers and this assembler consume balance, never recompute it).
 *
 * Boundary: `flow/` imports only `data/` types/values + root utils; it imports
 * NOTHING from `components/` and needs no `lit`/DOM (pure logic). The one runtime
 * dependency is `data/registry`'s `BUS_ORIENTATION` (role metadata) — the arrow
 * is `data → flow`, never reverse. The model is ROLE-GENERIC: it has no
 * `if (role === 'solar')` branch anywhere — a new energy node is a registry +
 * component edit, never a model/balance edit.
 *
 * Topology: the five energy roles (solar / powerwall / grid / home / wall
 * connector) attach to one implicit electrical junction, the {@link BUS_NODE_ID}
 * bus (a role-less edge endpoint, not a `FlowNode`). Each present node gets one
 * edge to the bus carrying its SIGNED exchange. Conservation (Kirchhoff at the
 * bus) ⇔ the per-node injections sum to zero — asserted by `balance.ts`.
 */

/**
 * Provenance of an edge's value (D1.1c). `measured` = read live from a fresh
 * source; `inferred` = derived/back-computed (4.2); `quiescent` = the source is
 * not fresh (stale/asleep/unavailable) so the value is a last-known echo, carried
 * but flagged — never optimistic. Flow edges are `measured`/`inferred`/`quiescent`
 * only, NEVER optimistic (optimism is command/chrome state, D1).
 */
export type Provenance = 'measured' | 'inferred' | 'quiescent';

/**
 * Resolved flow sense of an edge, a convenience denormalization of {@link
 * FlowEdge.kW}'s sign so renderers (4.3/4.4) don't each re-derive it:
 *   - `forward`  → flow runs `from → to` (kW > idle)
 *   - `reverse`  → flow runs `to → from` (kW < −idle)
 *   - `none`     → idle / below threshold, or `quiescent` (no live flow to draw)
 * `from → to` is the declared POSITIVE-flow sense (AC2): a positive `kW` always
 * means `forward`. The signed `kW` is the source of truth; `direction` is derived.
 */
export type Direction = 'forward' | 'reverse' | 'none';

/**
 * One directed edge in the flow graph. `kW` is SIGNED with `from → to` as the
 * positive-flow sense (AC2) — we keep a stable `from`/`to` identity and encode
 * reversal (battery charge↔discharge, grid import↔export) as the SIGN, rather
 * than swapping endpoints, so a renderer animates reversal by sign and never
 * re-keys the edge. `kW` is kilowatts everywhere (never W). Internal shape — NOT
 * part of the public `TeslaCardConfig` surface.
 */
export interface FlowEdge {
  /** Source node id (a {@link FlowNode.id} or {@link BUS_NODE_ID}). */
  from: string;
  /** Target node id (a {@link FlowNode.id} or {@link BUS_NODE_ID}). */
  to: string;
  /** Signed power, kW; `from → to` positive (AC2). */
  kW: number;
  /** Resolved sense derived from `kW`'s sign (see {@link Direction}). */
  direction: Direction;
  /** Where this edge's value came from (see {@link Provenance}). */
  provenance: Provenance;
}

/** One node in the flow graph. Internal shape — not part of `TeslaCardConfig`. */
export interface FlowNode {
  /**
   * Stable node id — the per-instance id (Story 9.7): the bare {@link EnergyRole}
   * for a single instance (FR-33 zero-diff), `role:n` for a duplicated role. Balance
   * keys net BY THIS id, so duplicated roles get independent taps.
   */
  id: string;
  /** The canonical registry role this node plays (drives `BUS_ORIENTATION`; balance stays role-generic). */
  role: EnergyRole;
  /** `true` when a live reading resolved for this node; `false` = absent. */
  present: boolean;
}

/** The assembled model two renderers consume; balance reads it, never recomputes. */
export interface FlowModel {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * One per-role canonical reading fed into the assembler. The dialect boundary
 * (`data/dialect`, AC3) has ALREADY normalized signs to the canonical convention
 * (battery + = charging, grid + = import) before a reading reaches here — the
 * model never sees a raw dialect sign. `kW === undefined` ⇒ the node is absent.
 *
 * NOTE: producing these inputs from auto-detect + live reads (NaN-safe, measured-
 * vs-inferred, freshness→quiescent coupling) is Story 4.2's binding layer. 4.1
 * defines the shape and the assembler; callers/tests supply inputs directly.
 */
export interface FlowInput {
  role: EnergyRole;
  /**
   * Per-instance node id (Story 9.7). `undefined` ⇒ the node id IS the role (a
   * single instance — FR-33 zero-diff); a duplicated role supplies `role:1`/`role:2`
   * (see `flow/instances.ts` `instanceId`). Because {@link buildFlowModel} keys the
   * `FlowNode.id`/`FlowEdge.from` off this and `balance.ts` aggregates net BY NODE
   * ID, N same-role inputs become N independent bus taps with NO balance edit (AR-6).
   */
  id?: string;
  /** Canonical signed power, kW; `undefined` ⇒ absent node (no edge). */
  kW: number | undefined;
  provenance: Provenance;
}

/** The implicit electrical junction every energy node attaches to (role-less). */
export const BUS_NODE_ID = 'bus';

/**
 * Magnitude (kW) below which a live flow is treated as idle (`direction:'none'`).
 * Exported so the Story-4.2 binding reuses THIS one threshold as its magnitude
 * deadband (provenance→`quiescent`) instead of forking a 4th `0.05` literal — the
 * meaning is identical ("below this, there is no flow to draw"). [Story 4.2 AC5]
 */
export const IDLE_KW = 0.05;

/** Resolve an edge's {@link Direction} from its signed kW + provenance. */
function senseOf(kW: number, provenance: Provenance): Direction {
  if (provenance === 'quiescent') return 'none'; // no live flow to animate
  if (kW > IDLE_KW) return 'forward';
  if (kW < -IDLE_KW) return 'reverse';
  return 'none';
}

/**
 * Assemble a {@link FlowModel} from per-role canonical readings. ROLE-GENERIC:
 * the only role-dependent fact consulted is `BUS_ORIENTATION[role]` (registry
 * metadata: +1 = a positive canonical reading injects into the bus, −1 = draws
 * from it). A present node becomes a `FlowNode` plus one edge `node → bus` whose
 * signed `kW` is the node's flow INTO the bus (`orientation × canonicalKW`). An
 * absent node (`kW === undefined`) becomes a `present:false` node with no edge.
 * Balance/conservation is left entirely to `flow/balance.ts`.
 */
export function buildFlowModel(inputs: readonly FlowInput[]): FlowModel {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  for (const input of inputs) {
    const present = input.kW !== undefined;
    // Story 9.7: the node id is the per-instance id when supplied, else the role
    // (single instance ⇒ bare role ⇒ byte-identical to pre-9.7). `role` still drives
    // BUS_ORIENTATION, so balance stays role-generic; only IDENTITY became per-instance.
    const id = input.id ?? input.role;
    nodes.push({ id, role: input.role, present });
    if (!present) continue;
    // Signed flow into the bus: +ve = this node injects, −ve = it draws.
    const kW = BUS_ORIENTATION[input.role] * (input.kW as number);
    edges.push({
      from: id,
      to: BUS_NODE_ID,
      kW,
      direction: senseOf(kW, input.provenance),
      provenance: input.provenance,
    });
  }
  return { nodes, edges };
}
