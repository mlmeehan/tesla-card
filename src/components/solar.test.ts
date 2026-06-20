// @vitest-environment jsdom
//
// Element-level gate for the `tc-solar` card (Story 6.2). Drives the registered
// element with fixture `hass` objects and pins the story ACs as regressions:
//   AC1 — resolves solar_power by function-name (real data/ resolution), renders
//         the .surface shell with the amber source-node accent + the value.
//   AC2 — absent → calm empty sentence (no throw / no fabricated 0); stale → the
//         last-known value PLUS a .tc-stale-copy "updated …" stamp.
//   AC3 — registered standalone custom element + LovelaceCard contract +
//         window.customCards entry; setConfig tolerates an unknown key.
// Plus the cross-card interlink contract (shared hass only — FR-32): two
// instances agree and emit no peer-directed CustomEvent.
//
// Freshness is deterministic by injection (mirrors ecosystem-card.test.ts):
// every fixture entity shares one stamp instant, so back-dating the read (by
// advancing ANOTHER entity's last_updated → referenceNow = max stamp) forces a
// stale classification. Energy ids are never inlined — they come from real
// resolveEnergyEntities resolution over the fixture corpus.
import { afterEach, describe, expect, test } from 'vitest';
import './solar';
import './home';
import { accentVar } from './ecosystem-card';
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
/** Advance the HA time base so a fresh-stamped read back-dates into stale. */
function advanceNow(s: Record<string, HassEntity>): Record<string, HassEntity> {
  s[DEFAULT_ENTITIES.odometer].last_updated = ADVANCED_NOW;
  s[DEFAULT_ENTITIES.odometer].last_changed = ADVANCED_NOW;
  return s;
}
/**
 * Inject an HA-core entity (a weather/sun state) into a states map. These are HA
 * core ids (NOT Tesla function-slugs) read by literal default — using the literal
 * `weather.home`/`sun.sun` here is correct, not a hard-coded-entity violation.
 */
function withState(
  s: Record<string, HassEntity>,
  id: string,
  state: string
): Record<string, HassEntity> {
  s[id] = {
    entity_id: id,
    state,
    attributes: {},
    last_changed: '2026-06-15T14:41:00Z',
    last_updated: '2026-06-15T14:41:00Z',
  } as unknown as HassEntity;
  return s;
}
async function mount(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig = CONFIG,
  tag = 'tc-solar'
): Promise<Card> {
  const el = document.createElement(tag) as Card;
  if (hass) el.hass = hass;
  el.setConfig(config);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const sr = (el: Card) => el.shadowRoot!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC1 — resolves by function-name, renders the shell + value, amber accent', () => {
  test('mounts with an energy fixture → renders the .surface shell with the solar value', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const surface = sr(el).querySelector<HTMLElement>('.surface');
    expect(surface).not.toBeNull();
    expect(surface!.classList.contains('eco-card')).toBe(true);
    // solar_power resolves to my_home_solar_power_2 = 6.0 → "6.0 kW" rendered.
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('6.0');
  });

  test('the source-node accent is amber (mirrors the Scene NODE_COLOR.solar)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const style = sr(el).querySelector<HTMLElement>('.surface')!.getAttribute('style') ?? '';
    expect(style).toContain('--node-accent');
    expect(style).toContain(accentVar('amber'));
  });
});

