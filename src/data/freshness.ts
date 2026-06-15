import type { HomeAssistant, TeslaCardConfig } from '../types';
import type { EntityKey } from '../const';
import { UNAVAILABLE_STATES, isUnavailable } from '../helpers';
import { resolveEntities } from './resolve';

/**
 * D3 — Freshness read-model (the sole reader of `hass.states`).
 *
 * Every value the card shows must answer one question first: is this the live
 * truth, or a stale echo? This module is the universal reader that returns that
 * answer as a four-field shape — `{ value, lastUpdated, available, staleness }`
 * — and classifies `staleness ∈ {fresh|stale|asleep|unavailable}`. It is the
 * architecturally-named SOLE reader of `hass.states` (AR-1 / Communication
 * Patterns): once the 1.6/1.7 migration lands, no module outside `src/data/`
 * touches `hass.states` at all. The reads are correct HERE; the same reads
 * anywhere else are boundary violations.
 *
 * The load-bearing nuance (AC2): staleness is measured against HA's OWN time
 * base, NEVER a naive `clientNow − lastUpdated`. The browser clock can drift
 * from the HA server's; subtracting a server-stamped `last_updated` from a
 * client `Date.now()` manufactures phantom staleness — or, worse, phantom
 * freshness, and overstating freshness is the one unforgivable error (UX-DR18).
 * So we derive "server now" from the MAX `last_updated`/`last_changed` across
 * `hass.states`: HA pushes a fresh `hass` on every state change, so some entity
 * was just stamped by the server — that max is a tight, dependency-free lower
 * bound on the server clock, computed entirely from server-stamped data. The
 * reference is injectable (`opts.now`) so tests are hermetic.
 *
 * Boundary: imports no `lit`/DOM and nothing upward (`flow/`, `components/`). It
 * may import sibling `data/` (`resolve.ts`) and root utils (`helpers.ts`,
 * `types`, `const`) — `helpers.ts` is a root util, not a component, and does not
 * import `data/`, so the edge is cycle-free and does not cross the
 * `data/ ← flow/ ← components/` direction. The `isQuiescent` derivation below is
 * FORWARD-enabling, not forward-dependent: it imports nothing from `flow/` (which
 * does not exist yet) and defines no FlowModel type — it only EXPORTS the boolean
 * the Epic-4 FlowModel will consume. The arrow is `data → flow`; never reverse.
 * Do not pull a flow type up into `data/`.
 *
 * NOTE: no consumer is wired to this module yet (R6 sequencing:
 * `data → freshness → FlowModel → hero → scene`). The FlowModel (Epic 4), the
 * wake-citizenship gate (Story 5.4) and every value render after the 1.6/1.7
 * migration bind to this API later; building the tested pure hub first mirrors
 * 1.2 (`registry.ts`), 1.3 (`resolve.ts`) and 1.4 (`dialect.ts`). The structural
 * `no-bare-hass.states` / `no-cycle` gates are 1.7 — pre-satisfied here by
 * construction, not added here.
 */

// ───────────────────────────────────────────────────────────────────────────
// Shape & vocabulary (AC1)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The four staleness buckets, longest-idle last. `asleep` is the longest-idle
 * TIME bucket of the per-value classification — it is NOT a read of the
 * vehicle's observed online/waking signal (that is the wake-citizenship gate,
 * Story 5.4 / AR-9, which consumes THIS reader and owns the cooldown). All four
 * are carried in the model; a renderer may later collapse `asleep`/`unavailable`
 * to one visual treatment (D3) — do not pre-build four visual states here.
 */
export type Staleness = 'fresh' | 'stale' | 'asleep' | 'unavailable';

/** The canonical freshness read. Implement against this type; never re-invent it per call site. */
export interface FreshnessRead {
  /** Raw `state` string, or `undefined` when the entity is absent. */
  value: string | undefined;
  /** HA-stamped `last_updated` (or `last_changed`), or `undefined` when absent. */
  lastUpdated: string | undefined;
  /** `false` for an absent entity or an `unavailable`/`unknown`/`none`/`''` state. */
  available: boolean;
  /** `fresh | stale | asleep | unavailable` — see {@link Staleness}. */
  staleness: Staleness;
}

// ───────────────────────────────────────────────────────────────────────────
// Thresholds — global default + per-quantity overrides (AC2)
// ───────────────────────────────────────────────────────────────────────────

/** Age windows (ms): `age ≤ fresh → 'fresh'`; `fresh < age ≤ asleep → 'stale'`; `age > asleep → 'asleep'`. */
export interface StalenessThreshold {
  fresh: number;
  asleep: number;
}

/**
 * Global default windows. Rationale: Tesla integrations push on their own
 * cadence (event-driven, not a fixed poll), so windows are deliberately
 * conservative — a brief gap between pushes is not "stale", and only a genuinely
 * idle car (no push for half an hour) reads "asleep". The exact numbers are a
 * documented engineering choice, NOT a fabricated fact: tests assert the
 * classification RULE relative to injected/known thresholds, never these
 * wall-clock constants as ground truth.
 */
export const DEFAULT_STALENESS_THRESHOLDS: StalenessThreshold = {
  fresh: 5 * 60_000, // 5 min
  asleep: 30 * 60_000, // 30 min
};

/**
 * Per-quantity (per-function-key) overrides, for keys whose cadence genuinely
 * differs from the default. Kept MINIMAL on purpose — not every one of the 88
 * keys is enumerated, only those with a real cadence justification:
 *  - `odometer` advances only while driving; parked for an hour is not "stale".
 *  - `speed`/`power` move second-by-second while driving, so a short gap is
 *    already stale and a longer one means the car stopped reporting.
 */
