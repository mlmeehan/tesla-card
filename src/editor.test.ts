// @vitest-environment jsdom
//
// GUI editor element tests (Story 7.2, AC1–AC4 — FR-27).
//
// The visual editor (`tesla-card-editor`) edits the four common-option groups —
// name, image, default panel, the three hide toggles — and is lazy-loaded via
// `TeslaCard.getConfigElement` (NFR-1). This suite pins:
//   • AC1: all four field groups render + reflect config; lazy-load wiring works.
//   • AC2: the editor element tolerates partial/absent `hass` (it reads no state;
//     the *card* preview-pane safety lives in `tesla-card.lifecycle.test.ts`).
//   • AC3: the per-entity-override boundary is documented in the UI (YAML-only).
//   • AC4: an edit emits a valid `TeslaCardConfig` the card consumes — including
//     the clear-to-remove path (the merge bug fixed in this story) and the
//     forward-compat round-trip (editing one field never drops an unknown key).
// Hermetic: jsdom element, no network, no real `hass`.
import { describe, expect, test, beforeAll } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from './types';
import './editor';
import { TeslaCard } from './tesla-card';
import { STRINGS } from './strings';

type EditorEl = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  updateComplete: Promise<boolean>;
  _config?: Record<string, unknown>;
};

function makeEditor(): EditorEl {
  const el = document.createElement('tesla-card-editor') as unknown as EditorEl;
  document.body.appendChild(el as unknown as HTMLElement);
  return el;
}

/** Listen for the next `config-changed` and capture its detail config. */
function captureEmit(el: EditorEl): { get(): Record<string, unknown> | undefined } {
  let emitted: Record<string, unknown> | undefined;
  el.addEventListener('config-changed', (e: Event) => {
    emitted = (e as CustomEvent<{ config: Record<string, unknown> }>).detail.config;
  });
  return { get: () => emitted };
}

const $ = (el: EditorEl, sel: string) => el.shadowRoot?.querySelector(sel);

beforeAll(() => {
  expect(customElements.get('tesla-card-editor')).toBeTruthy();
});

describe('AC1 — editor renders + reflects all four field groups', () => {
  test('name/image inputs, default-panel select, and three hide checkboxes reflect config', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      name: 'Y',
      image: 'x.png',
      default_panel: 'climate',
      hide_panels: true,
    } as TeslaCardConfig);
    await el.updateComplete;

    const texts = el.shadowRoot?.querySelectorAll('input[type="text"]');
    expect(texts && texts.length).toBe(2);
    expect((texts![0] as HTMLInputElement).value).toBe('Y'); // name
    expect((texts![1] as HTMLInputElement).value).toBe('x.png'); // image

    const select = $(el, 'select') as HTMLSelectElement;
    expect(select.value).toBe('climate');

    // The three top-level hide toggles render OUTSIDE the Scene-nodes `.group`
    // (which adds six per-node show toggles, Story 9.4) — scope to them.
    const checks = Array.from(
      el.shadowRoot!.querySelectorAll('input[type="checkbox"]')
    ).filter((c) => !(c as HTMLElement).closest('.group')) as HTMLInputElement[];
    expect(checks.length).toBe(3); // quick_actions, panels, commands
    // hide_panels is the 2nd checkbox in render order; only it is true.
    expect(checks[0].checked).toBe(false); // hide_quick_actions
    expect(checks[1].checked).toBe(true); // hide_panels
    expect(checks[2].checked).toBe(false); // hide_commands
    el.remove();
  });

  test('a stub-only config ({ type }) renders without error (all optional fields absent)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    expect($(el, 'input[type="text"]')).toBeTruthy();
    expect(($(el, 'input[type="text"]') as HTMLInputElement).value).toBe('');
    el.remove();
  });
});

describe('AC1 — lazy-load via getConfigElement', () => {
  test('getConfigElement is a function resolving to a tesla-card-editor element', async () => {
    expect(typeof TeslaCard.getConfigElement).toBe('function');
    const result = TeslaCard.getConfigElement();
    expect(result).toBeInstanceOf(Promise);
    const el = await result;
    expect(el).toBeInstanceOf(HTMLElement);
    expect((el as HTMLElement).tagName.toLowerCase()).toBe('tesla-card-editor');
  });
});

describe('AC4 — an edit emits a valid TeslaCardConfig', () => {
  test('editing name emits config-changed with the new value + preserved type', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const input = $(el, 'input[type="text"]') as HTMLInputElement;
    input.value = 'Garage Y';
    input.dispatchEvent(new Event('change'));

    expect(cap.get()).toBeDefined();
    expect(cap.get()?.name).toBe('Garage Y');
    expect(cap.get()?.type).toBe('custom:tesla-card');
    el.remove();
  });

  test('selecting a default panel emits the snake_case key', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const select = $(el, 'select') as HTMLSelectElement;
    select.value = 'media';
    select.dispatchEvent(new Event('change'));

    expect(cap.get()?.default_panel).toBe('media');
    expect(cap.get()?.type).toBe('custom:tesla-card');
    el.remove();
  });

  test('toggling a hide checkbox emits the boolean', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const checks = el.shadowRoot?.querySelectorAll(
      'input[type="checkbox"]'
    ) as NodeListOf<HTMLInputElement>;
    checks[1].checked = true; // hide_panels
    checks[1].dispatchEvent(new Event('change'));

    expect(cap.get()?.hide_panels).toBe(true);
    el.remove();
  });

  test('clear-to-remove: clearing a previously-set name REMOVES the key from the emitted config', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', name: 'Foo' } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const input = $(el, 'input[type="text"]') as HTMLInputElement;
    input.value = ''; // user clears the field to fall back to the built-in default
    input.dispatchEvent(new Event('change'));

    const emitted = cap.get();
    expect(emitted).toBeDefined();
    expect('name' in emitted!).toBe(false); // key GONE, not stuck at the stale value
    expect(emitted?.type).toBe('custom:tesla-card'); // unrelated key preserved
    el.remove();
  });

  test('add/override paths still work after the clear fix (set name, then change it)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', name: 'Foo' } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const input = $(el, 'input[type="text"]') as HTMLInputElement;
    input.value = 'Bar';
    input.dispatchEvent(new Event('change'));
    expect(cap.get()?.name).toBe('Bar'); // override still propagates
    el.remove();
  });
});

describe('AC4 / R9 — forward-compat round-trip (editing one field never drops an unknown key)', () => {
  test('editing name preserves an unknown future key', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      name: 'Y',
      some_future_key: 42,
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const input = $(el, 'input[type="text"]') as HTMLInputElement;
    input.value = 'Renamed';
    input.dispatchEvent(new Event('change'));

    expect(cap.get()?.name).toBe('Renamed');
    expect(cap.get()?.some_future_key).toBe(42); // unknown key survives the edit
    el.remove();
  });

  test('clearing name preserves an unknown future key (clear path is also forward-compat)', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      name: 'Y',
      some_future_key: 42,
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const input = $(el, 'input[type="text"]') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change'));

    const emitted = cap.get();
    expect('name' in emitted!).toBe(false); // cleared key removed...
    expect(emitted?.some_future_key).toBe(42); // ...without dropping the unknown key
    el.remove();
  });
});

