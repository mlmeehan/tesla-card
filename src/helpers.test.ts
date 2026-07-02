// Pure-function sweep for `helpers.ts` — the un-tested read/format/service kernel.
//
// Environment 'node': every helper covered here reads plain values or a stub
// `hass` — no DOM. The DOM-bound helpers (`fireEvent`, `moreInfo`) are deliberately
// SKIPPED (they require a live element; wrong env). Hermetic, no wall-clock.
import { describe, expect, test, vi } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from './types';
import { DEFAULT_ENTITIES, type EntityKey } from './const';
import {
  entityId,
  stateObj,
  rawState,
  isMissing,
  isUnavailable,
  isOn,
  isAsleep,
  num,
  formatNumber,
  prettyText,
  formatHoursToHM,
  formatMinutesToHM,
  formatAge,
  display,
  clamp,
  domainOf,
  srState,
  toggleEntity,
  pressButton,
  setNumber,
  selectOption,
} from './helpers';

const CONFIG: TeslaCardConfig = { type: 'custom:tesla-card' };

/** Build a states map keyed by a function-key's DEFAULT entity id (no config override needed). */
function state(
  key: EntityKey,
  s: string,
  attributes: Record<string, unknown> = {}
): Record<string, unknown> {
  return { [DEFAULT_ENTITIES[key]]: { state: s, attributes } };
}
function makeHass(states: Record<string, unknown>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}

