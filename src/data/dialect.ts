import type { HomeAssistant, TeslaCardConfig } from '../types';
import type { EnergyRole } from './registry';
import { TESLA_PLATFORMS } from './resolve';

/**
 * D2 — Dialect-adapter layer (the integration-specific quarantine).
 *
 * Tesla data reaches Home Assistant through several integrations that name the
 * same facts differently (`tesla_fleet` vs the HACS `tesla_custom` vs Teslemetry
 * vs Tessie). Rather than scatter `=== 'Charging'` and per-integration aliases
 * across components, EVERYTHING dialect-specific lives here, behind pure
 * functions in a table — never an OO class hierarchy (≈5 derivations need no
 * framework). A new integration's *adapter behaviour* is therefore "+1 pure
 * adapter" (one `DIALECTS` table entry, no detection/normalizer/consumer edits);
 * the co-located seam test proves that. NOTE one caveat the seam test pins: for
 * `detectDialect` to *probe* a brand-new integration it must also join the shared
 * `TESLA_PLATFORMS` set in `resolve.ts` (the single source of truth) — that set,
 * not this table, is what the probe scans. So "nothing downstream" is scoped to
 * adapter behaviour; registering a never-seen platform is the one shared-constant
 * edit, by design (single source of truth, asserted by the no-drift test).
 *
 * This module belongs in `data/` because `detectDialect` reads `hass.entities`
 * (the registry) — a read that is legitimate ONLY inside `data/` (AR-1). It
 * imports no `lit`/DOM and nothing upward (`flow/`, `components/`); it may import
 * sibling `data/` (`resolve.ts` for the shared Tesla-platform set) and root
 * `types`. The `Integration` ↔ `types.ts` cross-reference is type-only (erased),
 * so there is no runtime cycle.
 *
 * NOTE: no consumer is wired to this module yet. The resolver pipeline, FlowModel
 * (Epic 4) and the component status checks (Stories 3.4 / 5.7) bind to this API
 * later; building the tested pure hub first mirrors 1.2 (`registry.ts`) and 1.3
 * (`resolve.ts`). Do NOT call these normalizers from any component in this story.
 */

// ───────────────────────────────────────────────────────────────────────────
// Integration identity
// ───────────────────────────────────────────────────────────────────────────

/** The Tesla integration dialects the card understands. */
export type Integration =
  | 'tesla_fleet'
  | 'teslemetry'
  | 'tessie'
  | 'tesla_custom'
  | 'tesla';

/**
 * Deterministic tie-break order when more than one integration is present.
 * `tesla_fleet` (the bundled corpus / default dialect) wins ties; the rest
 * follow a fixed precedence so the chosen `integration` is reproducible.
 * Membership is validated against `resolve.ts`'s `TESLA_PLATFORMS` (single
 * source of truth) by the co-located seam test — do not let the two drift.
 */
const PRECEDENCE: readonly Integration[] = [
  'tesla_fleet',
  'teslemetry',
  'tessie',
  'tesla_custom',
  'tesla',
];

/** Is `x` a known Tesla integration platform? (reuses resolve.ts's set). */
function isIntegration(x: unknown): x is Integration {
  return typeof x === 'string' && TESLA_PLATFORMS.has(x);
}

// ───────────────────────────────────────────────────────────────────────────
// Canonical status vocabulary + normalizers (AC5)
// ───────────────────────────────────────────────────────────────────────────
//
// Status enums are dialect-dependent STRINGS (`Charging` / `charging` /
// `ChargeStarting`; `locked`/`unlocked`; `open`/`closed`). The canonical unions
// below are the normalization TARGETS — kept minimal (only states a consumer in
// 3.4 / 5.7 will branch on) and always carrying an `'unknown'` member so an
// unrecognized raw string degrades gracefully (NFR-4) instead of throwing.
//
// The canonical values are driven from the present inline checks so they are
// real, not invented:
//   - charging: hero.ts:34 / panel-charging.ts:56 test `=== 'Charging'`.
//   - lock:     panel-closures.ts test `=== 'locked'` / `'unlocked'`.
//   - cover:    panel-closures.ts:23 tests `=== 'open'` (and `'on'` for doors).

