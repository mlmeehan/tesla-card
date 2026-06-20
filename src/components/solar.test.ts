// @vitest-environment jsdom
//
// Element-level gate for the `tc-solar` card (Story 6.2). Drives the registered
// element with fixture `hass` objects and pins the story ACs as regressions:
//   AC1 — resolves solar_power by function-name (real data/ resolution), renders
//         the .surface shell with the amber source-node accent + the value.
//   AC2 — absent → calm empty sentence (no throw / no fabricated 0); stale → the
//         last-known value PLUS a .tc-stale-copy "updated …" stamp.
//   AC3 — registered standalone custom element + LovelaceCard contract +
//         window.customCards entry; setConfig tolerates an unknown key.
// Plus the cross-card interlink contract (shared hass only — FR-32): two
// instances agree and emit no peer-directed CustomEvent.
//
// Freshness is deterministic by injection (mirrors ecosystem-card.test.ts):
// every fixture entity shares one stamp instant, so back-dating the read (by
// advancing ANOTHER entity's last_updated → referenceNow = max stamp) forces a
// stale classification. Energy ids are never inlined — they come from real
// resolveEnergyEntities resolution over the fixture corpus.
import { afterEach, describe, expect, test } from 'vitest';
import './solar';
import './home';
import { accentVar } from './ecosystem-card';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
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
async function mount(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig = CONFIG,
  tag = 'tc-solar'
): Promise<Card> {
  const el = document.createElement(tag) as Card;
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

describe('AC1 — resolves by function-name, renders the shell + value, amber accent', () => {
  test('mounts with an energy fixture → renders the .surface shell with the solar value', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const surface = sr(el).querySelector<HTMLElement>('.surface');
    expect(surface).not.toBeNull();
    expect(surface!.classList.contains('eco-card')).toBe(true);
    // solar_power resolves to my_home_solar_power_2 = 6.0 → "6.0 kW" rendered.
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('6.0');
  });

  test('the source-node accent is amber (mirrors the Scene NODE_COLOR.solar)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const style = sr(el).querySelector<HTMLElement>('.surface')!.getAttribute('style') ?? '';
    expect(style).toContain('--node-accent');
    expect(style).toContain(accentVar('amber'));
  });
});

describe('AC2 — graceful degradation: calm empty on absent, last-known + stamp on stale', () => {
  test('absent solar → calm empty sentence, no .stat, no NaN, no throw', async () => {
    // all-unresolved fixture has no energy sensors → solar_power unresolved.
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.surface')).not.toBeNull();
    expect(sr(el).querySelector('.stat')).toBeNull();
    expect(sr(el).querySelector('.eco-empty')!.textContent).toContain(
      STRINGS.ecosystem.solar.empty
    );
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('stale solar → last-known value kept AND a .tc-stale-copy "updated …" stamp', async () => {
    const s = advanceNow(states(awakeFx));
    const el = await mount(makeHass(s));
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('6.0'); // last-known retained
    const stamp = sr(el).querySelector('.eco-stamp');
    expect(stamp).not.toBeNull();
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('AC3 — standalone registered custom element + LovelaceCard contract', () => {
  test('tc-solar is a defined custom element', () => {
    expect(customElements.get('tc-solar')).toBeDefined();
  });

  test('setConfig accepts a minimal config and tolerates an unknown key; getCardSize is a number', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', unknown_future_key: 1 } as TeslaCardConfig)
    ).not.toThrow();
    expect(typeof el.getCardSize()).toBe('number');
  });

  test('setConfig throws only on a falsy config', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(() => el.setConfig(undefined as unknown as TeslaCardConfig)).toThrow();
  });

  test('window.customCards contains the tc-solar picker entry', () => {
    const entry = (window.customCards ?? []).find((c) => c.type === 'tc-solar');
    expect(entry).toBeTruthy();
    expect(entry!.name).toBe(STRINGS.energy.nodes.solar);
  });
});

describe('cross-card interlink — shared hass only (FR-32)', () => {
  test('two cards sharing one hass agree on state', async () => {
    const hass = makeHass(states(awakeFx));
    const a = await mount(hass, CONFIG, 'tc-solar');
    const b = await mount(hass, CONFIG, 'tc-home');
    // Both resolve independently from the same shared hass — solar vs home values
    // both present and non-empty (coherence is the shared hass, not a message).
    expect(a.shadowRoot!.querySelector('.stat .v')!.textContent).toContain('6.0'); // solar
    expect(b.shadowRoot!.querySelector('.stat .v')!.textContent).toContain('1.0'); // home load
  });

  test('neither card emits a peer-directed CustomEvent during render', async () => {
    const dispatched: Event[] = [];
    const orig = HTMLElement.prototype.dispatchEvent;
    HTMLElement.prototype.dispatchEvent = function (this: HTMLElement, ev: Event): boolean {
      dispatched.push(ev);
      return orig.call(this, ev);
    };
    try {
      const hass = makeHass(states(awakeFx));
      await mount(hass, CONFIG, 'tc-solar');
      await mount(hass, CONFIG, 'tc-home');
    } finally {
      HTMLElement.prototype.dispatchEvent = orig;
    }
    expect(dispatched.filter((e) => e instanceof CustomEvent)).toEqual([]);
  });
});
