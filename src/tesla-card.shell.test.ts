// @vitest-environment jsdom
//
// Tabbed-panel SHELL contract (Story 5.1 — FR-13 / UX-DR11). Brownfield-hardening
// story: the shell already lives in `tesla-card.ts`; this file turns its five ACs
// into regressions. It does NOT re-prove Story 1.8's Energy-PRESENCE predicate
// (`tesla-card.stub.test.ts` owns that) — it extends coverage to the parts no test
// pins yet: default-panel selection, invalid-default fallback, the splice INDEX,
// the no-reflow guarantee, per-section hide flags, single-selection, and the
// compact-width accessible-name floor (UX-DR21).
//
// Mirrors the established element-test shape (jsdom opt-in + side-effect import +
// committed-fixture JSON) from tesla-card.lifecycle.test.ts / tesla-card.stub.test.ts.
import { describe, expect, test, beforeAll } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from './types';
import { STRINGS } from './strings';
import './tesla-card';
import awake from './fixtures/model-y-awake.json';
import allUnresolved from './fixtures/all-unresolved.json';

/**
 * Build a hass from a committed fixture. Each call carries its OWN (empty)
 * registry maps — mirroring live HA, where `hass.entities`/`hass.devices` always
 * exist and their object reference changes when the registry updates. That
 * distinct-reference is what lets the card's resolve-cache invalidate across a
 * hass swap (the no-reflow test below swaps fixtures on one card); the resolver
 * still detects everything from `states` (the registries are empty), matching the
 * states-only shape the Story-1.8 stub test exercises.
 */
function hassFrom(fixture: { states: Record<string, unknown> }): HomeAssistant {
  return {
    states: fixture.states,
    entities: {},
    devices: {},
    locale: { language: 'en' },
    callService: () => Promise.resolve(),
  } as unknown as HomeAssistant;
}

type CardEl = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  updateComplete: Promise<boolean>;
};

function makeCard(): CardEl {
  const el = document.createElement('tesla-card') as CardEl;
  document.body.appendChild(el);
  return el;
}

/** Render the card with a config + hass, return the upgraded element. */
async function renderCard(config: TeslaCardConfig, hass: HomeAssistant): Promise<CardEl> {
  const el = makeCard();
  el.setConfig(config);
  el.hass = hass;
  await el.updateComplete;
  return el;
}

const tabs = (el: CardEl): HTMLButtonElement[] =>
  Array.from(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('.tab') ?? []);

/** Ordered visible tab labels (textContent — CSS-independent; spans stay in DOM). */
const tabLabels = (el: CardEl): string[] =>
  Array.from(el.shadowRoot?.querySelectorAll('.tab span') ?? []).map(
    (s) => s.textContent?.trim() ?? ''
  );

/** The label of the single `.active` tab. */
const activeTabLabel = (el: CardEl): string | null =>
  el.shadowRoot?.querySelector('.tab.active span')?.textContent?.trim() ?? null;

/** The tag of the rendered panel component inside `.panel` (which panel is open). */
const activePanelTag = (el: CardEl): string | null =>
  el.shadowRoot?.querySelector('.panel')?.firstElementChild?.tagName.toLowerCase() ?? null;

/** Click the tab whose visible label matches, then settle. */
async function clickTab(el: CardEl, label: string): Promise<void> {
  const btn = tabs(el).find((t) => t.querySelector('span')?.textContent?.trim() === label);
  if (!btn) throw new Error(`tab "${label}" not found`);
  btn.click();
  await el.updateComplete;
}

beforeAll(() => {
  expect(customElements.get('tesla-card')).toBeTruthy();
});

describe('AC2 — default_panel opens first; default is charging', () => {
  test('no default_panel → charging opens', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(allUnresolved));
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.charging);
    expect(activePanelTag(el)).toBe('tc-panel-charging');
    el.remove();
  });

  test('default_panel: tyres → tyres opens (not charging)', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', default_panel: 'tyres' },
      hassFrom(allUnresolved)
    );
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.tyres);
    expect(activePanelTag(el)).toBe('tc-panel-tyres');
    el.remove();
  });
});

describe('AC5 — invalid default_panel falls back to the first available panel (charging)', () => {
  test('default_panel: energy with NO energy site → falls back to charging, never blank/broken', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', default_panel: 'energy' },
      hassFrom(allUnresolved) // no solar/battery/grid/wc → no Energy tab
    );
    expect(tabLabels(el)).not.toContain(STRINGS.tabs.energy); // the requested tab isn't present
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.charging); // …so it falls back, not blank
    expect(activePanelTag(el)).toBe('tc-panel-charging');
    el.remove();
  });
});

