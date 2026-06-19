import type { HomeAssistant, TeslaCardConfig } from './types';
import { readRaw } from './data/freshness';

/**
 * Resolve the body paint colour for the recolorable hero.
 *
 * `config.paint` may be:
 *   • a literal CSS colour            → used verbatim (`#23519e`, `rgb(...)`, `blue`)
 *   • a generic colour name           → mapped via {@link PAINT_PRESETS} (`"blue"`)
 *   • a {@link PaintSource} object    → read live from an entity/attribute, then
 *                                       mapped (name → hex) or used as-is
 *
 * The bundled presets are GENERIC colour names only — no vendor marketing names or
 * option codes ship (Story 2.6 trade-dress gate). A user who wants vendor-specific
 * names supplies them via the source's `map` field (or passes a literal colour).
 *
 * NOTE: the official `tesla_fleet` integration does **not** expose an exterior
 * colour attribute, so entity-driven paint only applies to integrations that do
 * (or a user-authored template/helper sensor). Everything degrades gracefully:
 * an unresolved source falls back to `source.default`, then the caller's silver.
 *
 * Hexes are biased slightly bright on purpose — the hero composites a `multiply`
 * shade layer over the paint, which darkens it toward the real-world colour.
 */
export interface PaintSource {
  /** Entity carrying the colour (state, or `attribute` if set). */
  entity: string;
  /** Read this attribute instead of the entity state. */
  attribute?: string;
  /** Extra name→colour entries, merged over (and overriding) the bundled presets. */
  map?: Record<string, string>;
  /** Colour to use when the entity yields nothing usable. */
  default?: string;
}

/**
 * Bundled paint presets — GENERIC colour names only (no marketing names, no
 * option codes), so nothing Tesla-branded ships. Hex VALUES are retained (they
 * aren't trademarked) and biased slightly bright on purpose — the hero composites
 * a `multiply` shade over the paint, which darkens it toward the real colour.
 * Want vendor-specific names? Supply them via `PaintSource.map` or a literal.
 */
export const PAINT_PRESETS: Record<string, string> = {
  // Whites / silvers
  white: '#eceeef',
  silver: '#c2c5c8',
  lightsilver: '#c4c7cb',
  // Greys → blacks (light to dark)
  grey: '#6a6e73',
  gray: '#6a6e73',
  darkgrey: '#5a5e63',
  darkgray: '#5a5e63',
  charcoal: '#1f2226',
  black: '#21252a',
  // Blue
  blue: '#2a4f93',
  // Reds (mid, bright, dark)
  red: '#9e2228',
  brightred: '#c01020',
  darkred: '#4d1016',
};

/** Small set of CSS named colours we accept as literals (recolour-relevant). */
const CSS_NAMED = new Set([
  'white', 'black', 'red', 'green', 'blue', 'silver', 'gray', 'grey',
  'navy', 'maroon', 'teal', 'aqua', 'orange', 'gold', 'crimson',
  'transparent', 'currentcolor',
]);

const UNUSABLE = new Set(['', 'unknown', 'unavailable', 'none', 'null', 'undefined']);

/** Normalise a colour key: lower-case, strip everything but a–z0–9. */
export function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when `value` already reads as a CSS colour (hex / functional / named). */
function looksLikeCss(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/.test(v)) return true;
  return CSS_NAMED.has(v);
}

/** Map a colour *name* (generic preset or a user-supplied `extra` entry) to a hex, if known. */
export function colorFromName(
  raw: string,
  extra?: Record<string, string>
): string | undefined {
  const key = normalizeKey(raw);
  if (!key) return undefined;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (normalizeKey(k) === key) return v;
    }
  }
  return PAINT_PRESETS[key];
}

/**
 * Resolve `config.paint` to a CSS colour string, or `undefined` when there is
 * nothing to apply (the caller then uses its neutral default).
 */
export function resolvePaint(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): string | undefined {
  const paint = config.paint;
  if (paint == null) return undefined;

  // Literal string: a CSS colour wins; otherwise try the preset name map; if
  // neither, pass it through (lets users use a colour we don't know about).
  if (typeof paint === 'string') {
    if (looksLikeCss(paint)) return paint;
    return colorFromName(paint) ?? paint;
  }

  // PaintSource: read live (via the data/ reader — the sole sanctioned home for
  // hass.states), then map, pass through, or fall back. paint.ts keeps all the
  // colour-domain logic; only the raw state access lives in data/.
  const raw = readRaw(hass, paint.entity, paint.attribute);
  if (raw && !UNUSABLE.has(raw.trim().toLowerCase())) {
    const mapped = colorFromName(raw, paint.map);
    if (mapped) return mapped;
    if (looksLikeCss(raw)) return raw;
  }
  return paint.default;
}
