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
  charging?: boolean;
  limit?: string;
  locked?: boolean;
} = {}): Record<string, HassEntity> {
  const {
    asleep = false,
    battery = '64',
    batteryAgeMs = 0,
    batteryStamped = true,
    charging = false,
    limit,
    locked = true,
  } = opts;
  const states: Record<string, HassEntity> = {
    // Anchor: always fresh at REF → referenceNow() === REF.
    [ID.status]: ent(ID.status, asleep ? 'off' : 'on', at(0)),
    [ID.lock]: ent(ID.lock, locked ? 'locked' : 'unlocked', at(0)),
    [ID.range]: ent(ID.range, asleep ? 'unavailable' : '210', at(0)),
    [ID.charging]: ent(ID.charging, charging ? 'Charging' : 'Disconnected', at(0)),
  };
  states[ID.battery] = ent(
    ID.battery,
    asleep ? 'unavailable' : battery,
    batteryStamped ? at(batteryAgeMs) : undefined
  );
  if (limit !== undefined) states[ID.limit] = ent(ID.limit, limit, at(0));
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
