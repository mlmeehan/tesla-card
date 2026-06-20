// @vitest-environment jsdom
//
// Element-level gate for Story 5.9 (Location Panel). The panel pre-existed (pre-BMAD
// prototype, token/string-migrated in Epic 2, statTile-migrated to the 5.5 primitive,
// wired into the 5.1 shell); this story closes the AC + DoD gaps and these tests pin
// them as regressions:
//   AC1 — a GRAYSCALE map iframe (filter grayscale(1), not the prototype's 20%) +
//         the lat/lon coordinate readout + a real keyboard-focusable Open-map link
//         (rel="noopener noreferrer") + the odo/speed/power statTiles (5.5 primitive);
//         ETA lives in the route row and renders ONLY when a route exists.
//   AC2 — the map-card gradient is the ONE sanctioned, DOCUMENTED hard-coded colour
//         exception (135deg backdrop in the styles); the empty-state copy uses the
//         dim (4.5:1) token, never the mute (3:1) one. The cross-file "only one
//         exception" guarantee is owned by styles.test.ts (Story 5.9 AC2 block).
//   AC3 / honest freshness — no coords ⇒ "Location unavailable" empty state (marker
//         icon + text), coord foot "—", Open-map absent, nothing thrown; a stale/
//         asleep last-known location/odometer shows last-known + an "updated Nm ago"
//         staleness stamp (the dim .tc-stale-copy class), NEVER presented as live.
//
// Freshness is deterministic by injection: every fixture entity is stamped at one
// instant, so advancing the server reference (bumping battery_level's last_updated)
// back-dates the location/odometer into stale/asleep — exactly how HA pushes a fresh
// stamp on some entity while a sensor sits idle (mirrors src/data/freshness.test.ts
// and panel-tyres.test.ts). Entity ids come from const.ts DEFAULT_ENTITIES (never
// inlined); a FRESH hass per swap. Read-only panel → no callService.
import { afterEach, describe, expect, test } from 'vitest';
import './panel-location';
import { TcPanelLocation } from './panel-location';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import asleepFx from '../fixtures/model-y-asleep.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

type PanelEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

const ID = {
  location: DEFAULT_ENTITIES.location,
  odometer: DEFAULT_ENTITIES.odometer,
  speed: DEFAULT_ENTITIES.speed,
  power: DEFAULT_ENTITIES.power,
  distance: DEFAULT_ENTITIES.distance_to_arrival,
  eta: DEFAULT_ENTITIES.time_to_arrival,
  traffic: DEFAULT_ENTITIES.traffic_delay,
  battery: DEFAULT_ENTITIES.battery_level,
} as const;

/** 50 min after the fixtures' single 14:41Z stamp — past the 30-min default `asleep`
 *  window (location) but inside the 60-min `odometer` fresh override. */
const ADVANCED_50M = '2026-06-15T15:31:00Z';
/** 3 h after the fixtures' stamp — past the 60-min `odometer` fresh override too. */
const ADVANCED_3H = '2026-06-15T17:41:00Z';

function awakeStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(awakeFx.states)) as Record<string, HassEntity>;
}
function asleepStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(asleepFx.states)) as Record<string, HassEntity>;
}

/** Advance the HA time base: stamp battery_level AFTER the location/odometer so
 *  referenceNow (max server stamp) sits ahead of them → they read stale/asleep. */
function advanceNow(states: Record<string, HassEntity>, to: string): Record<string, HassEntity> {
  states[ID.battery].last_updated = to;
  states[ID.battery].last_changed = to;
  return states;
}

function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}