export type ChargingState =
  | 'charging'
  | 'starting'
  | 'stopped'
  | 'complete'
  | 'disconnected'
  | 'no_power'
  | 'unknown';

export type LockState = 'locked' | 'unlocked' | 'unknown';

export type CoverState = 'open' | 'closed' | 'unknown';

/** Normalize a raw status string to a lookup key (case/punctuation-insensitive). */
function normKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** States that mean "no usable value" — always map to the union's fallback. */
const ABSENT = new Set(['', 'unavailable', 'unknown', 'none', 'null']);

// Default (tesla_fleet) mappings, keyed by normalized form so every dialect
// spelling collapses: `Charging`/`charging` → `charging`, `ChargeStarting` →
// `starting`, etc.
const CHARGING_MAP: Readonly<Record<string, ChargingState>> = {
  charging: 'charging',
  starting: 'starting',
  chargestarting: 'starting',
  stopped: 'stopped',
  complete: 'complete',
  charged: 'complete',
  disconnected: 'disconnected',
  nopower: 'no_power',
};

const LOCK_MAP: Readonly<Record<string, LockState>> = {
  locked: 'locked',
  unlocked: 'unlocked',
};

const COVER_MAP: Readonly<Record<string, CoverState>> = {
  open: 'open',
  closed: 'closed',
  // Door/aperture binary_sensors report on/off rather than open/closed; collapse
  // them too so a future closures consumer (5.7) reads one canonical union.
  on: 'open',
  off: 'closed',
};

/**
 * Generic status normalizer: case-insensitive, `'unknown'`-safe, and consults
 * an optional per-dialect `override` map before the default `base` map. Returns
 * the `fallback` for unrecognized / absent / `undefined` input — never throws,
 * never passes a raw string through.
 */
function normalizeStatus<T extends string>(
  base: Readonly<Record<string, T>>,
  fallback: T,
  raw: string | undefined,
  override?: Readonly<Record<string, T>>
): T {
  if (raw == null) return fallback;
  const k = normKey(raw);
  if (ABSENT.has(k)) return fallback;
  return override?.[k] ?? base[k] ?? fallback;
}

/** Default charging normalizer (tesla_fleet mapping). [AC5] */
export const normalizeChargingState = (raw: string | undefined): ChargingState =>
  normalizeStatus(CHARGING_MAP, 'unknown', raw);

/** Default lock normalizer (tesla_fleet mapping). [AC5] */
export const normalizeLockState = (raw: string | undefined): LockState =>
  normalizeStatus(LOCK_MAP, 'unknown', raw);

/** Default cover normalizer (tesla_fleet mapping). [AC5] */
export const normalizeCoverState = (raw: string | undefined): CoverState =>
  normalizeStatus(COVER_MAP, 'unknown', raw);

// ───────────────────────────────────────────────────────────────────────────
// DialectAdapter table (pure functions, not a class hierarchy)
// ───────────────────────────────────────────────────────────────────────────

/** Where a value the adapter produced came from. */
export interface Provenance {
  integration: Integration;
  /** True when the adapter computed (rather than passed through) the value. */
  derived?: boolean;
}

/** A value an adapter produced, stamped with its provenance. */
export interface Tagged<T> {
  value: T;
  provenance: Provenance;
}

