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
import { resolveEntities } from '../data/resolve';
import { buildFlowModel, type FlowInput, type FlowModel } from '../flow/model';
import type { EnergyRole } from '../data/registry';
import { STRINGS } from '../strings';
import awakeFx from '../fixtures/model-y-awake.json';
import asleepFx from '../fixtures/model-y-asleep.json';
import { wcVehicleEdge } from '../flow/my-home';
import { NODE_COLOR } from '../flow/renderer';
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
// The registered ECOSYSTEM child cards only — excludes the Story-8.5 vehicle cell
// (an inline `.scene-cell[data-node="vehicle"]` whose firstElementChild is a
// `<div class="surface">`, not a `tc-*` element). The vehicle cell is asserted
// directly by its `data-node` in the Story-8.5 suite below.
const cellTags = (el: Scene): string[] =>
  [...sr(el).querySelectorAll<HTMLElement>('.scene-cell:not([data-node="vehicle"])')].map(
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

// ═══════════════════════════════════════════════════════════════════════════
// Story 6.6 — the polished composed view: ribbon, Gateway bus, focus, reflow.
// jsdom returns zero rects, so the bus geometry pins WIRING (the Gateway trunk is
// drawn, not the star; the axis flips on reflow); pixel geometry is the pure hub's
// own concern (my-home.test.ts), proven there against synthetic anchors.
// ═══════════════════════════════════════════════════════════════════════════
const recompute = (el: Scene): void =>
  (el as unknown as { _recomputeGeometry: () => void })._recomputeGeometry();

describe('AC1 — the summary ribbon above the explicit two-row grid', () => {
  test('a .ribbon renders ABOVE the .scene-grid, carrying the aggregate labels', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const scene = sr(el).querySelector('.scene')!;
    const ribbon = scene.querySelector('.ribbon');
    const grid = scene.querySelector('.scene-grid');
    expect(ribbon).not.toBeNull();
    expect(grid).not.toBeNull();
    // ribbon comes before the grid in DOM order (above it).
    expect(ribbon!.compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const txt = ribbon!.textContent ?? '';
    expect(txt).toContain(STRINGS.scene.ribbon.generation);
    expect(txt).toContain(STRINGS.scene.ribbon.consumption);
    expect(txt).toContain(STRINGS.scene.ribbon.net);
  });

  test('the grid PACKS present cards into two centred rows (380px tracks / 80px gap, not role-fixed)', () => {
    // Story 6.7: the 6.6 role-fixed `grid-template-areas` + fixed `380px 380px
    // 380px` track (which left a 380px ghost cell for an absent node) is RETIRED
    // for present-set-driven packed row-groups — each row `grid-auto-flow:column`
    // over `380px` tracks with the `80px` bus-channel gap. The 380px card width +
    // 80px gap + the phone breakpoint are preserved; the ghost-cell source is gone.
    const flatten = (s: unknown): string =>
      Array.isArray(s)
        ? s.map(flatten).join('\n')
        : ((s as { cssText?: string })?.cssText ?? '');
    const cssText = flatten((TcMyHome as unknown as { styles: unknown }).styles);
    expect(cssText).toContain('grid-auto-columns: 380px'); // packed 380px card tracks
    expect(cssText).toContain('column-gap: 80px'); // the bus channel preserved
    expect(cssText).toContain('grid-auto-flow: column'); // pack, not place-by-area
    expect(cssText).not.toContain('auto-fit');
    // AC2 "centred canvas" — packing must CENTRE (a glance surface, not full-bleed):
    // each row centres its present cards and the column centres the rows. Without
    // this, a packed-but-left-aligned layout would silently pass the assertions above.
    expect(cssText).toContain('justify-content: center'); // each row centres its cards
    expect(cssText).toContain('align-items: center'); // the column centres the rows
    // the ghost-cell sources are retired: no fixed 3-track template, no role-fixed areas.
    expect(cssText).not.toContain('380px 380px 380px');
    expect(cssText).not.toContain('grid-template-areas');
    expect(/max-width:\s*540px/.test(cssText)).toBe(true); // phone reflow kept
  });

  test('an absent node still omits its cell + anchor (the 6.5 present-gating holds)', async () => {
    const s = states(awakeFx);
    const batteryId = energyIds(s).battery_power!;
    delete s[batteryId];
    const el = await mount(makeHass(s));
    expect(sr(el).querySelector('.scene-cell[data-node="powerwall"]')).toBeNull();
  });
});

describe('AC2 — the Gateway running-net trunk replaces the star', () => {
  test('the overlay draws the Gateway trunk (rail + flows), not the star chips', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // jsdom: zero rects, but the trunk + segments still draw
    await el.updateComplete;
    const overlay = sr(el).querySelector('.scene-bus')!;
    expect(overlay.querySelector('.gw-trunk-base')).not.toBeNull(); // the Gateway rail
    expect(overlay.querySelectorAll('.gw-leg').length).toBeGreaterThan(0); // node legs
    expect(overlay.querySelector('.sb-chip')).toBeNull(); // the star chips are retired
  });

  test('the bus aria-label still names each present node + kW (the colour-blind-safe floor)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const label = sr(el).querySelector('.scene-bus')!.getAttribute('aria-label') ?? '';
    expect(label).toContain(STRINGS.energy.nodes.solar);
    expect(label).toMatch(/kW/);
  });
});

