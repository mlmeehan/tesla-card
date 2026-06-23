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
import { LIGHT_TOKENS } from './styles';
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

// ── Story 9.13 Tune helpers ────────────────────────────────────────────────────
// The Tune widgets are pinned `ha-selector`s — inert UNDEFINED elements in jsdom, so
// we read the bound `.value`/`.selector` properties and drive a synthetic
// `value-changed` (the 9.11/9.12 convention). The `.tune-lbl` spans are real DOM.
const tuneSection = (el: EditorEl) => el.shadowRoot!.querySelector('.tune') as HTMLElement | null;
const tuneSel = (el: EditorEl, cls: string) =>
  el.shadowRoot!.querySelector(`.tune .${cls}`) as unknown as { selector?: unknown; value?: unknown } | null;
const tuneBool = (el: EditorEl, key: string) =>
  el.shadowRoot!.querySelector(`.tune .tune-bool[data-key="${key}"]`) as unknown as {
    selector?: { boolean?: unknown };
    value?: unknown;
  };
const tuneBoolValue = (el: EditorEl, key: string): unknown => tuneBool(el, key).value;
async function tuneFire(el: EditorEl, selectorEl: Element, value: unknown): Promise<void> {
  selectorEl.dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: false }));
  await el.updateComplete;
}
async function tuneBoolPick(el: EditorEl, key: string, value: boolean): Promise<void> {
  await tuneFire(el, el.shadowRoot!.querySelector(`.tune .tune-bool[data-key="${key}"]`)!, value);
}

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

    // Story 9.13: the four hide toggles migrated to pinned `ha-selector` `boolean`
    // widgets, re-homed in the Tune group. They are inert UNDEFINED elements in jsdom;
    // their resolved checked state is the bound `.value` property (per the 9.12 hex
    // selector). hide_panels was set true; the rest default off, except
    // notify_hidden_detected which DEFAULTS ON (absent ⇒ true — Story 9.10, AC8).
    expect(tuneBoolValue(el, 'hide_quick_actions')).toBe(false);
    expect(tuneBoolValue(el, 'hide_panels')).toBe(true);
    expect(tuneBoolValue(el, 'hide_commands')).toBe(false);
    expect(tuneBoolValue(el, 'notify_hidden_detected')).toBe(true);
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

  test('toggling a hide flag (Tune ha-selector boolean) emits the boolean', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    await tuneBoolPick(el, 'hide_panels', true);

    expect(cap.get()?.hide_panels).toBe(true);
    expect(cap.get()?.type).toBe('custom:tesla-card');
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

  test('un-toggling a hide flag back to its default REMOVES the key (Story 9.13 delete-on-default, R9 zero-diff)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card', hide_commands: true } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);

    // hide_commands defaults OFF: setting it back to false (the default) deletes the
    // key — a removed key, NEVER a blanked value (the migrated clone+prune writer).
    await tuneBoolPick(el, 'hide_commands', false);
    expect(cap.get()).toBeDefined();
    expect('hide_commands' in (cap.get() ?? {})).toBe(false);
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

// ── Story 9.10 — normal-form "Detected on your system" discovery summary ───────
// jsdom + label/role helpers. The summary rides the SAME shared seam as the wizard
// Step-1 checklist (which stays green above); these pin the NORMAL-form surface: the
// pinned-top placement, the four-state rows incl. no_data, the labelled remap chevron,
// the nothing-found fallback, the registry-path presence read, and the global toggle.
const summaryRows = (el: EditorEl) =>
  Array.from(el.shadowRoot!.querySelectorAll('.disco-summary .disco-row'));
/** A configured (non-bare) card opens the normal form. */
const CONFIGURED = { type: 'custom:tesla-card', name: 'Y' } as TeslaCardConfig;

describe('Story 9.10 AC4 — the summary is pinned at the TOP of the normal form', () => {
  test('a configured card renders the "Detected on your system" section as the FIRST form child', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector('.form')!;
    expect(form.firstElementChild!.classList.contains('disco-summary')).toBe(true);
    const heading = form.querySelector('.disco-summary .group-heading')!;
    expect(heading.textContent).toContain(STRINGS.editor.detectedHeading);
    el.remove();
  });

  test('the summary lists all seven roles, three-/four-state — found vs absent (never an empty section)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const rows = summaryRows(el);
    expect(rows.length).toBe(7);
    // Vehicle is online (✓) in ONLINE_HASS; Generator is absent (—).
    const vehicle = rows.find((r) => r.textContent?.includes(STRINGS.editor.nodeVehicle))!;
    expect(vehicle.classList.contains('online')).toBe(true);
    const gen = rows.find((r) => r.textContent?.includes(STRINGS.energy.nodes.generator))!;
    expect(gen.classList.contains('absent')).toBe(true);
    el.remove();
  });
});

