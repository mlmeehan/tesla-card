import { describe, expect, test } from 'vitest';
import { SCENE_NODES, relativeAnchors, deriveBusAnchor, RafCoalescer } from './my-home';
import { ENERGY_ROLES } from './binding';
import { BUS_NODE_ID } from './model';
import type { RectLike } from './scene-bus';

const r = (left: number, top: number, width = 100, height = 50): RectLike => ({
  left,
  top,
  width,
  height,
});

describe('SCENE_NODES — no forked role list', () => {
  test('equals ENERGY_ROLES exactly (same order, no vehicle)', () => {
    expect([...SCENE_NODES]).toEqual([...ENERGY_ROLES]);
    expect(SCENE_NODES).not.toContain('vehicle');
  });
});

describe('relativeAnchors — viewport → container-relative', () => {
  test('subtracts the container origin; sizes pass through', () => {
    const out = relativeAnchors(r(100, 200), { solar: r(150, 260, 80, 40) });
    expect(out.solar).toEqual({ left: 50, top: 60, width: 80, height: 40 });
  });

  test('identity at the origin container', () => {
    const rects = { grid: r(10, 20, 30, 40) };
    expect(relativeAnchors(r(0, 0), rects)).toEqual(rects);
  });

  test('handles multiple anchors independently', () => {
    const out = relativeAnchors(r(5, 5), { a: r(5, 5), b: r(105, 55) });
    expect(out.a).toEqual({ left: 0, top: 0, width: 100, height: 50 });
    expect(out.b).toEqual({ left: 100, top: 50, width: 100, height: 50 });
  });
});

describe('deriveBusAnchor — the star junction', () => {
  test('undefined for no anchors', () => {
    expect(deriveBusAnchor({})).toBeUndefined();
  });

  test('zero-size rect at the centroid of present node centres', () => {
    // Two nodes: centres (50,25) and (250,25) → centroid (150,25).
    const bus = deriveBusAnchor({ solar: r(0, 0), grid: r(200, 0) });
    expect(bus).toEqual({ left: 150, top: 25, width: 0, height: 0 });
  });

  test('excludes an existing BUS_NODE_ID entry (idempotent)', () => {
    const anchors = { solar: r(0, 0), grid: r(200, 0), [BUS_NODE_ID]: r(9999, 9999) };
    const bus = deriveBusAnchor(anchors);
    expect(bus).toEqual({ left: 150, top: 25, width: 0, height: 0 });
  });
});

describe('RafCoalescer — coalesce a reflow burst into one fire', () => {
  /** A controllable fake rAF: queue callbacks; `flush()` fires them. */
  function fakeRaf() {
    const queue = new Map<number, () => void>();
    let id = 0;
    return {
      raf: (cb: () => void): number => {
        id += 1;
        queue.set(id, cb);
        return id;
      },
      caf: (handle: number): void => {
        queue.delete(handle);
      },
      flush(): void {
        const fns = [...queue.values()];
        queue.clear();
        for (const fn of fns) fn();
      },
      get size() {
        return queue.size;
      },
    };
  }

  test('N schedule calls in a frame produce exactly ONE callback', () => {
    const f = fakeRaf();
    const c = new RafCoalescer(f.raf, f.caf);
    let calls = 0;
    c.schedule(() => (calls += 1));
    c.schedule(() => (calls += 1));
    c.schedule(() => (calls += 1));
    expect(f.size).toBe(1); // only one rAF handle pending
    expect(c.pending).toBe(true);
    f.flush();
    expect(calls).toBe(1);
    expect(c.pending).toBe(false);
  });

  test('cancel prevents the pending fire', () => {
    const f = fakeRaf();
    const c = new RafCoalescer(f.raf, f.caf);
    let calls = 0;
    c.schedule(() => (calls += 1));
    expect(c.pending).toBe(true);
    c.cancel();
    expect(c.pending).toBe(false);
    f.flush();
    expect(calls).toBe(0);
  });

  test('re-arms after a fire (a later reflow schedules again)', () => {
    const f = fakeRaf();
    const c = new RafCoalescer(f.raf, f.caf);
    let calls = 0;
    c.schedule(() => (calls += 1));
    f.flush();
    expect(calls).toBe(1);
    c.schedule(() => (calls += 1)); // a new burst
    f.flush();
    expect(calls).toBe(2);
  });
});
