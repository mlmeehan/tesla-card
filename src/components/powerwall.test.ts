// @vitest-environment jsdom
//
// Element-level gate for the `tc-powerwall` card (Story 6.2). See solar.test.ts
// for the fixture/freshness method. Focus: AC4 — Powerwall flow direction read
// DIRECTLY from the RAW battery_power sign (− charging / + discharging), pinned
// both ways; plus the SoC ring, reserve/mode tiles, green accent, and AC1–AC3.
import { afterEach, describe, expect, test } from 'vitest';
import './powerwall';
import { accentVar } from './ecosystem-card';
import { resolveEnergyEntities } from '../data/energy';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import solarSurplusFx from '../fixtures/flow-solar-surplus.json';
import islandingFx from '../fixtures/flow-islanding.json';
import allUnresolvedFx from '../fixtures/all-unresolved.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

const CONFIG: TeslaCardConfig = { type: 'custom:tesla-card' };
/** 50 min after the fixtures' single stamp instant — past the 30-min asleep window. */
const ADVANCED_NOW = '2026-06-15T15:31:00Z';

type Card = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  setConfig(c: TeslaCardConfig): void;
  getCardSize(): number;
  updateComplete: Promise<boolean>;
};

function states(fx: { states: Record<string, HassEntity> }): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(fx.states)) as Record<string, HassEntity>;
}
function makeHass(s: Record<string, HassEntity>): HomeAssistant {
  return { states: s } as unknown as HomeAssistant;
}
/** Advance the HA time base so a fresh-stamped read back-dates into stale. */
function advanceNow(s: Record<string, HassEntity>): Record<string, HassEntity> {
  s[DEFAULT_ENTITIES.odometer].last_updated = ADVANCED_NOW;
  s[DEFAULT_ENTITIES.odometer].last_changed = ADVANCED_NOW;
  return s;
}
async function mount(hass: HomeAssistant | undefined, config: TeslaCardConfig = CONFIG): Promise<Card> {
  const el = document.createElement('tc-powerwall') as Card;
  if (hass) el.hass = hass;
  el.setConfig(config);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const sr = (el: Card) => el.shadowRoot!;
/** Direction labels rendered as statTile keys (precise — avoids substring traps). */
const statLabels = (el: Card) =>
  [...sr(el).querySelectorAll('.stat .k')].map((n) => (n.textContent ?? '').trim());

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC1 — resolves SoC + flow, renders the shell, green accent', () => {
  test('renders the SoC ring with the percentage and the green accent', async () => {
    const el = await mount(makeHass(states(awakeFx))); // powerwall_level = 44
    const style = sr(el).querySelector<HTMLElement>('.surface')!.getAttribute('style') ?? '';
    expect(style).toContain(accentVar('green'));
    const r = sr(el).querySelector('.tc-ring');
    expect(r).not.toBeNull();
    expect(r!.textContent).toContain('44');
  });

  test('surfaces backup_reserve and operation_mode tiles when present', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const labels = statLabels(el);
    expect(labels).toContain(STRINGS.energy.reserve);
    expect(labels).toContain(STRINGS.energy.mode);
  });
});

describe('AC4 — direction from the RAW battery sign (− charging / + discharging)', () => {
  test('a negative battery_power renders "Charging"', async () => {
    // flow-solar-surplus: battery_power = −3.0 (raw − = charging).
    const el = await mount(makeHass(states(solarSurplusFx)));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.powerwall.charging);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.powerwall.discharging);
    expect(sr(el).textContent ?? '').toContain('3.0');
  });

  test('a positive battery_power renders "Discharging"', async () => {
    // flow-islanding: battery_power = +2.0 (raw + = discharging).
    const el = await mount(makeHass(states(islandingFx)));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.powerwall.discharging);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.powerwall.charging);
    expect(sr(el).textContent ?? '').toContain('2.0');
  });

  test('a sub-deadband battery_power renders the idle label, not a false direction', async () => {
    const s = states(islandingFx);
    const id = resolveEnergyEntities(makeHass(s), CONFIG).battery_power!;
    s[id].state = '0.02'; // below the 0.05 kW deadband → idle
    const el = await mount(makeHass(s));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.powerwall.idle);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.powerwall.charging);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.powerwall.discharging);
  });
});

describe('AC2 — graceful degradation', () => {
  test('neither SoC nor flow resolves → calm empty sentence, no throw', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.eco-empty')!.textContent).toContain(
      STRINGS.ecosystem.powerwall.empty
    );
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('stale Powerwall → last-known SoC kept AND a .tc-stale-copy "updated …" stamp', async () => {
    // Pins the card's bespoke stamp-selection (powerwall_level ?? battery_power):
    // back-date the time base so the SoC read goes stale → last-known % retained
    // plus an honest stamp, never overstated as fresh.
    const el = await mount(makeHass(advanceNow(states(awakeFx))));
    expect(sr(el).querySelector('.tc-ring')!.textContent).toContain('44'); // last-known SoC retained
    const stamp = sr(el).querySelector('.eco-stamp');
    expect(stamp).not.toBeNull();
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('AC3 — standalone registered element', () => {
  test('tc-powerwall is defined; getCardSize is a number; customCards entry present', async () => {
    expect(customElements.get('tc-powerwall')).toBeDefined();
    const el = await mount(makeHass(states(awakeFx)));
    expect(typeof el.getCardSize()).toBe('number');
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', unknown_future_key: 1 } as TeslaCardConfig)
    ).not.toThrow();
    expect((window.customCards ?? []).find((c) => c.type === 'tc-powerwall')).toBeTruthy();
  });
});
