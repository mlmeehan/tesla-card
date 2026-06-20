// @vitest-environment jsdom
//
// Element-level gate for Story 6.1 (Shared ecosystem-card shell + cross-card
// interlink — the DAG root of Epic 6). The shell renders NO real entity itself;
// these tests drive it through a MINIMAL test-only concrete subclass
// (`tc-eco-fixture`) that composes the shell exactly as `tc-solar`/`tc-powerwall`
// will in 6.2/6.3, and pin the four ACs as regressions:
//   AC1 — the shell IS the `.surface` recipe at radius xl, carrying a source-node
//         accent as `--node-accent` and `--tc-shadow` via `.surface`.
//   AC2 — freshness discipline is inherited: a stale read keeps the last-known
//         value + renders a `.tc-stale-copy` stamp ("updated Nm ago"); an
//         absent/NaN read degrades to a calm empty body (no throw, no fabricated
//         number).
//   AC3 — cross-card interlink is shared `hass` ONLY: two instances sharing one
//         hass reflect the same state and emit no peer-directed custom event; the
//         module exposes no cross-card messaging API.
//   AC4 — presence-tolerant: a minimal/empty hass with no peers still renders the
//         surface calmly, no throw.
//
// Freshness is deterministic by injection (mirrors panel-tyres / panel-closures /
// freshness.test.ts): every fixture entity is stamped at one instant, so advancing
// the server reference (bumping one entity's last_updated) back-dates the read into
// stale/asleep — referenceNow is the max stamp. Entity ids come from const.ts
// DEFAULT_ENTITIES (never inlined); a FRESH hass clone per mount.
import { css, nothing, type TemplateResult } from 'lit';
import { mdiBatteryHigh } from '@mdi/js';
import { afterEach, describe, expect, test } from 'vitest';
import * as shellModule from './ecosystem-card';
import {
  EcosystemCard,
  ecosystemShellStyles,
  accentVar,
  type Accent,
  type ShellOpts,
} from './ecosystem-card';
import { sharedStyles, ACCENT_SEMANTICS } from '../styles';
import { statTile } from '../ui';
import { read, referenceNow } from '../data/freshness';
import { formatAgeHint } from '../ui';
import { numById } from '../data/energy';
import { STRINGS } from '../strings';
import { DEFAULT_ENTITIES } from '../const';
import awakeFx from '../fixtures/model-y-awake.json';
import type { HassEntity, HomeAssistant, TeslaCardConfig } from '../types';

const BATTERY = DEFAULT_ENTITIES.battery_level;
const ACCENT: Accent = 'green';
/** 50 min after the fixtures' single stamp instant — past the 30-min `asleep` window. */
const ADVANCED_NOW = '2026-06-15T15:31:00Z';

// ── A minimal concrete card composing the shell, exactly as 6.2/6.3 will ──────
type FixtureEl = HTMLElement & {
  hass?: HomeAssistant;
  config: TeslaCardConfig;
  updateComplete: Promise<boolean>;
};

class EcoFixture extends EcosystemCard {
  static override styles = [
    sharedStyles,
    ecosystemShellStyles,
    css`
      .v {
        font-weight: var(--tc-fw-body, 600);
      }
    `,
  ];

  override render(): TemplateResult {
    const hass = this.hass;
    const r = read(hass, BATTERY);
    // Honest stamp: only when NOT fresh, and only from a real lastUpdated — never
    // a fabricated time. (formatAgeHint returns undefined when there is no stamp.)
    const stamp = r.staleness === 'fresh' ? undefined : formatAgeHint(r.lastUpdated, referenceNow(hass));
    // NaN-safe value via numById: absent OR non-numeric → undefined → statTile
    // hides (calm empty body), never a fabricated number.
    const n = numById(hass, BATTERY);
    const content = statTile({
      icon: mdiBatteryHigh,
      label: STRINGS.hero.battery,
      value: n === undefined ? undefined : `${n}%`,
      color: accentVar(ACCENT),
    });
    return this.renderShell(
      { accent: ACCENT, label: STRINGS.hero.battery, stamp, ariaLabel: STRINGS.hero.battery },
      content
    );
  }
}
customElements.define('tc-eco-fixture', EcoFixture);

