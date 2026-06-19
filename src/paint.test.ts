// Co-located test for the Story 2.6 paint relabel (AC2a).
//
// Story 2.6 renamed `TESLA_PAINT` → generic `PAINT_PRESETS` and re-keyed it to
// generic colour names only (marketing names + option codes dropped, hex VALUES
// retained), while promising the public API + behaviour stay intact:
// `resolvePaint`, `colorFromName(raw, extra)`, `normalizeKey`, `PaintSource`, and
// the `looksLikeCss`/`CSS_NAMED`/`UNUSABLE` logic. That behaviour-preservation
// claim had no unit coverage — the trade-dress GATE was tested, the relabelled
// RESOLVER was not. This spec backs the claim:
//   (a) the resolver still maps literals / generic names / live entities / the
//       user-supplied `map` exactly as before, and degrades gracefully;
//   (b) the bundled presets carry GENERIC names only — no marketing name or
//       option code survives in the shipped map (the relabel, asserted against
//       the actual export, not the Dev Agent Record's word — Epic-1 retro lesson).
import { describe, expect, test } from 'vitest';
import {
  PAINT_PRESETS,
  normalizeKey,
  colorFromName,
  resolvePaint,
  type PaintSource,
} from './paint';
import type { HomeAssistant, TeslaCardConfig } from './types';

/** A minimal hass exposing just a states map (all the resolver reads). */
function hassWith(states: Record<string, { state?: string; attributes?: Record<string, any> }>): HomeAssistant {
  const built: HomeAssistant['states'] = {};
  for (const [id, v] of Object.entries(states)) {
    built[id] = {
      entity_id: id,
      state: v.state ?? '',
      attributes: v.attributes ?? {},
    };
  }
  return { states: built } as unknown as HomeAssistant;
}

/** Wrap a `paint` value into a config (the only field the resolver consults). */
const cfg = (paint: TeslaCardConfig['paint']): TeslaCardConfig => ({ paint }) as TeslaCardConfig;

describe('normalizeKey', () => {
  test('lower-cases and strips every non-alphanumeric character', () => {
    expect(normalizeKey('Deep Blue')).toBe('deepblue');
    expect(normalizeKey('  Dark-Grey  ')).toBe('darkgrey');
    expect(normalizeKey('PPSW')).toBe('ppsw');
    expect(normalizeKey('Bright_Red!')).toBe('brightred');
  });

  test('keeps digits and collapses to empty for symbol-only input', () => {
    expect(normalizeKey('rgb 255')).toBe('rgb255');
    expect(normalizeKey('   ---   ')).toBe('');
  });
});

describe('PAINT_PRESETS — bundled palette is generic only (the relabel)', () => {
  test('exposes the expected generic colour keys with retained hex values', () => {
    // Generic names only; hexes retained (not trademarked) — Story 2.6 §2a.
    expect(PAINT_PRESETS.white).toBe('#eceeef');
    expect(PAINT_PRESETS.silver).toBe('#c2c5c8');
    expect(PAINT_PRESETS.blue).toBe('#2a4f93');
    expect(PAINT_PRESETS.red).toBe('#9e2228');
    expect(PAINT_PRESETS.black).toBe('#21252a');
    // grey/gray alias to the same value
    expect(PAINT_PRESETS.grey).toBe(PAINT_PRESETS.gray);
  });

  test('carries NO Tesla marketing name as a key', () => {
    const marketing = [
      'pearlwhitemulticoat', 'deepbluemetallic', 'obsidianblackmetallic',
      'midnightsilvermetallic', 'stealthgrey', 'stealthgray', 'silvermetallic',
      'redmulticoat', 'ultrared', 'midnightcherryred', 'quicksilver',
    ];
    for (const name of marketing) {
      expect(PAINT_PRESETS[name], `marketing name "${name}" must not ship`).toBeUndefined();
    }
  });

  test('carries NO Tesla option code as a key', () => {
    const codes = [
      'ppsw', 'pbsb', 'pbcw', 'pmbl', 'pmng', 'pn00',
      'pmss', 'pn01', 'ppsb', 'ppmr', 'pr00', 'pr01',
    ];
    for (const code of codes) {
      expect(PAINT_PRESETS[code], `option code "${code}" must not ship`).toBeUndefined();
    }
  });

  test('never carries the brand red #e82127 as a value', () => {
    expect(Object.values(PAINT_PRESETS)).not.toContain('#e82127');
  });
});

describe('colorFromName', () => {
  test('maps a generic preset name to its hex (case / spacing insensitive)', () => {
    expect(colorFromName('blue')).toBe(PAINT_PRESETS.blue);
    expect(colorFromName('Dark Grey')).toBe(PAINT_PRESETS.darkgrey);
    expect(colorFromName('  BLACK ')).toBe(PAINT_PRESETS.black);
  });

  test('returns undefined for an unknown name and for empty input', () => {
    expect(colorFromName('Deep Blue')).toBeUndefined(); // marketing name no longer bundled
    expect(colorFromName('')).toBeUndefined();
    expect(colorFromName('   ')).toBeUndefined();
  });

  test('an `extra` (user) map overrides and extends the bundled presets', () => {
    // user re-introduces a vendor name → hex (bring-your-own path)
    expect(colorFromName('Deep Blue', { 'Deep Blue': '#2a4f93' })).toBe('#2a4f93');
    // extra wins over a bundled key of the same normalised name
    expect(colorFromName('blue', { Blue: '#000fff' })).toBe('#000fff');
    // a miss in extra still falls through to the bundled preset
    expect(colorFromName('red', { custom: '#abcabc' })).toBe(PAINT_PRESETS.red);
  });
});

