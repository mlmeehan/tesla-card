// @vitest-environment jsdom
//
// Element-level gate for Story 3.3 (status line + tappable battery gauge). The
// Hero is the FIRST live consumer of the Epic-1 freshness read-model, so the
// crux assertion is the honest "updated Nm ago" hint — proved against an
// INJECTED, known age (never a wall-clock constant as ground truth, mirroring
// freshness.test.ts's discipline): one entity sets referenceNow()'s max, the
// backing battery_level is stamped a known span before it, and we assert the
// rendered magnitude. Also locks AC2 (gauge state semantics + blue tick +
// NaN-safety), AC3 (real <button> → open-panel{charging}) and AC4 (asleep →
// .tc-asleep + "Asleep · updated 47m ago" + battery —). jsdom opt-in like the
// other element tests; the custom element is driven via hass/config props.
// Entity ids are sourced from const.ts DEFAULT_ENTITIES (never inlined — the
// components/ hard-coded-id guard), the same registry the Hero resolves through.
import { describe, expect, test } from 'vitest';
import './hero';
import { formatAge } from '../helpers';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

type HeroEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

/** A fixed server reference instant — the MAX stamp across the injected states. */
const REF = Date.parse('2026-06-15T14:41:00Z');
const at = (msAgo: number): string => new Date(REF - msAgo).toISOString();

/** Default-resolved entity ids the Hero reads (via const.ts DEFAULT_ENTITIES). */
const ID = {
  status: DEFAULT_ENTITIES.status,
  battery: DEFAULT_ENTITIES.battery_level,
  range: DEFAULT_ENTITIES.battery_range,
  charging: DEFAULT_ENTITIES.charging_status,
  limit: DEFAULT_ENTITIES.charge_limit,
  lock: DEFAULT_ENTITIES.lock,
  shift: DEFAULT_ENTITIES.shift_state,
  power: DEFAULT_ENTITIES.charger_power,
  cable: DEFAULT_ENTITIES.charge_cable,
  ttf: DEFAULT_ENTITIES.time_to_full_charge,
} as const;

function ent(id: string, state: string, stamp?: string, attrs: Record<string, any> = {}): HassEntity {
  return { entity_id: id, state, attributes: attrs, last_updated: stamp, last_changed: stamp };
}

/**
 * Build a states map. `batteryAgeMs`/`batteryStamped` control the freshness
 * backing signal; an "anchor" entity is always stamped at REF so referenceNow()
 * resolves to REF deterministically regardless of the battery stamp.
 */
function makeStates(opts: {
  asleep?: boolean;
  battery?: string; // raw battery_level state ('unavailable' for the asleep/unknown path)
  batteryAgeMs?: number; // age of the battery stamp before REF
  batteryStamped?: boolean; // false → battery carries NO last_updated (omission path)
  charging?: boolean; // convenience: 'Charging' vs 'Disconnected' charging_status
  chargeStatus?: string; // raw charging_status override (dialect spellings, 'unknown', …)
  power?: string; // raw charger_power state (kW) — Story 3.4 live-kW read
  cable?: string; // raw charge_cable state ('on'/'off') — unknown-degrade corroboration
  ttf?: string; // raw time_to_full_charge (hours) — charging-sub fallback
  limit?: string;
  locked?: boolean;
} = {}): Record<string, HassEntity> {
  const {
    asleep = false,
    battery = '64',
    batteryAgeMs = 0,
    batteryStamped = true,
    charging = false,
    chargeStatus,
    power,
    cable,
    ttf,
    limit,
    locked = true,
  } = opts;
  const states: Record<string, HassEntity> = {
    // Anchor: always fresh at REF → referenceNow() === REF.
    [ID.status]: ent(ID.status, asleep ? 'off' : 'on', at(0)),
    [ID.lock]: ent(ID.lock, locked ? 'locked' : 'unlocked', at(0)),
    [ID.range]: ent(ID.range, asleep ? 'unavailable' : '210', at(0)),
    [ID.charging]: ent(
      ID.charging,
      chargeStatus ?? (charging ? 'Charging' : 'Disconnected'),
      at(0)
    ),
  };
  states[ID.battery] = ent(
    ID.battery,
    asleep ? 'unavailable' : battery,
    batteryStamped ? at(batteryAgeMs) : undefined
  );
  if (limit !== undefined) states[ID.limit] = ent(ID.limit, limit, at(0));
  if (power !== undefined) states[ID.power] = ent(ID.power, power, at(0));
  if (cable !== undefined) states[ID.cable] = ent(ID.cable, cable, at(0));
  if (ttf !== undefined) states[ID.ttf] = ent(ID.ttf, ttf, at(0));
  return states;
}

