// @vitest-environment jsdom
//
// Gate for the `weather-vignette` render helper (Story 6.4). Pins the story ACs:
//   AC1 — `weatherScene(condition, isDay)` maps EVERY HA core weather condition ×
//         day/night → the expected day/night-resolved scene (table-driven, so a
//         dropped/mis-mapped condition fails CI).
//   AC3 — `weatherVignetteStyles` carries a `prefers-reduced-motion: reduce` block
//         that freezes (`animation: none`) every wx-* animated class (the freeze is
//         a hard, asserted invariant — not a hope).
//   AC4 — an absent condition → `nothing` (no fabricated sky); a present condition
//         → a renderable TemplateResult.
import { describe, expect, test } from 'vitest';
import { nothing } from 'lit';
import {
  weatherScene,
  weatherVignette,
  weatherVignetteStyles,
  type WeatherScene,
} from './weather-vignette';

describe('AC1 — weatherScene maps the full HA weather vocabulary, day/night aware', () => {
  // [condition, isDay, expectedScene]. Covers HA's complete condition list plus
  // an unknown string; pins the day/night split and the distinct rain/pouring,
  // snow-family, and lightning-family collapses.
  const CASES: ReadonlyArray<readonly [string, boolean, WeatherScene]> = [
    // clear sky — day/night split, plus the defensive `sunny`-at-night → moon.
    ['sunny', true, 'clear-day'],
    ['sunny', false, 'clear-night'],
    ['clear-night', true, 'clear-night'], // intrinsically night even if isDay (no-sun.sun inference)
    ['clear-night', false, 'clear-night'],
    // partly cloudy — the canonical day/night-differing treatment.
    ['partlycloudy', true, 'partlycloudy-day'],
    ['partlycloudy', false, 'partlycloudy-night'],
    // overcast family → cloudy (day/night-neutral).
    ['cloudy', true, 'cloudy'],
    ['cloudy', false, 'cloudy'],
    ['fog', true, 'cloudy'],
    ['windy', true, 'cloudy'],
    ['windy-variant', false, 'cloudy'],
    // rain vs pouring are DISTINCT scenes.
    ['rainy', true, 'rainy'],
    ['pouring', true, 'pouring'],
    // snow family collapses (snowy / snowy-rainy / hail).
    ['snowy', true, 'snowy'],
    ['snowy-rainy', false, 'snowy'],
    ['hail', true, 'snowy'],
    // lightning family collapses.
    ['lightning', true, 'lightning-rainy'],
    ['lightning-rainy', false, 'lightning-rainy'],
    // exceptional / unknown → SAFE NEUTRAL overcast (never a fabricated sun).
    ['exceptional', true, 'cloudy'],
    ['totally-unknown-string', true, 'cloudy'],
  ];

  test.each(CASES)('weatherScene(%s, isDay=%s) → %s', (cond, isDay, expected) => {
    expect(weatherScene(cond, isDay)).toBe(expected);
  });

  test('an unknown condition never fabricates a clear sky (no clear-day/clear-night)', () => {
    expect(weatherScene('moon-base-storm', true)).not.toBe('clear-day');
    expect(weatherScene('moon-base-storm', false)).not.toBe('clear-night');
  });
});

describe('AC3 — reduced-motion freezes every wx-* animation (structural invariant)', () => {
  const cssText = (weatherVignetteStyles as unknown as { cssText: string }).cssText;

  test('a prefers-reduced-motion: reduce block exists and sets animation: none', () => {
    expect(cssText).toContain('prefers-reduced-motion: reduce');
    // Isolate the reduced-motion block and assert it freezes motion.
    const idx = cssText.indexOf('prefers-reduced-motion: reduce');
    const block = cssText.slice(idx);
    expect(block).toContain('animation: none');
    // Every animated wx-* class must be named in the freeze.
    for (const cls of ['wx-glow', 'wx-rays', 'wx-cloud', 'wx-drop', 'wx-flake', 'wx-star', 'wx-bolt']) {
      expect(block).toContain(`.${cls}`);
    }
  });

  test('rain/bolt accents route through token vars with fallbacks (never a bare var)', () => {
    expect(cssText).toContain('var(--tc-blue, #38bdf8)'); // rain drop
    expect(cssText).toContain('var(--tc-amber, #fbbf24)'); // lightning bolt
  });
});

describe('AC4 — honest degradation: omit when absent, render when present', () => {
  const sources = { weather: 'weather.home', sun: 'sun.sun' };

  test('absent condition → nothing (no fabricated sky)', () => {
    expect(weatherVignette({ condition: undefined, isDay: true, sources })).toBe(nothing);
  });

  // `readRaw` returns the literal HA sentinel STRING for an unavailable/unknown/
  // none/empty entity (they are strings, not `undefined`) — the helper must still
  // OMIT, never let them fall through `weatherScene`'s `default` arm to a
  // fabricated `cloudy` sky. This is the "never overstate" honesty class (UX-DR18).
  test.each(['unavailable', 'unknown', 'none', ''])(
    'HA sentinel condition %p → nothing (never a fabricated sky)',
    (sentinel) => {
      expect(weatherVignette({ condition: sentinel, isDay: true, sources })).toBe(nothing);
    }
  );

  test('present condition → a renderable TemplateResult', () => {
    const res = weatherVignette({ condition: 'rainy', isDay: true, sources });
    expect(res).not.toBe(nothing);
    expect(res).toHaveProperty('_$litType$'); // Lit TemplateResult marker
  });
});