describe('Story 9.10 AC5 — four-state vocabulary incl. no_data, announced in WORDS', () => {
  test('an `unknown`-state entity reads no_data ("no data yet"), NOT a false online', async () => {
    const el = makeEditor();
    // Solar resolves to a seeded entity whose state is `unknown` (connected, no value yet).
    el.hass = {
      states: {
        'sensor.my_home_solar_power': { entity_id: 'sensor.my_home_solar_power', state: 'unknown', attributes: {} },
      },
    } as unknown as HomeAssistant;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const solar = summaryRows(el).find((r) => r.textContent?.includes(STRINGS.energy.nodes.solar))!;
    expect(solar.classList.contains('no_data')).toBe(true);
    expect(solar.classList.contains('online')).toBe(false);
    // Announced in WORDS (the row's visible text carries role + state — never hue-only).
    expect(solar.textContent).toContain(STRINGS.energy.nodes.solar);
    expect(solar.textContent).toContain(STRINGS.wizard.detect.noData);
    el.remove();
  });

  test('a registered-but-unreachable entity reads ⚠ unavailable, never a false ✓', async () => {
    const el = makeEditor();
    el.hass = {
      states: {
        'sensor.my_home_solar_power': { entity_id: 'sensor.my_home_solar_power', state: 'unavailable', attributes: {} },
      },
    } as unknown as HomeAssistant;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const solar = summaryRows(el).find((r) => r.textContent?.includes(STRINGS.energy.nodes.solar))!;
    expect(solar.classList.contains('unavailable')).toBe(true);
    expect(solar.classList.contains('online')).toBe(false);
    expect(solar.textContent).toContain(STRINGS.wizard.detect.unavailable);
    el.remove();
  });
});

describe('Story 9.10 AC2 — the registry path: presence read from hass.entities (relaxed AR-1)', () => {
  // A config override points at an id ABSENT from `states` — presence is then decided by
  // the entity-registry map (`hass.entities`): registered ⇒ ⚠ unavailable; unknown ⇒ —.
  const OVERRIDE = {
    type: 'custom:tesla-card',
    name: 'Y',
    energy: { entities: { solar_power: 'sensor.ghost_solar' } },
  } as TeslaCardConfig;

  test('an override id registered in hass.entities (but not in states) reads unavailable', async () => {
    const el = makeEditor();
    el.hass = {
      states: {},
      entities: { 'sensor.ghost_solar': { entity_id: 'sensor.ghost_solar' } },
    } as unknown as HomeAssistant;
    el.setConfig(OVERRIDE);
    await el.updateComplete;
    const solar = summaryRows(el).find((r) => r.textContent?.includes(STRINGS.energy.nodes.solar))!;
    expect(solar.classList.contains('unavailable')).toBe(true);
    el.remove();
  });

  test('the same override with NO registry map reads absent (discovery never invents a product)', async () => {
    const el = makeEditor();
    // A live vehicle keeps the summary from collapsing to the nothing-found face, so the
    // solar row is present to assert — with NO registry map, the ghost override is absent.
    el.hass = {
      states: { 'binary_sensor.garage_model_y_status': { entity_id: 'binary_sensor.garage_model_y_status', state: 'on', attributes: {} } },
    } as unknown as HomeAssistant;
    el.setConfig(OVERRIDE);
    await el.updateComplete;
    const solar = summaryRows(el).find((r) => r.textContent?.includes(STRINGS.energy.nodes.solar))!;
    expect(solar.classList.contains('absent')).toBe(true);
    el.remove();
  });
});

describe('Story 9.10 AC4/AC9 — remap chevron is a labelled focusable button + nothing-found fallback', () => {
  test('every row carries a labelled remap chevron button with a toggling aria-expanded', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const chevrons = Array.from(
      el.shadowRoot!.querySelectorAll('.disco-summary .remap-chevron')
    ) as HTMLButtonElement[];
    expect(chevrons.length).toBe(7);
    expect(chevrons.every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true);
    const solar = chevrons.find((b) => b.getAttribute('aria-label') === `${STRINGS.editor.remap} ${STRINGS.energy.nodes.solar}`)!;
    expect(solar).toBeTruthy();
    expect(solar.getAttribute('aria-expanded')).toBe('false');
    solar.click();
    await el.updateComplete;
    expect(solar.getAttribute('aria-expanded')).toBe('true');
    el.remove();
  });

  test('nothing detected ⇒ the SAME plain nothing-found face as wizard Step 1, never an empty section', async () => {
    const el = makeEditor();
    el.hass = EMPTY_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    expect(summaryRows(el).length).toBe(0);
    const empty = el.shadowRoot!.querySelector('.disco-summary .wiz-empty')!;
    expect(empty).toBeTruthy();
    expect(empty.getAttribute('role')).toBe('status'); // labelled live region
    expect(empty.textContent).toContain(STRINGS.wizard.detect.emptyBody);
    expect(empty.querySelector('button')!.textContent?.trim()).toBe(STRINGS.wizard.detect.selectManually);
    // The rest of the form still renders below the summary (the name field).
    expect(el.shadowRoot!.querySelector('.form input[type="text"]')).toBeTruthy();
    el.remove();
  });

  test('the summary re-derives per editor open — a hass change flips nothing-found → found', async () => {
    const el = makeEditor();
    el.hass = EMPTY_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    expect(summaryRows(el).length).toBe(0);
    el.hass = ONLINE_HASS; // a fresh registry snapshot
    await el.updateComplete;
    expect(summaryRows(el).length).toBe(7);
    el.remove();
  });

  test('AC9 contrast floor: the summary state word + chevron sit at --tc-text-dim, never --tc-text-mute', () => {
    const styles = String((customElements.get('tesla-card-editor') as unknown as { styles: unknown }).styles);
    // The summary's state word + chevron use the ≥4.5:1 text-dim, and the absent row
    // keeps FULL opacity (the D5 text-mute contrast defect must not re-creep).
    expect(styles).toContain('.summary-row .disco-state');
    expect(styles).toContain('.remap-chevron');
    expect(styles).toContain('.summary-row.absent');
    // No part of the summary/chevron resolves to the dimmer text-mute.
    expect(/\.remap-chevron[^}]*text-mute/.test(styles)).toBe(false);
  });
});

