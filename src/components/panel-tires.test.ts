// @vitest-environment jsdom
//
// Element-level gate for Story 5.8 (Tires Panel). The panel + its four-corner
// layout pre-existed (pre-BMAD prototype, token/string-migrated in Epic 2, wired
// into the 5.1 shell); this story closes the AC + DoD gaps and these tests pin
// them as regressions:
//   AC1 — four corners each render their numeric pressure + native unit (1-dp on
//         bar) and the American "Tire pressure" title; the generic silhouette
//         renders.
//   AC2 — the headline: a computed margin check warns a corner below
//         `recommended − margin` EVEN WITH its TPMS binary_sensor off; the TPMS
//         sensor alone still warns (OR — never under-warn); a UNIFORM overnight
//         drop (all four lowered together) does NOT trip (temperature-robust); the
//         threshold is CONFIGURABLE + relative, not a fixed PSI (tightening
//         `config.tires.margin` / setting `recommended` flips the result).
//   AC3 — a missing corner degrades to `—` (NaN-safe, no warn fabricated, nothing
//         throws); a stale/asleep corner shows last-known + a staleness stamp (the
//         dim copy class) and the summary never claims a confident "All normal" it
//         cannot confirm; a 0-corner hass renders "No data".
//
// Freshness is deterministic by injection: every fixture entity is stamped at one
// instant, so advancing the server reference (bumping one entity's last_updated)
// back-dates the tires into stale/asleep — exactly how HA pushes a fresh stamp on
// some entity while a sensor sits idle (mirrors src/data/freshness.test.ts and
// panel-closures.test.ts). Entity ids come from const.ts DEFAULT_ENTITIES (never
// inlined); a FRESH hass per swap.
import { afterEach, describe, expect, test } from 'vitest';
import './panel-tires';
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
  fl: DEFAULT_ENTITIES.tire_fl,
  fr: DEFAULT_ENTITIES.tire_fr,
  rl: DEFAULT_ENTITIES.tire_rl,
  rr: DEFAULT_ENTITIES.tire_rr,
  warnFL: DEFAULT_ENTITIES.tire_warn_fl,
  warnFR: DEFAULT_ENTITIES.tire_warn_fr,
  warnRL: DEFAULT_ENTITIES.tire_warn_rl,
  warnRR: DEFAULT_ENTITIES.tire_warn_rr,
  battery: DEFAULT_ENTITIES.battery_level,
} as const;

/** 50 min after the fixtures' single stamp instant — past the 30-min `asleep` window. */
const ADVANCED_NOW = '2026-06-15T15:31:00Z';

function awakeStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(awakeFx.states)) as Record<string, HassEntity>;
}

/** A psi-unit clone of the awake corpus: rewrite the four corners into psi (≈Model Y
 *  cold spec) so the NON-bar branches are exercised — 0-dp formatting (AC1) and the
 *  unit-aware default margin (AC2: ~4 psi, NOT the 0.3 bar constant). Values are
 *  passed in per test; every TPMS flag is cleared so the COMPUTED check is the only
 *  lever under test. */
function psiStates(vals: { fl: string; fr: string; rl: string; rr: string }): Record<string, HassEntity> {
  const st = awakeStates();
  const set = (id: string, v: string) => {
    st[id].state = v;
    st[id].attributes = { ...(st[id].attributes ?? {}), unit_of_measurement: 'psi' };
  };
  set(ID.fl, vals.fl);
  set(ID.fr, vals.fr);
  set(ID.rl, vals.rl);
  set(ID.rr, vals.rr);
  for (const w of [ID.warnFL, ID.warnFR, ID.warnRL, ID.warnRR]) st[w].state = 'off';
  return st;
}
function asleepStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(asleepFx.states)) as Record<string, HassEntity>;
}

/** Advance the HA time base: stamp one entity AFTER the tires so referenceNow
 *  (max server stamp) sits ahead of their last_updated → they read stale/asleep. */
function advanceNow(states: Record<string, HassEntity>): Record<string, HassEntity> {
  states[ID.battery].last_updated = ADVANCED_NOW;
  states[ID.battery].last_changed = ADVANCED_NOW;
  return states;
}

function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}

