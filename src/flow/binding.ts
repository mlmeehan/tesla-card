import type { HomeAssistant, TeslaCardConfig } from '../types';
import type { EnergyRole, Role } from '../data/registry';
import { resolveEnergyEntities, numById, type EnergyEntities } from '../data/energy';
import { adapterFor } from '../data/dialect';
import { read, isQuiescent, type ReadOpts } from '../data/freshness';
import { buildFlowModel, IDLE_KW, type FlowInput, type FlowModel, type Provenance } from './model';
import { roleInstances } from './instances';

/**
 * D1 — Flow data BINDING (Story 4.2). Turns `(hass, config)` into the per-role
 * canonical `FlowInput[]` that `flow/model.ts` `buildFlowModel` assembles into the
 * `FlowModel` the renderers (4.3/4.4) consume. This is the productionization of
 * the test-only stand-in that lived in `balance.test.ts`: it RESOLVES entities
 * (auto-detect by function-name, `_2`-tolerant, overrides-win — all owned by
 * `data/energy`), READS each role NaN-safe, NORMALIZES the sign to canonical at
 * the `data/dialect` boundary, and DERIVES provenance (it is no longer hand-
 * supplied per fixture).
 *
 * Boundary: pure logic in `flow/` — imports only `data/` (resolution, NaN-safe
 * reads, freshness, dialect) + sibling `flow/model.ts`, and NOTHING from
 * `components/`; no `lit`/DOM. All `hass.states` access stays behind `data/`
 * (`numById`/`read`), so `no-bare-hass-states`/`no-cycle` stay green by
 * construction. The arrow is `data → flow`, never reverse.
 */

/**
 * The representative signed-power function-key per energy role — the ONE
 * definition production and tests share (the former `POWER_KEY` stub in
 * `balance.test.ts` is lifted here so the two can never drift onto different
 * sensors). Keyed by `EnergyRole` so it cannot omit a role.
 */
export const POWER_KEY: Readonly<Record<EnergyRole, keyof EnergyEntities>> = {
  solar: 'solar_power',
  powerwall: 'battery_power',
  grid: 'grid_power',
  home: 'load_power',
  wall_connector: 'wc_power',
  generator: 'generator_power',
} as const;

/** The six energy roles, in `POWER_KEY` order. Never the 7-role suite `ROLES` (no `vehicle` in the flow model). */
export const ENERGY_ROLES = Object.keys(POWER_KEY) as EnergyRole[];

/**
 * Magnitude (kW) below which a fresh reading is treated as quiescent (AC5) — a
 * jitter guard so sensor noise near zero never animates as flow. Deliberately the
 * SAME threshold the model uses for `direction:'none'` (`IDLE_KW`), reused rather
 * than copied: the meaning is identical, and there must be no 4th independent
 * `0.05` (the others: `IDLE_KW` here, `EPSILON_KW` in balance.ts, `THRESH` in the
 * legacy panel). The model already forces `direction:'none'` below `IDLE_KW`; the
 * deadband's ADDITIONAL job is the PROVENANCE flag, so a sub-idle edge reads
 * `quiescent` (calm) rather than a sub-idle "measured" edge.
 */
export const DEADBAND = IDLE_KW;

/**
 * The canonical ABSENT-node `FlowInput`: `kW:undefined` ⇒ `buildFlowModel` emits
 * `present:false` with NO edge. The ONE definition of "this node is not here",
 * shared by the two ways a node goes absent — its entity is unresolved/non-finite
 * ({@link flowInputFor}), or the Scene HID it ({@link flowInputsFrom}, Story 9.2).
 * Sharing this literal is what makes "hidden == absent" true BY CONSTRUCTION (CAP-4
 * / INV-2) instead of by two literals coincidentally matching — they can never
 * drift. Provenance is moot (no edge is emitted); `'measured'` is the neutral
 * placeholder `buildFlowModel` ignores for a `present:false` node.
 */
function absentInput(role: EnergyRole, id: string = role): FlowInput {
  return { role, id, kW: undefined, provenance: 'measured' };
}

/**
 * Bind one role to its canonical `FlowInput`. Pipeline: resolve → NaN-safe read →
 * dialect-normalize → derive provenance. An unresolved id or a missing/`unavailable`
 * /non-finite read yields `kW: undefined` ⇒ `buildFlowModel` emits `present:false`
 * with NO edge (AC4) — we never synthesize a zero-kW edge for an absent node.
 */
