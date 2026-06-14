import type { HomeAssistant, TeslaCardConfig } from './types';

/**
 * Resolve the body paint colour for the recolorable hero.
 *
 * `config.paint` may be:
 *   • a literal CSS colour            → used verbatim (`#23519e`, `rgb(...)`, `blue`)
 *   • a Tesla colour name             → mapped via {@link TESLA_PAINT} (`"Deep Blue"`)
 *   • a {@link PaintSource} object    → read live from an entity/attribute, then
 *                                       mapped (Tesla name → hex) or used as-is
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
  /** Extra name→colour entries, merged over (and overriding) the Tesla map. */
  map?: Record<string, string>;
  /** Colour to use when the entity yields nothing usable. */
  default?: string;
}

/** Tesla exterior colours — both marketing names and API/option codes. */
export const TESLA_PAINT: Record<string, string> = {
  // Pearl / white
  pearlwhitemulticoat: '#eceeef',
  pearlwhite: '#eceeef',
  white: '#eceeef',
  ppsw: '#eceeef',
  pbcw: '#eceeef',
  // Solid / obsidian black
  solidblack: '#21252a',
  black: '#21252a',
  obsidianblackmetallic: '#1f2226',
  obsidianblack: '#1f2226',
  pbsb: '#21252a',
  pmbl: '#1f2226',
  // Midnight silver / grey
  midnightsilvermetallic: '#5a5e63',
  midnightsilver: '#5a5e63',
  pmng: '#5a5e63',
  stealthgrey: '#6a6e73',
  stealthgray: '#6a6e73',
  pn00: '#6a6e73',
  // Silver / quicksilver
  silvermetallic: '#c2c5c8',
  silver: '#c2c5c8',
  pmss: '#c2c5c8',
  quicksilver: '#c4c7cb',
  pn01: '#c4c7cb',
  // Blue
  deepbluemetallic: '#2a4f93',
  deepblue: '#2a4f93',
  blue: '#2a4f93',
  ppsb: '#2a4f93',
  // Red
  redmulticoat: '#9e2228',
  red: '#9e2228',
  ppmr: '#9e2228',
  ultrared: '#c01020',
  pr00: '#c01020',
  pr01: '#c01020',
  midnightcherryred: '#4d1016',
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

/** Map a colour *name* (Tesla marketing name or code) to a hex, if known. */
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
  return TESLA_PAINT[key];
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

  // Literal string: a CSS colour wins; otherwise try the Tesla name map; if
  // neither, pass it through (lets users use a colour we don't know about).
  if (typeof paint === 'string') {
    if (looksLikeCss(paint)) return paint;
    return colorFromName(paint) ?? paint;
  }

  // PaintSource: read live, map, or fall back.
  const st = hass?.states?.[paint.entity];
  const raw = st
    ? paint.attribute
      ? st.attributes?.[paint.attribute]
      : st.state
    : undefined;

  if (typeof raw === 'string' && !UNUSABLE.has(raw.trim().toLowerCase())) {
    const mapped = colorFromName(raw, paint.map);
    if (mapped) return mapped;
    if (looksLikeCss(raw)) return raw;
  }
  return paint.default;
}
