import type { Role } from '../data/registry';
import type { EnergyEntities } from '../data/energy';
import type { InstanceSpec, TeslaCardConfig } from '../types';

/**
 * D1 — Multi-instance derivation (Story 9.7). The pure, DOM-free home for the
 * per-instance IDENTITY scheme + the `energy.nodes.instances` config parse — used
 * by BOTH the binding seam (`flow/binding.ts` — N `FlowInput`s per role) and the
 * Scene element (`components/my-home.ts` — N cells/legs per role). Co-locating it
 * here (not the Lit element) keeps the derivation unit-testable and honors the
 * `data/ ← flow/ ← components/` no-cycle arrow (it imports only `data/` + root
 * `types`, never `components/`/`lit`/DOM).
 *
 * The POINT of epic AC-1 is to kill the load-bearing `id === role` assumption: the
 * code must COMPUTE an identity rather than assume the role IS the identity. Every
 * seam keys off the computed {@link instanceId}; it merely COINCIDES with `role` in
 * the degenerate single-instance case — which is exactly what guarantees FR-33
 * zero-diff (a single-instance role keeps its bare `role` id / `data-node`, so every
 * existing pin and the bus/leg/anchor math stay byte-identical). The `:n` suffix
 * appears ONLY for genuinely duplicated roles (all-new output, no existing pin).
 */

/**
 * The per-instance node id. `count <= 1 ⇒ role` (bare — FR-33 zero-diff); a
 * duplicated role's instances are `role:1`, `role:2`, … (1-based, so the suffix
 * reads naturally in a `data-node` / aria string). The `:` separator is safe in a
 * `data-node` attribute and never collides with a `Role` (roles carry no `:`), so
 * {@link roleOfInstance} recovers the role by splitting on it.
 */
export function instanceId(role: string, index: number, count: number): string {
  return count <= 1 ? role : `${role}:${index + 1}`;
}

/** Recover the role from an {@link instanceId} (`solar:2 → solar`, `solar → solar`). */
export function roleOfInstance(id: string): string {
  const colon = id.indexOf(':');
  return colon < 0 ? id : id.slice(0, colon);
}

/**
 * Parse a role's instance descriptor list from `energy.nodes.instances[role]`,
 * tolerant of every garbage shape (FR-24 / R9):
 *   • absent / not-an-array (incl. a stale 9.1 count-shaped value) ⇒ `[{}]`
 *   • an array with non-object entries ⇒ those entries dropped
 *   • an array that filters to empty ⇒ `[{}]`
 * The default `[{}]` is ONE bare instance = today's single auto-resolved node, so a
 * config with no `instances` (or an unparseable one) is a zero-diff. The returned
 * array's LENGTH is the instance count (AC1).
 */
export function instanceSpecs(config: TeslaCardConfig, role: Role): InstanceSpec[] {
  const raw = config.energy?.nodes?.instances?.[role];
  if (!Array.isArray(raw)) return [{}];
  const specs = raw.filter(
    (s): s is InstanceSpec => !!s && typeof s === 'object' && !Array.isArray(s)
  );
  return specs.length ? specs : [{}];
}

/** One resolved instance of a role: its computed id + (sanitized) title + entity overrides. */
export interface RoleInstance {
  /** The {@link instanceId} (`role` when single, `role:n` when duplicated). */
  id: string;
  /** 0-based position within the role's instance list. */
  index: number;
  /** Total instances of this role (the list length). */
  count: number;
  /** Disambiguating card title, or `undefined` when not a string (graceful). */
  title?: string;
  /** Per-instance entity overrides, or `undefined` when not an object (graceful). */
  entities?: Partial<EnergyEntities>;
  /**
   * Per-instance embedded-card config override (Story 9.8) — consumed ONLY for the
   * `vehicle` role (the per-car `tesla-card` override). `undefined` when not an object.
   */
  config?: Partial<TeslaCardConfig>;
}

/**
 * The resolved instance list for a role — {@link instanceSpecs} mapped to
 * {@link RoleInstance}s carrying the computed {@link instanceId} and sanitized
 * `title`/`entities`. The ONE place both the binding seam and the element derive
 * the same per-instance identity, so a single-instance role is `[{ id: role,
 * count: 1, … }]` (zero-diff) and a duplicated role is `[{ id: role:1 }, …]`.
 */
export function roleInstances(config: TeslaCardConfig, role: Role): RoleInstance[] {
  const specs = instanceSpecs(config, role);
  const count = specs.length;
  return specs.map((spec, index) => ({
    id: instanceId(role, index, count),
    index,
    count,
    title: typeof spec.title === 'string' ? spec.title : undefined,
    entities:
      spec.entities && typeof spec.entities === 'object' && !Array.isArray(spec.entities)
        ? spec.entities
        : undefined,
    // Story 9.8: the per-car embedded-card override (vehicle role only); object-gated
    // exactly like `entities` (both reject arrays — review GB5) so a garbage value
    // degrades to "no override" rather than spreading as numeric keys.
    config:
      spec.config && typeof spec.config === 'object' && !Array.isArray(spec.config)
        ? spec.config
        : undefined,
  }));
}
