import type { HomeAssistant, TeslaCardConfig } from '../types';
import type { EntityKey } from '../const';
import type { EnergyRole } from './registry';
import { TESLA_PLATFORMS } from './platforms';

/**
 * D2 — Dialect-adapter layer (the integration-specific quarantine).
 *
 * Tesla data reaches Home Assistant through several integrations that name the
 * same facts differently (`tesla_fleet` vs the HACS `tesla_custom` vs Teslemetry
 * vs Tessie). Rather than scatter `=== 'Charging'` and per-integration aliases
 * across components, EVERYTHING dialect-specific lives here, behind pure
 * functions in a table — never an OO class hierarchy (≈5 derivations need no
 * framework). AR-4 (restated honestly, Story 14.1): a FULLY-COVERED new dialect
 * now touches up to four coordinated, non-type-linked data structures — its
 * `DIALECTS` adapter entry, plus (as needed) `DIALECT_ENTITY_ALIASES`,
 * `DIALECT_ABSENT`, and a status override — but NO call-site or component churn:
 * the resolver's one-time `detectDialect` consult is the single binding, and
 * adding a dialect never edits `resolve.ts`'s loop, the components, or `flow/`.
 * (The older "+1 adapter, nothing downstream" phrasing is retired — the resolver
 * now consults these tables, so a divergent dialect is more than an adapter row.)
 * The co-located seam test proves the no-call-site-churn guarantee. NOTE one caveat
 * the seam test pins: for `detectDialect` to *probe* a brand-new integration it must
 * also join the shared `TESLA_PLATFORMS` set in `platforms.ts` (the single source of
 * truth) — that set, not this table, is what the probe scans; registering a
 * never-seen platform is the one shared-constant edit, by design (asserted by the
 * no-drift test).
 *
 * This module belongs in `data/` because `detectDialect` reads `hass.entities`
 * (the registry) — a read that is legitimate ONLY inside `data/` (AR-1). It
 * imports no `lit`/DOM and nothing upward (`flow/`, `components/`); it may import
 * the leaf `data/platforms.ts` (the shared Tesla-platform set) and root `types` —
 * but NOT `resolve.ts` (a value edge back to `resolve` would cycle with the new
 * `resolve → dialect` edge). The `Integration` ↔ `types.ts` cross-reference is type-only (erased),
 * so there is no runtime cycle. (Story 14.1: the shared Tesla-platform set moved
 * to the leaf `platforms.ts` so `resolve.ts` can now value-import this module — for
 * its per-dialect alias tables — without forming a `resolve ↔ dialect` cycle.)
 *
 * CONSUMERS (Story 14.1 → 15.1): `resolveEntities` (`resolve.ts`) consults this
 * module's per-dialect alias/ABSENT tables (`DIALECT_ENTITY_ALIASES` /
 * `DIALECT_ABSENT`) via `detectDialect`, so the alias mechanism is live in the
 * resolution path. Since Story 15.1 (D-DGT-2) the running components ALSO consume
 * the dialect-aware normalizers: `hero.ts` and `panel-charging.ts` classify
 * charging/lock/cover via `adapterFor(hass, config).normalize*` — reached through
 * the PARENT-RESOLVED STAMP (`tesla-card.ts` `_resolve()` writes the resolver's
 * effective vehicle dialect onto `_resolvedConfig.integration`, so `detectDialect`
 * short-circuits on its override branch with zero per-render registry scan).
 * Story 16.1 (D-DSM-1) adds two more consumed seams: the shared
 * `classifyChargeState` 7→3 collapse (hero visual + panel cue/gauge/word all
 * derive from the ONE table) and the `chargingOverrideCovers` coverage predicate
 * (`panel-charging.ts` gates its canonical status WORD on it — covered raw →
 * the fixed `STRINGS.status` word; uncovered → honest `prettyText` passthrough).
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
 * Membership is validated against `platforms.ts`'s `TESLA_PLATFORMS` (single
 * source of truth) by the co-located seam test — do not let the two drift.
 */
