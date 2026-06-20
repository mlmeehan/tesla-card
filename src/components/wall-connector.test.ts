// @vitest-environment jsdom
//
// Element-level gate for the `tc-wall-connector` card (Story 6.3, the fifth/final
// Epic-6 ecosystem card). See solar.test.ts / powerwall.test.ts for the
// fixture/freshness method. Focus: AC4 — the honest three-state classification
// (available / connected / charging) read DIRECTLY from the raw WC sensors with
// the 0.05 kW deadband; plus the teal accent, power/session tiles, honest
// staleness stamp, calm empty state, and standalone registration (AC1–AC3).
import { afterEach, describe, expect, test } from 'vitest';
import './wall-connector';
import { accentVar } from './ecosystem-card';
import { resolveEnergyEntities } from '../data/energy';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import allUnresolvedFx from '../fixtures/all-unresolved.json';
import detailFx from '../fixtures/energy-detail.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

const CONFIG: TeslaCardConfig = { type: 'custom:tesla-card' };
/** 50 min after the fixtures' single stamp instant — past the 30-min asleep window. */
const ADVANCED_NOW = '2026-06-15T15:31:00Z';

type Card = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  setConfig(c: TeslaCardConfig): void;
  getCardSize(): number;
  updateComplete: Promise<boolean>;
};

function states(fx: { states: Record<string, HassEntity> }): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(fx.states)) as Record<string, HassEntity>;
}
function makeHass(s: Record<string, HassEntity>): HomeAssistant {
  return { states: s } as unknown as HomeAssistant;
}
/** Advance the HA time base so a fresh-stamped WC read back-dates into stale. */
function advanceNow(s: Record<string, HassEntity>): Record<string, HassEntity> {
  s[DEFAULT_ENTITIES.odometer].last_updated = ADVANCED_NOW;
  s[DEFAULT_ENTITIES.odometer].last_changed = ADVANCED_NOW;
  return s;
}
async function mount(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig = CONFIG
): Promise<Card> {
  const el = document.createElement('tc-wall-connector') as Card;
  if (hass) el.hass = hass;
  el.setConfig(config);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const sr = (el: Card) => el.shadowRoot!;
/** Derived state + tile labels rendered as statTile keys (precise — avoids substring traps). */
const statLabels = (el: Card) =>
  [...sr(el).querySelectorAll('.stat .k')].map((n) => (n.textContent ?? '').trim());

/** Resolve the WC entity ids from a fixture so tests mutate real resolved ids, not literals. */
function wcIds(s: Record<string, HassEntity>) {
  return resolveEnergyEntities(makeHass(s), CONFIG);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC1 — resolves WC state/power/session, renders the shell, teal accent', () => {
  test('renders the surface with the teal accent and the power + session values', async () => {
    // model-y-awake: total_power=7.4, session_energy=12.5, vehicle_connected=on, status=charging.
    const el = await mount(makeHass(states(awakeFx)));
    const surface = sr(el).querySelector<HTMLElement>('.surface')!;
    expect(surface).not.toBeNull();
    const style = surface.getAttribute('style') ?? '';
    expect(style).toContain(accentVar('teal'));
    const text = sr(el).textContent ?? '';
    expect(text).toContain('7.4'); // power kW
    expect(text).toContain('12.5'); // session kWh
    expect(text).not.toContain('NaN');
  });
});

