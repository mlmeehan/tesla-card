// @vitest-environment jsdom
//
// Element-level gate for Story 5.7 (Closures Panel). The panel + its SVG diagram
// pre-existed (pre-BMAD prototype, wired into the 5.1 shell); this story closes
// the AC + DoD gaps and these tests pin them as regressions:
//   AC1 — the diagram, five TAPPABLE zones, four STATUS-ONLY doors, the centre
//         lock glyph and lock + vent pills render; a tappable zone actuates on
//         click AND Enter/Space and calls the service once; doors are NOT
//         focusable and carry NO click handler.
//   AC2 — the lock pill toggles the lock, the vent pill toggles the windows
//         cover (once each), and the centre lock glyph is keyboard-actuable.
//   AC3 — the headline: a STALE last-known closure shows its value + a staleness
//         hint and the status line never reads "All closed"; an UNAVAILABLE
//         closure renders `unknown` (neutral — NOT the confident closed look) and
//         the status line surfaces staleness instead of a false "All closed".
//
// Freshness is deterministic by injection: every fixture entity is stamped at one
// instant, so advancing the server reference (bumping one entity's last_updated)
// back-dates the closures into stale/asleep — exactly how HA pushes a fresh stamp
// on some entity while a closure sits idle (mirrors src/data/freshness.test.ts).
// Entity ids come from const.ts DEFAULT_ENTITIES (never inlined); a FRESH hass per
// swap; callService is a vi.fn() spy (single-call contract).
import { afterEach, describe, expect, test, vi } from 'vitest';
import './panel-closures';
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
  lock: DEFAULT_ENTITIES.lock,
  frunk: DEFAULT_ENTITIES.frunk,
  windows: DEFAULT_ENTITIES.windows,
  sunroof: DEFAULT_ENTITIES.sunroof,
  chargePort: DEFAULT_ENTITIES.charge_port,
  doorFL: DEFAULT_ENTITIES.door_fl,
  battery: DEFAULT_ENTITIES.battery_level,
} as const;

/** 50 min after the fixtures' single stamp instant — past the 30-min `asleep` window. */
const ADVANCED_NOW = '2026-06-15T15:31:00Z';

function awakeStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(awakeFx.states)) as Record<string, HassEntity>;
}
function asleepStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(asleepFx.states)) as Record<string, HassEntity>;
}

/** Advance the HA time base: stamp one entity AFTER the closures so referenceNow
 *  (max server stamp) sits ahead of their last_updated → they read stale/asleep. */
function advanceNow(states: Record<string, HassEntity>): Record<string, HassEntity> {
  states[ID.battery].last_updated = ADVANCED_NOW;
  states[ID.battery].last_changed = ADVANCED_NOW;
  return states;
}

function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return {
    states,
    callService: vi.fn().mockResolvedValue(undefined),
  } as unknown as HomeAssistant;
}

