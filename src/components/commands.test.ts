// @vitest-environment jsdom
//
// Element-level gate for Story 5.3 (commands — fire-and-forget). The component
// already rendered the ≤6-button column before this story; the story's work is
// (AC2) the asleep "Tap a command to wake" affordance reading, (AC1) aligning the
// label typography to {typography.label}, and (AC1/AC3) the disabled-predicate
// correctness fix — a `button` reads 'unknown' until first pressed / after every
// HA restart, so it must degrade ONLY on genuinely-missing/'unavailable', never
// on 'unknown' (the OLD isUnavailable code wrongly disabled every never-pressed
// command, including wake). These tests turn all three ACs into regressions.
//
// Deliberate contrast with quick-actions.test.ts: commands are fire-and-forget —
// a tap calls button.press and is DONE; there is NO optimistic flip, no reconcile,
// no pressed/.on class. Entity ids are sourced from const.ts DEFAULT_ENTITIES
// (never inlined — the components/ hard-coded-id guard).
import { afterEach, describe, expect, test, vi } from 'vitest';
import './commands';
import { TcCommands } from './commands';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import { WAKE_COOLDOWN_DEFAULT_MS } from '../data/wake';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

type CmdEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

/** The six commands the row renders, in render order (DEFAULT_ENTITIES keys). */
const ID = {
  wake: DEFAULT_ENTITIES.wake,
  honk: DEFAULT_ENTITIES.honk,
  flash: DEFAULT_ENTITIES.flash,
  homelink: DEFAULT_ENTITIES.homelink,
  keyless: DEFAULT_ENTITIES.keyless,
  boombox: DEFAULT_ENTITIES.boombox,
} as const;
/** Index of each command in the rendered .cmd list (matches COMMANDS order). */
const IDX = { wake: 0, honk: 1, flash: 2, homelink: 3, keyless: 4, boombox: 5 } as const;

/** Asleep/awake are driven through isAsleep → the status + battery entities. */
const STATUS = DEFAULT_ENTITIES.status;
const BATTERY = DEFAULT_ENTITIES.battery_level;

/** A press-stamp standing in for a button's last-pressed ISO timestamp (available). */
const STAMP = '2026-06-14T10:00:00+00:00';

function ent(id: string, state: string): HassEntity {
  return { entity_id: id, state, attributes: {}, last_updated: STAMP };
}

/**
 * A states map with the six commands present (each a press-timestamp = available)
 * plus the status/battery signals. `awake` toggles isAsleep; `cmd` overrides
 * individual command states (e.g. 'unknown'/'unavailable'); `drop` removes a
 * command entirely (genuinely missing).
 */
function makeStates(opts: {
  awake?: boolean;
  cmd?: Partial<Record<keyof typeof ID, string>>;
  drop?: Array<keyof typeof ID>;
} = {}): Record<string, HassEntity> {
  const { awake = true, cmd = {}, drop = [] } = opts;
  const states: Record<string, HassEntity> = {};
  for (const key of Object.keys(ID) as Array<keyof typeof ID>) {
    if (drop.includes(key)) continue;
    states[ID[key]] = ent(ID[key], cmd[key] ?? STAMP);
  }
  // status 'on' + battery present → awake; status 'off' + battery unavailable → asleep.
  states[STATUS] = ent(STATUS, awake ? 'on' : 'off');
  states[BATTERY] = ent(BATTERY, awake ? '72' : 'unavailable');
  return states;
}

/** A fresh hass object (new reference → Lit's @property change fires). */
function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return {
    states,
    callService: vi.fn().mockResolvedValue(undefined),
  } as unknown as HomeAssistant;
}

