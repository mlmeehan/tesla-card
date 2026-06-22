// @vitest-environment jsdom
//
// Element-level gate for the `tc-generator` card (Story 9.14 — the first NEW node
// TYPE). Mirrors home.test.ts/grid.test.ts (the simple single-reading cards). Pins:
//   AC2/AC3 — resolves generator_power, renders the shell + value, copper accent.
//   AC5/AC8 — absent → calm empty; stale → last-known + "updated …" stamp; no NaN.
//   AC3     — registered standalone element + LovelaceCard + customCards entry.
import { afterEach, describe, expect, test } from 'vitest';
import './generator';
import { accentVar } from './ecosystem-card';
import { STRINGS } from '../strings';
import generatorFx from '../fixtures/energy-generator.json';
import allUnresolvedFx from '../fixtures/all-unresolved.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

const CONFIG: TeslaCardConfig = { type: 'custom:tesla-card' };
const OLD = '2026-06-15T13:00:00Z'; // ~100 min back → stale against the fresher anchor

function states(fx: { states: Record<string, HassEntity> }): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(fx.states)) as Record<string, HassEntity>;
}
function makeHass(s: Record<string, HassEntity>): HomeAssistant {
  return { states: s } as unknown as HomeAssistant;
}
/** The generator output entity in a fixture state map (id resolved dynamically — no
 *  literal entity id in this component test, per the [card] hard-coded-id guard). */
function generatorEntity(s: Record<string, HassEntity>): HassEntity {
  const id = Object.keys(s).find((k) => k.includes('generator_power') && !k.includes('load'))!;
  return s[id];
}
/** Mutate the (round-tripped) generator reading's value — for the idle vs running probe. */
function withGeneratorValue(s: Record<string, HassEntity>, value: string): Record<string, HassEntity> {
  generatorEntity(s).state = value;
  return s;
}
/** Back-date the generator stamp so the fresher solar anchor makes it read stale. */
function staleGenerator(s: Record<string, HassEntity>): Record<string, HassEntity> {
  const g = generatorEntity(s);
  g.last_changed = OLD;
  g.last_updated = OLD;
  return s;
}

type Card = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  setConfig(c: TeslaCardConfig): void;
  getCardSize(): number;
  updateComplete: Promise<boolean>;
};

async function mount(hass: HomeAssistant | undefined, config: TeslaCardConfig = CONFIG): Promise<Card> {
  const el = document.createElement('tc-generator') as Card;
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

describe('AC2/AC3 — resolves generator_power, renders the shell + value, copper accent', () => {
  test('renders the .surface shell with the generator output value (not the *_load decoy)', async () => {
    const el = await mount(makeHass(states(generatorFx)));
    expect(sr(el).querySelector('.surface')).not.toBeNull();
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('3.4'); // generator_power = 3.4
  });

  test('the source-node accent is copper (the Scene NODE_COLOR.generator, the 8th accent)', async () => {
    const el = await mount(makeHass(states(generatorFx)));
    const style = sr(el).querySelector<HTMLElement>('.surface')!.getAttribute('style') ?? '';
    expect(style).toContain(accentVar('copper'));
  });

  test('a live (above-deadband) reading reads "Running"; a quiet one reads "Idle"', async () => {
    const live = await mount(makeHass(states(generatorFx)));
    expect(sr(live).textContent).toContain(STRINGS.ecosystem.generator.running);
    const idle = await mount(makeHass(withGeneratorValue(states(generatorFx), '0.0')));
    expect(sr(idle).textContent).toContain(STRINGS.ecosystem.generator.idle);
  });
});

describe('AC5/AC8 — graceful degradation (no fabricated reading, honest staleness)', () => {
  test('absent generator_power → calm empty sentence, no .stat, no NaN', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.stat')).toBeNull();
    expect(sr(el).querySelector('.eco-empty')!.textContent).toContain(
      STRINGS.ecosystem.generator.empty
    );
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('stale generator_power → last-known value + a .tc-stale-copy stamp', async () => {
    const el = await mount(makeHass(staleGenerator(states(generatorFx))));
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('3.4');
    const stamp = sr(el).querySelector('.eco-stamp');
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('AC3 — standalone registered element', () => {
  test('tc-generator is defined; getCardSize is a number; customCards entry present', async () => {
    expect(customElements.get('tc-generator')).toBeDefined();
    const el = await mount(makeHass(states(generatorFx)));
    expect(typeof el.getCardSize()).toBe('number');
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', unknown_future_key: 1 } as TeslaCardConfig)
    ).not.toThrow();
    const entry = (window.customCards ?? []).find((c) => c.type === 'tc-generator');
    expect(entry).toBeTruthy();
  });

  test('it is a Sensor (read-only): NO write control rendered', async () => {
    const el = await mount(makeHass(states(generatorFx)));
    expect(
      sr(el).querySelector('input, select, tc-slider, [role="switch"], [role="slider"]')
    ).toBeNull();
  });
});
