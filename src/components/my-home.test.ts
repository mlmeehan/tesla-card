// @vitest-environment jsdom
//
// Element-level gate for the `tc-my-home` Scene orchestrator (Story 6.5).
// jsdom returns zero-sized rects, so this pins the WIRING (one renderer, one
// model, the overlay present + top + pass-through, slice-gating, reflow-driven
// geometry, teardown, honest degradation) — pixel-accurate geometry is the
// renderer's own Story-4.4 concern, already covered against stub rects.
//
// Entity ids are NEVER inlined (the [card] no-hard-coded-ids rule, hook-enforced):
// the fixture's energy ids are resolved dynamically via `resolveEnergyEntities`.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ── jsdom lacks ResizeObserver/IntersectionObserver — provide a minimal,
// inspectable ResizeObserver stub (the established jsdom pattern) and leave
// IntersectionObserver undefined so the visibility gate defaults to visible. ──
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  cb: () => void;
  observed: Element[] = [];
  disconnected = false;
  constructor(cb: () => void) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.observed.push(el);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  /** Fire the reflow callback (test-only). */
  trigger(): void {
    this.cb();
  }
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

import './my-home';
import { TcMyHome } from './my-home';
import { SceneBusRenderer } from '../flow/scene-bus';
import { resolveEnergyEntities } from '../data/energy';
import { STRINGS } from '../strings';
import awakeFx from '../fixtures/model-y-awake.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

const CONFIG: TeslaCardConfig = { type: 'tc-my-home' };
const FUTURE = '2030-01-01T00:00:00Z';

type Scene = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  getCardSize(): number;
  updateComplete: Promise<boolean>;
};

function states(fx: { states: Record<string, HassEntity> }): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(fx.states)) as Record<string, HassEntity>;
}
function makeHass(s: Record<string, HassEntity>): HomeAssistant {
  return { states: s } as unknown as HomeAssistant;
}
/** Resolve the energy ids from a states map — no inlined entity literals. */
function energyIds(s: Record<string, HassEntity>) {
  return resolveEnergyEntities(makeHass(s), CONFIG);
}
async function mount(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig = CONFIG
): Promise<Scene> {
  const el = document.createElement('tc-my-home') as Scene;
  if (hass) el.hass = hass;
  el.setConfig(config);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const sr = (el: Scene) => el.shadowRoot!;
const cellTags = (el: Scene): string[] =>
  [...sr(el).querySelectorAll<HTMLElement>('.scene-cell')].map(
    (c) => (c.firstElementChild?.tagName ?? '').toLowerCase()
  );

beforeEach(() => {
  FakeResizeObserver.instances = [];
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('AC1 — composite parent: one model, one renderer, the five Scene-unaware children', () => {
  test('renders the five present child cards from the shared hass', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(cellTags(el)).toEqual([
      'tc-solar',
      'tc-powerwall',
      'tc-grid',
      'tc-home',
      'tc-wall-connector',
    ]);
  });

  test('holds exactly ONE SceneBusRenderer and binds ONE FlowModel (all five present)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const bus = (el as unknown as { _bus: unknown })._bus;
    const model = (el as unknown as { _model: { nodes: { present: boolean }[] } })._model;
    expect(bus).toBeInstanceOf(SceneBusRenderer);
    expect(model.nodes).toHaveLength(5);
    expect(model.nodes.every((n) => n.present)).toBe(true);
  });

  test('children receive the same shared hass', async () => {
    const hass = makeHass(states(awakeFx));
    const el = await mount(hass);
    const solar = sr(el).querySelector('tc-solar') as unknown as { hass?: HomeAssistant };
    expect(solar.hass).toBe(hass);
  });
});

describe('AC3d — a single pointer-events:none bus overlay as the top layer', () => {
  test('exactly one .scene-bus overlay, and it is the LAST (top) layer', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const scene = sr(el).querySelector('.scene')!;
    const overlays = scene.querySelectorAll('.scene-bus');
    expect(overlays).toHaveLength(1);
    expect(scene.lastElementChild).toBe(overlays[0]);
  });

  test('the overlay CSS is strictly pass-through (pointer-events:none)', () => {
    const flatten = (s: unknown): string =>
      Array.isArray(s)
        ? s.map(flatten).join('\n')
        : ((s as { cssText?: string })?.cssText ?? '');
    const cssText = flatten((TcMyHome as unknown as { styles: unknown }).styles);
    expect(/\.scene-bus[\s\S]*?pointer-events:\s*none/.test(cssText)).toBe(true);
  });

  test('the overlay carries the state-bearing aria-label from the renderer', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const svg = sr(el).querySelector('.scene-bus')!;
    const label = svg.getAttribute('aria-label') ?? '';
    expect(label.length).toBeGreaterThan(0);
    expect(label).toContain(STRINGS.energy.nodes.solar); // a present node name, from the live model
  });
});