// ───────────────────────────────────────────────────────────────────────────
// isMissing vs isUnavailable — the load-bearing distinction. `button` entities
// report 'unknown' until first press (and reset to 'unknown' every HA restart),
// so isMissing MUST treat 'unknown' as PRESENT — else every never-pressed command
// (wake included) is disabled on a fresh install, making an asleep car un-wakeable.
// isUnavailable is the wider sensor/toggle predicate where 'unknown' = no reading.
// ───────────────────────────────────────────────────────────────────────────
describe('isMissing vs isUnavailable — the button-domain command-gate distinction', () => {
  test('isMissing is true ONLY for undefined / "unavailable" — never for "unknown"/"none"/""', () => {
    expect(isMissing(undefined)).toBe(true);
    expect(isMissing('unavailable')).toBe(true);
    expect(isMissing('unknown')).toBe(false); // never-pressed button stays commandable
    expect(isMissing('none')).toBe(false);
    expect(isMissing('')).toBe(false);
    expect(isMissing('2026-01-01T00:00:00+00:00')).toBe(false);
  });

  test('isUnavailable is the WIDER predicate — "unknown"/"none"/"" all count as unavailable', () => {
    expect(isUnavailable(undefined)).toBe(true);
    expect(isUnavailable('unavailable')).toBe(true);
    expect(isUnavailable('unknown')).toBe(true); // sensor: no reading
    expect(isUnavailable('none')).toBe(true);
    expect(isUnavailable('')).toBe(true);
    expect(isUnavailable('54')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// hass-reading predicates.
// ───────────────────────────────────────────────────────────────────────────
describe('isOn — on-state membership with a default and custom on-states', () => {
  test('true only when the state is in onStates; missing entity is false', () => {
    expect(isOn(makeHass(state('status', 'on')), CONFIG, 'status')).toBe(true);
    expect(isOn(makeHass(state('status', 'off')), CONFIG, 'status')).toBe(false);
    expect(isOn(makeHass({}), CONFIG, 'status')).toBe(false); // undefined state → not on
    // custom on-states widen the match set.
    expect(isOn(makeHass(state('status', 'driving')), CONFIG, 'status', ['driving', 'online'])).toBe(true);
  });
});

describe('isAsleep — status-first with a battery fallback', () => {
  test('no hass → asleep; status "off" → asleep; status "on" → awake', () => {
    expect(isAsleep(undefined, CONFIG)).toBe(true);
    expect(isAsleep(makeHass(state('status', 'off')), CONFIG)).toBe(true);
    expect(isAsleep(makeHass(state('status', 'on')), CONFIG)).toBe(false);
  });

  test('status unavailable → falls back to battery: unavailable battery = asleep, present = awake', () => {
    const noBattery = { ...state('status', 'unknown'), ...state('battery_level', 'unavailable') };
    expect(isAsleep(makeHass(noBattery), CONFIG)).toBe(true);
    const hasBattery = { ...state('status', 'unknown'), ...state('battery_level', '54') };
    expect(isAsleep(makeHass(hasBattery), CONFIG)).toBe(false);
  });
});

describe('num — NaN-safe numeric read', () => {
  test('finite number passes; unavailable/non-numeric/empty all yield undefined', () => {
    expect(num(makeHass(state('battery_level', '54')), CONFIG, 'battery_level')).toBe(54);
    expect(num(makeHass(state('battery_level', 'unknown')), CONFIG, 'battery_level')).toBeUndefined();
    expect(num(makeHass(state('battery_level', 'abc')), CONFIG, 'battery_level')).toBeUndefined();
    expect(num(makeHass(state('battery_level', '')), CONFIG, 'battery_level')).toBeUndefined();
    expect(num(makeHass({}), CONFIG, 'battery_level')).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// pure formatters.
// ───────────────────────────────────────────────────────────────────────────
describe('formatNumber — fixed-fraction formatting', () => {
  test('honours the decimals arg (default 0)', () => {
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(5, 2)).toBe('5.00');
    expect(formatNumber(3.14159, 2)).toBe('3.14');
  });
});

describe('prettyText — underscores → spaces, first letter capitalised', () => {
  test('capitalises and de-underscores; empty string stays empty', () => {
    expect(prettyText('charging')).toBe('Charging');
    expect(prettyText('fully_charged')).toBe('Fully charged');
    expect(prettyText('')).toBe('');
  });
});

describe('formatHoursToHM / formatMinutesToHM — h/m boundaries', () => {
  test('fractional hours → "Xh Ym" / "Ym" / "Xh"; non-positive → "0m"', () => {
    expect(formatHoursToHM(0)).toBe('0m');
    expect(formatHoursToHM(-1)).toBe('0m'); // guarded: totalMin <= 0
    expect(formatHoursToHM(0.75)).toBe('45m'); // < 1h → minutes only
    expect(formatHoursToHM(3)).toBe('3h'); // exact hour → no trailing minutes
    expect(formatHoursToHM(2.5)).toBe('2h 30m');
  });

  test('minutes variant delegates through the same h/m rendering', () => {
    expect(formatMinutesToHM(0)).toBe('0m');
    expect(formatMinutesToHM(45)).toBe('45m');
    expect(formatMinutesToHM(150)).toBe('2h 30m');
  });
});

describe('formatAge — coarse relative magnitude, never overstating staleness', () => {
  test('< 1min / NaN / negative → ""; else floored m/h/d magnitude', () => {
    expect(formatAge(0)).toBe(''); // caller renders "Just now"
    expect(formatAge(30_000)).toBe('');
    expect(formatAge(Number.NaN)).toBe(''); // indeterminate age never reads as old
    expect(formatAge(-5_000)).toBe(''); // future stamp = freshest, not old
    expect(formatAge(60_000)).toBe('1m');
    expect(formatAge(47 * 60_000)).toBe('47m'); // floor — 47m never rounds up to 1h
    expect(formatAge(90 * 60_000)).toBe('1h');
    expect(formatAge(25 * 3_600_000)).toBe('1d');
  });
});

describe('display — pretty "value unit" or em-dash', () => {
  test('unavailable → em-dash; numeric → value(+unit); withUnit:false drops the unit', () => {
    expect(display(makeHass(state('battery_level', 'unknown')), CONFIG, 'battery_level')).toBe('—');
    expect(display(makeHass({}), CONFIG, 'battery_level')).toBe('—'); // missing entity
    const pct = makeHass(state('battery_level', '54', { unit_of_measurement: '%' }));
    expect(display(pct, CONFIG, 'battery_level')).toBe('54 %');
    expect(display(pct, CONFIG, 'battery_level', { withUnit: false })).toBe('54');
    const pct1 = makeHass(state('battery_level', '54.7', { unit_of_measurement: '%' }));
    expect(display(pct1, CONFIG, 'battery_level', { decimals: 1 })).toBe('54.7 %');
  });

  test('non-numeric state → prettyText (no unit appended)', () => {
    expect(display(makeHass(state('status', 'charging')), CONFIG, 'status')).toBe('Charging');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// tiny pure utilities.
// ───────────────────────────────────────────────────────────────────────────
describe('clamp / domainOf / srState', () => {
  test('clamp bounds to [lo, hi] and passes through inside values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  test('domainOf takes the segment before the first dot', () => {
    expect(domainOf('sensor.foo')).toBe('sensor');
    expect(domainOf('lock.front_door')).toBe('lock');
  });

  test('srState composes "label, state"', () => {
    expect(srState('Lock', 'locked')).toBe('Lock, locked');
    expect(srState('Charge port', 'open')).toBe('Charge port, open');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// service-call wrappers — a stub hass captures the (domain, service, data) call.
// ───────────────────────────────────────────────────────────────────────────
describe('service-call wrappers dispatch the right (domain, service, data)', () => {
  function stubHass(states: Record<string, unknown> = {}) {
    const callService = vi.fn(() => Promise.resolve());
    return { hass: { states, callService } as unknown as HomeAssistant, callService };
  }

  test('toggleEntity picks the domain-correct service and toggle sense', () => {
    const { hass, callService } = stubHass({
      'lock.door': { state: 'locked' },
      'cover.port': { state: 'open' },
      'climate.cabin': { state: 'off' },
    });
    toggleEntity(hass, 'lock.door');
    expect(callService).toHaveBeenLastCalledWith('lock', 'unlock', { entity_id: 'lock.door' });
    toggleEntity(hass, 'cover.port');
    expect(callService).toHaveBeenLastCalledWith('cover', 'close_cover', { entity_id: 'cover.port' });
    toggleEntity(hass, 'switch.pump');
    expect(callService).toHaveBeenLastCalledWith('switch', 'toggle', { entity_id: 'switch.pump' });
    toggleEntity(hass, 'climate.cabin');
    expect(callService).toHaveBeenLastCalledWith('climate', 'turn_on', { entity_id: 'climate.cabin' });
    toggleEntity(hass, 'button.wake');
    expect(callService).toHaveBeenLastCalledWith('button', 'press', { entity_id: 'button.wake' });
    toggleEntity(hass, 'sensor.mystery'); // unknown domain → generic toggle
    expect(callService).toHaveBeenLastCalledWith('homeassistant', 'toggle', { entity_id: 'sensor.mystery' });
  });

  test('pressButton / setNumber / selectOption forward their exact payloads', () => {
    const { hass, callService } = stubHass();
    pressButton(hass, 'button.honk');
    expect(callService).toHaveBeenLastCalledWith('button', 'press', { entity_id: 'button.honk' });
    setNumber(hass, 'number.limit', 80);
    expect(callService).toHaveBeenLastCalledWith('number', 'set_value', { entity_id: 'number.limit', value: 80 });
    selectOption(hass, 'select.mode', 'self_consumption');
    expect(callService).toHaveBeenLastCalledWith('select', 'select_option', {
      entity_id: 'select.mode',
      option: 'self_consumption',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// entityId / stateObj — the `config.entities` override seam every component read
// (num/rawState/attr/…) funnels through. The resolver's override-wins precedence
// is pinned in data/resolve.test.ts; THIS pins the component-side read: an
// explicit `config.entities[key]` must redirect the actual state lookup (trace
// K14 — write-proven + resolver-proven is not read-proven).
// ───────────────────────────────────────────────────────────────────────────
describe('entityId / stateObj — config.entities override redirects the component read', () => {
  const OVERRIDE: TeslaCardConfig = {
    type: 'custom:tesla-card',
    entities: { battery_level: 'sensor.custom_soc' },
  };

  test('entityId: absent/partial entities map falls back to the bundled default id', () => {
    expect(entityId(CONFIG, 'battery_level')).toBe(DEFAULT_ENTITIES.battery_level);
    // A partial map overrides ONLY its own key — siblings still resolve to defaults.
    expect(entityId(OVERRIDE, 'battery_range')).toBe(DEFAULT_ENTITIES.battery_range);
  });

  test('entityId: an explicit override wins over the bundled default', () => {
    expect(entityId(OVERRIDE, 'battery_level')).toBe('sensor.custom_soc');
  });

  test('stateObj/rawState read THROUGH the override — the overridden entity backs the value', () => {
    const hass = makeHass({
      ...state('battery_level', '72'), // the default entity is present AND readable…
      'sensor.custom_soc': { state: '37', attributes: {} },
    });
    // …but the override redirects the read to the custom sensor, never the default.
    expect(rawState(hass, OVERRIDE, 'battery_level')).toBe('37');
    expect(stateObj(hass, OVERRIDE, 'battery_level')).toBe(hass.states['sensor.custom_soc']);
    expect(num(hass, OVERRIDE, 'battery_level')).toBe(37);
    // Honest degrade through the override: a dead pick reads unavailable, not the default.
    const dead = makeHass({
      ...state('battery_level', '72'),
      'sensor.custom_soc': { state: 'unavailable', attributes: {} },
    });
    expect(num(dead, OVERRIDE, 'battery_level')).toBeUndefined();
  });
});
