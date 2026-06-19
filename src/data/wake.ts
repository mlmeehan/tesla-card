import type { HomeAssistant, TeslaCardConfig } from '../types';
import { read } from './freshness';
import { resolveEntities } from './resolve';

/**
 * D3 / AR-9 — the observed-state wake gate + per-instance cooldown math (Story 5.4).
 *
 * The card may wake an asleep car, but it must NEVER wake a car that is already
 * `online` or one whose wake is already in flight (`waking`). This module is the
 * single authority for that decision — a pure, hass-reading classifier in the
 * data layer (it reads `hass.states` only via the freshness reader, so it belongs
 * HERE, not in `helpers.ts`/`components/`; AR-1 / `no-bare-hass.states`). It is the
 * peer of the AR-6 sign-convention authority: `data/wake.test.ts` drives the
 * no-wake-under-`online`/`waking` invariant over the fixture corpus, and a
 * regression FAILS CI.
 *
 * THE LOAD-BEARING SUBTLETY — freshness applied recursively to the online signal.
 * The observed-online signal is itself a `hass.states` read, so it can be STALE.
 * A `status` that reads `'on'` but was last stamped 47 minutes ago does NOT prove
 * the car is awake now — it may well have gone back to sleep. Treating that stale
 * `'on'` as a hard "online" lock would block a legitimate wake, which is a WORSE
 * failure than a redundant wake (UX-DR18 / honest freshness). So `online` requires
 * a `'on'` that is ITSELF fresh (classified through `data/freshness`); a stale
 * `'on'` degrades to `unknown` → an explicit wake is allowed.
 *
 * CROSS-DEVICE, FREE (D3 / AR-9). Because the gate reads the SHARED `hass`, if
 * another dashboard or device already woke the car, `status` flips to a fresh
 * `'on'` for every card instance at once → every gate sees `online` → no double
 * wake. No shared HA helper is needed for the gate itself (the opt-in shared
 * cooldown helper is deferred / YAGNI per D3).
 *
 * PURITY. Every export is a pure function over `(hass, config, opts)`. The
 * per-instance last-wake timestamp lives in the COMPONENT (`tc-commands`,
 * a `@state()` field) and is passed in via `opts` — the gate never holds state,
 * runs no clock, and has no side effects. This keeps it trivially testable and
 * keeps `data/ ← flow/ ← components/` acyclic.
 *
 * Boundary: imports only sibling `data/` (`freshness`, `resolve`) + `types`.
 * Imports nothing from `flow/`/`components/` and holds NO copy of the AR-6 sign
 * convention — wake reads the DISCRETE online signal, never the FlowModel.
 */

// ───────────────────────────────────────────────────────────────────────────
// Vocabulary
// ───────────────────────────────────────────────────────────────────────────

/**
 * The four observed wake states. Only `online` and `waking` are hard-blocked by
 * {@link canWake}; `asleep` and `unknown` permit an explicit user-initiated wake
 * (degrade-safe — a missing/stale signal must never lock the user out).
 */
export type WakeState = 'online' | 'waking' | 'asleep' | 'unknown';

/**
 * Default cooldown window (ms). After a user wakes the car, repeat taps within
 * this window are treated as `waking` (in flight) so frantic tapping cannot burn
 * the metered Fleet wake budget, and the affordance surfaces "available in Nm".
 * Deliberately SHORT (1 min): long enough to fence the wake round-trip, short
 * enough that it can never read as a lock-out. Overridable per-card via
 * `config.wake_cooldown` (minutes). The exact value is an engineering choice —
 * tests assert the RULE relative to an injected window, never this constant.
 */
export const WAKE_COOLDOWN_DEFAULT_MS = 60_000;

