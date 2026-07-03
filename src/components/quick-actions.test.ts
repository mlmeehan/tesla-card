// @vitest-environment jsdom
//
// Element-level gate for Story 5.2 (quick actions — optimistic-then-reconcile).
// The component already rendered the ≤6 pill row before this story; the story's
// real build is AC2 — the optimistic-then-reconcile state machine + the
// SETTLED-state screen-reader announce. These tests turn all four ACs into
// regressions, driven via hass/config props (jsdom opt-in like hero.test.ts).
//
// The crux (AC2): a tap flips the pill OPTIMISTICALLY before any hass change; a
// later hass whose real state matches the request CLEARS the override (single
// source of truth); a disagreeing hass holds the optimism through the in-flight
// window and the per-tap fence (RECONCILE_TIMEOUT_MS) reverts to truth. Through
// it all, aria-pressed / the accessible name report the SETTLED state, never the
// in-flight guess (UX-DR21). Entity ids are sourced from const.ts
// DEFAULT_ENTITIES (never inlined — the components/ hard-coded-id guard).
import { afterEach, describe, expect, test, vi } from 'vitest';
import './quick-actions';
import { RECONCILE_TIMEOUT_MS, TcQuickActions } from './quick-actions';
import { sharedStyles } from '../styles';
import { DEFAULT_ENTITIES } from '../const';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

type QaEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

/** The six controls the row renders, in render order (DEFAULT_ENTITIES keys). */
const ID = {
  lock: DEFAULT_ENTITIES.lock,
  climate: DEFAULT_ENTITIES.climate,
  port: DEFAULT_ENTITIES.charge_port,
  frunk: DEFAULT_ENTITIES.frunk,
  trunk: DEFAULT_ENTITIES.trunk,
  sentry: DEFAULT_ENTITIES.sentry,
} as const;
/** Index of each control in the rendered .ctrl list (matches ACTIONS order). */
const IDX = { lock: 0, climate: 1, port: 2, frunk: 3, trunk: 4, sentry: 5 } as const;

function ent(id: string, state: string): HassEntity {
  return { entity_id: id, state, attributes: {}, last_updated: '2026-06-15T14:41:00Z' };
}

/** A states map with all six controls present; overrides replace individual states. */
function makeStates(over: Partial<Record<keyof typeof ID, string>> = {}): Record<string, HassEntity> {
  const base: Record<keyof typeof ID, string> = {
    lock: 'locked',
    climate: 'heat_cool',
    port: 'open',
    frunk: 'closed',
    trunk: 'closed',
    sentry: 'off',
  };
  const merged = { ...base, ...over };
  const states: Record<string, HassEntity> = {};
  for (const key of Object.keys(ID) as Array<keyof typeof ID>) {
    states[ID[key]] = ent(ID[key], merged[key]);
  }
  return states;
}

/** A fresh hass object (new reference → Lit's @property change fires willUpdate). */
function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return {
    states,
    callService: vi.fn().mockResolvedValue(undefined),
  } as unknown as HomeAssistant;
}

