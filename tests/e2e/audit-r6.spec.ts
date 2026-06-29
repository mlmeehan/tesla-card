// R6 integration-audit checkpoint — CROSS-COMPONENT runtime E2E (Story 5.11).
//
// The per-panel specs each prove their own a11y / reduced-motion / freshness in
// isolation; what NO spec exercised is the SEAM BETWEEN panels and the shell —
// the gap this named checkpoint owns:
//   • AC1 — keyboard focus ORDER across the tab strip equals reading order, and a
//     control deep inside a NON-default panel still paints the 2px focus ring
//     (cross-panel, not just the default charging view).
//   • AC2 — (removed by Story 12.1) the Hero's live-energy FLOW overlay was removed,
//     so its reduced-motion proof is gone from here; the equivalent real-browser proof
//     lives on the Scene bus in tests/e2e/audit-r6-suite.spec.ts (`.sb-flow` halts).
//   • AC3 — freshness honesty across the whole card: the asleep car NEVER paints a
//     confident green "All closed" (the one unforgivable overstatement).
//   • AC4 — the whole card driven against the costly tesla_custom dialect renders
//     cleanly (the console guard fails the test on any uncaught error).
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';

const BLUE = 'rgb(56, 189, 248)'; // --tc-blue #38bdf8 — the focus-ring colour.

/** Deepest focused element across open shadow roots, with its focus styling read. */
async function deepFocusInfo(page: Page) {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    while (el && (el as HTMLElement).shadowRoot?.activeElement) {
      el = (el as HTMLElement).shadowRoot!.activeElement;
    }
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
    };
  });
}

// ── AC1 — focus order across the tab strip = reading order ───────────────────
test.describe('AC1 — cross-panel keyboard navigation / focus order', () => {
  test('Tab visits the tabs in reading order (focus order = DOM/reading order)', async ({
    demo,
    page,
  }) => {
    await demo.open({ scenario: 'awake' });

    // The card's visible tab labels in DOM order (reading order).
    const reading = await demo.tablist
      .getByRole('tab')
      .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
    expect(reading.length).toBeGreaterThan(3);

    // Walk real Tab presses; record each distinct tab the focus lands on, in order.
    const visited: string[] = [];
    let reached = false;
    for (let i = 0; i < 40 && visited.length < reading.length; i++) {
      await page.keyboard.press('Tab');
      const info = await deepFocusInfo(page);
      if (info?.role === 'tab') {
        reached = true;
        if (info.label && visited[visited.length - 1] !== info.label) visited.push(info.label);
      } else if (reached) {
        break; // focus left the tab strip — order capture complete
      }
    }
    // The captured focus order is a PREFIX-equal walk of the reading order (no
    // reordering, no skips within the strip). Compare the overlap region.
    expect(visited.length).toBeGreaterThan(0);
    expect(reading.slice(0, visited.length)).toEqual(visited);
  });

  test('keyboard focus continues PAST the tab strip into operable content, ring intact', async ({
    demo,
    page,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Closures');
    // Start the keyboard walk from the document top so the traversal is real
    // keyboard input (→ :focus-visible), not a programmatic focus() (which never
    // matches :focus-visible). Walk forward until focus lands on a NON-tab control
    // that paints the shared 2px blue ring — proving focus order leaves the tab
    // strip and enters operable content with the ring still applied (the
    // cross-panel seam; per-panel specs only prove it on the default view).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let ringedNonTab: Awaited<ReturnType<typeof deepFocusInfo>> = null;
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const info = await deepFocusInfo(page);
      if (
        info &&
        info.role !== 'tab' &&
        info.focusVisible &&
        info.outlineStyle === 'solid' &&
        info.outlineWidth === '2px' &&
        info.outlineColor === BLUE
      ) {
        ringedNonTab = info;
        break;
      }
    }
    expect(
      ringedNonTab,
      'a non-tab control past the tab strip should paint the 2px blue focus ring'
    ).not.toBeNull();
  });
});

// ── AC3 — freshness honesty across the whole card ───────────────────────────
test.describe('AC3 — freshness honesty: no false "closed" on an asleep car', () => {
  test('asleep closures never paints the confident green "All closed"', async ({ demo }) => {
    await demo.open({ scenario: 'asleep' });
    await demo.openPanel('Closures');
    const status = demo.card.locator('tc-panel-closures .status');
    await expect(status).toBeVisible();
    // The confident green tone (`.status.good`) is reserved for FRESH + locked +
    // all-closed. An asleep car cannot confirm closure → tone must NOT be green.
    await expect(status).not.toHaveClass(/\bgood\b/);
  });
});

// ── AC4 — the whole card under the costly tesla_custom dialect ───────────────
test.describe('AC4 — tesla_custom dialect renders the whole card cleanly', () => {
  const PANELS = ['Climate', 'Charging', 'Closures', 'Tyres', 'Location', 'Media'] as const;

  test('every panel opens under env=tesla_custom with no console error', async ({ demo }) => {
    await demo.open({ scenario: 'awake', env: 'tesla_custom' });
    for (const name of PANELS) {
      await demo.openPanel(name);
      await expect(demo.card.locator('.panel')).toBeVisible();
    }
    // The consoleGuard fixture fails the test at teardown on any uncaught error /
    // console.error — so a fleet-shaped assumption that throws under tesla_custom
    // would surface here.
  });
});