// ── fixture helpers ──────────────────────────────────────────────────────────
function awakeStates(): Record<string, HassEntity> {
  return JSON.parse(JSON.stringify(awakeFx.states)) as Record<string, HassEntity>;
}
/** Advance the HA time base: stamp one OTHER entity after the battery so
 *  referenceNow (max server stamp) sits ahead of battery's → it reads stale. */
function advanceNow(states: Record<string, HassEntity>): Record<string, HassEntity> {
  states[DEFAULT_ENTITIES.odometer].last_updated = ADVANCED_NOW;
  states[DEFAULT_ENTITIES.odometer].last_changed = ADVANCED_NOW;
  return states;
}
function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}
async function mount(
  hass: HomeAssistant | undefined,
  config: Partial<TeslaCardConfig> = {}
): Promise<FixtureEl> {
  const el = document.createElement('tc-eco-fixture') as FixtureEl;
  if (hass) el.hass = hass;
  el.config = { type: 'custom:tesla-card', ...config };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const sr = (el: FixtureEl) => el.shadowRoot!;
const surface = (el: FixtureEl) => sr(el).querySelector<HTMLElement>('.surface')!;

afterEach(() => {
  document.body.innerHTML = '';
});

// ── AC1 — the shell IS the .surface recipe at xl, carrying the source accent ──
describe('AC1 — shared shell is the .surface recipe at xl with a source-node accent', () => {
  test('the shell renders class="surface …" (it consumes the single elevation primitive)', async () => {
    const el = await mount(makeHass(awakeStates()));
    const s = surface(el);
    expect(s).not.toBeNull();
    expect(s.classList.contains('surface')).toBe(true);
    expect(s.classList.contains('eco-card')).toBe(true);
  });

  test('--node-accent is set on the surface from the given accent (var(--tc-<accent>, hex))', async () => {
    const el = await mount(makeHass(awakeStates()));
    const styleAttr = surface(el).getAttribute('style') ?? '';
    expect(styleAttr).toContain('--node-accent');
    expect(styleAttr).toContain(accentVar(ACCENT));
    // accentVar composes the fallback hex from the ACCENT_SEMANTICS contract.
    expect(accentVar('green')).toBe(`var(--tc-green, ${ACCENT_SEMANTICS.green.hex})`);
  });

  test('radius resolves to --tc-radius-xl and --tc-shadow rides via .surface (not re-declared in the shell)', () => {
    const surfaceRule = (sharedStyles as unknown as { cssText: string }).cssText.match(
      /\.surface\s*\{[^}]*\}/
    )![0];
    expect(surfaceRule).toContain('var(--tc-radius-xl, 28px)');
    expect(surfaceRule).toMatch(/box-shadow:\s*var\(--tc-shadow/);
    // The shell adds NO competing elevation recipe (radius/shadow stay .surface's).
    const shellCss = (ecosystemShellStyles as unknown as { cssText: string }).cssText;
    expect(shellCss).not.toContain('border-radius');
    expect(shellCss).not.toContain('box-shadow');
    expect(shellCss).not.toContain('180deg');
  });
});

// ── AC2 — freshness discipline is inherited, not reinvented ───────────────────
describe('AC2 — last-known + staleness stamp on stale; calm empty on absent/NaN', () => {
  test('a fresh read shows the value and NO staleness stamp', async () => {
    const el = await mount(makeHass(awakeStates()));
    // Awake battery value is present (a real number) → statTile renders it.
    expect(sr(el).querySelector('.stat')).not.toBeNull();
    expect(sr(el).querySelector('.eco-stamp')).toBeNull();
  });

  test('a stale read keeps the last-known value AND renders a .tc-stale-copy "updated …" stamp', async () => {
    const states = advanceNow(awakeStates());
    const lastKnown = states[BATTERY].state; // retained, not blanked
    const el = await mount(makeHass(states));
    // Last-known value still shown (freshness annotates, never blanks).
    expect(sr(el).querySelector('.stat .v')!.textContent).toContain(lastKnown);
    const stamp = sr(el).querySelector('.eco-stamp')!;
    expect(stamp).not.toBeNull();
    expect(stamp.classList.contains('tc-stale-copy')).toBe(true); // --tc-text-dim, not -mute
    expect(stamp.textContent).toContain(STRINGS.hero.updatedPrefix);
  });

  test('an ABSENT entity degrades to a calm empty body — no value, no stamp, no throw', async () => {
    const states = awakeStates();
    delete states[BATTERY];
    const el = await mount(makeHass(states));
    expect(surface(el)).not.toBeNull(); // surface still renders
    expect(sr(el).querySelector('.stat')).toBeNull(); // hide-when-missing → no value
    expect(sr(el).querySelector('.eco-stamp')).toBeNull(); // no fabricated stamp
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });

  test('a NON-numeric (NaN) reading hides the value rather than printing "NaN"', async () => {
    const states = awakeStates();
    states[BATTERY].state = 'unknown';
    const el = await mount(makeHass(states));
    expect(sr(el).querySelector('.stat')).toBeNull(); // numById → undefined → hidden
    expect(sr(el).textContent ?? '').not.toContain('NaN');
  });
});

// ── AC3 — cross-card interlink is shared hass ONLY (no inter-card messaging) ───
describe('AC3 — coherence is shared hass only; no inter-card messaging', () => {
  test('two instances sharing one hass reflect the same state', async () => {
    const hass = makeHass(awakeStates());
    const a = await mount(hass);
    const b = await mount(hass);
    const va = a.shadowRoot!.querySelector('.stat .v')!.textContent;
    const vb = b.shadowRoot!.querySelector('.stat .v')!.textContent;
    expect(va).toBe(vb);
  });

  test('neither instance emits a peer-directed custom event during render', async () => {
    const dispatched: Event[] = [];
    const orig = HTMLElement.prototype.dispatchEvent;
    HTMLElement.prototype.dispatchEvent = function (this: HTMLElement, ev: Event): boolean {
      dispatched.push(ev);
      return orig.call(this, ev);
    };
    try {
      const hass = makeHass(awakeStates());
      await mount(hass);
      await mount(hass);
    } finally {
      HTMLElement.prototype.dispatchEvent = orig;
    }
    // No CustomEvent (the shape a cross-card message would take) is emitted.
    expect(dispatched.filter((e) => e instanceof CustomEvent)).toEqual([]);
  });

  test('the module exposes no cross-card messaging API (no bus / emitter / singleton)', () => {
    // Runtime exports only: types (Accent/ShellOpts) are compiler-erased.
    expect(Object.keys(shellModule).sort()).toEqual([
      'EcosystemCard',
      'accentVar',
      'ecosystemShellStyles',
    ]);
    // None of the exports is a messaging primitive named like a bus/channel.
    for (const key of Object.keys(shellModule)) {
      expect(/bus|emit|subscribe|channel|broadcast|publish/i.test(key)).toBe(false);
    }
  });
});

// ── AC4 — presence-tolerant (renders standalone, no peers) ────────────────────
describe('AC4 — presence-tolerant: renders correctly on its own', () => {
  test('a fully-empty hass renders the surface calmly, no throw', async () => {
    const el = await mount(makeHass({}));
    expect(surface(el)).not.toBeNull();
    expect(sr(el).querySelector('.stat')).toBeNull(); // nothing to show → hidden
    expect(sr(el).textContent ?? '').not.toContain('NaN');
    expect(sr(el).textContent ?? '').not.toContain('undefined');
  });

  test('a missing hass entirely (cold first paint) renders the surface, no throw', async () => {
    const el = await mount(undefined);
    expect(surface(el)).not.toBeNull();
    expect(sr(el).querySelector('.stat')).toBeNull();
  });
});

// ── A RAW fixture that drives renderShell's OWN branches directly (no entity ────
//    reads). The entity-driven EcoFixture always passes label + ariaLabel, so the
//    shell's header-omission and aria-label-affordance branches are unreachable
//    through it; this minimal subclass exposes renderShell's opts so those
//    branches (the shell's own logic) get pinned.
class EcoRaw extends EcosystemCard {
  static override styles = [sharedStyles, ecosystemShellStyles];
  opts: ShellOpts = { accent: 'teal' };
  body: TemplateResult | typeof nothing = nothing;
  override render(): TemplateResult {
    return this.renderShell(this.opts, this.body);
  }
}
customElements.define('tc-eco-raw', EcoRaw);

type RawEl = EcoRaw & { updateComplete: Promise<boolean> };
async function mountRaw(
  opts: ShellOpts,
  body: TemplateResult | typeof nothing = nothing
): Promise<RawEl> {
  const el = document.createElement('tc-eco-raw') as RawEl;
  el.opts = opts;
  el.body = body;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const rawSurface = (el: RawEl) => el.shadowRoot!.querySelector<HTMLElement>('.surface')!;

// ── AC1 (extended) — the WHOLE 7-accent vocabulary resolves, not just green ────
describe('AC1 (extended) — the full source-node accent vocabulary, not just one key', () => {
  test('accentVar composes var(--tc-<accent>, <contract hex>) for EVERY ACCENT_SEMANTICS key', () => {
    const keys = Object.keys(ACCENT_SEMANTICS) as Accent[];
    expect(keys.length).toBe(7); // guards against a silent shrink of the contract
    for (const key of keys) {
      // The fallback hex is sourced from the ACCENT_SEMANTICS contract — never a
      // literal in the shell — so every accent stays a sanctioned var(--tc-*, hex).
      expect(accentVar(key)).toBe(`var(--tc-${key}, ${ACCENT_SEMANTICS[key].hex})`);
    }
  });

  test('renderShell sets --node-accent from a NON-green accent too (teal = secondary/ecosystem)', async () => {
    const el = await mountRaw({ accent: 'teal' });
    const styleAttr = rawSurface(el).getAttribute('style') ?? '';
    expect(styleAttr).toContain('--node-accent');
    expect(styleAttr).toContain(accentVar('teal'));
  });
});

// ── AC2 (extended) — the honesty colour AND the unavailable branch ─────────────
describe('AC2 (honesty) — stale-copy is the 4.5:1 trust colour, never the 3:1 mute', () => {
  test('.tc-stale-copy resolves to --tc-text-dim and NOT --tc-text-mute (the load-bearing branch)', () => {
    // The class presence is asserted in AC2 above; this pins what the class MEANS:
    // the trust-copy colour. A regression to --tc-text-mute (3:1) would overstate
    // legibility of an honest "updated Nm ago" stamp — the one unforgivable drift.
    const shared = (sharedStyles as unknown as { cssText: string }).cssText;
    const rule = shared.match(/\.tc-stale-copy\s*\{[^}]*\}/)![0];
    expect(rule).toContain('var(--tc-text-dim');
    expect(rule).not.toContain('--tc-text-mute');
  });

  test('an UNAVAILABLE reading (distinct from unknown) hides the value — no NaN, no "unavailable" leak', async () => {
    const states = awakeStates();
    states[BATTERY].state = 'unavailable';
    const el = await mount(makeHass(states));
    expect(surface(el)).not.toBeNull(); // surface still renders calmly
    expect(sr(el).querySelector('.stat')).toBeNull(); // numById → undefined → hidden
    // Scope the leak check to the rendered body (the whole shadow textContent would
    // include the <style> block, whose comments legitimately mention "unavailable").
    const bodyTxt = sr(el).querySelector('.eco-body')!.textContent ?? '';
    expect(bodyTxt).not.toContain('NaN');
    expect(bodyTxt).not.toContain('unavailable'); // the raw state never leaks as a value
  });
});

// ── renderShell branches the entity fixture can't reach (header / aria-label) ──
describe('renderShell — header-omission and aria-label affordance branches', () => {
  test('no label AND no stamp → the header is omitted entirely (surface + body only)', async () => {
    const el = await mountRaw({ accent: 'teal' });
    expect(rawSurface(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.eco-head')).toBeNull(); // hasHead === false
    expect(el.shadowRoot!.querySelector('.eco-body')).not.toBeNull(); // body always present
  });

  test('a stamp without a label → header renders the stamp (tc-stale-copy), no orphan label', async () => {
    const el = await mountRaw({ accent: 'teal', stamp: 'updated 5m ago' });
    expect(el.shadowRoot!.querySelector('.eco-head')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.label')).toBeNull();
    const stamp = el.shadowRoot!.querySelector('.eco-stamp')!;
    expect(stamp.classList.contains('tc-stale-copy')).toBe(true);
    expect(stamp.textContent).toContain('updated 5m ago');
  });

  test('ariaLabel set → aria-label on the surface; omitted → no aria-label attribute (lit nothing)', async () => {
    const withAria = await mountRaw({ accent: 'teal', ariaLabel: 'Solar' });
    expect(rawSurface(withAria).getAttribute('aria-label')).toBe('Solar');
    const noAria = await mountRaw({ accent: 'teal' });
    expect(rawSurface(noAria).hasAttribute('aria-label')).toBe(false); // not aria-label="undefined"
  });
});