describe('AC2 — editor element tolerates partial/absent hass', () => {
  test('hass = undefined: setConfig + render does not throw, form still renders', async () => {
    const el = makeEditor();
    el.hass = undefined;
    expect(() => el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig)).not.toThrow();
    await expect(el.updateComplete).resolves.toBeDefined();
    expect($(el, 'input[type="text"]')).toBeTruthy(); // form rendered despite no hass
    el.remove();
  });

  test('hass = {} (partial): renders fine — the editor reads no vehicle state', async () => {
    const el = makeEditor();
    el.hass = {} as HomeAssistant;
    el.setConfig({ type: 'custom:tesla-card', name: 'Y' } as TeslaCardConfig);
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(($(el, 'input[type="text"]') as HTMLInputElement).value).toBe('Y');
    el.remove();
  });
});

describe('AC3 — per-entity-override boundary documented in the UI (YAML-only)', () => {
  test('the note references the `entities:` YAML map', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const note = $(el, '.note');
    expect(note).toBeTruthy();
    const text = note!.textContent ?? '';
    expect(text).toContain(STRINGS.editor.noteBefore);
    expect(text).toContain('entities:');
    expect(text).toContain(STRINGS.editor.noteAfter);
    el.remove();
  });
});

// ── QA-added coverage (qa-generate-e2e-tests, Story 7.2) ───────────────────────
// The above pins each AC in isolation; these close the gaps a reviewer would flag:
//   • AC4 LITERAL: the emitted config is consumed by a REAL `tesla-card` without
//     throwing (the existing AC4 tests assert the emitted SHAPE, never feed it back
//     into the card — which is the actual AC wording).
//   • the `image` text field shares the keyed `_text` path with `name` but was
//     untested — pin its edit + clear-to-remove so a per-key regression can't hide.
//   • the panel `<select>` must present the full `PanelId` union, not just reflect.
//   • whitespace-only input must trim to a removal (the `.trim()` branch).
//   • the `config-changed` event must bubble + compose (HA's wiring contract).
//   • un-toggling a hide checkbox emits an explicit `false` (carried, not dropped).

describe('AC4 — a real tesla-card consumes the editor-emitted config without error', () => {
  test('an editor edit produces a config the live card accepts via setConfig', async () => {
    const ed = makeEditor();
    ed.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await ed.updateComplete;
    const cap = captureEmit(ed);

    // Drive the editor the way a user would: set a name, pick a default panel.
    const input = $(ed, 'input[type="text"]') as HTMLInputElement;
    input.value = 'Garage Y';
    input.dispatchEvent(new Event('change'));
    const select = $(ed, 'select') as HTMLSelectElement;
    select.value = 'media';
    select.dispatchEvent(new Event('change'));

    const emitted = cap.get() as unknown as TeslaCardConfig;
    expect(emitted).toBeDefined();

    // Feed the editor's output straight into a live card — exactly what HA does on
    // every `config-changed`. AC4: it must consume it without throwing.
    const card = document.createElement('tesla-card') as unknown as {
      setConfig(c: TeslaCardConfig): void;
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(card as unknown as HTMLElement);
    expect(() => card.setConfig(emitted)).not.toThrow();
    await expect(card.updateComplete).resolves.toBeDefined();
    (card as unknown as HTMLElement).remove();
    ed.remove();
  });

  test('a cleared-field config (name removed) is still consumed by the card', async () => {
    const ed = makeEditor();
    ed.setConfig({ type: 'custom:tesla-card', name: 'Foo' } as TeslaCardConfig);
    await ed.updateComplete;
    const cap = captureEmit(ed);

    const input = $(ed, 'input[type="text"]') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change'));
    const emitted = cap.get() as unknown as TeslaCardConfig;
    expect('name' in (emitted as object)).toBe(false);

    const card = document.createElement('tesla-card') as unknown as {
      setConfig(c: TeslaCardConfig): void;
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(card as unknown as HTMLElement);
    expect(() => card.setConfig(emitted)).not.toThrow();
    await expect(card.updateComplete).resolves.toBeDefined();
    (card as unknown as HTMLElement).remove();
    ed.remove();
  });
});

describe('AC1/AC4 — the image text field mirrors name (edit + clear-to-remove)', () => {
  test('editing image emits the new value; clearing removes the key', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', image: '/local/y.png' } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // image is the 2nd text input (name is the 1st).
    const img = el.shadowRoot?.querySelectorAll(
      'input[type="text"]'
    )[1] as HTMLInputElement;
    img.value = '/local/z.png';
    img.dispatchEvent(new Event('change'));
    expect(cap.get()?.image).toBe('/local/z.png');
    expect(cap.get()?.type).toBe('custom:tesla-card');

    img.value = '';
    img.dispatchEvent(new Event('change'));
    expect('image' in (cap.get() as object)).toBe(false); // keyed clear works for image too
    el.remove();
  });
});

describe('AC1 — the default-panel select presents the full panel union', () => {
  test('all six vehicle panels are selectable options, in render order', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    // Scope to the panel select — the Story 9.15 per-node row selects (`.row-select`)
    // also carry <option>s, so the broad `select option` query would catch them too.
    const options = el.shadowRoot?.querySelectorAll(
      'select:not(.row-select) option'
    ) as NodeListOf<HTMLOptionElement>;
    const values = Array.from(options).map((o) => o.value);
    expect(values).toEqual(['climate', 'charging', 'closures', 'tyres', 'location', 'media']);
    el.remove();
  });
});

describe('AC4 — text-field hygiene + event wiring contract', () => {
  test('a whitespace-only value trims to empty and REMOVES the key', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', name: 'Foo' } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const input = $(el, 'input[type="text"]') as HTMLInputElement;
    input.value = '   '; // only whitespace — `.trim()` → '' → treated as a clear
    input.dispatchEvent(new Event('change'));
    expect('name' in (cap.get() as object)).toBe(false);
    el.remove();
  });

  test('config-changed bubbles AND is composed (crosses the shadow boundary for HA)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    let evt: Event | undefined;
    el.addEventListener('config-changed', (e) => (evt = e));

    const input = $(el, 'input[type="text"]') as HTMLInputElement;
    input.value = 'Named';
    input.dispatchEvent(new Event('change'));

    expect(evt).toBeDefined();
    expect(evt!.bubbles).toBe(true);
    expect(evt!.composed).toBe(true);
    el.remove();
  });

  test('un-toggling a hide checkbox emits an explicit false (carried, not dropped)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', hide_commands: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const checks = el.shadowRoot?.querySelectorAll(
      'input[type="checkbox"]'
    ) as NodeListOf<HTMLInputElement>;
    checks[2].checked = false; // hide_commands → off
    checks[2].dispatchEvent(new Event('change'));
    expect(cap.get()?.hide_commands).toBe(false);
    el.remove();
  });
});