async function mount(hass: HomeAssistant, configOver: Partial<TeslaCardConfig> = {}): Promise<CmdEl> {
  const el = document.createElement('tc-commands') as CmdEl;
  el.hass = hass;
  el.config = { type: 'custom:tesla-card', ...configOver };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const cmds = (el: CmdEl): HTMLButtonElement[] =>
  [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.cmd')];
const cmd = (el: CmdEl, idx: number): HTMLButtonElement => cmds(el)[idx];
const shadowText = (el: CmdEl): string => el.shadowRoot!.textContent ?? '';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

// ───────────────────────────────────────────────────────────────────────────
// AC1 — six column buttons, fire-and-forget button.press against resolved entity
// ───────────────────────────────────────────────────────────────────────────

describe('AC1 — six fire-and-forget command buttons', () => {
  test('exactly six commands render, each a real <button class="cmd"> with a label', async () => {
    const el = await mount(makeHass(makeStates()));
    const buttons = cmds(el);
    expect(buttons).toHaveLength(6);
    for (const b of buttons) {
      expect(b.tagName).toBe('BUTTON');
      // The visible <span> label IS the accessible name (icon is aria-hidden).
      expect(b.querySelector('span')?.textContent?.trim()).toBeTruthy();
    }
  });

  test('clicking an enabled command fires button.press against the RESOLVED entity id', async () => {
    // An asleep car so the wake button is actionable (an awake/online car gates
    // wake non-actionable — Story 5.4; covered in the wake-gate suite below).
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    cmd(el, IDX.wake).click();
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', {
      entity_id: ID.wake,
    });
  });

  test('a tap is fire-and-forget — no optimistic flip, no pressed/.on class introduced', async () => {
    const hass = makeHass(makeStates());
    const el = await mount(hass);
    const before = cmd(el, IDX.honk);
    expect(before.classList.contains('on')).toBe(false);
    before.click(); // request honk
    await el.updateComplete;
    const after = cmd(el, IDX.honk);
    // The button does NOT pretend the world changed (EXPERIENCE.md L114).
    expect(after.classList.contains('on')).toBe(false);
    expect(after.getAttribute('aria-pressed')).toBeNull();
  });

  test('label typography aligns to {typography.label}: UPPERCASE / 700 / +0.1em (token-driven)', () => {
    // styles.test.ts gates token fallbacks, not the per-component label recipe — so
    // without this nothing stops a regression back to the old 11.5px/650 hard-codes.
    // Scope to the COMPONENT-local block (last styles entry) — sharedStyles carries
    // its own .label/.v rules that would otherwise mask a local regression.
    const styles = TcCommands.styles as Array<{ cssText: string }>;
    const css = styles[styles.length - 1].cssText.replace(/\s+/g, ' ');
    expect(css).toContain('font-size: var(--tc-fs-label, 11.5px)');
    expect(css).toContain('font-weight: var(--tc-fw-label, 700)');
    expect(css).toContain('letter-spacing: 0.1em');
    expect(css).toContain('text-transform: uppercase');
    // The old hard-codes are gone from .cmd.
    expect(css).not.toContain('font-weight: 650');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC3 — the disabled-predicate fix (the crux): degrade ONLY on
// genuinely-missing / 'unavailable', NEVER on 'unknown' (never pressed ≠ broken)
// ───────────────────────────────────────────────────────────────────────────

describe('AC1/AC3 — never-pressed buttons stay actionable; only missing/unavailable degrade', () => {
  test('with all commands timestamped (available), every command is ENABLED', async () => {
    // Asleep car: the availability predicate alone governs (the wake online-gate
    // does not apply when the car is asleep — Story 5.4).
    const el = await mount(makeHass(makeStates({ awake: false })));
    for (const b of cmds(el)) expect(b.disabled).toBe(false);
  });

  test("a never-pressed ('unknown') command is STILL enabled and a click fires button.press", async () => {
    // The regression that guards the predicate fix: the OLD isUnavailable-based
    // code treated 'unknown' as unavailable and wrongly disabled this — which on a
    // fresh install / post-restart would disable EVERY command, including wake.
    // Asleep so the wake online-gate is not what's under test here (the predicate is).
    const hass = makeHass(makeStates({ awake: false, cmd: { wake: 'unknown' } }));
    const el = await mount(hass);
    expect(cmd(el, IDX.wake).disabled).toBe(false);
    cmd(el, IDX.wake).click();
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', {
      entity_id: ID.wake,
    });
  });

  test("an 'unavailable' command is DISABLED and a click is a no-op (spy not invoked)", async () => {
    const hass = makeHass(makeStates({ cmd: { honk: 'unavailable' } }));
    const el = await mount(hass);
    expect(cmd(el, IDX.honk).disabled).toBe(true);
    cmd(el, IDX.honk).click(); // disabled + pointer-events:none → suppressed
    await el.updateComplete;
    expect(hass.callService).not.toHaveBeenCalled();
  });

  test('a genuinely MISSING command (absent from hass.states) is DISABLED and never errors', async () => {
    const hass = makeHass(makeStates({ drop: ['flash'] }));
    const el = await mount(hass);
    expect(cmd(el, IDX.flash).disabled).toBe(true);
    cmd(el, IDX.flash).click();
    await el.updateComplete;
    expect(hass.callService).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — asleep car → the commands read as wake affordances ("Tap a command to wake")
// ───────────────────────────────────────────────────────────────────────────

describe('AC2 — asleep wake-affordance reading (reuses STRINGS.hero.tapToWake)', () => {
  test('asleep → the block shows the "Tap a command to wake" hint', async () => {
    const el = await mount(makeHass(makeStates({ awake: false })));
    expect(shadowText(el)).toContain(STRINGS.hero.tapToWake);
  });

  test('awake → the hint is ABSENT', async () => {
    const el = await mount(makeHass(makeStates({ awake: true })));
    expect(shadowText(el)).not.toContain(STRINGS.hero.tapToWake);
  });

  test('asleep → commands (esp. wake) remain ENABLED so the car can be woken', async () => {
    // The asleep fixture's command buttons read a timestamp (available) → enabled;
    // this is exactly AC2's tap-to-wake requirement (only missing/unavailable degrade).
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    expect(cmd(el, IDX.wake).disabled).toBe(false);
    cmd(el, IDX.wake).click();
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', {
      entity_id: ID.wake,
    });
  });

  test('rendering the asleep state does not throw', async () => {
    await expect(mount(makeHass(makeStates({ awake: false })))).resolves.toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC1/AC5 (Story 5.4) — the observed-state gate: never wake an online/waking car
// ───────────────────────────────────────────────────────────────────────────

describe('AC1/AC5 — wake is non-actionable under observed online/waking', () => {
  test('online (awake) → wake button is DISABLED and a click does NOT fire button.press', async () => {
    const hass = makeHass(makeStates({ awake: true }));
    const el = await mount(hass);
    expect(cmd(el, IDX.wake).disabled).toBe(true);
    cmd(el, IDX.wake).click(); // disabled → suppressed
    await el.updateComplete;
    expect(hass.callService).not.toHaveBeenCalledWith('button', 'press', { entity_id: ID.wake });
  });

  test('online → the wake accessible name is state-bearing ("Awake"), never a false "Wake"', async () => {
    const el = await mount(makeHass(makeStates({ awake: true })));
    expect(cmd(el, IDX.wake).getAttribute('aria-label')).toBe(STRINGS.wake.online);
  });

  test('the other five commands stay actionable while online (only wake is gated)', async () => {
    const hass = makeHass(makeStates({ awake: true }));
    const el = await mount(hass);
    expect(cmd(el, IDX.honk).disabled).toBe(false);
    cmd(el, IDX.honk).click();
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', { entity_id: ID.honk });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2/AC3 (Story 5.4) — per-instance cooldown + the bundled sparse-data triad
// ───────────────────────────────────────────────────────────────────────────

describe('AC2/AC3 — cooldown rate-limits repeat taps + the co-located triad', () => {
  test('asleep → a wake fires once, stamps the last-wake, and arms the cooldown (wake now resting)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00Z'));
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    expect(cmd(el, IDX.wake).disabled).toBe(false);
    cmd(el, IDX.wake).click();
    expect(hass.callService).toHaveBeenCalledWith('button', 'press', { entity_id: ID.wake });
    expect(hass.callService).toHaveBeenCalledTimes(1);
    await el.updateComplete;
    // In flight (waking) → non-actionable, name carries the countdown.
    expect(cmd(el, IDX.wake).disabled).toBe(true);
    expect(cmd(el, IDX.wake).getAttribute('aria-label')).toContain(STRINGS.wake.availableIn);
  });

  test('a second immediate tap after a wake is rate-limited — button.press fires only once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00Z'));
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    cmd(el, IDX.wake).click(); // fires
    await el.updateComplete;
    cmd(el, IDX.wake).click(); // waking → disabled → suppressed
    await el.updateComplete;
    expect(hass.callService).toHaveBeenCalledTimes(1);
  });

  test('after the cooldown elapses, an asleep car is wakeable again (window expires, no lock-out)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00Z'));
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    cmd(el, IDX.wake).click();
    await el.updateComplete;
    expect(cmd(el, IDX.wake).disabled).toBe(true);
    vi.advanceTimersByTime(WAKE_COOLDOWN_DEFAULT_MS + 1); // one-shot expiry re-render
    await el.updateComplete;
    expect(cmd(el, IDX.wake).disabled).toBe(false);
  });

  test('the sparse-data triad renders together: wake control + cooldown reason/last-wake + last-updated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00Z'));
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    cmd(el, IDX.wake).click();
    await el.updateComplete;
    const text = shadowText(el);
    // (a) the wake control exists; (b) cooldown reason + (b') last-wake time;
    // (c) last-updated — all co-located on the one surface.
    expect(cmd(el, IDX.wake)).toBeTruthy();
    expect(text).toContain('Available in'); // (b) the resting reason / countdown
    expect(text).toContain(STRINGS.wake.wokenJustNow); // (b') last-wake time
    expect(text).toContain(STRINGS.hero.justNow); // (c) last-updated (battery stamp fresh)
  });

  test('config.wake_cooldown (minutes) extends the resting window — a custom value rate-limits longer', async () => {
    // The new wake_cooldown config option (Task 3) converts minutes → ms; without a
    // test the override path (_cooldownMs) could silently regress to the default.
    // 2-minute override: after the DEFAULT (60s) window the wake is STILL resting.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00Z'));
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass, { wake_cooldown: 2 });
    cmd(el, IDX.wake).click();
    await el.updateComplete;
    expect(cmd(el, IDX.wake).disabled).toBe(true); // cooling
    // Past the default 60s but inside the 2-min override → still resting (proves the override took).
    vi.advanceTimersByTime(WAKE_COOLDOWN_DEFAULT_MS + 1_000);
    el.hass = makeHass(makeStates({ awake: false })); // fresh hass → re-render at the new clock
    await el.updateComplete;
    expect(cmd(el, IDX.wake).disabled).toBe(true);
    // Past the full 2-min override → wakeable again (no lock-out).
    vi.advanceTimersByTime(2 * 60_000);
    await el.updateComplete;
    expect(cmd(el, IDX.wake).disabled).toBe(false);
  });

  test('the last-wake time ages honestly — "Woken Nm ago" once the press is no longer just-now', async () => {
    // Only the < 1 min "Woken just now" branch was covered; the aged branch (wokenPrefix
    // + formatAge + hero.ago) is the actual last-wake value in the triad after time passes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T10:00:00Z'));
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass, { wake_cooldown: 10 }); // keep it resting so the triad stays shown
    cmd(el, IDX.wake).click();
    await el.updateComplete;
    vi.advanceTimersByTime(2 * 60_000 + 1_000); // ~2 min since the wake
    el.hass = makeHass(makeStates({ awake: false })); // fresh hass → re-render recomputes the age
    await el.updateComplete;
    // "Woken 2m ago" — composed from wokenPrefix + formatAge('2m') + hero.ago.
    expect(shadowText(el)).toContain(`${STRINGS.wake.wokenPrefix} 2m ${STRINGS.hero.ago}`);
    expect(shadowText(el)).not.toContain(STRINGS.wake.wokenJustNow);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 (Story 5.4) — the no-auto-wake invariant: the card NEVER initiates a wake
// on its own. Wake is always an explicit user tap (UX-DR23 hard ban; the
// behavioral peer of a11y.test.ts's setInterval/no-polling scan).
// ───────────────────────────────────────────────────────────────────────────

describe('AC4 — no auto-wake: rendering never issues button.press without a user tap', () => {
  test('mounting an asleep car does NOT fire a wake — no button.press before any click', async () => {
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    // The wake surface is actionable, but the card waits for the explicit tap.
    expect(cmd(el, IDX.wake).disabled).toBe(false);
    expect(hass.callService).not.toHaveBeenCalled();
  });

  test('a hass tick (re-render) on an asleep car still never auto-wakes', async () => {
    const hass = makeHass(makeStates({ awake: false }));
    const el = await mount(hass);
    // A fresh hass reference (a routine HA state push) re-renders the affordance…
    el.hass = makeHass(makeStates({ awake: false }));
    await el.updateComplete;
    // …and STILL no wake is issued on its own (no "wake on load", no retry-behind-the-back).
    expect((el.hass!.callService as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D-CQ-1 — element-relative command-grid collapse (converged onto @container).
// The 6-col command grid collapses to 3 cols on the component's OWN inline size
// via @container (the host is a stretched flex item, so that == the card's content
// width). This fixes the pre-D-CQ-1 bug where a VIEWPORT @media never fired for a
// narrow ELEMENT in a wide viewport (a narrow Lovelace column, or the ~376px
// My-Home embed). Story 11.4's `:host([compact]) .row` survives as a redundant
// backup that keeps its reflected-attribute contract. jsdom does no layout, so the
// COLUMN COUNT is proven in e2e (my-home-scene.spec.ts:714 + the AC9 computed-grid
// test); here we pin the CSS mechanism text.
// ───────────────────────────────────────────────────────────────────────────
describe('D-CQ-1 / Story 11.4 — @container grid collapse + compact backup', () => {
  test('config.variant:"compact" reflects a `compact` host attribute; absent ⇒ no attribute (AC4)', async () => {
    const compact = await mount(makeHass(makeStates()), { variant: 'compact' });
    expect(compact.hasAttribute('compact')).toBe(true);

    const standalone = await mount(makeHass(makeStates()));
    expect(standalone.hasAttribute('compact')).toBe(false); // no variant ⇒ byte-identical
  });

  test('the primary collapse is an @container query on the host, not a viewport @media (D-CQ-1)', () => {
    const styles = TcCommands.styles as Array<{ cssText: string }>;
    // The component-OWN sheet is the last entry ([sharedStyles, css`…`]); scope the
    // mechanism check to it so sharedStyles' unrelated .g3/.g4 @media never leaks in.
    const css = styles[styles.length - 1].cssText;
    // host is its own query container …
    expect(css).toMatch(/:host\s*\{[^}]*container-type:\s*inline-size/);
    // … and the 6→3 collapse keys on it (540 = BREAKPOINTS.compact).
    expect(css).toMatch(/@container\s*\(max-width:\s*540px\)\s*\{[^}]*repeat\(3,\s*1fr\)/);
    // the buggy viewport @media it replaced must be gone (regression guard).
    expect(css).not.toMatch(/@media\s*\(max-width/);
  });

  test('`:host([compact]) .row` → 3 cols survives as the redundant 11.4 backup', () => {
    const styles = TcCommands.styles as Array<{ cssText: string }>;
    const css = styles.map((s) => s.cssText).join('\n');
    expect(css).toMatch(/:host\(\[compact\]\)\s+\.row\s*\{[^}]*repeat\(3,\s*1fr\)/);
  });
});
