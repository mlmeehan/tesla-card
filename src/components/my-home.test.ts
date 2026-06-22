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
import type { EnergyRole, Role } from '../data/registry';
import { STRINGS } from '../strings';
import awakeFx from '../fixtures/model-y-awake.json';
import asleepFx from '../fixtures/model-y-asleep.json';
import { wcVehicleEdge, selfPowered, ribbonTiles } from '../flow/my-home';
import { computeBalance } from '../flow/balance';
import { formatNumber } from '../helpers';
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
// The registered ECOSYSTEM child cards only — excludes the Story-8.5/8.10 vehicle cell
// (a `.scene-cell[data-node="vehicle"]`, the trailing load-row cell embedding the
// compact `tesla-card`, not a `tc-*` ecosystem element). The vehicle cell is asserted
// directly by its `data-node` in the Story-8.5/8.10 suite below.
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

/**
 * Flush the mount's pending rAF-coalesced geometry pass (firstUpdated → _scheduleGeometry →
 * RafCoalescer.schedule(requestAnimationFrame(_recomputeGeometry))) so a late fire cannot
 * clobber fields injected afterwards. jsdom provides a real (timer-backed) rAF; the pending
 * mount frame was scheduled first, so awaiting one frame drains it, and RafCoalescer fires
 * once per schedule (it never re-arms) ⇒ nothing is left pending. Reusable by any test that
 * injects `_anchors`/`_axis` after mount.
 */