// ── Story 9.4 — node hide/reorder GUI controls ─────────────────────────────────
// The editor surfaces the Story 9.1 `energy.nodes.{hide,order,rows}` keys via the same
// toggle family as the three hide switches above. These pin the read/write config
// contract: reflect, write, prune-to-zero-diff, and forward-compat round-trip.
// The seven Scene nodes incl. `vehicle` + `generator` (registry `ROLES`). Since the
// holistic editor re-review the controls render ROW-GROUPED (Sources then Loads) to
// mirror the card's two-row Scene — so look node controls up BY ROLE, not flat index.
const ROLES = ['vehicle', 'solar', 'powerwall', 'grid', 'home', 'wall_connector', 'generator'] as const;
// Display label per role (mirrors the editor's NODE_LABELS, which is not exported).
const ROLE_LABEL: Record<string, string> = {
  vehicle: STRINGS.editor.nodeVehicle,
  solar: STRINGS.energy.nodes.solar,
  powerwall: STRINGS.energy.nodes.powerwall,
  grid: STRINGS.energy.nodes.grid,
  home: STRINGS.energy.nodes.home,
  wall_connector: STRINGS.energy.nodes.wall_connector,
  generator: STRINGS.energy.nodes.generator,
};

/** The seven per-node show checkboxes (inside the Scene-nodes `.group`), in DOM order. */
function nodeChecks(el: EditorEl): HTMLInputElement[] {
  return Array.from(
    el.shadowRoot!.querySelectorAll('.group input[type="checkbox"]')
  ) as HTMLInputElement[];
}
/** The displayed node order (row-grouped: sources then loads), read off the row labels. */
function orderLabels(el: EditorEl): string[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.node-row .node-name')).map(
    (n) => n.textContent?.trim() ?? ''
  );
}
/** The `.node-row` element for a given role (row-order-independent lookup by label). */
function nodeRowFor(el: EditorEl, role: string): Element {
  const label = ROLE_LABEL[role];
  return Array.from(el.shadowRoot!.querySelectorAll('.node-row')).find(
    (r) => r.querySelector('.node-name')?.textContent?.trim() === label
  )!;
}
/** The show/hide checkbox for `role` (label-based — survives row regrouping). */
function checkFor(el: EditorEl, role: string): HTMLInputElement {
  return nodeRowFor(el, role).querySelector('input[type="checkbox"]') as HTMLInputElement;
}
/** The move-up / move-down buttons for the node at display row `i`. */
function moveButtons(el: EditorEl, i: number): { up: HTMLButtonElement; down: HTMLButtonElement } {
  const rows = el.shadowRoot!.querySelectorAll('.node-row');
  const btns = rows[i].querySelectorAll('button.move');
  return { up: btns[0] as HTMLButtonElement, down: btns[1] as HTMLButtonElement };
}
/** The move-up / move-down buttons for `role` (label-based). */
function moveButtonsFor(
  el: EditorEl,
  role: string
): { up: HTMLButtonElement; down: HTMLButtonElement } {
  const btns = nodeRowFor(el, role).querySelectorAll('button.move');
  return { up: btns[0] as HTMLButtonElement, down: btns[1] as HTMLButtonElement };
}

type EnergyShape = { nodes?: { hide?: string[]; order?: string[]; instances?: unknown } };

describe('Story 9.4 AC1/AC2 — seven per-node show toggles render + reflect', () => {
  test('all seven ROLES render a show checkbox, checked by default (nothing hidden)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const checks = nodeChecks(el);
    expect(checks.length).toBe(7); // Story 9.14 — the generator joins the node list for free
    expect(checks.every((c) => c.checked)).toBe(true); // show = visible by default
    el.remove();
  });

  test('energy.nodes.hide:[solar] renders the Solar toggle unchecked (show=false)', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { hide: ['solar'] } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    expect(checkFor(el, 'solar').checked).toBe(false); // hidden → show unchecked
    expect(checkFor(el, 'home').checked).toBe(true); // others still shown
    el.remove();
  });
});

describe('Story 9.4 AC1/AC3 — hide toggle writes energy.nodes.hide + prunes to zero-diff', () => {
  test('hiding a node writes energy.nodes.hide; showing it again DELETES the key (and energy)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // Uncheck "Home" → hide it.
    const home = checkFor(el, 'home');
    home.checked = false;
    home.dispatchEvent(new Event('change'));
    let emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    expect(emitted.energy?.nodes?.hide).toEqual(['home']);

    // Re-render with the emitted config, then re-check "Home" → un-hide it.
    el.setConfig(emitted);
    await el.updateComplete;
    const home2 = checkFor(el, 'home');
    home2.checked = true;
    home2.dispatchEvent(new Event('change'));
    emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    // Zero-diff default: no empty hide, no empty nodes, no empty energy.
    expect('energy' in emitted).toBe(false);
    el.remove();
  });

  test('hide list is built in canonical ROLES order regardless of click order', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // Hide grid first, then solar.
    const grid = checkFor(el, 'grid');
    grid.checked = false;
    grid.dispatchEvent(new Event('change'));
    el.setConfig(cap.get() as unknown as TeslaCardConfig);
    await el.updateComplete;
    const solar = checkFor(el, 'solar');
    solar.checked = false;
    solar.dispatchEvent(new Event('change'));

    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    // solar precedes grid in ROLES → canonical order, not click order.
    expect(emitted.energy?.nodes?.hide).toEqual(['solar', 'grid']);
    el.remove();
  });

  test('a node toggle preserves a sibling energy key (entities) and other nodes sub-keys', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { hide: true, nodes: { instances: { solar: 2 } } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const solar = checkFor(el, 'solar');
    solar.checked = false; // hide solar
    solar.dispatchEvent(new Event('change'));

    const emitted = cap.get() as unknown as TeslaCardConfig & {
      energy?: EnergyShape & { hide?: boolean };
    };
    expect(emitted.energy?.hide).toBe(true); // sibling energy key kept
    expect(emitted.energy?.nodes?.instances).toEqual({ solar: 2 }); // out-of-scope key kept
    expect(emitted.energy?.nodes?.hide).toEqual(['solar']);
    el.remove();
  });
});