const PRECEDENCE: readonly Integration[] = [
  'tesla_fleet',
  'teslemetry',
  'tessie',
  'tesla_custom',
  'tesla',
];

/** Is `x` a known Tesla integration platform? (reuses platforms.ts's set). */
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
// The canonical values were ORIGINALLY driven from the then-inline component
// checks so they were real, not invented — hero/panel-charging tested raw
// `=== 'Charging'`, panel-closures `=== 'locked'`/`'open'` (and `'on'` for
// doors). Those inline checks were retired in Story 3.4/5.11 (this module's
// normalizers replaced them; Story 15.1 routed the reads through the per-dialect
// adapter) — the vocabulary below is the surviving contract.

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

/**
 * The 7→3 charge-state collapse, declared ONCE (Story 16.1 / D-DSM-1).
 * Extracted verbatim from the Hero's `_chargeVisual()` switch so every
 * charge-state consumer — the Hero's visual, the charging panel's live cue,
 * battery gauge AND canonical status word — derives from the ONE table (a
 * component-local copy of this collapse is the forbidden "private copy of the
 * machine" shape):
 *   charging                                  → 'charging'
 *   starting | stopped | complete | no_power  → 'plugged'  (connected, not drawing)
 *   disconnected                              → 'parked'
 *   unknown (default)                         → the cable corroboration:
 *     `cableOn` ⇒ 'plugged', else 'parked' — REAL physical evidence of a
 *     connection, never a fabricated charge state (NFR-4; the tesla_custom
 *     boolean's `off`/`unavailable` land here).
 * Pure function of already-read values — no `hass`, no entity read. The return
 * union is structurally identical to `car.ts`'s `ChargeVisual`, so the Hero
 * returns it directly (importing `ChargeVisual` HERE would add a
 * data→components edge — the wrong direction; structural typing does the work).
 */
export function classifyChargeState(
  state: ChargingState,
  cableOn: boolean
): 'charging' | 'plugged' | 'parked' {
  switch (state) {
    case 'charging':
      return 'charging';
    case 'starting':
    case 'stopped':
    case 'complete':
    case 'no_power':
      return 'plugged';
    case 'disconnected':
      return 'parked';
    default:
      return cableOn ? 'plugged' : 'parked';
  }
}

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
  /**
   * Does this dialect's charging OVERRIDE cover `raw` — i.e. did
   * `normalizeChargingState(raw)` consult the override map for it? Mirrors
   * `normalizeStatus`'s reachability EXACTLY (the ABSENT set short-circuits
   * BEFORE the override consult), so `true` always means the classification
   * came from the dialect's own capability map, never the fleet base map.
   * Fleet-family adapters carry no `charging` spec ⇒ `false` for every input
   * by construction. Consumer (Story 16.1): `panel-charging.ts`'s
   * canonical-word gate — covered raw → the fixed `STRINGS.status` word;
   * uncovered → honest `prettyText` passthrough (the fleet family's richer
   * 7-state words survive byte-identically, AC2).
   */
  chargingOverrideCovers(raw: string | undefined): boolean;
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
    // The `!ABSENT.has(...)` guard keeps this predicate exactly mirroring
    // `normalizeStatus`'s reachability: ABSENT short-circuits BEFORE the
    // override consult, so a covers()=true raw is always one the normalizer
    // actually routed through the override. Additive — flows to every adapter
    // (incl. the seam test's synthetic one) with no per-dialect edit.
    chargingOverrideCovers: (raw) =>
      raw != null && !ABSENT.has(normKey(raw)) && charging?.[normKey(raw)] !== undefined,
  };
}