describe('AC3a/b — geometry is reflow-driven, never tick-driven', () => {
  test('an unrelated hass tick does NOT recompute geometry', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    const s = states(awakeFx);
    const slice = new Set<string | undefined>(Object.values(energyIds(s)));
    const unrelated = Object.keys(s).find((id) => !slice.has(id))!;
    s[unrelated].state = `${s[unrelated].state}-x`;
    s[unrelated].last_updated = FUTURE;
    el.hass = makeHass(s);
    await el.updateComplete;
    expect(spy).not.toHaveBeenCalled();
  });

  test('a value-only energy tick re-renders but does NOT recompute geometry', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    const s = states(awakeFx);
    const solarId = energyIds(s).solar_power!;
    s[solarId].state = '5.0';
    s[solarId].last_updated = FUTURE;
    el.hass = makeHass(s);
    await el.updateComplete;
    // present-node set unchanged ⇒ no geometry recompute on a value tick.
    expect(spy).not.toHaveBeenCalled();
  });

  test('a reflow (ResizeObserver) DOES schedule a geometry recompute', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    const ro = FakeResizeObserver.instances.at(-1)!;
    ro.trigger();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('AC3c — the child-render slice-gate covers the children FULL reads', () => {
  // Regression: the gate must re-render the Scene (→ re-pass fresh `hass` to the
  // children) on a change to ANY entity a child surfaces — not only the five
  // `*_power` sensors. SOC / reserve / mode / grid-status / WC session+plug+status
  // and the Solar weather vignette are otherwise frozen in the composed view until
  // a coincidental power tick. (Geometry stays reflow-driven; this is about data.)
  test('the slice watches the Solar weather + sun core entities (6.4 vignette)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const ids = new Set(
      (el as unknown as { _sliceIds(): (string | undefined)[] })._sliceIds()
    );
    expect(ids.has('weather.home')).toBe(true);
    expect(ids.has('sun.sun')).toBe(true);
  });

  test('the slice watches the non-power energy reads (SOC/status/mode), not just *_power', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const ids = new Set(
      (el as unknown as { _sliceIds(): (string | undefined)[] })._sliceIds()
    );
    const e = energyIds(states(awakeFx));
    // Assert only those actually resolved in the fixture (each is a SECONDARY/
    // PRIMARY child reading outside the power slice).
    for (const key of ['powerwall_level', 'grid_status', 'operation_mode', 'wc_status'] as const) {
      if (e[key]) expect(ids.has(e[key])).toBe(true);
    }
  });

  test('a non-power child entity change re-renders the composed child (not gated away)', async () => {
    const s = states(awakeFx);
    // Ensure a weather entity exists so the Solar vignette slice is live.
    s['weather.home'] = { state: 'sunny', last_updated: '2020-01-01T00:00:00Z' } as unknown as HassEntity;
    const el = await mount(makeHass(s));

    const s2 = states({ states: s } as { states: Record<string, HassEntity> });
    s2['weather.home'].state = 'cloudy';
    s2['weather.home'].last_updated = FUTURE;
    const next = makeHass(s2);
    el.hass = next;
    await el.updateComplete;

    const solar = sr(el).querySelector('tc-solar') as unknown as { hass?: HomeAssistant };
    // The weather change propagated to the Scene-unaware child — with the old
    // power-only gate this stayed the stale `hass` and the vignette froze.
    expect(solar.hass).toBe(next);
  });
});

describe('AC3/AC4 — teardown leaves nothing pending', () => {
  test('disconnectedCallback disconnects observers and cancels the coalescer', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const ro = FakeResizeObserver.instances.at(-1)!;
    el.remove();
    expect(ro.disconnected).toBe(true);
    expect((el as unknown as { _resizeObs?: unknown })._resizeObs).toBeUndefined();
    expect((el as unknown as { _coalescer: { pending: boolean } })._coalescer.pending).toBe(false);
  });
});

describe('AC4 — registration + honest degradation', () => {
  test('registered custom element with the card contract', () => {
    expect(customElements.get('tc-my-home')).toBe(TcMyHome);
    expect(TcMyHome.getStubConfig()).toEqual({ type: 'tc-my-home' });
    const el = document.createElement('tc-my-home') as Scene;
    el.setConfig(CONFIG);
    expect(el.getCardSize()).toBeGreaterThan(0);
  });

  test('setConfig(null) throws; unknown keys are tolerated (forward-compatible)', () => {
    const el = document.createElement('tc-my-home') as Scene;
    expect(() => el.setConfig(null as unknown as TeslaCardConfig)).toThrow();
    expect(() =>
      el.setConfig({ ...CONFIG, futureKey: 1 } as unknown as TeslaCardConfig)
    ).not.toThrow();
  });

  test('an absent node is omitted with its edge — no card, no anchor', async () => {
    const s = states(awakeFx);
    const batteryId = energyIds(s).battery_power!;
    delete s[batteryId]; // remove the Powerwall reading
    const el = await mount(makeHass(s));
    expect(cellTags(el)).not.toContain('tc-powerwall');
    const model = (el as unknown as { _model: { nodes: { role: string; present: boolean }[] } })._model;
    expect(model.nodes.find((n) => n.role === 'powerwall')?.present).toBe(false);
    // No powerwall anchor was fed to the renderer.
    expect((el as unknown as { _bus: SceneBusRenderer })._bus.anchorFor('powerwall')).toBeNull();
  });

  test('an essentially-empty hass renders a calm Scene — no crash, no overlay', async () => {
    const el = await mount(makeHass({}));
    expect(sr(el).querySelector('.scene')).not.toBeNull();
    expect(sr(el).querySelectorAll('.scene-cell')).toHaveLength(0);
    expect(sr(el).querySelector('.scene-bus')).toBeNull(); // empty model ⇒ omitted
  });

  test('a full site renders present-and-calm (the half-alive normal state)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(sr(el).querySelectorAll('.scene-cell').length).toBeGreaterThan(0);
    expect(sr(el).querySelector('.scene-bus')).not.toBeNull();
  });
});