describe('Story 9.4 AC1/AC4 — order control writes energy.nodes.order + prunes canonical', () => {
  test('default display order is the row-grouped canonical order (sources then loads)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    // Sources [solar, powerwall, grid, generator] then loads [home, wall_connector, vehicle].
    expect(orderLabels(el)).toEqual([
      STRINGS.energy.nodes.solar,
      STRINGS.energy.nodes.powerwall,
      STRINGS.energy.nodes.grid,
      STRINGS.energy.nodes.generator,
      STRINGS.energy.nodes.home,
      STRINGS.energy.nodes.wall_connector,
      STRINGS.editor.nodeVehicle,
    ]);
    el.remove();
  });

  test('move-down on the first source emits the full row-grouped order with the within-row swap', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    moveButtonsFor(el, 'solar').down.click(); // solar ↓ → swaps with powerwall (within the source row)
    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    // Emitted order is the full row-grouped sequence: sources (swapped) ++ loads (canonical).
    expect(emitted.energy?.nodes?.order).toEqual([
      'powerwall',
      'solar',
      'grid',
      'generator',
      'home',
      'wall_connector',
      'vehicle',
    ]);
    el.remove();
  });

  test('restoring canonical within-row order DELETES energy.nodes.order (zero-diff)', async () => {
    const el = makeEditor();
    // A single within-source swap from canonical (powerwall before solar).
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { order: ['powerwall', 'solar', 'grid', 'generator', 'home', 'wall_connector', 'vehicle'] } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // powerwall leads the source row; move it down → swaps back with solar → canonical.
    moveButtonsFor(el, 'powerwall').down.click();
    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    expect('energy' in emitted).toBe(false); // canonical order → key + energy pruned
    el.remove();
  });

  test('partial order reflects WITHIN the node’s row (listed ++ canonical remainder)', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { order: ['home'] } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    // `home` is a LOAD, so it leads the LOAD row; the source row is untouched canonical.
    expect(orderLabels(el)).toEqual([
      STRINGS.energy.nodes.solar,
      STRINGS.energy.nodes.powerwall,
      STRINGS.energy.nodes.grid,
      STRINGS.energy.nodes.generator,
      STRINGS.energy.nodes.home,
      STRINGS.energy.nodes.wall_connector,
      STRINGS.editor.nodeVehicle,
    ]);
    el.remove();
  });

  test('move gating is per ROW edge — never crosses the source/load boundary', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    // First source (solar): up disabled; last source (generator): down disabled — so a
    // move can't push a source into the load row (that is the row selector's job).
    expect(moveButtonsFor(el, 'solar').up.disabled).toBe(true);
    expect(moveButtonsFor(el, 'solar').down.disabled).toBe(false);
    expect(moveButtonsFor(el, 'generator').down.disabled).toBe(true);
    expect(moveButtonsFor(el, 'generator').up.disabled).toBe(false);
    // First load (home): up disabled; last load (vehicle): down disabled.
    expect(moveButtonsFor(el, 'home').up.disabled).toBe(true);
    expect(moveButtonsFor(el, 'vehicle').down.disabled).toBe(true);
    el.remove();
  });
});

describe('Story 9.4 AC3 — forward-compat: a node edit never drops an unknown top-level key', () => {
  test('toggling a node hidden preserves an unknown future key', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      some_future_key: 42,
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const grid = checkFor(el, 'grid');
    grid.checked = false;
    grid.dispatchEvent(new Event('change'));

    const emitted = cap.get() as unknown as TeslaCardConfig & {
      energy?: EnergyShape;
      some_future_key?: number;
    };
    expect(emitted.some_future_key).toBe(42); // unknown key survives
    expect(emitted.energy?.nodes?.hide).toEqual(['grid']);
    el.remove();
  });

  test('un-hiding the last node preserves an unknown energy.nodes sub-key (sub-key forward-compat)', async () => {
    const el = makeEditor();
    // Only `hide:[solar]` + an unknown future `nodes` sub-key. Un-hiding solar
    // empties `hide`; the unknown sub-key must keep `nodes`/`energy` alive rather
    // than being dropped by an enumerated prune.
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { hide: ['solar'], future_node_key: 7 } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const solar = checkFor(el, 'solar');
    solar.checked = true; // show solar → hide becomes []
    solar.dispatchEvent(new Event('change'));

    const emitted = cap.get() as unknown as TeslaCardConfig & {
      energy?: EnergyShape & { future_node_key?: unknown };
    };
    expect(emitted.energy?.nodes?.hide).toBeUndefined(); // emptied hide pruned...
    expect((emitted.energy?.nodes as { future_node_key?: number })?.future_node_key).toBe(7); // ...unknown sub-key kept
    el.remove();
  });
});

// ── QA-added coverage (qa-generate-e2e-tests, Story 9.4) ───────────────────────
// The cases above pin move-DOWN, the disabled edges, reflect, prune, and forward-
// compat. These close the gaps a reviewer would flag:
//   • move-UP (`_moveNode(role, -1)`) is never driven through an ENABLED button —
//     only `up.disabled` is asserted, so half the order control's swap logic and
//     its canonical-restore prune are untested.
//   • `orderedRoles` SANITIZES the displayed order (dedup + drop unknown), the
//     Story 9.3 stable-partition mirror named in AC1 — both branches untested.
//   • the editor writes INTENT, not precedence (Dev Notes): a node may live in
//     BOTH `hide` and `order` at once — the editor must not strip one for the other.
//   • the prune is exercised on a single node; a full six-node hide→show sweep
//     proves the maximal `hide` list still prunes back to a byte-identical default.

describe('Story 9.4 AC1/AC4 — move-UP swaps with the previous node in-row (the dir:-1 path)', () => {
  test('move-up on a mid-row source emits the full row-grouped order with that pair swapped', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // powerwall is 2nd in the source row [solar, powerwall, grid, generator]; up → swaps with solar.
    moveButtonsFor(el, 'powerwall').up.click();
    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    expect(emitted.energy?.nodes?.order).toEqual([
      'powerwall',
      'solar',
      'grid',
      'generator',
      'home',
      'wall_connector',
      'vehicle',
    ]);
    el.remove();
  });

  test('move-up restoring canonical order DELETES energy.nodes.order (zero-diff, parity with move-down)', async () => {
    const el = makeEditor();
    // powerwall ahead of solar in the source row — one within-row swap from canonical.
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { order: ['powerwall', 'solar', 'grid', 'generator', 'home', 'wall_connector', 'vehicle'] } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // solar is 2nd in the source row; move it UP → swaps back with powerwall → canonical.
    moveButtonsFor(el, 'solar').up.click();
    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    expect('energy' in emitted).toBe(false); // canonical → order + energy pruned
    el.remove();
  });
});

describe('Story 9.4 AC1 — orderedRoles sanitizes the displayed order (Story 9.3 mirror)', () => {
  test('duplicate + unknown entries in energy.nodes.order are de-duped/dropped in the displayed list', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      // home twice (dedup to one), a bogus role (dropped), then solar.
      energy: { nodes: { order: ['home', 'home', 'bogus_role', 'solar'] } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    // Sanitized + row-grouped: solar leads the source row (rest canonical); home leads the
    // load row (rest canonical). The duplicate `home` dedups and `bogus_role` drops.
    expect(orderLabels(el)).toEqual([
      STRINGS.energy.nodes.solar,
      STRINGS.energy.nodes.powerwall,
      STRINGS.energy.nodes.grid,
      STRINGS.energy.nodes.generator,
      STRINGS.energy.nodes.home,
      STRINGS.energy.nodes.wall_connector,
      STRINGS.editor.nodeVehicle,
    ]);
    expect(orderLabels(el).length).toBe(7); // never fewer/more than the seven nodes
    el.remove();
  });
});