describe('AC2 — graceful degradation: calm empty on absent, last-known + stamp on stale', () => {
  test('absent solar → calm empty sentence, no .stat, no NaN, no throw', async () => {
    // all-unresolved fixture has no energy sensors → solar_power unresolved.
    const el = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(el).querySelector('.surface')).not.toBeNull();
    expect(sr(el).querySelector('.stat')).toBeNull();
    expect(sr(el).querySelector('.eco-empty')!.textContent).toContain(
      STRINGS.ecosystem.solar.empty
    );
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('stale solar → last-known value kept AND a .tc-stale-copy "updated …" stamp', async () => {
    const s = advanceNow(states(awakeFx));
    const el = await mount(makeHass(s));
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain('6.0'); // last-known retained
    const stamp = sr(el).querySelector('.eco-stamp');
    expect(stamp).not.toBeNull();
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('AC3 — standalone registered custom element + LovelaceCard contract', () => {
  test('tc-solar is a defined custom element', () => {
    expect(customElements.get('tc-solar')).toBeDefined();
  });

  test('setConfig accepts a minimal config and tolerates an unknown key; getCardSize is a number', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(() =>
      el.setConfig({ type: 'custom:tesla-card', unknown_future_key: 1 } as TeslaCardConfig)
    ).not.toThrow();
    expect(typeof el.getCardSize()).toBe('number');
  });

  test('setConfig throws only on a falsy config', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(() => el.setConfig(undefined as unknown as TeslaCardConfig)).toThrow();
  });

  test('window.customCards contains the tc-solar picker entry', () => {
    const entry = (window.customCards ?? []).find((c) => c.type === 'tc-solar');
    expect(entry).toBeTruthy();
    expect(entry!.name).toBe(STRINGS.energy.nodes.solar);
  });
});

describe('Story 6.4 — live weather vignette (AC1/AC2/AC4)', () => {
  test('AC1 — weather + sun + a real reading → the vignette SVG renders ABOVE the production tile', async () => {
    const s = withState(withState(states(awakeFx), 'weather.home', 'partlycloudy'), 'sun.sun', 'above_horizon');
    const el = await mount(makeHass(s));
    const art = sr(el).querySelector('.wx-art');
    expect(art).not.toBeNull(); // vignette present
    expect(sr(el).querySelector('.stat')).not.toBeNull(); // production tile present
    // Story 8.1: the vignette is Solar's hero-art slot (`.eco-hero`), and the
    // production tile sits in the lead readout row below it.
    const hero = sr(el).querySelector('.eco-hero')!;
    expect(hero.querySelector('.wx')).not.toBeNull();
    const wx = sr(el).querySelector('.wx')!;
    const stat = sr(el).querySelector('.stat')!;
    // compareDocumentPosition: FOLLOWING (4) ⇒ stat comes after the vignette.
    expect(wx.compareDocumentPosition(stat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('AC2 — provenance chip names the real default sources (weather.home · sun.sun)', async () => {
    const s = withState(withState(states(awakeFx), 'weather.home', 'rainy'), 'sun.sun', 'above_horizon');
    const el = await mount(makeHass(s));
    expect(sr(el).querySelector('.wx-pre')!.textContent).toContain('weather.home · sun.sun');
  });

  test('AC2 — an entity override is reflected honestly (no hard-coded literal)', async () => {
    const s = withState(withState(states(awakeFx), 'weather.backyard', 'cloudy'), 'sun.sun', 'above_horizon');
    const el = await mount(makeHass(s), { ...CONFIG, weather: { entity: 'weather.backyard', sun: 'sun.sun' } });
    const chip = sr(el).querySelector('.wx-pre')!.textContent ?? '';
    expect(chip).toContain('weather.backyard · sun.sun');
    expect(chip).not.toContain('weather.home'); // never a lying literal
  });

  test('AC4 — solar present but NO weather → production tile renders, vignette absent, no throw', async () => {
    // awakeFx carries no weather.home/sun.sun → condition undefined → omit.
    const el = await mount(makeHass(states(awakeFx)));
    expect(sr(el).querySelector('.stat')).not.toBeNull();
    expect(sr(el).querySelector('.wx-art')).toBeNull(); // no fabricated sky
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('AC4 — config.weather.hide suppresses the vignette even when weather is present', async () => {
    const s = withState(withState(states(awakeFx), 'weather.home', 'sunny'), 'sun.sun', 'above_horizon');
    const el = await mount(makeHass(s), { ...CONFIG, weather: { hide: true } });
    expect(sr(el).querySelector('.stat')).not.toBeNull();
    expect(sr(el).querySelector('.wx-art')).toBeNull();
  });

  test('AC1 — sun.sun below_horizon drives the night treatment (sunny → clear night)', async () => {
    // The night branch of `isDay = sunState !== "below_horizon"` (solar.ts) was
    // only ever exercised with above_horizon — pin the night path end-to-end.
    const s = withState(withState(states(awakeFx), 'weather.home', 'sunny'), 'sun.sun', 'below_horizon');
    const el = await mount(makeHass(s));
    const art = sr(el).querySelector('.wx-art');
    expect(art).not.toBeNull();
    // `sunny` at night resolves to clear-night → aria-label is the night name.
    expect(art!.getAttribute('aria-label')).toBe(STRINGS.ecosystem.solar.weather.names['clear-night']);
  });

  test('AC4 — sun.sun absent → deterministic DAY fallback, vignette renders, no throw', async () => {
    // Weather present, no sun.sun → ambiguous day/night must default to day
    // (above_horizon/absent ⇒ day) and render without crashing.
    const s = withState(states(awakeFx), 'weather.home', 'cloudy');
    const el = await mount(makeHass(s));
    expect(sr(el).querySelector('.wx-art')).not.toBeNull();
    expect(sr(el).querySelector('.stat')).not.toBeNull();
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('AC4 — clear-night night-inference holds with sun.sun absent (a night-only condition implies night)', async () => {
    // `clear-night` is intrinsically a night condition: even with no sun.sun (so
    // isDay defaults true) the moon treatment must win, not a degenerate day sky.
    const s = withState(states(awakeFx), 'weather.home', 'clear-night');
    const el = await mount(makeHass(s));
    const art = sr(el).querySelector('.wx-art');
    expect(art).not.toBeNull();
    expect(art!.getAttribute('aria-label')).toBe(STRINGS.ecosystem.solar.weather.names['clear-night']);
  });

  test.each(['unavailable', 'unknown'])(
    'AC4 — %s weather → vignette OMITTED (never a fabricated sky), production tile still renders',
    async (sentinel) => {
      // readRaw returns the literal sentinel string (it IS a string) — the helper
      // must omit, not fall through weatherScene to a fabricated cloudy sky.
      const s = withState(withState(states(awakeFx), 'weather.home', sentinel), 'sun.sun', 'above_horizon');
      const el = await mount(makeHass(s));
      expect(sr(el).querySelector('.stat')).not.toBeNull();
      expect(sr(el).querySelector('.wx-art')).toBeNull();
      expect(sr(el).textContent ?? '').not.toContain('NaN');
    }
  );

  test('AC4 — stale-but-present weather keeps last-known art with NO age stamp on the vignette (media-inverse rule)', async () => {
    // A stale sky is honest context, not a broken read — the vignette has no
    // "updated Nm ago" stamp on its art. advanceNow back-dates the reads so the
    // production tile DOES carry a shell stamp; assert that stamp is NOT inside .wx.
    const s = withState(withState(advanceNow(states(awakeFx)), 'weather.home', 'rainy'), 'sun.sun', 'above_horizon');
    const el = await mount(makeHass(s));
    const wx = sr(el).querySelector('.wx');
    expect(wx).not.toBeNull(); // last-known condition still shown
    expect(wx!.querySelector('.wx-art')).not.toBeNull();
    // The production-tile stamp lives in the shell, NOT in the vignette subtree.
    expect(sr(el).querySelector('.eco-stamp')).not.toBeNull();
    expect(wx!.querySelector('.eco-stamp')).toBeNull();
    expect(wx!.querySelector('.tc-stale-copy')).toBeNull();
    expect(wx!.textContent ?? '').not.toContain(STRINGS.hero.updatedPrefix);
  });
});

describe('Story 8.2 — Solar keeps its weather vignette hero (NO duplicate node art)', () => {
  test('the hero remains the weather vignette, never the nodeHero node art', async () => {
    const s = withState(withState(states(awakeFx), 'weather.home', 'cloudy'), 'sun.sun', 'above_horizon');
    const el = await mount(makeHass(s));
    const hero = sr(el).querySelector('.eco-hero')!;
    expect(hero.querySelector('.wx-art')).not.toBeNull(); // vignette is Solar's hero
    expect(sr(el).querySelector('.nh-art')).toBeNull(); // no per-node art on Solar
  });
});

describe('Story 8.1 — detail layout: stat grid, deep-link, sensor honesty', () => {
  test('AC2 — present telemetry renders its tile (Generated / Exported), values shown', async () => {
    const el = await mount(makeHass(states(detailFx)));
    const txt = sr(el).textContent ?? '';
    expect(txt).toContain(STRINGS.ecosystem.solar.generated);
    expect(txt).toContain('15.7'); // solar_generated value (kWh)
    expect(txt).toContain(STRINGS.ecosystem.solar.exported);
  });

  test('AC2 — absent telemetry hides its tile (no blank, no fabricated 0), lead still renders', async () => {
    // awakeFx has solar_power but NO solar_generated/solar_exported → tiles hide.
    const el = await mount(makeHass(states(awakeFx)));
    const txt = sr(el).textContent ?? '';
    expect(sr(el).querySelector('.stat')).not.toBeNull(); // lead production tile present
    expect(txt).not.toContain(STRINGS.ecosystem.solar.generated);
    expect(txt).not.toContain('NaN');
  });

  test('AC1 — the deep-link chip is present on the live layout, absent on calm empty', async () => {
    const live = await mount(makeHass(states(detailFx)));
    expect(sr(live).querySelector('.eco-deeplink')).not.toBeNull();
    const empty = await mount(makeHass(states(allUnresolvedFx)));
    expect(sr(empty).querySelector('.eco-deeplink')).toBeNull();
  });

  test('AC3 — Solar is a Sensor: NO write control (no input/select/slider/switch)', async () => {
    const el = await mount(makeHass(states(detailFx)));
    expect(sr(el).querySelector('input, select, tc-slider, [role="switch"], [role="slider"]')).toBeNull();
    expect(sr(el).querySelector('.eco-kind')!.textContent).toContain(STRINGS.ecosystem.sensorTag);
  });
});

describe('cross-card interlink — shared hass only (FR-32)', () => {
  test('two cards sharing one hass agree on state', async () => {
    const hass = makeHass(states(awakeFx));
    const a = await mount(hass, CONFIG, 'tc-solar');
    const b = await mount(hass, CONFIG, 'tc-home');
    // Both resolve independently from the same shared hass — solar vs home values
    // both present and non-empty (coherence is the shared hass, not a message).
    expect(a.shadowRoot!.querySelector('.stat .v')!.textContent).toContain('6.0'); // solar
    expect(b.shadowRoot!.querySelector('.stat .v')!.textContent).toContain('1.0'); // home load
  });

  test('neither card emits a peer-directed CustomEvent during render', async () => {
    const dispatched: Event[] = [];
    const orig = HTMLElement.prototype.dispatchEvent;
    HTMLElement.prototype.dispatchEvent = function (this: HTMLElement, ev: Event): boolean {
      dispatched.push(ev);
      return orig.call(this, ev);
    };
    try {
      const hass = makeHass(states(awakeFx));
      await mount(hass, CONFIG, 'tc-solar');
      await mount(hass, CONFIG, 'tc-home');
    } finally {
      HTMLElement.prototype.dispatchEvent = orig;
    }
    expect(dispatched.filter((e) => e instanceof CustomEvent)).toEqual([]);
  });
});