describe('resolvePaint — literal string forms', () => {
  test('returns undefined when paint is unset', () => {
    expect(resolvePaint(undefined, cfg(undefined))).toBeUndefined();
  });

  test('passes a literal CSS colour through verbatim', () => {
    expect(resolvePaint(undefined, cfg('#23519e'))).toBe('#23519e');
    expect(resolvePaint(undefined, cfg('rgb(10, 20, 30)'))).toBe('rgb(10, 20, 30)');
    expect(resolvePaint(undefined, cfg('navy'))).toBe('navy'); // CSS named colour
  });

  test('a name that is ALSO a CSS colour passes through verbatim (CSS wins over the preset map)', () => {
    // `looksLikeCss` is consulted FIRST, so 'blue' returns the CSS keyword, not
    // the preset hex — the recolour treats the keyword as the colour. (The map
    // only kicks in for preset names that are NOT CSS keywords; see below.)
    expect(resolvePaint(undefined, cfg('blue'))).toBe('blue');
    expect(resolvePaint(undefined, cfg('red'))).toBe('red');
  });

  test('maps a non-CSS-keyword generic preset name to its hex', () => {
    expect(resolvePaint(undefined, cfg('Dark Red'))).toBe(PAINT_PRESETS.darkred);
    expect(resolvePaint(undefined, cfg('charcoal'))).toBe(PAINT_PRESETS.charcoal);
    expect(resolvePaint(undefined, cfg('Bright Red'))).toBe(PAINT_PRESETS.brightred);
  });

  test('passes an unknown name string through unchanged (escape hatch)', () => {
    expect(resolvePaint(undefined, cfg('mauve'))).toBe('mauve');
  });
});

describe('resolvePaint — PaintSource (live entity)', () => {
  test('reads the entity state and maps a generic name to a hex', () => {
    const hass = hassWith({ 'sensor.car_colour': { state: 'blue' } });
    const src: PaintSource = { entity: 'sensor.car_colour' };
    expect(resolvePaint(hass, cfg(src))).toBe(PAINT_PRESETS.blue);
  });

  test('reads a named attribute instead of the state when `attribute` is set', () => {
    const hass = hassWith({ 'sensor.car': { state: 'on', attributes: { colour: '#abcdef' } } });
    const src: PaintSource = { entity: 'sensor.car', attribute: 'colour' };
    expect(resolvePaint(hass, cfg(src))).toBe('#abcdef'); // looks like CSS → passes through
  });

  test('a user-supplied `map` resolves vendor names read from the entity', () => {
    const hass = hassWith({ 'sensor.car': { state: 'Deep Blue' } });
    const src: PaintSource = { entity: 'sensor.car', map: { 'Deep Blue': '#2a4f93' } };
    expect(resolvePaint(hass, cfg(src))).toBe('#2a4f93');
  });

  test('falls back to `default` for unusable / unknown entity states', () => {
    const src: PaintSource = { entity: 'sensor.car', default: '#c6c8c9' };
    for (const bad of ['unavailable', 'unknown', 'none', '']) {
      const hass = hassWith({ 'sensor.car': { state: bad } });
      expect(resolvePaint(hass, cfg(src))).toBe('#c6c8c9');
    }
  });

  test('falls back to `default` when the entity is absent from states', () => {
    const hass = hassWith({});
    const src: PaintSource = { entity: 'sensor.missing', default: '#111111' };
    expect(resolvePaint(hass, cfg(src))).toBe('#111111');
  });

  test('falls back to `default` when a live name is neither mappable nor CSS-like', () => {
    const hass = hassWith({ 'sensor.car': { state: 'sparkly-unicorn' } });
    const src: PaintSource = { entity: 'sensor.car', default: '#222222' };
    expect(resolvePaint(hass, cfg(src))).toBe('#222222');
  });

  test('returns undefined (no default) when nothing resolves and no default is set', () => {
    const hass = hassWith({ 'sensor.car': { state: 'unavailable' } });
    const src: PaintSource = { entity: 'sensor.car' };
    expect(resolvePaint(hass, cfg(src))).toBeUndefined();
  });

  // Story 3.2: the live read now routes through the data/ readRaw reader. It must
  // stay total on the partial/absent `hass` the editor preview & first paint can
  // supply — never throw, just degrade to the source default (or undefined).
  test('never throws on an absent or partial hass; degrades to default', () => {
    const src: PaintSource = { entity: 'sensor.car', default: '#333333' };
    expect(() => resolvePaint(undefined, cfg(src))).not.toThrow();
    expect(resolvePaint(undefined, cfg(src))).toBe('#333333');
    // partial hass with no states map at all
    const partial = {} as unknown as HomeAssistant;
    expect(() => resolvePaint(partial, cfg(src))).not.toThrow();
    expect(resolvePaint(partial, cfg(src))).toBe('#333333');
  });
});