// ── Power-sign normalization (AC3) ───────────────────────────────────────────
//
// The FlowModel (Epic 4) consumes ONE canonical power convention — battery `+` =
// charging, grid `+` = import, kW everywhere (declared in flow/balance.ts). But
// raw sensors disagree: tesla_fleet/powerwall report battery `−` = charging (and
// grid `+` = import, solar/load/wc ≥ 0). So the dialect boundary flips the raw
// battery sign on the way in — a sign-flip is a derivation, tagged accordingly —
// and the FlowModel only ever sees canonical signs (R2 watch-item: the sign bug
// that "flips every surface" is fixed here, once).
//
// `DEFAULT_FLIP` lists the roles whose raw signed POWER is inverted relative to
// canonical. Only `powerwall` (the battery) differs; grid/solar/home/wall_connector
// already match (sign is meaningless for the ≥0 quantities — passthrough). The
// non-fleet dialects degrade to this default (their raw power conventions are
// uncaptured-corpus; a dialect that genuinely differs overrides via `flipPower`).
const DEFAULT_FLIP: readonly EnergyRole[] = ['powerwall'];

/**
 * The per-dialect behaviour set. A plain bag of pure functions + data — no
 * inheritance, no `hass` mutation, no Lit/DOM, no upward import. Derivations
 * that need live values take pre-read primitives as inputs and return values;
 * they never reach back into components.
 */
export interface DialectAdapter {
  integration: Integration;
  /** Dialect entity/attribute name → canonical function-key (identity for tesla_fleet). */
  aliasMap: Readonly<Record<string, string>>;
  /** Canonicalize one dialect name via the alias map (passthrough if unmapped). */
  alias(name: string): string;
  /**
   * Combine several source readings into one canonical value (a dialect that
   * spreads a metric across entities overrides this). Default: first defined.
   */
  combine(parts: ReadonlyArray<number | undefined>): number | undefined;
  /**
   * Split one packed source reading into its parts (inverse of `combine`).
   * Default: single-element passthrough; dialects that pack values override.
   */
  split(value: number | undefined): number[];
  /** Stamp provenance onto a value the adapter produced. */
  derive<T>(value: T, derived?: boolean): Tagged<T>;
  /**
   * Normalize a raw signed power reading (kW) for `role` to the canonical
   * convention (battery `+` = charging, grid `+` = import). Flips the sign for
   * roles this dialect reports inverted (default: `powerwall`); a flip is a
   * derivation, so the result is tagged `derived: true`. `undefined` in →
   * `undefined` out (NaN-safe upstream owns the read). [AC3]
   */
  normalizePower(role: EnergyRole, rawKW: number | undefined): Tagged<number | undefined>;
  /** Per-dialect status normalizers (default mapping unless overridden). */
  normalizeChargingState(raw: string | undefined): ChargingState;
  normalizeLockState(raw: string | undefined): LockState;
  normalizeCoverState(raw: string | undefined): CoverState;
}

function defaultCombine(parts: ReadonlyArray<number | undefined>): number | undefined {
  for (const p of parts) if (p !== undefined) return p;
  return undefined;
}

function defaultSplit(value: number | undefined): number[] {
  return value === undefined ? [] : [value];
}

/** Re-key a per-dialect override map through `normKey` so callers may use raw spellings. */
function normMapKeys<T extends string>(
  m: Readonly<Record<string, T>> | undefined
): Readonly<Record<string, T>> | undefined {
  if (!m) return undefined;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) out[normKey(k)] = v;
  return out;
}

/** Options for building one adapter — everything optional degrades to the default dialect. */
interface AdapterSpec {
  integration: Integration;
  aliasMap?: Readonly<Record<string, string>>;
  charging?: Readonly<Record<string, ChargingState>>;
  lock?: Readonly<Record<string, LockState>>;
  cover?: Readonly<Record<string, CoverState>>;
  combine?: (parts: ReadonlyArray<number | undefined>) => number | undefined;
  split?: (value: number | undefined) => number[];
  /** Roles whose raw signed power is inverted vs canonical (default: `powerwall`). */
  flipPower?: readonly EnergyRole[];
}

/**
 * Build a `DialectAdapter` from a spec. The factory IS the additive seam: a new
 * integration is one `makeAdapter({...})` call plus one table key — no other
 * module changes (proven by the AC3 seam test). Exported so the seam test can
 * register a synthetic adapter exactly the way a real one would be added.
 */