async function mountHero(
  states: Record<string, HassEntity>,
  configOver: Partial<TeslaCardConfig> = {}
): Promise<HeroEl> {
  const el = document.createElement('tc-hero') as HeroEl;
  el.hass = { states } as unknown as HomeAssistant;
  el.config = { type: 'custom:tesla-card', ...configOver };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const statusText = (el: HeroEl): string =>
  el.shadowRoot!.querySelector('.status')!.textContent!.replace(/\s+/g, ' ').trim();

// ───────────────────────────────────────────────────────────────────────────
// AC1 — status line: name + dot + label + honest last-updated sub-hint
// ───────────────────────────────────────────────────────────────────────────

describe('AC1 — status line: name + dot + label + last-updated sub-hint', () => {
  test('renders the vehicle name, a colour-coded dot and a label', async () => {
    const el = await mountHero(makeStates(), { name: 'Garage Model Y' });
    expect(el.shadowRoot!.querySelector('.name')!.textContent).toBe('Garage Model Y');
    expect(el.shadowRoot!.querySelector('.status .dot')).toBeTruthy();
    expect(el.shadowRoot!.querySelector('.st-label')!.textContent).toContain(STRINGS.status.parked);
  });

  test('an awake-but-stale backing entity surfaces "updated Nm ago" (injected 47m age)', async () => {
    const el = await mountHero(makeStates({ batteryAgeMs: 47 * 60_000 }));
    // Assert the RULE against the injected age, never a wall-clock constant.
    expect(statusText(el)).toContain('updated 47m ago');
  });

  test('a fresh backing entity reads "Just now" (age < 1 min), never "updated 0m ago"', async () => {
    const el = await mountHero(makeStates({ batteryAgeMs: 0 }));
    expect(statusText(el)).toContain(STRINGS.hero.justNow);
    expect(statusText(el)).not.toContain('0m ago');
  });

  test('the hint is OMITTED entirely when the backing entity carries no stamp', async () => {
    const el = await mountHero(makeStates({ batteryStamped: false }));
    const text = statusText(el);
    expect(text).not.toContain('updated');
    expect(text).not.toContain(STRINGS.hero.justNow);
    expect(text).not.toMatch(/NaN/);
  });

  // The AC enumerates FOUR labels (Charging / Driving / Parked / Asleep,
  // single-sourced from STRINGS.status.*). Parked + Asleep are locked above /
  // in AC4; these close the gap on the two motion labels and their state-coded
  // dot colours (the dot is the colour half of "a state dot (colour-coded)").
  const labelText = (el: HeroEl): string =>
    el.shadowRoot!.querySelector('.st-label')!.textContent!.trim();
  const dotStyle = (el: HeroEl): string =>
    el.shadowRoot!.querySelector('.status .dot')!.getAttribute('style') ?? '';

  test('charging → label "Charging" + green dot (single-sourced from STRINGS.status)', async () => {
    const el = await mountHero(makeStates({ charging: true }));
    expect(labelText(el)).toBe(STRINGS.status.charging);
    expect(dotStyle(el)).toContain('var(--tc-green');
  });

  test('driving (shift D) → label "Driving" + blue dot', async () => {
    const states = makeStates();
    states[ID.shift] = ent(ID.shift, 'D', at(0));
    const el = await mountHero(states);
    expect(labelText(el)).toBe(STRINGS.status.driving);
    expect(dotStyle(el)).toContain('var(--tc-blue');
  });

  test('the rendered hint composes coarser magnitudes too (injected 2h age → "updated 2h ago")', async () => {
    const el = await mountHero(makeStates({ batteryAgeMs: 2 * 60 * 60_000 }));
    expect(statusText(el)).toContain('updated 2h ago');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — state-driven battery gauge, NaN-safe, blue limit tick
// ───────────────────────────────────────────────────────────────────────────

const gaugeClass = (el: HeroEl): string =>
  el.shadowRoot!.querySelector('.tc-bat')!.className;
const batReadout = (el: HeroEl): string =>
  el.shadowRoot!.querySelector('.bat-pct')!.textContent!.replace(/\s+/g, ' ').trim();

describe('AC2 — battery gauge state semantics + blue tick + NaN-safety', () => {
  test('low ≤20% → .low (boundary: 20 classifies low, not mid)', async () => {
    expect(gaugeClass(await mountHero(makeStates({ battery: '20' })))).toContain('low');
    expect(gaugeClass(await mountHero(makeStates({ battery: '21' })))).toContain('mid');
  });

  test('mid ≤50% → .mid (boundary: 50 classifies mid, not high)', async () => {
    expect(gaugeClass(await mountHero(makeStates({ battery: '50' })))).toContain('mid');
    expect(gaugeClass(await mountHero(makeStates({ battery: '51' })))).toContain('high');
  });

  test('high → .high; charging overrides the band (15% charging = charging, not low)', async () => {
    expect(gaugeClass(await mountHero(makeStates({ battery: '90' })))).toContain('high');
    const charging = await mountHero(makeStates({ battery: '15', charging: true }));
    expect(gaugeClass(charging)).toContain('charging');
    expect(gaugeClass(charging)).not.toContain('low');
  });

  test('blue limit tick renders when a charge-limit is present', async () => {
    const el = await mountHero(makeStates({ battery: '64', limit: '80' }));
    expect(el.shadowRoot!.querySelector('.tc-bat-limit')).toBeTruthy();
  });

  test('NaN-safe: unavailable battery → .unknown gauge + "—" readout, never NaN/full bar', async () => {
    const el = await mountHero(makeStates({ asleep: true }));
    expect(gaugeClass(el)).toContain('unknown');
    expect(batReadout(el)).toBe('—');
    // Gauge fill width is 0 for an unknown percent (never a misleading full bar).
    expect(el.shadowRoot!.querySelector<HTMLElement>('.tc-bat-fill')!.style.width).toBe('0%');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC3 — tappable battery row → charging-panel intent (real <button>)
// ───────────────────────────────────────────────────────────────────────────

describe('AC3 — battery row is a real <button> dispatching open-panel{charging}', () => {
  test('the battery row is a <button> with a state-bearing aria-label (charge + action)', async () => {
    const el = await mountHero(makeStates({ battery: '64' }));
    const btn = el.shadowRoot!.querySelector('.battery');
    expect(btn?.tagName).toBe('BUTTON');
    // EXPERIENCE.md:176 — "Battery 64%, opens charging": the SETTLED percent + the
    // action, single-sourced from STRINGS (units/glyph glue at the call site).
    const label = btn!.getAttribute('aria-label')!;
    expect(label).toContain(STRINGS.hero.battery);
    expect(label).toContain('64%');
    expect(label).toContain(STRINGS.hero.opensCharging);
  });

  test('aria-label degrades to the action-only label when the percent is unknown (asleep)', async () => {
    const el = await mountHero(makeStates({ asleep: true }));
    // No number to overstate → the action-only fallback, never "Battery NaN%".
    expect(el.shadowRoot!.querySelector('.battery')!.getAttribute('aria-label')).toBe(
      STRINGS.hero.openCharging
    );
  });

  test('clicking it dispatches a bubbling+composed open-panel CustomEvent with {panel:"charging"}', async () => {
    const el = await mountHero(makeStates());
    let detail: { panel?: string } | undefined;
    let composed = false;
    let bubbles = false;
    el.addEventListener('open-panel', (e) => {
      const ce = e as CustomEvent<{ panel: string }>;
      detail = ce.detail;
      composed = ce.composed;
      bubbles = ce.bubbles;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>('.battery')!.click();
    expect(detail).toEqual({ panel: 'charging' });
    expect(composed).toBe(true);
    expect(bubbles).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 — asleep/stale → dim + grayscale, honest hint, battery —
// ───────────────────────────────────────────────────────────────────────────

describe('AC4 — asleep: shared .tc-asleep recipe + "Asleep · updated 47m ago" + battery —', () => {
  test('asleep render adopts the shared .tc-asleep recipe (not a bespoke treatment)', async () => {
    const asleep = await mountHero(makeStates({ asleep: true, batteryAgeMs: 47 * 60_000 }));
    expect(asleep.shadowRoot!.querySelector('.car-stage')!.classList.contains('tc-asleep')).toBe(true);
    // Awake never carries the recipe.
    const awake = await mountHero(makeStates());
    expect(awake.shadowRoot!.querySelector('.car-stage')!.classList.contains('tc-asleep')).toBe(false);
  });

  test('status reads "Asleep · updated 47m ago" — drive-state + last-updated, never "Offline"', async () => {
    const el = await mountHero(makeStates({ asleep: true, batteryAgeMs: 47 * 60_000 }));
    const text = statusText(el);
    expect(text).toContain(STRINGS.status.asleep);
    expect(text).toContain('updated 47m ago');
    expect(text).not.toMatch(/Offline|No connection/i);
  });

  test('asleep with no stamp falls back to the wake affordance, never a fabricated time', async () => {
    const el = await mountHero(makeStates({ asleep: true, batteryStamped: false }));
    const text = statusText(el);
    expect(text).toContain(STRINGS.hero.tapToWake);
    expect(text).not.toContain('updated');
  });

  test('battery shows "—" (readout + neutral gauge), never a stale number', async () => {
    const el = await mountHero(makeStates({ asleep: true, batteryAgeMs: 47 * 60_000 }));
    expect(batReadout(el)).toBe('—');
    expect(gaugeClass(el)).toContain('unknown');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// formatAge unit — the net-new relative-age formatter (boundaries + NaN-safety)
// ───────────────────────────────────────────────────────────────────────────

describe('formatAge — coarse relative magnitude, NaN/negative-safe', () => {
  test('sub-minute → "" (caller renders "Just now")', () => {
    expect(formatAge(0)).toBe('');
    expect(formatAge(59_000)).toBe('');
  });
  test('minutes (floored, never rounds the magnitude up)', () => {
    expect(formatAge(60_000)).toBe('1m');
    expect(formatAge(47 * 60_000)).toBe('47m');
    expect(formatAge(59 * 60_000 + 59_000)).toBe('59m');
  });
  test('hours', () => {
    expect(formatAge(60 * 60_000)).toBe('1h');
    expect(formatAge(23 * 60 * 60_000)).toBe('23h');
  });
  test('days', () => {
    expect(formatAge(24 * 60 * 60_000)).toBe('1d');
    expect(formatAge(3 * 24 * 60 * 60_000)).toBe('3d');
  });
  test('NaN / negative age → "" (lean-fresh; never overstate staleness)', () => {
    expect(formatAge(NaN)).toBe('');
    expect(formatAge(-5_000)).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Story 3.4 — three glanceable charge states (Parked / Plugged-idle / Charging)
// ───────────────────────────────────────────────────────────────────────────

const labelOf = (el: HeroEl): string =>
  el.shadowRoot!.querySelector('.st-label')!.textContent!.trim();
const dotOf = (el: HeroEl): string =>
  el.shadowRoot!.querySelector('.status .dot')!.getAttribute('style') ?? '';
const port = (el: HeroEl): Element | null => el.shadowRoot!.querySelector('.tc-port');

describe('AC1/AC2 — classify charge state from the charging-state entity (normalizer)', () => {
  // Table-drive the canonical mapping THROUGH normalizeChargingState — incl. the
  // dialect spellings it collapses and the unknown→parked neutral degrade. Asserts
  // the rendered label/dot/port, never prose.
  const cases: Array<{ raw: string; label: string; dot: string; visual: 'parked' | 'plugged' | 'charging' }> = [
    { raw: 'Charging', label: STRINGS.status.charging, dot: 'var(--tc-green', visual: 'charging' },
    { raw: 'charging', label: STRINGS.status.charging, dot: 'var(--tc-green', visual: 'charging' }, // dialect lower-case collapses
    { raw: 'ChargeStarting', label: STRINGS.status.pluggedIdle, dot: 'var(--tc-blue', visual: 'plugged' },
    { raw: 'Complete', label: STRINGS.status.pluggedIdle, dot: 'var(--tc-blue', visual: 'plugged' },
    { raw: 'Stopped', label: STRINGS.status.pluggedIdle, dot: 'var(--tc-blue', visual: 'plugged' },
    { raw: 'NoPower', label: STRINGS.status.pluggedIdle, dot: 'var(--tc-blue', visual: 'plugged' },
    { raw: 'Disconnected', label: STRINGS.status.parked, dot: 'var(--tc-green', visual: 'parked' }, // parked+locked → green dot
    { raw: 'unknown', label: STRINGS.status.parked, dot: 'var(--tc-green', visual: 'parked' }, // neutral degrade, never false plug/charge
  ];

  for (const c of cases) {
    test(`charging_status "${c.raw}" → ${c.visual} (label "${c.label}", dot ${c.dot}…)`, async () => {
      const el = await mountHero(makeStates({ chargeStatus: c.raw }));
      expect(labelOf(el)).toBe(c.label);
      expect(dotOf(el)).toContain(c.dot);
      // AC2 — the port-glow/cable renders for BOTH plugged and charging, absent for parked.
      if (c.visual === 'parked') expect(port(el)).toBeNull();
      else expect(port(el)).toBeTruthy();
    });
  }

  test('AC2 charging ⇒ plugged: charging also renders the port-glow/cable (superset of plugged)', async () => {
    const charging = await mountHero(makeStates({ chargeStatus: 'Charging', power: '7.0' }));
    const plugged = await mountHero(makeStates({ chargeStatus: 'Complete' }));
    expect(port(charging)).toBeTruthy();
    expect(port(plugged)).toBeTruthy();
  });

  test('graceful degradation: an unknown charging entity with cable "on" reads plugged-idle', async () => {
    // The unknown→parked degrade is corroborated ONLY by the physical cable sensor
    // (real connection evidence, not a fabricated charge state).
    const el = await mountHero(makeStates({ chargeStatus: 'unknown', cable: 'on' }));
    expect(labelOf(el)).toBe(STRINGS.status.pluggedIdle);
    expect(port(el)).toBeTruthy();
  });

  // DoD graceful degradation (NFR-4) — the REAL HA sentinels, not the literal
  // 'unknown' token the table above uses: an `unavailable` or entirely-ABSENT
  // charging entity must degrade to neutral Parked, NEVER a false Charging/Plugged
  // (the normalizer collapses ''/'unavailable'/'none'/'null'/undefined → 'unknown'
  // → the parked degrade). These are the strings/holes that actually flow from HA.
  test('unavailable charging_status → Parked, never a false plug/charge (no .tc-port)', async () => {
    const el = await mountHero(makeStates({ chargeStatus: 'unavailable' }));
    expect(labelOf(el)).toBe(STRINGS.status.parked);
    expect(port(el)).toBeNull();
  });

  test('an entirely-absent charging entity degrades to Parked (no .tc-port)', async () => {
    const states = makeStates();
    delete states[ID.charging]; // the function-key resolves to a hole in hass.states
    const el = await mountHero(states);
    expect(labelOf(el)).toBe(STRINGS.status.parked);
    expect(port(el)).toBeNull();
  });

  test('an unusable charge state with cable "off" stays Parked (cable never fabricates plugged)', async () => {
    // The inverse of the cable-"on" corroboration: an `unavailable` charge state
    // with the cable physically OFF must not invent a connection.
    const el = await mountHero(makeStates({ chargeStatus: 'unavailable', cable: 'off' }));
    expect(labelOf(el)).toBe(STRINGS.status.parked);
    expect(port(el)).toBeNull();
  });

  test('AC1 a11y: states are distinguished by the LABEL, not hue alone', async () => {
    // A colour-blind user must read the state from the word — assert the labels
    // are distinct strings across the three states (not just the dot colour).
    const parked = labelOf(await mountHero(makeStates({ chargeStatus: 'Disconnected' })));
    const plugged = labelOf(await mountHero(makeStates({ chargeStatus: 'Complete' })));
    const charging = labelOf(await mountHero(makeStates({ chargeStatus: 'Charging' })));
    expect(new Set([parked, plugged, charging]).size).toBe(3);
    expect(plugged).toBe('Plugged-idle');
  });
});

describe('AC3 — live kW is a direct NaN-safe read of charger_power', () => {
  test('charging with charger_power → "Charging · N.N kW" (1 decimal)', async () => {
    const el = await mountHero(makeStates({ chargeStatus: 'Charging', power: '11.5' }));
    expect(statusText(el)).toContain('Charging · 11.5 kW');
  });

  test('a whole-number power still renders one decimal (N.N kW per DESIGN)', async () => {
    const el = await mountHero(makeStates({ chargeStatus: 'Charging', power: '7' }));
    expect(statusText(el)).toContain('7.0 kW');
  });

  test('unavailable power degrades gracefully to time-to-full — never "NaN kW"', async () => {
    const el = await mountHero(
      makeStates({ chargeStatus: 'Charging', power: 'unavailable', ttf: '1.5', limit: '80' })
    );
    const text = statusText(el);
    expect(text).not.toMatch(/NaN/);
    expect(text).not.toContain('kW');
    expect(text).toContain('1h 30m to 80%');
  });

  test('no power and no time-to-full → the plain "Charging" label, never a fabricated figure', async () => {
    const el = await mountHero(makeStates({ chargeStatus: 'Charging' }));
    const text = statusText(el);
    expect(text).not.toMatch(/NaN|kW/);
    expect(labelOf(el)).toBe(STRINGS.status.charging);
  });

  test('zero power falls back too (0 kW is "not drawing", not a live rate)', async () => {
    const el = await mountHero(makeStates({ chargeStatus: 'Charging', power: '0', ttf: '2' }));
    expect(statusText(el)).not.toContain('0.0 kW');
    expect(statusText(el)).toContain('2h');
  });
});

describe('AC1/AC4 — asleep still wins: no live charge state on a dimmed car', () => {
  test('asleep suppresses the charge cue (no .tc-port) even if charging_status is stale "Charging"', async () => {
    const el = await mountHero(makeStates({ asleep: true, chargeStatus: 'Charging', power: '11.5' }));
    // isAsleep gates charge → 'parked'; the port glow never paints on a dimmed car.
    expect(port(el)).toBeNull();
    expect(labelOf(el)).toBe(STRINGS.status.asleep);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Story 3.5 — aperture-state classifier → independent crossfading overlays
// ───────────────────────────────────────────────────────────────────────────
// The Hero's _apertures() reads the four function-groups through the data boundary
// and drives one .tc-car.<aperture>-open class per open aperture on the bundled-EV
// car svg. jsdom proves the classifier mapping + independence + graceful degrade +
// the asleep gate + the state-bearing aria-label against the actual DOM/classes;
// the crossfade pixels + reduced-motion cut are e2e. Aperture entity ids come from
// const.ts DEFAULT_ENTITIES (never inlined).

const APID = {
  frunk: DEFAULT_ENTITIES.frunk, // cover
  trunk: DEFAULT_ENTITIES.trunk, // cover (the "liftgate")
  windows: DEFAULT_ENTITIES.windows, // aggregate cover
  doorFL: DEFAULT_ENTITIES.door_fl, // binary_sensor
} as const;

/** The bundled-EV car svg the Hero renders by default (no body/image config). */
const carEl = (el: HeroEl): SVGElement =>
  el.shadowRoot!.querySelector('svg.tc-ev') as unknown as SVGElement;
const hasApClass = (el: HeroEl, name: string): boolean =>
  carEl(el).classList.contains(`${name}-open`);

describe('Story 3.5 AC1 — classifier maps each function-group to its own overlay', () => {
  test('frunk cover "open" → only .frunk-open', async () => {
    const states = makeStates();
    states[APID.frunk] = ent(APID.frunk, 'open', at(0));
    const el = await mountHero(states);
    expect(hasApClass(el, 'frunk')).toBe(true);
    expect(hasApClass(el, 'liftgate')).toBe(false);
  });

  test('trunk cover "open" → .liftgate-open (the rear hatch IS the liftgate)', async () => {
    const states = makeStates();
    states[APID.trunk] = ent(APID.trunk, 'open', at(0));
    expect(hasApClass(await mountHero(states), 'liftgate')).toBe(true);
  });

  test('any door binary_sensor "on" → .door-open (one indication for "a door is open")', async () => {
    const states = makeStates();
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    expect(hasApClass(await mountHero(states), 'door')).toBe(true);
  });

  test('windows aggregate cover "open" → .window-open', async () => {
    const states = makeStates();
    states[APID.windows] = ent(APID.windows, 'open', at(0));
    expect(hasApClass(await mountHero(states), 'window')).toBe(true);
  });

  test('independence (AC1): frunk+door+window open at once → three classes, liftgate absent', async () => {
    const states = makeStates();
    states[APID.frunk] = ent(APID.frunk, 'open', at(0));
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    states[APID.windows] = ent(APID.windows, 'open', at(0));
    const el = await mountHero(states);
    expect(hasApClass(el, 'frunk')).toBe(true);
    expect(hasApClass(el, 'door')).toBe(true);
    expect(hasApClass(el, 'window')).toBe(true);
    expect(hasApClass(el, 'liftgate')).toBe(false);
  });
});

describe('Story 3.5 AC3 — missing/unavailable aperture → hidden, never a false "open"', () => {
  // Table-drive the frunk cover read: only the literal 'open' yields an open
  // overlay; 'closed' / 'unavailable' / absent ALL read closed (no class) — the
  // honesty floor (the card never asserts a state it can't confirm). isOn/rawState
  // return false for absence by construction.
  const cases: Array<{ raw?: string; open: boolean }> = [
    { raw: 'open', open: true },
    { raw: 'closed', open: false },
    { raw: 'unavailable', open: false },
    { raw: 'unknown', open: false },
    { raw: undefined, open: false }, // entity entirely absent from hass.states
  ];
  for (const c of cases) {
    test(`frunk state ${c.raw ?? 'ABSENT'} → ${c.open ? 'open' : 'hidden'} (no false open)`, async () => {
      const states = makeStates();
      if (c.raw !== undefined) states[APID.frunk] = ent(APID.frunk, c.raw, at(0));
      expect(hasApClass(await mountHero(states), 'frunk')).toBe(c.open);
    });
  }
});

describe('Story 3.5 — asleep suppresses aperture cues (Story 3.3 isAsleep still wins)', () => {
  test('an asleep car shows NO aperture class even if an aperture entity reads open', async () => {
    const states = makeStates({ asleep: true });
    states[APID.frunk] = ent(APID.frunk, 'open', at(0)); // stale/lingering open
    const el = await mountHero(states);
    for (const n of ['frunk', 'liftgate', 'door', 'window'])
      expect(hasApClass(el, n), n).toBe(false);
  });
});

describe('Story 3.5 a11y — the car aria-label is state-bearing', () => {
  test('open apertures append to the car label; colour-/sight-independent', async () => {
    const states = makeStates();
    states[APID.frunk] = ent(APID.frunk, 'open', at(0));
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    const el = await mountHero(states, { name: 'Garage Model Y' });
    const label = carEl(el).getAttribute('aria-label')!;
    expect(label).toContain('Garage Model Y');
    expect(label).toContain(STRINGS.hero.aperture.open);
    expect(label).toContain(STRINGS.hero.aperture.frunk);
    expect(label).toContain(STRINGS.hero.aperture.door);
  });

  test('all closed → the plain name (the hero leaves "all closed" to the closures panel)', async () => {
    const el = await mountHero(makeStates(), { name: 'Garage Model Y' });
    expect(carEl(el).getAttribute('aria-label')).toBe('Garage Model Y');
  });
});
