import type { HomeAssistant } from '../types';

/**
 * D3 — Slice-gating predicate (Story 6.5 AC3c).
 *
 * `hass.states` reads are sanctioned ONLY inside `src/data/` (AR-1 /
 * `no-bare-hass.states`), so the one state comparison the Scene orchestrator
 * needs lives HERE — not in `flow/my-home.ts` or `components/my-home.ts` (a bare
 * `hass.states` read in either would trip the gate AND the `data/ ← flow/ ←
 * components/` structural rule). The element/hub imports this predicate; it never
 * touches `hass.states` itself.
 *
 * `sliceChanged(prev, next, ids)` is `true` iff ANY of the given resolved
 * entity-ids has a different `state` OR freshness stamp (`last_updated`, falling
 * back to `last_changed`) between the two `hass` snapshots. It is the gate a
 * consumer uses to skip re-rendering / re-deriving when an unrelated entity
 * churned: HA replaces the whole `hass` on every tick, but most ticks touch
 * entities outside a given card's slice (UX-DR / D4 — children stay coherent via
 * the shared `hass`, but must not THRASH on it).
 *
 * Honesty notes:
 *  - A `prev === next` identity short-circuits to `false` (same object ⇒ nothing
 *    changed) — cheap and correct.
 *  - `undefined`/absent ids are skipped (an unresolved role contributes no gate).
 *  - First paint (`prev === undefined`, a real `next`) reports a change for any
 *    id present in `next`, so the initial render is never gated away.
 *  - The stamp comparison catches a re-publish at the SAME value (HA bumps
 *    `last_updated` without changing `state`) — relevant when freshness, not the
 *    number, is what moved.
 */
export function sliceChanged(
  prev: HomeAssistant | undefined,
  next: HomeAssistant | undefined,
  entityIds: readonly (string | undefined)[]
): boolean {
  if (prev === next) return false;
  for (const id of entityIds) {
    if (!id) continue;
    const p = prev?.states?.[id];
    const n = next?.states?.[id];
    if (p === n) continue; // same entity object ⇒ unchanged
    if (p?.state !== n?.state) return true;
    const ps = p?.last_updated ?? p?.last_changed;
    const ns = n?.last_updated ?? n?.last_changed;
    if (ps !== ns) return true;
  }
  return false;
}
