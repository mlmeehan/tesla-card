// @vitest-environment jsdom
//
// Element-level gate for Story 5.6 (Climate Panel). The panel pre-existed and was
// already wired into the shell; this story closes three AC gaps and these tests
// pin them as regressions:
//   AC1 — the stepper (± + readout), six seat/wheel cyclers and the defrost +
//         cabin-overheat toggles render; the readout reflects the fixture temp;
//   AC2 — optimistic-then-reconcile: a tap flips the SIGHTED control instantly
//         (before any hass change) and fires its service EXACTLY once; a fresh
//         hass matching the request clears the override; aria-pressed/aria-label
//         announce the SETTLED (pre-tap) state, never the optimistic guess;
//   AC3 — a missing ambient sensor HIDES its tile (no "—"); a missing climate
//         entity disables the stepper + pill (readout "—", not a false "off"); a
//         missing seat select disables its cycler; an asleep car never throws.
//
// Entity ids come from const.ts DEFAULT_ENTITIES (never inlined — the components/
// hard-coded-id guard); a FRESH hass per state swap so Lit's @property change
// fires willUpdate; callService is a vi.fn() spy (single-call contract).
import { afterEach, describe, expect, test, vi } from 'vitest';
import './panel-climate';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import asleepFx from '../fixtures/model-y-asleep.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

type PanelEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

const ID = {
  climate: DEFAULT_ENTITIES.climate,
  inside: DEFAULT_ENTITIES.inside_temp,
  outside: DEFAULT_ENTITIES.outside_temp,
  defrost: DEFAULT_ENTITIES.defrost,
  cop: DEFAULT_ENTITIES.cabin_overheat_protection,
  seatFl: DEFAULT_ENTITIES.seat_fl,
  wheel: DEFAULT_ENTITIES.steering_wheel_heater,
} as const;

/** Deep-clone the fixture states so each test mutates an isolated copy. */
function baseStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(awakeFx.states)) as Record<string, HassEntity>;
}

/** A fresh hass (new reference → Lit @property change fires) with a spy service. */
function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return {
    states,
    callService: vi.fn().mockResolvedValue(undefined),
  } as unknown as HomeAssistant;
}