export function makeAdapter(spec: AdapterSpec): DialectAdapter {
  const aliasMap = spec.aliasMap ?? {};
  const charging = normMapKeys(spec.charging);
  const lock = normMapKeys(spec.lock);
  const cover = normMapKeys(spec.cover);
  const flip = new Set<EnergyRole>(spec.flipPower ?? DEFAULT_FLIP);
  const derive = <T>(value: T, derived?: boolean): Tagged<T> => ({
    value,
    provenance: derived
      ? { integration: spec.integration, derived: true }
      : { integration: spec.integration },
  });
  return {
    integration: spec.integration,
    aliasMap,
    alias: (name) => aliasMap[name] ?? name,
    combine: spec.combine ?? defaultCombine,
    split: spec.split ?? defaultSplit,
    derive,
    normalizePower: (role, rawKW) => {
      const flipped = flip.has(role);
      const value = rawKW === undefined ? undefined : flipped ? -rawKW : rawKW;
      // A sign-flip is a derivation; a canonical-already passthrough is not.
      return derive(value, flipped);
    },
    normalizeChargingState: (raw) => normalizeStatus(CHARGING_MAP, 'unknown', raw, charging),
    normalizeLockState: (raw) => normalizeStatus(LOCK_MAP, 'unknown', raw, lock),
    normalizeCoverState: (raw) => normalizeStatus(COVER_MAP, 'unknown', raw, cover),
  };
}

// ── tesla_custom — the costly distinct dialect (AC2) ─────────────────────────
//
// ASSUMPTION (uncaptured corpus): we have only a tesla_fleet Model Y fixture, so
// the exact tesla_custom object-id/attribute/state spellings are NOT corpus-
// verified. We therefore encode the alias-map MECHANISM (data consumed by the
// generic adapter) with a few documented, likely renames; real values fill in
// DATA-ONLY when a tesla_custom corpus is captured. The co-located test asserts
// the alias map is APPLIED — never that these specific strings are ground truth.
//
// Rationale for the entries below: the HACS `tesla_custom` integration has
// historically exposed charging under a bare `charging` sensor and the battery
// under `battery`, where tesla_fleet uses `charging_status` / `battery_level`
// (see const.ts DEFAULT_ENTITIES). Adjust these once a corpus lands.
const TESLA_CUSTOM_ALIASES: Readonly<Record<string, string>> = {
  charging: 'charging_status',
  battery: 'battery_level',
};

// ASSUMPTION (uncaptured corpus): tesla_custom is believed to emit a combined
// `charge_complete` charging string the default map doesn't carry. Encoded to
// demonstrate the per-dialect status-override MECHANISM; the test asserts the
// override is consulted, not that this literal is real.
const TESLA_CUSTOM_CHARGING: Readonly<Record<string, ChargingState>> = {
  charge_complete: 'complete',
};

/**
 * The dialect table. `tesla_fleet` is the complete first-class default (the
 * bundled corpus is tesla_fleet, so its sensors map directly — pass-through
 * combine/split + default normalizers). `teslemetry` / `tessie` / bare `tesla`
 * are present table entries that DEGRADE to the default-dialect behaviour
 * (non-crashing, fillable incrementally — AC4), so the verticals are never
 * blocked on missing dialect coverage. `tesla_custom` carries its own alias map
 * + status override (AC2).
 */
export const DIALECTS: Readonly<Record<Integration, DialectAdapter>> = {
  tesla_fleet: makeAdapter({ integration: 'tesla_fleet' }),
  teslemetry: makeAdapter({ integration: 'teslemetry' }),
  tessie: makeAdapter({ integration: 'tessie' }),
  tesla_custom: makeAdapter({
    integration: 'tesla_custom',
    aliasMap: TESLA_CUSTOM_ALIASES,
    charging: TESLA_CUSTOM_CHARGING,
  }),
  tesla: makeAdapter({ integration: 'tesla' }),
};