const flushGeometry = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe('AC1 — the summary ribbon above the explicit two-row grid', () => {
  test('a .ribbon renders ABOVE the .scene-grid, leading with the self-powered cap + a tile label (Story 8.7)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const scene = sr(el).querySelector('.scene')!;
    const ribbon = scene.querySelector('.ribbon');
    const grid = scene.querySelector('.scene-grid');
    expect(ribbon).not.toBeNull();
    expect(grid).not.toBeNull();
    // ribbon comes before the grid in DOM order (above it).
    expect(ribbon!.compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Story 8.7: the lead cap + at least one per-node tile label (the Gen/Cons/Net
    // trio was REPLACED by the self-powered lead + per-node tiles).
    const txt = ribbon!.textContent ?? '';
    expect(txt).toContain(STRINGS.scene.ribbon.selfPowered);
    expect(txt).toContain(STRINGS.scene.ribbon.tile.home);
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
// Energy LOAD cards only. Since Story 8.10 the vehicle is the TRAILING load-row cell
// again, so the `:not([data-node="vehicle"])` scoping is load-bearing here — it keeps
// these energy-topology assertions about Home · Wall Connector only (the vehicle is
// asserted directly in the Story-8.5/8.10 suite below).
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
      // Count the ECOSYSTEM cells only (since Story 8.10 the awake fixture's vehicle cell
      // is the trailing load-row cell — it is asserted separately in the Story 8.10 suite).
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
// Story 8.5/8.10 — the vehicle node: a present-gated TRAILING load-row cell (Story
// 8.10 reverts 8.9's own-row band) that REUSES the detailed `tesla-card` in compact
// variant (hero + status only) + the WC→Vehicle overlay edge (a horizontal in-line line)
// fed by the ONE wcVehicleEdge view (AC2 agree-by-construction); the embedded card owns
// its own calm-not-broken asleep read (AC3); omitted with its edge when the car is absent
// (AC4); and NO NEW registered element — it reuses the existing `tesla-card` (AC5).
// ═══════════════════════════════════════════════════════════════════════════
const vehCell = (el: Scene): Element | null =>
  sr(el).querySelector('.scene-cell[data-node="vehicle"]');
const vehEdge = (el: Scene): Element | null =>
  sr(el).querySelector('.scene-bus [data-role="vehicle"]');
/** The battery entity id (resolved, never inlined) — drop it to make the car absent. */
function batteryId(s: Record<string, HassEntity>): string {
  return resolveEntities(makeHass(s), CONFIG).battery_level;
}

// A minimal stub `tesla-card` so the imperatively-created embed UPGRADES and its
// `setConfig` fires in jsdom (the real card is intentionally NOT imported here — that
// would pull the whole bundle into this element-level suite). The stub records the
// config it receives so we can assert the My-Home embed injects `variant: 'compact'`
// (Story 8.10 AC5) without coupling to the real card's internal render. It renders
// nothing, so the `.veh-cell` DOM is identical to the un-upgraded baseline.
let lastEmbedConfig: (TeslaCardConfig & { variant?: string }) | undefined;
class TeslaCardEmbedStub extends HTMLElement {
  hass?: unknown;
  setConfig(config: TeslaCardConfig & { variant?: string }): void {
    lastEmbedConfig = { ...config };
  }
}
if (!customElements.get('tesla-card')) {
  customElements.define('tesla-card', TeslaCardEmbedStub);
}

describe('Story 8.10 — AC1/AC5: the vehicle is the trailing load-row cell embedding the compact card', () => {
  // Reset the module-global stub recorder BEFORE each test so the AC5 `variant` assertion
  // reads THIS mount's embed config — never a stale value left by a prior mount (the global
  // `afterEach` clears the DOM but not this `let`, so a vehicle-absent test could otherwise
  // leave `'compact'` behind and false-green a test where setConfig never fired).
  beforeEach(() => {
    lastEmbedConfig = undefined;
  });

  test('a present car renders the tesla-card as the LAST load-row cell (no .vehicle-row band, no ghost)', async () => {
    // `mount` renders a fresh my-home → `_vehicleDetailCard()` fires `setConfig` once,
    // so `lastEmbedConfig` reflects THIS mount's embed config.
    const el = await mount(makeHass(states(awakeFx)));
    const veh = vehCell(el);
    expect(veh).not.toBeNull();
    // It IS a load-row cell again (Story 8.10 reverts 8.9's own-row band).
    const inLoad = sr(el).querySelector('.load-row .scene-cell[data-node="vehicle"]');
    expect(inLoad).not.toBeNull();
    expect(inLoad).toBe(veh);
    // …and it is the LAST load-row cell (after Home · Wall Connector).
    const loadCells = [...sr(el).querySelectorAll('.load-row > .scene-cell')];
    expect(loadCells[loadCells.length - 1]).toBe(veh);
    // There is NO `.vehicle-row` band element anymore.
    expect(sr(el).querySelector('.vehicle-row')).toBeNull();
    // It REUSES the registered `tesla-card` element (no new tc-vehicle), exactly as the
    // energy cells reuse `tc-*`.
    expect(veh!.querySelector('tesla-card')).not.toBeNull();
    // The embed is fed `variant: 'compact'` (AC5) — a standalone card stays full.
    expect(lastEmbedConfig?.variant).toBe('compact');
    // Keyboard-focusable, same as the ecosystem cells (the a11y floor).
    expect(veh!.getAttribute('tabindex')).toBe('0');
  });

  test('the seven-element registration contract is UNCHANGED (no new tc-vehicle element)', () => {
    // The vehicle reuses the EXISTING `tesla-card` element — assert no NEW vehicle
    // element snuck into the registry (the contract is still the same seven tags).
    expect(customElements.get('tc-vehicle')).toBeUndefined();
    expect(customElements.get('tc-my-home')).toBe(TcMyHome);
  });
});

describe('Story 8.5 — AC2: the WC edge IS the car-charging edge (agree by construction)', () => {
  test('an active WC ⇒ the overlay edge flows (= |wcVehicleEdge(model)| — agree by construction)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate anchors (jsdom: zero rects, but the edge still draws)
    await el.updateComplete;
    const model = (el as unknown as { _model: FlowModel })._model;
    const ch = wcVehicleEdge(model);
    expect(ch.active).toBe(true);
    // The drawn WC→Vehicle edge reflects the SAME model view the embedded card's
    // charge badge reads (one `wcVehicleEdge` source) — so they cannot disagree.
    const edge = vehEdge(el)!;
    expect(edge).not.toBeNull();
    expect(edge.querySelector('.gw-leg-base')).not.toBeNull(); // calm base always
    expect(edge.querySelector('.sb-flow')).not.toBeNull(); // active ⇒ animated dash
  });

  test('a sub-deadband WC ⇒ the overlay edge is base-only (quiescent)', async () => {
    const s = states(awakeFx);
    const wcId = energyIds(s).wc_power!;
    s[wcId].state = '0'; // WC idle → edge direction:none
    const el = await mount(makeHass(s));
    recompute(el);
    await el.updateComplete;
    const model = (el as unknown as { _model: FlowModel })._model;
    expect(wcVehicleEdge(model).active).toBe(false);
    const edge = vehEdge(el)!;
    expect(edge.querySelector('.gw-leg-base')).not.toBeNull(); // still a calm base
    expect(edge.querySelector('.sb-flow')).toBeNull(); // quiescent — no motion
  });
});

describe('Story 8.5 — AC3: half-alive (asleep) is calm, not broken', () => {
  test('asleep car: the cell stays present (calm) and the WC→Vehicle edge is quiescent', async () => {
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
    // The embedded detailed card owns its own calm-not-broken asleep degradation
    // (dimmed hero silhouette + "Asleep · updated Nm ago" — proven in the hero suite).
    // The SCENE-level invariant: the card is embedded, and the WC→Vehicle edge degrades
    // to its calm base line — no motion, never a false charge.
    expect(veh!.querySelector('tesla-card')).not.toBeNull();
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
    // The cell re-rendered — the embedded detailed card received the NEW hass (with a
    // *_power-only gate the slice would have frozen at 72 — the 6.5 bug).
    const card = vehCell(el)!.querySelector('tesla-card') as unknown as {
      hass: { states: Record<string, { state: string }> };
    };
    expect(card.hass.states[bId].state).toBe('55');
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

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.10 — AC7: the WC→Vehicle leg GEOMETRY is axis-aware and overlap-centred.
// jsdom returns zero-size rects (so the live e2e covers the desktop HORIZONTAL path at
// real geometry), but injecting KNOWN anchors + forcing `_axis` pins BOTH branches
// deterministically here: the leg meets the two cards at their cross-axis OVERLAP centre,
// on the facing edges — never the stretched-cell midpoint the pre-fix code floated to. The
// vertical (phone-stacked) branch is otherwise unexercised, since jsdom always reports the
// phone axis on zero-width rects (start==end==origin), so this is its only real coverage.
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 8.10 — AC7: the WC→Vehicle leg geometry (axis-aware, overlap-centred)', () => {
  const baseSeg = (el: Scene) => {
    const base = vehEdge(el)!.querySelector('.gw-leg-base')!;
    return {
      x1: Number(base.getAttribute('x1')),
      y1: Number(base.getAttribute('y1')),
      x2: Number(base.getAttribute('x2')),
      y2: Number(base.getAttribute('y2')),
    };
  };

  test('desktop (_axis=x): a HORIZONTAL leg across the gap at the cards’ vertical overlap centre', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate the bus so the .scene-bus overlay renders
    await el.updateComplete;
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // WC left of the vehicle; cards of DIFFERENT heights with tops aligned (align-items:start).
    inst._anchors = {
      wall_connector: { left: 0, top: 0, width: 100, height: 200 }, // taller
      vehicle: { left: 300, top: 0, width: 100, height: 100 }, // shorter, tops aligned
      bus: { left: 200, top: 0, width: 0, height: 0 },
    };
    inst._axis = 'x';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    const s = baseSeg(el);
    expect(s.y1).toBe(s.y2); // horizontal: constant y
    expect(s.x1).toBe(100); // WC's vehicle-FACING (right) edge
    expect(s.x2).toBe(300); // vehicle's WC-FACING (left) edge
    // The cross-axis y is the OVERLAP centre (50) = the shorter card's centre, INSIDE both
    // cards' vertical extents ([0,200] ∩ [0,100]) — not the stretched-cell midpoint.
    expect(s.y1).toBe(50);
  });

  test('phone (_axis=y): a VERTICAL leg down the gap at the cards’ horizontal overlap centre', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // Stacked in one 1fr column: WC above the vehicle, same left + width.
    inst._anchors = {
      wall_connector: { left: 0, top: 0, width: 100, height: 100 }, // above
      vehicle: { left: 0, top: 300, width: 100, height: 100 }, // below, same column
      bus: { left: 50, top: 200, width: 0, height: 0 },
    };
    inst._axis = 'y';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    const s = baseSeg(el);
    expect(s.x1).toBe(s.x2); // vertical: constant x
    expect(s.y1).toBe(100); // WC's vehicle-FACING (bottom) edge
    expect(s.y2).toBe(300); // vehicle's WC-FACING (top) edge
    expect(s.x1).toBe(50); // overlap centre of the shared column
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
  test('the vehicle leg pill = |wcVehicleEdge(model).kW| N.N kW (the ONE shared edge view)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const model = (el as unknown as { _model: FlowModel })._model;
    const ch = wcVehicleEdge(model);
    expect(ch.active).toBe(true);
    const expected = `${Math.abs(ch.kW).toFixed(1)} ${U}`;
    // The overlay pill reads the ONE wcVehicleEdge view — the SAME model the embedded
    // card's charge badge reads, so they agree by construction (no second engine).
    expect(pillTxt(vehEdge(el))).toBe(expected);
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

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.7 — the enriched self-powered ribbon: a "self-powered now %" lead +
// per-node aggregate tiles, both pure VIEWS of the ONE computeBalance net (AC1),
// honest over no/stale load (AC2/AC4), present-gated tiles (AC3), agree-by-
// construction with the bus (AC1/AC3). No new element (AC5, covered by the
// contract suite). All from the already-bound `_model` — zero new state reads.
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 8.7 — the self-powered lead + per-node tiles', () => {
  const measured = (role: EnergyRole, kW: number): FlowInput => ({ role, kW, provenance: 'measured' });
  const quiescent = (role: EnergyRole, kW: number): FlowInput => ({ role, kW, provenance: 'quiescent' });
  const absent = (role: EnergyRole): FlowInput => ({ role, kW: undefined, provenance: 'measured' });
  const modelOf = (el: Scene): FlowModel => (el as unknown as { _model: FlowModel })._model;
  const ribbonOf = (el: Scene) => sr(el).querySelector('.ribbon');
  const tiles = (el: Scene): Element[] => [...sr(el).querySelectorAll('.rib-tile')];

  test('AC1 — the lead shows the cap, the % matching selfPowered(), and the "X of Y kW" sub-line', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const sp = selfPowered(modelOf(el));
    const lead = sr(el).querySelector('.ribbon-lead')!;
    expect(lead).not.toBeNull();
    expect(lead.querySelector('.rib-cap')!.textContent).toContain(STRINGS.scene.ribbon.selfPowered);
    expect(sp.pct).not.toBeUndefined(); // the awake fixture has a live load
    const big = lead.querySelector('.rib-big')!.textContent ?? '';
    expect(big).toContain(String(sp.pct)); // the rendered % equals the pure derivation
    expect(big).toContain('%');
    const sub = (lead.querySelector('.rib-sub')!.textContent ?? '').replace(/\s+/g, ' ').trim();
    const r = STRINGS.scene.ribbon;
    expect(sub).toBe(`${formatNumber(sp.selfKw, 1)} ${r.coveringOf} ${formatNumber(sp.totalKw, 1)} ${r.unit}`);
  });

  test('AC1/AC2 — a fully grid-supplied Scene renders a DEFINED "0%", never the no-load "—"', async () => {
    // The render guard is `pct === undefined ? '—' : pct` — a falsy check (`pct || '—'`
    // or `pct ? … : '—'`) would WRONGLY swallow a real 0% into the no-load dash. There
    // IS a live load here (home 4 kW) entirely met by grid import ⇒ honest 0%.
    const el = await mount(makeHass(states(awakeFx)));
    await injectModel(
      el,
      buildFlowModel([
        measured('grid', 4),
        measured('home', 4),
        absent('solar'),
        absent('powerwall'),
        absent('wall_connector'),
      ])
    );
    expect(selfPowered(modelOf(el)).pct).toBe(0); // a defined 0, not undefined
    const big = sr(el).querySelector('.rib-big')!.textContent ?? '';
    expect(big).toContain('0'); // the real 0% figure
    expect(big).toContain('%');
    expect(big).not.toContain('—'); // NOT swallowed into the no-load dash
    expect(sr(el).querySelector('.rib-sub')).not.toBeNull(); // sub-line shows (pct defined)
  });

  test('AC3 — one .rib-tile per present node; the "Car" tile labels the wall_connector net', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const model = modelOf(el);
    const expected = ribbonTiles(model);
    expect(tiles(el).length).toBe(expected.length);
    // The wall_connector tile is labelled "Car" and shows |net.wall_connector|.
    const net = computeBalance(model).net;
    if (expected.some((t) => t.role === 'wall_connector')) {
      const car = tiles(el).find((t) => (t.textContent ?? '').includes(STRINGS.scene.ribbon.tile.wall_connector))!;
      expect(car).not.toBeUndefined();
      expect(car.textContent).toContain(formatNumber(Math.abs(net['wall_connector']), 1));
    }
  });

  test('AC3 — a minimal Grid+Home model renders exactly two present-gated tiles (never a fabricated 0)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    await injectModel(
      el,
      buildFlowModel([
        measured('grid', 2),
        measured('home', 2),
        absent('solar'),
        absent('powerwall'),
        absent('wall_connector'),
      ])
    );
    expect(tiles(el).length).toBe(2);
    const txt = ribbonOf(el)!.textContent ?? '';
    expect(txt).toContain(STRINGS.scene.ribbon.tile.grid);
    expect(txt).toContain(STRINGS.scene.ribbon.tile.home);
    expect(txt).not.toContain(STRINGS.scene.ribbon.tile.solar); // absent ⇒ no tile
  });

  test('AC3 — the GRID tile carries an honest in/out direction suffix; other tiles show magnitude', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    // Grid importing (+) ⇒ "… in".
    await injectModel(el, buildFlowModel([measured('grid', 3), measured('home', 3), absent('solar'), absent('powerwall'), absent('wall_connector')]));
    const gridTile = tiles(el).find((t) => (t.textContent ?? '').includes(STRINGS.scene.ribbon.tile.grid))!;
    expect(gridTile.textContent).toContain(STRINGS.scene.ribbon.in);
    // Grid exporting (−) ⇒ "… out".
    await injectModel(el, buildFlowModel([measured('grid', -3), measured('solar', 5), measured('home', 2), absent('powerwall'), absent('wall_connector')]));
    const gridTile2 = tiles(el).find((t) => (t.textContent ?? '').includes(STRINGS.scene.ribbon.tile.grid))!;
    expect(gridTile2.textContent).toContain(STRINGS.scene.ribbon.out);
    // Home (a load) shows no in/out — magnitude only.
    const homeTile = tiles(el).find((t) => (t.textContent ?? '').includes(STRINGS.scene.ribbon.tile.home))!;
    expect(homeTile.textContent).not.toMatch(new RegExp(`\\b(${STRINGS.scene.ribbon.in}|${STRINGS.scene.ribbon.out})\\b`));
  });

  test('AC2/AC4 — a fully-quiescent, sub-deadband Scene reads — (no fabricated %), dims, and stamps last-known age', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    // Real quiescence = sub-DEADBAND power reads (provenance quiescent ⇒ dim; the
    // sub-IDLE_KW nets ⇒ no live load to be a percentage of ⇒ selfPowered.pct undefined).
    await injectModel(
      el,
      buildFlowModel([
        quiescent('solar', 0.02),
        quiescent('home', 0.03),
        absent('powerwall'),
        absent('grid'),
        absent('wall_connector'),
      ])
    );
    const rib = ribbonOf(el)!;
    expect(rib.classList.contains('dim')).toBe(true); // honest stale tone
    const big = sr(el).querySelector('.rib-big')!.textContent ?? '';
    expect(big).toContain('—'); // the honest no-load read
    expect(big).not.toMatch(/\d/); // NEVER a fabricated 0%/100%
    expect(sr(el).querySelector('.rib-sub')).toBeNull(); // no sub-line when pct undefined
    expect(sr(el).querySelector('.ribbon-age')).not.toBeNull(); // "updated Nm ago" stamp
  });

  test('AC4 — an EMPTY Scene (no present nodes) renders no ribbon at all', async () => {
    const el = await mount(makeHass({})); // no energy site
    expect(ribbonOf(el)).toBeNull();
  });

  test('AC1/AC3 — the grid tile magnitude AGREES with the bus grid leg pill (one balance net)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate anchors so the bus legs draw (jsdom: zero rects)
    await el.updateComplete;
    const model = modelOf(el);
    const net = computeBalance(model).net;
    const gridTile = tiles(el).find((t) => (t.textContent ?? '').includes(STRINGS.scene.ribbon.tile.grid));
    if (!gridTile) return; // grid absent in this fixture variant — nothing to cross-check
    const tileMag = formatNumber(Math.abs(net['grid']), 1);
    expect(gridTile.textContent).toContain(tileMag);
    // The bus grid leg pill reads the SAME |edge.kW| = |net.grid| (agree by construction).
    expect(pillTxt(legOf(el, 'grid'))).toContain(tileMag);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.12 — the Gateway terminal anchors at its card's VISIBLE bottom (source-row
// top-align) and a long leg reads as a deliberate conduit (length-aware `.long`).
// The per-card Solar-bottom GEOMETRY is the E2E's job (jsdom layout is zero); here we
// pin the CSS contract via the styles-string idiom and the `len > LONG_LEG_PX` LOGIC
// via the Story-8.10 inject-`_anchors` + force-`_axis` pattern (which feeds geometry
// directly, bypassing jsdom's zero layout — so both branches are real coverage).
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 8.12 — gw-term anchors at the card visible bottom (source-row top-align + length-aware long leg)', () => {
  const flatten = (s: unknown): string =>
    Array.isArray(s) ? s.map(flatten).join('\n') : ((s as { cssText?: string })?.cssText ?? '');
  const cssText = (): string => flatten((TcMyHome as unknown as { styles: unknown }).styles);
  const baseClasses = (el: Scene, role: string): DOMTokenList => {
    // Assert the leg + its base line actually rendered BEFORE reading classes: a bare
    // `?.contains('long')` yields `undefined` for a missing leg, so the positive case would
    // fail as "undefined !== true" and could not distinguish "leg absent" from "leg lacks
    // .long". Throw a named error instead so a missing leg is unambiguous.
    const base = legOf(el, role)?.querySelector('.gw-leg-base') ?? null;
    if (!base) throw new Error(`Story 8.12 test: no .gw-leg-base rendered for role="${role}"`);
    return base.classList;
  };

  test('Task 1/AC1/AC2 — the SOURCE row top-aligns (align-items:start) alongside the load row; the column-centering is untouched', () => {
    const css = cssText();
    // Both rows now share ONE align-items:start rule. Before 8.12 only `.load-row {
    // align-items:start }` existed (guarded by a stale "source stretch is tuned for the
    // bus" comment), so the GROUPED `.source-row, .load-row { align-items: start }` is the
    // red->green proof of the source-row top-align (a bare toContain('align-items: start')
    // already passed on the load-row alone — it would NOT prove the source-row change).
    expect(css).toMatch(/\.source-row,\s*\.load-row\s*\{\s*align-items:\s*start/);
    // AC2: the trunk does NOT move — bus-Y is invariant to align (the row TRACK height is
    // the tallest card's either way). The `.scene-grid` COLUMN centering is a DIFFERENT
    // selector and stays put (the 6.7 unit pin) — align is never flipped to center on a row.
    // Bind the check to the `.scene-grid` rule BLOCK — a bare toContain('align-items: center')
    // is a global substring that would pass if `align-items: center` appeared in ANY rule, so
    // it would NOT prove the column-centering selector specifically stayed put.
    expect(css).toMatch(/\.scene-grid\s*\{[^}]*align-items:\s*center/);
  });

  test('Task 3/AC3/AC5 — a `.gw-leg-base.long` polish rule exists (opacity:0.6 + stroke-width:2.5), as direct SVG literals — no new token, no gradient', () => {
    const css = cssText();
    expect(css).toMatch(/\.gw-leg-base\.long\s*\{[^}]*opacity:\s*0\.6/);
    expect(css).toMatch(/\.gw-leg-base\.long\s*\{[^}]*stroke-width:\s*2\.5/);
    // AC5: the polish is direct stroke literals — NO new `--tc-*` token, NO gradient (the
    // codebase avoids gradients). Scope the checks to the rule BLOCK so neither the
    // explanatory comment nor unrelated token rules can mask a violation.
    const longBlock = css.match(/\.gw-leg-base\.long\s*\{[^}]*\}/)?.[0] ?? '';
    expect(longBlock).not.toBe('');
    expect(longBlock).not.toContain('--tc-');
    expect(longBlock).not.toContain('gradient');
  });

  test('Task 2/AC3 — only a leg whose cross-axis length exceeds LONG_LEG_PX gets the `long` class; short hops stay calm', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate the bus so the overlay renders (jsdom: zero rects)
    await el.updateComplete;
    // Drain the mount's pending rAF-coalesced geometry pass BEFORE injecting, so a late fire
    // (jsdom width-0 ⇒ _axis='y', zeroed _anchors) cannot clobber the desktop fixture below.
    await flushGeometry();
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // Desktop axis. Both source cards sit ABOVE the trunk (cy < cross => near = card BOTTOM,
    // the post-Task-1 visible-bottom anchor). Solar's bottom is FAR from the trunk (a long
    // conduit). Powerwall's bottom is a DELIBERATE realistic ~85px short hop (75-90px band):
    // calm at the current LONG_LEG_PX=160, but a downward retune to ~80 makes 85>80 ⇒ `long`,
    // tripping the `powerwall` assertion RED — the retune-sensitivity guard (Story 9.6 AC1).
    inst._anchors = {
      solar: { left: 0, top: 0, width: 100, height: 50 }, // bottom=50, len=|50-400|=350 (long)
      powerwall: { left: 200, top: 265, width: 100, height: 50 }, // bottom=315, len=|315-400|=85 (short)
      bus: { left: 0, top: 400, width: 0, height: 0 }, // trunk cross = 400
    };
    inst._axis = 'x';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    expect(baseClasses(el, 'solar').contains('long')).toBe(true); // honest long conduit
    expect(baseClasses(el, 'powerwall').contains('long')).toBe(false); // short hop stays calm
  });

  test('Story 9.6 (QA) — the threshold is STRICT-greater: len===LONG_LEG_PX stays short, len===LONG_LEG_PX+1 turns long', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate the bus so the overlay renders (jsdom: zero rects)
    await el.updateComplete;
    // Drain the mount's pending rAF-coalesced geometry pass BEFORE injecting (see Task 2/AC3).
    await flushGeometry();
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // The boundary guard AC1 does NOT cover: AC1 makes the fixture sensitive to a retune of the
    // LONG_LEG_PX *value*; this pins the *operator* — `len > LONG_LEG_PX` is STRICT (not `>=`).
    // Desktop axis, both cards above the trunk (cy < cross => near = card BOTTOM), cross=400:
    //   powerwall bottom=240 ⇒ len=|240-400|=160 === LONG_LEG_PX ⇒ short (strict `>` excludes ==)
    //   solar     bottom=239 ⇒ len=|239-400|=161  >  LONG_LEG_PX ⇒ long
    // Flip `>` to `>=` and the powerwall (len===160) assertion turns RED — the off-by-one guard.
    inst._anchors = {
      solar: { left: 0, top: 189, width: 100, height: 50 }, // bottom=239, len=161 (long: just over)
      powerwall: { left: 200, top: 190, width: 100, height: 50 }, // bottom=240, len=160 === threshold (short)
      bus: { left: 0, top: 400, width: 0, height: 0 }, // trunk cross = 400
    };
    inst._axis = 'x';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    expect(baseClasses(el, 'solar').contains('long')).toBe(true); // len=161 > 160 ⇒ long
    expect(baseClasses(el, 'powerwall').contains('long')).toBe(false); // len=160 NOT > 160 ⇒ short
  });

  test('Task 6/AC4 — `long` is GATED to the horizontal (desktop) bus: a long VERTICAL phone-axis leg stays calm', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    // Drain the pending mount rAF before injecting (see Task 2/AC3) so the phone-axis fixture
    // below is not clobbered by a late zero-rect recompute.
    await flushGeometry();
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // Phone axis (y): the trunk is vertical, legs run horizontally. A full-width stacked
    // card's near edge sits a LONG way from the bus x (len = |100 - 400| = 300 >> 160) —
    // yet AC4 keeps the phone layout identical to today, so the horiz-gate suppresses
    // .long for EVERY phone leg (the e2e pins this at real ≤540px width too).
    inst._anchors = {
      solar: { left: 0, top: 0, width: 100, height: 50 },
      bus: { left: 400, top: 0, width: 0, height: 0 }, // cross (bus x) = 400
    };
    inst._axis = 'y';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    expect(baseClasses(el, 'solar').contains('long')).toBe(false); // gated off at phone
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.5 — C-increment: the `if (!bus)` short-circuit in `_legs`. The ONLY real
// verification of the fix: e2e/screenshot pins can't reach the degenerate path (in
// steady state node anchors present ⟺ bus defined), so we force it synthetically by
// injecting `_anchors` WITHOUT a `bus`/BUS_NODE_ID key. Pre-fix, `cross` fell back to
// 0 and a desktop near-edge at y>160 drew a `.long` conduit clear to y=0; post-fix the
// guard returns `svg\`\`` so NO leg renders at all (stronger than "no .long").
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 9.5 — C-increment: bus-less leg short-circuit (FR-33 zero-diff)', () => {
  test('AC1/AC3 — bus undefined ⇒ no leg drawn (was: a `.long` conduit to the y=0 cross)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el); // populate the model so `solar` is a present node (jsdom: zero rects)
    await el.updateComplete;
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // Omit the `bus`/BUS_NODE_ID key. Solar's near edge sits at y=200; against the dead
    // `cross=0` fallback, len=|200-0|=200 > LONG_LEG_PX (160) on the desktop (horiz) axis,
    // so pre-fix this rendered `.gw-leg-base.long` drawn down to y=0. Post-fix: nothing.
    inst._anchors = { solar: { left: 0, top: 200, width: 100, height: 50 } };
    inst._axis = 'x';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    expect(legOf(el, 'solar')).toBeNull(); // no leg at all — the direct proof of AC1
  });

  test('AC5 — the short-circuit is order-independent (keys off !bus, never _model.nodes order)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // A reordered anchor set (as Story 9.3's reorder would produce) with the bus STILL
    // omitted: the guard fires regardless of which node anchors are present or in what
    // order, so no legs draw for any role.
    inst._anchors = {
      home: { left: 200, top: 200, width: 100, height: 50 },
      solar: { left: 0, top: 200, width: 100, height: 50 },
    };
    inst._axis = 'x';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    expect(legOf(el, 'solar')).toBeNull();
    expect(legOf(el, 'home')).toBeNull();
  });

  // QA gap (AC1/AC4): the deleted `: 0` ternary fell back to 0 on BOTH cross branches
  // (`horiz ? bus.top+h/2 : bus.left+w/2`). The two tests above only force `_axis='x'`,
  // so they prove the HORIZONTAL branch's degenerate path is short-circuited. The guard
  // sits BEFORE the `horiz` split, so it must short-circuit the vertical (phone) axis too
  // — where pre-fix `cross` fell back to 0 via `bus.left+w/2` and a near-edge at x>0 drew
  // a degenerate leg clear to x=0 (no `.long`, gated off at phone, but a false leg all the
  // same). This pins the guard as axis-agnostic — the one axis the existing tests miss.
  test('AC1/AC4 — bus undefined on the VERTICAL (phone) axis also draws no leg (guard is axis-agnostic)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // Phone axis (y): `cross = bus.left + bus.width/2` → 0 pre-fix. Solar's near edge sits
    // at x=200 (cx=250 > 0 ⇒ near = rect.left = 200), so pre-fix a leg drew to x=0. Post-fix
    // the `if (!bus)` guard returns `svg\`\`` before the axis split ⇒ no leg on EITHER axis.
    inst._anchors = { solar: { left: 200, top: 0, width: 100, height: 50 } };
    inst._axis = 'y';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    expect(legOf(el, 'solar')).toBeNull();
  });

  // QA gap (AC2 zero-diff proxy / positive control): the two negatives above prove the guard
  // FIRES when bus is absent; this matched positive proves it does NOT over-fire when bus is
  // present — the same `solar` anchor PLUS a `bus` key still renders its leg exactly as today.
  // This is the unit-level proxy for AC2's "steady-state is byte-identical" and pins the guard's
  // boundary at exactly `!bus`: a regression that widened it (e.g. `if (!bus || …)`) fails here.
  test('AC2 — guard does NOT over-fire: with the bus key present the leg still renders (zero-diff)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const inst = el as unknown as { _anchors: Record<string, unknown>; _axis: string };
    // Identical to the AC1/AC3 negative above, but WITH the bus junction defined: the leg
    // must draw. (Pre- and post-fix this is byte-identical — the guard only touches !bus.)
    inst._anchors = {
      solar: { left: 0, top: 200, width: 100, height: 50 },
      bus: { left: 0, top: 400, width: 0, height: 0 },
    };
    inst._axis = 'x';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    expect(legOf(el, 'solar')).not.toBeNull(); // bus present ⇒ leg draws (guard inert)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.2 — hide a present node by config (hidden == absent). The co-located proof
// of the WIRING: an ENERGY node hidden via `energy.nodes.hide` drops at the shared
// model (no cell, packed rows — NOT a render-only filter), the VEHICLE hide omits its
// presentation cell AND its WC→Vehicle edge while the Wall-Connector energy node stays,
// a hide/unhide config change fires the present-set reflow EXACTLY once (AC5), hiding
// every node collapses to the calm empty Scene with `_bus.empty` ⇒ no overlay (AC4),
// and garbage `hide` degrades to nothing-hidden (FR-24). The real-geometry tier (a
// hidden node byte-for-byte == an absent one) is the e2e Story 9.2 block.
// ═══════════════════════════════════════════════════════════════════════════
const hideCfg = (...hide: Role[]): TeslaCardConfig => ({
  type: 'tc-my-home',
  energy: { nodes: { hide } },
});
/** The five ENERGY ecosystem cells only (excludes the Story-8.5 vehicle presentation cell). */
const energyCells = (el: Scene): Element[] =>
  [...sr(el).querySelectorAll('.scene-cell:not([data-node="vehicle"])')];

describe('Story 9.2 — hide a present node at the model/binding seam (hidden == absent)', () => {
  test('AC1/AC3 — a hidden ENERGY node leaves NO cell and the rows pack (one fewer cell, no gap)', async () => {
    const baseline = await mount(makeHass(states(awakeFx)));
    expect(energyCells(baseline)).toHaveLength(5); // sanity: the un-hidden roster

    const el = await mount(makeHass(states(awakeFx)), hideCfg('solar'));
    // The solar cell is gone; the other four energy cells remain (packed, no ghost slot).
    expect(sr(el).querySelector('.scene-cell[data-node="solar"]')).toBeNull();
    expect(energyCells(el)).toHaveLength(4);
    for (const role of ['powerwall', 'grid', 'home', 'wall_connector']) {
      expect(sr(el).querySelector(`.scene-cell[data-node="${role}"]`), `${role} present`).not.toBeNull();
    }
    // It dropped at the SHARED model (present:false), not via a render-only filter —
    // so the bus tap / leg / ribbon contribution all fell away together by construction.
    const model = (el as unknown as { _model: FlowModel })._model;
    expect(model.nodes.find((n) => n.role === 'solar')?.present).toBe(false);
    expect(model.edges.find((e) => e.from === 'solar')).toBeUndefined();
  });

  test('AC2 — hiding the VEHICLE omits its cell AND its WC→Vehicle edge; the WC energy node stays', async () => {
    const el = await mount(makeHass(states(awakeFx)), hideCfg('vehicle'));
    recompute(el); // populate anchors so the WC→Vehicle edge WOULD draw if the cell were present
    await el.updateComplete;
    expect(vehCell(el)).toBeNull(); // no presentation cell
    expect(vehEdge(el)).toBeNull(); // and no orphaned WC→Vehicle overlay edge
    // The Wall-Connector ENERGY node is untouched — still a present cell feeding the bus
    // (hiding the car must not hide the WC; they are different things — AC2).
    expect(sr(el).querySelector('.scene-cell[data-node="wall_connector"]')).not.toBeNull();
    const model = (el as unknown as { _model: FlowModel })._model;
    expect(model.nodes.find((n) => n.role === 'wall_connector')?.present).toBe(true);
    expect(energyCells(el)).toHaveLength(5); // all five energy cells intact
  });

  test('AC5 — hiding an energy node across a CONFIG change fires the present-set reflow exactly once', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    el.setConfig(hideCfg('solar')); // a hide config change shrinks the present-set
    await el.updateComplete;
    expect(spy).toHaveBeenCalledTimes(1); // ONE recompute on reflow, never per-tick
    expect(energyCells(el)).toHaveLength(4);
  });

  test('AC5 — UN-hiding (config change back to full) reflows exactly once and restores the cell', async () => {
    const el = await mount(makeHass(states(awakeFx)), hideCfg('solar'));
    expect(energyCells(el)).toHaveLength(4);
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    el.setConfig({ type: 'tc-my-home' }); // drop the hide → solar returns
    await el.updateComplete;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sr(el).querySelector('.scene-cell[data-node="solar"]')).not.toBeNull();
    expect(energyCells(el)).toHaveLength(5);
  });

  test('AC4 — hiding EVERY node collapses to the calm empty Scene: _bus.empty ⇒ NO overlay', async () => {
    const el = await mount(
      makeHass(states(awakeFx)),
      hideCfg('solar', 'powerwall', 'grid', 'home', 'wall_connector', 'vehicle')
    );
    recompute(el);
    await el.updateComplete;
    expect(energyCells(el)).toHaveLength(0);
    expect(vehCell(el)).toBeNull();
    expect((el as unknown as { _bus: SceneBusRenderer })._bus.empty).toBe(true);
    expect(sr(el).querySelector('.scene-bus')).toBeNull(); // no degenerate single-anchor bus
    // …and it did not crash: the calm-empty Scene container still renders.
    expect(sr(el).querySelector('.scene')).not.toBeNull();
  });

  test('FR-24 — garbage in `hide` (a non-array) degrades to nothing-hidden, renders the full Scene', async () => {
    const el = await mount(makeHass(states(awakeFx)), {
      type: 'tc-my-home',
      energy: { nodes: { hide: 'nope' } },
    } as unknown as TeslaCardConfig);
    expect(energyCells(el)).toHaveLength(5); // full roster — never crash, never blank
  });

  // ── Gap fill (QA, bmad-qa-generate-e2e-tests) ──────────────────────────────
  // The story's "vehicle is special" Dev Note demands BOTH directions be pinned:
  // the existing AC2 test proves "hide vehicle ⇒ WC stays"; this proves the reverse —
  // "hide the WC (an ENERGY node) ⇒ the Vehicle presentation cell STAYS, but with no
  // WC edge on the bus the WC→Vehicle overlay leg cannot draw (no phantom charge)."
  test('AC2 (reverse) — hiding the WALL CONNECTOR drops its energy cell + WC→Vehicle edge, yet the Vehicle cell stays (no phantom charge)', async () => {
    const el = await mount(makeHass(states(awakeFx)), hideCfg('wall_connector'));
    recompute(el); // populate anchors so the WC→Vehicle edge WOULD draw if the WC fed the bus
    await el.updateComplete;
    // The WC energy node dropped at the shared model (present:false) ⇒ its cell is gone.
    expect(sr(el).querySelector('.scene-cell[data-node="wall_connector"]')).toBeNull();
    const model = (el as unknown as { _model: FlowModel })._model;
    expect(model.nodes.find((n) => n.role === 'wall_connector')?.present).toBe(false);
    // The Vehicle is a presentation cell, NOT a flow node — hiding the WC must NOT hide it.
    expect(vehCell(el)).not.toBeNull();
    // …but `wcVehicleEdge` finds no WC edge now, so the WC→Vehicle overlay leg is absent
    // — the car reads parked/plugged from its discrete status, never a phantom charge (AC2).
    expect(vehEdge(el)).toBeNull();
    expect(energyCells(el)).toHaveLength(4); // the other four energy cells remain, packed
  });

  // AC5 has TWO _presentKey components: the present-energy-role set AND `veh:`. The
  // existing AC5 tests exercise the energy-role half (hide/unhide solar). This pins
  // the vehicle half — hiding the Vehicle flips `vehiclePresent`, which must also fire
  // the present-set reflow EXACTLY once (never per-tick) on the config change.
  test('AC5 — hiding the VEHICLE across a config change fires the present-set reflow exactly once (the veh: key path)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(vehCell(el)).not.toBeNull(); // present to begin with
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    el.setConfig(hideCfg('vehicle')); // flips _vehiclePresent ⇒ the `veh:` _presentKey component changes
    await el.updateComplete;
    expect(spy).toHaveBeenCalledTimes(1); // ONE recompute on reflow
    expect(vehCell(el)).toBeNull();
  });

  // The two seams (energy-node hide at the binding/model layer; vehicle hide at the
  // `_vehiclePresent` gate) must COMPOSE — a user who hides their car AND their solar
  // in one list gets both dropped, each via its own seam, neither interfering.
  test('AC1/AC2 compose — hide:["vehicle","solar"] drops BOTH the vehicle cell and the solar energy cell together', async () => {
    const el = await mount(makeHass(states(awakeFx)), hideCfg('vehicle', 'solar'));
    recompute(el);
    await el.updateComplete;
    expect(vehCell(el)).toBeNull(); // vehicle gate honored
    expect(sr(el).querySelector('.scene-cell[data-node="solar"]')).toBeNull(); // model seam honored
    expect(energyCells(el)).toHaveLength(4); // the four non-solar energy cells remain
    const model = (el as unknown as { _model: FlowModel })._model;
    expect(model.nodes.find((n) => n.role === 'solar')?.present).toBe(false); // dropped at the model
    expect(model.nodes.find((n) => n.role === 'wall_connector')?.present).toBe(true); // WC untouched
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.3 — reorder present nodes WITHIN their row by config (additive, geometry-
// driven). The co-located proof of the WIRING: `energy.nodes.order` reorders the
// RENDERED cells (the real lever — moving the cells moves their DOM anchors, and the
// Gateway bus follows because `gatewaySegments` taps sort by SPATIAL position, not by
// `SCENE_NODES`), a stable partition keeps unlisted/garbage roles canonical (AC3/AC4),
// the vehicle reorders within the load row (AC4), hide wins over order (9.2), and a
// reorder-only config change fires the present-set reflow EXACTLY once (AC5). The
// real-geometry tier (the bus tap walk tracking the reordered anchor centres) is the
// e2e Story 9.3 block — jsdom returns zero rects, so it pins the cell SEQUENCE here.
// ═══════════════════════════════════════════════════════════════════════════
const orderCfg = (order: unknown, hide?: Role[]): TeslaCardConfig =>
  ({
    type: 'tc-my-home',
    energy: { nodes: { order, ...(hide ? { hide } : {}) } },
  }) as unknown as TeslaCardConfig;
/** The `data-node` sequence of a row, INCLUDING the vehicle cell (the DOM-order handle). */
const sourceNodes = (el: Scene): (string | undefined)[] =>
  [...sr(el).querySelectorAll<HTMLElement>('.source-row .scene-cell')].map((c) => c.dataset.node);
const loadNodes = (el: Scene): (string | undefined)[] =>
  [...sr(el).querySelectorAll<HTMLElement>('.load-row .scene-cell')].map((c) => c.dataset.node);

describe('Story 9.3 — reorder present nodes within their row by config (render-is-geometry)', () => {
  test('AC1 — order honored: order:["grid","solar"] packs the source row [grid, solar, powerwall]', async () => {
    const el = await mount(makeHass(states(awakeFx)), orderCfg(['grid', 'solar']));
    // listed (user order) then unlisted (canonical) — powerwall trails.
    expect(sourceNodes(el)).toEqual(['grid', 'solar', 'powerwall']);
    // The load row is untouched (no load roles listed) — canonical, vehicle trailing.
    expect(loadNodes(el)).toEqual(['home', 'wall_connector', 'vehicle']);
  });

  test('AC3 — partial order: only listed roles move, the rest keep canonical order', async () => {
    const el = await mount(makeHass(states(awakeFx)), orderCfg(['grid']));
    // grid first; solar, powerwall keep their canonical relative order after it.
    expect(sourceNodes(el)).toEqual(['grid', 'solar', 'powerwall']);
  });

  test('zero-diff — no order key renders the exact canonical packing (byte-for-byte today)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(sourceNodes(el)).toEqual(['solar', 'powerwall', 'grid']);
    expect(loadNodes(el)).toEqual(['home', 'wall_connector', 'vehicle']);
  });

  test('AC4 — an order entry naming an ABSENT node is ignored; present cells stay ordered', async () => {
    // Powerwall genuinely absent (its power sensor dropped) — order names it anyway.
    const el = await mount(subsetHass(['solar', 'grid', 'home', 'wall_connector']), orderCfg(['grid', 'powerwall', 'solar']));
    // powerwall is not present, so it drops from the partition: [grid, solar].
    expect(sourceNodes(el)).toEqual(['grid', 'solar']);
  });

  test('AC4/FR-24 — a non-array `order` degrades to canonical order, no crash', async () => {
    const el = await mount(makeHass(states(awakeFx)), orderCfg('nope'));
    expect(sourceNodes(el)).toEqual(['solar', 'powerwall', 'grid']);
    expect(loadNodes(el)).toEqual(['home', 'wall_connector', 'vehicle']);
  });

  test('AC4/FR-24 — unknown strings and duplicate roles are ignored, present cells still ordered', async () => {
    // 'not_a_node' is unknown (fails row membership); the duplicate 'grid' is deduped
    // (first-occurrence wins) — the partition is [grid, solar, powerwall], no crash.
    const el = await mount(makeHass(states(awakeFx)), orderCfg(['grid', 'not_a_node', 'grid', 'solar']));
    expect(sourceNodes(el)).toEqual(['grid', 'solar', 'powerwall']);
  });

  test('AC4 — a cross-row order entry no-ops in this row (home in the SOURCE order is ignored)', async () => {
    // 'home' is a load role — naming it does NOT promote it into the source row.
    const el = await mount(makeHass(states(awakeFx)), orderCfg(['home', 'grid']));
    expect(sourceNodes(el)).toEqual(['grid', 'solar', 'powerwall']); // grid honored, home inert here
    expect(loadNodes(el)).toEqual(['home', 'wall_connector', 'vehicle']); // load row unchanged
  });

  test('AC4 — order × hide: hide:["powerwall"], order:["grid","powerwall","solar"] ⇒ [grid, solar] (hide wins, reorder honored on the rest)', async () => {
    const el = await mount(makeHass(states(awakeFx)), orderCfg(['grid', 'powerwall', 'solar'], ['powerwall']));
    // powerwall hidden at the model seam (9.2) ⇒ not present ⇒ dropped from the order partition.
    expect(sr(el).querySelector('.scene-cell[data-node="powerwall"]')).toBeNull();
    expect(sourceNodes(el)).toEqual(['grid', 'solar']);
  });

  test('AC4 — vehicle reorder: order:["vehicle","home"] renders the vehicle BEFORE home/WC, WC→Vehicle edge intact', async () => {
    const el = await mount(makeHass(states(awakeFx)), orderCfg(['vehicle', 'home']));
    // The load row places the vehicle cell first, then home (listed), then WC (canonical rest).
    expect(loadNodes(el)).toEqual(['vehicle', 'home', 'wall_connector']);
    // The vehicle remains a presentation cell and its WC→Vehicle overlay edge still draws.
    recompute(el);
    await el.updateComplete;
    expect(vehCell(el)).not.toBeNull();
    expect(vehEdge(el)).not.toBeNull();
    // The source row is untouched by a load-row reorder.
    expect(sourceNodes(el)).toEqual(['solar', 'powerwall', 'grid']);
  });

  test('AC5 — a reorder-only CONFIG change fires the present-set reflow EXACTLY once', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(sourceNodes(el)).toEqual(['solar', 'powerwall', 'grid']);
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    el.setConfig(orderCfg(['grid', 'solar'])); // same present-set, NEW order
    await el.updateComplete;
    expect(spy).toHaveBeenCalledTimes(1); // ONE reflow — the cached geometry re-measures the moved anchors
    expect(sourceNodes(el)).toEqual(['grid', 'solar', 'powerwall']);
  });

  test('AC5 — a re-render with the SAME order schedules ZERO geometry recomputes (no per-tick reflow)', async () => {
    const el = await mount(makeHass(states(awakeFx)), orderCfg(['grid', 'solar']));
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    // A value-only hass tick (same present-set, same order) must NOT reflow.
    el.hass = makeHass(states(awakeFx));
    await el.updateComplete;
    expect(spy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.7 — multi-instance: N cells / taps / legs per duplicated role, each with
// its own data-node id, entity set, and bus tap. jsdom returns zero rects, so this
// pins the cell/leg/model ROSTER + ids (pixel geometry — the 182px wrap offset, comb
// routing, no-cross — is the e2e tier). A single-instance role stays BARE (FR-33).
// ═══════════════════════════════════════════════════════════════════════════
/**
 * A 2-solar-array hass + config. Instance #1 is pinned to the fixture's resolved
 * solar id; instance #2 to a DERIVED sibling id (never an inlined literal — the
 * [card] no-hard-coded-ids rule). Returns both ids so the per-instance binding can
 * be asserted by identity.
 */
function twoSolar(): { hass: HomeAssistant; cfg: TeslaCardConfig; ids: { south: string; garage: string } } {
  const s = states(awakeFx);
  const south = energyIds(s).solar_power!; // the fixture's resolved base solar id
  const garage = `${south}_garage`; // a derived sibling = the 2nd array's sensor
  s[garage] = { ...s[south], state: '1.2' };
  s[south] = { ...s[south], state: '2.0' };
  const cfg: TeslaCardConfig = {
    type: 'tc-my-home',
    energy: {
      entities: { solar_power: south }, // pin instance #1's base resolution
      nodes: { instances: { solar: [{}, { entities: { solar_power: garage } }] } },
    },
  };
  return { hass: makeHass(s), cfg, ids: { south, garage } };
}

describe('Story 9.7 — render N cells / taps / legs per instance (AC2/AC3/AC4)', () => {
  test('a 2-instance solar role renders 2 cells with unique data-node ids (solar:1 / solar:2)', async () => {
    const { hass, cfg } = twoSolar();
    const el = await mount(hass, cfg);
    expect(sr(el).querySelector('.scene-cell[data-node="solar:1"]')).not.toBeNull();
    expect(sr(el).querySelector('.scene-cell[data-node="solar:2"]')).not.toBeNull();
    // duplicated ⇒ every instance is suffixed; the bare `solar` id is gone (no collision).
    expect(sr(el).querySelector('.scene-cell[data-node="solar"]')).toBeNull();
    // both cells embed the tc-solar child.
    expect(sr(el).querySelector('.scene-cell[data-node="solar:1"] tc-solar')).not.toBeNull();
    expect(sr(el).querySelector('.scene-cell[data-node="solar:2"] tc-solar')).not.toBeNull();
  });

  test('the shared model carries 2 present solar nodes + 2 edges — one tap per instance', async () => {
    const { hass, cfg } = twoSolar();
    const el = await mount(hass, cfg);
    const model = (el as unknown as { _model: FlowModel })._model;
    const solar = model.nodes.filter((n) => n.role === 'solar' && n.present);
    expect(solar.map((n) => n.id)).toEqual(['solar:1', 'solar:2']);
    expect(model.edges.filter((e) => e.from === 'solar:1' || e.from === 'solar:2')).toHaveLength(2);
  });

  test('each cell binds its OWN resolved entity set — the per-instance override reaches the child', async () => {
    const { hass, cfg, ids } = twoSolar();
    const el = await mount(hass, cfg);
    const child = (id: string) =>
      sr(el).querySelector(`.scene-cell[data-node="${id}"] tc-solar`) as unknown as {
        config?: TeslaCardConfig;
      };
    expect(child('solar:1')?.config?.energy?.entities?.solar_power).toBe(ids.south);
    expect(child('solar:2')?.config?.energy?.entities?.solar_power).toBe(ids.garage);
  });

  test('each instance gets its OWN leg keyed by instance id (no merged role leg)', async () => {
    const { hass, cfg } = twoSolar();
    const el = await mount(hass, cfg);
    recompute(el);
    await el.updateComplete;
    expect(legOf(el, 'solar:1')).not.toBeNull();
    expect(legOf(el, 'solar:2')).not.toBeNull();
    expect(legOf(el, 'solar')).toBeNull();
  });

  test('FR-33 zero-diff: a single-instance role keeps the BARE data-node (no :1 suffix)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    expect(sr(el).querySelector('.scene-cell[data-node="solar"]')).not.toBeNull();
    expect(sr(el).querySelector('.scene-cell[data-node="solar:1"]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.7 — WRAP overflow (AC5/AC7). jsdom has no layout, so this pins the DOM
// STRUCTURE + reading order (the a11y-critical half): a band over 3 cards splits
// into a primary + an offset overflow sub-row, DOM order stays primary→overflow
// (the 182/230px channel offset + the visual top-placement are CSS-only and MUST
// NOT reorder the DOM — SC 1.3.2/2.4.3). The pixel geometry (offset, comb routing,
// no-cross) is the e2e tier (tests/e2e/my-home-scene.spec.ts).
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 9.7 — wrap overflow: a band over 3 cards splits into sub-rows (AC5/AC7)', () => {
  test('a 4-source band wraps: a .subrow.primary (3) + a .subrow.overflow (the extras)', async () => {
    const { hass, cfg } = twoSolar(); // solar:1, solar:2, powerwall, grid = 4 sources
    const el = await mount(hass, cfg);
    const band = sr(el).querySelector('.source-row')!;
    expect(band.classList.contains('wrapped')).toBe(true);
    expect(band.querySelector('.subrow.primary')!.querySelectorAll('.scene-cell')).toHaveLength(3);
    expect(band.querySelector('.subrow.overflow')!.querySelectorAll('.scene-cell')).toHaveLength(1);
  });

  test('DOM/Tab order is the packed reading order primary→overflow (NOT far-before-near)', async () => {
    const { hass, cfg } = twoSolar();
    const el = await mount(hass, cfg);
    const ids = [...sr(el).querySelectorAll('.source-row .scene-cell')].map(
      (c) => (c as HTMLElement).dataset.node
    );
    // canonical packed order, the first 3 in the primary row then the overflow — the
    // CSS `order:-1` flips only the VISUAL stacking, never this DOM sequence.
    expect(ids).toEqual(['solar:1', 'solar:2', 'powerwall', 'grid']);
    const subrows = [...sr(el).querySelectorAll('.source-row .subrow')];
    expect(subrows[0].classList.contains('primary')).toBe(true);
    expect(subrows[1].classList.contains('overflow')).toBe(true);
  });

  test('a band of exactly 3 does NOT wrap — cells are direct children (zero-diff structure)', async () => {
    const el = await mount(makeHass(states(awakeFx))); // 3 sources: solar, powerwall, grid
    const band = sr(el).querySelector('.source-row')!;
    expect(band.classList.contains('wrapped')).toBe(false);
    expect(band.querySelector('.subrow')).toBeNull();
    expect(band.querySelectorAll('.scene-cell')).toHaveLength(3);
  });

  test('the wrap path adds NO overflow notice (it just reflows — clamp/notice is 9.8)', async () => {
    const { hass, cfg } = twoSolar();
    const el = await mount(hass, cfg);
    // no "cards hidden / Show all" affordance on the wrap path.
    expect(sr(el).querySelector('.clamp-note, .overflow-notice')).toBeNull();
  });
});

describe('Story 9.7 — wrap is band-agnostic: the LOAD row wraps symmetrically (AC5)', () => {
  test('2 wall-connector instances + home + vehicle = 4 load cards ⇒ the load band wraps', async () => {
    // wc:1 / wc:2 (both resolve the same sensor — structure under test) + home + vehicle
    // ⇒ the load band exceeds 3 ⇒ the SAME primary/overflow split as the source band.
    const cfg: TeslaCardConfig = {
      type: 'tc-my-home',
      energy: { nodes: { instances: { wall_connector: [{}, {}] } } },
    };
    const el = await mount(makeHass(states(awakeFx)), cfg);
    const band = sr(el).querySelector('.load-row')!;
    expect(band.classList.contains('wrapped')).toBe(true);
    expect(band.querySelector('.subrow.primary')).not.toBeNull();
    expect(band.querySelector('.subrow.overflow')).not.toBeNull();
    // both WC instances render as distinct cells.
    expect(sr(el).querySelector('.scene-cell[data-node="wall_connector:1"]')).not.toBeNull();
    expect(sr(el).querySelector('.scene-cell[data-node="wall_connector:2"]')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.7 — the summary ribbon FOLDS instances (INV-9, AC6/AC7). N instances of a
// role surface as ONE tile whose value is the SUMMED total + a ×N count chip, with an
// accessible name announcing multiplicity. A ribbon that read net[role] (the pre-9.7
// fixed-node assumption) would silently drop the 2nd array — the "ribbon lies" failure.
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 9.7 — the summary ribbon folds instances (INV-9, AC6/AC7)', () => {
  const solarTiles = (el: Scene): Element[] =>
    [...sr(el).querySelectorAll('.rib-tile')].filter((t) =>
      t.querySelector('.rib-tk')?.textContent?.includes('Solar'),
    );

  test('2 solar instances ⇒ ONE Solar tile whose value is the SUM (3.2 kW) + a ×2 fold chip', async () => {
    const { hass, cfg } = twoSolar(); // solar:1 = 2.0, solar:2 = 1.2
    const el = await mount(hass, cfg);
    const tiles = solarTiles(el);
    expect(tiles).toHaveLength(1); // folded — not one tile per array
    expect(tiles[0].querySelector('.rib-tv')?.textContent?.trim()).toBe(`3.2 ${U}`);
    expect(tiles[0].querySelector('.rib-fold')?.textContent?.trim()).toBe('×2');
  });

  test('the folded tile announces multiplicity + total in its accessible name (AC7)', async () => {
    const { hass, cfg } = twoSolar();
    const el = await mount(hass, cfg);
    const aria = solarTiles(el)[0].getAttribute('aria-label') ?? '';
    expect(aria).toContain('Solar');
    expect(aria).toContain('2'); // the count
    expect(aria).toContain('3.2'); // the summed total
    expect(aria).toContain('total');
  });

  test('a single-instance ribbon tile is unchanged — no fold chip, no aria-label (zero-diff)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const tile = [...sr(el).querySelectorAll('.rib-tile')].find(
      (t) => t.querySelector('.rib-tk')?.textContent?.trim() === 'Solar',
    )!;
    expect(tile.querySelector('.rib-fold')).toBeNull();
    expect(tile.getAttribute('aria-label')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.7 — title disambiguation + a11y under duplication (AC7). Two same-role
// cards are told apart by TITLE (never a numeric :n badge); the accessible name folds
// the title in; each duplicated-instance leg carries an always-present identity token
// (separable without colour, motion frozen). Single-instance stays byte-identical.
// ═══════════════════════════════════════════════════════════════════════════
function twoTitledSolar(): { hass: HomeAssistant; cfg: TeslaCardConfig } {
  const s = states(awakeFx);
  const south = energyIds(s).solar_power!;
  const garage = `${south}_garage`;
  s[garage] = { ...s[south], state: '1.2' };
  const cfg: TeslaCardConfig = {
    type: 'tc-my-home',
    energy: {
      entities: { solar_power: south },
      nodes: {
        instances: {
          solar: [{ title: 'South Array' }, { title: 'Garage', entities: { solar_power: garage } }],
        },
      },
    },
  };
  return { hass: makeHass(s), cfg };
}

describe('Story 9.7 — title disambiguation + a11y under duplication (AC7)', () => {
  test('two same-role cells render DISTINCT titles from InstanceSpec.title', async () => {
    const { hass, cfg } = twoTitledSolar();
    const el = await mount(hass, cfg);
    const titleOf = (id: string) =>
      sr(el).querySelector(`.scene-cell[data-node="${id}"] .uc-title`)?.textContent?.trim();
    expect(titleOf('solar:1')).toBe('South Array');
    expect(titleOf('solar:2')).toBe('Garage');
  });

  test('the cell accessible name folds in the title — told apart by TITLE, not a numeric :n badge', async () => {
    const { hass, cfg } = twoTitledSolar();
    const el = await mount(hass, cfg);
    const c1 = sr(el).querySelector('.scene-cell[data-node="solar:1"]')!;
    expect(c1.getAttribute('aria-label')).toBe('Solar, South Array');
    expect(c1.classList.contains('has-title')).toBe(true);
    // the internal :n id is NEVER surfaced as a visible badge.
    expect(c1.querySelector('.uc-title')?.textContent).not.toContain(':');
  });

  test('each duplicated-instance leg carries an always-present identity token', async () => {
    const { hass, cfg } = twoTitledSolar();
    const el = await mount(hass, cfg);
    recompute(el);
    await el.updateComplete;
    expect(legOf(el, 'solar:1')?.querySelector('.gw-leg-id')?.textContent?.trim()).toBe('1');
    expect(legOf(el, 'solar:2')?.querySelector('.gw-leg-id')?.textContent?.trim()).toBe('2');
  });

  test('single-instance: NO title badge / has-title class / aria-label / leg token (FR-33 zero-diff)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    recompute(el);
    await el.updateComplete;
    const solarCell = sr(el).querySelector('.scene-cell[data-node="solar"]')!;
    expect(solarCell.querySelector('.uc-title')).toBeNull();
    expect(solarCell.classList.contains('has-title')).toBe(false);
    expect(solarCell.getAttribute('aria-label')).toBeNull();
    expect(legOf(el, 'solar')?.querySelector('.gw-leg-id')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.7 — perf + data boundary (AC8). A multi-instance config change reflows
// EXACTLY once (the present-key includes the instance roster), a value-only tick zero;
// and the slice-gate watches each per-instance OVERRIDE sensor so a duplicated
// instance stays lastUpdated-gated from the shared hass (no per-instance polling).
// ═══════════════════════════════════════════════════════════════════════════
describe('Story 9.7 — reflow-once + slice covers per-instance overrides (AC8)', () => {
  test('a config change that ADDS an instance reflows EXACTLY once', async () => {
    const { hass } = twoSolar();
    const el = await mount(hass); // single-instance baseline (bare config)
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    el.setConfig({ type: 'tc-my-home', energy: { nodes: { instances: { solar: [{}, {}] } } } });
    await el.updateComplete;
    expect(spy).toHaveBeenCalledTimes(1); // the new roster (solar:1,solar:2) flips the key once
  });

  test('a value-only tick (same instance roster) does NOT recompute geometry', async () => {
    const { hass, cfg, ids } = twoSolar();
    const el = await mount(hass, cfg);
    const spy = vi.spyOn(el as unknown as { _scheduleGeometry: () => void }, '_scheduleGeometry');
    const s = states(awakeFx);
    s[ids.garage] = { ...s[ids.south]!, state: '1.2' }; // keep the 2nd array present (same roster)
    s[ids.south] = { ...s[ids.south]!, state: '9.9', last_updated: FUTURE }; // a new reading only
    el.hass = makeHass(s);
    await el.updateComplete;
    expect(spy).not.toHaveBeenCalled();
  });

  test('the slice-gate watches each per-instance OVERRIDE sensor (AC8 — instance #2 stays live)', async () => {
    const { hass, cfg, ids } = twoSolar();
    const el = await mount(hass, cfg);
    const sliceIds = new Set(
      (el as unknown as { _sliceIds(): (string | undefined)[] })._sliceIds(),
    );
    expect(sliceIds.has(ids.garage)).toBe(true); // the override sensor is gated on
  });
});