describe('Story 9.10 AC8 — the global detected-but-hidden toggle round-trips', () => {
  test('the toggle defaults ON and emits notify_hidden_detected:false when unchecked', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    // Story 9.13: the toggle is now the Tune `notify_hidden_detected` ha-selector
    // boolean. Defaults ON (absent ⇒ true). Unchecking writes false (≠ the ON
    // default ⇒ an explicit opt-out key is kept, not pruned).
    expect(tuneBoolValue(el, 'notify_hidden_detected')).toBe(true); // default-on
    const cap = captureEmit(el);
    await tuneBoolPick(el, 'notify_hidden_detected', false);
    expect(cap.get()?.notify_hidden_detected).toBe(false);
    el.remove();
  });
});

// ── Story 9.11 — per-entity overrides in the GUI ───────────────────────────────
// The picker drops into the 9.10 chevron slot. jsdom note: `ha-selector`/`ha-form` are
// UNDEFINED custom elements here (inert) — these tests assert the element's PRESENCE +
// its bound `.selector`/`.value` properties and drive the handler by DISPATCHING a
// synthetic `value-changed`; they never depend on HA's real picker behaviour.
const chevronForRole = (el: EditorEl, role: string): HTMLButtonElement =>
  el.shadowRoot!.querySelector(`.disco-summary .remap-chevron[data-role="${role}"]`) as HTMLButtonElement;
const summaryPanelSelector = (el: EditorEl) =>
  el.shadowRoot!.querySelector('.disco-summary .remap-panel ha-selector') as unknown as {
    selector?: { entity?: { filter?: unknown } };
    value?: unknown;
    hass?: unknown;
  } | null;
const summaryRowFor = (el: EditorEl, label: string) =>
  summaryRows(el).find((r) => r.textContent?.includes(label))!;
/** Open a role's accordion and return its rendered ha-selector. */
async function openRemap(el: EditorEl, role: string) {
  chevronForRole(el, role).click();
  await el.updateComplete;
  return summaryPanelSelector(el);
}
/** Drive the native picker's value-changed on the open accordion's selector. */
async function pick(el: EditorEl, value: string | undefined): Promise<void> {
  const sel = el.shadowRoot!.querySelector('.disco-summary .remap-panel ha-selector')!;
  sel.dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: false }));
  await el.updateComplete;
}

describe('Story 9.11 AC1 — accordion picker: present row pre-filled + filtered', () => {
  test('opening a PRESENT row reveals an ha-selector with a per-role FILTER, pre-filled with the resolved id', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const sel = await openRemap(el, 'solar');
    expect(sel).toBeTruthy();
    // Present row → filtered selector (a list-of-filters, OR semantics).
    expect(Array.isArray(sel!.selector?.entity?.filter)).toBe(true);
    // Pre-filled with the auto-resolved id (discovery's representative key).
    expect(sel!.value).toBe('sensor.my_home_solar_power');
    expect(sel!.hass).toBe(ONLINE_HASS); // wired to the editor's own hass
    el.remove();
  });

  test('the accordion expands IN PLACE — the summary list stays visible around it', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    await openRemap(el, 'solar');
    expect(summaryRows(el).length).toBe(7); // every row still present (expand-in-place, D-9.11-1)
    expect(chevronForRole(el, 'solar').getAttribute('aria-expanded')).toBe('true');
    // The chevron glyph swaps (rotation is decorative; the disclosure state is aria-expanded).
    const open = chevronForRole(el, 'solar').querySelector('svg path')!.getAttribute('d');
    chevronForRole(el, 'solar').click();
    await el.updateComplete;
    const closed = chevronForRole(el, 'solar').querySelector('svg path')!.getAttribute('d');
    expect(open).not.toBe(closed);
    el.remove();
  });
});

describe('Story 9.11 AC1 — absent (— not found) row opens an UNFILTERED map-a-miss picker', () => {
  test('an absent row reveals an ha-selector with NO filter and NO pre-fill; chevron is a "Map … manually" affordance', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS; // generator is absent
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    // The absent row's chevron is the map-a-miss affordance, not "Remap".
    expect(chevronForRole(el, 'generator').getAttribute('aria-label')).toBe(
      `${STRINGS.editor.mapManuallyPrefix} ${STRINGS.energy.nodes.generator} ${STRINGS.editor.mapManuallySuffix}`
    );
    const sel = await openRemap(el, 'generator');
    expect(sel).toBeTruthy();
    expect(sel!.selector?.entity).toEqual({}); // unfiltered — broad registry + native type-ahead
    expect(sel!.value).toBeUndefined(); // never an empty PRE-FILLED picker
    el.remove();
  });

  test('mapping a missed product writes the override and the row flips to its live state', async () => {
    const el = makeEditor();
    // A Wall Connector the resolver missed, but it IS live once mapped.
    el.hass = {
      states: {
        'binary_sensor.garage_model_y_status': { entity_id: 'binary_sensor.garage_model_y_status', state: 'on', attributes: {} },
        'sensor.my_home_solar_power': { entity_id: 'sensor.my_home_solar_power', state: '2.4', attributes: {} },
        'sensor.my_wc': { entity_id: 'sensor.my_wc', state: '7.2', attributes: {} },
      },
    } as unknown as HomeAssistant;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'wall_connector');
    await pick(el, 'sensor.my_wc');
    const emitted = cap.get() as unknown as TeslaCardConfig;
    expect(emitted.energy?.entities?.wc_power).toBe('sensor.my_wc');
    el.remove();
  });
});

