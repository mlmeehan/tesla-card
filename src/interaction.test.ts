// @vitest-environment jsdom
//
// Element-level interaction gate for Story 2.3 (UX-DR23): tc-slider is the
// "drag → commit-on-release" primitive. This proves the contract dynamically —
// `value-changed` fires on pointer-UP, never on pointer-MOVE (no mid-drag
// commits would otherwise flood the metered Tesla API). The static scan in
// a11y.test.ts is the structural backstop; this is the behavioural one.
//
// jsdom lacks PointerEvent + pointer-capture, so we stub the minimum surface the
// handlers touch (clientX, pointerId, preventDefault, set/releasePointerCapture)
// and pin the track geometry — no new deps, same opt-in jsdom as the lifecycle test.
import { describe, expect, test, beforeAll } from 'vitest';
import './components/slider';

type SliderEl = HTMLElement & {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  label: string;
  updateComplete: Promise<boolean>;
};

beforeAll(() => {
  // jsdom doesn't implement pointer capture — make it a no-op so _down/_up work.
  const proto = Element.prototype as unknown as {
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
  };
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
});

/** Dispatch a synthetic pointer event carrying the fields the handlers read. */
function pointer(track: Element, type: string, clientX: number): void {
  const ev = new Event(type, { bubbles: true });
  Object.assign(ev, { clientX, pointerId: 1 });
  track.dispatchEvent(ev);
}

async function mountSlider(): Promise<{ el: SliderEl; track: Element; events: number[] }> {
  const el = document.createElement('tc-slider') as SliderEl;
  el.min = 0;
  el.max = 100;
  el.step = 1;
  el.value = 0;
  const events: number[] = [];
  el.addEventListener('value-changed', (e) =>
    events.push((e as CustomEvent<{ value: number }>).detail.value)
  );
  document.body.appendChild(el);
  await el.updateComplete;
  const track = el.shadowRoot!.querySelector('.track')!;
  // Pin track geometry so clientX → value is deterministic (0px→0, 100px→100).
  track.getBoundingClientRect = () =>
    ({ left: 0, width: 100, top: 0, height: 46, right: 100, bottom: 46, x: 0, y: 0 }) as DOMRect;
  return { el, track, events };
}

describe('tc-slider — drag commits on release only (UX-DR23, AC3a)', () => {
  test('pointermove does NOT dispatch value-changed (no mid-drag commits)', async () => {
    const { track, events } = await mountSlider();
    pointer(track, 'pointerdown', 0);
    pointer(track, 'pointermove', 50);
    pointer(track, 'pointermove', 100);
    expect(events, 'value-changed must not fire during the drag').toEqual([]);
  });

  test('pointerup dispatches value-changed exactly once with the released value', async () => {
    const { track, events } = await mountSlider();
    pointer(track, 'pointerdown', 0);
    pointer(track, 'pointermove', 100);
    pointer(track, 'pointerup', 100);
    expect(events).toEqual([100]);
  });

  test('pointercancel also commits the in-flight value (release path)', async () => {
    const { track, events } = await mountSlider();
    pointer(track, 'pointerdown', 0);
    pointer(track, 'pointermove', 75);
    pointer(track, 'pointercancel', 75);
    expect(events).toEqual([75]);
  });

  test('a release equal to the current value commits nothing (no redundant call)', async () => {
    const { track, events } = await mountSlider();
    pointer(track, 'pointerdown', 0); // value already 0
    pointer(track, 'pointerup', 0);
    expect(events).toEqual([]);
  });
});

// ── Story 5.5 AC2 — keyboard operability, same commit-on-release contract ─────
// The slider gained a keyboard path (SC 2.1.1 fix). It MUST mirror the drag
// contract: each keydown moves the DISPLAYED value live (aria-valuenow), but
// `value-changed` commits ONLY on keyup/blur — never per keydown (a per-keypress
// commit would flood the metered Fleet API). The pointer path above is unchanged.
function key(track: Element, type: 'keydown' | 'keyup', k: string): void {
  track.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
}
const now = (track: Element): number => Number(track.getAttribute('aria-valuenow'));

describe('tc-slider — keyboard commits on key-release/blur only (AC2)', () => {
  test('ArrowRight on keydown steps the DISPLAYED value but does NOT commit', async () => {
    const { el, track, events } = await mountSlider();
    key(track, 'keydown', 'ArrowRight');
    await el.updateComplete;
    expect(now(track), 'aria-valuenow moves live on keydown').toBe(1); // value 0 + step 1
    expect(events, 'no value-changed on keydown (commit-on-release)').toEqual([]);
  });

  test('keyup commits exactly once with the settled value', async () => {
    const { el, track, events } = await mountSlider();
    key(track, 'keydown', 'ArrowRight');
    key(track, 'keydown', 'ArrowRight'); // 0 → 1 → 2 displayed, still no commit
    await el.updateComplete;
    expect(events).toEqual([]);
    key(track, 'keyup', 'ArrowRight');
    expect(events).toEqual([2]);
  });

  test('Home → min and End → max (each committed once on keyup)', async () => {
    const { el, track, events } = await mountSlider();
    el.value = 40;
    await el.updateComplete;
    key(track, 'keydown', 'Home');
    await el.updateComplete;
    expect(now(track)).toBe(0); // min
    key(track, 'keyup', 'Home');
    expect(events).toEqual([0]);

    key(track, 'keydown', 'End');
    await el.updateComplete;
    expect(now(track)).toBe(100); // max
    key(track, 'keyup', 'End');
    expect(events).toEqual([0, 100]);
  });

  test('blur commits the in-flight keyboard value (release path)', async () => {
    const { el, track, events } = await mountSlider();
    key(track, 'keydown', 'ArrowUp'); // 0 → 1 displayed
    await el.updateComplete;
    track.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    expect(events).toEqual([1]);
  });

  test('a keyboard settle equal to the current value commits nothing', async () => {
    const { el, track, events } = await mountSlider();
    el.value = 0;
    await el.updateComplete;
    key(track, 'keydown', 'ArrowLeft'); // 0 − 1 → clamped back to min 0
    await el.updateComplete;
    expect(now(track)).toBe(0);
    key(track, 'keyup', 'ArrowLeft');
    expect(events).toEqual([]); // settled value === current → no redundant dispatch
  });

  test('a disabled slider ignores keys (no display change, no commit)', async () => {
    const { el, track, events } = await mountSlider();
    el.disabled = true;
    await el.updateComplete;
    key(track, 'keydown', 'ArrowRight');
    await el.updateComplete;
    expect(now(track)).toBe(0); // unchanged
    key(track, 'keyup', 'ArrowRight');
    expect(events).toEqual([]);
  });

  test('a state-bearing aria-label is exposed when `label` is set (UX-DR21)', async () => {
    const { el, track } = await mountSlider();
    el.label = 'Charge limit';
    await el.updateComplete;
    expect(track.getAttribute('aria-label')).toBe('Charge limit');
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('tabindex')).toBe('0'); // focusable when enabled
  });
});
