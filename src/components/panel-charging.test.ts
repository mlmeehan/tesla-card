// @vitest-environment jsdom
//
// Element-level gate for Story 5.5 (Charging Panel). The panel + both shared
// primitives pre-existed; this story closes the AC gaps, so these tests pin the
// deltas as regressions:
//   AC1 — statTile HIDES when its entity is missing (no "—" wall);
//   AC2 — both tc-sliders render with the entities' min/max/step; start/stop
//         reflects charge_switch; a slider commit calls number.set_value;
//   AC3 — the range/% toggle switches the headline; the charge-target line
//         renders iff charge_limit is present;
//   AC4 — the live cue derives from the canonical normalizeChargingState (NOT a
//         literal `=== 'Charging'`): a lowercase dialect spelling 'charging'
//         still lights the cue, which a string compare against 'Charging' would
//         miss — the load-bearing proof of the normalizer path.
//
// Entity ids come from const.ts DEFAULT_ENTITIES (never inlined — the components/
// hard-coded-id guard); a FRESH hass object per state swap so Lit's @property
// change fires. callService is a vi.fn() spy (rate-limit contract end-to-end).
import { afterEach, describe, expect, test, vi } from 'vitest';
import './panel-charging';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import { DIALECT_ENTITY_ALIASES } from '../data/dialect';
import awakeFx from '../fixtures/model-y-awake.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

type PanelEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

const ID = {
  battery: DEFAULT_ENTITIES.battery_level,
  range: DEFAULT_ENTITIES.battery_range,
  status: DEFAULT_ENTITIES.charging_status,
  limit: DEFAULT_ENTITIES.charge_limit,
  current: DEFAULT_ENTITIES.charge_current,
  charge: DEFAULT_ENTITIES.charge_switch,
  voltage: DEFAULT_ENTITIES.charger_voltage,
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

async function mount(
  hass: HomeAssistant,
  configOver: Partial<TeslaCardConfig> = {}
): Promise<PanelEl> {
  const el = document.createElement('tc-panel-charging') as PanelEl;
  el.hass = hass;
  // entities default to DEFAULT_ENTITIES; Story 15.1 cases pass the post-stamp
  // shape (integration + alias-resolved entity overrides) a child really sees.
  el.config = { type: 'custom:tesla-card', ...configOver };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const sliders = (el: PanelEl) =>
  [...el.shadowRoot!.querySelectorAll('tc-slider')] as Array<
    HTMLElement & { min: number; max: number; step: number; disabled: boolean; label: string }
  >;
const tileKeys = (el: PanelEl): string[] =>
  [...el.shadowRoot!.querySelectorAll('.stat .k')].map((n) => n.textContent ?? '');
const headline = (el: PanelEl): string =>
  el.shadowRoot!.querySelector('.bnum .big')?.textContent?.trim() ?? '';
const segOpts = (el: PanelEl) =>
  [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.seg-opt')];

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ── AC1 — battery summary + live tiles; tiles hide when missing ──────────────
describe('AC1 — battery summary + statTiles (hide-when-missing)', () => {
  test('battery summary renders the percent headline + all six stat tiles', async () => {
    const el = await mount(makeHass(baseStates()));
    expect(headline(el)).toBe('72'); // battery_level
    expect(tileKeys(el)).toHaveLength(6);
    expect(tileKeys(el)).toContain(STRINGS.charging.voltage);
  });

  test('a missing stat-entity HIDES its tile (no "—" wall)', async () => {
    const states = baseStates();
    states[ID.voltage].state = 'unavailable';
    const el = await mount(makeHass(states));
    const keys = tileKeys(el);
    expect(keys).not.toContain(STRINGS.charging.voltage);
    expect(keys).toHaveLength(5); // one fewer tile, the rest intact
  });
});

// ── AC2 — sliders (min/max/step from entity attrs) + start/stop + commit ─────
describe('AC2 — charge controls: sliders, start/stop, commit-on-release', () => {
  test('both tc-sliders render with the entities min/max/step', async () => {
    const el = await mount(makeHass(baseStates()));
    const [limit, current] = sliders(el);
    expect(limit.min).toBe(50);
    expect(limit.max).toBe(100);
    expect(limit.step).toBe(1);
    expect(limit.label).toBe(STRINGS.charging.chargeLimit);
    expect(current.min).toBe(0);
    expect(current.max).toBe(48);
    expect(current.step).toBe(1);
    expect(current.label).toBe(STRINGS.charging.chargeCurrent);
  });

  test('start/stop reflects charge_switch (on → "Stop charging")', async () => {
    const el = await mount(makeHass(baseStates())); // charge_switch 'on'
    const pill = el.shadowRoot!.querySelector('.bigpill')!;
    expect(pill.textContent).toContain(STRINGS.charging.stop);
    expect(pill.classList.contains('on')).toBe(true);
  });

  test('a slider value-changed commits number.set_value with the released value', async () => {
    const hass = makeHass(baseStates());
    const el = await mount(hass);
    sliders(el)[0].dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: 85 }, bubbles: true, composed: true })
    );
    expect(hass.callService).toHaveBeenCalledWith('number', 'set_value', {
      entity_id: ID.limit,
      value: 85,
    });
  });

  test('clicking start/stop toggles the charge switch', async () => {
    const hass = makeHass(baseStates());
    const el = await mount(hass);
    (el.shadowRoot!.querySelector('.bigpill') as HTMLButtonElement).click();
    expect(hass.callService).toHaveBeenCalledWith('switch', 'toggle', { entity_id: ID.charge });
  });

  test('rendering alone never commits (no value-changed → no set_value; rate-limit contract)', async () => {
    const hass = makeHass(baseStates());
    await mount(hass);
    expect(hass.callService).not.toHaveBeenCalled();
  });
});

