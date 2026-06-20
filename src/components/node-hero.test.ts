// @vitest-environment jsdom
//
// Gate for the `node-hero` render helper (Story 8.2). Pins the story ACs:
//   AC1 — each node helper returns an inline SVG with the recognizable structure
//         (Powerwall battery stack, Grid pylon, House, Wall-Connector unit).
//   AC2 — token-driven, no raster, no raw decorative hex in the art markup; every
//         colour routes through `var(--tc-*, fallback)` in `nodeHeroStyles`.
//   AC3 — `nodeHeroStyles` carries a `prefers-reduced-motion: reduce` block that
//         freezes the only motion (the WC status-dot pulse) — a hard invariant.
//   AC4 — the art is DECORATIVE (`role="img"` + a concise label) and fabricates no
//         numeric (no telemetry text — the SoC fill is a fixed decorative level).
//   AC5 — render-helper (a pure function, registers NO custom element).
import { describe, expect, test } from 'vitest';
import { render } from 'lit';
import { nodeHero, nodeHeroStyles, type NodeHeroKind } from './node-hero';
import { STRINGS } from '../strings';

const NODES: readonly NodeHeroKind[] = ['powerwall', 'grid', 'home', 'wall_connector'];

/** Render a nodeHero() result into a detached container and return the <svg> root. */
function mount(node: NodeHeroKind): SVGSVGElement {
  const container = document.createElement('div');
  render(nodeHero(node), container);
  return container.querySelector('svg.nh-art') as SVGSVGElement;
}

describe('AC1 — each node renders a recognizable inline-SVG hero', () => {
  test('every node returns a renderable TemplateResult', () => {
    for (const node of NODES) {
      const res = nodeHero(node);
      expect(res, node).toHaveProperty('_$litType$'); // Lit TemplateResult marker
    }
  });

  test('Powerwall — a battery stack: ≥2 upright unit rects + a fixed charge fill', () => {
    const svg = mount('powerwall');
    // back unit + front unit + decorative fill rect + accent edge bar.
    expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3);
    expect(svg.querySelector('.nh-face')).not.toBeNull();
    expect(svg.querySelector('.nh-face-2')).not.toBeNull();
    expect(svg.querySelector('.nh-pw-fill')).not.toBeNull();
  });

  test('Grid — a transmission pylon: splayed legs + insulator dots + live lines', () => {
    const svg = mount('grid');
    expect(svg.querySelectorAll('.nh-strut').length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll('.nh-dot').length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelectorAll('.nh-cable').length).toBeGreaterThanOrEqual(2);
  });

  test('House — roof path + body rect + two lit windows + a door', () => {
    const svg = mount('home');
    expect(svg.querySelector('path.nh-roof')).not.toBeNull();
    expect(svg.querySelector('rect.nh-house-body')).not.toBeNull();
    expect(svg.querySelectorAll('rect.nh-window').length).toBe(2);
    expect(svg.querySelector('rect.nh-door')).not.toBeNull();
  });

  test('Wall Connector — the unit rect + plug glyph + cable + connector', () => {
    const svg = mount('wall_connector');
    expect(svg.querySelector('rect.nh-wc-face')).not.toBeNull();
    expect(svg.querySelector('path.nh-glyph-teal')).not.toBeNull();
    expect(svg.querySelector('path.nh-wc-cable')).not.toBeNull();
    expect(svg.querySelector('circle.nh-wc-conn')).not.toBeNull();
  });

  test('all four node heroes share the mockup hero viewBox (0 0 300 138)', () => {
    for (const node of NODES) {
      expect(mount(node).getAttribute('viewBox'), node).toBe('0 0 300 138');
    }
  });
});