describe('Story 9.4 — the editor writes intent, not precedence (Dev Notes)', () => {
  test('a node can live in BOTH hide and order at once (the editor never strips one for the other)', async () => {
    const el = makeEditor();
    // A non-canonical order is present so it survives the prune.
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { order: ['home', 'vehicle', 'solar', 'powerwall', 'grid', 'wall_connector'] } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // Hide "home" — which is also first in the custom order.
    const home = checkFor(el, 'home');
    home.checked = false;
    home.dispatchEvent(new Event('change'));

    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape };
    expect(emitted.energy?.nodes?.hide).toEqual(['home']); // intent written...
    // ...and the order is untouched — home stays in it (precedence is downstream).
    expect(emitted.energy?.nodes?.order).toEqual([
      'home',
      'vehicle',
      'solar',
      'powerwall',
      'grid',
      'wall_connector',
    ]);
    el.remove();
  });
});

describe('Story 9.4 AC3 — full hide→show sweep prunes back to a byte-identical default', () => {
  test('hiding all seven nodes then showing all seven leaves no energy key (zero-diff)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // Hide every node, re-setConfig between toggles so each edit builds on the last.
    for (const role of ROLES) {
      const check = checkFor(el, role);
      check.checked = false;
      check.dispatchEvent(new Event('change'));
      el.setConfig(cap.get() as unknown as TeslaCardConfig);
      await el.updateComplete;
    }
    // The maximal hide list is the full canonical ROLES order.
    expect(
      (cap.get() as unknown as TeslaCardConfig & { energy?: EnergyShape }).energy?.nodes?.hide
    ).toEqual([...ROLES]);

    // Now show every node again.
    for (const role of ROLES) {
      const check = checkFor(el, role);
      check.checked = true;
      check.dispatchEvent(new Event('change'));
      el.setConfig(cap.get() as unknown as TeslaCardConfig);
      await el.updateComplete;
    }
    // Fully un-hidden ⇒ no empty hide/nodes/energy survives (SM-C4 zero-diff).
    expect('energy' in (cap.get() as object)).toBe(false);
    el.remove();
  });
});

describe('Story 9.4 AC5 — controls are accessible + state-free (AR-1)', () => {
  test('move buttons are real <button>s with aria-labels and an inline svg icon', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const { up, down } = moveButtons(el, 1);
    expect(up.tagName.toLowerCase()).toBe('button');
    expect(up.getAttribute('aria-label')).toContain(STRINGS.editor.moveNodeUp);
    expect(down.getAttribute('aria-label')).toContain(STRINGS.editor.moveNodeDown);
    expect(up.querySelector('svg path')).toBeTruthy(); // mdi path, no raster
    el.remove();
  });

  test('renders with hass absent/partial — the node controls read no hass.states (AR-1)', async () => {
    const el = makeEditor();
    el.hass = undefined;
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { hide: ['solar'], order: ['home'] } },
    } as unknown as TeslaCardConfig);
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(nodeChecks(el).length).toBe(7); // toggles rendered without any hass
    expect(orderLabels(el).length).toBe(7);
    el.remove();
  });
});

// ── Holistic editor re-review (2026-06-22) — FR-24 crash guards + promotion-aware order ──
// The card tolerates a garbage `energy.nodes.{hide,order}` (Array.isArray guards in
// `_hiddenRoles`/`_orderList`); these pin that the EDITOR no longer crashes on a config
// the card renders fine, never persists a corrupted sibling, and reorders within the
// EFFECTIVE (promoted) row.
describe('editor re-review — FR-24: garbage hide/order never throws on open (P1/P2)', () => {
  test('a non-array energy.nodes.order does NOT throw render; the list degrades to canonical', async () => {
    const el = makeEditor();
    expect(() =>
      el.setConfig({
        type: 'custom:tesla-card',
        energy: { nodes: { order: 42 } },
      } as unknown as TeslaCardConfig)
    ).not.toThrow();
    await el.updateComplete;
    // All seven node-rows render, in canonical row-grouped order (garbage order ignored).
    expect(orderLabels(el)).toEqual([
      STRINGS.energy.nodes.solar,
      STRINGS.energy.nodes.powerwall,
      STRINGS.energy.nodes.grid,
      STRINGS.energy.nodes.generator,
      STRINGS.energy.nodes.home,
      STRINGS.energy.nodes.wall_connector,
      STRINGS.editor.nodeVehicle,
    ]);
    el.remove();
  });

  test('a non-array energy.nodes.hide does NOT throw and hides nothing', async () => {
    const el = makeEditor();
    expect(() =>
      el.setConfig({
        type: 'custom:tesla-card',
        energy: { nodes: { hide: true } },
      } as unknown as TeslaCardConfig)
    ).not.toThrow();
    await el.updateComplete;
    expect(nodeChecks(el).length).toBe(7);
    expect(nodeChecks(el).every((c) => c.checked)).toBe(true); // nothing falsely hidden
    el.remove();
  });

  test('a STRING hide does not substring-hide a node (no `.includes` false-positive)', async () => {
    const el = makeEditor();
    // 'wall_connector'.includes('wall_connector') would be true under a string read —
    // the Array.isArray guard means a string degrades to "nothing hidden".
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { hide: 'wall_connector' } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    expect(checkFor(el, 'wall_connector').checked).toBe(true);
    el.remove();
  });

  test('an unrelated edit does NOT mangle a garbage sibling (no spread-corruption)', async () => {
    const el = makeEditor();
    // `hide` is a garbage string — the card ignores it; the editor must leave it byte-
    // identical, NOT spread it into ['s','o','l','a','r'] when committing a row change.
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { hide: 'solar' } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const sel = el.shadowRoot!.querySelector(
      `.row-select[aria-label="${STRINGS.editor.sceneNodesRowLabel}: ${STRINGS.energy.nodes.home}"]`
    ) as HTMLSelectElement;
    sel.value = 'source';
    sel.dispatchEvent(new Event('change'));

    const emitted = cap.get() as unknown as TeslaCardConfig & {
      energy?: { nodes?: { hide?: unknown; rows?: Record<string, string> } };
    };
    expect(emitted.energy?.nodes?.rows).toEqual({ home: 'source' }); // the intended write
    expect(emitted.energy?.nodes?.hide).toBe('solar'); // garbage sibling untouched (not corrupted)
    el.remove();
  });
});

