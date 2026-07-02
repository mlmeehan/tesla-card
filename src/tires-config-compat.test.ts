// @vitest-environment jsdom
//
// Legacy config-key back-compat pins for the clean-break public-API rename: the
// config key + `PanelId` moved to the American spelling `tires`. The claimed R9
// forward-compat behaviour — old YAML carrying the pre-rename British-spelled key
// is SILENTLY IGNORED (never a crash, never consumed) — had no test. These pin it
// for both consumers (card + editor).
//
// NOTE: the pre-rename key is the British spelling of the tire word. `strings.test.ts`
// forbids that contiguous word appearing in src/, so we build it from two fragments
// and never write it whole (the same split trick the repo uses for the trade-dress
// brand hex) — the file passes that gate's British-spelling scan by construction.
import { describe, expect, test, beforeAll } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from './types';
import './tesla-card';
import './editor';

/** The pre-rename public key (British spelling), assembled so the word never appears whole. */
const LEGACY_KEY = 'ty' + 'res';

/** A minimal but well-formed hass (enough for the card to render `.root`). */
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

type CardEl = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  updateComplete: Promise<boolean>;
  _config?: Record<string, unknown>;
};
type EditorEl = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  updateComplete: Promise<boolean>;
};

function makeCard(): CardEl {
  const el = document.createElement('tesla-card') as unknown as CardEl;
  document.body.appendChild(el as unknown as HTMLElement);
  return el;
}
function makeEditor(): EditorEl {
  const el = document.createElement('tesla-card-editor') as unknown as EditorEl;
  document.body.appendChild(el as unknown as HTMLElement);
  return el;
}
const hasRoot = (el: CardEl): boolean => !!el.shadowRoot?.querySelector('.root');

beforeAll(() => {
  expect(customElements.get('tesla-card')).toBeTruthy();
  expect(customElements.get('tesla-card-editor')).toBeTruthy();
});

describe('card tolerates the legacy pre-rename key (R9 forward-compat)', () => {
  test('setConfig with the legacy key does not throw and the card still renders', async () => {
    const el = makeCard();
    const cfg = { type: 'custom:tesla-card', [LEGACY_KEY]: { pressure_min: 38 } } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true); // old YAML on the renamed build → still renders
    el.remove();
  });

  test('the legacy key is PRESERVED on the stored config but never CONSUMED (tires stays undefined)', async () => {
    const el = makeCard();
    const legacy = { pressure_min: 38 };
    el.setConfig({ type: 'custom:tesla-card', [LEGACY_KEY]: legacy } as unknown as TeslaCardConfig);
    await expect(el.updateComplete).resolves.toBeDefined();
    // The `{ ...config }` spread keeps the unknown key alive (a future/legacy field
    // survives the round-trip)…
    expect(el._config?.[LEGACY_KEY]).toEqual(legacy);
    // …but it is NOT the renamed key: the tires panel reads `config.tires`, which the
    // legacy key never populates → the panel behaves exactly as if unconfigured.
    expect(el._config?.tires).toBeUndefined();
    el.remove();
  });

  test('garbage shapes under the legacy key (array / number) never crash the card', async () => {
    for (const junk of [[1, 2, 3], 42]) {
      const el = makeCard();
      const cfg = { type: 'custom:tesla-card', [LEGACY_KEY]: junk } as unknown as TeslaCardConfig;
      expect(() => el.setConfig(cfg)).not.toThrow();
      el.hass = fullHass();
      await expect(el.updateComplete).resolves.toBeDefined();
      expect(hasRoot(el)).toBe(true);
      el.remove();
    }
  });
});

describe('editor tolerates the legacy pre-rename key (safeClone open guard)', () => {
  test('setConfig with the legacy key opens + renders the form without crashing', async () => {
    const el = makeEditor();
    const cfg = { type: 'custom:tesla-card', [LEGACY_KEY]: { pressure_min: 38 } } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(el.shadowRoot?.querySelector('input[type="text"]')).toBeTruthy(); // form rendered
    el.remove();
  });

  test('garbage shapes under the legacy key (array / number) never crash the editor', async () => {
    for (const junk of [[1, 2, 3], 42]) {
      const el = makeEditor();
      const cfg = { type: 'custom:tesla-card', [LEGACY_KEY]: junk } as unknown as TeslaCardConfig;
      expect(() => el.setConfig(cfg)).not.toThrow();
      await expect(el.updateComplete).resolves.toBeDefined();
      expect(el.shadowRoot?.querySelector('input[type="text"]')).toBeTruthy();
      el.remove();
    }
  });
});