describe('AC2 — graceful degradation + honest staleness', () => {
  test('all WC entities absent → calm empty sentence, no throw, no fabricated number', async () => {
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.eco-empty')!.textContent).toContain(
      STRINGS.ecosystem.wallConnector.empty
    );
    expect(sr(el).textContent ?? '').not.toContain('NaN');
    // Never a fabricated zero readout: the empty state renders no stat tiles at all.
    expect(sr(el).querySelectorAll('.stat')).toHaveLength(0);
  });

  test('stale WC → last-known value kept AND a .tc-stale-copy "updated …" stamp', async () => {
    // Back-date the time base (referenceNow = max stamp) so the WC reads go stale:
    // last-known power retained + an honest stamp, never overstated as fresh.
    const el = await mount(makeHass(advanceNow(states(awakeFx))));
    expect(sr(el).textContent ?? '').toContain('7.4'); // last-known power retained
    const stamp = sr(el).querySelector('.eco-stamp');
    expect(stamp).not.toBeNull();
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('AC3 — standalone registered element, shared-hass-only interlink', () => {
  test('tc-wall-connector is defined; getCardSize is a number; customCards entry present', async () => {
    expect(customElements.get('tc-wall-connector')).toBeDefined();
    const el = await mount(makeHass(states(awakeFx)));
    expect(typeof el.getCardSize()).toBe('number');
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', unknown_future_key: 1 } as TeslaCardConfig)
    ).not.toThrow();
    expect((window.customCards ?? []).find((c) => c.type === 'tc-wall-connector')).toBeTruthy();
  });

  test('emits no peer-directed bus/channel/broadcast event (interlink is shared hass only)', async () => {
    // FR-32 structural assertion: the card coordinates solely via shared `hass`,
    // never an inter-card event bus / peer-directed dispatchEvent.
    const el = await mount(makeHass(states(awakeFx)));
    const dispatched: string[] = [];
    const orig = el.dispatchEvent.bind(el);
    el.dispatchEvent = (ev: Event) => {
      dispatched.push(ev.type);
      return orig(ev);
    };
    el.hass = makeHass(states(awakeFx)); // force a reactive update
    await el.updateComplete;
    expect(dispatched.filter((t) => /bus|channel|broadcast|peer/i.test(t))).toEqual([]);
  });
});

describe('AC4 — honest three-state classification (raw reads, 0.05 kW deadband)', () => {
  test('wc_power above the deadband → "charging"', async () => {
    const s = states(awakeFx); // total_power = 7.4 (> 0.05)
    const el = await mount(makeHass(s));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.wallConnector.charging);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.available);
  });

  test('no power draw but plugged (wc_connected = on) → "connected"', async () => {
    const s = states(awakeFx);
    const ids = wcIds(s);
    s[ids.wc_power!].state = '0.0'; // not drawing
    s[ids.wc_connected!].state = 'on'; // but plugged
    const el = await mount(makeHass(s));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.wallConnector.connected);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.charging);
  });

  test('unplugged (wc_connected = off, no plugged status) → "available"', async () => {
    const s = states(awakeFx);
    const ids = wcIds(s);
    s[ids.wc_power!].state = '0.0';
    s[ids.wc_connected!].state = 'off';
    s[ids.wc_status!].state = 'unavailable'; // neutralize the status plug-hint
    const el = await mount(makeHass(s));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.wallConnector.available);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.charging);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.connected);
  });

  test('a sub-deadband wc_power reads as NOT charging (jitter ≠ a charging flicker)', async () => {
    const s = states(awakeFx);
    const ids = wcIds(s);
    s[ids.wc_power!].state = '0.02'; // below the 0.05 kW deadband
    const el = await mount(makeHass(s));
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.charging);
  });

  test('status-only plug hint (wc_connected absent, plugged wc_status) → "connected"', async () => {
    // Isolates the secondary `statusPlugged` branch: the binary plug sensor is gone
    // (unavailable → undefined), so ONLY a non-disconnected `wc_status` can drive
    // "connected". A regression that dropped the status-hint branch fails here.
    const s = states(awakeFx);
    const ids = wcIds(s);
    s[ids.wc_power!].state = '0.0'; // not drawing
    s[ids.wc_connected!].state = 'unavailable'; // no binary plug signal at all
    s[ids.wc_status!].state = 'connected'; // a plugged status (not in DISCONNECTED_STATUSES)
    const el = await mount(makeHass(s));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.wallConnector.connected);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.charging);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.available);
  });

  test('a DISCONNECTED_STATUSES value is NOT treated as plugged → "available"', async () => {
    // Pins the denylist itself: a disconnected status must not false-read as a plug
    // hint, even when the binary plug sensor is also absent.
    const s = states(awakeFx);
    const ids = wcIds(s);
    s[ids.wc_power!].state = '0.0';
    s[ids.wc_connected!].state = 'off';
    s[ids.wc_status!].state = 'disconnected'; // explicit denylist member
    const el = await mount(makeHass(s));
    expect(statLabels(el)).toContain(STRINGS.ecosystem.wallConnector.available);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.connected);
    expect(statLabels(el)).not.toContain(STRINGS.ecosystem.wallConnector.charging);
  });
});

