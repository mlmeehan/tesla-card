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

  test('garbage VALUES in known optional fields do not throw and still render (FR-24)', async () => {
    // "Validates only what it consumes": setConfig stores the config and never
    // eagerly type-checks optional fields — resolution is lazy and degrades. A
    // config whose typed-optional fields carry wrong-typed garbage must render,
    // not crash or blank (the degradation face of the forward-compat contract).
    const el = makeCard();
    const cfg = {
      type: 'custom:tesla-card',
      tyres: 'not-an-object',
      energy: 7,
      weather: [],
      wake_cooldown: 'soon',
      entities: 'nope',
    } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true);
    el.remove();
  });
});

describe('Story 9.1 — energy.nodes is additive/optional/tolerated (no consumption yet)', () => {
  // 9.1 ships the SCHEMA ONLY for the Epic 9 node-customization hook. These cases
  // pin the four runtime guarantees: tolerated, preserved, omitted-is-default,
  // garbage-degrades. They deliberately assert NO hide/reorder BEHAVIOR — that is
  // 9.2/9.3's job (consumed at the binding/model seam, not here).

  test('a well-formed energy.nodes does NOT throw and the card still renders', async () => {
    const el = makeCard();
    const cfg = {
      type: 'custom:tesla-card',
      energy: { nodes: { hide: ['solar'], order: ['grid', 'home'] } },
    } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true); // renders the same Scene/card — no consumption in 9.1
    el.remove();
  });

  test('energy.nodes is PRESERVED on the stored config — incl. the 9.7 list-shaped instances', async () => {
    const el = makeCard();
    // Story 9.7: `instances` is a per-instance descriptor LIST (array length = count,
    // each entry { title?, entities? }). The spread must round-trip it intact for the
    // Scene to consume it.
    const instances = {
      solar: [
        { title: 'South' },
        { title: 'Garage', entities: { solar_power: 'sensor.solar_garage_power' } },
      ],
    };
    const cfg = {
      type: 'custom:tesla-card',
      energy: { nodes: { hide: ['vehicle'], order: ['solar'], instances } },
    } as unknown as TeslaCardConfig;
    el.setConfig(cfg);
    await expect(el.updateComplete).resolves.toBeDefined();
    // The `{ ...config }` spread keeps energy.nodes on `_config`, so a round-trip
    // through the editor's config-changed can't drop it before the Scene reads it.
    const energy = el._config?.energy as { nodes?: Record<string, unknown> } | undefined;
    expect(energy?.nodes).toEqual({ hide: ['vehicle'], order: ['solar'], instances });
    el.remove();
  });

  test('a STALE count-shaped instances value (the 9.1 placeholder) is tolerated + preserved (R9)', async () => {
    // Forward-compat both ways: old YAML carrying the pre-9.7 `{ home: 2 }` count shape
    // must still round-trip without throwing. The Scene consumer treats a non-array as
    // "no instances declared" (graceful), but setConfig itself never validates/drops it.
    const el = makeCard();
    const cfg = {
      type: 'custom:tesla-card',
      energy: { nodes: { instances: { home: 2 } } },
    } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true);
    const energy = el._config?.energy as { nodes?: Record<string, unknown> } | undefined;
    expect(energy?.nodes).toEqual({ instances: { home: 2 } });
    el.remove();
  });

  test('GARBAGE in energy.nodes does not throw and still renders (FR-24 degradation)', async () => {
    const el = makeCard();
    const cfg = {
      type: 'custom:tesla-card',
      energy: {
        nodes: { hide: ['not_a_node', 42], order: 'nope', instances: { vehicle: 'two' } },
      },
    } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    // Unknown node strings / wrong-typed values are tolerated (not validated-and-thrown
    // in 9.1); auto-detect fills the gaps so the card renders, never blanks.
    expect(hasRoot(el)).toBe(true);
    el.remove();
  });

  test('Story 9.8 — a vehicle instance LIST with per-car config round-trips + tolerates garbage (R9)', async () => {
    // 9.8 consumes `instances.vehicle`: each spec's `config` is the per-car embedded
    // `tesla-card` override (distinct device / name / paint). The spread must round-trip
    // the new `config` field intact for the Scene to merge it per car.
    const el = makeCard();
    const instances = {
      vehicle: [
        { title: 'Model Y' },
        { title: 'Model 3', config: { device: 'model_3', name: 'Model 3', paint: '#b00' } },
      ],
    };
    const cfg = {
      type: 'custom:tesla-card',
      energy: { nodes: { instances } },
    } as unknown as TeslaCardConfig;
    expect(() => el.setConfig(cfg)).not.toThrow();
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true);
    const energy = el._config?.energy as { nodes?: Record<string, unknown> } | undefined;
    expect(energy?.nodes).toEqual({ instances }); // the per-car `config` survives the spread
    el.remove();

    // A stale count-shaped / garbage vehicle value degrades to "no instances" (single car)
    // and NEVER throws (the consumer reads it via `roleInstances`, which tolerates non-arrays).
    const garbage = makeCard();
    expect(() =>
      garbage.setConfig({
        type: 'custom:tesla-card',
        energy: { nodes: { instances: { vehicle: 2 } } },
      } as unknown as TeslaCardConfig)
    ).not.toThrow();
    garbage.hass = fullHass();
    await expect(garbage.updateComplete).resolves.toBeDefined();
    expect(hasRoot(garbage)).toBe(true);
    garbage.remove();
  });

  test('OMITTED nodes (and omitted energy) renders identically — absence is the default (SM-C4)', async () => {
    const withNodes = makeCard();
    withNodes.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: {} },
    } as unknown as TeslaCardConfig);
    withNodes.hass = fullHass();
    await expect(withNodes.updateComplete).resolves.toBeDefined();
    const a = hasRoot(withNodes);

    const omitted = makeCard();
    omitted.setConfig({ type: 'custom:tesla-card' });
    omitted.hass = fullHass();
    await expect(omitted.updateComplete).resolves.toBeDefined();
    const b = hasRoot(omitted);

    // Both render — an empty/omitted nodes block is exactly today's Scene (no change).
    expect(a).toBe(true);
    expect(b).toBe(true);
    withNodes.remove();
    omitted.remove();
  });
});

