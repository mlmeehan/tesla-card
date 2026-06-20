// @vitest-environment jsdom
//
// Element-level gate for the `tc-powerwall` card (Story 6.2). See solar.test.ts
// for the fixture/freshness method. Focus: AC4 — Powerwall flow direction read
// DIRECTLY from the RAW battery_power sign (− charging / + discharging), pinned
// both ways; plus the SoC ring, reserve/mode tiles, green accent, and AC1–AC3.
import { afterEach, describe, expect, test, vi } from 'vitest';
import './powerwall';
import { accentVar } from './ecosystem-card';
import { resolveEnergyEntities } from '../data/energy';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import solarSurplusFx from '../fixtures/flow-solar-surplus.json';
import islandingFx from '../fixtures/flow-islanding.json';
import allUnresolvedFx from '../fixtures/all-unresolved.json';
import detailFx from '../fixtures/energy-detail.json';
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

describe('Story 8.1 — detail layout: charge/discharge tiles, read-only, deep-link', () => {
  test('AC2 — present charge/discharge energy totals render', async () => {
    const el = await mount(makeHass(states(detailFx)));
    const txt = sr(el).textContent ?? '';
    expect(txt).toContain(STRINGS.ecosystem.powerwall.charged);
    expect(txt).toContain('5.7'); // battery_charged value (kWh)
    expect(txt).toContain(STRINGS.ecosystem.powerwall.discharged);
  });

  test('AC2 — absent totals hide; reserve + mode (today) still render read-only', async () => {
    const el = await mount(makeHass(states(awakeFx))); // has reserve+mode, no charged/discharged
    const txt = sr(el).textContent ?? '';
    expect(txt).toContain(STRINGS.energy.reserve);
    expect(txt).toContain(STRINGS.energy.mode);
    expect(txt).not.toContain(STRINGS.ecosystem.powerwall.charged);
    expect(txt).not.toContain('NaN');
  });

  test('AC3 — Powerwall stays a Sensor this story (controls are 8.4): NO write control', async () => {
    // reserve/mode are read-only statTiles — NOT a number/select input or slider.
    const el = await mount(makeHass(states(detailFx)));
    expect(sr(el).querySelector('input, select, tc-slider, [role="switch"], [role="slider"]')).toBeNull();
    expect(sr(el).querySelector('.eco-kind')!.textContent).toContain(STRINGS.ecosystem.sensorTag);
  });

  test('AC1/AC4 — deep-link present on live, absent on calm empty', async () => {
    const live = await mount(makeHass(states(detailFx)));
    expect(sr(live).querySelector('.eco-deeplink')).not.toBeNull();
    const empty = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(empty).querySelector('.eco-deeplink')).toBeNull();
  });
});

describe('Story 8.2 — per-node hero art (live path only)', () => {
  test('the live detail render shows the node hero SVG in the .eco-hero slot', async () => {
    const el = await mount(makeHass(states(detailFx)));
    expect(sr(el).querySelector('.eco-hero svg.nh-art')).not.toBeNull();
    expect(sr(el).querySelector('.eco-hero .nh-pw-fill')).not.toBeNull(); // the battery-stack signature
  });

  test('the calm-empty render has NO hero (additive to the live path only, AC4)', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.eco-empty')).not.toBeNull();
    expect(sr(el).querySelector('svg.nh-art')).toBeNull();
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

// ── Story 8.3 — inline history charts (today powerwall_level + 7-day battery_charged) ──
function fixtureNowMs(s: Record<string, HassEntity>): number {
  let max = -Infinity;
  for (const e of Object.values(s)) {
    for (const ts of [e.last_updated, e.last_changed]) {
      const ms = ts ? Date.parse(ts) : NaN;
      if (Number.isFinite(ms) && ms > max) max = ms;
    }
  }
  return max;
}
const SAMPLE_HISTORY = (id: string, nowMs: number) => {
  const day = 86_400_000;
  return {
    [id]: [
      { s: '40', lu: (nowMs - day - 3_600_000) / 1000 },
      { s: '52', lu: (nowMs - day - 1000) / 1000 },
      { s: '60', lu: (nowMs - 3_600_000) / 1000 },
      { s: '66', lu: (nowMs - 1000) / 1000 },
    ],
  };
};
function makeHassWS(
  s: Record<string, HassEntity>,
  callWS = vi.fn().mockImplementation((msg: { entity_ids: string[] }) =>
    Promise.resolve(SAMPLE_HISTORY(msg.entity_ids[0], fixtureNowMs(s)))
  )
): HomeAssistant {
  return { states: s, callWS } as unknown as HomeAssistant;
}
async function settle(el: Card): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

describe('Story 8.3 — inline history charts', () => {
  test('AC1/AC3 — SoC sparkline + 7-day charged-kWh bars render when ids resolve', async () => {
    const el = await mount(makeHassWS(states(detailFx)));
    await settle(el);
    expect(sr(el).querySelector('.eco-charts svg.spark')).not.toBeNull();
    expect(sr(el).querySelectorAll('.bcol').length).toBeGreaterThan(0);
  });

  test('AC2/AC5 — empty recorder → calm empty chart, never a fabricated curve', async () => {
    const el = await mount(makeHassWS(states(detailFx), vi.fn().mockResolvedValue({})));
    await settle(el);
    expect(sr(el).querySelector('.eco-charts .ct-empty')).not.toBeNull();
    expect(sr(el).querySelector('svg.spark')).toBeNull();
  });

  test('AC5 — NO chart on the calm-empty path (unresolved fixture)', async () => {
    const el = await mount(makeHassWS(states(allUnresolvedFx)));
    await settle(el);
    expect(sr(el).querySelector('.eco-charts')).toBeNull();
  });

  test('AC3 — no re-fetch on an unrelated hass tick', async () => {
    const s = states(detailFx);
    const callWS = vi.fn().mockImplementation((msg: { entity_ids: string[] }) =>
      Promise.resolve(SAMPLE_HISTORY(msg.entity_ids[0], fixtureNowMs(s)))
    );
    const el = await mount(makeHassWS(s, callWS));
    await settle(el);
    const n = callWS.mock.calls.length;
    el.hass = makeHassWS(states(detailFx), callWS);
    await settle(el);
    expect(callWS.mock.calls.length).toBe(n);
  });
});