// ── tesla_custom charging = a CAPABILITY difference (AC5) ─────────────────────
//
// CONFIRMED (research 2026-07-03, §5): `tesla_custom` (alandtse/tesla, backed by
// teslajsonpy) exposes charging ONLY as a boolean `binary_sensor.charging`
// (`is_on = charging_state == "Charging"`) — there is NO charging-status *string*
// entity. So this dialect's charging state must be DERIVED from the boolean, not
// normalized from a status string.
//
// The boolean's shape (Story 15.1 refinement, superseding the shipped
// `off → 'stopped'`): `on` PROVES actively charging; `off` proves ONLY
// "not charging" — teslajsonpy collapses Stopped / Complete / **Disconnected**
// alike into `off`, so the map must not claim a specific connected state for it.
// `off → 'unknown'` is the honest canonical encoding: it routes the consumer to
// its cable corroboration (hero.ts `_chargeVisual` default branch — `charge_cable`
// [aliased: `binary_sensor.charger`, plug ≠ Disconnected] `on` ⇒ 'plugged', else
// 'parked'), classifying from REAL physical evidence. Mapping `off → 'stopped'`
// would have rendered an UNCABLED parked car as a false "Plugged-in but idle"
// (`case 'stopped'` → 'plugged' without consulting the cable) — a persistent
// false state in the car's majority condition, the moment components consume
// this adapter (which Story 15.1 makes them do).
//
// Capability limitation (documented, not a defect — do not re-litigate): a
// boolean source cannot express `'complete'`, so a fully-charged CABLED car
// derives `off` → 'unknown' → cable-corroborated 'plugged' — visually identical
// to fleet 'complete' (the Hero collapses stopped/complete to 'plugged' anyway).
//
// Story 14.1 cleared two dead tesla_custom constructs: (1) the old reverse-direction
// `TESLA_CUSTOM_ALIASES` placeholder was DELETED outright (`.alias`/`.aliasMap` have
// zero consumers; the resolver reads the forward `DIALECT_ENTITY_ALIASES` table below
// instead); (2) `TESLA_CUSTOM_CHARGING` was REPURPOSED IN PLACE — the dead
// `{charge_complete → complete}` entry was removed (the token `charge_complete` exists
// nowhere in the integration, §5 verdict) and the const now holds the boolean
// capability map below.
//
// Story 16.1: this map's COVERAGE (via `chargingOverrideCovers`) also gates the
// charging panel's canonical status WORD — a covered boolean renders
// "Charging"/"Plugged-idle"/"Parked" (`STRINGS.status`), never the raw "On"/"Off".
const TESLA_CUSTOM_CHARGING: Readonly<Record<string, ChargingState>> = {
  on: 'charging',
  off: 'unknown',
};

/**
 * The dialect table. `tesla_fleet` is the complete first-class default (the
 * bundled corpus is tesla_fleet, so its sensors map directly — pass-through
 * combine/split + default normalizers). `teslemetry` / `tessie` / bare `tesla`
 * are present table entries that DEGRADE to the default-dialect behaviour
 * (non-crashing, fillable incrementally — AC4), so the verticals are never
 * blocked on missing dialect coverage. `tesla_custom` carries its boolean-charging
 * override (AC5); per-dialect entity-name divergences live in the separate
 * forward-direction `DIALECT_ENTITY_ALIASES` table (below), which the resolver reads.
 */
export const DIALECTS: Readonly<Record<Integration, DialectAdapter>> = {
  tesla_fleet: makeAdapter({ integration: 'tesla_fleet' }),
  teslemetry: makeAdapter({ integration: 'teslemetry' }),
  tessie: makeAdapter({ integration: 'tessie' }),
  tesla_custom: makeAdapter({
    integration: 'tesla_custom',
    charging: TESLA_CUSTOM_CHARGING,
  }),
  tesla: makeAdapter({ integration: 'tesla' }),
};