describe('AC3 — Energy tab splice-inserts at index 2, only when present', () => {
  test('energy site present → Energy tab is at index 2 (after Charging)', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(awake));
    const labels = tabLabels(el);
    expect(labels).toContain(STRINGS.tabs.energy);
    // PANELS order is climate(0), charging(1) → Energy splices at index 2.
    expect(labels.indexOf(STRINGS.tabs.energy)).toBe(2);
    expect(labels.slice(0, 3)).toEqual([
      STRINGS.tabs.climate,
      STRINGS.tabs.charging,
      STRINGS.tabs.energy,
    ]);
    el.remove();
  });

  test('no energy site → no Energy tab', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(allUnresolved));
    expect(tabLabels(el)).not.toContain(STRINGS.tabs.energy);
    el.remove();
  });

  test('energy.hide: true suppresses the Energy tab even with a site', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', energy: { hide: true } },
      hassFrom(awake)
    );
    expect(tabLabels(el)).not.toContain(STRINGS.tabs.energy);
    el.remove();
  });

  test('the Energy tab appearing mid-session does NOT reflow the user out of their panel', async () => {
    // Start with no energy site, navigate the user to Media…
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(allUnresolved));
    await clickTab(el, STRINGS.tabs.media);
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.media);
    expect(tabLabels(el)).not.toContain(STRINGS.tabs.energy);

    // …then an energy site appears (hass swap). The Energy tab inserts, but the
    // user must STAY on Media — `_panel` is the source of truth, `current` only
    // falls back when the held panel genuinely isn't visible (it still is).
    el.hass = hassFrom(awake);
    await el.updateComplete;
    expect(tabLabels(el)).toContain(STRINGS.tabs.energy); // tab now present
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.media); // …but no reflow
    expect(activePanelTag(el)).toBe('tc-panel-media');
    el.remove();
  });
});

describe('AC2 — panels / quick-actions / commands are individually hideable', () => {
  test('default (no hides): all three sections render', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(awake));
    const r = el.shadowRoot!;
    expect(r.querySelector('tc-quick-actions')).toBeTruthy();
    expect(r.querySelector('.tabs')).toBeTruthy();
    expect(r.querySelector('tc-commands')).toBeTruthy();
    el.remove();
  });

  test('hide_quick_actions removes ONLY the quick-actions block', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', hide_quick_actions: true },
      hassFrom(awake)
    );
    const r = el.shadowRoot!;
    expect(r.querySelector('tc-quick-actions')).toBeNull();
    expect(r.querySelector('.tabs')).toBeTruthy(); // others intact (no layout break)
    expect(r.querySelector('tc-commands')).toBeTruthy();
    el.remove();
  });

  test('hide_panels removes ONLY the tab bar + panel region', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', hide_panels: true },
      hassFrom(awake)
    );
    const r = el.shadowRoot!;
    expect(r.querySelector('.tabs')).toBeNull();
    expect(r.querySelector('.panel')).toBeNull();
    expect(r.querySelector('tc-quick-actions')).toBeTruthy();
    expect(r.querySelector('tc-commands')).toBeTruthy();
    el.remove();
  });

  test('hide_commands removes ONLY the commands block', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', hide_commands: true },
      hassFrom(awake)
    );
    const r = el.shadowRoot!;
    expect(r.querySelector('tc-commands')).toBeNull();
    expect(r.querySelector('tc-quick-actions')).toBeTruthy();
    expect(r.querySelector('.tabs')).toBeTruthy();
    el.remove();
  });
});

describe('AC1 / UX-DR21 — single active selection + tablist semantics', () => {
  test('exactly one tab is aria-selected, inside a role="tablist", each a role="tab"', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(awake));
    expect(el.shadowRoot!.querySelector('[role="tablist"]')).toBeTruthy();
    const all = tabs(el);
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) expect(t.getAttribute('role')).toBe('tab');
    const selected = all.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1); // one active at a time
    expect(el.shadowRoot!.querySelectorAll('.tab.active').length).toBe(1);
    el.remove();
  });

  test('clicking a tab moves selection (still exactly one selected)', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(awake));
    await clickTab(el, STRINGS.tabs.location);
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.location);
    const selected = tabs(el).filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    el.remove();
  });
});