describe('editor re-review — reorder respects the EFFECTIVE (promoted) row (D1)', () => {
  test('a promoted load reorders AMONG the sources, and the promotion survives the move', async () => {
    const el = makeEditor();
    // wall_connector promoted to the source row ⇒ source row = [solar, powerwall, grid, generator, wall_connector].
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { rows: { wall_connector: 'source' } } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // wall_connector is last in the (promoted) source row; move it up → swaps with generator.
    moveButtonsFor(el, 'wall_connector').up.click();
    const emitted = cap.get() as unknown as TeslaCardConfig & {
      energy?: { nodes?: { order?: string[]; rows?: Record<string, string> } };
    };
    expect(emitted.energy?.nodes?.order).toEqual([
      'solar',
      'powerwall',
      'grid',
      'wall_connector',
      'generator',
      'home',
      'vehicle',
    ]);
    expect(emitted.energy?.nodes?.rows).toEqual({ wall_connector: 'source' }); // promotion preserved
    el.remove();
  });

  test('restoring the promoted within-row order prunes order but KEEPS the promotion (zero-diff baseline tracks rows)', async () => {
    const el = makeEditor();
    // Promotion active + a one-swap-from-canonical order within the promoted source row.
    el.setConfig({
      type: 'custom:tesla-card',
      energy: {
        nodes: {
          rows: { wall_connector: 'source' },
          order: ['solar', 'powerwall', 'grid', 'wall_connector', 'generator', 'home', 'vehicle'],
        },
      },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // Move generator up → swaps back with wall_connector → the canonical order FOR THIS promotion.
    moveButtonsFor(el, 'generator').up.click();
    const emitted = cap.get() as unknown as TeslaCardConfig & {
      energy?: { nodes?: { order?: string[]; rows?: Record<string, string> } };
    };
    expect(emitted.energy?.nodes?.order).toBeUndefined(); // pruned against the promotion-aware canonical
    expect(emitted.energy?.nodes?.rows).toEqual({ wall_connector: 'source' }); // promotion kept
    el.remove();
  });
});

// ── Story 9.15 — the per-node Source/Load row selector (cross-row promotion) ──────
// Rides the SAME `energy.nodes` customization surface as hide/order (Story 9.4), via
// `_commitNodes` with a delete-on-canonical prune. These pin the read/write contract:
// reflect the effective row, write `rows[role]`, prune to zero-diff, and round-trip
// forward-compatibly with hide/order/instances.
type RowsShape = { nodes?: { hide?: string[]; order?: string[]; instances?: unknown; rows?: Record<string, string> } };
/** The Source/Load select for the node whose display label is `label`. */
function rowSelectFor(el: EditorEl, label: string): HTMLSelectElement {
  return el.shadowRoot!.querySelector(
    `.node-row .row-select[aria-label="${STRINGS.editor.sceneNodesRowLabel}: ${label}"]`
  ) as HTMLSelectElement;
}

describe('Story 9.15 — cross-row row selector reflects + writes energy.nodes.rows', () => {
  test('every node renders a row select defaulting to its CANONICAL row', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const selects = el.shadowRoot!.querySelectorAll('.node-row .row-select');
    expect(selects.length).toBe(7); // one per Scene node (incl. vehicle + generator)
    // Sources default to 'source', loads (incl. the vehicle cell) to 'load'.
    expect(rowSelectFor(el, STRINGS.energy.nodes.solar).value).toBe('source');
    expect(rowSelectFor(el, STRINGS.energy.nodes.generator).value).toBe('source');
    expect(rowSelectFor(el, STRINGS.energy.nodes.home).value).toBe('load');
    expect(rowSelectFor(el, STRINGS.editor.nodeVehicle).value).toBe('load');
    el.remove();
  });

  test('a stored rows override reflects in the select', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { rows: { wall_connector: 'source' } } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    expect(rowSelectFor(el, STRINGS.energy.nodes.wall_connector).value).toBe('source');
    expect(rowSelectFor(el, STRINGS.energy.nodes.solar).value).toBe('source'); // others canonical
    el.remove();
  });

  test('promoting a load to the source row writes energy.nodes.rows[role]', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const sel = rowSelectFor(el, STRINGS.energy.nodes.wall_connector);
    sel.value = 'source';
    sel.dispatchEvent(new Event('change'));
    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: RowsShape };
    expect(emitted.energy?.nodes?.rows).toEqual({ wall_connector: 'source' });
    el.remove();
  });

  test('restoring a node to its canonical row DELETES the rows entry (and energy) — zero-diff', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { rows: { wall_connector: 'source' } } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // wall_connector's canonical row is 'load' → selecting it prunes the override.
    const sel = rowSelectFor(el, STRINGS.energy.nodes.wall_connector);
    sel.value = 'load';
    sel.dispatchEvent(new Event('change'));
    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: RowsShape };
    expect('energy' in emitted).toBe(false); // rows emptied → nodes + energy pruned
    el.remove();
  });

  test('a promotion preserves sibling hide / order / instances sub-keys (round-trip, R9)', async () => {
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { hide: ['solar'], order: ['home'], instances: { grid: [{}, {}] } } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    const sel = rowSelectFor(el, STRINGS.energy.nodes.home);
    sel.value = 'source';
    sel.dispatchEvent(new Event('change'));
    const emitted = cap.get() as unknown as TeslaCardConfig & { energy?: RowsShape };
    expect(emitted.energy?.nodes?.rows).toEqual({ home: 'source' });
    expect(emitted.energy?.nodes?.hide).toEqual(['solar']); // sibling kept
    expect(emitted.energy?.nodes?.order).toEqual(['home']); // sibling kept
    expect(emitted.energy?.nodes?.instances).toEqual({ grid: [{}, {}] }); // sibling kept
    el.remove();
  });

  test('FR-24 — a non-object garbage stored `rows` does NOT throw the editor; every select reflects its CANONICAL row', async () => {
    // Task-5 contract: the editor reads `rows` defensively (mirrors `_isHidden`). A garbage
    // stored value must not crash render, and `_nodeRow` falls through to canonical for
    // every node (a string can't index a role to a valid 'source'/'load').
    const el = makeEditor();
    expect(() =>
      el.setConfig({
        type: 'custom:tesla-card',
        energy: { nodes: { rows: 'nope' } },
      } as unknown as TeslaCardConfig)
    ).not.toThrow();
    await el.updateComplete;
    // All 7 selects rendered, each showing the node's canonical row (no override consumed).
    expect(el.shadowRoot!.querySelectorAll('.node-row .row-select').length).toBe(7);
    expect(rowSelectFor(el, STRINGS.energy.nodes.solar).value).toBe('source');
    expect(rowSelectFor(el, STRINGS.energy.nodes.home).value).toBe('load');
    expect(rowSelectFor(el, STRINGS.editor.nodeVehicle).value).toBe('load');
    el.remove();
  });

  test('FR-24 — an invalid stored row VALUE reflects as the canonical row (not the garbage value)', async () => {
    // A stored `rows[role]` that is not exactly 'source'/'load' (here 'middle') must degrade
    // to the role's canonical row in the select — matching the card's `_rowOf` validation.
    const el = makeEditor();
    el.setConfig({
      type: 'custom:tesla-card',
      energy: { nodes: { rows: { solar: 'middle', home: 'source' } } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    expect(rowSelectFor(el, STRINGS.energy.nodes.solar).value).toBe('source'); // invalid → canonical
    expect(rowSelectFor(el, STRINGS.energy.nodes.home).value).toBe('source'); // valid override honored
    el.remove();
  });
});

// ── Story 9.9 — guided first-run wizard (the no-YAML wizard FRAME) ─────────────
// The wizard shell, trigger, stepper, footer, Detect honesty, Finish write,
// persistence/resume, and "Run guided setup" re-entry. jsdom + label/role helpers,
// no network, partial hass tolerated. Discovery rides the existing data/ resolvers
// (AR-1) — these fixtures seed `hass.states` so the probe finds (or doesn't find)
// the bundled-default vehicle id + a substring-matched energy sensor.
const ONLINE_HASS = {
  states: {
    'binary_sensor.garage_model_y_status': { entity_id: 'binary_sensor.garage_model_y_status', state: 'on', attributes: {} },
    'sensor.my_home_solar_power': { entity_id: 'sensor.my_home_solar_power', state: '2.4', attributes: {} },
    'sensor.my_home_battery_power': { entity_id: 'sensor.my_home_battery_power', state: '-1.1', attributes: {} },
  },
} as unknown as HomeAssistant;
const EMPTY_HASS = { states: {} } as unknown as HomeAssistant;

const wiz = (el: EditorEl) => el.shadowRoot?.querySelector('.wizard');
const stepEls = (el: EditorEl) => Array.from(el.shadowRoot!.querySelectorAll('.step'));
const wizBtn = (el: EditorEl, cls: string) =>
  el.shadowRoot!.querySelector(`.wiz-btn.${cls}`) as HTMLButtonElement | null;
/** Drive the emphatic Next/Done control once, awaiting the re-render. */
async function clickPrimary(el: EditorEl): Promise<void> {
  wizBtn(el, 'primary')!.click();
  await el.updateComplete;
}

describe('Story 9.9 AC1 — wizard trigger (bare ⇒ wizard, configured ⇒ normal form)', () => {
  test('a bare stub config opens the 5-step wizard, not the normal form', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    expect(wiz(el)).toBeTruthy();
    expect($(el, '.form')).toBeFalsy(); // normal form NOT shown
    expect(stepEls(el).length).toBe(5); // DETECT · CONFIRM · APPEARANCE · TUNE · FINISH
    el.remove();
  });

  test('a pre-existing user config (no marker, non-bare) opens the NORMAL form, never the wizard', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card', name: 'Garage Y' } as TeslaCardConfig);
    await el.updateComplete;
    expect(wiz(el)).toBeFalsy();
    expect($(el, '.form')).toBeTruthy();
    el.remove();
  });

  test('a completed config (setup_complete: true) opens the normal form forever', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    expect(wiz(el)).toBeFalsy();
    expect($(el, '.form')).toBeTruthy();
    el.remove();
  });
});