describe('AC2 — token-driven, trade-dress-clean, no raster', () => {
  test('no raw hex / raster ref leaks into the art markup (colour lives in CSS classes)', () => {
    for (const node of NODES) {
      const markup = mount(node).outerHTML;
      // No raw colour hex in any presentation attribute (var() can't live there —
      // colour is driven entirely by nodeHeroStyles classes).
      expect(markup, `${node}: raw hex in markup`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      // No raster/external image reference (hand-rolled inline SVG only).
      expect(markup, `${node}: <image> in markup`).not.toContain('<image');
      expect(markup, `${node}: href in markup`).not.toContain('href');
      expect(markup, `${node}: <use> sprite in markup`).not.toContain('<use');
    }
  });

  test('every colour in nodeHeroStyles routes through a token with a DESIGN.md fallback', () => {
    const cssText = (nodeHeroStyles as unknown as { cssText: string }).cssText;
    // Strip the sanctioned `var(--tc-*, <fallback>)` forms (hex AND rgba fallbacks);
    // any hex remaining would be a raw decorative colour — forbidden (AC2).
    const stripped = cssText.replace(/var\(\s*--tc-[a-z0-9-]+\s*,[^)]*\)/gi, '');
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Sanity: the real accent + neutral tokens are present with their fallbacks.
    expect(cssText).toContain('var(--tc-green, #34d399)');
    expect(cssText).toContain('var(--tc-teal, #2dd4bf)');
    expect(cssText).toContain('var(--tc-amber, #fbbf24)');
    expect(cssText).toContain('var(--tc-text-dim, #9aa7b8)');
    expect(cssText).toContain('var(--tc-surface-2, rgba(255, 255, 255, 0.07))');
    expect(cssText).toContain('var(--tc-border-strong, rgba(255, 255, 255, 0.16))');
  });
});

describe('AC3 — reduced-motion freezes the only motion (WC status-dot pulse)', () => {
  const cssText = (nodeHeroStyles as unknown as { cssText: string }).cssText;

  test('a prefers-reduced-motion: reduce block freezes the WC dot pulse', () => {
    expect(cssText).toContain('prefers-reduced-motion: reduce');
    const block = cssText.slice(cssText.indexOf('prefers-reduced-motion: reduce'));
    expect(block).toContain('.nh-wc-dot');
    expect(block).toContain('animation: none');
  });

  test('the WC dot still reads statically — the pulse is opacity-only (no info in motion)', () => {
    // The dot carries no information via motion: its base fill is the green token,
    // the keyframe only modulates opacity, so a frozen frame is fully legible.
    expect(cssText).toContain('@keyframes nhPulse');
    // Only ONE animated class exists (mostly-static art) — keep the freeze honest.
    const animated = [...cssText.matchAll(/animation:\s*nh/g)].length;
    expect(animated).toBe(1);
  });
});

describe('AC4 — decorative, never telemetry (honesty)', () => {
  test('each hero is role="img" with a concise node-name label (no live value)', () => {
    expect(mount('powerwall').getAttribute('role')).toBe('img');
    expect(mount('powerwall').getAttribute('aria-label')).toBe(STRINGS.energy.nodes.powerwall);
    expect(mount('grid').getAttribute('aria-label')).toBe(STRINGS.energy.nodes.grid);
    expect(mount('home').getAttribute('aria-label')).toBe(STRINGS.energy.nodes.home);
    expect(mount('wall_connector').getAttribute('aria-label')).toBe(
      STRINGS.energy.nodes.wall_connector
    );
  });

  test('no fabricated numeric — the art carries no text/telemetry at all', () => {
    for (const node of NODES) {
      const svg = mount(node);
      expect(svg.querySelector('text'), `${node}: art must carry no <text>`).toBeNull();
      expect((svg.textContent ?? '').trim(), `${node}: art must carry no readout text`).toBe('');
      // No literal "0%"/"100%" implying a missing SoC was rendered (AC4).
      expect(svg.outerHTML, `${node}: fabricated percent`).not.toMatch(/\b(0|100)%/);
    }
  });
});

describe('AC5 — render helper, registers no custom element', () => {
  test('the hero root is a plain <svg>, never a tc-* element', () => {
    const svg = mount('powerwall');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    // The module defines no node-hero custom element (it is a pure function).
    expect(customElements.get('tc-node-hero')).toBeUndefined();
    expect(customElements.get('node-hero')).toBeUndefined();
  });
});