function flowInputFor(
  hass: HomeAssistant | undefined,
  adapter: ReturnType<typeof adapterFor>,
  entities: EnergyEntities,
  role: EnergyRole,
  opts: ReadOpts,
  nodeId: string = role
): FlowInput {
  const id = entities[POWER_KEY[role]];
  // NaN-safe read (no id / unavailable / non-finite → undefined), then normalize
  // the raw sign to canonical (flips powerwall; passthrough otherwise; undefined
  // in → undefined out). The model must only ever see canonical signs.
  const kW = adapter.normalizePower(role, numById(hass, id)).value;
  if (id === undefined || kW === undefined) {
    // Absent node — the canonical "not here" input (shared with the hide path).
    //
    // AC2/AC4 reconciliation: a quiescent EDGE needs a last-known number to echo,
    // so the freshness→quiescent coupling below only fires for a stale/asleep
    // source that still carries a numeric reading. A NON-numeric not-fresh source
    // (state literally `unavailable`/`unknown` ⇒ `numById` → undefined, and
    // `freshness.read` staleness `'unavailable'`) has nothing to carry — it
    // becomes an ABSENT node (AC4 + the buildFlowModel `kW===undefined` contract),
    // never a phantom zero-kW edge. So `staleness:'unavailable'` ⇒ absent here;
    // `stale`/`asleep` (numeric echo) ⇒ a present `quiescent` edge.
    return absentInput(role, nodeId);
  }

  // Provenance is normalization-aware, NOT flip-aware: a fresh direct read is
  // `measured` even when the dialect tagged the sign-flip `derived:true` (a flip
  // is normalization, not inference). `inferred` is reserved for kW that is
  // genuinely BACK-COMPUTED from other quantities (e.g. a future Solar→Vehicle
  // split) — the present node→bus corpus produces NO inferred edge, only
  // `measured` (fresh) or `quiescent` (not-fresh OR sub-deadband).
  const quiescent = isQuiescent(read(hass, id, opts)) || Math.abs(kW) < DEADBAND;
  const provenance: Provenance = quiescent ? 'quiescent' : 'measured';
  // Quiescent still carries the (last-known) value; only the flag changes —
  // `senseOf` maps quiescent → `direction:'none'`, so it renders present-and-calm.
  return { role, id: nodeId, kW, provenance };
}

/**
 * Produce the canonical per-role `FlowInput[]` from live HA state. Resolution
 * (`resolveEnergyEntities`) already honors `config.energy.entities` overrides and
 * auto-detects the rest — we do NOT re-implement either. `opts` (freshness
 * `ReadOpts`) is for hermetic tests (inject `now`); renderers omit it.
 *
 * `hide` (Story 9.2) is the Scene's opt-in node-hide set — a SEPARATE param, NOT
 * an `opts` field (the freshness `ReadOpts` semantics stay untouched). A role in
 * `hide` that is also an `ENERGY_ROLES` member is forced to the SAME `kW:undefined`
 * an absent/unresolved entity already produces (`flowInputFor` lines 72-85), so
 * `buildFlowModel` emits `present:false` with NO edge. There is no separate "hidden"
 * code path: hidden == absent by construction (CAP-4 / INV-2). Default `[]` keeps
 * every existing caller — notably the Hero (`components/hero.ts`) — a zero-diff.
 * FR-24: an unknown / non-energy string in `hide` (e.g. `'vehicle'`, `'not_a_node'`)
 * simply never matches an energy role here, so it is inert — never thrown.
 *
 * Story 9.7 — MULTI-INSTANCE expansion (the mirror of 9.2's hide at this same seam):
 * instead of REMOVING a role's input, EXPAND it to N inputs. Each role maps to its
 * `roleInstances` list (`energy.nodes.instances`, default `[{}]` ⇒ exactly one input
 * ⇒ zero-diff). Each instance binds its OWN resolved entity set —
 * `{ ...autoResolved, ...spec.entities }`, instance override wins (registry-keyed,
 * AR-1) — and carries its `instanceId`, so `buildFlowModel` emits N independent
 * present nodes and `balance.ts` (keyed by node id) sums them with NO balance edit
 * (AR-6). A hidden role still drops ALL its instances (the single absent input).
 */
export function flowInputsFrom(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  opts: ReadOpts = {},
  hide: readonly Role[] = []
): FlowInput[] {
  const entities = resolveEnergyEntities(hass, config);
  const adapter = adapterFor(hass, config);
  const hidden = new Set<Role>(hide);
  return ENERGY_ROLES.flatMap((role) => {
    // A hidden energy role drops ALL its instances → the SAME single absent-node
    // input an unresolved entity produces (hidden == absent by construction).
    if (hidden.has(role)) return [absentInput(role)];
    // Expand to the role's instance list (default one bare instance ⇒ zero-diff).
    return roleInstances(config, role).map(({ id, entities: override }) => {
      // Per-instance resolution: the auto-resolved set, with this instance's
      // overrides winning for the keys it sets (#1 keeps auto-resolution; #2+ that
      // sets no power sensor resolves the SAME entity as #1 — the user's documented
      // footgun, graceful not a crash).
      const instEntities = override ? { ...entities, ...override } : entities;
      return flowInputFor(hass, adapter, instEntities, role, opts, id);
    });
  });
}

/**
 * The public binding surface (minimal + stable): `(hass, config) → FlowModel`.
 * Renderers (4.3/4.4) consume the returned model, never these internals. `hide`
 * (Story 9.2) is forwarded to {@link flowInputsFrom} — the Scene passes its
 * hidden-node set; every other caller defaults to `[]` (zero-diff).
 */
export function bindFlowModel(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  opts: ReadOpts = {},
  hide: readonly Role[] = []
): FlowModel {
  return buildFlowModel(flowInputsFrom(hass, config, opts, hide));
}