describe('Story 9.9 AC5 — stepper advances + announces state non-visually', () => {
  test('the stepper advances with the step; state is announced in text (Step N of 5, …, current)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;

    let steps = stepEls(el);
    expect(steps[0].classList.contains('current')).toBe(true);
    expect(steps[0].getAttribute('aria-label')).toContain('Step 1 of 5');
    expect(steps[0].getAttribute('aria-label')).toContain(STRINGS.wizard.stateCurrent);
    expect(steps[1].getAttribute('aria-label')).toContain(STRINGS.wizard.stateNotStarted);

    await clickPrimary(el); // → Confirm (step 2)
    steps = stepEls(el);
    expect(steps[0].classList.contains('done')).toBe(true); // completed
    expect(steps[1].classList.contains('current')).toBe(true); // advanced — never static on Detect
    expect(steps[1].getAttribute('aria-label')).toContain('Step 2 of 5');
    expect(steps[1].getAttribute('aria-label')).toContain(STRINGS.wizard.stateCurrent);
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    el.remove();
  });

  test('state is encoded by COLOUR AND SHAPE — done renders a tick glyph, not a number', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    await clickPrimary(el); // Detect → done
    const done = stepEls(el)[0];
    expect(done.querySelector('.step-mark svg')).toBeTruthy(); // tick glyph (shape)
    expect(done.querySelector('.step-mark .step-num')).toBeFalsy(); // not a number
    el.remove();
  });
});

describe('Story 9.9 AC5 — footer Back/Skip/Next/Finish-now + Skip announces its default', () => {
  test('Back is disabled on step 0 and re-enabled after advancing; it returns', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    expect(wizBtn(el, 'tertiary')!.disabled).toBe(true); // Back disabled at Detect
    await clickPrimary(el); // → Confirm
    expect(wizBtn(el, 'tertiary')!.disabled).toBe(false);
    wizBtn(el, 'tertiary')!.click(); // Back
    await el.updateComplete;
    expect(stepEls(el)[0].classList.contains('current')).toBe(true);
    el.remove();
  });

  test('Skip announces the default it will apply (never a bare "Skip")', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    const skip = wizBtn(el, 'secondary')!;
    expect(skip.textContent?.trim()).toBe(STRINGS.wizard.skip);
    expect(skip.getAttribute('aria-label')).toBe(
      `${STRINGS.wizard.skipPrefix} — ${STRINGS.wizard.detect.skipDefault}`
    );
    el.remove();
  });

  test('Skip advances like Next (skip-to-default per step)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    wizBtn(el, 'secondary')!.click(); // Skip Detect
    await el.updateComplete;
    expect(stepEls(el)[1].classList.contains('current')).toBe(true);
    el.remove();
  });

  test('every footer control is a keyboard-operable <button>, focus order Back→Skip→Next→Finish-now', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    const btns = Array.from(el.shadowRoot!.querySelectorAll('.wiz-footer .wiz-btn')) as HTMLButtonElement[];
    expect(btns.every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true);
    expect(btns.map((b) => b.classList[1])).toEqual(['tertiary', 'secondary', 'primary', 'quiet']);
    el.remove();
  });
});