async function mount(
  hass: HomeAssistant,
  config: Partial<TeslaCardConfig> = {}
): Promise<PanelEl> {
  const el = document.createElement('tc-panel-location') as PanelEl;
  el.hass = hass;
  el.config = { type: 'custom:tesla-card', ...config }; // entities default to DEFAULT_ENTITIES
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const sr = (el: PanelEl) => el.shadowRoot!;
const iframe = (el: PanelEl) => sr(el).querySelector<HTMLIFrameElement>('.map iframe');
const coordText = (el: PanelEl) => sr(el).querySelector('.coord')!.textContent?.trim() ?? '';
const mapLink = (el: PanelEl) => sr(el).querySelector<HTMLAnchorElement>('a.maplink');
/** The label text of every rendered statTile (the `.stat .k` spans). */
const tileLabels = (el: PanelEl) =>
  [...sr(el).querySelectorAll('.stat .k')].map((n) => n.textContent?.trim() ?? '');
/** A statTile by its label, or undefined. */
const tileByLabel = (el: PanelEl, label: string) =>
  [...sr(el).querySelectorAll<HTMLElement>('.stat')].find(
    (t) => t.querySelector('.k')?.textContent?.trim() === label
  );

/** The component's full static-styles text (sharedStyles + the local css block). */
const STYLES = (TcPanelLocation.styles as Array<{ cssText: string }>)
  .map((s) => s.cssText)
  .join('\n');

afterEach(() => {
  document.body.innerHTML = '';
});

// ── AC1 — grayscale map + coords + Open-map + odo/speed/power statTiles ───────
describe('AC1 — grayscale map, coordinate readout, Open-map, travel-stat tiles', () => {
  test('the map iframe renders with the lat/lon bbox + marker in its src', async () => {
    const el = await mount(makeHass(awakeStates()));
    const f = iframe(el);
    expect(f).not.toBeNull();
    // Awake fixture: 37.7749 / -122.4194. The bbox + marker carry the coords.
    expect(f!.getAttribute('src')).toContain('37.7749');
    expect(f!.getAttribute('src')).toContain('-122.4194');
    expect(f!.getAttribute('title')).toBe(STRINGS.location.mapLabel);
  });

  test('the iframe filter is a FULL grayscale render (grayscale(1)), not the prototype 20%', () => {
    // jsdom does not lay out / compute adopted-stylesheet filters; assert the rule
    // in the component's styles text (the contract), per the story's test guidance.
    expect(STYLES).toContain('grayscale(1)');
    expect(STYLES).not.toContain('grayscale(0.2)');
  });

  test('the coordinate readout shows the formatted lat, lon', async () => {
    const el = await mount(makeHass(awakeStates()));
    expect(coordText(el)).toContain('37.7749');
    expect(coordText(el)).toContain('-122.4194');
  });

  test('Open-map is a real focusable <a> carrying the coords + rel="noopener noreferrer"', async () => {
    const el = await mount(makeHass(awakeStates()));
    const a = mapLink(el);
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toContain('37.7749');
    expect(a!.getAttribute('href')).toContain('-122.4194');
    expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a!.getAttribute('target')).toBe('_blank');
    expect(a!.textContent).toContain(STRINGS.location.openMap);
  });

  test('the odometer / speed / power statTiles (5.5 primitive) render', async () => {
    const el = await mount(makeHass(awakeStates()));
    const labels = tileLabels(el);
    expect(labels).toContain(STRINGS.location.odometer);
    expect(labels).toContain(STRINGS.location.speed);
    expect(labels).toContain(STRINGS.location.power);
    // Awake odometer = 12345 → formatted; not an em-dash (it is available).
    expect(tileByLabel(el, STRINGS.location.odometer)!.textContent).toContain('12,345');
  });

  test('ETA + the route row appear ONLY when a route exists', async () => {
    // Awake fixture: distance/eta/traffic are `unavailable` → no route → no ETA tile.
    const parked = await mount(makeHass(awakeStates()));
    expect(tileLabels(parked)).not.toContain(STRINGS.location.eta);
    expect(tileByLabel(parked, STRINGS.location.toArrival)).toBeUndefined();

    // Inject a live route → the route row (toArrival / ETA / traffic) renders.
    const states = awakeStates();
    states[ID.distance].state = '12';
    states[ID.eta].state = '18';
    const enroute = await mount(makeHass(states));
    expect(tileLabels(enroute)).toContain(STRINGS.location.eta);
    expect(tileByLabel(enroute, STRINGS.location.eta)!.textContent).toContain('18m');
    expect(tileByLabel(enroute, STRINGS.location.toArrival)).toBeDefined();
  });
});