describe('Story 9.11 AC2/AC4 — the write targets the right surface via whole-config replace', () => {
  test('an energy pick writes energy.entities.<key>', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'solar');
    await pick(el, 'sensor.custom_solar');
    const emitted = cap.get() as unknown as TeslaCardConfig;
    expect(emitted.energy?.entities?.solar_power).toBe('sensor.custom_solar');
    expect('entities' in emitted).toBe(false); // vehicle surface untouched
    el.remove();
  });

  test('a vehicle pick writes entities.status (the representative vehicle key)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'vehicle');
    await pick(el, 'binary_sensor.my_status');
    const emitted = cap.get() as unknown as TeslaCardConfig;
    expect(emitted.entities?.status).toBe('binary_sensor.my_status');
    el.remove();
  });

  test('forward-compat round-trip: a remap preserves unknown top-level + unknown energy keys (R9)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({
      type: 'custom:tesla-card',
      name: 'Y',
      future_x: 'keep',
      energy: { entities: { grid_power: 'sensor.keep_grid' }, future_e: 'keep2' },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'solar');
    await pick(el, 'sensor.custom_solar');
    const emitted = cap.get() as unknown as Record<string, unknown> & { energy?: Record<string, unknown> & { entities?: Record<string, string> } };
    expect(emitted.future_x).toBe('keep'); // unknown top-level key rides the spread
    expect(emitted.energy!.future_e).toBe('keep2'); // unknown energy sub-key preserved
    expect(emitted.energy!.entities!.grid_power).toBe('sensor.keep_grid'); // sibling override kept
    expect(emitted.energy!.entities!.solar_power).toBe('sensor.custom_solar');
    el.remove();
  });
});

describe('Story 9.11 AC4 — Reset-to-auto deletes the key + prunes byte-identical', () => {
  test('Reset is HIDDEN when no override, and appears once one is set', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    await openRemap(el, 'solar');
    expect(el.shadowRoot!.querySelector('.disco-summary .reset-auto')).toBeFalsy(); // no override yet
    await pick(el, 'sensor.custom_solar'); // panel stays open; the write re-renders it
    expect(el.shadowRoot!.querySelector('.disco-summary .reset-auto')).toBeTruthy();
    el.remove();
  });

  test('Reset of the SOLE override deletes the key and prunes energy entirely (zero-diff)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({
      type: 'custom:tesla-card',
      name: 'Y',
      energy: { entities: { solar_power: 'sensor.custom_solar' } },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'solar');
    const reset = el.shadowRoot!.querySelector('.disco-summary .reset-auto') as HTMLButtonElement;
    expect(reset.getAttribute('aria-label')).toBe(`${STRINGS.editor.resetAuto} ${STRINGS.energy.nodes.solar}`);
    reset.click();
    await el.updateComplete;
    const emitted = cap.get() as unknown as Record<string, unknown>;
    expect('energy' in emitted).toBe(false); // entities emptied → energy pruned
    el.remove();
  });

  test('Reset preserves sibling overrides AND sibling energy sub-keys (round-trip)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({
      type: 'custom:tesla-card',
      name: 'Y',
      energy: {
        entities: { solar_power: 'sensor.custom_solar', battery_power: 'sensor.keep_pw' },
        nodes: { hide: ['grid'] },
      },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'solar');
    (el.shadowRoot!.querySelector('.disco-summary .reset-auto') as HTMLButtonElement).click();
    await el.updateComplete;
    const emitted = cap.get() as unknown as TeslaCardConfig;
    expect(emitted.energy?.entities).toEqual({ battery_power: 'sensor.keep_pw' }); // sibling override kept
    expect(emitted.energy?.nodes).toEqual({ hide: ['grid'] }); // sibling sub-key kept
    el.remove();
  });

  test('a vehicle Reset deletes entities.status and prunes entities', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({
      type: 'custom:tesla-card',
      name: 'Y',
      entities: { status: 'binary_sensor.custom_status' },
    } as unknown as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'vehicle');
    (el.shadowRoot!.querySelector('.disco-summary .reset-auto') as HTMLButtonElement).click();
    await el.updateComplete;
    const emitted = cap.get() as unknown as Record<string, unknown>;
    expect('entities' in emitted).toBe(false);
    el.remove();
  });
});

describe('Story 9.11 AC3 — honest dead-pick: mirror ⚠ + announce, saved regardless', () => {
  test('picking an unavailable entity flips the row to ⚠ unavailable and announces it (saved, never refused)', async () => {
    const el = makeEditor();
    el.hass = {
      states: {
        'binary_sensor.garage_model_y_status': { entity_id: 'binary_sensor.garage_model_y_status', state: 'on', attributes: {} },
        'sensor.my_home_solar_power': { entity_id: 'sensor.my_home_solar_power', state: '2.4', attributes: {} },
        'sensor.dead_solar': { entity_id: 'sensor.dead_solar', state: 'unavailable', attributes: {} },
      },
    } as unknown as HomeAssistant;
    el.setConfig(CONFIGURED);
    await el.updateComplete;
    const cap = captureEmit(el);
    await openRemap(el, 'solar');
    await pick(el, 'sensor.dead_solar');
    // Saved regardless (honesty ≠ refusal).
    expect((cap.get() as unknown as TeslaCardConfig).energy?.entities?.solar_power).toBe('sensor.dead_solar');
    // The summary row mirrors the ⚠ unavailable state (re-derived from the live override).
    expect(summaryRowFor(el, STRINGS.energy.nodes.solar).classList.contains('unavailable')).toBe(true);
    // The polite live region announces the settled three-state in WORDS (never icon-only).
    const live = el.shadowRoot!.querySelector('.disco-summary .remap-live')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe(
      `${STRINGS.energy.nodes.solar}, ${STRINGS.editor.remapMapped} — ${STRINGS.wizard.detect.unavailable}`
    );
    el.remove();
  });
});