describe('AC3 — hover/keyboard focus-highlight: dim the rest, light the coupled legs + cards', () => {
  test('focusin on a SOURCE cell adds .focus and lights the coupled LOAD cells', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const solar = sr(el).querySelector('.scene-cell[data-node="solar"]')!;
    solar.dispatchEvent(new Event('focusin', { bubbles: true }));
    await el.updateComplete;
    const scene = sr(el).querySelector('.scene')!;
    expect(scene.classList.contains('focus')).toBe(true);
    // solar (source) couples to the loads home + wall_connector, not the other sources.
    expect(sr(el).querySelector('.scene-cell[data-node="home"]')!.classList.contains('lit')).toBe(true);
    expect(
      sr(el).querySelector('.scene-cell[data-node="wall_connector"]')!.classList.contains('lit')
    ).toBe(true);
    expect(sr(el).querySelector('.scene-cell[data-node="grid"]')!.classList.contains('lit')).toBe(false);
  });

  test('focusout clears the highlight', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const solar = sr(el).querySelector('.scene-cell[data-node="solar"]')!;
    solar.dispatchEvent(new Event('focusin', { bubbles: true }));
    await el.updateComplete;
    solar.dispatchEvent(new Event('focusout', { bubbles: true }));
    await el.updateComplete;
    expect(sr(el).querySelector('.scene')!.classList.contains('focus')).toBe(false);
  });

  test('focusing a card does NOT add/remove cards (no navigation, no page change)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const before = cellTags(el);
    const solar = sr(el).querySelector('.scene-cell[data-node="solar"]')!;
    solar.dispatchEvent(new Event('mouseenter', { bubbles: true }));
    await el.updateComplete;
    expect(cellTags(el)).toEqual(before); // same cards — a dim/light, not a swap
  });

  test('cards are keyboard-focusable (tabindex=0)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const cells = [...sr(el).querySelectorAll('.scene-cell')];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.getAttribute('tabindex') === '0')).toBe(true);
  });
});

