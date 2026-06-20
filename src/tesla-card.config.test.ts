// @vitest-environment jsdom
//
// Forward-compatibility contract tests (Story 7.1, AC3 — FR-29 setConfig / R9).
//
// `TeslaCardConfig` is the single PUBLIC, forward-compatible schema. `setConfig`
// (card AND editor) must TOLERATE unknown/future keys — preserve them, validate
// only what it consumes, and NEVER throw on extras — so that:
//   • a NEWER YAML carrying a key this build doesn't know still RENDERS on an
//     older build, and OLD YAML never breaks on a newer build;
//   • the one sanctioned validation (falsy config → throw) stays intact so a
//     future refactor can't silently swallow it.
// The spread (`{ ...config }`) already delivers this; this corpus GUARANTEES a
// future refactor can't regress it. Hermetic: synthetic minimal hass, no network.
import { describe, expect, test, beforeAll } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from './types';
import './tesla-card';
import './editor';

/** A config carrying bogus/future keys a build does not (yet) know about. */
const FUTURE_CONFIG = {
  type: 'custom:tesla-card',
  name: 'Model Y',
  some_future_key: 42,
  nested: { a: 1 },
} as unknown as TeslaCardConfig;

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
  _config?: Record<string, unknown>;
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

describe('AC3 — card setConfig is forward-compatible (tolerates unknown keys)', () => {
  test('unknown/future keys: setConfig does not throw and the card renders', async () => {
    const el = makeCard();
    expect(() => el.setConfig(FUTURE_CONFIG)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true); // newer YAML on an older build → still renders
    el.remove();
  });

  test('unknown keys are PRESERVED on the stored config (not silently dropped)', async () => {
    const el = makeCard();
    el.setConfig(FUTURE_CONFIG);
    await expect(el.updateComplete).resolves.toBeDefined();
    // The spread keeps unknown keys on `_config`, so a future field survives a
    // round-trip and downstream code can read it once the build learns about it.
    expect(el._config?.some_future_key).toBe(42);
    expect(el._config?.nested).toEqual({ a: 1 });
    el.remove();
  });

  test('a garbage default_panel does not throw and falls back (no empty shell)', async () => {
    const el = makeCard();
    const cfg = { type: 'custom:tesla-card', default_panel: 'not_a_real_panel' } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true); // render() falls the unknown tab back to charging
    el.remove();
  });

  test('falsy config (undefined) STILL throws the one sanctioned validation', () => {
    const el = makeCard();
    expect(() => el.setConfig(undefined as unknown as TeslaCardConfig)).toThrow(
      'Invalid configuration'
    );
    el.remove();
  });
});

describe('AC3 — editor setConfig is equally tolerant', () => {
  test('unknown/future keys: editor setConfig does not throw and preserves them', async () => {
    const el = makeEditor();
    expect(() => el.setConfig(FUTURE_CONFIG)).not.toThrow();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(el._config?.some_future_key).toBe(42);
    el.remove();
  });

  test('config-changed round-trip preserves an unknown key (not dropped on edit)', async () => {
    const el = makeEditor();
    el.hass = fullHass();
    el.setConfig(FUTURE_CONFIG);
    await el.updateComplete;

    let emitted: Record<string, unknown> | undefined;
    el.addEventListener('config-changed', (e: Event) => {
      emitted = (e as CustomEvent<{ config: Record<string, unknown> }>).detail.config;
    });

    // Edit the name field → the editor re-emits the WHOLE config; the future key
    // must survive the merge (the spread in `_patch`/`_text`), never be dropped.
    const input = el.shadowRoot?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'Renamed Y';
    input.dispatchEvent(new Event('change'));

    expect(emitted).toBeDefined();
    expect(emitted?.name).toBe('Renamed Y');
    expect(emitted?.some_future_key).toBe(42); // future field round-tripped intact
    el.remove();
  });
});