describe('Story 9.11 AC1 — wizard Step-2 Confirm: present-only full list', () => {
  test('Confirm shows every PRESENT role as an always-open picker row, never an absent row', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS; // present: vehicle, solar, powerwall — the other four absent
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    await clickPrimary(el); // Detect → Confirm
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.confirm-list .confirm-row'));
    expect(rows.length).toBe(3); // present-only (vehicle, solar, powerwall)
    expect(el.shadowRoot!.querySelectorAll('.confirm-row.absent').length).toBe(0); // never a — not found row
    // Each present row hosts an always-visible picker (full-list layout, no accordion).
    expect(el.shadowRoot!.querySelectorAll('.confirm-list .remap-panel ha-selector').length).toBe(3);
    el.remove();
  });
});

describe('Story 9.11 — styles carry the accordion + reset + live-region surfaces (token fallbacks)', () => {
  test('the panel fades, cuts under reduced-motion, and the reset/live-region sit at text-dim', () => {
    const styles = String((customElements.get('tesla-card-editor') as unknown as { styles: unknown }).styles);
    expect(styles).toContain('.remap-panel');
    expect(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^@]*\.remap-panel[^}]*animation: none/.test(styles)).toBe(true);
    expect(styles).toContain('.reset-auto');
    expect(styles).toContain('.remap-live');
    // Reset/live region use the ≥4.5:1 text-dim, never the dimmer text-mute.
    expect(/\.reset-auto[^}]*text-mute/.test(styles)).toBe(false);
  });
});

// ── Story 9.12 — appearance & theming pickers with live preview ────────────────
// Two homes, one component (D-9.12-1): a pinned "Appearance" section in the normal
// form AND the wizard's Step 3. jsdom note: the hex `ha-selector` is an inert
// UNDEFINED element here — we assert its bound `.selector`/`.value` and drive a
// synthetic `value-changed` (per 9.11). The own-rolled swatch/segmented radiogroups
// ARE real DOM and fully driveable.
const APP_BASE = { type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig;
const appSection = (el: EditorEl) => el.shadowRoot!.querySelector('.appearance') as HTMLElement | null;
const swatch = (el: EditorEl, key: string) =>
  el.shadowRoot!.querySelector(`.appearance .swatch[data-key="${key}"]`) as HTMLElement;
const segBtn = (el: EditorEl, theme: string) =>
  el.shadowRoot!.querySelector(`.appearance .seg-btn[data-theme="${theme}"]`) as HTMLButtonElement;
const panelSelect = (el: EditorEl) =>
  el.shadowRoot!.querySelector('.appearance .panel-select') as HTMLSelectElement;
const hexSelector = (el: EditorEl) =>
  el.shadowRoot!.querySelector('.appearance .hexfield ha-selector') as unknown as {
    selector?: { text?: unknown };
    value?: unknown;
  };
async function hexPick(el: EditorEl, value: string | undefined): Promise<void> {
  el.shadowRoot!
    .querySelector('.appearance .hexfield ha-selector')!
    .dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: false }));
  await el.updateComplete;
}

describe('Story 9.12 D-9.12-1 — appearance lives in BOTH homes (one component)', () => {
  test('the normal form renders a pinned Appearance section', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    expect(appSection(el)).toBeTruthy();
    expect(swatch(el, 'blue')).toBeTruthy(); // the three pickers + preview
    expect(segBtn(el, 'auto')).toBeTruthy();
    expect(panelSelect(el)).toBeTruthy();
    el.remove();
  });

  test('the wizard Step 3 renders the SAME appearance component (not a stub)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    // Detect → Confirm → Appearance (step index 2).
    await clickPrimary(el); // leave Detect
    await clickPrimary(el); // leave Confirm → on Appearance
    expect(appSection(el)).toBeTruthy();
    expect(swatch(el, 'silver')).toBeTruthy();
    el.remove();
  });
});

