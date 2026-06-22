// @vitest-environment jsdom
//
// R6 SUITE-COMPLETE audit checkpoint (Story 6.8) — the machinable half.
//
// 5.11 audited the vehicle card as a whole; 6.8 is that checkpoint one level up:
// the COMPOSED SUITE (the six ecosystem cards + the "My Home" Scene) verified as a
// whole, catching the integration-level gaps the per-card ACs miss in isolation.
// This file pins the parts a machine CAN assert; the evaluative residue (focus
// "reads at a glance", "calm not broken") and the ~60fps profiler measurement are
// routed to human/profiler sign-off in docs/audit-r6-suite.md (NOT claimed here).
//
//   • AC4 (the one likely real proof): the ecosystem cards + Scene resolve the five
//     energy roles by FUNCTION-NAME across a NON-DEFAULT install prefix — not only
//     the auto-detected default. Energy entities resolve by stable function-slug
//     substring in the object-id (`data/energy.ts` find(), prefix-independent,
//     `_2`-tolerant), so this is a PROOF the resolution is dialect/prefix-agnostic
//     by construction. The non-default prefix is SYNTHETIC/ASSUMED (we hold no
//     captured second-dialect corpus) — we assert the MECHANISM (slug match), never
//     that an invented spelling is ground truth (the 5.11 honesty rule).
//   • AC2 (composed re-confirm): the half-alive Scene reads calm-not-broken
//     composed — the partial-quiescent ribbon is NOT wholesale-dimmed, the
//     fully-quiescent ribbon IS dimmed + age-stamped; staleness tone is `-dim`.
//   • Suite invariant (composed-view authority split): the discrete charging entity
//     (Hero halo, via normalizeChargingState) and the FlowModel-owned Wall-Connector
//     edge AGREE on the committed fixtures — a visible mismatch is a defect.
//   • Degradation (DoD): the suite renders against 0-data / asleep / the non-default
//     prefix without throwing, blanking, or painting a false state / NaN.
//
// jsdom opt-in like the other element suites; jsdom returns zero-sized rects, so
// this pins resolution / wiring / classes / values — never pixel geometry (that is
// the live-layout E2E layer's job, tests/e2e/audit-r6-suite.spec.ts).
import { afterEach, describe, expect, test, vi } from 'vitest';
import './components/my-home'; // registers tc-my-home + the five Scene-unaware cards
import { resolveEnergyEntities, hasEnergySite } from './data/energy';
import { bindFlowModel } from './flow/binding';
import { computeBalance } from './flow/balance';
import { normalizeChargingState } from './data/dialect';
import { STRINGS } from './strings';
import awakeFx from './fixtures/model-y-awake.json';
import energyDetailFx from './fixtures/energy-detail.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from './types';
// ── Story 8.8 depth-audit imports (the Epic-8 richness this checkpoint sweeps) ──
import { nodeHeroStyles } from './components/node-hero';
import { chartStyles } from './components/chart';
import { sceneBusStyles } from './flow/scene-bus';
import { TcPowerwall } from './components/powerwall';
import { TcMyHome } from './components/my-home';
import { buildFlowModel, type FlowInput, type FlowModel } from './flow/model';
import { selfPowered, wcVehicleEdge } from './flow/my-home';
import { ENERGY_ROLES } from './flow/binding';

const CONFIG: TeslaCardConfig = { type: 'tc-my-home' };

function states(fx: { states: Record<string, HassEntity> }): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(fx.states)) as Record<string, HassEntity>;
}
function makeHass(s: Record<string, HassEntity>): HomeAssistant {
  return { states: s } as unknown as HomeAssistant;
}