// ───────────────────────────────────────────────────────────────────────────
// Integration detection: probe + override + tie-break + ambiguity (AC1)
// ───────────────────────────────────────────────────────────────────────────

/**
 * A small, typed dialect-resolution report (the D2 "2d" surface, scoped to
 * dialect). It always carries a working `integration` so the card functions,
 * AND surfaces ambiguity (`ambiguous` + `candidates`) so a future editor (Epic
 * 7) can display it — auto-detect NEVER makes a silent arbitrary pick.
 */
export interface DialectReport {
  /** The chosen, working integration (always set). */
  integration: Integration;
  /** How it was chosen. */
  source: 'override' | 'probe' | 'default';
  /** True when >1 Tesla platform was present (tie-broken, not silently picked). */
  ambiguous: boolean;
  /** All Tesla platforms detected, in precedence order (empty when none). */
  candidates: Integration[];
}

/** Order a candidate set by the deterministic precedence. */
function byPrecedence(candidates: Iterable<Integration>): Integration[] {
  return [...candidates].sort(
    (a, b) => PRECEDENCE.indexOf(a) - PRECEDENCE.indexOf(b)
  );
}

/**
 * Decide which integration dialect this install speaks.
 *
 * Precedence: `config.integration` override → entity-platform probe → default.
 *   - Override: short-circuits the probe, tagged `source: 'override'`.
 *   - Probe: counts `hass.entities` per Tesla platform (the same probing shape
 *     `detectVehicle` uses). One platform → unambiguous. ≥2 → `ambiguous: true`,
 *     candidates listed, a working `integration` chosen by a deterministic
 *     tie-break (most entities, then `PRECEDENCE`) — surfaced, never silent.
 *   - None detected + no override → `source: 'default'`, `tesla_fleet` (the
 *     bundled default dialect) so a foreign/registry-less install degrades to a
 *     designed default rather than crashing (NFR-4).
 */
export function detectDialect(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): DialectReport {
  // 1) Override wins.
  if (isIntegration(config.integration)) {
    return {
      integration: config.integration,
      source: 'override',
      ambiguous: false,
      candidates: [config.integration],
    };
  }

  // 2) Probe entity platforms. We count *every* Tesla-platform entity per
  //    platform (not only those owned by the detected vehicle device) — a
  //    deliberate simplification: the goal here is "which integration dialects
  //    are present", and the platform string, not the device, names the dialect
  //    (a Tesla-manufacturer device with no `platform` cannot name an
  //    Integration, so detectVehicle's manufacturer fallback is intentionally
  //    NOT mirrored here). Vehicle-device-scoped weighting is a later refinement
  //    if a real multi-integration install ever needs it.
  const counts = new Map<Integration, number>();
  const entities = hass?.entities as Record<string, any> | undefined;
  if (entities) {
    for (const ent of Object.values(entities)) {
      const p = ent?.platform;
      if (isIntegration(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  const candidates = byPrecedence(counts.keys());

  // 3a) Nothing detected → designed default.
  if (candidates.length === 0) {
    return {
      integration: 'tesla_fleet',
      source: 'default',
      ambiguous: false,
      candidates: [],
    };
  }

  // 3b) One platform → unambiguous probe.
  if (candidates.length === 1) {
    return {
      integration: candidates[0],
      source: 'probe',
      ambiguous: false,
      candidates,
    };
  }

  // 3c) Multiple platforms → tie-break (most entities, then precedence) and
  //     SURFACE the ambiguity rather than silently picking.
  const integration = [...candidates].sort((a, b) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return d !== 0 ? d : PRECEDENCE.indexOf(a) - PRECEDENCE.indexOf(b);
  })[0];
  return { integration, source: 'probe', ambiguous: true, candidates };
}

/** Convenience dispatch: the adapter for the detected/overridden dialect. */
export function adapterFor(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): DialectAdapter {
  return DIALECTS[detectDialect(hass, config).integration];
}
