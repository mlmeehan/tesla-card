// @vitest-environment jsdom
//
// Element-level gate for the `tc-grid` card (Story 6.2). See solar.test.ts for
// the fixture/freshness method. Focus: AC4 — direction read DIRECTLY from the
// RAW sensor sign (+ import / − export), pinned both ways so a flipped convention
// fails here; plus the neutral accent, the grid_status chip, and AC1–AC3.
import { afterEach, describe, expect, test } from 'vitest';
import './grid';
import { accentVar } from './ecosystem-card';
import { resolveEnergyEntities } from '../data/energy';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import gridImportFx from '../fixtures/flow-grid-import.json';
import gridExportFx from '../fixtures/flow-grid-export.json';
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
  const el = document.createElement('tc-grid') as Card;
  if (hass) el.hass = hass;
  el.setConfig(config);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const sr = (el: Card) => el.shadowRoot!;
const bodyText = (el: Card) => sr(el).textContent ?? '';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC1 — resolves grid_power, renders the shell, neutral accent', () => {
  test('renders the .surface shell with the neutral source-node accent', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const style = sr(el).querySelector<HTMLElement>('.surface')!.getAttribute('style') ?? '';
    expect(sr(el).querySelector('.surface')).not.toBeNull();
    // Grid is the deliberate neutral node (option A) → var(--tc-text-dim, …).
    expect(style).toContain(accentVar('neutral'));
  });
});

describe('AC4 — direction from the RAW sign (+ import / − export), pinned both ways', () => {
  test('a positive grid_power renders "Importing"', async () => {
    // flow-grid-import: grid_power = +2.0 (raw + = import).
    const el = await mount(makeHass(states(gridImportFx)));
    expect(bodyText(el)).toContain(STRINGS.ecosystem.grid.importing);
    expect(bodyText(el)).not.toContain(STRINGS.ecosystem.grid.exporting);
    expect(bodyText(el)).toContain('2.0'); // magnitude shown (always |kW|)
  });

  test('a negative grid_power renders "Exporting"', async () => {
    // flow-grid-export: grid_power = −3.0 (raw − = export).
    const el = await mount(makeHass(states(gridExportFx)));
    expect(bodyText(el)).toContain(STRINGS.ecosystem.grid.exporting);
    expect(bodyText(el)).not.toContain(STRINGS.ecosystem.grid.importing);
    expect(bodyText(el)).toContain('3.0');
  });

  test('a sub-deadband grid_power renders the idle label, not a false direction', async () => {
    const s = states(gridImportFx);
    const id = resolveEnergyEntities(makeHass(s), CONFIG).grid_power!;
    s[id].state = '0.02'; // below the 0.05 kW deadband → idle
    const el = await mount(makeHass(s));
    expect(bodyText(el)).toContain(STRINGS.ecosystem.grid.idle);
    expect(bodyText(el)).not.toContain(STRINGS.ecosystem.grid.importing);
    expect(bodyText(el)).not.toContain(STRINGS.ecosystem.grid.exporting);
  });
});

describe('grid_status chip', () => {
  test('on_grid renders an ok chip', async () => {
    const el = await mount(makeHass(states(awakeFx))); // grid_status = on_grid
    const chip = sr(el).querySelector('.gchip');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('ok')).toBe(true);
  });

  test('off_grid renders a warn chip', async () => {
    const el = await mount(makeHass(states(islandingFx))); // grid_status = off_grid
    const chip = sr(el).querySelector('.gchip');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('warn')).toBe(true);
  });
});

describe('AC2 — graceful degradation', () => {
  test('absent grid power AND status → calm empty sentence, no throw', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.eco-empty')!.textContent).toContain(STRINGS.ecosystem.grid.empty);
    expect(bodyText(el)).not.toContain('NaN');
  });

  test('stale grid → last-known power kept AND a .tc-stale-copy "updated …" stamp', async () => {
    // Pins the card's grid_power-based stamp: back-date the time base so the
    // grid_power read goes stale → last-known kW retained plus an honest stamp.
    const el = await mount(makeHass(advanceNow(states(awakeFx))));
    expect(bodyText(el)).toContain('0.9'); // last-known grid_power magnitude retained
    const stamp = sr(el).querySelector('.eco-stamp');
    expect(stamp).not.toBeNull();
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('Story 8.1 — detail layout: stat grid, deep-link, sensor honesty', () => {
  test('AC2 — present grid energy totals render (Imported / Exported)', async () => {
    const el = await mount(makeHass(states(detailFx)));
    const txt = bodyText(el);
    expect(txt).toContain(STRINGS.ecosystem.grid.imported);
    expect(txt).toContain('25.6'); // grid_imported value (kWh)
    expect(txt).toContain(STRINGS.ecosystem.grid.exported);
  });

  test('AC2 — absent totals hide their tiles; the lead direction still renders', async () => {
    const el = await mount(makeHass(states(awakeFx))); // no grid_imported/_exported
    expect(bodyText(el)).not.toContain(STRINGS.ecosystem.grid.imported);
    expect(bodyText(el)).not.toContain('NaN');
    expect(sr(el).querySelector('.stat')).not.toBeNull();
  });

  test('AC1/AC4 — deep-link present on live, absent on calm empty', async () => {
    const live = await mount(makeHass(states(detailFx)));
    expect(sr(live).querySelector('.eco-deeplink')).not.toBeNull();
    const empty = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(empty).querySelector('.eco-deeplink')).toBeNull();
  });

  test('AC3 — Grid is a Sensor: NO write control', async () => {
    const el = await mount(makeHass(states(detailFx)));
    expect(sr(el).querySelector('input, select, tc-slider, [role="switch"], [role="slider"]')).toBeNull();
  });
});

describe('Story 8.2 — per-node hero art (live path only)', () => {
  test('the live detail render shows the pylon hero SVG in the .eco-hero slot', async () => {
    const el = await mount(makeHass(states(detailFx)));
    expect(sr(el).querySelector('.eco-hero svg.nh-art')).not.toBeNull();
    expect(sr(el).querySelector('.eco-hero .nh-strut')).not.toBeNull(); // the pylon signature
  });

  test('the calm-empty render has NO hero (additive to the live path only, AC4)', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.eco-empty')).not.toBeNull();
    expect(sr(el).querySelector('svg.nh-art')).toBeNull();
  });
});

describe('AC3 — standalone registered element', () => {
  test('tc-grid is defined; getCardSize is a number; customCards entry present', async () => {
    expect(customElements.get('tc-grid')).toBeDefined();
    const el = await mount(makeHass(states(awakeFx)));
    expect(typeof el.getCardSize()).toBe('number');
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', unknown_future_key: 1 } as TeslaCardConfig)
    ).not.toThrow();
    expect((window.customCards ?? []).find((c) => c.type === 'tc-grid')).toBeTruthy();
  });
});