// ── The NON-DEFAULT-dialect transform (AC4) ────────────────────────────────────
// A fully distinct install: re-prefix every energy object-id away from BOTH the
// bundled vehicle prefix (`garage_model_y_*`) AND the fixture's site prefix
// (`my_home_*` / `tesla_wall_connector_*`) to a synthetic third prefix — while
// PRESERVING the function-slug each `data/energy` rule keys on. If resolution were
// prefix-coupled (a fleet-shaped assumption) every role would vanish here; that it
// still resolves is the AC4 proof. The exact prefix is ASSUMED, not a captured
// corpus — only the slug-match mechanism is asserted as ground truth.
const RESLUG: ReadonlyArray<readonly [RegExp, string]> = [
  [/my_home_/g, 'acme_ess_'], // energy-site sensors → a synthetic ESS vendor prefix
  [/tesla_wall_connector_/g, 'acme_evse_wall_connector_'], // EVSE → synthetic vendor, slug kept
];
/** A states map whose energy ids carry a synthetic non-default install prefix. */
function crossDialect(s: Record<string, HassEntity>): Record<string, HassEntity> {
  const out: Record<string, HassEntity> = {};
  for (const [id, ent] of Object.entries(s)) {
    const nid = RESLUG.reduce((acc, [re, to]) => acc.replace(re, to), id);
    out[nid] = { ...ent, entity_id: nid } as HassEntity;
  }
  return out;
}