describe('Story 8.1 — detail layout: V/Hz/° measurement tiles (live units), deep-link', () => {
  test('AC2 — present measurements render with the entity\'s OWN unit (°F here, never assumed)', async () => {
    const el = await mount(makeHass(states(detailFx)));
    const txt = sr(el).textContent ?? '';
    expect(txt).toContain(STRINGS.ecosystem.wallConnector.voltage);
    expect(txt).toContain('238'); // grid_voltage value
    expect(txt).toContain('V');
    expect(txt).toContain(STRINGS.ecosystem.wallConnector.frequency);
    expect(txt).toContain('59.9');
    expect(txt).toContain('Hz');
    expect(txt).toContain(STRINGS.ecosystem.wallConnector.temperature);
    expect(txt).toContain('°F'); // live unit read from the entity, not a baked °C
  });

  test('AC2 — absent measurements hide their tiles; the lead state/power still renders', async () => {
    const el = await mount(makeHass(states(awakeFx))); // no wc voltage/frequency/temperature
    const txt = sr(el).textContent ?? '';
    expect(txt).not.toContain(STRINGS.ecosystem.wallConnector.voltage);
    expect(txt).not.toContain('NaN');
    expect(sr(el).querySelector('.stat')).not.toBeNull();
  });

  test('AC1/AC4 — deep-link present on live, absent on calm empty; AC3 — no write control', async () => {
    const live = await mount(makeHass(states(detailFx)));
    expect(sr(live).querySelector('.eco-deeplink')).not.toBeNull();
    expect(sr(live).querySelector('input, select, tc-slider, [role="switch"], [role="slider"]')).toBeNull();
    const empty = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(empty).querySelector('.eco-deeplink')).toBeNull();
  });
});

describe('AC1/AC2 — partial presence: hide-when-missing, never a fabricated reading', () => {
  test('only wc_session present → session tile renders, no fabricated 0 kW power tile, not empty', async () => {
    // A WC reporting session energy but no live power must NOT invent a `0 kW`
    // power tile (hide-when-missing), must NOT fall to the calm empty state (one
    // read resolved), and must never show NaN.
    const s = states(awakeFx);
    const ids = wcIds(s);
    s[ids.wc_power!].state = 'unavailable';
    s[ids.wc_status!].state = 'unavailable';
    s[ids.wc_connected!].state = 'unavailable';
    const el = await mount(makeHass(s));
    expect(sr(el).querySelector('.eco-empty')).toBeNull(); // not the empty state
    expect(statLabels(el)).toContain(STRINGS.energy.session); // session tile present
    expect(statLabels(el)).not.toContain(STRINGS.energy.nodes.wall_connector); // no power tile
    // Read rendered tile VALUES precisely (not shadow textContent, which in jsdom
    // also contains the stylesheet text — the shell CSS comment mentions "0 kW").
    const values = [...sr(el).querySelectorAll('.stat .v')].map((n) => (n.textContent ?? '').trim());
    expect(values).toContain('12.5 kWh'); // last-known session retained
    expect(values.some((v) => /\bkW\b/.test(v))).toBe(false); // no fabricated power (kW) readout
    expect(values.some((v) => v.includes('NaN'))).toBe(false);
  });
});