async function mount(hass: HomeAssistant): Promise<PanelEl> {
  const el = document.createElement('tc-panel-climate') as PanelEl;
  el.hass = hass;
  el.config = { type: 'custom:tesla-card' }; // entities default to DEFAULT_ENTITIES
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Assign a fresh hass and settle the render (reconcile discipline). */
async function pushHass(el: PanelEl, states: Record<string, HassEntity>): Promise<HomeAssistant> {
  const hass = makeHass(states);
  el.hass = hass;
  await el.updateComplete;
  return hass;
}

const q = <T extends Element = Element>(el: PanelEl, sel: string): T[] =>
  [...el.shadowRoot!.querySelectorAll<T>(sel)];
const steps = (el: PanelEl) => q<HTMLButtonElement>(el, '.step');
const seats = (el: PanelEl) => q<HTMLButtonElement>(el, '.seat');
const toggles = (el: PanelEl) => q<HTMLButtonElement>(el, '.toggle-tile');
const bigpill = (el: PanelEl) => el.shadowRoot!.querySelector<HTMLButtonElement>('.bigpill')!;
const readout = (el: PanelEl) => el.shadowRoot!.querySelector('.readout .t')!.textContent?.trim() ?? '';
const tiles = (el: PanelEl) => q(el, '.stat .k').map((n) => n.textContent ?? '');

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ── AC1 — controls render ────────────────────────────────────────────────────
describe('AC1 — stepper + seat/wheel cyclers + defrost/cabin-overheat toggles render', () => {
  test('the stepper renders two ± buttons and the fixture setpoint (21)', async () => {
    const el = await mount(makeHass(baseStates()));
    expect(steps(el)).toHaveLength(2);
    expect(readout(el)).toBe('21'); // climate.temperature
  });

  test('six seat/wheel cyclers and both extras toggles render', async () => {
    const el = await mount(makeHass(baseStates()));
    expect(seats(el)).toHaveLength(6);
    const labels = toggles(el).map((b) => b.textContent?.trim() ?? '');
    expect(labels.some((t) => t.includes(STRINGS.climate.defrost))).toBe(true);
    expect(labels.some((t) => t.includes(STRINGS.climate.cabinOverheat))).toBe(true);
  });

  test('both ambient tiles render when their sensors are present', async () => {
    const el = await mount(makeHass(baseStates()));
    expect(tiles(el)).toEqual([STRINGS.climate.inside, STRINGS.climate.outside]);
  });
});

// ── AC2 — optimistic-then-reconcile + settled-state SR announce ───────────────
describe('AC2 — optimistic flip, single service call, reconcile, settled SR announce', () => {
  test('tapping defrost (off→on) flips the tile OPTIMISTICALLY before any hass change', async () => {
    const hass = makeHass(baseStates()); // defrost off
    const el = await mount(hass);
    const defrost = toggles(el)[0];
    expect(defrost.classList.contains('on')).toBe(false);
    defrost.click(); // request on — no hass tick yet
    await el.updateComplete;
    expect(defrost.classList.contains('on')).toBe(true); // optimistic on
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('switch', 'toggle', { entity_id: ID.defrost });
  });

  test('aria-pressed/aria-label announce the SETTLED state, not the optimistic guess', async () => {
    const el = await mount(makeHass(baseStates())); // defrost off (settled)
    const defrost = toggles(el)[0];
    expect(defrost.getAttribute('aria-pressed')).toBe('false');
    const labelBefore = defrost.getAttribute('aria-label')!;
    expect(labelBefore).toBe(srOf(STRINGS.climate.defrost, STRINGS.climate.stateOff));

    defrost.click(); // optimistic on
    await el.updateComplete;
    expect(defrost.classList.contains('on')).toBe(true); // sighted flipped
    expect(defrost.getAttribute('aria-pressed')).toBe('false'); // SR still settled (off)
    expect(defrost.getAttribute('aria-label')).toBe(labelBefore); // unchanged until reconcile
  });

  test('a reconciled hass matching the request CLEARS the override (single source of truth)', async () => {
    const el = await mount(makeHass(baseStates())); // defrost off
    toggles(el)[0].click(); // optimistic on
    await el.updateComplete;
    expect(toggles(el)[0].classList.contains('on')).toBe(true);

    // Command lands: real defrost becomes on → matches the request → override clears.
    const states = baseStates();
    states[ID.defrost].state = 'on';
    await pushHass(el, states);
    expect(toggles(el)[0].classList.contains('on')).toBe(true);
    expect(toggles(el)[0].getAttribute('aria-pressed')).toBe('true'); // now settled

    // Prove the override truly cleared: an external defrost-off now drives it off.
    const off = baseStates();
    off[ID.defrost].state = 'off';
    await pushHass(el, off);
    expect(toggles(el)[0].classList.contains('on')).toBe(false);
  });

  test('tapping the Climate pill (on→off) fires climate.turn_off once, optimistic flip', async () => {
    const hass = makeHass(baseStates()); // climate heat_cool → on
    const el = await mount(hass);
    expect(bigpill(el).classList.contains('on')).toBe(true);
    expect(bigpill(el).getAttribute('aria-pressed')).toBe('true'); // settled on
    bigpill(el).click(); // request off
    await el.updateComplete;
    expect(bigpill(el).classList.contains('on')).toBe(false); // optimistic off
    expect(bigpill(el).getAttribute('aria-pressed')).toBe('true'); // SR still settled on
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('climate', 'turn_off', { entity_id: ID.climate });
  });

  test('tapping a seat cycler advances the level optimistically and selects the next option once', async () => {
    const hass = makeHass(baseStates()); // steering wheel = Low (options Off/Low/High)
    const el = await mount(hass);
    const wheel = seats(el)[2]; // render order: fl, fr, wheel, rl, rc, rr
    const barsBefore = wheel.querySelectorAll('.bar.fill').length;
    wheel.click(); // Low → High
    await el.updateComplete;
    expect(seats(el)[2].querySelectorAll('.bar.fill').length).toBeGreaterThan(barsBefore);
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('select', 'select_option', {
      entity_id: ID.wheel,
      option: 'High',
    });
    // SR name reflects the SETTLED (pre-tap) level, not the optimistic High.
    expect(seats(el)[2].getAttribute('aria-label')).toBe(
      srOf(`${STRINGS.climate.seats.wheel} ${STRINGS.climate.heater}`, 'Low')
    );
  });

  test('tapping ＋ jumps the readout to the clamped temp and sets it once', async () => {
    const hass = makeHass(baseStates()); // temperature 21, step 0.5
    const el = await mount(hass);
    steps(el)[1].click(); // raise
    await el.updateComplete;
    expect(readout(el)).toBe('21.5'); // optimistic jump
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('climate', 'set_temperature', {
      entity_id: ID.climate,
      temperature: 21.5,
    });
  });

  test('tapping − lowers the readout one step and sets it once', async () => {
    const hass = makeHass(baseStates()); // temperature 21, step 0.5
    const el = await mount(hass);
    steps(el)[0].click(); // lower
    await el.updateComplete;
    expect(readout(el)).toBe('20.5'); // optimistic drop
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('climate', 'set_temperature', {
      entity_id: ID.climate,
      temperature: 20.5,
    });
  });

  test('the setpoint clamps at max — ＋ at the ceiling stays put (NaN-safe boundary)', async () => {
    const states = baseStates();
    states[ID.climate].attributes!.temperature = 28; // max_temp
    const hass = makeHass(states);
    const el = await mount(hass);
    expect(readout(el)).toBe('28');
    steps(el)[1].click(); // raise past the ceiling
    await el.updateComplete;
    expect(readout(el)).toBe('28'); // clamped, never 28.5
    expect(hass.callService).toHaveBeenCalledWith('climate', 'set_temperature', {
      entity_id: ID.climate,
      temperature: 28,
    });
  });

  test('tapping cabin-overheat routes through the climate domain (turn_on, NOT switch.toggle)', async () => {
    const hass = makeHass(baseStates()); // cabin_overheat_protection off (climate-domain entity)
    const el = await mount(hass);
    const cop = toggles(el)[1];
    expect(cop.classList.contains('on')).toBe(false);
    expect(cop.getAttribute('aria-pressed')).toBe('false');
    cop.click(); // request on
    await el.updateComplete;
    expect(cop.classList.contains('on')).toBe(true); // optimistic on
    expect(cop.getAttribute('aria-pressed')).toBe('false'); // SR still settled off
    expect(hass.callService).toHaveBeenCalledTimes(1);
    // cabin_overheat_protection is a climate entity → turn_on, not switch.toggle.
    expect(hass.callService).toHaveBeenCalledWith('climate', 'turn_on', { entity_id: ID.cop });
  });

  test('tapping the Climate pill (off→on) fires climate.turn_on once, optimistic flip', async () => {
    const states = baseStates();
    states[ID.climate].state = 'off';
    const hass = makeHass(states);
    const el = await mount(hass);
    expect(bigpill(el).classList.contains('on')).toBe(false);
    expect(bigpill(el).getAttribute('aria-pressed')).toBe('false'); // settled off
    bigpill(el).click(); // request on
    await el.updateComplete;
    expect(bigpill(el).classList.contains('on')).toBe(true); // optimistic on
    expect(bigpill(el).getAttribute('aria-pressed')).toBe('false'); // SR still settled off
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('climate', 'turn_on', { entity_id: ID.climate });
  });

  test('a seat cycler wraps from the highest level back to Off (boundary)', async () => {
    const hass = makeHass(baseStates()); // seat_fl = High (Off/Low/Medium/High)
    const el = await mount(hass);
    const fl = seats(el)[0]; // render order: fl, fr, wheel, rl, rc, rr
    expect(fl.querySelectorAll('.bar.fill').length).toBe(3); // High = all bars
    fl.click(); // High → wraps to Off
    await el.updateComplete;
    expect(seats(el)[0].querySelectorAll('.bar.fill').length).toBe(0); // Off = no bars
    expect(seats(el)[0].classList.contains('on')).toBe(false);
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('select', 'select_option', {
      entity_id: ID.seatFl,
      option: 'Off',
    });
  });

  test('an expired fence honestly REVERTS the optimistic value when no command lands', async () => {
    vi.useFakeTimers();
    const el = await mount(makeHass(baseStates())); // defrost off
    const defrost = toggles(el)[0];
    defrost.click(); // optimistic on, fence armed
    await el.updateComplete;
    expect(toggles(el)[0].classList.contains('on')).toBe(true); // optimistic on
    // No reconciling hass ever arrives → the fence fires and drops the override.
    vi.advanceTimersByTime(20_000);
    await el.updateComplete;
    expect(toggles(el)[0].classList.contains('on')).toBe(false); // reverted to settled off
  });

  test('an unavailable control never enters the optimistic path (no service call, no flip)', async () => {
    const states = baseStates();
    states[ID.defrost].state = 'unavailable';
    const hass = makeHass(states);
    const el = await mount(hass);
    const defrost = toggles(el)[0];
    expect(defrost.disabled).toBe(true);
    defrost.click();
    await el.updateComplete;
    expect(hass.callService).not.toHaveBeenCalled();
    expect(defrost.classList.contains('on')).toBe(false);
  });

  test('disconnectedCallback clears the per-tap fence — no orphaned timer (UX-DR23)', async () => {
    vi.useFakeTimers();
    const el = await mount(makeHass(baseStates()));
    const timers = (el as unknown as { _timers: Map<string, unknown> })._timers;
    toggles(el)[0].click(); // arms a fence for 'defrost'
    await el.updateComplete;
    expect(timers.size).toBe(1);
    el.remove(); // disconnectedCallback → clear all fences
    expect(timers.size).toBe(0);
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();
  });
});

// ── AC3 — missing entity hides/degrades, never a false reading ────────────────
describe('AC3 — graceful degradation: hide ambient tiles, disable on missing, no false state', () => {
  test('a missing ambient sensor HIDES its tile (renders nothing, no "—")', async () => {
    const states = baseStates();
    states[ID.inside].state = 'unavailable';
    const el = await mount(makeHass(states));
    expect(tiles(el)).toEqual([STRINGS.climate.outside]); // inside gone, outside intact
  });

  test('both ambient sensors missing → no stat tiles at all (no "—" wall)', async () => {
    const states = baseStates();
    states[ID.inside].state = 'unavailable';
    states[ID.outside].state = 'unavailable';
    const el = await mount(makeHass(states));
    expect(tiles(el)).toHaveLength(0);
  });

  test('an unavailable climate entity disables the stepper + pill and reads "—", not a false "off"', async () => {
    const states = baseStates();
    states[ID.climate].state = 'unavailable';
    const el = await mount(makeHass(states));
    expect(steps(el).every((b) => b.disabled)).toBe(true);
    expect(bigpill(el).disabled).toBe(true);
    expect(readout(el)).toBe('—'); // setpoint attr gone with the unavailable entity
  });

  test('an unavailable seat select disables that cycler', async () => {
    const states = baseStates();
    states[ID.seatFl].state = 'unavailable';
    const el = await mount(makeHass(states));
    expect(seats(el)[0].disabled).toBe(true);
  });

  test('a fully-asleep car renders without throwing', async () => {
    const states = JSON.parse(JSON.stringify(asleepFx.states)) as Record<string, HassEntity>;
    const el = await mount(makeHass(states));
    expect(el.shadowRoot!.querySelector('.wrap')).not.toBeNull();
  });
});

// ── DoD a11y floor — decorative-hidden + announced setpoint (UX-DR21) ─────────
describe('DoD a11y — decorative bars hidden, setpoint grouped + live-announced', () => {
  test('each cycler’s decorative .bars is aria-hidden (SC 4.1.2 — not exposed)', async () => {
    const el = await mount(makeHass(baseStates()));
    const bars = q(el, '.bars');
    expect(bars).toHaveLength(6); // one per seat/wheel cycler
    expect(bars.every((b) => b.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  test('the stepper is a labelled role=group naming the setpoint it announces', async () => {
    const el = await mount(makeHass(baseStates()));
    const stepper = el.shadowRoot!.querySelector('.stepper')!;
    expect(stepper.getAttribute('role')).toBe('group');
    expect(stepper.getAttribute('aria-label')).toBe(STRINGS.climate.setpoint);
  });

  test('the readout is an aria-live=polite region so the setpoint change is announced once', async () => {
    const el = await mount(makeHass(baseStates()));
    const region = el.shadowRoot!.querySelector('.readout')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  test('an unavailable seat cycler announces a NEUTRAL name (no false settled level)', async () => {
    const states = baseStates();
    states[ID.seatFl].state = 'unavailable';
    const el = await mount(makeHass(states));
    // Honest freshness: no "…, High" leaked from a sensor we cannot read.
    expect(seats(el)[0].getAttribute('aria-label')).toBe(
      `${STRINGS.climate.seats.fl} ${STRINGS.climate.heater}`
    );
  });
});

/** Mirror helpers.srState for assertions without importing presentation. */
function srOf(label: string, state: string): string {
  return `${label}, ${state}`;
}