describe('AC4 / UX-DR21 — compact-width accessible-name floor (no nameless tabs)', () => {
  test('EVERY tab exposes a non-empty accessible name, even when its label is visually hidden', async () => {
    // At ≤540px the non-active tabs are icon-only (`.tab span { display:none }`),
    // and the icon is aria-hidden — so the button must carry its own accessible
    // name (aria-label) or it is a nameless control. Asserted on ALL tabs, not
    // just the active one (the active label is always visible; the trap is the rest).
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(awake));
    const names = tabs(el).map((t) => t.getAttribute('aria-label')?.trim() ?? '');
    expect(names.length).toBe(tabLabels(el).length);
    for (const n of names) expect(n.length).toBeGreaterThan(0);
    // …and the accessible name matches the tab's own copy (from STRINGS.tabs.*).
    expect(names).toEqual(tabLabels(el));
    el.remove();
  });

  // QA gap-close: the responsive contract (AC4) is a CSS @media toggle that jsdom
  // can't evaluate — but it only WORKS if every tab carries BOTH an inline icon
  // AND a `<span>` label in the DOM at all times (the CSS hides/shows the span by
  // width; it never adds/removes it). Lock that structural precondition so a
  // refactor that drops the span (breaking the ≥760 full-label state) or the icon
  // (breaking the ≤540 icon-only state) fails here, not silently in a browser.
  test('every tab carries BOTH an inline icon and a label span in the DOM (the responsive toggle precondition)', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(awake));
    const all = tabs(el);
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) {
      expect(t.querySelector('.tc-ico')).toBeTruthy(); // icon for the ≤540 icon-only state
      const span = t.querySelector('span');
      expect(span).toBeTruthy(); // label span for the ≥760 full-label state
      expect(span!.textContent?.trim().length).toBeGreaterThan(0);
    }
    el.remove();
  });
});

describe('AC1 — one card switching content (a single panel region that swaps)', () => {
  // Existing tests assert WHICH panel renders on first paint; none assert the
  // "one card switching content" promise — that selecting a tab REPLACES the
  // rendered panel (only ever one panel component mounted) rather than stacking.
  test('exactly one panel component is mounted, and clicking a tab swaps it', async () => {
    const el = await renderCard({ type: 'custom:tesla-card' }, hassFrom(awake));
    const panel = el.shadowRoot!.querySelector('.panel')!;
    expect(panel.childElementCount).toBe(1); // one card switching content, not a stack
    expect(activePanelTag(el)).toBe('tc-panel-charging');

    await clickTab(el, STRINGS.tabs.tyres);
    expect(panel.childElementCount).toBe(1); // still exactly one — swapped, not added
    expect(activePanelTag(el)).toBe('tc-panel-tyres');
    expect(el.shadowRoot!.querySelector('tc-panel-charging')).toBeNull(); // prior panel gone

    await clickTab(el, STRINGS.tabs.location);
    expect(activePanelTag(el)).toBe('tc-panel-location');
    expect(el.shadowRoot!.querySelectorAll('.panel > *').length).toBe(1);
    el.remove();
  });
});

describe('AC2 — default_panel naming a conditionally-present panel opens it when present', () => {
  // The fallback test proves default_panel:energy with NO site → charging. Its
  // mirror (the positive path) was unlocked: default_panel:energy WITH a site must
  // actually OPEN energy — proving the seed is honoured for a panel that only
  // exists because detection added it (not just for the always-present base set).
  test('default_panel: energy with an energy site → Energy opens first', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', default_panel: 'energy' },
      hassFrom(awake) // solar/battery/grid/wc present → Energy tab exists
    );
    expect(tabLabels(el)).toContain(STRINGS.tabs.energy);
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.energy);
    expect(activePanelTag(el)).toBe('tc-panel-energy');
    el.remove();
  });
});

describe('AC3 / AC5 — fallback only when the held panel genuinely leaves the visible set', () => {
  // Complements the no-reflow test (held panel STAYS visible → no reflow). This is
  // the OTHER branch of `current`: when the held panel truly disappears, the card
  // must fall back — never render a blank/broken tab. User sits on Energy, then the
  // site vanishes mid-session → Energy tab gone → falls back to charging.
  test('viewing Energy when the site disappears mid-session → falls back to charging', async () => {
    const el = await renderCard(
      { type: 'custom:tesla-card', default_panel: 'energy' },
      hassFrom(awake)
    );
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.energy); // start on Energy

    // The energy site vanishes (hass swap to a no-site fixture).
    el.hass = hassFrom(allUnresolved);
    await el.updateComplete;
    expect(tabLabels(el)).not.toContain(STRINGS.tabs.energy); // tab genuinely gone
    expect(activeTabLabel(el)).toBe(STRINGS.tabs.charging); // …so it falls back, not blank
    expect(activePanelTag(el)).toBe('tc-panel-charging');
    el.remove();
  });
});