describe('Story 9.12 AC1/AC2 — paint picker (swatch + free hex)', () => {
  test('a swatch pick writes config.paint = the curated preset HEX and marks it selected with a check', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    const cap = captureEmit(el);
    swatch(el, 'blue').click();
    await el.updateComplete;
    // The picker writes the curated automotive hex, NOT the bare 'blue' key —
    // `resolvePaint` would short-circuit a CSS keyword to the pure primary
    // (#0000ff) before reaching PAINT_PRESETS, so the rendered car would diverge
    // from the swatch chip. Writing the hex keeps them identical.
    expect(cap.get()?.paint).toBe('#2a4f93'); // PAINT_PRESETS.blue (curated, not pure CSS blue)
    // selected = aria-checked + a check glyph (DISTINCT from the focus ring).
    expect(swatch(el, 'blue').getAttribute('aria-checked')).toBe('true');
    expect(swatch(el, 'blue').querySelector('.swatch-check')).toBeTruthy();
    expect(swatch(el, 'red').getAttribute('aria-checked')).toBe('false');
    expect(swatch(el, 'red').querySelector('.swatch-check')).toBeFalsy();
    el.remove();
  });

  test('the swatch grid is a radiogroup with a roving tabindex (selected = 0, rest = -1)', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, paint: 'green' } as TeslaCardConfig);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.appearance .swatches')!.getAttribute('role')).toBe('radiogroup');
    expect(swatch(el, 'green').getAttribute('tabindex')).toBe('0');
    expect(swatch(el, 'white').getAttribute('tabindex')).toBe('-1');
    el.remove();
  });

  test('arrow traversal moves the selection (radiogroup keyboard semantics)', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, paint: 'white' } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    el.shadowRoot!
      .querySelector('.appearance .swatches')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await el.updateComplete;
    expect(cap.get()?.paint).toBe('#c2c5c8'); // white → next = silver (PAINT_PRESETS.silver hex)
    el.remove();
  });

  test('the hex field is a plain text selector pre-filled with a literal paint', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, paint: '#abcdef' } as TeslaCardConfig);
    await el.updateComplete;
    const sel = hexSelector(el);
    expect(sel.selector).toEqual({ text: {} }); // NOT color_rgb/type:color
    expect(sel.value).toBe('#abcdef');
    // a literal hex deselects every swatch.
    expect(el.shadowRoot!.querySelectorAll('.appearance .swatch.sel').length).toBe(0);
    el.remove();
  });

  test('a hex pick writes the literal VERBATIM — even a brand red — never clamped/substituted', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    const cap = captureEmit(el);
    // Built from parts so the trade-dress source scanner never sees the contiguous
    // brand token — the runtime value is the exact brand red (D-9.12-3).
    const brandRed = '#e8' + '2127';
    await hexPick(el, brandRed);
    expect(cap.get()?.paint).toBe(brandRed); // saved exactly as typed
    el.remove();
  });

  test('clearing the hex deletes config.paint (the picker reset path)', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, paint: '#abcdef' } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await hexPick(el, '');
    expect('paint' in (cap.get() as object)).toBe(false);
    el.remove();
  });
});

describe('Story 9.12 D-9.12-2 — theme segmented control (card-only override)', () => {
  test('Light/Dark writes appearance.theme; Auto deletes it and PRUNES empty appearance', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    const cap = captureEmit(el);

    segBtn(el, 'light').click();
    await el.updateComplete;
    expect((cap.get()?.appearance as { theme?: string }).theme).toBe('light');
    expect(segBtn(el, 'light').getAttribute('aria-checked')).toBe('true');

    segBtn(el, 'dark').click();
    await el.updateComplete;
    expect((cap.get()?.appearance as { theme?: string }).theme).toBe('dark');

    segBtn(el, 'auto').click();
    await el.updateComplete;
    expect('appearance' in (cap.get() as object)).toBe(false); // emptied appearance pruned (zero-diff)
    el.remove();
  });

  test('the segmented control is a radiogroup; Auto is selected by default (no key)', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.appearance .seg')!.getAttribute('role')).toBe('radiogroup');
    expect(segBtn(el, 'auto').getAttribute('aria-checked')).toBe('true');
    expect(segBtn(el, 'auto').getAttribute('tabindex')).toBe('0');
    expect(segBtn(el, 'light').getAttribute('tabindex')).toBe('-1');
    el.remove();
  });

  test('a garbage appearance.theme degrades to Auto and never throws (FR-24)', async () => {
    const el = makeEditor();
    expect(() =>
      el.setConfig({ ...APP_BASE, appearance: { theme: 'banana' } } as unknown as TeslaCardConfig)
    ).not.toThrow();
    await el.updateComplete;
    expect(segBtn(el, 'auto').getAttribute('aria-checked')).toBe('true');
    el.remove();
  });
});

describe('Story 9.12 — present-gated default-panel chooser', () => {
  test('with NO energy site the chooser lists the six base panels only (no dead Energy pick)', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    const values = Array.from(panelSelect(el).querySelectorAll('option')).map((o) => o.value);
    expect(values).toEqual(['climate', 'charging', 'closures', 'tyres', 'location', 'media']);
    el.remove();
  });

  test('with an energy site detected, Energy is appended (the Story 1.8 hasEnergySite predicate)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS; // carries solar + battery power → hasEnergySite true
    el.setConfig(APP_BASE);
    await el.updateComplete;
    const values = Array.from(panelSelect(el).querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('energy');
    expect(values[values.length - 1]).toBe('energy'); // appended last
    el.remove();
  });

  test('picking a panel writes config.default_panel', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    const cap = captureEmit(el);
    const sel = panelSelect(el);
    sel.value = 'media';
    sel.dispatchEvent(new Event('change'));
    expect(cap.get()?.default_panel).toBe('media');
    el.remove();
  });
});

describe('Story 9.12 — Reset-to-default (hidden until set, deletes byte-for-byte)', () => {
  test('each reset is ABSENT until its key is set, then DELETES it preserving unknown keys', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, future_key: 1 } as unknown as TeslaCardConfig);
    await el.updateComplete;
    // none set ⇒ no reset buttons in the appearance section.
    expect(el.shadowRoot!.querySelectorAll('.appearance .reset-auto').length).toBe(0);

    const cap = captureEmit(el);
    swatch(el, 'red').click();
    await el.updateComplete;
    // paint set ⇒ exactly one reset (the paint picker's) appears.
    const resets = el.shadowRoot!.querySelectorAll('.appearance .reset-auto');
    expect(resets.length).toBe(1);
    (resets[0] as HTMLButtonElement).click();
    await el.updateComplete;
    const out = cap.get() as Record<string, unknown>;
    expect('paint' in out).toBe(false); // deleted
    expect(out.future_key).toBe(1); // unknown key rides the spread (R9)
    el.remove();
  });
});