describe('Story 9.9 AC2 — Detect honesty (three-state found vs empty + manual fallback)', () => {
  test('found: every role shows a three-state row announced in TEXT (never hue-only)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.disco-row'));
    expect(rows.length).toBe(7); // all seven roles shown (absent shown absent — CAP-4)

    const vehicle = rows.find((r) => r.getAttribute('aria-label')?.startsWith(STRINGS.editor.nodeVehicle))!;
    expect(vehicle.getAttribute('aria-label')).toBe(`${STRINGS.editor.nodeVehicle}, ${STRINGS.wizard.detect.online}`);
    expect(vehicle.classList.contains('online')).toBe(true);

    // An absent role is shown ABSENT (— not found), not an empty field.
    const gen = rows.find((r) => r.getAttribute('aria-label')?.startsWith(STRINGS.energy.nodes.generator))!;
    expect(gen.getAttribute('aria-label')).toBe(`${STRINGS.energy.nodes.generator}, ${STRINGS.wizard.detect.notFound}`);
    expect(gen.classList.contains('absent')).toBe(true);
    el.remove();
  });

  test('empty/fail: a calm honest message + manual fallback, Next disabled, never a fake "all set"', async () => {
    const el = makeEditor();
    el.hass = EMPTY_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    const empty = el.shadowRoot!.querySelector('.wiz-empty');
    expect(empty).toBeTruthy();
    expect(empty!.getAttribute('role')).toBe('status'); // labelled live region
    expect(empty!.textContent).toContain(STRINGS.wizard.detect.emptyBody);
    const footerNext = el.shadowRoot!.querySelector('.wiz-footer .wiz-btn.primary') as HTMLButtonElement;
    expect(footerNext.disabled).toBe(true); // Next gated — must go manual
    // The manual-selection CTA routes into the Step-2 mapping.
    const manual = empty!.querySelector('button')!;
    expect(manual.textContent?.trim()).toBe(STRINGS.wizard.detect.selectManually);
    manual.click();
    await el.updateComplete;
    expect(stepEls(el)[1].classList.contains('current')).toBe(true);
    el.remove();
  });

  test('no hass: Detect degrades to the empty state without throwing (AR-15 / AR-1)', async () => {
    const el = makeEditor();
    el.hass = undefined;
    expect(() => el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig)).not.toThrow();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.wiz-empty')).toBeTruthy();
    el.remove();
  });
});

describe('Story 9.9 AC3 — Finish writes a complete, forward-compatible config + revert to normal form', () => {
  test('Done. emits a config the live card accepts via setConfig, preserves an unknown key (R9), and marks complete', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    // An in-progress wizard (setup_complete:false) carrying an unknown future key.
    el.setConfig({ type: 'custom:tesla-card', setup_complete: false, future_x: 'keep' } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // Resume lands at Confirm (step 2). Advance to Finish, then click Done.
    await clickPrimary(el); // Confirm → Appearance
    await clickPrimary(el); // Appearance → Tune
    await clickPrimary(el); // Tune → Finish
    await clickPrimary(el); // Done.

    const emitted = cap.get() as unknown as Record<string, unknown>;
    expect(emitted).toBeDefined();
    expect(emitted.setup_complete).toBe(true);
    expect(emitted.type).toBe('custom:tesla-card');
    expect(emitted.future_x).toBe('keep'); // R9 — unknown key preserved through Finish

    // Re-opening with the completed config is the NORMAL form (revert).
    el.setConfig(emitted as unknown as TeslaCardConfig);
    await el.updateComplete;
    expect(wiz(el)).toBeFalsy();
    expect($(el, '.form')).toBeTruthy();

    // The emitted config is consumed by a live card without throwing.
    const card = document.createElement('tesla-card') as unknown as {
      hass?: HomeAssistant;
      setConfig(c: TeslaCardConfig): void;
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(card as unknown as HTMLElement);
    expect(() => card.setConfig(emitted as unknown as TeslaCardConfig)).not.toThrow();
    await expect(card.updateComplete).resolves.toBeDefined();
    (card as unknown as HTMLElement).remove();
    el.remove();
  });

  test('Finish renders the result name but NO fabricated telemetry (freshness discipline)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card', name: 'Garage Y', setup_complete: false } as TeslaCardConfig);
    await el.updateComplete;
    await clickPrimary(el); // Confirm → Appearance
    await clickPrimary(el); // Appearance → Tune
    await clickPrimary(el); // Tune → Finish
    const result = el.shadowRoot!.querySelector('.wiz-result')!;
    expect(result.textContent).toContain('Garage Y');
    expect(result.textContent).not.toContain('%'); // never a fabricated SoC
    el.remove();
  });
});

describe('Story 9.9 AC6 — persistence/resume + "Run guided setup" re-entry', () => {
  test('leaving Detect persists setup_complete:false to Lovelace (refresh-resumable marker)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await clickPrimary(el); // leave Detect
    const emitted = cap.get() as unknown as Record<string, unknown>;
    expect(emitted.setup_complete).toBe(false); // in-progress marker written to config (not localStorage)
    expect(emitted.type).toBe('custom:tesla-card');
    el.remove();
  });

  test('an in-progress config (setup_complete:false) resumes the wizard past Detect at Confirm', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card', setup_complete: false } as TeslaCardConfig);
    await el.updateComplete;
    expect(wiz(el)).toBeTruthy();
    expect(stepEls(el)[1].classList.contains('current')).toBe(true); // resumed at Confirm (step 2)
    el.remove();
  });

  test('"Run guided setup" re-enters the wizard from the normal form at Detect (marker not cleared)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card', name: 'Garage Y', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const run = el.shadowRoot!.querySelector('.run-setup') as HTMLButtonElement;
    expect(run).toBeTruthy();
    expect(run.textContent).toContain(STRINGS.editor.runGuidedSetup);
    run.click();
    await el.updateComplete;
    expect(wiz(el)).toBeTruthy();
    expect(stepEls(el)[0].classList.contains('current')).toBe(true); // restarts at Detect
    el.remove();
  });
});

describe('Story 9.9 AC4 — reduced-motion cut + trade-dress + a11y floor (chrome)', () => {
  test('the step transition degrades to an instant cut under prefers-reduced-motion', () => {
    const styles = String((customElements.get('tesla-card-editor') as unknown as { styles: unknown }).styles);
    expect(styles).toContain('prefers-reduced-motion');
    expect(styles).toContain('wiz-fade'); // the crossfade keyframe (gated by the media query)
  });

  test('every wizard control clears the ≥44px touch/keyboard target floor (AC5)', () => {
    const styles = String((customElements.get('tesla-card-editor') as unknown as { styles: unknown }).styles);
    expect(styles).toContain('min-height: 44px');
  });

  test('wizard chrome carries the disclaimer and NO Tesla / HA copyright marks (trade-dress)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    const chrome = wiz(el)!.textContent ?? '';
    // The ONLY mark is the "Not affiliated with Tesla, Inc." disclaimer — no HA
    // copyright (reconcile divergence #2), no Tesla brand stamp beyond the disclaimer.
    expect(chrome).toContain(STRINGS.wizard.disclaimer);
    expect(chrome).not.toContain('©');
    expect(chrome).not.toContain('HOME ASSISTANT');
    el.remove();
  });
});
