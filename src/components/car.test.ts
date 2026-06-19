// @vitest-environment jsdom
//
// Render-mode priority + 1024×687 coordinate-contract gate (Story 3.1, AC2/AC3).
//
// carView() is the single render selector. The big doc-comment in car.ts states
// the priority (body → image → bundled EV); this proves it dynamically by
// rendering each branch into the DOM and asserting on what shipped. It also locks
// the AC3 contract: every SVG render anchors to HERO_VIEWBOX (1024×687), and the
// intrinsic-480 bundled EV is fitted within it (nested viewBox + meet), never
// stretched. jsdom opt-in like the other element tests; Lit `render` drives the
// pure render function with no custom element needed.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'lit';
import { carView } from './car';
import { HERO_VIEWBOX } from '../const';
import type { BodyLayers, ApertureState } from '../types';

/** Build a full ApertureState (all-closed) overriding only the named apertures. */
const AP = (o: Partial<ApertureState> = {}): ApertureState => ({
  frunk: false,
  liftgate: false,
  door: false,
  window: false,
  ...o,
});

/** Render a carView() result into a detached container and return its root node. */
function mount(opts: Parameters<typeof carView>[0]): HTMLElement {
  const container = document.createElement('div');
  render(carView(opts), container);
  return container;
}

const BODY: BodyLayers = {
  color: '/local/tesla-card/color.webp',
  shade: '/local/tesla-card/shade.webp',
  highlight: '/local/tesla-card/highlight.webp',
  mask: '/local/tesla-card/paintmask.png',
};

describe('AC2 — render-mode priority: body → image → bundled EV', () => {
  test('(a) body present → recolorable SVG body-layers render (paint mask present)', () => {
    const root = mount({ body: BODY, paint: '#23519e', name: 'Model Y' });
    const svg = root.querySelector('svg.tc-car');
    expect(svg).toBeTruthy();
    // The recolor stack's paint mask is the body-layers signature.
    expect(svg!.querySelector('mask#tc-paintmask')).toBeTruthy();
    // Not the bundled EV, and not the flat <img>.
    expect(svg!.classList.contains('tc-ev')).toBe(false);
    expect(root.querySelector('img')).toBeNull();
  });

  test('(a) body wins even when an image is also supplied (priority, not fallthrough)', () => {
    const root = mount({ body: BODY, image: '/local/car.png', name: 'Model Y' });
    expect(root.querySelector('svg.tc-car mask#tc-paintmask')).toBeTruthy();
    expect(root.querySelector('img')).toBeNull();
  });

  test('(b) no body, image present → flat <img src>', () => {
    const root = mount({ image: '/local/car.png', name: 'Model Y' });
    const img = root.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('/local/car.png');
    // No SVG render in image mode.
    expect(root.querySelector('svg')).toBeNull();
  });

  test('(c) neither → bundled generic EV (.tc-ev), no /local image requested', () => {
    const root = mount({ name: 'Vehicle' });
    const svg = root.querySelector('svg.tc-ev');
    expect(svg).toBeTruthy();
    // Zero-config never-404: the bundled fallback ships no <img> / /local asset.
    expect(root.querySelector('img')).toBeNull();
  });
});

