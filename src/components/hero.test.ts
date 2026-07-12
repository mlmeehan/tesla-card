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
import { TcHero } from './hero';
import { formatAge } from '../helpers';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import { DIALECT_ENTITY_ALIASES } from '../data/dialect';
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
  usableBattery?: string; // cached SoC sensor — survives sleep (compact last-known fallback)
  estimateRange?: string; // cached range sensor — survives sleep (compact last-known fallback)
  cachedRange?: string; // last-known battery_range surviving sleep (Story 11.2 range-rung fallback)
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
    usableBattery,
    estimateRange,
    cachedRange,
  } = opts;
  const states: Record<string, HassEntity> = {
    // Anchor: always fresh at REF → referenceNow() === REF.
    [ID.status]: ent(ID.status, asleep ? 'off' : 'on', at(0)),
    [ID.lock]: ent(ID.lock, locked ? 'locked' : 'unlocked', at(0)),
    // battery_range normally reads 'unavailable' asleep; `cachedRange` models the
    // real Tesla battery_range retaining a last-known value across sleep (Story 11.2
    // range-rung fallback target) — overrides the asleep 'unavailable'.
    [ID.range]: ent(
      ID.range,
      cachedRange ?? (asleep ? 'unavailable' : '210'),
      at(0),
      { unit_of_measurement: 'mi' }
    ),
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
  // Cached last-known sensors (compact + asleep fallback): they survive sleep, so
  // they carry a real value even while battery_level/battery_range read unavailable.
  if (usableBattery !== undefined)
    states[DEFAULT_ENTITIES.usable_battery_level] = ent(
      DEFAULT_ENTITIES.usable_battery_level,
      usableBattery,
      at(0)
    );
  if (estimateRange !== undefined)
    states[DEFAULT_ENTITIES.estimate_battery_range] = ent(
      DEFAULT_ENTITIES.estimate_battery_range,
      estimateRange,
      at(0),
      { unit_of_measurement: 'mi' }
    );
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

describe('AC4 — asleep: re-scoped dim marker + "Asleep · updated 47m ago" + battery —', () => {
  test('asleep stage carries the opacity-dim marker, never grayscale on the render (Story 11.1 re-scope)', async () => {
    const asleep = await mountHero(makeStates({ asleep: true, batteryAgeMs: 47 * 60_000 }));
    const stage = asleep.shadowRoot!.querySelector('.car-stage')!;
    // Dim via the opacity-only marker; grayscale no longer rides the render's ancestor.
    expect(stage.classList.contains('asleep')).toBe(true);
    expect(stage.classList.contains('tc-asleep')).toBe(false);
    // Awake never carries the dim treatment.
    const awakeStage = (await mountHero(makeStates())).shadowRoot!.querySelector('.car-stage')!;
    expect(awakeStage.classList.contains('asleep')).toBe(false);
    expect(awakeStage.classList.contains('tc-asleep')).toBe(false);
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
// Story 11.1 AC5 — asleep render keeps hue: the stage dims via OPACITY ONLY, so the
// recolorable render (.car-img/.tc-car) keeps its resolved hue (a dark preset reads
// as a dim colour, not near-black). Grayscale must NOT sit on the stage or any
// ancestor of the render. (Story 12.1 removed the Flow overlay that formerly carried
// the grayscale; the surviving asleep treatment is opacity-only, with no grayscale
// anywhere on the stage.) A regression that grayscales the stage/render goes red.
// ───────────────────────────────────────────────────────────────────────────

describe('Story 11.1 AC5 — asleep render keeps hue (no grayscale on the render node)', () => {
  test('the render node carries no grayscale handle; only the opacity marker rides the stage', async () => {
    const el = await mountHero(withEnergy({ asleep: true }), ENERGY_OVER);
    const stage = el.shadowRoot!.querySelector('.car-stage')!;
    // The stage dims via the opacity-only marker — grayscale no longer rides the
    // render's ancestor (that is what stripped the hue → near-black before).
    expect(stage.classList.contains('asleep')).toBe(true);
    expect(stage.classList.contains('tc-asleep')).toBe(false);
    // The render node itself (genericCar <svg class="car-img tc-car">) keeps its hue:
    // no desaturation class anywhere on its subtree.
    const render = el.shadowRoot!.querySelector('.car-stage .car-img');
    expect(render, 'render node (.car-img) missing').toBeTruthy();
    expect(render!.classList.contains('tc-asleep')).toBe(false);
    // NO grayscale handle is applied per-layer via class anywhere in the stage — the
    // stage dims via opacity only (nothing carries the .tc-asleep grayscale recipe).
    expect(el.shadowRoot!.querySelectorAll('.car-stage .tc-asleep').length).toBe(0);
  });

  test('CSS: the stage dims via opacity only, never grayscale on the stage/render (AC5b)', () => {
    const heroCss = (TcHero as unknown as { styles: Array<{ cssText?: string }> }).styles
      .map((s) => s?.cssText ?? '')
      .join('\n');
    // The stage-asleep rule dims via opacity ONLY — no grayscale on the render's ancestor,
    // and the magnitude is still single-sourced from the token (no hard-coded 0.5).
    const stageRule = heroCss.match(/\.car-stage\.asleep\s*\{[^}]*\}/);
    expect(stageRule, 'missing .car-stage.asleep opacity-dim rule').not.toBeNull();
    expect(stageRule![0]).toMatch(/opacity:\s*var\(\s*--tc-dim-opacity\b/);
    expect(stageRule![0], 'grayscale must NOT ride the stage (it strips the render hue)').not.toMatch(
      /grayscale/
    );
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

// ───────────────────────────────────────────────────────────────────────────
// Story 12.1 — the Hero emits NO flow overlay. The always-on HeroSvgRenderer overlay
// (Story 4.3) is REMOVED from the standalone Vehicle Card's Hero; the flow viz is
// retained UNCHANGED on the My-Home Scene bus + the Energy panel. The `overlay` helper
// + the ENERGY_OVER/withEnergy energy-present fixtures below are RETAINED — the
// absence-guard (AC1) mounts WITH an energy site (which previously drew the overlay)
// and proves no `.tc-flow-overlay`/`.fo-*` is emitted. ONE energy role is made present
// via a config.energy.entities override pointing at a DEFAULT_ENTITIES constant
// (charger_power, a fresh kW sensor) — never an inlined literal id (components rule).

const overlay = (el: HeroEl): SVGElement | null =>
  el.shadowRoot!.querySelector('.car-stage svg.tc-flow-overlay');

/** Bind the solar role to the (fresh, numeric) charger_power sensor so a node is present. */
const ENERGY_OVER: Partial<TeslaCardConfig> = {
  energy: { entities: { solar_power: DEFAULT_ENTITIES.charger_power } },
};
/** States with charger_power fresh-at-REF → the overridden solar role resolves present. */
const withEnergy = (extra: Parameters<typeof makeStates>[0] = {}) =>
  makeStates({ power: '6.0', ...extra });

describe('Story 12.1 — the Hero emits NO flow overlay', () => {
  // The retained absence-guard (AC1): even with an energy site present (which under
  // Story 4.3 drew the overlay), the Hero emits no `.tc-flow-overlay` and no `.fo-*`
  // node chips / luminous edges — on the full card (awake + asleep) and compact. A
  // regression that re-introduces the overlay turns this red.
  const noOverlay = (el: HeroEl, label: string): void => {
    expect(overlay(el), `${label}: overlay must be absent`).toBeNull();
    expect(
      el.shadowRoot!.querySelector('.car-stage .fo-chip'),
      `${label}: no node chip`
    ).toBeNull();
    expect(
      el.shadowRoot!.querySelector('.car-stage .fo-flow'),
      `${label}: no luminous edge`
    ).toBeNull();
  };

  test('full card, awake, energy present → no overlay, no chips/edges (car still renders)', async () => {
    const el = await mountHero(withEnergy(), ENERGY_OVER);
    noOverlay(el, 'full awake');
    // The car silhouette still renders beneath — the stage is not emptied.
    expect(el.shadowRoot!.querySelector('.car-stage svg.tc-ev')).toBeTruthy();
  });

  test('full card, asleep, energy present → no overlay (the asleep path is also clean)', async () => {
    const el = await mountHero(withEnergy({ asleep: true }), ENERGY_OVER);
    expect(el.shadowRoot!.querySelector('.car-stage')!.classList.contains('asleep')).toBe(true);
    noOverlay(el, 'full asleep');
  });

  test('compact, energy present → no overlay (the compact arm of the guard)', async () => {
    const el = await mountHero(withEnergy(), { ...ENERGY_OVER, variant: 'compact' });
    expect(el.shadowRoot!.querySelector('.hero.compact')).not.toBeNull();
    noOverlay(el, 'compact');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.10 — the compact variant tightens the silhouette while the status line +
// battery gauge + car silhouette all survive. (The overlay it once suppressed is
// removed entirely by Story 12.1 — its absence, incl. the compact arm, is pinned by
// the Story-12.1 guard above; this block proves only the surviving surfaces.)
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 8.10 — variant:compact keeps the status line · battery · silhouette', () => {
  test('compact + energy present → status line · battery gauge · silhouette all stay', async () => {
    // Energy IS present; compact tightens the silhouette without touching the surviving
    // hero surfaces. (Overlay-absence is the Story-12.1 guard's job, above.)
    const el = await mountHero(withEnergy(), { ...ENERGY_OVER, variant: 'compact' });
    const sr = el.shadowRoot!;
    // The status line survives (the honesty surface).
    expect(sr.querySelector('.st-label')).not.toBeNull();
    expect(sr.querySelector('.st-sub')).not.toBeNull();
    // The battery button + gauge survive — the accessible read (the state-bearing
    // aria-label is the surviving a11y floor in compact).
    const battery = sr.querySelector<HTMLButtonElement>('.battery');
    expect(battery).not.toBeNull();
    expect(battery!.getAttribute('aria-label')).toBeTruthy();
    expect(sr.querySelector('.bat-pct')).not.toBeNull();
    // The car silhouette survives (bundled generic-EV in the default render mode).
    expect(sr.querySelector('.car-stage svg.tc-ev')).not.toBeNull();
    // The hero root carries the `compact` class (the width hook).
    expect(sr.querySelector('.hero.compact')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Compact + asleep "last-known" (follow-on to Story 8.10): the in-line embed is
// asleep most of the time and has no panels, so the compact card falls back to the
// cached usable_battery_level / estimate_battery_range — REAL sensors, dimmed via
// .tc-stale-copy + a desaturated gauge under the "updated Nm ago" stamp — instead of
// blanking to "—". A DELIBERATE, COMPACT-ONLY exception to the strict asleep "—"
// rule: the FULL card is untouched (its AC4 "—" tests above stay green), and an
// absent cache → "—". `estimate_*` (not the optimistic `ideal_*`) tracks the live
// rated `battery_range`, and the stamp is sourced from the cached sensor shown so it
// never overstates that value's freshness (UX-DR18).
// ═══════════════════════════════════════════════════════════════════════════
describe('compact + asleep — last-known SoC/range fallback (dimmed), full card unchanged', () => {
  const batRange = (el: HeroEl): string =>
    el.shadowRoot!.querySelector('.bat-range')!.textContent!.replace(/\s+/g, ' ').trim();
  const hasClass = (el: HeroEl, sel: string, cls: string): boolean =>
    el.shadowRoot!.querySelector(sel)!.classList.contains(cls);

  test('compact + asleep + cached sensors present → shows last-known %, range (not "—")', async () => {
    const el = await mountHero(
      makeStates({ asleep: true, usableBattery: '71', estimateRange: '230', limit: '80' }),
      { variant: 'compact' }
    );
    expect(batReadout(el)).toBe('71%');
    expect(batRange(el)).toBe('230 mi');
    // The gauge carries a KNOWN fill (not the .unknown neutral bar): 71% → high band.
    const gauge = el.shadowRoot!.querySelector('.tc-bat')!;
    expect(gauge.classList.contains('unknown')).toBe(false);
    expect(gauge.classList.contains('high')).toBe(true);
  });

  test('the last-known readout is MARKED stale, never presented as live', async () => {
    const el = await mountHero(
      makeStates({ asleep: true, usableBattery: '71', estimateRange: '230' }),
      { variant: 'compact' }
    );
    // Numbers adopt the sanctioned .tc-stale-copy dim; the row carries .last-known.
    expect(hasClass(el, '.bat-top', 'tc-stale-copy')).toBe(true);
    expect(hasClass(el, '.battery', 'last-known')).toBe(true);
    // a11y parity (UX-DR21): the aria-label states it is last-known, not a live read.
    const aria = el.shadowRoot!.querySelector('.battery')!.getAttribute('aria-label')!;
    expect(aria).toContain('71%');
    expect(aria.toLowerCase()).toContain('last known');
    // The car is still dimmed and the honest stamp still shows — freshness never overstated.
    expect(hasClass(el, '.car-stage', 'asleep')).toBe(true);
  });

  test('the dim actually reaches the headline .bat-pct leaf (--bat-pct-color override)', () => {
    // .tc-stale-copy on .bat-top is inherited, but .bat-pct self-sets its colour, so the
    // headline % only dims because .last-known overrides the --bat-pct-color the base
    // .bat-pct rule reads. jsdom resolves no var()/cascade, so guard the rule TEXT
    // directly (mirrors ecosystem-card.test.ts:317). Both halves must hold.
    const heroCss = (TcHero as unknown as { styles: Array<{ cssText?: string }> }).styles
      .map((s) => s?.cssText ?? '')
      .join('\n');
    const override = heroCss.match(/\.battery\.last-known\s*\{[^}]*\}/);
    expect(override, 'missing .battery.last-known --bat-pct-color override').not.toBeNull();
    expect(override![0]).toMatch(/--bat-pct-color:\s*var\(\s*--tc-text-dim/);
    const base = heroCss.match(/\.bat-pct\s*\{[^}]*\}/);
    expect(base![0], '.bat-pct must read var(--bat-pct-color, …)').toMatch(/color:\s*var\(\s*--bat-pct-color/);
  });

  test('the "updated Nm ago" stamp tracks the CACHED sensor shown, not battery_level', async () => {
    // battery_level re-stamps fresh at the sleep transition, but the cached SoC is an
    // hour old — the stamp must describe the SHOWN number, never the fresher primary.
    const states = makeStates({ asleep: true, usableBattery: '71', estimateRange: '230' });
    const cached = states[DEFAULT_ENTITIES.usable_battery_level];
    states[DEFAULT_ENTITIES.usable_battery_level] = {
      ...cached,
      last_updated: at(45 * 60_000),
      last_changed: at(45 * 60_000),
    };
    const el = await mountHero(states, { variant: 'compact' });
    const text = el.shadowRoot!.querySelector('.status')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('45m'); // the cached value's true age
    expect(text).not.toContain(STRINGS.hero.justNow); // NOT battery_level's fresh transition stamp
  });

  test('FULL card asleep is UNCHANGED — strict "—", never the cache (Story 3.3 intact)', async () => {
    // Same cached sensors present, but variant unset (full) → strict em-dash.
    const el = await mountHero(
      makeStates({ asleep: true, usableBattery: '71', estimateRange: '230' })
    );
    expect(batReadout(el)).toBe('—');
    expect(batRange(el)).toBe('—');
    expect(hasClass(el, '.bat-top', 'tc-stale-copy')).toBe(false);
    expect(hasClass(el, '.battery', 'last-known')).toBe(false);
  });

  test('compact + asleep but cache ALSO absent → graceful "—", no fabrication', async () => {
    const el = await mountHero(makeStates({ asleep: true }), { variant: 'compact' });
    expect(batReadout(el)).toBe('—');
    expect(batRange(el)).toBe('—');
  });

  test('compact + AWAKE reads the LIVE primary, never the cache', async () => {
    // Live battery_level = 64 (default); cache present (71) but MUST be ignored.
    const el = await mountHero(
      makeStates({ battery: '64', usableBattery: '71', estimateRange: '230' }),
      { variant: 'compact' }
    );
    expect(batReadout(el)).toBe('64%');
    expect(hasClass(el, '.battery', 'last-known')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 11.2 — enriched compact vehicle cell: a range fallback RUNG + a lock/
// security glance chip. Both are COMPACT-ONLY (cfg.variant === 'compact'); the
// standalone card is byte-identical. Investigation #2 root cause: the compact
// cell read a bare "—" for range when `estimate_battery_range` was unmapped, and
// carried no security signal. jsdom is the primary tier (the chip's real context
// is the asleep My-Home embed). Red-green: these go RED against today's tree (no
// chip; range "—" when the estimate is absent) and green after.
// ═══════════════════════════════════════════════════════════════════════════

const batRangeText = (el: HeroEl): string =>
  el.shadowRoot!.querySelector('.bat-range')!.textContent!.replace(/\s+/g, ' ').trim();
const chip = (el: HeroEl): HTMLButtonElement | null =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('.security-chip');
const chipWord = (el: HeroEl): string =>
  el.shadowRoot!.querySelector('.security-chip .sec-word')!.textContent!.trim();

describe('Story 11.2 AC1 — range fallback rung (estimate → last-known battery_range)', () => {
  test('compact + asleep, estimate ABSENT but cached battery_range present → shows it, not "—"', async () => {
    // The added rung: estimate_battery_range is unmapped/absent (investigation #2),
    // so the range falls back to last-known battery_range rather than blanking.
    const el = await mountHero(makeStates({ asleep: true, cachedRange: '180' }), {
      variant: 'compact',
    });
    expect(batRangeText(el)).toBe('180 mi');
    // Inherits the dimmed last-known skin (no new freshness claim).
    expect(el.shadowRoot!.querySelector('.bat-top')!.classList.contains('tc-stale-copy')).toBe(true);
  });

  test('compact + asleep, estimate PRESENT → still shows the estimate (rung order preserved)', async () => {
    const el = await mountHero(
      makeStates({ asleep: true, estimateRange: '230', cachedRange: '180' }),
      { variant: 'compact' }
    );
    // The estimate resolves first → it wins; the battery_range rung is only a fallback.
    expect(batRangeText(el)).toBe('230 mi');
  });

  test('compact + asleep, BOTH absent → graceful "—" (honest no-cache, never fabricated)', async () => {
    const el = await mountHero(makeStates({ asleep: true }), { variant: 'compact' });
    // Default makeStates sets battery_range 'unavailable' under asleep, no estimate.
    expect(batRangeText(el)).toBe('—');
  });

  test('the awake / full-card range branch is UNCHANGED (battery_range, never the estimate)', async () => {
    // Awake compact reads the live battery_range (210), ignoring any estimate cache.
    const awakeCompact = await mountHero(
      makeStates({ estimateRange: '230' }),
      { variant: 'compact' }
    );
    expect(batRangeText(awakeCompact)).toBe('210 mi');
    // Full card asleep keeps the strict "—" (battery_range reads unavailable asleep;
    // the rung is compact-only, so the full card never gains a cache fallback).
    const fullAsleep = await mountHero(makeStates({ asleep: true, estimateRange: '230' }));
    expect(batRangeText(fullAsleep)).toBe('—');
  });
});

describe('Story 11.2 AC2/AC3 — lock/security chip states + escalation (door>window>unlocked>locked)', () => {
  test('locked → "Locked", calm (no .muted / .exception)', async () => {
    const el = await mountHero(makeStates({ locked: true }), { variant: 'compact' });
    expect(chip(el)).toBeTruthy();
    expect(chipWord(el)).toBe(STRINGS.status.locked);
    expect(chip(el)!.classList.contains('muted')).toBe(false);
    expect(chip(el)!.classList.contains('exception')).toBe(false);
  });

  test('unlocked → "Unlocked", muted', async () => {
    const el = await mountHero(makeStates({ locked: false }), { variant: 'compact' });
    expect(chipWord(el)).toBe(STRINGS.status.unlocked);
    expect(chip(el)!.classList.contains('muted')).toBe(true);
  });

  test('any door open → amber "Door open" (exception), even when locked', async () => {
    const states = makeStates({ locked: true });
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    const el = await mountHero(states, { variant: 'compact' });
    expect(chipWord(el)).toBe(STRINGS.hero.security.doorOpen);
    expect(chip(el)!.classList.contains('exception')).toBe(true);
  });

  test('a window open + no door → amber "Window open" (exception)', async () => {
    const states = makeStates({ locked: true });
    states[APID.windows] = ent(APID.windows, 'open', at(0));
    const el = await mountHero(states, { variant: 'compact' });
    expect(chipWord(el)).toBe(STRINGS.hero.security.windowOpen);
    expect(chip(el)!.classList.contains('exception')).toBe(true);
  });

  test('priority: a door open WINS over a simultaneous window open and over unlocked', async () => {
    const states = makeStates({ locked: false }); // unlocked too
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    states[APID.windows] = ent(APID.windows, 'open', at(0));
    const el = await mountHero(states, { variant: 'compact' });
    expect(chipWord(el)).toBe(STRINGS.hero.security.doorOpen);
  });

  test('the exception copy is a GENERIC SINGULAR regardless of how many doors are ajar', async () => {
    const states = makeStates({ locked: true });
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    states[DEFAULT_ENTITIES.door_rr] = ent(DEFAULT_ENTITIES.door_rr, 'on', at(0));
    const el = await mountHero(states, { variant: 'compact' });
    expect(chipWord(el)).toBe(STRINGS.hero.security.doorOpen); // not "2 doors open"
  });
});

describe('Story 11.2 AC4 — chip is a real <button> → closures, state-bearing aria, ≥44×44', () => {
  test('the chip is a <button> with a state-bearing aria-label ("…, opens closures")', async () => {
    const el = await mountHero(makeStates({ locked: true }), { variant: 'compact' });
    const btn = chip(el)!;
    expect(btn.tagName).toBe('BUTTON');
    const label = btn.getAttribute('aria-label')!;
    expect(label).toContain(STRINGS.status.locked);
    expect(label).toContain(STRINGS.hero.opensClosures);
    // Awake ⇒ NOT last-known: the staleness qualifier is gated on asleep only
    // (holistic review 2026-06-24 — mirrors the battery's lastKnown gating).
    expect(label.toLowerCase()).not.toContain('last known');
  });

  test('clicking it dispatches a bubbling+composed open-panel CustomEvent with {panel:"closures"}', async () => {
    const el = await mountHero(makeStates({ locked: false }), { variant: 'compact' });
    let detail: { panel?: string } | undefined;
    let composed = false;
    let bubbles = false;
    el.addEventListener('open-panel', (e) => {
      const ce = e as CustomEvent<{ panel: string }>;
      detail = ce.detail;
      composed = ce.composed;
      bubbles = ce.bubbles;
    });
    chip(el)!.click();
    expect(detail).toEqual({ panel: 'closures' });
    expect(composed).toBe(true);
    expect(bubbles).toBe(true);
  });

  test('CSS: the chip clears the ≥44×44 tap floor via min-height', () => {
    // jsdom resolves no layout, so guard the rule TEXT directly (the suite's
    // established target-size assertion idiom, cf. .bat-pct override above).
    const heroCss = (TcHero as unknown as { styles: Array<{ cssText?: string }> }).styles
      .map((s) => s?.cssText ?? '')
      .join('\n');
    const rule = heroCss.match(/\.security-chip\s*\{[^}]*\}/);
    expect(rule, 'missing .security-chip rule').not.toBeNull();
    expect(rule![0]).toMatch(/min-height:\s*44px/);
  });
});

describe('Story 11.2 AC5 — asleep last-known from RAW entities (not apertures), omit when no cache', () => {
  test('asleep with a resolvable lock → chip stays visible + dimmed (.last-known / .tc-stale-copy)', async () => {
    const el = await mountHero(makeStates({ asleep: true, locked: true }), {
      variant: 'compact',
    });
    expect(chip(el)).toBeTruthy();
    expect(chipWord(el)).toBe(STRINGS.status.locked);
    expect(chip(el)!.classList.contains('last-known')).toBe(true);
    expect(
      el.shadowRoot!.querySelector('.security-chip .sec-word')!.classList.contains('tc-stale-copy')
    ).toBe(true);
    // a11y parity with the battery (UX-DR21): the SR name says it is last-known,
    // never a cached lock/security state presented as live (holistic review 2026-06-24).
    const aria = chip(el)!.getAttribute('aria-label')!.toLowerCase();
    expect(aria).toContain(STRINGS.status.locked.toLowerCase());
    expect(aria).toContain('last known');
  });

  test('asleep reads the RAW door entity, NOT the asleep-suppressed apertures const', async () => {
    // apertures is forced to CLOSED_APERTURES when asleep (hero.ts) — a chip derived
    // from it would falsely read "Locked". Proving the chip reads the raw door entity:
    // an asleep state with a door 'on' still surfaces the exception.
    const states = makeStates({ asleep: true, locked: true });
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    const el = await mountHero(states, { variant: 'compact' });
    expect(chipWord(el)).toBe(STRINGS.hero.security.doorOpen);
    expect(chip(el)!.classList.contains('exception')).toBe(true);
  });

  test('asleep + lock unknown/unavailable AND nothing open → chip OMITTED (never a "—" chip)', async () => {
    const states = makeStates({ asleep: true });
    states[ID.lock] = ent(ID.lock, 'unavailable', at(0)); // unresolvable lock
    const el = await mountHero(states, { variant: 'compact' });
    // Honest absence: the chip is omitted entirely, never a "—" chip for lock state.
    expect(chip(el)).toBeNull();
    expect(el.shadowRoot!.querySelector('.sec-word')).toBeNull();
  });
});

describe('Story 11.2 AC7 — standalone (non-compact) is byte-identical (no chip, unchanged range)', () => {
  test('the non-compact hero renders NO security chip, even with a door open', async () => {
    const states = makeStates({ locked: false });
    states[APID.doorFL] = ent(APID.doorFL, 'on', at(0));
    const el = await mountHero(states); // variant unset → full card
    expect(chip(el)).toBeNull();
  });

  test('full + variant:"full" explicit → still no chip', async () => {
    const el = await mountHero(makeStates({ locked: false }), { variant: 'full' });
    expect(chip(el)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Story 15.1 — tesla_custom boolean charging through the stamped dialect
// (AC1/AC2). `_chargeVisual` reads `adapterFor(hass, config).normalizeChargingState`;
// the config below carries `integration: 'tesla_custom'` — the EXACT shape a
// child sees after the parent stamp (the stamp itself is proven whole-card in
// audit-r6.test.ts; these pin the component classification matrix).
// RED-FIRST evidence (pre-conversion, module-default normalizer): boolean 'on'
// → 'unknown' → cable-corroborated 'plugged'/'parked' — never 'charging'.
// ───────────────────────────────────────────────────────────────────────────

describe('Story 15.1 — tesla_custom boolean charging (stamped dialect, AC1/AC2)', () => {
  // The dialect entity ids are DERIVED from the live alias table (the same
  // research-§5 source the resolver consults), slug-prefixed the way a real
  // install's resolver output would be — never inlined spellings that could
  // drift from the table (and the components/ no-hard-coded-ids guard holds:
  // no quoted full ids appear here).
  const tcAlias = (key: 'charging_status' | 'charge_cable'): string => {
    const alias = DIALECT_ENTITY_ALIASES.tesla_custom?.[key] ?? '';
    const dot = alias.indexOf('.');
    // Loud, never masked: a dropped/renamed table entry must fail HERE — the
    // `?? ''` fallback would otherwise build a malformed-but-self-consistent
    // `.mycar_` id these tests would still pass against.
    if (dot < 0) throw new Error(`no tesla_custom alias for '${key}' — table drift`);
    return `${alias.slice(0, dot)}.mycar_${alias.slice(dot + 1)}`;
  };
  const TC = {
    charging: tcAlias('charging_status'), // binary_sensor.mycar_charging
    cable: tcAlias('charge_cable'), // binary_sensor.mycar_charger
  } as const;

  /** Fleet base states MINUS the charging-status string (tesla_custom exposes
   *  none — research §5), plus the boolean and an optional plug sensor. */
  function tcStates(boolState: string, cableState?: string): Record<string, HassEntity> {
    const states = makeStates();
    delete states[ID.charging]; // no charging-status STRING on this dialect
    states[TC.charging] = ent(TC.charging, boolState, at(0));
    if (cableState !== undefined) states[TC.cable] = ent(TC.cable, cableState, at(0));
    return states;
  }

  /** The post-stamp child config shape (AC4). */
  const TC_CONFIG: Partial<TeslaCardConfig> = {
    integration: 'tesla_custom',
    entities: { charging_status: TC.charging, charge_cable: TC.cable },
  };

  test("AC1 — boolean 'on' → CHARGING: green dot + label + port/halo (+ live kW read)", async () => {
    const states = tcStates('on', 'on');
    states[ID.power] = ent(ID.power, '7.2', at(0)); // charger_power is fleet-convergent
    const el = await mountHero(states, TC_CONFIG);
    expect(labelOf(el)).toBe(STRINGS.status.charging);
    expect(dotOf(el)).toContain('var(--tc-green');
    expect(port(el)).toBeTruthy();
    expect(statusText(el)).toContain('7.2 kW'); // AC1 kW: resolves + renders, never NaN
  });

  test("AC1 — boolean 'on' with NO cable entity still reads CHARGING (the boolean alone proves it)", async () => {
    const el = await mountHero(tcStates('on'), TC_CONFIG);
    expect(labelOf(el)).toBe(STRINGS.status.charging);
    expect(port(el)).toBeTruthy();
  });

  test("AC2 — 'off' + cable 'on' → PLUGGED (off routes to the cable corroboration)", async () => {
    const el = await mountHero(tcStates('off', 'on'), TC_CONFIG);
    expect(labelOf(el)).toBe(STRINGS.status.pluggedIdle);
    expect(dotOf(el)).toContain('var(--tc-blue');
    expect(port(el)).toBeTruthy();
  });

  test("AC2 — 'off' + cable 'off' → PARKED, never a false 'plugged' (the uncabled majority case)", async () => {
    const el = await mountHero(tcStates('off', 'off'), TC_CONFIG);
    expect(labelOf(el)).toBe(STRINGS.status.parked);
    expect(port(el)).toBeNull();
  });

  test("AC2 — 'off' + cable ABSENT → PARKED (absence never fabricates a connection)", async () => {
    const el = await mountHero(tcStates('off'), TC_CONFIG);
    expect(labelOf(el)).toBe(STRINGS.status.parked);
    expect(port(el)).toBeNull();
  });

  test("AC2 (third raw value) — boolean 'unavailable' + cable 'on' → PLUGGED (ABSENT-set → 'unknown' → corroboration)", async () => {
    const el = await mountHero(tcStates('unavailable', 'on'), TC_CONFIG);
    expect(labelOf(el)).toBe(STRINGS.status.pluggedIdle);
    expect(port(el)).toBeTruthy();
  });

  test("AC2 (third raw value) — boolean 'unavailable' + cable 'unavailable' → PARKED (the honest lesser claim)", async () => {
    const el = await mountHero(tcStates('unavailable', 'unavailable'), TC_CONFIG);
    expect(labelOf(el)).toBe(STRINGS.status.parked);
    expect(port(el)).toBeNull();
  });

  test('hardening — a cross-wired override (fleet STRING sensor on a stamped tesla_custom config) still classifies', async () => {
    // normalizeStatus consults the dialect override map THEN falls to the base
    // map (dialect.ts) — so an explicit charging_status override pointing at a
    // fleet-vocabulary sensor degrades correctly ('Charging' → 'charging'),
    // never to a dead 'unknown'.
    const states = makeStates({ chargeStatus: 'Charging' }); // fleet string id (ID.charging)
    const el = await mountHero(states, {
      integration: 'tesla_custom',
      // The EXPLICIT cross-wired override the narration describes — not the
      // DEFAULT_ENTITIES fallback (which happens to reach the same id).
      entities: { charging_status: ID.charging },
    });
    expect(labelOf(el)).toBe(STRINGS.status.charging);
  });
});
