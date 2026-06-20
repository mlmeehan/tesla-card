// @vitest-environment jsdom
//
// Element-level gate for the `tc-home` card (Story 6.2). See solar.test.ts for
// the fixture/freshness method; this pins the home-specific ACs:
//   AC1 — resolves load_power, renders the shell with the blue accent + value.
//   AC2 — absent → calm empty; stale → last-known + "updated …" stamp.
//   AC3 — registered standalone element + LovelaceCard + customCards entry.
import { afterEach, describe, expect, test } from 'vitest';
import './home';
import { accentVar } from './ecosystem-card';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import allUnresolvedFx from '../fixtures/all-unresolved.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

const CONFIG: TeslaCardConfig = { type: 'custom:tesla-card' };
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
function advanceNow(s: Record<string, HassEntity>): Record<string, HassEntity> {
  s[DEFAULT_ENTITIES.odometer].last_updated = ADVANCED_NOW;
  s[DEFAULT_ENTITIES.odometer].last_changed = ADVANCED_NOW;
  return s;
}
async function mount(hass: HomeAssistant | undefined, config: TeslaCardConfig = CONFIG): Promise<Card> {
  const el = document.createElement('tc-home') as Card;
  if (hass) el.hass = hass;
  el.setConfig(config);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const sr = (el: Card) => el.shadowRoot!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC1 — resolves load_power, renders the shell + value, blue accent', () => {
  test('renders the .surface shell with the home consumption value', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(sr(el).querySelector('.surface')).not.toBeNull();
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('1.0'); // load_power = 1.0
  });

  test('the source-node accent is blue (mirrors the Scene NODE_COLOR.home)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const style = sr(el).querySelector<HTMLElement>('.surface')!.getAttribute('style') ?? '';
    expect(style).toContain(accentVar('blue'));
  });
});

describe('AC2 — graceful degradation', () => {
  test('absent load_power → calm empty sentence, no .stat, no NaN', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.stat')).toBeNull();
    expect(sr(el).querySelector('.eco-empty')!.textContent).toContain(STRINGS.ecosystem.home.empty);
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('stale load_power → last-known value + a .tc-stale-copy stamp', async () => {
    const el = await mount(makeHass(advanceNow(states(awakeFx))));
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('1.0');
    const stamp = sr(el).querySelector('.eco-stamp');
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('Story 8.1 — detail layout: lead-only (honest minimal), deep-link, sensor honesty', () => {
  test('AC2 — Home has no clean energy-today entity, so the stat grid is omitted (lead-only)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    // The lead consumption readout renders; no stat-grid region is forced empty.
    expect(sr(el).querySelector('.eco-readout .stat')).not.toBeNull();
    expect(sr(el).querySelector('.eco-grid')).toBeNull();
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('AC1/AC4 — deep-link present on live, absent on calm empty', async () => {
    const live = await mount(makeHass(states(awakeFx)));
    expect(sr(live).querySelector('.eco-deeplink')).not.toBeNull();
    const empty = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(empty).querySelector('.eco-deeplink')).toBeNull();
  });

  test('AC3 — Home is a Sensor: NO write control', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(sr(el).querySelector('input, select, tc-slider, [role="switch"], [role="slider"]')).toBeNull();
  });
});

describe('Story 8.2 — per-node hero art (live path only)', () => {
  test('the live detail render shows the house hero SVG in the .eco-hero slot', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(sr(el).querySelector('.eco-hero svg.nh-art')).not.toBeNull();
    expect(sr(el).querySelector('.eco-hero .nh-roof')).not.toBeNull(); // the house signature
  });

  test('the calm-empty render has NO hero (additive to the live path only, AC4)', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.eco-empty')).not.toBeNull();
    expect(sr(el).querySelector('svg.nh-art')).toBeNull();
  });
});

describe('AC3 — standalone registered element', () => {
  test('tc-home is defined; getCardSize is a number; customCards entry present', async () => {
    expect(customElements.get('tc-home')).toBeDefined();
    const el = await mount(makeHass(states(awakeFx)));
    expect(typeof el.getCardSize()).toBe('number');
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', unknown_future_key: 1 } as TeslaCardConfig)
    ).not.toThrow();
    const entry = (window.customCards ?? []).find((c) => c.type === 'tc-home');
    expect(entry).toBeTruthy();
  });
});