describe('AC4 — reflow: horizontal desktop bus → vertical phone bus', () => {
  test('the trunk is HORIZONTAL on a wide spread (axis x)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    inst._anchors = { solar: { left: 0, top: 0, width: 100, height: 50 }, home: { left: 400, top: 0, width: 100, height: 50 }, bus: { left: 250, top: 25, width: 0, height: 0 } };
    inst._axis = 'x';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    const trunk = sr(el).querySelector('.gw-trunk-base')!;
    expect(trunk.getAttribute('y1')).toBe(trunk.getAttribute('y2')); // constant y ⇒ horizontal
  });

  test('the trunk RE-ROUTES vertical on a tall spread (axis y — the ≤540px reflow)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    inst._anchors = { solar: { left: 0, top: 0, width: 100, height: 50 }, home: { left: 0, top: 400, width: 100, height: 50 }, bus: { left: 50, top: 225, width: 0, height: 0 } };
    inst._axis = 'y';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    const trunk = sr(el).querySelector('.gw-trunk-base')!;
    expect(trunk.getAttribute('x1')).toBe(trunk.getAttribute('x2')); // constant x ⇒ vertical
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 6.7 — arbitrary-topology tolerance: the element renders correctly for ANY
// subset (minimal Grid+Home → full five), packs the present cards into the two
// centred rows with NO ghost cell, and keeps the desktop bus horizontal even at
// the minimal topology (the axis follows the breakpoint, not the raw spread).
// ═══════════════════════════════════════════════════════════════════════════

/** node-id → child-card tag (mirrors the element's NODE_TAG; the present-cell order proof). */
const TAG: Readonly<Record<EnergyRole, string>> = {
  solar: 'tc-solar',
  powerwall: 'tc-powerwall',
  grid: 'tc-grid',
  home: 'tc-home',
  wall_connector: 'tc-wall-connector',
};
/** The five role → its `*_power` resolution key (drop it to make the node absent). */
const POWER_KEY_OF: Readonly<Record<EnergyRole, keyof ReturnType<typeof energyIds>>> = {
  solar: 'solar_power',
  powerwall: 'battery_power',
  grid: 'grid_power',
  home: 'load_power',
  wall_connector: 'wc_power',
};
const ALL_ROLES: readonly EnergyRole[] = ['solar', 'powerwall', 'grid', 'home', 'wall_connector'];
const SOURCES: readonly EnergyRole[] = ['solar', 'powerwall', 'grid'];
const LOADS: readonly EnergyRole[] = ['home', 'wall_connector'];

/** A hass whose present energy nodes are exactly `roles` — absent ones have their power sensor dropped. */
function subsetHass(roles: readonly EnergyRole[]): HomeAssistant {
  const s = states(awakeFx);
  const e = energyIds(s);
  for (const role of ALL_ROLES) {
    if (roles.includes(role)) continue;
    const id = e[POWER_KEY_OF[role]];
    if (id) delete s[id];
  }
  return makeHass(s);
}
/** Drive `_recomputeGeometry` with a mocked container width (jsdom gives zero rects). */
function recomputeAtWidth(el: Scene, width: number): void {
  const sceneEl = (el as unknown as { _scene: HTMLElement })._scene;
  sceneEl.getBoundingClientRect = () =>
    ({ width, height: 400, left: 0, top: 0, right: width, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  (el as unknown as { _recomputeGeometry(): void })._recomputeGeometry();
}
const sourceRowCells = (el: Scene): Element[] => [...sr(el).querySelectorAll('.source-row .scene-cell')];
// Energy LOAD cards only — excludes the Story-8.5 vehicle cell appended to the load row.
const loadRowCells = (el: Scene): Element[] =>
  [...sr(el).querySelectorAll('.load-row .scene-cell:not([data-node="vehicle"])')];

describe('Story 6.7 — the exhaustive minimal→full topology sweep (AC1, AC2)', () => {
  const SUBSETS: ReadonlyArray<{ name: string; roles: EnergyRole[] }> = [
    { name: 'minimal Grid+Home', roles: ['grid', 'home'] },
    { name: 'Grid+Home+Solar', roles: ['solar', 'grid', 'home'] },
    { name: 'Powerwall+Home (islanding shape)', roles: ['powerwall', 'home'] },
    { name: 'Solar+Powerwall+Grid+Home', roles: ['solar', 'powerwall', 'grid', 'home'] },
    { name: 'full five', roles: [...ALL_ROLES] },
  ];

  for (const { name, roles } of SUBSETS) {
    const present = ALL_ROLES.filter((r) => roles.includes(r)); // canonical order
    const presentSources = SOURCES.filter((r) => roles.includes(r));
    const presentLoads = LOADS.filter((r) => roles.includes(r));

    test(`${name}: renders ONLY the present cards, packed in canonical order — no ghost cell`, async () => {
      const el = await mount(subsetHass(roles));
      // The present cells, in canonical (sources-then-loads) order — and ONLY them.
      expect(cellTags(el)).toEqual(present.map((r) => TAG[r]));
      // Count the ECOSYSTEM cells only (the awake fixture's vehicle cell is appended
      // to the load row in every subset — it is asserted separately in Story 8.5).
      expect(sr(el).querySelectorAll('.scene-cell:not([data-node="vehicle"])')).toHaveLength(
        present.length
      );
      // No cell — and no anchor target — for any absent role (no dead `veh` slot).
      for (const role of ALL_ROLES) {
        const cell = sr(el).querySelector(`.scene-cell[data-node="${role}"]`);
        if (roles.includes(role)) expect(cell).not.toBeNull();
        else expect(cell).toBeNull();
      }
    });

    test(`${name}: each row packs exactly its present cards (no dead column)`, async () => {
      const el = await mount(subsetHass(roles));
      // A row with no present card is omitted entirely (no empty row eating the channel).
      expect(sourceRowCells(el)).toHaveLength(presentSources.length);
      expect(loadRowCells(el)).toHaveLength(presentLoads.length);
      if (presentSources.length === 0)
        expect(sr(el).querySelector('.source-row')).toBeNull();
      if (presentLoads.length === 0) expect(sr(el).querySelector('.load-row')).toBeNull();
    });

    test(`${name}: the bus overlay is present and names ONLY present nodes`, async () => {
      const el = await mount(subsetHass(roles));
      const overlay = sr(el).querySelector('.scene-bus');
      expect(overlay).not.toBeNull(); // ≥1 present node ⇒ an active overlay
      const label = overlay!.getAttribute('aria-label') ?? '';
      for (const role of ALL_ROLES) {
        const nodeName = STRINGS.energy.nodes[role];
        if (roles.includes(role)) expect(label).toContain(nodeName);
        else expect(label).not.toContain(nodeName);
      }
    });

    // AC2 "sources (solar·powerwall·grid) row OVER loads (home·wall_connector) row" —
    // the structural ordering the packing must preserve. jsdom applies no stylesheet
    // so this is a DOM-order proof (the e2e layer proves it as real geometry); when
    // BOTH rows are present the source row must come first in the DOM.
    if (presentSources.length > 0 && presentLoads.length > 0) {
      test(`${name}: the .source-row renders BEFORE the .load-row (sources over loads)`, async () => {
        const el = await mount(subsetHass(roles));
        const sourceRow = sr(el).querySelector('.source-row')!;
        const loadRow = sr(el).querySelector('.load-row')!;
        expect(sourceRow).not.toBeNull();
        expect(loadRow).not.toBeNull();
        // source-row precedes load-row in document order (it is laid out above it).
        expect(
          sourceRow.compareDocumentPosition(loadRow) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      });
    }
  }
});

describe('Story 6.7 — desktop bus stays HORIZONTAL at the minimal topology (axis follows the breakpoint)', () => {
  test('minimal Grid+Home packed at a WIDE container width keeps _axis = x (desktop horizontal)', async () => {
    const el = await mount(subsetHass(['grid', 'home']));
    recomputeAtWidth(el, 1100);
    expect((el as unknown as { _axis: string })._axis).toBe('x');
  });

  test('the SAME minimal topology at a ≤540px container flips _axis = y (the phone re-route)', async () => {
    const el = await mount(subsetHass(['grid', 'home']));
    recomputeAtWidth(el, 460);
    expect((el as unknown as { _axis: string })._axis).toBe('y');
  });

  test('the full topology also stays horizontal on a wide container', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recomputeAtWidth(el, 1100);
    expect((el as unknown as { _axis: string })._axis).toBe('x');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 6.7 — half-alive = NORMAL (AC3): a mixed-freshness Scene is calm, not
// broken. The ribbon dims ONLY when FULLY quiescent (a partial-quiescent Scene
// must NOT understate its live half); a fully-quiescent Scene dims + stamps the
// last-known age; an empty / single-node model never crashes.
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 6.7 — half-alive Scene is the normal calm state (AC3)', () => {
  const measured = (role: EnergyRole, kW: number): FlowInput => ({ role, kW, provenance: 'measured' });
  const quiescent = (role: EnergyRole, kW: number): FlowInput => ({ role, kW, provenance: 'quiescent' });
  const absent = (role: EnergyRole): FlowInput => ({ role, kW: undefined, provenance: 'measured' });
  /** Inject a model directly (the 6.6 geometry-test pattern) + force a re-render. */
  async function withModel(el: Scene, model: FlowModel): Promise<void> {
    (el as unknown as { _model: FlowModel })._model = model;
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
  }
  const ribbonOf = (el: Scene) => sr(el).querySelector('.ribbon');

  test('a PARTIALLY-quiescent Scene is NOT wholesale-dimmed (the live half stays confident)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    await withModel(
      el,
      buildFlowModel([
        measured('solar', 3),
        measured('home', 4),
        quiescent('wall_connector', 0.5),
        absent('powerwall'),
        absent('grid'),
      ])
    );
    const ribbon = ribbonOf(el);
    expect(ribbon).not.toBeNull();
    expect(ribbon!.classList.contains('dim')).toBe(false); // partial quiescence ⇒ confident
    expect(sr(el).querySelector('.ribbon-age')).toBeNull(); // no overstated age stamp
  });

  test('a FULLY-quiescent Scene IS dimmed and stamps the last-known age (honest freshness)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    await withModel(
      el,
      buildFlowModel([
        quiescent('solar', 3),
        quiescent('home', 4),
        absent('powerwall'),
        absent('grid'),
        absent('wall_connector'),
      ])
    );
    const ribbon = ribbonOf(el);
    expect(ribbon).not.toBeNull();
    expect(ribbon!.classList.contains('dim')).toBe(true); // fully quiescent ⇒ de-emphasized
    expect(sr(el).querySelector('.ribbon-age')).not.toBeNull(); // last-known "updated Nm ago"
  });

  test('a single-node model renders calm — one card, no crash', async () => {
    const el = await mount(subsetHass(['home']));
    expect(cellTags(el)).toEqual(['tc-home']);
    expect(sr(el).querySelector('.scene')).not.toBeNull(); // calm, present
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.5 — the vehicle node: a compact, present-gated load-row cell + the
// WC→Vehicle overlay edge, both fed by the ONE wcVehicleEdge view (AC2 agree-by-
// construction); calm-not-broken when asleep (AC3); omitted with its edge when
// the car is absent (AC4); and NO new registered element (AC5).
// ═══════════════════════════════════════════════════════════════════════════
const vehCell = (el: Scene): Element | null =>
  sr(el).querySelector('.scene-cell[data-node="vehicle"]');
const vehEdge = (el: Scene): Element | null =>
  sr(el).querySelector('.scene-bus [data-role="vehicle"]');
/** The battery entity id (resolved, never inlined) — drop it to make the car absent. */
function batteryId(s: Record<string, HassEntity>): string {
  return resolveEntities(makeHass(s), CONFIG).battery_level;
}

describe('Story 8.5 — AC1: the vehicle is the sixth, packed load-row cell', () => {
  test('a present car renders a compact vehicle cell LAST in the load row (no ghost cell)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const veh = vehCell(el);
    expect(veh).not.toBeNull();
    // It lives in the load row, after Home · Wall Connector.
    const loadCells = [...sr(el).querySelectorAll('.load-row .scene-cell')];
    expect(loadCells.at(-1)!.getAttribute('data-node')).toBe('vehicle');
    // Compact read: name + battery % + range.
    expect(veh!.textContent).toContain(STRINGS.hero.defaultName);
    expect(veh!.querySelector('.veh-pct')!.textContent).toContain('72'); // battery_level
    // Keyboard-focusable, same as the ecosystem cells.
    expect(veh!.getAttribute('tabindex')).toBe('0');
  });

  test('the seven-element registration contract is UNCHANGED (no new tc-vehicle element)', () => {
    // The cell is inline markup — assert no vehicle element snuck into the registry.
    expect(customElements.get('tc-vehicle')).toBeUndefined();
    expect(customElements.get('tc-my-home')).toBe(TcMyHome);
  });
});

describe('Story 8.5 — AC2: the WC edge IS the car-charging edge (agree by construction)', () => {
  test('the cell shows "Charging · N.N kW" = |wcVehicleEdge(model).kW|, and the overlay edge flows', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate anchors (jsdom: zero rects, but the edge still draws)
    await el.updateComplete;
    const model = (el as unknown as { _model: FlowModel })._model;
    const ch = wcVehicleEdge(model);
    expect(ch.active).toBe(true);
    const veh = vehCell(el)!;
    expect(veh.textContent).toContain(STRINGS.status.charging);
    // The shown kW magnitude is the WC edge magnitude (agreement, the #1 assertion).
    expect(veh.textContent).toContain(`${ch.kW.toFixed(1)} ${STRINGS.scene.ribbon.unit}`);
    // The overlay edge is present AND animated (sb-flow) — agrees with the badge.
    const edge = vehEdge(el)!;
    expect(edge).not.toBeNull();
    expect(edge.querySelector('.gw-leg-base')).not.toBeNull(); // calm base always
    expect(edge.querySelector('.sb-flow')).not.toBeNull(); // active ⇒ animated dash
  });

  test('a sub-deadband WC ⇒ the cell is NOT charging AND the overlay edge is base-only', async () => {
    const s = states(awakeFx);
    const wcId = energyIds(s).wc_power!;
    s[wcId].state = '0'; // WC idle → edge direction:none
    const el = await mount(makeHass(s));
    recompute(el);
    await el.updateComplete;
    const model = (el as unknown as { _model: FlowModel })._model;
    expect(wcVehicleEdge(model).active).toBe(false);
    const veh = vehCell(el)!;
    expect(veh.textContent).not.toContain(STRINGS.status.charging);
    const edge = vehEdge(el)!;
    expect(edge.querySelector('.gw-leg-base')).not.toBeNull(); // still a calm base
    expect(edge.querySelector('.sb-flow')).toBeNull(); // quiescent — no motion
  });
});

describe('Story 8.5 — AC3: half-alive (asleep) is calm, not broken', () => {
  test('asleep car: battery —, an "updated … ago" stamp, and a quiescent WC→Vehicle edge', async () => {
    const s = states(asleepFx);
    // Half-alive: local energy is LIVE while the car sleeps. Advance one live energy
    // stamp so referenceNow moves past the asleep battery's stamp → an honest age.
    const wcId = energyIds(s).wc_power!;
    s[wcId].last_updated = '2026-06-15T15:31:00Z';
    const el = await mount(makeHass(s));
    recompute(el);
    await el.updateComplete;
    const veh = vehCell(el);
    expect(veh).not.toBeNull(); // present (battery reads 'unavailable', which IS present)
    expect(veh!.querySelector('.veh-pct')!.textContent).toContain('—'); // no fabricated %
    const stamp = veh!.querySelector('.veh-age');
    expect(stamp).not.toBeNull();
    expect(stamp!.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp!.textContent).toContain(STRINGS.hero.updatedPrefix); // "updated Nm ago"
    expect(veh!.textContent).not.toContain(STRINGS.status.charging); // never a false charge
    // The WC→Vehicle edge degrades to its calm base line — no motion.
    const edge = vehEdge(el)!;
    expect(edge.querySelector('.gw-leg-base')).not.toBeNull();
    expect(edge.querySelector('.sb-flow')).toBeNull();
  });
});

describe('Story 8.5 — AC4: arbitrary-topology + the full-union slice-gate', () => {
  test('an absent car omits the cell AND its WC→Vehicle edge; the rest is unchanged', async () => {
    const s = states(awakeFx);
    delete s[batteryId(s)]; // remove the vehicle battery entity entirely
    const el = await mount(makeHass(s));
    recompute(el);
    await el.updateComplete;
    expect(vehCell(el)).toBeNull(); // no cell
    expect(vehEdge(el)).toBeNull(); // no WC→Vehicle edge
    // The energy Scene is intact (the five ecosystem cards still render).
    expect(cellTags(el)).toEqual(['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector']);
  });

  test('the slice-gate watches the vehicle read ids (the 6.5 full-union lesson)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const ids = new Set(
      (el as unknown as { _sliceIds(): (string | undefined)[] })._sliceIds()
    );
    const e = resolveEntities(makeHass(states(awakeFx)), CONFIG);
    for (const key of ['battery_level', 'charging_status', 'battery_range', 'status'] as const) {
      expect(ids.has(e[key])).toBe(true);
    }
  });

  test('a battery_level tick re-renders the cell (vehicle read in the slice)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const s = states(awakeFx);
    const bId = batteryId(s);
    s[bId].state = '55';
    s[bId].last_updated = FUTURE;
    el.hass = makeHass(s);
    await el.updateComplete;
    // The cell updated — with a *_power-only gate it would have frozen at 72 (the 6.5 bug).
    expect(vehCell(el)!.querySelector('.veh-pct')!.textContent).toContain('55');
  });

  test('truly-unrelated vehicle entities (climate/doors) stay OUT of the slice (anti-thrash)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const ids = new Set(
      (el as unknown as { _sliceIds(): (string | undefined)[] })._sliceIds()
    );
    const e = resolveEntities(makeHass(states(awakeFx)), CONFIG);
    // These render NOWHERE in the Scene → must not be in the union (else the gate
    // would thrash the whole composition on irrelevant churn).
    expect(ids.has(e.lock)).toBe(false);
    expect(ids.has(e.inside_temp)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.6 — the ENRICHED Gateway bus: each present leg (incl. the Story-8.5
// WC→Vehicle edge) gains a kW pill at its midpoint, a terminal at its card end,
// and (for trunk legs) a tap at its trunk end — all from the SAME shared
// FlowModel (no second engine), all STATIC SVG inside the `.gw-leg` group (so
// focus dim/light + reduced-motion are inherited by construction).
// ═══════════════════════════════════════════════════════════════════════════
const U = STRINGS.scene.ribbon.unit;
/** Energy node legs only (excludes the WC→Vehicle overlay edge). */
const energyLegs = (el: Scene): Element[] =>
  [...sr(el).querySelectorAll('.scene-bus .gw-leg:not([data-role="vehicle"])')];
const legOf = (el: Scene, role: string): Element | null =>
  sr(el).querySelector(`.scene-bus .gw-leg[data-role="${role}"]`);
const pillTxt = (group: Element | null): string =>
  group?.querySelector('.gw-pill-txt')?.textContent?.trim() ?? '';
/** Inject a model directly + force a re-render (the 6.6/6.7 geometry-test pattern). */
async function injectModel(el: Scene, model: FlowModel): Promise<void> {
  (el as unknown as { _model: FlowModel })._model = model;
  (el as unknown as { requestUpdate(): void }).requestUpdate();
  await el.updateComplete;
}

describe('Story 8.6 — AC1: every present leg carries a kW pill from the SHARED model', () => {
  test('each energy leg has a `.gw-pill-txt` reading |edge.kW| N.N kW (the same value the flow uses)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate anchors (jsdom: zero rects, but the legs still draw)
    await el.updateComplete;
    const legs = energyLegs(el);
    expect(legs.length).toBeGreaterThan(0);
    // Every leg carries exactly one pill (a present node always has an edge).
    expect(legs.every((g) => g.querySelector('.gw-pill-txt') !== null)).toBe(true);
    // The pill text equals the node's OWN edge magnitude — never a recomputed value.
    const model = (el as unknown as { _model: FlowModel })._model;
    const edgeByRole = new Map(model.edges.map((e) => [e.from, e]));
    for (const role of ['solar', 'powerwall', 'grid', 'home', 'wall_connector'] as const) {
      const edge = edgeByRole.get(role);
      if (!edge) continue;
      const expected = `${Math.abs(edge.kW).toFixed(1)} ${U}`;
      expect(pillTxt(legOf(el, role))).toBe(expected);
    }
  });

  test('the pill background is a token fill + the text uses the node accent (no new raw hex)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const solarLeg = legOf(el, 'solar')!;
    // bg present (a flat rect, not a gradient) and text coloured inline by the accent.
    expect(solarLeg.querySelector('.gw-pill-bg')).not.toBeNull();
    expect(solarLeg.querySelector('.gw-pill-txt')!.getAttribute('style')).toContain('fill:');
  });
});

describe('Story 8.6 — AC1: terminals at the card end + taps at the trunk end', () => {
  test('each energy leg has a terminal ring (`.gw-term`) and a trunk tap (`.gw-tap`)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    for (const leg of energyLegs(el)) {
      expect(leg.querySelectorAll('.gw-term').length).toBe(1); // one card-end terminal
      expect(leg.querySelector('.gw-tap')).not.toBeNull(); // one trunk tap
    }
  });

  test('the WC→Vehicle leg has TWO terminals (both card ends) and NO tap', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const edge = vehEdge(el)!;
    expect(edge).not.toBeNull();
    expect(edge.querySelectorAll('.gw-term').length).toBe(2); // one per card end
    expect(edge.querySelector('.gw-tap')).toBeNull(); // never touches the trunk
  });
});