// ───────────────────────────────────────────────────────────────────────────
// Per-dialect entity-name resolution tables (Story 14.1 — consumed by resolveEntities)
// ───────────────────────────────────────────────────────────────────────────
//
// SOURCE OF TRUTH: `research/technical-tesla-integration-dialect-ground-truth-research-2026-07-03.md`
// §4 (Fleet-family divergences) + §5 (tesla_custom `type`-string naming), cross-
// checked against each integration's `strings.json` / entity source. Transcribed
// VERBATIM from that doc — do not invent aliases beyond §4/§5.
//
// VERSION-DRIFT CAVEAT (research §6.3): HA-core integrations evolve; the Fleet-
// family divergences especially shift release-to-release. Treat these as MAINTAINED
// DATA — re-verify against the integration's `strings.json` when a mismatch is
// reported. The project holds no real tessie/teslemetry/tesla_custom corpus, so
// §5 is CONFIRMED-by-source-read, not corpus-captured (the ASSUMED cells are the
// couple of teslemetry seat strings inferred = fleet).
//
// `tesla_fleet` (and bare `tesla`, un-researched — treated like fleet) intentionally
// have NO entry in either table ⇒ every key uses the fleet canonical path unchanged
// (this is the AC6 byte-identical guarantee, at the data level).

/**
 * Canonical `EntityKey` → that dialect's full `"domain.suffix"` (a slug-free
 * entity id whose domain AND suffix may both differ from fleet). The resolver
 * ({@link resolveEntities}) matches an aliased key by THIS `domain.suffix` instead
 * of the fleet canonical. Any canonical key NOT covered by research is left
 * un-aliased (it degrades via ~95% Fleet-family convergence). [AC1]
 */
export const DIALECT_ENTITY_ALIASES: Partial<
  Record<Integration, Partial<Record<EntityKey, string>>>
> = {
  // §4 — teslemetry is otherwise 1:1 with fleet.
  teslemetry: {
    cop_actively_cooling: 'binary_sensor.cabin_overheat_protection_active',
  },
  // §4 — tessie divergences (note: seat_fl/fr differ from tesla_custom's suffixes).
  tessie: {
    windows: 'cover.vent_windows',
    defrost: 'switch.defrost_mode',
    seat_fl: 'select.seat_heater_left',
    seat_fr: 'select.seat_heater_right',
    // 2026-07-15 re-verify (Story 16.1 AC4, HA-core `dev` strings.json): the
    // three auto-climate keys now ship in tessie — as READ-ONLY binary_sensor
    // twins of the fleet SWITCHES ("Auto seat climate left/right", "Auto
    // steering wheel heater"). Suffixes are fleet-convergent but the DOMAIN
    // diverges, so the alias rows carry tessie's real domain (the resolver's
    // canonical match is domain-aware; without these rows the keys would fall
    // to a nonexistent switch-domain guess).
    auto_seat_left: 'binary_sensor.auto_seat_climate_left',
    auto_seat_right: 'binary_sensor.auto_seat_climate_right',
    auto_steering_wheel: 'binary_sensor.auto_steering_wheel_heater',
  },
  // §5 — tesla_custom `slug(type)` naming (domains change; charging_status points
  // at the boolean binary_sensor.charging = the capability difference, AC5).
  tesla_custom: {
    battery_level: 'sensor.battery',
    battery_range: 'sensor.range',
    inside_temp: 'sensor.temperature_inside',
    outside_temp: 'sensor.temperature_outside',
    charge_current: 'number.charging_amps',
    charge_rate: 'sensor.charging_rate',
    charge_energy_added: 'sensor.energy_added',
    charge_switch: 'switch.charger',
    charging_status: 'binary_sensor.charging',
    charge_port: 'cover.charger_door',
    charge_cable: 'binary_sensor.charger',
    charge_cable_lock: 'lock.charge_port_latch',
    status: 'binary_sensor.online',
    update: 'update.software_update',
    lock: 'lock.doors',
    climate: 'climate.hvac_climate_system',
    cabin_overheat_protection: 'select.cabin_overheat_protection',
    seat_fl: 'select.heated_seat_left',
    seat_fr: 'select.heated_seat_right',
    seat_rl: 'select.heated_seat_rear_left',
    seat_rc: 'select.heated_seat_rear_center',
    seat_rr: 'select.heated_seat_rear_right',
    steering_wheel_heater: 'select.heated_steering_wheel',
    sentry: 'switch.sentry_mode',
    tire_fl: 'sensor.tpms_front_left',
    tire_fr: 'sensor.tpms_front_right',
    tire_rl: 'sensor.tpms_rear_left',
    tire_rr: 'sensor.tpms_rear_right',
    location: 'device_tracker.location_tracker',
    route: 'device_tracker.destination_location_tracker',
    distance_to_arrival: 'sensor.distance_to_arrival',
    time_to_arrival: 'sensor.arrival_time',
    time_to_full_charge: 'sensor.time_charge_complete',
    wake: 'button.wake_up',
    honk: 'button.horn',
    flash: 'button.flash_lights',
    homelink: 'button.homelink',
    boombox: 'button.emissions_test',
  },
};

