// Co-located unit test for the observed-state wake gate (Story 5.4) — the
// CI-blocking no-wake-under-`online`/`waking` invariant, peer to the AR-6
// sign-convention property tests (flow/balance.test.ts).
//
// Pure-hub test: environment 'node' (reads hass.states via the freshness reader,
// no DOM — no jsdom pragma); hermetic — reuses the committed model-y fixtures and
// constructs the stale-`'on'` / missing-status cases by cloning + editing states
// (the corpus has no such case), mirroring commands.test.ts's fixture-clone
// discipline. ZERO network.
//
// DISCIPLINE: assert the RULE, not one example — the invariant is checked at BOTH
// levels (the pure gate AND the call site, a vi.fn() callService spy that must
// never fire `button.press` against the wake id under online/waking). Inject `now`
// only for the stale case; the "currently online/asleep" cases use the fixture's
// own stamps as the server reference (referenceNow = max stamp).
import { describe, expect, test, vi } from 'vitest';
import awake from '../fixtures/model-y-awake.json';
import asleep from '../fixtures/model-y-asleep.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';
import { DEFAULT_ENTITIES } from '../const';
import { pressButton } from '../helpers';
import {
  canWake,
  observedWakeState,
  wakeCooldownRemaining,
  formatCooldown,
  WAKE_COOLDOWN_DEFAULT_MS,
} from './wake';

const STATUS = DEFAULT_ENTITIES.status;
const WAKE = DEFAULT_ENTITIES.wake;

/** The instant every fixture entity is stamped at (so referenceNow = this). */
const STAMP_NOW = Date.parse('2026-06-15T14:41:00Z');

type States = Record<string, HassEntity>;
const awakeStates = awake.states as States;
const asleepStates = asleep.states as States;

/** Deep-ish clone of a states map (enough to edit one entity without mutating the import). */
function clone(states: States): States {
  return JSON.parse(JSON.stringify(states)) as States;
}

/** A HomeAssistant carrying the states map + a callService spy (the wake call site). */
function makeHass(states: States): HomeAssistant {
  return { states, callService: vi.fn().mockResolvedValue(undefined) } as unknown as HomeAssistant;
}

function cfg(over: Partial<TeslaCardConfig> = {}): TeslaCardConfig {
  return { type: 'custom:tesla-card', ...over };
}

/**
 * The production call site, distilled: a wake fires ONLY when the gate allows it.
 * Returns whether `button.press` was issued so tests assert the spy at the call
 * site, not just the pure boolean.
 */
