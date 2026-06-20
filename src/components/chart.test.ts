// @vitest-environment jsdom
//
// Structural gate for the Story 8.3 chart render-helper (components/chart.ts).
// Like weather-vignette.test.ts / car.test.ts: drives the PURE functions via Lit
// `render` and asserts on what shipped. Pins the ACs as regressions:
//   AC1 — sparkline returns an SVG with an area <path> + a line <path>; dayBars
//         returns N .bcol columns with the right heights; the accent rides via
//         var(--tc-*) (no raw decorative hex).
//   AC2 — empty/short series → the CALM empty state (a caption), never a fake
//         curve or a row of zero-height bars.
//   AC4 — any animation is gated behind a prefers-reduced-motion block.
//   AC6 — chartStyles has NO `180deg` gradient and NO raw hex; the helper
//         registers NO custom element.
import { describe, expect, test } from 'vitest';
import { render } from 'lit';
import { sparkline, dayBars, barLabels, chartStyles } from './chart';
import { STRINGS } from '../strings';
import type { HistorySeries } from '../data/history';

function mount(tpl: ReturnType<typeof sparkline>): HTMLElement {
  const container = document.createElement('div');
  render(tpl, container);
  return container;
}

const SERIES: HistorySeries = [
  { t: 1000, v: 1 },
  { t: 2000, v: 4 },
  { t: 3000, v: 2 },
  { t: 4000, v: 5 },
];

describe('AC1 — sparkline: filled area + line for a valid series', () => {
  test('renders an SVG with a .ct-area path AND a .ct-line path', () => {
    const root = mount(sparkline(SERIES, { accent: 'amber', title: 'Today', valueLabel: '5.0 kW' }));
    const svg = root.querySelector('svg.spark');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 320 92');
    expect(svg!.getAttribute('preserveAspectRatio')).toBe('none');
    expect(root.querySelector('path.ct-area')).not.toBeNull();
    expect(root.querySelector('path.ct-line')).not.toBeNull();
    // The line path has at least the 4 sample points (M + 3×L).
    const d = root.querySelector('path.ct-line')!.getAttribute('d')!;
    expect((d.match(/L/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('the accent rides in via var(--tc-*) — no raw decorative hex', () => {
    const root = mount(sparkline(SERIES, { accent: 'amber', title: 'Today' }));
    const stroke = root.querySelector('path.ct-line')!.getAttribute('stroke')!;
    expect(stroke).toContain('var(--tc-amber');
    // value label hidden when omitted
    expect(root.querySelector('.ct-v')).toBeNull();
    expect(root.querySelector('.ct-t')!.textContent).toBe('Today');
  });
});

describe('AC2 — sparkline calm empty state (never a fabricated curve)', () => {
  test('empty series → caption, no svg path', () => {
    const root = mount(sparkline([], { accent: 'amber', title: 'Today' }));
    expect(root.querySelector('svg.spark')).toBeNull();
    expect(root.querySelector('path')).toBeNull();
    expect(root.querySelector('.ct-empty')!.textContent).toBe(STRINGS.ecosystem.chartEmpty);
  });

  test('single-point series (<2 usable) → calm empty state, not a flat fake line', () => {
    const root = mount(sparkline([{ t: 1, v: 3 }], { accent: 'blue', title: 'Today' }));
    expect(root.querySelector('svg.spark')).toBeNull();
    expect(root.querySelector('.ct-empty')).not.toBeNull();
  });
});

describe('AC1/AC2 — dayBars: N columns with correct heights; empty state for []', () => {
  test('N values → N .bcol columns; heights are value/max·100%', () => {
    const root = mount(dayBars([2, 4, 1], ['Mon', 'Tue', 'Wed'], { accent: 'green', title: '7 days' }));
    const cols = root.querySelectorAll('.bcol');
    expect(cols.length).toBe(3);
    const bars = root.querySelectorAll<HTMLElement>('.bcol i');
    expect(bars[1].getAttribute('style')).toContain('height:100.0%'); // max → 100
    expect(bars[0].getAttribute('style')).toContain('height:50.0%'); // 2/4
    // the flat accent fill rides via var(--tc-*) inline — no raw hex
    expect(bars[0].getAttribute('style')).toContain('var(--tc-green');
    expect([...root.querySelectorAll('.bcol span')].map((s) => s.textContent)).toEqual([
      'Mon',
      'Tue',
      'Wed',
    ]);
  });

  test('empty values → calm empty state (no bars)', () => {
    const root = mount(dayBars([], [], { accent: 'green', title: '7 days' }));
    expect(root.querySelector('.bcol')).toBeNull();
    expect(root.querySelector('.bars')).toBeNull();
    expect(root.querySelector('.ct-empty')!.textContent).toBe(STRINGS.ecosystem.chartEmpty);
  });

  test('genuinely-fetched zeros render flat-but-real (a present series, not empty)', () => {
    const root = mount(dayBars([0, 0, 0], ['M', 'T', 'W'], { accent: 'amber', title: '7 days' }));
    expect(root.querySelectorAll('.bcol').length).toBe(3); // present, not the empty state
    expect(root.querySelector('.ct-empty')).toBeNull();
  });
});

describe('barLabels — weekday mapping (Sun-indexed, no Intl dep)', () => {
  test('maps each bucket day to its STRINGS weekday', () => {
    // 2026-06-21 is a Sunday → index 0.
    const sunday = new Date(2026, 5, 21, 12).getTime();
    const monday = new Date(2026, 5, 22, 12).getTime();
    expect(
      barLabels([{ day: sunday, value: 1 }, { day: monday, value: 2 }], STRINGS.ecosystem.weekdays)
    ).toEqual([STRINGS.ecosystem.weekdays[0], STRINGS.ecosystem.weekdays[1]]);
  });
});

describe('AC4/AC6 — chartStyles gates: reduced-motion, no 180deg, no raw hex', () => {
  const cssText = (chartStyles as unknown as { cssText: string }).cssText;

  test('any animation is gated behind a prefers-reduced-motion block', () => {
    expect(cssText).toContain('prefers-reduced-motion: reduce');
    const block = cssText.slice(cssText.indexOf('prefers-reduced-motion: reduce'));
    expect(block).toContain('animation: none');
  });

  test('NO `180deg` gradient anywhere in chartStyles (the bar-fill gate trap)', () => {
    expect(cssText).not.toContain('180deg');
    expect(cssText).not.toContain('linear-gradient');
  });

  test('NO raw hex outside var() fallbacks (every colour is a token or currentColor)', () => {
    // Strip var(...) (which legitimately carry DESIGN.md fallback hexes), then any
    // remaining `#hex` is a raw decorative use — forbidden.
    let text = cssText;
    let prev: string;
    do {
      prev = text;
      text = text.replace(/var\([^()]*\)/gi, '');
    } while (text !== prev);
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('AC1/AC6 — the helper registers NO custom element', () => {
  test('exports are pure functions, not registered elements', () => {
    expect(typeof sparkline).toBe('function');
    expect(typeof dayBars).toBe('function');
    expect(customElements.get('tc-chart')).toBeUndefined();
    expect(customElements.get('tc-sparkline')).toBeUndefined();
  });
});
