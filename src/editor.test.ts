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

    const checks = el.shadowRoot?.querySelectorAll(
      'input[type="checkbox"]'
    ) as NodeListOf<HTMLInputElement>;
    expect(checks.length).toBe(3); // quick_actions, panels, commands
    // hide_panels is the 2nd checkbox in render order; only it is true.
    expect(checks[0].checked).toBe(false); // hide_quick_actions
    expect(checks[1].checked).toBe(true); // hide_panels
    expect(checks[2].checked).toBe(false); // hide_commands
    el.remove();
  });

  test('a stub-only config ({ type }) renders without error (all optional fields absent)', async () => {
    const el = makeEditor();
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
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
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
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
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
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
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
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
    expect(() => el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig)).not.toThrow();
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
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
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
    ed.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
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
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
    await el.updateComplete;
    const options = el.shadowRoot?.querySelectorAll(
      'select option'
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
    el.setConfig({ type: 'custom:tesla-card' } as TeslaCardConfig);
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
