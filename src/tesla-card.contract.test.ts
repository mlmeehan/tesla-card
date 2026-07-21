// @vitest-environment jsdom
//
// Lovelace card-contract + single-bundle registration test (Story 7.3 — FR-29).
//
// The contract pieces all already exist (this is an AUDIT-VERIFY-AND-PIN story,
// not a greenfield build); the gap was a SINGLE focused proof that exercises the
// real load path. This file imports the BUNDLE ENTRY `./tesla-card` (the sole
// Rollup `input`) and asserts the contract holds "when the bundle loads" — which
// is exactly AC3's wording — rather than importing `./components/my-home` the way
// `audit-r6-suite.test.ts` does (that proves the Scene module's import graph, not
// the bundle entry's). It also closes the two coverage gaps the scattered tests
// miss: `getCardSize` on the VEHICLE card, and the seven-elements-from-one-load
// registration topology.
//
//   • AC1 — the four Lovelace contract methods (`setConfig`, `getCardSize`,
//     `static getStubConfig`, `static async getConfigElement`) are present with
//     their stated shapes. (Deeper proofs live in tesla-card.stub.test.ts /
//     editor.test.ts / tesla-card.config.test.ts — referenced, not duplicated.)
//   • AC2 — single-bundle invariant: rollup.config.mjs has exactly one `input`
//     ending `tesla-card.ts`, one `output.file` ending `tesla-card.js`, and
//     `inlineDynamicImports: true` (the definitive proof is the one-file
//     `npm run build` gate; this guards the config from a silent split).
//   • AC3 — loading the one entry registers the seven named elements as DISTINCT
//     custom elements, each with a `window.customCards` picker entry; the editor
//     is NOT defined at load (lazy by contract) and becomes defined only after
//     `getConfigElement()` awaits its dynamic import.
//
// Hermetic: jsdom element + node:fs config read, no network, no real `hass`.
import { describe, expect, test, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeslaCardConfig } from './types';
import { STRINGS } from './strings';
// Bundle entry — the sole Rollup `input`. Importing it for side-effect is the
// real AC3 registration path (registers the vehicle card + all panels + the five
// ecosystem cards + the Scene). Do NOT import './editor' here — that would defeat
// the lazy-load assertion below.
import './tesla-card';
import { TeslaCard } from './tesla-card';

/** The seven AC3-named elements that must register from the one bundle entry. */
const AC3_TAGS = [
  'tesla-card',
  'tc-solar',
  'tc-powerwall',
  'tc-grid',
  'tc-home',
  'tc-wall-connector',
  'tc-my-home',
] as const;

// Captured once, before any test runs a `getConfigElement` — proves the editor
// is NOT registered merely by loading the bundle entry (lazy-by-contract). A
// later test can't observe this because vitest shares one registry per file and
// the AC1 getConfigElement test registers the editor first.
let editorDefinedAtBundleLoad = true;

beforeAll(() => {
  // The side-effect import upgraded the vehicle element — the load path ran.
  expect(customElements.get('tesla-card')).toBeTruthy();
  editorDefinedAtBundleLoad = !!customElements.get('tesla-card-editor');
});

describe('AC1 — the four Lovelace contract methods are present with their shapes', () => {
  test('setConfig is an instance method; throws on falsy, accepts a valid config', () => {
    expect(typeof TeslaCard.prototype.setConfig).toBe('function');
    const el = document.createElement('tesla-card') as HTMLElement & {
      setConfig(c: TeslaCardConfig): void;
    };
    // Presence is the only validation (forward-compat R9): a falsy config throws.
    expect(() => el.setConfig(undefined as unknown as TeslaCardConfig)).toThrow();
    // A valid config seats without throwing. The spread-preserve / unknown-key
    // forward-compat round-trip is pinned in tesla-card.config.test.ts (not duped).
    expect(() => el.setConfig({ type: 'custom:tesla-card' })).not.toThrow();
  });

  test('getCardSize is an instance method returning the number 16 (vehicle-card gap)', () => {
    const el = document.createElement('tesla-card') as HTMLElement & { getCardSize(): number };
    const size = el.getCardSize();
    expect(typeof size).toBe('number');
    expect(size).toBe(16);
  });

  test('getStubConfig is STATIC and returns a { type: custom:tesla-card } seed', () => {
    // HA calls this on the constructor, not an instance — it must be static.
    expect(typeof TeslaCard.getStubConfig).toBe('function');
    expect('getStubConfig' in TeslaCard.prototype).toBe(false);
    const stub = TeslaCard.getStubConfig();
    expect(stub.type).toBe('custom:tesla-card');
  });

  test('getConfigElement is STATIC async and resolves a tesla-card-editor element', async () => {
    expect(typeof TeslaCard.getConfigElement).toBe('function');
    expect('getConfigElement' in TeslaCard.prototype).toBe(false);
    const el = await TeslaCard.getConfigElement();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.localName).toBe('tesla-card-editor');
  });
});