async function mount(
  hass: HomeAssistant,
  config: Partial<TeslaCardConfig> = {}
): Promise<PanelEl> {
  const el = document.createElement('tc-panel-tires') as PanelEl;
  el.hass = hass;
  el.config = { type: 'custom:tesla-card', ...config }; // entities default to DEFAULT_ENTITIES
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const sr = (el: PanelEl) => el.shadowRoot!;
const corners = (el: PanelEl) => [...sr(el).querySelectorAll<HTMLElement>('.corner')];
const cornerByPos = (el: PanelEl, pos: string) => sr(el).querySelector<HTMLElement>(`.corner.${pos}`)!;
const summaryText = (el: PanelEl) => sr(el).querySelector('.summary')!.textContent?.trim() ?? '';
const summaryEl = (el: PanelEl) => sr(el).querySelector('.summary')!;

afterEach(() => {
  document.body.innerHTML = '';
});

// ── AC1 — render ─────────────────────────────────────────────────────────────
describe('AC1 — four corners render pressure + unit, American title', () => {
  test('four corners each render their numeric pressure with the bar unit (1-dp)', async () => {
    const el = await mount(makeHass(awakeStates()));
    expect(corners(el)).toHaveLength(4);
    // Awake fixture: FL/RL/RR = 2.9 bar, FR = 2.6 bar.
    expect(cornerByPos(el, 'fl').textContent).toContain('2.9');
    expect(cornerByPos(el, 'fr').textContent).toContain('2.6');
    expect(cornerByPos(el, 'fl').textContent).toContain('bar');
  });

  test('the American "Tire pressure" title and the generic car silhouette render', async () => {
    const el = await mount(makeHass(awakeStates()));
    expect(sr(el).querySelector('.label')!.textContent).toContain(STRINGS.tires.title);
    expect(sr(el).querySelector('.car svg')).not.toBeNull();
  });

  test('a NON-bar unit (psi) renders 0-dp, not 1-dp (the unit-aware decimal branch)', async () => {
    // AC1 says 1-dp for bar, 0-dp for psi/kPa. The bar/1-dp path is covered above;
    // this pins the psi/0-dp half so a whole number never gains a phantom ".0".
    const el = await mount(makeHass(psiStates({ fl: '42', fr: '40', rl: '42', rr: '42' })));
    const fl = cornerByPos(el, 'fl');
    expect(fl.textContent).toContain('42');
    expect(fl.textContent).toContain('psi');
    expect(fl.textContent).not.toContain('42.0'); // 0-dp, never bar's 1-dp on psi
  });
});

// ── AC2 — the smart, configurable, temperature-robust low check ──────────────
describe('AC2 — computed margin check (augments TPMS, temperature-robust, configurable)', () => {
  test('a corner below recommended − margin warns EVEN WITH its TPMS sensor off (computed fires)', async () => {
    const states = awakeStates();
    // Drop RR well below the peer max (2.9) with its TPMS warning OFF.
    states[ID.rr].state = '2.3';
    states[ID.warnRR].state = 'off';
    const el = await mount(makeHass(states));
    // recommended = max(2.9,2.6,2.9,2.3)=2.9; margin=0.3 → threshold 2.6; 2.3 < 2.6 → warn.
    expect(cornerByPos(el, 'rr').classList.contains('warn')).toBe(true);
    expect(cornerByPos(el, 'rr').textContent).toContain(STRINGS.tires.low);
  });

  test('the TPMS binary_sensor alone still warns (OR — never under-warn vs. the car)', async () => {
    // Awake fixture: FR is at a normal-ish 2.6 (NOT below the 2.6 computed threshold)
    // but its tire_warn_fr is ON. The OR must still warn.
    const el = await mount(makeHass(awakeStates()));
    expect(cornerByPos(el, 'fr').classList.contains('warn')).toBe(true);
    expect(cornerByPos(el, 'fr').textContent).toContain(STRINGS.tires.low);
  });

  test('a UNIFORM overnight drop (all four lowered together) does NOT trip — temperature-robust', async () => {
    const states = awakeStates();
    // Simulate a cold soak: lower every corner by 0.25 bar and clear every TPMS flag.
    states[ID.fl].state = '2.65';
    states[ID.fr].state = '2.35';
    states[ID.rl].state = '2.65';
    states[ID.rr].state = '2.65';
    for (const w of [ID.warnFL, ID.warnFR, ID.warnRL, ID.warnRR]) states[w].state = 'off';
    const el = await mount(makeHass(states));
    // recommended = max = 2.65; margin 0.3 → threshold 2.35; FR 2.35 is NOT < 2.35.
    // The gap between any corner and the peer max stayed small → nothing trips.
    expect(corners(el).every((c) => !c.classList.contains('warn'))).toBe(true);
    expect(summaryText(el)).toContain(STRINGS.tires.allNormal);
  });

  test('the threshold is CONFIGURABLE + relative, not a fixed PSI (margin flips the result)', async () => {
    const states = awakeStates();
    // FR sits 0.3 below the 2.9 peer max with its TPMS OFF.
    states[ID.fr].state = '2.6';
    states[ID.warnFR].state = 'off';

    // A LOOSE margin (0.4) clears FR: threshold 2.9 − 0.4 = 2.5; 2.6 is NOT < 2.5.
    const loose = await mount(makeHass(awakeStates_fr(states)), { tires: { margin: 0.4 } });
    expect(cornerByPos(loose, 'fr').classList.contains('warn')).toBe(false);

    // A TIGHTER margin (0.2) on the SAME reading trips FR: threshold 2.7; 2.6 < 2.7.
    const tight = await mount(makeHass(awakeStates_fr(states)), { tires: { margin: 0.2 } });
    expect(cornerByPos(tight, 'fr').classList.contains('warn')).toBe(true);
  });

  test('the DEFAULT margin is unit-aware (≈4 psi on psi sensors, NOT the 0.3 bar constant)', async () => {
    // The single strongest "not a fixed PSI / not a fixed bar constant" proof: with
    // NO config, on psi sensors, a corner 3 psi under the peer max must NOT warn
    // (default psi margin ≈4). Were the bar default (0.3) applied blindly, 3 > 0.3
    // would trip it — so a clear here proves the default scales to the native unit.
    const near = await mount(makeHass(psiStates({ fl: '42', fr: '39', rl: '42', rr: '42' })));
    // recommended = max = 42; psi margin ≈4 → threshold 38; FR 39 is NOT < 38 → clear.
    expect(cornerByPos(near, 'fr').classList.contains('warn')).toBe(false);

    // And the psi threshold still bites a genuinely low corner (37 < 38) — the
    // default margin is real, not just "always clears".
    const low = await mount(makeHass(psiStates({ fl: '42', fr: '37', rl: '42', rr: '42' })));
    expect(cornerByPos(low, 'fr').classList.contains('warn')).toBe(true);
    expect(cornerByPos(low, 'fr').textContent).toContain(STRINGS.tires.low);
  });

  test('a STALE high last-known peer does NOT inflate the baseline (fresh corners stay calm)', async () => {
    // Honesty/temperature-robustness edge: the peer baseline is the max of the
    // FRESH corners only. Three fresh corners read a uniformly-lower 2.5 while RR
    // sits STALE at its last-known 2.9. A stale peer must NOT inflate `recommended`
    // (which would push the threshold to 2.6 and false-trip the three fresh 2.5s).
    // With a fresh-only baseline, recommended = 2.5 → threshold 2.2 → nobody trips.
    const states = awakeStates();
    states[ID.fl].state = '2.5';
    states[ID.fr].state = '2.5';
    states[ID.rl].state = '2.5';
    states[ID.rr].state = '2.9'; // last-known high, but stale (see below)
    for (const w of [ID.warnFL, ID.warnFR, ID.warnRL, ID.warnRR]) states[w].state = 'off';
    // Advance the HA reference (battery) past the fixtures, then re-stamp the three
    // lowered corners as fresh — leaving RR back-dated and therefore stale/asleep.
    advanceNow(states);
    for (const id of [ID.fl, ID.fr, ID.rl]) {
      states[id].last_updated = ADVANCED_NOW;
      states[id].last_changed = ADVANCED_NOW;
    }
    const el = await mount(makeHass(states));
    // None of the fresh, uniformly-lower corners false-trip off the stale peer.
    for (const pos of ['fl', 'fr', 'rl'] as const) {
      expect(cornerByPos(el, pos).classList.contains('warn')).toBe(false);
    }
    // RR is stale → annotated, never a confident computed warn.
    expect(cornerByPos(el, 'rr').classList.contains('warn')).toBe(false);
    expect(sr(el).querySelector('.c-stale')).not.toBeNull();
  });

  test('an explicit config.tires.recommended overrides the peer baseline', async () => {
    const states = awakeStates();
    // All four normal + every TPMS off; an aggressive recommended makes them all low.
    for (const w of [ID.warnFL, ID.warnFR, ID.warnRL, ID.warnRR]) states[w].state = 'off';
    states[ID.fr].state = '2.9'; // lift FR so the peer baseline alone would clear all
    const el = await mount(makeHass(states), { tires: { recommended: 3.5, margin: 0.3 } });
    // threshold 3.5 − 0.3 = 3.2; every corner (2.9) < 3.2 → all warn.
    expect(corners(el).every((c) => c.classList.contains('warn'))).toBe(true);
  });
});

/** Helper: clone a prepared states map (the configurable test mutates then re-mounts). */
function awakeStates_fr(states: Record<string, HassEntity>): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(states)) as Record<string, HassEntity>;
}