// ── AC2 — the documented sanctioned gradient + dim empty-state token ──────────
describe('AC2 — the map gradient is the documented exception; empty-state uses the dim token', () => {
  test('the 135deg map-card gradient lives in the panel styles', () => {
    expect(STYLES).toContain('135deg');
    expect(STYLES).toContain('#1b2533');
    expect(STYLES).toContain('#0f1620');
  });

  test('the empty-state copy uses the dim (4.5:1) token, never the mute (3:1) one', () => {
    // Isolate the .map-empty rule, then its `color:` declaration (the comment may
    // name --tc-text-mute when explaining the a11y fix — only the decl must be dim).
    const block = STYLES.match(/\.map-empty\s*\{[^}]*\}/);
    expect(block, '.map-empty rule not found').not.toBeNull();
    const color = block![0].match(/color:\s*var\([^)]*\)/);
    expect(color, '.map-empty color declaration not found').not.toBeNull();
    expect(color![0]).toContain('--tc-text-dim');
    expect(color![0]).not.toContain('--tc-text-mute');
  });
});

// ── AC3 / honest freshness — empty state + last-known staleness stamps ────────
describe('AC3 — empty state on no coords; stale shows last-known + staleness, never live', () => {
  test('no coordinates → "Location unavailable" empty state (marker + text), coord "—", no Open-map', async () => {
    const states = awakeStates();
    // Strip the lat/lon attributes → _coords() is undefined (NaN-safe guard).
    states[ID.location].attributes = {
      ...(states[ID.location].attributes ?? {}),
      latitude: undefined,
      longitude: undefined,
    };
    const el = await mount(makeHass(states));
    const empty = sr(el).querySelector('.map-empty');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain(STRINGS.location.unavailable);
    expect(empty!.querySelector('svg')).not.toBeNull(); // colour is never the only signal
    expect(iframe(el)).toBeNull();
    expect(coordText(el)).toContain('—');
    expect(mapLink(el)).toBeNull();
  });

  test('an asleep car shows last-known coords + a staleness stamp (dim class), never live', async () => {
    const el = await mount(makeHass(advanceNow(asleepStates(), ADVANCED_50M)));
    // The map still renders the last-known marker (annotated last-known beats a void).
    expect(iframe(el)).not.toBeNull();
    expect(coordText(el)).toContain('37.7749');
    // ...but the coord line is now stamped "updated Nm ago" in the dim copy class.
    const stamp = sr(el).querySelector('.map-stale');
    expect(stamp).not.toBeNull();
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true); // --tc-text-dim, not -mute
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix); // "updated 50m ago"
    // Volatile telemetry went unavailable on sleep → honest em-dash, no fabricated value.
    expect(tileByLabel(el, STRINGS.location.speed)!.textContent).toContain('—');
    expect(tileByLabel(el, STRINGS.location.power)!.textContent).toContain('—');
  });

  test('a fresh-parked car shows NO staleness stamp (never overstates, never understates)', async () => {
    // Awake fixture, no time advance → location/odometer read fresh → no stamp at all.
    const el = await mount(makeHass(awakeStates()));
    expect(sr(el).querySelector('.map-stale')).toBeNull();
    expect(sr(el).querySelector('.odo-stale')).toBeNull();
  });

  test('a long-idle car stamps the last-known ODOMETER too (past its 60-min fresh window)', async () => {
    // 3 h advance: location asleep AND odometer stale (> 60-min override) → odo stamp shows.
    const el = await mount(makeHass(advanceNow(asleepStates(), ADVANCED_3H)));
    const odo = sr(el).querySelector('.odo-stale');
    expect(odo).not.toBeNull();
    expect(odo!.classList.contains('tc-stale-copy')).toBe(true);
    expect(odo!.textContent).toContain(STRINGS.hero.updatedPrefix);
    // Last-known odometer value still shown (annotated, not blanked).
    expect(tileByLabel(el, STRINGS.location.odometer)!.textContent).toContain('12,345');
  });

  test('a fully-empty hass renders the empty state without throwing', async () => {
    const el = await mount(makeHass({}));
    expect(sr(el).querySelector('.map-empty')).not.toBeNull();
    expect(coordText(el)).toContain('—');
    expect(mapLink(el)).toBeNull();
  });
});