describe('Story 8.6 — AC2: the pill is honest — never a fabricated magnitude', () => {
  test('a sub-deadband leg reads 0.0 kW (its true, calm reading — no flow dash)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    (el as unknown as { _anchors: Record<string, unknown> })._anchors = {
      home: { left: 0, top: 100, width: 100, height: 50 },
      grid: { left: 0, top: 0, width: 100, height: 50 },
      bus: { left: 50, top: 75, width: 0, height: 0 },
    };
    await injectModel(
      el,
      buildFlowModel([
        { role: 'home', kW: 0.02, provenance: 'measured' }, // sub-IDLE_KW ⇒ calm
        { role: 'grid', kW: 5, provenance: 'measured' },
      ])
    );
    const home = legOf(el, 'home')!;
    expect(pillTxt(home)).toBe(`0.0 ${U}`); // honest calm value
    expect(home.querySelector('.sb-flow')).toBeNull(); // no flow dash on the calm leg
  });

  test('an absent node has no leg AND no pill (nothing to label)', async () => {
    const s = states(awakeFx);
    const batteryPowerId = energyIds(s).battery_power!;
    delete s[batteryPowerId]; // drop the Powerwall power sensor ⇒ node absent
    const el = await mount(makeHass(s));
    recompute(el);
    await el.updateComplete;
    expect(legOf(el, 'powerwall')).toBeNull(); // no leg
    expect(sr(el).querySelector('.gw-leg[data-role="powerwall"] .gw-pill-txt')).toBeNull(); // no pill
  });
});