// ── AC3 — degradation + honest freshness ─────────────────────────────────────
describe('AC3 — missing degrades NaN-safe; stale shows last-known + staleness, never false "All normal"', () => {
  test('a missing corner reading degrades to "—", NaN-safe, no warn fabricated, nothing throws', async () => {
    const states = awakeStates();
    delete states[ID.rr]; // corner sensor absent
    delete states[ID.warnRR];
    const el = await mount(makeHass(states));
    expect(corners(el)).toHaveLength(4); // still four corners
    expect(cornerByPos(el, 'rr').textContent).toContain('—');
    expect(cornerByPos(el, 'rr').classList.contains('warn')).toBe(false); // no NaN ghost-trip
  });

  test('a stale/asleep corner shows last-known + a staleness stamp (dim copy class)', async () => {
    const el = await mount(makeHass(advanceNow(asleepStates())));
    // Last-known value retained (still shows 2.9), but annotated as stale.
    expect(cornerByPos(el, 'fl').textContent).toContain('2.9');
    const note = sr(el).querySelector('.c-stale')!;
    expect(note).not.toBeNull();
    expect(note.classList.contains('tc-stale-copy')).toBe(true); // --tc-text-dim, not -mute
    expect(note.textContent).toContain(STRINGS.hero.updatedPrefix); // "updated 50m ago"
  });

  test('the summary surfaces "Some readings unconfirmed" on stale data, never a confident "All normal"', async () => {
    // Clear every TPMS flag so the ONLY honesty lever is staleness (the asleep
    // fixture leaves FR's TPMS on, which would otherwise read as "Check pressure").
    const states = advanceNow(asleepStates());
    for (const w of [ID.warnFL, ID.warnFR, ID.warnRL, ID.warnRR]) states[w].state = 'off';
    const el = await mount(makeHass(states));
    expect(summaryText(el)).not.toContain(STRINGS.tires.allNormal);
    expect(summaryText(el)).toContain(STRINGS.tires.someUnconfirmed);
    expect(summaryEl(el).classList.contains('good')).toBe(false); // never confident green on stale
    expect(summaryEl(el).classList.contains('dim')).toBe(true);
  });

  test('a stale corner does NOT fire a confident COMPUTED low-warn (annotate, do not assert)', async () => {
    const states = advanceNow(asleepStates());
    // Drop RL below the margin while everything is stale + its TPMS OFF.
    states[ID.rl].state = '2.2';
    states[ID.warnRL].state = 'off';
    const el = await mount(makeHass(states));
    // Computed check is suppressed on an unconfirmable read — no fresh-looking alarm.
    expect(cornerByPos(el, 'rl').classList.contains('warn')).toBe(false);
  });

  test('with ≤1 corner present there is no peer baseline, so no COMPUTED warn can ghost-trip', async () => {
    // recommended defaults to max(present). With a single present corner the baseline
    // IS that corner, so it can never be `< itself − margin` — the computed check
    // must stay silent (only TPMS could warn). Guards the partial-data arithmetic.
    const states = awakeStates();
    for (const id of [ID.fr, ID.rl, ID.rr, ID.warnFR, ID.warnRL, ID.warnRR]) delete states[id];
    states[ID.fl].state = '2.4'; // would look "low" against a 2.9 peer — but there is no peer
    states[ID.warnFL].state = 'off';
    const el = await mount(makeHass(states));
    expect(cornerByPos(el, 'fl').textContent).toContain('2.4'); // last-known value still shown
    expect(cornerByPos(el, 'fl').classList.contains('warn')).toBe(false); // no baseline ⇒ no warn
    expect(cornerByPos(el, 'fr').textContent).toContain('—'); // the absent corners degrade
  });

  test('a missing TPMS binary_sensor contributes no warn, yet the computed check still fires (no throw)', async () => {
    // DoD: a missing TPMS sensor simply adds no TPMS warning; the computed margin
    // check is independent and still works when pressures are present.
    const states = awakeStates();
    delete states[ID.warnRR]; // the corner's TPMS sensor is gone
    states[ID.rr].state = '2.3'; // but the pressure is genuinely low (< 2.9 − 0.3 = 2.6)
    const el = await mount(makeHass(states));
    expect(cornerByPos(el, 'rr').classList.contains('warn')).toBe(true); // computed still fires
    expect(cornerByPos(el, 'rr').textContent).toContain(STRINGS.tires.low);
    // A normal corner whose TPMS is also missing stays calm — no fabricated warn.
    const calm = awakeStates();
    delete calm[ID.warnRL];
    expect(cornerByPos(await mount(makeHass(calm)), 'rl').classList.contains('warn')).toBe(false);
  });

  test('a fully-empty hass (0 corners present) renders "No data" without throwing', async () => {
    const el = await mount(makeHass({}));
    expect(corners(el)).toHaveLength(4); // the layout still renders four placeholders
    expect(summaryText(el)).toContain(STRINGS.tires.noData);
    expect(sr(el).querySelector('.car svg')).not.toBeNull();
  });
});