describe('AC3 — one bundle load registers the seven elements as DISTINCT customs', () => {
  test('every AC3 tag is defined after importing the entry', () => {
    for (const tag of AC3_TAGS) {
      expect(customElements.get(tag), `${tag} should be registered`).toBeTruthy();
    }
  });

  test('the seven constructors are distinct (separate custom elements, not aliases)', () => {
    const ctors = new Set(AC3_TAGS.map((tag) => customElements.get(tag)));
    // A Set of 7 distinct constructors proves "separate custom elements".
    expect(ctors.size).toBe(AC3_TAGS.length);
    expect(ctors.has(undefined)).toBe(false);
  });

  test('each registered element is a working LovelaceCard from the one bundle load', () => {
    // AC3 / architecture.md:70–72: each of the seven is "standalone AND
    // composable" — a separate custom ELEMENT that is itself a CARD. The
    // distinct-constructor test above proves "separate"; this proves each is a
    // functioning LovelaceCard via the real bundle-entry load path (the per-card
    // *.test.ts files assert the same contract, but instantiate from their OWN
    // module import — only here is it proven for all seven from `./tesla-card`).
    // getCardSize is a config-free constant on every impl, so it's callable
    // immediately after createElement.
    for (const tag of AC3_TAGS) {
      const el = document.createElement(tag) as HTMLElement & {
        setConfig(c: TeslaCardConfig): void;
        getCardSize(): number;
      };
      expect(typeof el.setConfig, `${tag}.setConfig`).toBe('function');
      expect(typeof el.getCardSize(), `${tag}.getCardSize`).toBe('number');
      // Forward-compat contract (R9): falsy config throws, unknown keys tolerated.
      expect(() => el.setConfig(undefined as unknown as TeslaCardConfig), tag).toThrow();
    }
  });

  test('window.customCards carries a picker entry for each AC3 type', () => {
    const types = new Set((window.customCards ?? []).map((c) => c.type));
    for (const tag of AC3_TAGS) {
      expect(types.has(tag), `customCards should list ${tag}`).toBe(true);
    }
    // The vehicle entry pulls its copy from STRINGS (no inlined literals).
    const vehicle = (window.customCards ?? []).find((c) => c.type === 'tesla-card');
    expect(vehicle?.name).toBe(STRINGS.card.name);
    expect(vehicle?.description).toBe(STRINGS.card.description);
  });

  test("every getStubConfig seed carries the `custom:` type prefix (picker-clobber guard)", () => {
    // HA's card picker spreads getStubConfig() OVER the `custom:<tag>` type it
    // assigns, so any bare `type` a seed returns clobbers the prefix and the
    // picker reports "Unknown type: <tag>". A seed may omit `type` entirely
    // (HA keeps its own); but if it sets one, it MUST be `custom:`-prefixed.
    for (const tag of AC3_TAGS) {
      const ctor = customElements.get(tag) as
        | (CustomElementConstructor & { getStubConfig?: () => TeslaCardConfig })
        | undefined;
      if (typeof ctor?.getStubConfig !== 'function') continue;
      const stub = ctor.getStubConfig();
      if (stub?.type === undefined) continue;
      expect(stub.type, `${tag} getStubConfig type`).toMatch(/^custom:/);
    }
  });

  test('the editor is NOT registered on load, then IS after getConfigElement (lazy)', async () => {
    // Lazy-by-contract (NFR-1 / 7.2): loading the bundle entry must NOT register
    // the editor (captured at module load, before any getConfigElement ran).
    expect(editorDefinedAtBundleLoad).toBe(false);
    await TeslaCard.getConfigElement(); // the only path that imports './editor'
    expect(customElements.get('tesla-card-editor')).toBeTruthy();
  });
});

describe('AC2 — rollup config pins the single-bundle invariant (regression guard)', () => {
  // The DEFINITIVE AC2 proof is `npm run build` emitting exactly one file; this
  // config-shape assertion guards against a future edit (a second entry, dropping
  // inlineDynamicImports) silently splitting the bundle and breaking HACS install.
  // Read the file TEXT (not import) to avoid executing the plugin graph under jsdom.
  // Vitest runs from the package root, so the config sits at cwd/rollup.config.mjs.
  const cfg = readFileSync(join(process.cwd(), 'rollup.config.mjs'), 'utf8');

  test('exactly one input ending in tesla-card.ts', () => {
    const inputs = cfg.match(/input:\s*['"]([^'"]+)['"]/g) ?? [];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatch(/tesla-card\.ts['"]$/);
  });

  test('one output.file ending in tesla-card.js', () => {
    const files = cfg.match(/file:\s*['"]([^'"]+)['"]/g) ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/dist\/tesla-card\.js['"]$/);
  });

  test('inlineDynamicImports is true (folds the lazy editor into the one file)', () => {
    expect(cfg).toMatch(/inlineDynamicImports:\s*true/);
  });

  test('output format is ESM (the single file HACS serves as a module)', () => {
    // The bundle ships as one ES module (architecture.md:808–810). terser's own
    // `format: { comments: false }` is an object, so an `es` string value here
    // unambiguously matches the output format, not the minifier option.
    expect(cfg).toMatch(/format:\s*['"]es['"]/);
  });
});