describe('AC3 — the 1024×687 coordinate contract', () => {
  test('body-layers viewBox defaults to the HERO_VIEWBOX contract', () => {
    const root = mount({ body: BODY });
    const svg = root.querySelector('svg.tc-car')!;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`);
    expect(HERO_VIEWBOX).toEqual({ width: 1024, height: 687 });
  });

  test('BodyLayers width/height overrides still drive the viewBox', () => {
    const root = mount({ body: { ...BODY, width: 1600, height: 900 } });
    expect(root.querySelector('svg.tc-car')!.getAttribute('viewBox')).toBe('0 0 1600 900');
  });

  test('bundled EV adopts the contract viewBox and fits its intrinsic 1024×480 art undistorted', () => {
    const root = mount({});
    const outer = root.querySelector('svg.tc-ev')!;
    // Outer SVG is the shared 1024×687 contract.
    expect(outer.getAttribute('viewBox')).toBe(`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`);
    // Inner SVG keeps the hand-tuned 1024×480 art, centred + aspect-preserved (meet).
    const inner = outer.querySelector('svg');
    expect(inner).toBeTruthy();
    expect(inner!.getAttribute('viewBox')).toBe('0 0 1024 480');
    expect(inner!.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });
});

describe('Story 3.4 — charge-state class hook on the SVG renders', () => {
  test('charge:"charging" adds the .charging class to both body and bundled-EV SVGs', () => {
    expect(mount({ body: BODY, charge: 'charging' }).querySelector('svg.tc-car')!
      .classList.contains('charging')).toBe(true);
    expect(mount({ charge: 'charging' }).querySelector('svg.tc-ev')!
      .classList.contains('charging')).toBe(true);
  });

  test('charge:"plugged" adds the .plugged class (the blue, no-halo state hook)', () => {
    expect(mount({ body: BODY, charge: 'plugged' }).querySelector('svg.tc-car')!
      .classList.contains('plugged')).toBe(true);
    const ev = mount({ charge: 'plugged' }).querySelector('svg.tc-ev')!;
    expect(ev.classList.contains('plugged')).toBe(true);
    // Plugged is NOT charging — never gets the pulsing-halo hook.
    expect(ev.classList.contains('charging')).toBe(false);
  });

  test('charge:"parked" (default) leaves the SVG unanimated (no charge class)', () => {
    expect(mount({ body: BODY }).querySelector('svg.tc-car')!
      .classList.contains('charging')).toBe(false);
    const ev = mount({ charge: 'parked' }).querySelector('svg.tc-ev')!;
    expect(ev.classList.contains('charging')).toBe(false);
    expect(ev.classList.contains('plugged')).toBe(false);
  });
});

// AC1/AC2 — the net-new charge-port glow + cable on the bundled EV. The element
// renders for BOTH plugged and charging (charging ⇒ plugged, AC2), and is absent
// when parked. jsdom can't measure the glow's pixels/colour (that's e2e) — assert
// the .tc-port node presence + structure (glow + core + cable) against the DOM.
describe('AC1/AC2 — charge-port glow + cable (bundled EV)', () => {
  test('charging → .tc-port present with glow, core and cable nodes', () => {
    const ev = mount({ charge: 'charging' }).querySelector('svg.tc-ev')!;
    const port = ev.querySelector('.tc-port');
    expect(port).toBeTruthy();
    expect(port!.querySelector('.tc-port-glow')).toBeTruthy();
    expect(port!.querySelector('.tc-port-core')).toBeTruthy();
    expect(port!.querySelector('.tc-port-cable')).toBeTruthy();
  });

  test('plugged → .tc-port present too (charging ⇒ plugged: green is a superset of blue)', () => {
    expect(mount({ charge: 'plugged' }).querySelector('svg.tc-ev .tc-port')).toBeTruthy();
  });

  test('parked → NO .tc-port (neither glow nor cable)', () => {
    expect(mount({ charge: 'parked' }).querySelector('svg.tc-ev .tc-port')).toBeNull();
    // Default opts (no charge) is parked too.
    expect(mount({}).querySelector('svg.tc-ev .tc-port')).toBeNull();
  });

  test('the port nodes carry NO inline colour hex — colour is driven by the CSS state hook', () => {
    // The fallback-value gate forbids bare hex in src; the recolor must live in
    // carStyles' .tc-car.<state> rules, not on the SVG nodes.
    const port = mount({ charge: 'charging' }).querySelector('svg.tc-ev .tc-port')!;
    expect(port.outerHTML).not.toMatch(/fill="#|stroke="#/);
  });
});

describe('accessibility — every render mode carries an honest label (inherited DoD)', () => {
  test('body + bundled SVGs are role="img" with aria-label = name; image carries alt = name', () => {
    const bodySvg = mount({ body: BODY, name: 'Model Y' }).querySelector('svg.tc-car')!;
    expect(bodySvg.getAttribute('role')).toBe('img');
    expect(bodySvg.getAttribute('aria-label')).toBe('Model Y');

    const evSvg = mount({ name: 'Model Y' }).querySelector('svg.tc-ev')!;
    expect(evSvg.getAttribute('role')).toBe('img');
    expect(evSvg.getAttribute('aria-label')).toBe('Model Y');

    const img = mount({ image: '/local/car.png', name: 'Model Y' }).querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('Model Y');
  });

  test('name defaults to "Vehicle" when omitted (never an empty label)', () => {
    expect(mount({}).querySelector('svg.tc-ev')!.getAttribute('aria-label')).toBe('Vehicle');
  });
});

describe('paint plumbing — applied to both SVG render paths', () => {
  test('paint flows to --tc-paint on body and bundled renders; image mode ignores it', () => {
    expect(mount({ body: BODY, paint: '#23519e' }).querySelector('svg')!
      .getAttribute('style')).toContain('--tc-paint:#23519e');
    expect(mount({ paint: '#23519e' }).querySelector('svg.tc-ev')!
      .getAttribute('style')).toContain('--tc-paint:#23519e');
    // Flat <img> path carries no paint var.
    const img = mount({ image: '/local/car.png', paint: '#23519e' }).querySelector('img')!;
    expect(img.getAttribute('style')).toBeNull();
  });

  // AC2 final link in the degradation chain: resolvePaint → undefined (nothing
  // resolved, no source.default) → carView's `paint ?? DEFAULT_PAINT` supplies
  // the neutral silver. Render with NO paint and assert the silver reaches
  // --tc-paint on both recolorable renders (body + bundled EV).
  test('no paint → neutral silver #c6c8c9 reaches --tc-paint on both SVG renders', () => {
    expect(mount({ body: BODY }).querySelector('svg.tc-car')!
      .getAttribute('style')).toContain('--tc-paint:#c6c8c9');
    expect(mount({}).querySelector('svg.tc-ev')!
      .getAttribute('style')).toContain('--tc-paint:#c6c8c9');
  });
});

// Story 3.5 — aperture open-state overlays. jsdom can't measure the crossfade
// pixels (that's e2e) — assert the .ap-<name> node PRESENCE (always in the DOM so
// the crossfade has both endpoints), the .tc-car.<aperture>-open class hooks, the
// neutral-silver/no-paint contract (AC2), and the state-bearing aria-label.
const AP_NAMES = ['frunk', 'liftgate', 'door', 'window'] as const;

describe('Story 3.5 AC1 — overlays always present (crossfade endpoints)', () => {
  test('all four .ap-<name> overlays render on the bundled EV even when all closed', () => {
    const ev = mount({}).querySelector('svg.tc-ev')!;
    for (const n of AP_NAMES) expect(ev.querySelector(`.ap-${n}`), n).toBeTruthy();
    // …and they are the .ap class the crossfade rule targets.
    expect(ev.querySelectorAll('.ap').length).toBe(4);
  });

  test('opening an aperture does NOT add/remove the node — it stays present (fade, not cut)', () => {
    const closed = mount({}).querySelector('svg.tc-ev .ap-frunk');
    const open = mount({ apertures: AP({ frunk: true }) }).querySelector('svg.tc-ev .ap-frunk');
    expect(closed).toBeTruthy();
    expect(open).toBeTruthy();
  });

  test('body-layers mode renders <image class="ap"> slots ONLY when an asset is supplied (graceful)', () => {
    // No apertureLayers → no overlay nodes in body mode.
    const none = mount({ body: BODY }).querySelector('svg.tc-car')!;
    expect(none.querySelectorAll('.ap').length).toBe(0);
    // Supply frunk + door assets → exactly those two <image> slots, the other two absent.
    const some = mount({
      body: { ...BODY, apertureLayers: { frunk: '/local/a-frunk.webp', door: '/local/a-door.webp' } },
    }).querySelector('svg.tc-car')!;
    const frunk = some.querySelector('.ap-frunk');
    expect(frunk).toBeTruthy();
    expect(frunk!.tagName.toLowerCase()).toBe('image'); // photoreal overlay is an <image> layer
    expect(some.querySelector('.ap-door')).toBeTruthy();
    expect(some.querySelector('.ap-liftgate')).toBeNull();
    expect(some.querySelector('.ap-window')).toBeNull();
  });
});

describe('Story 3.5 AC1 — independent .tc-car.<aperture>-open class hooks', () => {
  const evClass = (ap: ApertureState): DOMTokenList =>
    mount({ apertures: ap }).querySelector('svg.tc-ev')!.classList;

  test('each aperture toggles its OWN class, never a shared/combined token', () => {
    expect(evClass(AP({ frunk: true })).contains('frunk-open')).toBe(true);
    expect(evClass(AP({ liftgate: true })).contains('liftgate-open')).toBe(true);
    expect(evClass(AP({ door: true })).contains('door-open')).toBe(true);
    expect(evClass(AP({ window: true })).contains('window-open')).toBe(true);
  });

  test('independence: frunk+door+window open at once → three classes, liftgate absent', () => {
    const cls = evClass(AP({ frunk: true, door: true, window: true }));
    expect(cls.contains('frunk-open')).toBe(true);
    expect(cls.contains('door-open')).toBe(true);
    expect(cls.contains('window-open')).toBe(true);
    expect(cls.contains('liftgate-open')).toBe(false);
  });

  test('all closed (default) → no aperture-open class', () => {
    const cls = mount({}).querySelector('svg.tc-ev')!.classList;
    for (const n of AP_NAMES) expect(cls.contains(`${n}-open`)).toBe(false);
  });

  test('the body-layers render carries the same class hooks', () => {
    const cls = mount({ body: BODY, apertures: AP({ frunk: true, window: true }) })
      .querySelector('svg.tc-car')!.classList;
    expect(cls.contains('frunk-open')).toBe(true);
    expect(cls.contains('window-open')).toBe(true);
    expect(cls.contains('door-open')).toBe(false);
  });
});

describe('Story 3.5 AC2 — opened panel is neutral silver, never paint-tinted', () => {
  test('the opened panel skin is the literal neutral silver #c6c8c9', () => {
    // frunk/liftgate/door carry a silver skin; window is cavity-only (dark cabin).
    const ev = mount({ apertures: AP({ frunk: true, liftgate: true, door: true }) })
      .querySelector('svg.tc-ev')!;
    for (const n of ['frunk', 'liftgate', 'door'] as const) {
      expect(ev.querySelector(`.ap-${n}`)!.outerHTML, n).toContain('#c6c8c9');
    }
  });

  test('NO overlay element references var(--tc-paint) — recolor of exposed paint is v2', () => {
    const ev = mount({ apertures: AP({ frunk: true, liftgate: true, door: true, window: true }) })
      .querySelector('svg.tc-ev')!;
    for (const n of AP_NAMES) {
      expect(ev.querySelector(`.ap-${n}`)!.outerHTML, n).not.toContain('--tc-paint');
    }
  });
});

describe('Story 3.5 a11y — state-bearing aria-label (open apertures read as words)', () => {
  test('open apertures append to the label ("Model Y · open: frunk, door")', () => {
    const svg = mount({ name: 'Model Y', apertures: AP({ frunk: true, door: true }) })
      .querySelector('svg.tc-ev')!;
    const label = svg.getAttribute('aria-label')!;
    expect(label).toContain('Model Y');
    expect(label).toContain('open');
    expect(label).toContain('frunk');
    expect(label).toContain('door');
  });

  test('all closed → the plain name (the hero never announces "all closed")', () => {
    expect(mount({ name: 'Model Y' }).querySelector('svg.tc-ev')!.getAttribute('aria-label')).toBe(
      'Model Y'
    );
  });

  test('the body + image render modes carry the same state-bearing label', () => {
    const body = mount({ body: BODY, name: 'Model Y', apertures: AP({ liftgate: true }) })
      .querySelector('svg.tc-car')!;
    expect(body.getAttribute('aria-label')).toContain('liftgate');
    const img = mount({ image: '/local/car.png', name: 'Model Y', apertures: AP({ window: true }) })
      .querySelector('img')!;
    expect(img.getAttribute('alt')).toContain('window');
  });
});

// Story 3.6 AC2 — the body-mode charge overlay fulfils the Story 3.4 deferral: the
// .tc-port node now renders in the BODY <svg> too (not only the bundled EV), via
// the shared chargePortOverlay() helper, anchored at body.chargePort (or the
// contract default). jsdom can't measure the glow colour (that's e2e) — assert the
// node presence, the class hook, the anchor coords, and that the recolor stack is
// unchanged (no 3.2 regression).
describe('Story 3.6 AC2 — body-mode charge overlay', () => {
  test('charging → .tc-port renders inside the body <svg> with glow/core/cable', () => {
    const svg = mount({ body: BODY, charge: 'charging' }).querySelector('svg.tc-car')!;
    const port = svg.querySelector('.tc-port');
    expect(port).toBeTruthy();
    expect(port!.querySelector('.tc-port-glow')).toBeTruthy();
    expect(port!.querySelector('.tc-port-core')).toBeTruthy();
    expect(port!.querySelector('.tc-port-cable')).toBeTruthy();
    // The body <svg> carries the .charging halo hook (mode-agnostic carStyles).
    expect(svg.classList.contains('charging')).toBe(true);
  });

  test('plugged → .tc-port present in body mode too (charging ⇒ plugged)', () => {
    expect(mount({ body: BODY, charge: 'plugged' }).querySelector('svg.tc-car .tc-port')).toBeTruthy();
  });

  test('parked (default) → NO .tc-port in body mode', () => {
    expect(mount({ body: BODY, charge: 'parked' }).querySelector('svg.tc-car .tc-port')).toBeNull();
    expect(mount({ body: BODY }).querySelector('svg.tc-car .tc-port')).toBeNull();
  });

  test('port anchors at body.chargePort when supplied, the contract default when omitted', () => {
    // Supplied override → glow centred at that coordinate.
    const glow = mount({ body: { ...BODY, chargePort: { x: 333, y: 222 } }, charge: 'charging' })
      .querySelector('svg.tc-car .tc-port-glow')!;
    expect(glow.getAttribute('cx')).toBe('333');
    expect(glow.getAttribute('cy')).toBe('222');
    // Omitted → the DEFAULT_BODY_CHARGE_PORT (rear-left quarter in 1024×687 space).
    const dft = mount({ body: BODY, charge: 'charging' }).querySelector('svg.tc-car .tc-port-glow')!;
    expect(dft.getAttribute('cx')).toBe('180');
    expect(dft.getAttribute('cy')).toBe('470');
  });

  test('port nodes carry NO inline colour hex (colour driven by the CSS state hook)', () => {
    const port = mount({ body: BODY, charge: 'charging' }).querySelector('svg.tc-car .tc-port')!;
    expect(port.outerHTML).not.toMatch(/fill="#|stroke="#/);
  });

  test('the recolor stack is unchanged when the charge overlay is present (no 3.2 regression)', () => {
    const svg = mount({ body: BODY, paint: '#23519e', charge: 'charging' }).querySelector('svg.tc-car')!;
    // Paint mask + --tc-paint + the masked recolor group all still present.
    expect(svg.querySelector('mask#tc-paintmask')).toBeTruthy();
    expect(svg.getAttribute('style')).toContain('--tc-paint:#23519e');
    expect(svg.querySelector('g[mask="url(#tc-paintmask)"]')).toBeTruthy();
  });

  // The generic-EV port is byte-identical after the helper extraction (the shared
  // chargePortOverlay reproduces Story 3.4's (900,300) node exactly).
  test('the generic-EV port still anchors at (900, 300) after the helper extraction', () => {
    const glow = mount({ charge: 'charging' }).querySelector('svg.tc-ev .tc-port-glow')!;
    expect(glow.getAttribute('cx')).toBe('900');
    expect(glow.getAttribute('cy')).toBe('300');
  });
});

// Story 3.6 AC3 — a body missing a REQUIRED named layer (color/shade/mask) must
// fall THROUGH the render-mode priority (body → image → bundled EV) — never a
// crash, a broken <image href=undefined>, or a blank recolor stack — and emit ONE
// honest log.warn naming the missing layer. A fully-absent body (zero-config) and
// missing OPTIONAL nodes stay quiet and graceful.
describe('Story 3.6 AC3 — non-conforming body degrades gracefully', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  // Each row drops/blanks exactly one required layer → non-conforming.
  const missing: Array<[string, BodyLayers]> = [
    ['color undefined', { ...BODY, color: undefined } as unknown as BodyLayers],
    ['shade empty string', { ...BODY, shade: '' }],
    ['mask undefined', { ...BODY, mask: undefined } as unknown as BodyLayers],
  ];

  for (const [name, body] of missing) {
    test(`${name} → falls through to the bundled EV, no recolor stack, no broken <image>`, () => {
      const root = mount({ body });
      // No body recolor render: no paint mask, no SVG <image> with an empty href.
      expect(root.querySelector('mask#tc-paintmask')).toBeNull();
      for (const img of Array.from(root.querySelectorAll('image'))) {
        const href = img.getAttribute('href');
        expect(href === null || href === '' || href === 'undefined').toBe(false);
      }
      // With no flat image supplied it lands on the bundled generic EV.
      expect(root.querySelector('svg.tc-ev')).toBeTruthy();
    });

    test(`${name} → falls through to a flat <img> when one is supplied`, () => {
      const root = mount({ body, image: '/local/car.png' });
      expect(root.querySelector('img')!.getAttribute('src')).toBe('/local/car.png');
      expect(root.querySelector('mask#tc-paintmask')).toBeNull();
    });

    test(`${name} → emits exactly ONE log.warn naming the missing layer`, () => {
      mount({ body });
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0].join(' ');
      expect(msg).toContain('[tesla-card]');
      expect(msg).toMatch(/missing required layer/i);
      expect(msg).toContain(name.split(' ')[0]); // color / shade / mask
    });
  }

  test('a fully-absent body does NOT warn (the normal zero-config → bundled EV path)', () => {
    mount({});
    mount({ image: '/local/car.png' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('a missing OPTIONAL node still renders the body, no warn (graceful by construction)', () => {
    // highlight omitted (optional layer) — body still renders, screen layer absent.
    const root = mount({ body: { ...BODY, highlight: undefined } });
    expect(root.querySelector('svg.tc-car mask#tc-paintmask')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
    // chargePort omitted (optional node) — body still renders too.
    const root2 = mount({ body: BODY, charge: 'charging' });
    expect(root2.querySelector('svg.tc-car .tc-port')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });
});