/**
 * Keys a dialect does NOT expose at all. The resolver returns the empty-string
 * sentinel `''` for an ABSENT key (never a fleet-default id), which propagates
 * through `config.entities` and degrades to `unavailable` (empty string is not
 * nullish, so `'' ?? DEFAULT → ''`; `hass.states['']` is `undefined`; `isUnavailable`
 * short-circuits on `state === undefined`). An explicit `config.entities[key]`
 * override still wins over an ABSENT marker (resolver step-1 precedence). [AC4]
 */
export const DIALECT_ABSENT: Partial<Record<Integration, ReadonlySet<EntityKey>>> = {
  // §4 — tessie: entity not exposed by the integration. Re-verified against
  // HA-core `dev` 2026-07-15 (Story 16.1 AC4): battery_heater + the three
  // auto-climate keys were REMOVED — tessie now ships them (battery_heater
  // fleet-convergent; the auto-climate trio as read-only binary_sensor twins,
  // aliased above). The two keys below remain genuinely un-exposed.
  tessie: new Set<EntityKey>([
    'preconditioning',
    'charger_has_multiple_phases',
  ]),
  // §5 — tesla_custom ABSENT list (only names that ARE EntityKeys; `usable_battery_level`
  // is ABSENT while `battery_level` aliases to sensor.battery — usable folds in there).
  tesla_custom: new Set<EntityKey>([
    'usable_battery_level',
    'ideal_battery_range',
    'estimate_battery_range',
    'door_fl',
    'door_fr',
    'door_rl',
    'door_rr',
    'window_fl',
    'window_fr',
    'window_rl',
    'window_rr',
    'driver_temp_setting',
    'passenger_temp_setting',
    'preconditioning',
    'preconditioning_enabled',
    'defrost',
    'cop_actively_cooling',
    'auto_seat_left',
    'auto_seat_right',
    'auto_steering_wheel',
    'charger_voltage',
    'charger_current',
    'trip_charging',
    'charger_has_multiple_phases',
    'battery_heater',
    'charge_at_arrival',
    'dashcam',
    'tire_warn_fl',
    'tire_warn_fr',
    'tire_warn_rl',
    'tire_warn_rr',
    'speed',
    'power',
    'traffic_delay',
    'keyless',
    'media_player',
  ]),
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

/**
 * The ambiguity-guard collapse, declared ONCE (Story 17.2 / D-LF-1): under
 * ambiguity NEVER classify with the tie-break guess — fall to the conservative
 * bundled default `tesla_fleet` (the resolver's guard posture, now
 * dispatch-wide). Identity for every unambiguous report —
 * `source:'override'`/`'default'`/unambiguous-`'probe'` alike: returns
 * `report.integration` VERBATIM, never re-derived from candidates/precedence
 * (an override report's `candidates` is `[override]`, a default report's is
 * `[]` — deriving would break both). Pure function of the report: no `hass`,
 * no registry read, no mutation. Consumed by `adapterFor`'s dispatch (below)
 * and the resolver's `effectiveDialect` (`resolve.ts`) so the collapse RULE
 * can never drift between them — their probe SCOPES still differ
 * (registry-wide vs vehicle-device), so their RESULTS may legitimately differ
 * on a split household (the Story-17.2 scope-boundary pins document exactly
 * that). The REPORT stays raw — the collapse is applied at CONSUMPTION, never
 * written into `DialectReport` (see the design note on `detectVehicleDialect`,
 * `resolve.ts`: pre-collapsing `integration` would invite a consumer to
 * misread `ambiguous: true` beside an already-collapsed value).
 */
export function collapseDialect(report: DialectReport): Integration {
  return report.ambiguous ? 'tesla_fleet' : report.integration;
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
 *
 * `scope` (Story 14.2): an optional set of the resolved vehicle device's entity
 * ids. When supplied, the probe counts ONLY entities in that set, so a split-
 * platform household (a `tesla_custom` car + a `tesla_fleet` Powerwall) is
 * probed per-device — the car's device speaks one dialect, no false ambiguity.
 * When omitted, the probe counts registry-wide exactly as before, so the
 * fire-and-forget editor caller (`tesla-card.ts`) and `adapterFor` keep their
 * "which dialects exist anywhere" semantics. The scope is passed DOWN as a
 * parameter — `dialect.ts` never imports `resolve.ts` (the `no-cycle` gate holds).
 *
 * Post-Story-15.1 reality: the DOMINANT call path arrives with a parent-stamped
 * `config.integration` (the resolver's effective dialect, written onto the
 * resolved config by `tesla-card.ts` `_resolve()`), so this function usually
 * returns from the override branch with ZERO registry iteration. The unscoped
 * registry-wide probe still runs, but only for genuinely unstamped configs —
 * the editor stub probe, the Scene's energy path (`bindFlowModel`), and
 * pre-first-resolve renders. "Unscoped by design" ≠ "unscoped in practice".
 */
export function detectDialect(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  scope?: ReadonlySet<string>
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

  // 2) Probe entity platforms per Tesla platform. The platform string, not the
  //    device, names the dialect (a Tesla-manufacturer device with no `platform`
  //    cannot name an Integration, so detectVehicle's manufacturer fallback is
  //    intentionally NOT mirrored here). Story 14.2 realised the once-deferred
  //    "vehicle-device-scoped weighting": when `scope` is provided the loop counts
  //    ONLY entities whose `entity_id` is in it (the resolved vehicle device's
  //    entities), so a split-platform household is disambiguated to the car's own
  //    dialect. Omitting `scope` keeps the registry-wide "which dialects exist
  //    anywhere" count for the unscoped editor/`adapterFor` callers.
  const counts = new Map<Integration, number>();
  const entities = hass?.entities as Record<string, any> | undefined;
  if (entities) {
    for (const ent of Object.values(entities)) {
      if (scope && !scope.has(ent?.entity_id)) continue;
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

/**
 * Convenience dispatch: the adapter for the detected/overridden dialect.
 * Deliberately unscoped — but since Story 15.1 the components' calls arrive on a
 * parent-stamped config (`_resolvedConfig.integration` = the resolver's effective
 * vehicle dialect), so the detection inside short-circuits on the override branch:
 * an O(1) table dispatch per call, no registry scan, and hero/panel classify with
 * the SAME dialect the resolver aliased by. Only genuinely unstamped callers
 * (the Scene's `bindFlowModel` energy path, pre-first-resolve renders) still
 * reach the registry-wide probe — and collapse exactly as the resolver does
 * (`collapseDialect`, Story 17.2): an ambiguous ≥2-platform probe dispatches
 * the conservative `tesla_fleet` adapter, never the tie-break pick.
 */
export function adapterFor(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): DialectAdapter {
  return DIALECTS[collapseDialect(detectDialect(hass, config))];
}