async function mount(hass: HomeAssistant, configOver: Partial<TeslaCardConfig> = {}): Promise<QaEl> {
  const el = document.createElement('tc-quick-actions') as QaEl;
  el.hass = hass;
  el.config = { type: 'custom:tesla-card', ...configOver };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const ctrls = (el: QaEl): HTMLButtonElement[] =>
  [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.ctrl')];
const ctrl = (el: QaEl, idx: number): HTMLButtonElement => ctrls(el)[idx];
const isOnPill = (b: HTMLButtonElement): boolean => b.classList.contains('on');

/** Assign a fresh hass and settle the render (mirrors shell-test reconcile discipline). */
async function pushHass(el: QaEl, states: Record<string, HassEntity>): Promise<HomeAssistant> {
  const hass = makeHass(states);
  el.hass = hass;
  await el.updateComplete;
  return hass;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ───────────────────────────────────────────────────────────────────────────
// AC1 — ≤6 circular pills, each with its own --accent; active = .ctrl.on; ≥44×44
// ───────────────────────────────────────────────────────────────────────────

describe('AC1 — six pills, own --accent, active .ctrl.on, ≥44×44 floor', () => {
  test('exactly six controls render, each a real <button> carrying an --accent', async () => {
    const el = await mount(makeHass(makeStates()));
    const buttons = ctrls(el);
    expect(buttons).toHaveLength(6);
    for (const b of buttons) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('style') ?? '').toContain('--accent:');
    }
  });

  test('an active control carries .ctrl.on; an inactive one does not', async () => {
    const el = await mount(makeHass(makeStates()));
    // lock=locked → active; frunk=closed → inactive (the on() predicates).
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(true);
    expect(isOnPill(ctrl(el, IDX.frunk))).toBe(false);
  });

  test('the ≥44×44 floor holds at the shared .ctrl recipe (58px, both grid layouts)', () => {
    // jsdom does not lay out stylesheet sizes, so assert the contract at its
    // single source — sharedStyles' .ctrl — which the compact 3-col media query
    // never resizes (only grid-template-columns/gap change locally).
    const css = sharedStyles.cssText;
    expect(css).toContain('width: 58px');
    expect(css).toContain('height: 58px');
    expect(58).toBeGreaterThanOrEqual(44);
  });

  test('the active tint is the DESIGN.md 18% accent fill (AC1 — guards the 16%→18% change)', () => {
    // This story's AC1 deliverable was aligning the .ctrl.on background fill to the
    // DESIGN.md `color-mix(... var(--accent) 18%, transparent)` contract. styles.test.ts
    // gates token fallbacks, not the percentage — so without this nothing stops a
    // regression back to 16%. Pin the active-tint BACKGROUND at 18% (border 45% / glow
    // 25%/70% are deliberately other percentages, so match the background line itself).
    const css = sharedStyles.cssText.replace(/\s+/g, ' ');
    expect(css).toMatch(/background:\s*color-mix\(in srgb, var\(--accent[^)]*\)[^)]*\) 18%, transparent\)/);
    expect(css).not.toContain('16%, transparent');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC2 — optimistic-then-reconcile + settled-state SR announce (the core build)
// ───────────────────────────────────────────────────────────────────────────

describe('AC2 — optimistic flip, reconcile clears the override, SR announces settled', () => {
  test('a tap flips the pill OPTIMISTICALLY before any hass change', async () => {
    const el = await mount(makeHass(makeStates())); // lock=locked → pill on
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(true);
    ctrl(el, IDX.lock).click(); // request unlock — no hass tick yet
    await el.updateComplete;
    // Visual flipped instantly to the requested (off) state, pre-reconcile.
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(false);
  });

  test('the tap fires the correct service (lock.unlock) — toggleEntity semantics', async () => {
    const hass = makeHass(makeStates());
    const el = await mount(hass);
    ctrl(el, IDX.lock).click();
    expect(hass.callService).toHaveBeenCalledWith('lock', 'unlock', {
      entity_id: ID.lock,
    });
  });

  test('aria-pressed / accessible name announce the SETTLED state, NOT the optimistic guess', async () => {
    const el = await mount(makeHass(makeStates())); // lock locked
    const before = ctrl(el, IDX.lock);
    expect(before.getAttribute('aria-pressed')).toBe('true');
    const labelBefore = before.getAttribute('aria-label')!;
    expect(labelBefore).toContain('Locked'); // settled state word (via prettyText)

    ctrl(el, IDX.lock).click(); // optimistic unlock
    await el.updateComplete;
    const after = ctrl(el, IDX.lock);
    // Visual is optimistic (off) but the SR-facing state still tells the truth:
    expect(isOnPill(after)).toBe(false);
    expect(after.getAttribute('aria-pressed')).toBe('true'); // still settled=locked
    expect(after.getAttribute('aria-label')).toBe(labelBefore); // unchanged until reconcile
  });

  test('a reconciled hass matching the request CLEARS the override (single source of truth)', async () => {
    const el = await mount(makeHass(makeStates())); // locked
    ctrl(el, IDX.lock).click(); // optimistic unlock
    await el.updateComplete;
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(false);

    // The command lands: real state becomes 'unlocked' → matches the request.
    await pushHass(el, makeStates({ lock: 'unlocked' }));
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(false);
    expect(ctrl(el, IDX.lock).getAttribute('aria-pressed')).toBe('false'); // now settled

    // Prove the override truly cleared (not coincidence): an EXTERNAL relock now
    // drives the pill back on — a stuck override would have pinned it off.
    await pushHass(el, makeStates({ lock: 'locked' }));
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(true);
  });

  test('a disagreeing hass HOLDS optimism through the in-flight window; the fence reverts to truth', async () => {
    vi.useFakeTimers();
    const el = await mount(makeHass(makeStates())); // locked
    ctrl(el, IDX.lock).click(); // optimistic unlock
    await el.updateComplete;
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(false);

    // A tick where the command has NOT landed (still locked) — the disagreement is
    // the expected in-flight window: optimism HOLDS, never snaps back early.
    await pushHass(el, makeStates({ lock: 'locked' }));
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(false); // still optimistic

    // The fence is the honesty boundary: it expires → revert to the real state.
    vi.advanceTimersByTime(RECONCILE_TIMEOUT_MS);
    await el.updateComplete;
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(true); // reverted to truth (locked)
    expect(ctrl(el, IDX.lock).getAttribute('aria-pressed')).toBe('true');
  });

  test('the optimistic guess is the NEGATION of active for a non-lock control (frunk closed → open)', async () => {
    const el = await mount(makeHass(makeStates())); // frunk closed → inactive
    expect(isOnPill(ctrl(el, IDX.frunk))).toBe(false);
    ctrl(el, IDX.frunk).click(); // request open
    await el.updateComplete;
    expect(isOnPill(ctrl(el, IDX.frunk))).toBe(true); // optimistic open
  });

  test('climate (off → on): optimistic flip fires climate.turn_on and reconciles on a heat_cool tick', async () => {
    // Climate is the most involved on()-predicate (s !== undefined && !== 'off' && !unavailable)
    // and a distinct toggleEntity domain (turn_on/turn_off, not toggle). Exercise its full
    // optimistic→reconcile arc so a domain-specific regression can't slip the AC2 net.
    const hass = makeHass(makeStates({ climate: 'off' }));
    const el = await mount(hass); // climate off → inactive
    expect(isOnPill(ctrl(el, IDX.climate))).toBe(false);

    ctrl(el, IDX.climate).click(); // request on
    await el.updateComplete;
    expect(isOnPill(ctrl(el, IDX.climate))).toBe(true); // optimistic on (pre-tick)
    expect(hass.callService).toHaveBeenCalledWith('climate', 'turn_on', {
      entity_id: ID.climate,
    });

    // Command lands as an active climate state (heat_cool) → on() agrees → override clears.
    await pushHass(el, makeStates({ climate: 'heat_cool' }));
    expect(isOnPill(ctrl(el, IDX.climate))).toBe(true);
    expect(ctrl(el, IDX.climate).getAttribute('aria-pressed')).toBe('true'); // settled
    // Prove the override truly cleared: an external climate-off now drives the pill off.
    await pushHass(el, makeStates({ climate: 'off' }));
    expect(isOnPill(ctrl(el, IDX.climate))).toBe(false);
  });

  test('sentry (switch off → on): optimistic flip fires switch.toggle and reconciles on an on tick', async () => {
    // Sentry is the switch domain (toggleEntity → switch.toggle) — a third domain distinct
    // from lock and cover. Lock its optimistic→reconcile arc so all toggle domains are covered.
    const hass = makeHass(makeStates({ sentry: 'off' }));
    const el = await mount(hass); // sentry off → inactive
    expect(isOnPill(ctrl(el, IDX.sentry))).toBe(false);

    ctrl(el, IDX.sentry).click(); // request on
    await el.updateComplete;
    expect(isOnPill(ctrl(el, IDX.sentry))).toBe(true); // optimistic on
    expect(hass.callService).toHaveBeenCalledWith('switch', 'toggle', {
      entity_id: ID.sentry,
    });

    await pushHass(el, makeStates({ sentry: 'on' })); // command lands → reconcile
    expect(isOnPill(ctrl(el, IDX.sentry))).toBe(true);
    expect(ctrl(el, IDX.sentry).getAttribute('aria-pressed')).toBe('true'); // settled
  });

  test('disconnectedCallback clears the per-tap reconcile fence — no orphaned timer (UX-DR23)', async () => {
    // Task 3 requires the single-shot fences be cleared on disconnect so a removed
    // element leaves no orphaned reconcile timer (UX-DR23: no background work after
    // teardown). White-box the private timer map: a pending fence exists after a tap,
    // and is gone once disconnected — and advancing past the timeout must not throw
    // (the callback would otherwise fire against a detached element).
    vi.useFakeTimers();
    const el = await mount(makeHass(makeStates())); // lock locked
    const timers = (el as unknown as { _timers: Map<string, unknown> })._timers;
    ctrl(el, IDX.lock).click(); // arms a fence for 'lock'
    await el.updateComplete;
    expect(timers.size).toBe(1);

    el.remove(); // disconnectedCallback → clear all fences
    expect(timers.size).toBe(0);
    expect(() => vi.advanceTimersByTime(RECONCILE_TIMEOUT_MS)).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC3 — unavailable control → dimmed + non-actionable (no false optimistic flip)
// ───────────────────────────────────────────────────────────────────────────

describe('AC3 — unavailable control is disabled and never enters the optimistic path', () => {
  test('an unavailable entity renders a disabled pill', async () => {
    const el = await mount(makeHass(makeStates({ lock: 'unavailable' })));
    expect(ctrl(el, IDX.lock).disabled).toBe(true);
  });

  test('tapping a disabled control is a no-op: no service call, no optimistic flip', async () => {
    const hass = makeHass(makeStates({ lock: 'unavailable' }));
    const el = await mount(hass);
    const before = isOnPill(ctrl(el, IDX.lock));
    ctrl(el, IDX.lock).click(); // disabled → suppressed
    await el.updateComplete;
    expect(hass.callService).not.toHaveBeenCalled();
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(before); // no false flip
  });

  test('a MISSING entity (absent from hass.states) also disables — graceful degradation (FR-24)', async () => {
    // The cross-cutting AC says "a missing OR unavailable control renders dimmed +
    // non-actionable". isUnavailable(undefined) is true, so an entity entirely absent
    // from hass.states (rawState → undefined) must take the same disabled path as the
    // literal 'unavailable' string — a distinct branch the 'unavailable'-string test
    // above does not exercise. Drop lock from the states map to simulate it.
    const states = makeStates();
    delete states[ID.lock];
    const hass = makeHass(states);
    const el = await mount(hass);
    expect(ctrl(el, IDX.lock).disabled).toBe(true);
    ctrl(el, IDX.lock).click();
    await el.updateComplete;
    expect(hass.callService).not.toHaveBeenCalled(); // never actionable, never errors
    expect(isOnPill(ctrl(el, IDX.lock))).toBe(false);
    // SR name degrades to the plain label (no state word) — still a real accessible name.
    expect(ctrl(el, IDX.lock).getAttribute('aria-label')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC4 — the hide toggle lives in the shell (tesla-card.shell.test.ts), not here.
// The component always renders its row; `hide_quick_actions` gates the whole
// <tc-quick-actions> block in tesla-card.ts → covered there. Asserting the
// component renders a row (above) is the half this file owns.
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// D-CQ-1 — element-relative pill-grid collapse (converged onto @container).
// The 6-col pill grid collapses to 3 cols on the component's OWN inline size via
// @container (the host is a stretched flex item, so that == the card's content
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
    const styles = TcQuickActions.styles as Array<{ cssText: string }>;
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
    const styles = TcQuickActions.styles as Array<{ cssText: string }>;
    const css = styles.map((s) => s.cssText).join('\n');
    expect(css).toMatch(/:host\(\[compact\]\)\s+\.row\s*\{[^}]*repeat\(3,\s*1fr\)/);
  });
});