function attemptWake(
  hass: HomeAssistant,
  config: TeslaCardConfig,
  opts: Parameters<typeof canWake>[2] = {}
): boolean {
  if (!canWake(hass, config, opts)) return false;
  pressButton(hass, DEFAULT_ENTITIES.wake);
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC5 — the invariant: never wake an observed online/waking car
// ───────────────────────────────────────────────────────────────────────────

describe('AC1/AC5 — no wake under observed online/waking (the CI-blocking invariant)', () => {
  test('online (fresh `on`) → observedWakeState=online, canWake=false, NO button.press', () => {
    const hass = makeHass(awakeStates); // status 'on', stamped at STAMP_NOW
    // referenceNow defaults to the max fixture stamp → age 0 → fresh 'on' → online.
    expect(observedWakeState(hass, cfg())).toBe('online');
    expect(canWake(hass, cfg())).toBe(false);
    // Call site: a wake attempt is refused — the spy never fires for the wake id.
    expect(attemptWake(hass, cfg())).toBe(false);
    expect(hass.callService).not.toHaveBeenCalled();
  });

  test('waking (a wake in flight within the cooldown window) → canWake=false, NO button.press', () => {
    // Asleep status (not online) + a last-wake inside the window → in-flight.
    const hass = makeHass(asleepStates);
    const clientNow = 10_000_000;
    const opts = { lastWakeAt: clientNow, clientNow, cooldownMs: WAKE_COOLDOWN_DEFAULT_MS };
    expect(observedWakeState(hass, cfg(), opts)).toBe('waking');
    expect(canWake(hass, cfg(), opts)).toBe(false);
    expect(attemptWake(hass, cfg(), opts)).toBe(false);
    expect(hass.callService).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC2 — the asleep path stays open (explicit wake never blocked)
// ───────────────────────────────────────────────────────────────────────────

describe('AC1/AC2 — an explicit wake of an asleep car is never blocked', () => {
  test('asleep (fresh `off`, no wake in flight) → observedWakeState=asleep, canWake=true, fires button.press', () => {
    const hass = makeHass(asleepStates); // status 'off', stamped at STAMP_NOW → fresh
    expect(observedWakeState(hass, cfg())).toBe('asleep');
    expect(canWake(hass, cfg())).toBe(true);
    expect(attemptWake(hass, cfg())).toBe(true);
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', { entity_id: WAKE });
  });

  test('once the cooldown elapses an asleep car is wakeable again (window expires, no lock-out)', () => {
    const hass = makeHass(asleepStates);
    const wokeAt = 10_000_000;
    // Same instant as the press → waking (blocked).
    expect(canWake(hass, cfg(), { lastWakeAt: wokeAt, clientNow: wokeAt })).toBe(false);
    // After the window → asleep (allowed again).
    const later = wokeAt + WAKE_COOLDOWN_DEFAULT_MS + 1;
    expect(canWake(hass, cfg(), { lastWakeAt: wokeAt, clientNow: later })).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1 (the subtle one) — freshness applied recursively to the online signal
// ───────────────────────────────────────────────────────────────────────────

describe('AC1 — a STALE `on` is not "online" (never trust a stale online signal)', () => {
  test('stale `on` → NOT online → canWake=true (an explicit wake is not hard-blocked by a false online)', () => {
    // Clone awake, back-date ONLY the status stamp 50 min, inject now=STAMP_NOW so
    // the 'on' reads stale (age 50m > the asleep window) — the recursive-freshness
    // case the corpus does not supply.
    const states = clone(awakeStates);
    states[STATUS].last_updated = '2026-06-15T13:51:00Z';
    states[STATUS].last_changed = '2026-06-15T13:51:00Z';
    const hass = makeHass(states);
    const opts = { now: STAMP_NOW };
    expect(observedWakeState(hass, cfg(), opts)).not.toBe('online');
    expect(canWake(hass, cfg(), opts)).toBe(true);
    expect(attemptWake(hass, cfg(), opts)).toBe(true);
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', { entity_id: WAKE });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FR-24 / NFR-4 — a missing signal degrades safe (never a false online, never a throw)
// ───────────────────────────────────────────────────────────────────────────

describe('graceful degradation — missing online signal → safe default (asleep/allow)', () => {
  test('status entity absent → unknown, canWake=true, fires button.press, never throws', () => {
    const states = clone(awakeStates);
    delete states[STATUS];
    const hass = makeHass(states);
    expect(() => observedWakeState(hass, cfg())).not.toThrow();
    expect(observedWakeState(hass, cfg())).toBe('unknown');
    expect(canWake(hass, cfg())).toBe(true);
    expect(attemptWake(hass, cfg())).toBe(true);
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', { entity_id: WAKE });
  });

  test('unavailable status → not online → canWake=true', () => {
    const states = clone(awakeStates);
    states[STATUS].state = 'unavailable';
    const hass = makeHass(states);
    expect(observedWakeState(hass, cfg())).not.toBe('online');
    expect(canWake(hass, cfg())).toBe(true);
  });

  test('no hass at all → never throws, degrades to wakeable', () => {
    expect(() => observedWakeState(undefined, cfg())).not.toThrow();
    expect(canWake(undefined, cfg())).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — pure cooldown math (NaN-safe; recompute, no clock)
// ───────────────────────────────────────────────────────────────────────────

describe('AC2 — wakeCooldownRemaining (pure, NaN-safe)', () => {
  test('no last-wake → 0 (never NaN)', () => {
    expect(wakeCooldownRemaining(undefined, 60_000, 1_000)).toBe(0);
  });

  test('within the window → the remaining ms; elapsed → 0; never negative', () => {
    expect(wakeCooldownRemaining(1_000, 60_000, 31_000)).toBe(30_000);
    expect(wakeCooldownRemaining(1_000, 60_000, 61_001)).toBe(0);
    expect(wakeCooldownRemaining(1_000, 60_000, 999_999)).toBe(0);
  });

  test('non-finite inputs → 0 (NaN-safe)', () => {
    expect(wakeCooldownRemaining(NaN, 60_000, 1_000)).toBe(0);
    expect(wakeCooldownRemaining(1_000, NaN, 1_000)).toBe(0);
    expect(wakeCooldownRemaining(1_000, 60_000, NaN)).toBe(0);
  });
});

describe('AC2 — formatCooldown ceils to the next minute (never "0m" while time remains)', () => {
  test('sub-minute remainders read "1m"; nothing remaining reads ""', () => {
    expect(formatCooldown(0)).toBe('');
    expect(formatCooldown(-5)).toBe('');
    expect(formatCooldown(1_000)).toBe('1m');
    expect(formatCooldown(60_000)).toBe('1m');
    expect(formatCooldown(90_000)).toBe('2m');
    expect(formatCooldown(120_001)).toBe('3m');
  });

  test('an hour-plus remainder rolls to hours', () => {
    expect(formatCooldown(60 * 60_000)).toBe('1h');
    expect(formatCooldown(91 * 60_000)).toBe('2h');
  });
});
