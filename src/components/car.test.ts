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
import { describe, expect, test } from 'vitest';
import { render } from 'lit';
import { carView } from './car';
import { HERO_VIEWBOX } from '../const';
import type { BodyLayers } from '../types';

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

describe('AC1 — charging glow class on the SVG renders (energy-glow accent)', () => {
  test('charging:true adds the .charging class to both body and bundled-EV SVGs', () => {
    expect(mount({ body: BODY, charging: true }).querySelector('svg.tc-car')!
      .classList.contains('charging')).toBe(true);
    expect(mount({ charging: true }).querySelector('svg.tc-ev')!
      .classList.contains('charging')).toBe(true);
  });

  test('charging absent/false leaves the SVG unanimated (no .charging class)', () => {
    expect(mount({ body: BODY }).querySelector('svg.tc-car')!
      .classList.contains('charging')).toBe(false);
    expect(mount({ charging: false }).querySelector('svg.tc-ev')!
      .classList.contains('charging')).toBe(false);
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