export const STALENESS_OVERRIDES: Partial<Record<EntityKey, Partial<StalenessThreshold>>> = {
  odometer: { fresh: 60 * 60_000, asleep: 24 * 60 * 60_000 },
  speed: { fresh: 60_000, asleep: 15 * 60_000 },
  power: { fresh: 60_000, asleep: 15 * 60_000 },
};

/** Per-read options. `now` injects the server reference; `thresholds` overrides the windows. Nothing else. */
export interface ReadOpts {
  now?: number;
  thresholds?: Partial<StalenessThreshold>;
}

// ───────────────────────────────────────────────────────────────────────────
// HA time base (AC2)
// ───────────────────────────────────────────────────────────────────────────

/** Parse an ISO-8601 stamp to ms epoch; `NaN` for missing/unparseable. */
function parseTs(ts: string | undefined): number {
  if (!ts) return NaN;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * "Server now" (ms epoch), derived from the MAX `last_updated`/`last_changed`
 * across `hass.states` — the most-recently server-stamped entity is a robust
 * lower bound on the HA clock, independent of the browser's. An injected `now`
 * short-circuits the scan (test determinism). Last-resort fallback is client
 * `Date.now()` — the ONLY place client time is permissible, and only when
 * `hass.states` is empty/absent (cold first paint).
 */
export function referenceNow(hass: HomeAssistant | undefined, now?: number): number {
  if (now !== undefined) return now;
  let max = -Infinity;
  const states = hass?.states;
  if (states) {
    for (const id of Object.keys(states)) {
      const e = states[id];
      const u = parseTs(e?.last_updated);
      if (u > max) max = u; // NaN > max is false → invalid stamps ignored
      const c = parseTs(e?.last_changed);
      if (c > max) max = c;
    }
  }
  return max > -Infinity ? max : Date.now();
}

/**
 * Classify an elapsed age (ms) against thresholds.
 *
 * Guard: a negative or NaN age maps to `'fresh'`. Negative means the value was
 * stamped AFTER our server reference — the freshest possible, never old (this is
 * also what makes the reader clock-skew tolerant: a stamp ahead of the client
 * clock is fresh, not negative-age garbage). NaN means an available entity with
 * an unknown/unparseable age — we decline to invent a staleness it did not earn.
 * Both lean toward `'fresh'` only when the age is genuinely indeterminate; a
 * KNOWN age past `fresh` always classifies up, so we never overstate freshness
 * for data we can actually measure as old (UX-DR18).
 */
function classifyAge(age: number, t: StalenessThreshold): Staleness {
  if (!Number.isFinite(age) || age < 0) return 'fresh';
  if (age <= t.fresh) return 'fresh';
  if (age <= t.asleep) return 'stale';
  return 'asleep';
}

// ───────────────────────────────────────────────────────────────────────────
// The universal reader (AC1, AC2)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read freshness for a resolved entity-id. Never throws: an absent entity or an
 * `unavailable`/`unknown`/`none`/`''` state yields `{ available:false,
 * staleness:'unavailable' }` (NaN-safe, honest, no false certainty — NFR-4).
 */
export function read(
  hass: HomeAssistant | undefined,
  id: string,
  opts: ReadOpts = {}
): FreshnessRead {
  const entity = hass?.states?.[id];
  const value = entity?.state;
  // last_updated is the freshness stamp; last_changed is the fallback when the
  // value re-published without changing (HA omits last_updated on some states).
  const lastUpdated = entity?.last_updated ?? entity?.last_changed;

  if (!entity || isUnavailable(value)) {
    return { value, lastUpdated, available: false, staleness: 'unavailable' };
  }

  const thresholds: StalenessThreshold = { ...DEFAULT_STALENESS_THRESHOLDS, ...opts.thresholds };
  const age = referenceNow(hass, opts.now) - parseTs(lastUpdated);
  return { value, lastUpdated, available: true, staleness: classifyAge(age, thresholds) };
}

/**
 * Key-aware convenience: resolve the function-key (registry-aware, via
 * `resolve.ts` — never re-implemented here) then delegate to {@link read}. The
 * per-key threshold override is consulted unless the caller passes an explicit
 * `opts.thresholds` (which wins). Consumers reading many keys should call
 * `resolveEntities` once and use `read` directly to avoid re-resolving per key.
 */
export function readKey(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey,
  opts: ReadOpts = {}
): FreshnessRead {
  const id = resolveEntities(hass, config)[key];
  const thresholds = { ...STALENESS_OVERRIDES[key], ...opts.thresholds };
  return read(hass, id, { now: opts.now, thresholds });
}

// ───────────────────────────────────────────────────────────────────────────
// quiescent derivation — forward-enabling, not forward-dependent (AC3)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The SINGLE definition of `quiescent`: `staleness ∈ {stale, asleep,
 * unavailable}` ≡ `staleness !== 'fresh'`. The Epic-4 FlowModel imports THIS to
 * map a quiescent SOURCE to a quiescent EDGE (`FlowEdge.provenance =
 * 'quiescent'`) — so the mapping is defined once and never re-derived per call
 * site. Pure function of `staleness`: callable with no `hass`/`flow` import.
 */
export function isQuiescent(r: FreshnessRead): boolean {
  return r.staleness !== 'fresh';
}

// Re-export so a consumer needing the unavailable vocabulary has one import
// surface and never re-lists the sentinel strings. (Single source of truth lives
// in helpers.ts; this is a pass-through, not a duplicate.)
export { UNAVAILABLE_STATES };