describe('Story 9.12 — appearance.theme is additive/tolerated + reflects onto the host', () => {
  test('appearance.theme: tolerated, preserved on _config, renders (forward-compat)', async () => {
    const el = makeCard();
    el.setConfig({
      type: 'custom:tesla-card',
      appearance: { theme: 'light', future_sub: 1 },
    } as unknown as TeslaCardConfig);
    el.hass = fullHass();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(hasRoot(el)).toBe(true);
    // The spread keeps appearance + its unknown sub-keys intact (R9).
    expect(el._config?.appearance).toEqual({ theme: 'light', future_sub: 1 });
    el.remove();
  });

  test("theme='light' reflects a host theme attribute; absent ⇒ no attribute (dark default)", async () => {
    const el = makeCard();
    el.setConfig({ type: 'custom:tesla-card', appearance: { theme: 'light' } } as TeslaCardConfig);
    el.hass = fullHass();
    await el.updateComplete;
    expect((el as unknown as HTMLElement).getAttribute('theme')).toBe('light');

    // Switch to dark → attribute follows.
    el.setConfig({ type: 'custom:tesla-card', appearance: { theme: 'dark' } } as TeslaCardConfig);
    await el.updateComplete;
    expect((el as unknown as HTMLElement).getAttribute('theme')).toBe('dark');

    // Auto (absent) → attribute removed (byte-identical dark default).
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    expect((el as unknown as HTMLElement).hasAttribute('theme')).toBe(false);
    el.remove();
  });

  test('a garbage appearance.theme does NOT reflect (degrades to Auto, never throws — FR-24)', async () => {
    const el = makeCard();
    expect(() =>
      el.setConfig({
        type: 'custom:tesla-card',
        appearance: { theme: 'banana' },
      } as unknown as TeslaCardConfig)
    ).not.toThrow();
    el.hass = fullHass();
    await el.updateComplete;
    expect(hasRoot(el)).toBe(true);
    expect((el as unknown as HTMLElement).hasAttribute('theme')).toBe(false);
    el.remove();
  });

  test('a garbage non-object appearance does not throw and does not reflect', async () => {
    const el = makeCard();
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', appearance: 'nope' } as unknown as TeslaCardConfig)
    ).not.toThrow();
    el.hass = fullHass();
    await el.updateComplete;
    expect(hasRoot(el)).toBe(true);
    expect((el as unknown as HTMLElement).hasAttribute('theme')).toBe(false);
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