const sr = (el: Scene) => el.shadowRoot!;
type Scene = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  updateComplete: Promise<boolean>;
};
async function mount(
  hass: HomeAssistant | undefined,
  tag = 'tc-my-home',
  config: TeslaCardConfig = CONFIG
): Promise<Scene> {
  const el = document.createElement(tag) as Scene;
  if (hass) el.hass = hass;
  el.setConfig(config);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
// Excludes the Story-8.5 vehicle cell (an inline `.scene-cell[data-node="vehicle"]`
// whose firstElementChild is a `<div class="surface">`, NOT a `tc-*` child element) —
// this query enumerates the registered ECOSYSTEM child cards only.
const cellTags = (el: Scene): string[] =>
  [...sr(el).querySelectorAll<HTMLElement>('.scene-cell:not([data-node="vehicle"])')].map(
    (c) => (c.firstElementChild?.tagName ?? '').toLowerCase()
  );

afterEach(() => {
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — cross-dialect: function-name resolution holds across a non-default prefix
// ═══════════════════════════════════════════════════════════════════════════
describe('AC4 — the ecosystem cards + Scene resolve by function-name across dialects', () => {
  const ROLE_SLUG: ReadonlyArray<readonly [keyof ReturnType<typeof resolveEnergyEntities>, string]> = [
    ['solar_power', 'solar_power'],
    ['battery_power', 'battery_power'],
    ['grid_power', 'grid_power'],
    ['load_power', 'load_power'],
    ['wc_power', 'total_power'],
  ];

  test('the prefix transform is genuinely NON-DEFAULT (no garage_model_y_/my_home_ left in energy ids)', () => {
    const s = crossDialect(states(awakeFx));
    const energyish = Object.keys(s).filter((id) =>
      /(solar_power|battery_power|grid_power|load_power|total_power|percentage_charged)/.test(id)
    );
    expect(energyish.length).toBeGreaterThan(0);
    // None of the present-energy ids carry either default prefix → a real third install.
    for (const id of energyish) {
      expect(id).not.toContain('garage_model_y');
      expect(id).not.toContain('my_home');
    }
  });

  test('every present power role STILL resolves — by slug substring, not by prefix', () => {
    const s = crossDialect(states(awakeFx));
    const e = resolveEnergyEntities(makeHass(s), CONFIG);
    for (const [key, slug] of ROLE_SLUG) {
      expect(e[key], `${key} must resolve under the non-default prefix`).toBeDefined();
      expect(e[key]!).toContain(slug); // resolved BY the function-slug it carries
      expect(e[key]!).toContain('acme'); // …and it is genuinely the synthetic install
    }
    expect(hasEnergySite(e)).toBe(true);
  });

  test('the composed Scene renders all five present cards under the non-default prefix', async () => {
    const el = await mount(makeHass(crossDialect(states(awakeFx))));
    expect(cellTags(el)).toEqual([
      'tc-solar',
      'tc-powerwall',
      'tc-grid',
      'tc-home',
      'tc-wall-connector',
    ]);
    // The bus overlay (≥1 present node) is drawn and names a present node — no blank.
    const overlay = sr(el).querySelector('.scene-bus');
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute('aria-label') ?? '').toContain(STRINGS.energy.nodes.solar);
  });

  for (const [tag, slug] of [
    ['tc-solar', 'solar_power'],
    ['tc-powerwall', 'battery_power'],
    ['tc-grid', 'grid_power'],
    ['tc-home', 'load_power'],
    ['tc-wall-connector', 'total_power'],
  ] as const) {
    test(`${tag} renders standalone under the non-default prefix (resolves ${slug}, no NaN/empty)`, async () => {
      const el = await mount(makeHass(crossDialect(states(awakeFx))), tag);
      const surface = sr(el).querySelector('.surface');
      expect(surface, `${tag} renders its shell`).not.toBeNull();
      const txt = sr(el).textContent ?? '';
      expect(txt).not.toContain('NaN'); // never a fabricated value under a strange prefix
      expect(txt).toMatch(/kW|%/); // the resolved magnitude is shown (function-name worked)
    });
  }

  test('the balance is IDENTICAL across prefixes — same values, only the ids differ', () => {
    // The cross-dialect transform only re-prefixes ids; the VALUES are untouched. So
    // `computeBalance().net` must match the default-dialect net node-for-node — proof
    // the non-default prefix changed resolution alone, never the physics (R2: one
    // sign/balance authority, consumed identically regardless of install).
    const def = computeBalance(bindFlowModel(makeHass(states(awakeFx)), CONFIG)).net;
    const alt = computeBalance(bindFlowModel(makeHass(crossDialect(states(awakeFx))), CONFIG)).net;
    expect(Object.keys(alt).sort()).toEqual(Object.keys(def).sort());
    for (const id of Object.keys(def)) {
      expect(alt[id]).toBeCloseTo(def[id], 6);
    }
  });

  test('an ABSENT node under the non-default prefix still degrades gracefully (6.7 holds across dialects)', async () => {
    const s = crossDialect(states(awakeFx));
    // Drop the (re-prefixed) Powerwall power reading by its function-slug — never an id.
    for (const id of Object.keys(s)) if (id.includes('battery_power')) delete s[id];
    const el = await mount(makeHass(s));
    expect(cellTags(el)).not.toContain('tc-powerwall');
    expect(sr(el).querySelector('.scene')).not.toBeNull(); // calm, present — no crash
    const model = (el as unknown as { _model: { nodes: { role: string; present: boolean }[] } })._model;
    expect(model.nodes.find((n) => n.role === 'powerwall')?.present).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite invariant — the composed-view authority split (project-context Epic-4):
// the discrete charging entity owns the Hero halo; the FlowModel owns the WC edge
// magnitude/direction. A visible halo-vs-edge MISMATCH is a defect. On the awake
// fixture the car reports `Charging` and the WC delivers 7.4 kW — they must AGREE.
// ═══════════════════════════════════════════════════════════════════════════
describe('Suite invariant — Hero halo (discrete) agrees with the Wall-Connector flow edge (FlowModel)', () => {
  test('a charging car (discrete entity) ⇒ an ACTIVE wall_connector flow edge — no mismatch', () => {
    const s = states(awakeFx);
    // The Hero halo authority: the discrete charging entity through normalizeChargingState.
    const halo = normalizeChargingState(s['sensor.garage_model_y_charging']?.state);
    expect(halo).toBe('charging');

    // The Scene/Flow authority: the wall_connector edge in the ONE shared FlowModel.
    const model = bindFlowModel(makeHass(s), CONFIG);
    const wcEdge = model.edges.find((e) => e.from === 'wall_connector');
    expect(wcEdge, 'the WC edge IS the car-charging edge (no 6th vehicle node)').toBeDefined();
    // They agree: discrete says charging AND the flow edge carries a live (non-none) flow.
    expect(wcEdge!.direction).not.toBe('none');
    expect(Math.abs(wcEdge!.kW)).toBeGreaterThan(0.05); // above the IDLE_KW deadband
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Degradation (DoD / FR-24 / NFR-4) — the composed suite never throws/blanks/
// paints a false state across 0-data, asleep, and the non-default prefix.
// ═══════════════════════════════════════════════════════════════════════════
describe('Degradation — the composed suite renders calm against adverse inputs (no throw / NaN / false state)', () => {
  test('a 0-data hass renders a calm Scene — no cards, no overlay, no crash', async () => {
    const el = await mount(makeHass({}));
    expect(sr(el).querySelector('.scene')).not.toBeNull();
    expect(sr(el).querySelectorAll('.scene-cell')).toHaveLength(0);
    expect(sr(el).querySelector('.scene-bus')).toBeNull(); // empty model ⇒ omitted, not blank
  });

  test('the non-default prefix never paints a NaN anywhere in the composed Scene', async () => {
    const el = await mount(makeHass(crossDialect(states(awakeFx))));
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STORY 8.8 — Epic-8 DEPTH section (the deepened-suite R6 audit, layered over 6.8).
//
// 6.8 swept the MVP suite (the three Scene animations gated, the half-alive read,
// cross-dialect resolution, the 60fps procedure + ladder). 8.8 extends that pass to
// ONLY the richness Epic 8 added — the NEW animation sources (hero art `nhPulse`,
// chart `chartIn`, the segmented-control `.seg` transition, the enriched bus pills/
// legs opacity transition), the NEW honesty surfaces (charts over absent history;
// the self-powered % over no/stale load), and the depth-level composed-authority
// invariants (the vehicle cell ↔ WC-edge, no 6th flow node). The evaluative residue
// ("reads at a glance") + the ~60fps profiler measurement route to human/profiler
// sign-off in docs/audit-r6-suite.md (NOT claimed here). jsdom = the machinable half;
// the runtime reduced-motion/focus sweep is tests/e2e/audit-r6-suite.spec.ts.
// ═══════════════════════════════════════════════════════════════════════════

/** Flatten a Lit static-styles group (CSSResult | CSSResult[] | nested) to one cssText. */
function cssTextOf(group: unknown): string {
  if (Array.isArray(group)) return group.map(cssTextOf).join('\n');
  const g = group as { cssText?: string };
  return typeof g?.cssText === 'string' ? g.cssText : '';
}
/** The substring of a stylesheet from its reduced-motion guard onward (`''` if none). */
function reducedMotionBlock(cssText: string): string {
  const i = cssText.indexOf('prefers-reduced-motion');
  return i === -1 ? '' : cssText.slice(i);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 / AC4 — every NEW Epic-8 animation source is reduced-motion-gated.
//
// The composed-sweep inventory the per-story tests verify ONE source at a time,
// machined at the stylesheet level so the WHOLE deepened set is proven gated in one
// place (the runtime "they freeze together" proof is the E2E half). Each source must
// (a) carry its animation/transition token AND (b) neutralize it to `none` inside a
// `prefers-reduced-motion: reduce` block — "kill the motion, keep the data".
// ─────────────────────────────────────────────────────────────────────────────
describe('AC1/AC4 depth — every NEW Epic-8 animation source freezes under reduced-motion', () => {
  const NEW_ANIM_SOURCES: ReadonlyArray<{ name: string; css: string; token: string; kill: 'animation' | 'transition' }> = [
    { name: 'node-hero nhPulse (WC status dot, 8.2)', css: cssTextOf(nodeHeroStyles), token: 'nhPulse', kill: 'animation' },
    { name: 'chart chartIn (draw-on fade, 8.3)', css: cssTextOf(chartStyles), token: 'chartIn', kill: 'animation' },
    { name: 'powerwall .seg transition (8.4)', css: cssTextOf(TcPowerwall.styles), token: '.seg', kill: 'transition' },
    { name: 'scene-bus sb-flow-dash (Gateway bus dash, 6.6/8.6)', css: cssTextOf(sceneBusStyles), token: 'sb-flow-dash', kill: 'animation' },
    // 8.6's enriched-bus DECORATIONS (kW pills/terminals/taps) are deliberately
    // STATIC SVG (no keyframe) — already the "keep the data" read, nothing to gate.
    // The only my-home motion is the focus-highlight opacity transition (cells + the
    // 8.6 bus legs), gated together under the reduced-motion block.
    { name: 'my-home focus-highlight opacity transition (cells + 8.6 bus legs)', css: cssTextOf(TcMyHome.styles), token: 'transition: opacity', kill: 'transition' },
  ];

  for (const src of NEW_ANIM_SOURCES) {
    test(`${src.name} — present AND killed under prefers-reduced-motion`, () => {
      expect(src.css, 'the animation/transition source token is present').toContain(src.token);
      const rm = reducedMotionBlock(src.css);
      expect(rm, 'a prefers-reduced-motion block must exist').not.toBe('');
      // The block neutralizes the motion to `none` — the data cue is unaffected.
      expect(rm).toMatch(new RegExp(`${src.kill}\\s*:\\s*none`));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 depth — freshness honesty across the NEW surfaces (composed render-level).
// The per-story tests pin the MATH (selfPowered undefined; chart empty-safe); these
// pin the COMPOSED RENDER — what the deepened Scene actually paints — plus the lone
// staleness-tone outlier the 6.8 audit's prose claimed but the code violated.
// ─────────────────────────────────────────────────────────────────────────────
describe('AC2 depth — the self-powered % is honest over a no-load composed Scene', () => {
  test('generation-only (no live load) ⇒ selfPowered.pct undefined ⇒ the ribbon lead reads — (never a confident 0%/100%)', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    // A generation-only tick: there is nothing to be a percentage *of* (8.7 AC2).
    const model: FlowModel = buildFlowModel([{ role: 'solar', kW: 3, provenance: 'measured' } as FlowInput]);
    expect(selfPowered(model).pct, 'no live load ⇒ pct is undefined (the honest —)').toBeUndefined();
    (el as unknown as { _model: FlowModel })._model = model;
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    const big = sr(el).querySelector('.rib-big');
    expect(big, 'the ribbon renders its self-powered lead').not.toBeNull();
    expect(big!.textContent?.trim(), 'the lead reads the honest em-dash, not 0% / 100%').toBe('—');
  });

  test('a fully-quiescent Scene IS dimmed + age-stamped, and the stamp uses the freshness-honest tone', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const model: FlowModel = buildFlowModel([
      { role: 'solar', kW: 3, provenance: 'quiescent' } as FlowInput,
      { role: 'home', kW: 4, provenance: 'quiescent' } as FlowInput,
    ]);
    (el as unknown as { _model: FlowModel })._model = model;
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;
    const ribbon = sr(el).querySelector('.ribbon');
    expect(ribbon!.classList.contains('dim'), 'fully quiescent ⇒ de-emphasized').toBe(true);
    expect(sr(el).querySelector('.ribbon-age'), 'shows the last-known "updated Nm ago" stamp').not.toBeNull();
  });
});

describe('AC2 depth — staleness copy uses --tc-text-dim, NEVER --tc-text-mute (the gate-blind-spot lesson)', () => {
  // The DoD honesty rule (UX-DR18): a freshness "updated Nm ago" stamp is a
  // disclosure, not a decorative caption, so it must render at the freshness-honest
  // --tc-text-dim tone (4.5:1) like every other stale stamp (.tc-stale-copy →
  // .veh-age / .eco-stamp) — NEVER the lowest-contrast --tc-text-mute. The bare-var
  // gate checks a fallback EXISTS, not that the right token is used, so this is a
  // gate blind-spot only a depth review catches. Story 8.8 fixed the lone outlier
  // (.ribbon-age, the Gateway-ribbon stamp); this pins it so it can't regress.
  test('.ribbon-age (the quiescent-Scene stamp) is --tc-text-dim, not --tc-text-mute', () => {
    // Strip CSS comments first so the assertion reads the DECLARATION, not the
    // explanatory comment (which legitimately names the forbidden token).
    const css = cssTextOf(TcMyHome.styles).replace(/\/\*[\s\S]*?\*\//g, '');
    const m = css.match(/\.ribbon-age\s*\{[^}]*\}/);
    expect(m, '.ribbon-age rule is present').not.toBeNull();
    expect(m![0]).toContain('--tc-text-dim');
    expect(m![0], 'staleness copy must not use the lowest-contrast mute tone').not.toContain('--tc-text-mute');
  });

  test('the in-Scene vehicle staleness stamp routes through the shared .tc-stale-copy recipe (--tc-text-dim)', async () => {
    // The vehicle cell stamps last-known via class="veh-age tc-stale-copy" (the
    // shared --tc-text-dim recipe) — confirm composed it is not a bespoke mute tone.
    const el = await mount(makeHass(states(awakeFx)));
    const cell = sr(el).querySelector('.veh-cell');
    // The cell exists only when a vehicle battery_level resolves; the awake fixture
    // has one. The stamp may be absent on a fresh read — assert the recipe, not its
    // presence: any veh-age carries the shared stale-copy class.
    const stamp = cell?.querySelector('.veh-age');
    if (stamp) expect(stamp.classList.contains('tc-stale-copy')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC1/AC4 depth — the composed-view authority split holds at the new depth: the
// vehicle cell + WC→Vehicle edge read the ONE wcVehicleEdge view; there is no 6th
// flow node and the engine still carries exactly the five ENERGY_ROLES (FR-33 / 8.5).
// The cell-kW ↔ edge-kW NUMERIC agreement is pinned per-story in my-home.test.ts
// (Story 8.5 AC2); this pins the STRUCTURAL invariant that makes it true.
// ─────────────────────────────────────────────────────────────────────────────
describe('Depth invariant — the WC edge IS the car-charging edge (vehicle is never a flow node)', () => {
  test('the bound flow model carries NO vehicle node and the vehicle is never an engine role', async () => {
    const el = await mount(makeHass(states(awakeFx)));
    const model = (el as unknown as { _model: FlowModel })._model;
    const roles = model.nodes.map((n) => n.role);
    expect(roles, 'no presentation vehicle node leaked into the flow engine').not.toContain('vehicle');
    // Story 9.14 grew the engine to six energy roles (the sanctioned new generator
    // SOURCE). The invariant that still holds is the REAL one this guard always
    // protected: the vehicle is NOT a flow node (the WC edge IS the car-charging edge).
    expect(ENERGY_ROLES, 'six engine roles after the generator source landed').toHaveLength(6);
    expect(ENERGY_ROLES, 'the vehicle is still not a flow node').not.toContain('vehicle');
    for (const r of ENERGY_ROLES) expect(r).not.toBe('vehicle');
  });

  test('a charging car ⇒ the single wcVehicleEdge view is active (the cell + overlay edge read THIS)', () => {
    const model = bindFlowModel(makeHass(states(awakeFx)), CONFIG);
    const wcEdge = model.edges.find((e) => e.from === 'wall_connector');
    expect(wcEdge, 'the WC edge exists — it IS the car-charging edge').toBeDefined();
    const view = wcVehicleEdge(model);
    // The single derivation both the cell badge AND the overlay edge consume.
    expect(view.active).toBe(true);
    expect(view.kW).toBeCloseTo(Math.abs(wcEdge!.kW), 6); // |edge.kW|, never re-signed
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 depth — chart honesty COMPOSED in the deepened Scene (Task 6 "chart-empty-
// over-stale pin"). The per-card specs pin AC2 STANDALONE (solar/grid/powerwall/
// wall-connector .test.ts: an empty recorder → `.ct-empty`, no fake path/bars; AC3
// no-refetch on a stable id). What no test reached is the COMPOSED render: the Scene
// embeds the SAME chart-bearing cards over the shared `.hass` (my-home.ts:894+), so
// the suite-level AC2 claim — "charts over stale/short history" in the DEEPENED
// Scene — needs its own composed pin. A recorder that returns NOTHING must yield the
// calm empty caption inside the embedded cards, never a fabricated curve anywhere,
// and the fetch must stay id-gated composed (UX-DR23 no-poll). The cards' charts
// live in their OWN shadow roots (the Scene's shadowRoot does not pierce them), so
// these queries walk into each embedded card. jsdom can't lay out — this asserts
// element/class presence, never geometry. energy-detail.json resolves all five
// power roles + the cumulative chart sources (solar_generated/grid_imported).
// ─────────────────────────────────────────────────────────────────────────────
const CARD_TAGS = ['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector'] as const;
type Card = HTMLElement & { updateComplete: Promise<boolean> };

/** A hass carrying a recorder `callWS` (charts fetch through this, never hass.states). */
function makeHassWS(s: Record<string, HassEntity>, callWS: HomeAssistant['callWS']): HomeAssistant {
  return { states: s, callWS } as unknown as HomeAssistant;
}
/** The embedded ecosystem cards inside the composed Scene. */
function embeddedCards(el: Scene): Card[] {
  return [...sr(el).querySelectorAll<HTMLElement>(CARD_TAGS.join(','))] as Card[];
}
/** querySelectorAll across every embedded card's OWN shadow root (the Scene's does not pierce). */
function queryAllDeep(el: Scene, sel: string): Element[] {
  const out: Element[] = [];
  for (const c of embeddedCards(el)) {
    const root = (c as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (root) out.push(...root.querySelectorAll(sel));
  }
  return out;
}
/** Settle the Scene AND every embedded card's one-shot history fetch + re-render. */
async function settleCharts(el: Scene): Promise<void> {
  await new Promise((r) => setTimeout(r, 0)); // let fetchCardHistory's .then run
  await el.updateComplete;
  for (const c of embeddedCards(el)) await c.updateComplete;
}

describe('AC2 depth — chart honesty holds COMPOSED in the deepened Scene (never a fabricated curve)', () => {
  test('an EMPTY recorder ⇒ calm empty charts inside the embedded cards, NO fabricated curve anywhere, Scene stays calm', async () => {
    const callWS = vi.fn().mockResolvedValue({}); // recorder returns nothing
    const el = await mount(makeHassWS(states(energyDetailFx), callWS));
    await settleCharts(el);

    // The Scene composed its cards (calm, not broken) and actually consulted the
    // recorder — the charts attempted a REAL fetch (not a skipped no-op).
    expect(cellTags(el).length, 'the deepened Scene still composes its cards').toBeGreaterThan(0);
    expect(callWS, 'the embedded charts fetched real history (not skipped)').toHaveBeenCalled();

    // …yet NOT ONE fabricated curve/bar exists across the composed Scene — an empty
    // series renders emptyChart() (no <svg class="spark">, no .bcol), never a fake
    // flat line or a row of zero-height bars (the chart analogue of "never a false
    // closed", 8.3 AC4 — re-proven at the composed depth).
    expect(queryAllDeep(el, 'svg.spark'), 'no fabricated sparkline').toHaveLength(0);
    expect(queryAllDeep(el, '.bcol'), 'no fabricated day-bars').toHaveLength(0);
    // The calm empty caption IS shown instead (an honest "no data", not a blank).
    expect(queryAllDeep(el, '.ct-empty').length, 'the calm empty caption is shown').toBeGreaterThan(0);
    // And never a NaN painted into a chart head/value under the empty path.
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('the composed history fetch is id-gated — an unrelated hass tick does NOT refire callWS (UX-DR23 no-poll)', async () => {
    const callWS = vi.fn().mockResolvedValue({});
    const el = await mount(makeHassWS(states(energyDetailFx), callWS));
    await settleCharts(el);
    const firstRound = callWS.mock.calls.length;
    expect(firstRound, 'the first render fired the one-shot fetch').toBeGreaterThan(0);

    // An unrelated tick: a FRESH hass object with the SAME states (same resolved
    // chart ids). HA replaces `hass` every tick; the id-gated fetch must NOT refire
    // on a stable resolved-id set — the chart is fetched once and cached, never
    // polled (the on-demand recorder path stays gated composed, not just per-card).
    (el as unknown as { hass: HomeAssistant }).hass = makeHassWS(states(energyDetailFx), callWS);
    await settleCharts(el);
    expect(
      callWS.mock.calls.length,
      'a stable resolved-id set must not refire the composed fetch'
    ).toBe(firstRound);
  });
});