// ── AC3 — range/% toggle + charge-target line ────────────────────────────────
describe('AC3 — display toggle + charge-target line', () => {
  test('the range/% toggle switches the headline between percent and range', async () => {
    const el = await mount(makeHass(baseStates()));
    expect(headline(el)).toBe('72'); // percent default
    const [pct, range] = segOpts(el);
    expect(pct.getAttribute('aria-pressed')).toBe('true');
    range.click();
    await el.updateComplete;
    expect(headline(el)).toBe('235'); // battery_range
    expect(range.getAttribute('aria-pressed')).toBe('true');
  });

  test('the charge-target line renders when charge_limit is present', async () => {
    const el = await mount(makeHass(baseStates()));
    const note = el.shadowRoot!.querySelector('.limit-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain(STRINGS.charging.target);
    expect(note!.textContent).toContain('80%');
  });

  test('the charge-target line is ABSENT when charge_limit is missing', async () => {
    const states = baseStates();
    states[ID.limit].state = 'unavailable';
    const el = await mount(makeHass(states));
    expect(el.shadowRoot!.querySelector('.limit-note')).toBeNull();
  });
});

// ── AC4 — canonical charge-state derivation (NOT a literal === 'Charging') ────
describe('AC4 — live cue derives from normalizeChargingState (canonical)', () => {
  test("a lowercase dialect spelling 'charging' lights the live cue (string compare would miss it)", async () => {
    const states = baseStates();
    states[ID.status].state = 'charging'; // a literal === 'Charging' would be FALSE here
    const el = await mount(makeHass(states));
    const cstatus = el.shadowRoot!.querySelector('.cstatus')!;
    expect(cstatus.classList.contains('live')).toBe(true);
  });

  test("a non-charging canonical state ('Disconnected') turns the live cue off", async () => {
    const states = baseStates();
    states[ID.status].state = 'Disconnected';
    const el = await mount(makeHass(states));
    expect(el.shadowRoot!.querySelector('.cstatus')!.classList.contains('live')).toBe(false);
  });

  test('a missing charging_status degrades to idle, never a false "Charging"', async () => {
    const states = baseStates();
    states[ID.status].state = 'unavailable';
    const el = await mount(makeHass(states));
    const cstatus = el.shadowRoot!.querySelector('.cstatus')!;
    expect(cstatus.classList.contains('live')).toBe(false);
    expect(cstatus.textContent).toContain(STRINGS.charging.idle);
  });
});

// ── Story 15.1 — tesla_custom boolean charging lights the live cue (AC1/AC2) ──
// The classifier now reads `adapterFor(hass, config).normalizeChargingState`; a
// config stamped `integration: 'tesla_custom'` (the exact post-stamp child shape)
// maps the boolean vocabulary. RED-FIRST (pre-conversion): the module-default
// normalizer reads 'on' → 'unknown' → cue OFF.
describe("Story 15.1 — tesla_custom boolean lights the live cue via the stamped dialect", () => {
  // Derived from the live alias table (research §5), slug-prefixed like a real
  // resolver output — no inlined id spelling that could drift from the table.
  const TC_CHARGING = ((): string => {
    const alias = DIALECT_ENTITY_ALIASES.tesla_custom?.charging_status ?? '';
    const dot = alias.indexOf('.');
    // Loud, never masked: a dropped/renamed table entry must fail HERE — the
    // `?? ''` fallback would otherwise build a malformed-but-self-consistent
    // `.mycar_` id this suite would still pass against.
    if (dot < 0) throw new Error("no tesla_custom alias for 'charging_status' — table drift");
    return `${alias.slice(0, dot)}.mycar_${alias.slice(dot + 1)}`;
  })(); // binary_sensor.mycar_charging

  const TC_CONFIG: Partial<TeslaCardConfig> = {
    integration: 'tesla_custom',
    entities: { charging_status: TC_CHARGING },
  };

  /** Fleet fixture states minus its charging STRING (tesla_custom exposes none —
   *  and leaving it would let an override-ignoring regression read the string's
   *  'Charging' and false-green this test), plus the boolean. */
  function tcStates(boolState: string): Record<string, HassEntity> {
    const states = baseStates();
    delete states[ID.status];
    states[TC_CHARGING] = {
      entity_id: TC_CHARGING,
      state: boolState,
      attributes: {},
    } as HassEntity;
    return states;
  }

  test("boolean 'on' → .cstatus.live + the bolt icon (AC1)", async () => {
    const el = await mount(makeHass(tcStates('on')), TC_CONFIG);
    const cstatus = el.shadowRoot!.querySelector('.cstatus')!;
    expect(cstatus.classList.contains('live')).toBe(true);
    expect(cstatus.querySelector('svg')).toBeTruthy(); // the lightning bolt renders
  });

  test("boolean 'off' → cue OFF (not charging; the panel makes no connected-state claim)", async () => {
    const el = await mount(makeHass(tcStates('off')), TC_CONFIG);
    expect(el.shadowRoot!.querySelector('.cstatus')!.classList.contains('live')).toBe(false);
  });

  test("boolean 'unavailable' → cue OFF + the idle display text (the isUnavailable branch)", async () => {
    const el = await mount(makeHass(tcStates('unavailable')), TC_CONFIG);
    const cstatus = el.shadowRoot!.querySelector('.cstatus')!;
    expect(cstatus.classList.contains('live')).toBe(false);
    expect(cstatus.textContent).toContain(STRINGS.charging.idle);
  });
});