describe('Story 8.6 — AC3: focus lights the coupled legs AND their enriched pills', () => {
  test('focusin on a SOURCE lights its coupled load legs (with pills); the rest do not', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const solar = sr(el).querySelector('.scene-cell[data-node="solar"]')!;
    solar.dispatchEvent(new Event('focusin', { bubbles: true }));
    await el.updateComplete;
    // solar (source) couples to the loads; the coupled legs light, with their pills inside.
    const homeLeg = legOf(el, 'home')!;
    expect(homeLeg.classList.contains('on')).toBe(true);
    expect(homeLeg.querySelector('.gw-pill-txt')).not.toBeNull(); // the pill rides the lit leg
    // a non-coupled source leg stays un-lit.
    expect(legOf(el, 'grid')!.classList.contains('on')).toBe(false);
    // releasing focus clears it.
    solar.dispatchEvent(new Event('focusout', { bubbles: true }));
    await el.updateComplete;
    expect(legOf(el, 'home')!.classList.contains('on')).toBe(false);
  });
});

describe('Story 8.6 — AC4: reduced-motion keeps the data — static decorations, no new animation', () => {
  test('the pill/terminal/tap CSS introduces no animation or keyframe', () => {
    const flatten = (s: unknown): string =>
      Array.isArray(s)
        ? s.map(flatten).join('\n')
        : ((s as { cssText?: string })?.cssText ?? '');
    const cssText = flatten((TcMyHome as unknown as { styles: unknown }).styles);
    // The decorations are STATIC SVG — no keyframe was authored for them.
    expect(cssText).not.toMatch(/@keyframes\s+gw-/);
    // None of the decoration rules carry an `animation` property.
    for (const rule of ['.gw-pill-bg', '.gw-pill-txt', '.gw-term', '.gw-tap']) {
      const idx = cssText.indexOf(rule);
      if (idx === -1) continue;
      const block = cssText.slice(idx, cssText.indexOf('}', idx));
      expect(block).not.toContain('animation');
    }
  });

  test('the decorations render identically regardless of the dash-freeze (markup is static)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    // The pills/terminals/taps are present and carry no inline animation — the dash
    // freeze (covered by the existing sceneBusStyles reduced-motion test) removes the
    // motion, never the data.
    const solarLeg = legOf(el, 'solar')!;
    expect(solarLeg.querySelector('.gw-pill-txt')).not.toBeNull();
    expect(solarLeg.querySelector('.gw-term')).not.toBeNull();
    expect(solarLeg.querySelector('.gw-tap')).not.toBeNull();
    expect(solarLeg.querySelector('.gw-pill-txt')!.getAttribute('style')).not.toContain('animation');
  });
});

