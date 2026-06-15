// @vitest-environment jsdom
//
// Lifecycle-safety element test (Story 1.6, AC2 — the AR-15 spine).
//
// The ONLY element-level Vitest in the suite (opt-in jsdom per vite.config — no new
// deps; jsdom already installed). It locks the three AR-15 guarantees as regression
// tests rather than prose:
//   1. First render is safe with hass and/or config absent, in EITHER arrival order
//      (hass-then-config, config-then-hass, neither) — render() returns nothing
//      until both exist and never throws.
//   2. Resolution runs only in willUpdate, never render() — asserted structurally
//      (render() with a config but a throwing resolver path is never reached because
//      resolution already happened in willUpdate; here we prove the observable
//      contract: no throw + nothing-until-both).
//   3. The editor preview's PARTIAL hass (states present, registries absent; or a
//      sparse/empty states map) renders without throwing.
//
// Hermetic: no network, no committed-fixture coupling — synthetic minimal states.
import { describe, expect, test, beforeAll } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from './types';
import './tesla-card';

const CONFIG: TeslaCardConfig = { type: 'custom:tesla-card', name: 'Model Y' };

/** A minimal but well-formed hass (full registry present). */
function fullHass(): HomeAssistant {
  return {
    states: {
      'sensor.garage_model_y_battery_level': {
        entity_id: 'sensor.garage_model_y_battery_level',
        state: '72',
        attributes: { unit_of_measurement: '%' },
        last_updated: '2026-06-15T14:41:00Z',
        last_changed: '2026-06-15T14:41:00Z',
      },
    },
    entities: {},
    devices: {},
    locale: { language: 'en' },
    callService: () => Promise.resolve(),
  } as unknown as HomeAssistant;
}

/** A partial hass: registries absent (the editor-preview / minimal-install shape). */
function partialHassNoRegistry(): HomeAssistant {
  const h = fullHass();
  delete (h as Record<string, unknown>).entities;
  delete (h as Record<string, unknown>).devices;
  return h;
}

/** A partial hass: empty states map (cold first paint). */
function partialHassEmptyStates(): HomeAssistant {
  return { states: {}, callService: () => Promise.resolve() } as unknown as HomeAssistant;
}

type CardEl = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  updateComplete: Promise<boolean>;
};

function makeCard(): CardEl {
  const el = document.createElement('tesla-card') as CardEl;
  document.body.appendChild(el);
  return el;
}

const hasRoot = (el: CardEl): boolean => !!el.shadowRoot?.querySelector('.root');

beforeAll(() => {
  // The custom element must have upgraded from the side-effect import.
  expect(customElements.get('tesla-card')).toBeTruthy();
});

describe('AC2 — first render safe in either arrival order', () => {
  test('neither hass nor config: render() returns nothing, no throw', async () => {
    const el = makeCard();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(false);
    el.remove();
  });

  test('hass-then-config: nothing until both present, then renders, no throw', async () => {
    const el = makeCard();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(false); // config still absent → nothing

    el.setConfig(CONFIG);
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true); // both present → renders
    el.remove();
  });

  test('config-then-hass: nothing until both present, then renders, no throw', async () => {
    const el = makeCard();
    el.setConfig(CONFIG);
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(false); // hass still absent → nothing

    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true); // both present → renders
    el.remove();
  });
});

describe('AC2 — editor preview tolerates a partial hass (AR-15)', () => {
  test('registries absent (entities/devices undefined): renders, no throw', async () => {
    const el = makeCard();
    el.setConfig(CONFIG);
    el.hass = partialHassNoRegistry();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true);
    el.remove();
  });

  test('empty states map (cold first paint): renders, no throw', async () => {
    const el = makeCard();
    el.setConfig(CONFIG);
    el.hass = partialHassEmptyStates();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true);
    el.remove();
  });

  test('a re-pushed partial hass after a full one does not throw (live preview edits)', async () => {
    const el = makeCard();
    el.setConfig(CONFIG);
    el.hass = fullHass();
    await el.updateComplete;
    el.hass = partialHassNoRegistry();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true);
    el.remove();
  });
});