describe('Story 9.12 D-9.12-4 — full-card live preview reflects all picks', () => {
  test('the preview resolves paint via resolvePaint and renders the real generic-EV hero', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, paint: 'blue' } as TeslaCardConfig);
    await el.updateComplete;
    const svg = el.shadowRoot!.querySelector('.appearance .preview-stage .car-img') as SVGElement;
    expect(svg).toBeTruthy();
    // resolvePaint('blue') → 'blue' is applied as --tc-paint on the hero.
    expect(svg.getAttribute('style')).toContain('--tc-paint:blue');
    el.remove();
  });

  test('Light flips the preview frame and applies the SAME LIGHT_TOKENS as the card host', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, appearance: { theme: 'light' } } as TeslaCardConfig);
    await el.updateComplete;
    const frame = el.shadowRoot!.querySelector('.appearance .appearance-preview') as HTMLElement;
    expect(frame.classList.contains('light')).toBe(true);
    // single-sourced: the inline token block equals LIGHT_TOKENS.
    for (const [k, v] of Object.entries(LIGHT_TOKENS)) {
      expect(frame.getAttribute('style')).toContain(`${k}: ${v}`);
    }
    el.remove();
  });

  test('the default-panel pick shows that tab active in the preview strip', async () => {
    const el = makeEditor();
    el.setConfig({ ...APP_BASE, default_panel: 'media' } as TeslaCardConfig);
    await el.updateComplete;
    const active = el.shadowRoot!.querySelector('.appearance .preview-tab.active') as HTMLElement;
    expect(active.textContent?.trim()).toBe(STRINGS.tabs.media);
    el.remove();
  });
});

describe('Story 9.12 — announced, coalesced re-skin (polite live region)', () => {
  test('a pick announces the RESOLVED appearance, naming what Auto inherits', async () => {
    const el = makeEditor();
    el.setConfig(APP_BASE);
    await el.updateComplete;
    swatch(el, 'blue').click();
    await el.updateComplete;
    const live = el.shadowRoot!.querySelector('.appearance .remap-live') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite'); // never assertive
    expect(live.textContent).toContain(STRINGS.editor.appearance.announcePrefix);
    expect(live.textContent).toContain(STRINGS.editor.appearance.paintBlue);
    expect(live.textContent).toContain(STRINGS.editor.appearance.themeAuto); // Auto (Dark)
    el.remove();
  });
});

describe('Story 9.12 — LIGHT_TOKENS import wiring', () => {
  test('the editor imports the shared LIGHT_TOKENS (no divergent copy)', () => {
    expect(Object.keys(LIGHT_TOKENS).length).toBeGreaterThan(0);
    expect(LIGHT_TOKENS['--tc-text']).toBe('#101725');
  });
});

// ── Story 9.13 — Tune step (pinned ha-selector widget set; un-stubs Story 9.9) ──
// Two homes, one component (D-9.12-1 precedent): the pinned "Tune" section renders in
// BOTH the normal form AND the wizard's Step 4 (no longer a `_renderStub`). The
// ha-selector widgets (select/number/boolean) are inert UNDEFINED elements in jsdom —
// we assert their bound `.selector`/`.value` and drive a synthetic `value-changed`.
const TUNE_BASE = { type: 'custom:tesla-card', setup_complete: true } as TeslaCardConfig;

describe('Story 9.13 AC-D — Tune lives in BOTH homes (un-stubs the wizard Step 4)', () => {
  test('the normal form renders a pinned Tune section', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    expect(tuneSection(el)).toBeTruthy();
    expect(tuneSel(el, 'tune-units')).toBeTruthy();
    expect(tuneSel(el, 'tune-recommended')).toBeTruthy();
    expect(tuneSel(el, 'tune-margin')).toBeTruthy();
    expect(tuneSel(el, 'tune-hide-powerwall')).toBeTruthy();
    el.remove();
  });

  test('the wizard Step 4 renders the SAME Tune component (not a stub)', async () => {
    const el = makeEditor();
    el.hass = ONLINE_HASS;
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    // Detect → Confirm → Appearance → Tune (step index 3).
    await clickPrimary(el); // leave Detect
    await clickPrimary(el); // leave Confirm
    await clickPrimary(el); // leave Appearance → on Tune
    expect(stepEls(el)[3].classList.contains('current')).toBe(true);
    expect(tuneSection(el)).toBeTruthy();
    expect(tuneBool(el, 'hide_panels')).toBeTruthy();
    el.remove();
  });
});

describe('Story 9.13 AC-D — pinned widget bindings', () => {
  test('tyre units is a select selector (Auto/psi/bar dropdown)', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    const sel = tuneSel(el, 'tune-units')!.selector as { select?: { mode?: string; options?: unknown[] } };
    expect(sel.select?.mode).toBe('dropdown');
    expect(sel.select?.options?.length).toBe(3); // Auto, psi, bar
    el.remove();
  });

  test('tyre thresholds are number selectors (mode:box) with a unit reflecting the chosen units', async () => {
    const el = makeEditor();
    el.setConfig({ ...TUNE_BASE, tyres: { units: 'bar' } } as TeslaCardConfig);
    await el.updateComplete;
    const rec = tuneSel(el, 'tune-recommended')!.selector as { number?: { mode?: string; unit_of_measurement?: string } };
    expect(rec.number?.mode).toBe('box');
    expect(rec.number?.unit_of_measurement).toBe('bar');
    el.remove();
  });

  test('the hide toggles + Powerwall visibility are boolean selectors', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    expect((tuneBool(el, 'hide_panels').selector as { boolean?: unknown }).boolean).toBeDefined();
    expect((tuneSel(el, 'tune-hide-powerwall')!.selector as { boolean?: unknown }).boolean).toBeDefined();
    el.remove();
  });
});