describe('Story 8.6 — AC1: the WC→Vehicle pill agrees with the cell by construction', () => {
  test('the vehicle leg pill = |wcVehicleEdge(model).kW| N.N kW = the cell "Charging · N.N kW"', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const model = (el as unknown as { _model: FlowModel })._model;
    const ch = wcVehicleEdge(model);
    expect(ch.active).toBe(true);
    const expected = `${Math.abs(ch.kW).toFixed(1)} ${U}`;
    // The overlay pill and the cell badge both read the ONE wcVehicleEdge view.
    expect(pillTxt(vehEdge(el))).toBe(expected);
    expect(vehCell(el)!.textContent).toContain(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.6 — QA gap coverage (qa-generate-e2e-tests): honesty + a11y branches
// the AC text requires that the dev suite above does not yet assert directly:
//   • AC1 — the terminal RING + the tap DOT carry the node accent (NODE_COLOR),
//     not just the pill text (the colour-blind cue must be the WHOLE leg).
//   • AC2 — a non-finite (`unavailable`) power read must NEVER surface a
//     "NaN kW" pill (a DISTINCT path from a deleted sensor: the sensor is
//     present but unreadable, exercising bindFlowModel's NaN-safe coercion).
//   • AC3 — HOVER (`mouseenter`) — not only `focusin` — must light the coupled
//     leg AND its pill, and `mouseleave` must clear it ("hover OR keyboard").
//   • AC4 — every pill text is a NUMBER (the colour-blind-safe magnitude floor,
//     UX-DR12 "never hue-only") — the whole point of the kW pill with motion off.
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 8.6 — AC1 (gap): the terminal ring + the tap dot carry the node accent', () => {
  test('a leg`s `.gw-term` stroke and `.gw-tap` fill are NODE_COLOR[role], not bare', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const solarLeg = legOf(el, 'solar')!;
    const term = solarLeg.querySelector('.gw-term')!;
    const tap = solarLeg.querySelector('.gw-tap')!;
    // The accent is the whole-leg colour cue (UX-DR12), set INLINE from NODE_COLOR.
    expect(term.getAttribute('style')).toContain(`stroke:${NODE_COLOR.solar}`);
    expect(tap.getAttribute('style')).toContain(`fill:${NODE_COLOR.solar}`);
  });
});

describe('Story 8.6 — AC2 (gap): a non-finite power read never surfaces a "NaN kW" pill', () => {
  test('an `unavailable` power sensor degrades to an absent node (no leg, no pill), never NaN', async () => {
    const s = states(awakeFx);
    const solarPowerId = energyIds(s).solar_power!;
    // Sensor PRESENT but unreadable — the distinct bindFlowModel NaN-safe path
    // (vs the existing test that DELETES the sensor). A non-finite read ⇒ kW
    // undefined ⇒ `present:false` ⇒ no leg and no pill (never "NaN kW").
    s[solarPowerId] = { ...s[solarPowerId], state: 'unavailable' };
    const el = await mount(makeHass(s));
    recompute(el);
    await el.updateComplete;
    expect(legOf(el, 'solar')).toBeNull(); // absent node ⇒ no leg
    // And NO pill anywhere ever reads a fabricated "NaN" magnitude.
    const allPills = [...sr(el).querySelectorAll('.gw-pill-txt')].map((p) => p.textContent ?? '');
    expect(allPills.some((t) => /NaN/i.test(t))).toBe(false);
  });
});

describe('Story 8.6 — AC3 (gap): HOVER (mouseenter) lights the coupled leg + its pill', () => {
  test('mouseenter on a SOURCE lights its coupled load leg (with pill); mouseleave clears it', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const solar = sr(el).querySelector('.scene-cell[data-node="solar"]')!;
    solar.dispatchEvent(new Event('mouseenter', { bubbles: true }));
    await el.updateComplete;
    const homeLeg = legOf(el, 'home')!;
    expect(homeLeg.classList.contains('on')).toBe(true);
    expect(homeLeg.querySelector('.gw-pill-txt')).not.toBeNull(); // the pill rides the lit leg
    expect(legOf(el, 'grid')!.classList.contains('on')).toBe(false); // non-coupled stays dim
    solar.dispatchEvent(new Event('mouseleave', { bubbles: true }));
    await el.updateComplete;
    expect(legOf(el, 'home')!.classList.contains('on')).toBe(false);
  });
});

describe('Story 8.6 — AC4 (gap): every pill text is a NUMBER (the colour-blind-safe floor)', () => {
  test('each present leg`s pill text carries a digit — the magnitude reads without hue', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const pills = [...energyLegs(el), vehEdge(el)]
      .filter((g): g is Element => g !== null)
      .map((g) => pillTxt(g));
    expect(pills.length).toBeGreaterThan(0);
    // UX-DR12: with motion off the leg reads from this NUMBER, never hue alone.
    expect(pills.every((t) => /\d/.test(t) && t.endsWith(U))).toBe(true);
  });
});
