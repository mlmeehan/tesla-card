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