// ── Story 9.13 (Tune) — display-only unit conversion (config.tires.units) ───────
// `units` converts the rendered corner read-out to psi/bar FOR DISPLAY ONLY. The
// low-pressure comparison stays in the native unit (units never moves the warn
// threshold). Absent ⇒ native value/unit verbatim (SM-C4 / FR-33 zero-diff). The ONE
// factor: 1 bar = 14.5038 psi. An unrecognised native unit cannot be converted, so
// the native value is shown unchanged (honest — never fabricated/mislabelled).
describe('Story 9.13 — tire display-unit conversion (config.tires.units)', () => {
  test('absent units ⇒ native render unchanged (zero-diff): bar fixture shows 2.9 bar', async () => {
    const el = await mount(makeHass(awakeStates()));
    expect(cornerByPos(el, 'fl').textContent).toContain('2.9');
    expect(cornerByPos(el, 'fl').textContent).toContain('bar');
  });

  test('units:psi converts a bar-native reading to psi (2.9 bar → 42 psi, 0-dp)', async () => {
    const el = await mount(makeHass(awakeStates()), { tires: { units: 'psi' } });
    const fl = cornerByPos(el, 'fl');
    expect(fl.textContent).toContain('42'); // 2.9 × 14.5038 = 42.06 → 0-dp
    expect(fl.textContent).toContain('psi');
    expect(fl.textContent).not.toContain('bar');
  });

  test('units:bar converts a psi-native reading to bar (42 psi → 2.9 bar, 1-dp)', async () => {
    const el = await mount(makeHass(psiStates({ fl: '42', fr: '40', rl: '42', rr: '42' })), {
      tires: { units: 'bar' },
    });
    const fl = cornerByPos(el, 'fl');
    expect(fl.textContent).toContain('2.9'); // 42 / 14.5038 = 2.896 → 1-dp
    expect(fl.textContent).toContain('bar');
  });

  test('units is display-only: a low corner still warns (comparison stays native) while shown in psi', async () => {
    const states = awakeStates();
    states[ID.rr].state = '2.3'; // < peer max 2.9 − 0.3 margin (native bar) ⇒ computed warn
    states[ID.warnRR].state = 'off'; // TPMS off — the COMPUTED check is the lever
    const el = await mount(makeHass(states), { tires: { units: 'psi' } });
    const rr = cornerByPos(el, 'rr');
    expect(rr.classList.contains('warn')).toBe(true); // warn fires in native unit
    expect(rr.textContent).toContain('psi'); // displayed converted
    expect(rr.textContent).toContain('33'); // 2.3 × 14.5038 = 33.4 → 0-dp
  });
});