/** Per-call options. All injectable so the gate is hermetic in tests. */
export interface WakeOpts {
  /**
   * Per-instance timestamp (CLIENT ms epoch, `Date.now()`) of the last
   * user-initiated wake press, or `undefined` when none this session. Owned by the
   * component; the gate stays pure.
   */
  lastWakeAt?: number;
  /** Cooldown / in-flight window (ms). Defaults to {@link WAKE_COOLDOWN_DEFAULT_MS}. */
  cooldownMs?: number;
  /** Client clock for the cooldown/`waking` window (default `Date.now()`). Injectable for tests. */
  clientNow?: number;
  /** HA server reference for the status-freshness read (default derived from `hass`). Injectable for tests. */
  now?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Cooldown math (pure, NaN-safe) — AC2
// ───────────────────────────────────────────────────────────────────────────

/**
 * Remaining cooldown (ms), recomputed from the stored timestamp on demand — there
 * is NO clock here (mirrors `referenceNow`'s "recompute on render" model; AC4
 * no-polling). `0` when there is no last-wake, the window has elapsed, or any
 * input is non-finite (NaN-safe; a missing last-wake → no cooldown, never `NaN`).
 */
export function wakeCooldownRemaining(
  lastWakeAt: number | undefined,
  cooldownMs: number,
  now: number
): number {
  if (
    lastWakeAt === undefined ||
    !Number.isFinite(lastWakeAt) ||
    !Number.isFinite(cooldownMs) ||
    !Number.isFinite(now)
  ) {
    return 0;
  }
  const remaining = lastWakeAt + cooldownMs - now;
  return remaining > 0 ? remaining : 0;
}

/**
 * Format a remaining-cooldown magnitude for the "available in {n}" copy. CEIL to
 * whole minutes (you never say "available in 0m" while time is left — round UP to
 * the next minute), so a 30s remainder reads `"1m"`. `''` when nothing remains
 * (the caller drops the cooldown phrasing entirely). Sub-minute remainders always
 * read `"1m"`; longer ones `"Nm"`/`"Nh"`. The complement of `formatAge` (which
 * floors elapsed age).
 */
export function formatCooldown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '';
  const min = Math.ceil(remainingMs / 60_000);
  if (min < 60) return `${min}m`;
  return `${Math.ceil(min / 60)}h`;
}

// ───────────────────────────────────────────────────────────────────────────
// The observed-state gate (the crux) — AC1, AC5
// ───────────────────────────────────────────────────────────────────────────

/**
 * Classify the observed wake state from the SHARED `hass`.
 *
 * Order is load-bearing:
 *  1. `online`  — `status` resolves to a FRESH `'on'` (the freshness triple applied
 *     recursively to the online signal; a stale `'on'` is NOT online).
 *  2. `waking`  — a user wake is in flight: a last-wake timestamp sits inside the
 *     cooldown window. Checked BEFORE `asleep` so the immediate post-press tick
 *     (status may still read `'off'` for a moment) classifies as in-flight, never
 *     as a freshly-wakeable `asleep` — this is what rate-limits frantic taps.
 *  3. `asleep`  — `status` resolves to a FRESH `'off'` with no wake in flight.
 *  4. `unknown` — signal missing / `unavailable` / stale (incl. a stale `'on'`).
 *     Degrade-safe: an explicit wake is ALLOWED (never a false `online` lock), but
 *     the card still never auto-wakes.
 */
export function observedWakeState(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  opts: WakeOpts = {}
): WakeState {
  const statusId = resolveEntities(hass, config).status;
  const r = read(hass, statusId, { now: opts.now });

  // 1. Only a FRESH 'on' is a trustworthy "online" (never a stale echo).
  if (r.available && r.staleness === 'fresh' && r.value === 'on') return 'online';

  // 2. A wake we just issued is still in flight → in-flight, not yet settled.
  const cooldownMs = opts.cooldownMs ?? WAKE_COOLDOWN_DEFAULT_MS;
  const clientNow = opts.clientNow ?? Date.now();
  if (wakeCooldownRemaining(opts.lastWakeAt, cooldownMs, clientNow) > 0) return 'waking';

  // 3. A fresh 'off' with no wake in flight → genuinely asleep (wakeable).
  if (r.available && r.staleness === 'fresh' && r.value === 'off') return 'asleep';

  // 4. Missing / unavailable / stale (incl. a stale 'on') → degrade safe.
  return 'unknown';
}

/**
 * The hard gate: `true` only when a wake may fire. Blocks `online` (already awake)
 * and `waking` (in flight) — the no-wake-under-`online`/`waking` invariant (AC1,
 * peer to AR-6). `asleep` and `unknown` return `true`: an explicit user-initiated
 * wake of an asleep — or signal-missing — car is NEVER blocked (AR-9). The
 * cooldown only ever produces the brief `waking` window; it never locks the user
 * out of a car that has settled back to `asleep`.
 */
export function canWake(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  opts: WakeOpts = {}
): boolean {
  const s = observedWakeState(hass, config, opts);
  return s !== 'online' && s !== 'waking';
}
