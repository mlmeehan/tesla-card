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
    const hass = makeHass(makeStates());
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
    const el = await mount(makeHass(makeStates()));
    for (const b of cmds(el)) expect(b.disabled).toBe(false);
  });

  test("a never-pressed ('unknown') command is STILL enabled and a click fires button.press", async () => {
    // The regression that guards the predicate fix: the OLD isUnavailable-based
    // code treated 'unknown' as unavailable and wrongly disabled this — which on a
    // fresh install / post-restart would disable EVERY command, including wake.
    const hass = makeHass(makeStates({ cmd: { wake: 'unknown' } }));
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