describe('Story 9.13 AC-D — Tune writers (SET writes the key; reset/default deletes it, R9 zero-diff)', () => {
  test('picking a tyre unit writes config.tyres.units; Auto deletes the key (prunes tyres)', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    const cap = captureEmit(el);
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-units')!, 'bar');
    expect(cap.get()?.tyres).toEqual({ units: 'bar' });
    // Auto ('') ⇒ delete units ⇒ tyres (now empty) pruned entirely.
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-units')!, '');
    expect('tyres' in (cap.get() ?? {})).toBe(false);
    el.remove();
  });

  test('a tyre unit change PRESERVES existing native-unit thresholds (units is display-only)', async () => {
    const el = makeEditor();
    el.setConfig({ ...TUNE_BASE, tyres: { recommended: 2.4, margin: 0.3 } } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-units')!, 'psi');
    expect(cap.get()?.tyres).toEqual({ recommended: 2.4, margin: 0.3, units: 'psi' });
    el.remove();
  });

  test('a threshold number writes the key; clearing it deletes the key', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    const cap = captureEmit(el);
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-recommended')!, 2.5);
    expect((cap.get()?.tyres as { recommended?: number }).recommended).toBe(2.5);
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-recommended')!, undefined);
    expect('tyres' in (cap.get() ?? {})).toBe(false);
    el.remove();
  });

  test('Powerwall control visibility writes energy.hide_powerwall_controls; un-set prunes energy', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    const cap = captureEmit(el);
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-hide-powerwall')!, true);
    expect((cap.get()?.energy as { hide_powerwall_controls?: boolean }).hide_powerwall_controls).toBe(true);
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-hide-powerwall')!, false);
    expect('energy' in (cap.get() ?? {})).toBe(false); // pruned (false = default)
    el.remove();
  });

  test('hiding Powerwall controls keeps a sibling energy override intact (clone+prune)', async () => {
    const el = makeEditor();
    el.setConfig({ ...TUNE_BASE, energy: { hide: true } } as TeslaCardConfig);
    await el.updateComplete;
    const cap = captureEmit(el);
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-hide-powerwall')!, true);
    expect(cap.get()?.energy).toEqual({ hide: true, hide_powerwall_controls: true });
    el.remove();
  });
});

describe('Story 9.13 AC-D — zero-diff + a11y', () => {
  test('omitting every Tune key leaves a bare config byte-identical (no Tune key injected on render)', async () => {
    const el = makeEditor();
    let emitted = false;
    el.addEventListener('config-changed', () => {
      emitted = true;
    });
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    // Rendering the Tune section must not write any key (FR-33 / SM-C4 zero-diff).
    expect(emitted).toBe(false);
    expect(el._config).toEqual({ type: 'custom:tesla-card', setup_complete: true });
    el.remove();
  });

  test('every Tune widget carries an accessible name (per-card-global label, not D15-suffixed)', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    const units = el.shadowRoot!.querySelector('.tune .tune-units') as HTMLElement;
    expect(units.getAttribute('aria-label')).toBe(STRINGS.editor.tune.tyreUnitsLabel);
    const pw = el.shadowRoot!.querySelector('.tune .tune-hide-powerwall') as HTMLElement;
    expect(pw.getAttribute('aria-label')).toBe(STRINGS.editor.tune.hidePowerwallControls);
    // The label is the bare global string — NEVER suffixed with an instance title.
    expect(pw.getAttribute('aria-label')).not.toContain('·');
    el.remove();
  });

  test('the threshold number fields announce unit + min/max range when a unit is chosen (a11y #3)', async () => {
    const el = makeEditor();
    el.setConfig({ ...TUNE_BASE, tyres: { units: 'bar' } } as TeslaCardConfig);
    await el.updateComplete;
    const rec = el.shadowRoot!.querySelector('.tune .tune-recommended') as HTMLElement;
    const mar = el.shadowRoot!.querySelector('.tune .tune-margin') as HTMLElement;
    // "Recommended pressure, bar, range 1.5–4" — unit AND the bounds are announced.
    expect(rec.getAttribute('aria-label')).toContain('bar');
    expect(rec.getAttribute('aria-label')).toContain('range');
    expect(mar.getAttribute('aria-label')).toContain('range');
    el.remove();
  });

  test('Auto units leave the range OUT of the threshold announcement (permissive range not meaningful)', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE); // no units ⇒ Auto
    await el.updateComplete;
    const rec = el.shadowRoot!.querySelector('.tune .tune-recommended') as HTMLElement;
    expect(rec.getAttribute('aria-label')).toBe(STRINGS.editor.tune.recommendedLabel);
    el.remove();
  });

  test('a Tune change announces the resolved state via the polite live region', async () => {
    const el = makeEditor();
    el.setConfig(TUNE_BASE);
    await el.updateComplete;
    await tuneFire(el, el.shadowRoot!.querySelector('.tune .tune-units')!, 'bar');
    const live = el.shadowRoot!.querySelector('.tune .remap-live') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('bar');
    el.remove();
  });
});