async function mount(hass: HomeAssistant): Promise<PanelEl> {
  const el = document.createElement('tc-panel-closures') as PanelEl;
  el.hass = hass;
  el.config = { type: 'custom:tesla-card' }; // entities default to DEFAULT_ENTITIES
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const sr = (el: PanelEl) => el.shadowRoot!;
const zones = (el: PanelEl) =>
  [...sr(el).querySelectorAll<SVGGElement>('g.zone[role="button"]:not(.lock-glyph)')];
const zoneByLabel = (el: PanelEl, label: string) =>
  zones(el).find((g) => (g.getAttribute('aria-label') ?? '').startsWith(label))!;
const doors = (el: PanelEl) => [...sr(el).querySelectorAll<SVGRectElement>('rect.zone.door')];
const pills = (el: PanelEl) => [...sr(el).querySelectorAll<HTMLButtonElement>('.bigpill')];
const statusText = (el: PanelEl) => sr(el).querySelector('.status')!.textContent ?? '';
const click = (node: Element) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const press = (node: Element, key: string) =>
  node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ── AC1 — render + tappability ───────────────────────────────────────────────
describe('AC1 — diagram, tappable zones, status-only doors', () => {
  test('the diagram, five tappable zones, four doors, lock glyph + two pills render', async () => {
    const el = await mount(makeHass(awakeStates()));
    expect(sr(el).querySelector('svg.car')).not.toBeNull();
    expect(zones(el)).toHaveLength(5); // frunk, windows, sunroof, trunk, charge-port
    expect(doors(el)).toHaveLength(4);
    expect(sr(el).querySelector('g.lock-glyph')).not.toBeNull();
    expect(pills(el)).toHaveLength(2);
  });

  test('a tappable zone is focusable (tabindex=0) and fires its cover service once on click', async () => {
    const hass = makeHass(awakeStates()); // frunk closed
    const el = await mount(hass);
    const frunk = zoneByLabel(el, STRINGS.closures.zones.frunk);
    expect(frunk.getAttribute('tabindex')).toBe('0');
    click(frunk);
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('cover', 'open_cover', { entity_id: ID.frunk });
  });

  test('a tappable zone actuates on Enter AND Space (keyboard floor, DoD)', async () => {
    const hass = makeHass(awakeStates());
    const el = await mount(hass);
    const frunk = zoneByLabel(el, STRINGS.closures.zones.frunk);
    press(frunk, 'Enter');
    press(frunk, ' ');
    expect(hass.callService).toHaveBeenCalledTimes(2);
    expect(hass.callService).toHaveBeenLastCalledWith('cover', 'open_cover', { entity_id: ID.frunk });
  });

  test('the zone aria-label is the HONEST state, never a false closed', async () => {
    const el = await mount(makeHass(awakeStates()));
    expect(zoneByLabel(el, STRINGS.closures.zones.frunk).getAttribute('aria-label')).toBe(
      `${STRINGS.closures.zones.frunk}, ${STRINGS.closures.closedWord}`
    );
  });

  test('doors are status-only: NOT focusable and carry no click handler', async () => {
    const hass = makeHass(awakeStates()); // door_fl on (open)
    const el = await mount(hass);
    expect(doors(el).every((d) => d.getAttribute('tabindex') !== '0')).toBe(true);
    const doorFL = doors(el).find((d) =>
      (d.getAttribute('aria-label') ?? '').startsWith(STRINGS.closures.parts.doorFL)
    )!;
    click(doorFL); // a status-only door must not actuate anything
    expect(hass.callService).not.toHaveBeenCalled();
    // …but it still announces its read-only state.
    expect(doorFL.getAttribute('aria-label')).toBe(
      `${STRINGS.closures.parts.doorFL}, ${STRINGS.closures.openWord}`
    );
  });
});

// ── AC2 — lock + vent ────────────────────────────────────────────────────────
describe('AC2 — centre lock glyph + lock/vent pills', () => {
  test('the lock pill toggles the lock once (locked → unlock)', async () => {
    const hass = makeHass(awakeStates()); // lock locked
    const el = await mount(hass);
    click(pills(el)[0]);
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('lock', 'unlock', { entity_id: ID.lock });
  });

  test('the vent pill toggles the windows cover once (closed → open)', async () => {
    const hass = makeHass(awakeStates()); // windows closed
    const el = await mount(hass);
    click(pills(el)[1]);
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('cover', 'open_cover', { entity_id: ID.windows });
  });

  test('the centre lock glyph is keyboard-actuable (Enter → lock service)', async () => {
    const hass = makeHass(awakeStates());
    const el = await mount(hass);
    const glyph = sr(el).querySelector('g.lock-glyph')!;
    expect(glyph.getAttribute('tabindex')).toBe('0');
    press(glyph, 'Enter');
    expect(hass.callService).toHaveBeenCalledWith('lock', 'unlock', { entity_id: ID.lock });
  });
});

// ── AC3 — never a false "closed" (the headline) ──────────────────────────────
describe('AC3 — last-known + staleness, never a false "closed"', () => {
  test('a STALE last-known closure keeps its value, is de-emphasised, and shows a staleness stamp', async () => {
    const el = await mount(makeHass(advanceNow(asleepStates())));
    const frunk = zoneByLabel(el, STRINGS.closures.zones.frunk);
    // Last-known value retained — closed, NOT unknown — but visibly stale.
    expect(frunk.classList.contains('closed')).toBe(true);
    expect(frunk.classList.contains('unknown')).toBe(false);
    expect(frunk.classList.contains('stale')).toBe(true);
    // The honest staleness stamp renders in the dim token (assert the class).
    const note = sr(el).querySelector('.stale-note')!;
    expect(note).not.toBeNull();
    expect(note.classList.contains('tc-stale-copy')).toBe(true);
    expect(note.textContent).toContain(STRINGS.hero.updatedPrefix); // "updated 50m ago"
    // The status line never claims "All closed" on unconfirmable data.
    expect(statusText(el)).not.toContain(STRINGS.closures.allClosed);
  });

  test('an UNAVAILABLE closure renders `unknown` (neutral, NOT closed) and blocks "All closed"', async () => {
    // Make nothing open so the only honesty lever is the unavailable sunroof.
    const states = awakeStates();
    states[ID.doorFL].state = 'off';
    states[ID.chargePort].state = 'closed';
    // sunroof stays 'unavailable' in the awake fixture.
    const el = await mount(makeHass(states));
    const sunroof = zoneByLabel(el, STRINGS.closures.zones.sunroof);
    expect(sunroof.classList.contains('unknown')).toBe(true);
    expect(sunroof.classList.contains('closed')).toBe(false); // never the confident closed look
    expect(sunroof.classList.contains('na')).toBe(true); // dimmed + pointer-events:none
    expect(sunroof.getAttribute('tabindex')).not.toBe('0'); // dead control, not focusable
    expect(sunroof.getAttribute('aria-label')).toBe(
      `${STRINGS.closures.zones.sunroof}, ${STRINGS.closures.unknownWord}`
    );
    // Status surfaces the unconfirmed state, never a false "All closed".
    expect(statusText(el)).toContain(STRINGS.closures.someUnconfirmed);
    expect(statusText(el)).not.toContain(STRINGS.closures.allClosed);
  });

  test('a stale-but-closed "All closed" is NOT painted confident green (no green Closed on stale data)', async () => {
    // Everything closed + lock locked, but every read is back-dated 50m → stale
    // last-known. The text claim "All closed" is spec-permitted, but the tone must
    // NOT be the confident green ('good') — that is the named UX-DR18 failure.
    const states = advanceNow(awakeStates());
    delete states[ID.sunroof]; // absent → no `unknown` forcing "Some unconfirmed"
    states[ID.doorFL].state = 'off'; // awake fixture leaves FL on; close it
    states[ID.chargePort].state = 'closed'; // awake fixture leaves it open; close it
    const el = await mount(makeHass(states));
    expect(statusText(el)).toContain(STRINGS.closures.allClosed); // text claim stays
    expect(sr(el).querySelector('.status.good')).toBeNull(); // but NEVER confident green on stale
    expect(sr(el).querySelector('.status.dim')).not.toBeNull(); // honestly de-emphasised
    expect(sr(el).querySelector('.stale-note')).not.toBeNull(); // + the "updated Nm ago" stamp
  });

  test('a fully-asleep car renders without throwing and never claims "All closed"', async () => {
    const el = await mount(makeHass(advanceNow(asleepStates())));
    expect(sr(el).querySelector('.wrap')).not.toBeNull();
    expect(statusText(el)).not.toContain(STRINGS.closures.allClosed);
  });

  test('an UNAVAILABLE lock reads NEUTRAL, never a confident "Unlocked"', async () => {
    const states = awakeStates();
    states[ID.lock].state = 'unavailable';
    states[ID.doorFL].state = 'off'; // nothing open → the status surfaces the lock word
    states[ID.chargePort].state = 'closed';
    const el = await mount(makeHass(states));
    expect(pills(el)[0].disabled).toBe(true);
    expect(pills(el)[0].textContent).toContain(STRINGS.closures.lockUnavailable);
    expect(statusText(el)).toContain(STRINGS.closures.lockUnavailable);
    expect(statusText(el)).not.toContain(STRINGS.status.unlocked);
  });
});

// ── Coverage gaps surfaced by the QA E2E pass (each closes an unpinned AC path) ─
// The baseline pinned closed→open actuation, the never-false-closed model and the
// keyboard floor. These add the still-unpinned branches the ACs name explicitly:
// the toggle's CLOSE direction, AC1's "coloured by state", the truly-inert dead
// control, FR-24 absent-entity hiding, the vent label flip, and the status OPEN path.
describe('QA coverage gaps — AC1/AC2/AC3 unpinned branches', () => {
  const innerStyle = (z: SVGGElement) =>
    z.querySelector('rect, path, circle, polygon')!.getAttribute('style') ?? '';

  test('AC1 — a tappable zone toggles in the CLOSE direction (open cover → close_cover)', async () => {
    const hass = makeHass(awakeStates()); // charge_port is OPEN in the awake fixture
    const el = await mount(hass);
    click(zoneByLabel(el, STRINGS.closures.zones.chargePort));
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('cover', 'close_cover', {
      entity_id: ID.chargePort,
    });
  });

  test('AC1 — zones are coloured by state: an OPEN zone carries its accent, a CLOSED zone the neutral surface', async () => {
    const el = await mount(makeHass(awakeStates()));
    // charge_port (glass/blue) is open → accent fill; frunk is closed → neutral surface.
    expect(innerStyle(zoneByLabel(el, STRINGS.closures.zones.chargePort))).toContain('var(--tc-blue');
    expect(innerStyle(zoneByLabel(el, STRINGS.closures.zones.frunk))).toContain('--tc-surface-2');
  });

  test('AC1/FR-24 — an UNAVAILABLE zone is truly inert: a click actuates nothing', async () => {
    const hass = makeHass(awakeStates()); // sunroof is unavailable
    const el = await mount(hass);
    click(zoneByLabel(el, STRINGS.closures.zones.sunroof)); // dead control, not just CSS-disabled
    expect(hass.callService).not.toHaveBeenCalled();
  });

  test('FR-24 — an ABSENT sunroof entity hides its zone (four zones, nothing thrown)', async () => {
    const states = awakeStates();
    delete states[ID.sunroof]; // install without a sunroof
    const el = await mount(makeHass(states));
    expect(zones(el)).toHaveLength(4); // frunk, windows, trunk, charge-port
    expect(zoneByLabel(el, STRINGS.closures.zones.sunroof)).toBeUndefined();
    expect(sr(el).querySelector('.wrap')).not.toBeNull();
  });

  test('AC2 — the vent pill flips to "Close Windows" when windows are open and toggles closed', async () => {
    const states = awakeStates();
    states[ID.windows].state = 'open';
    const hass = makeHass(states);
    const el = await mount(hass);
    expect(pills(el)[1].textContent).toContain(STRINGS.closures.closeWindows);
    click(pills(el)[1]);
    expect(hass.callService).toHaveBeenCalledTimes(1);
    expect(hass.callService).toHaveBeenCalledWith('cover', 'close_cover', { entity_id: ID.windows });
  });

  test('AC3 — the status OPEN path: an open closure surfaces "Open:" in the warn tone, never "All closed"', async () => {
    // The awake fixture has door_fl on + charge_port open → the status reports openings.
    const el = await mount(makeHass(awakeStates()));
    expect(statusText(el)).toContain(STRINGS.closures.openPrefix);
    expect(statusText(el)).not.toContain(STRINGS.closures.allClosed);
    expect(sr(el).querySelector('.status.warn')).not.toBeNull();
  });
});
