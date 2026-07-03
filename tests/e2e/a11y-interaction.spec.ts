// [NFR-3 matrix axis: renders mobile + desktop] — Story 7.4 traceability marker
// (setViewportSize sweep across compact ≤540px and wide ≥1280px widths).
// Accessibility, responsive & interaction contracts — RUNTIME E2E for Story 2.3
// (UX-DR21 a11y floor / UX-DR22 responsive / UX-DR23 interaction + bans).
//
// The unit gates (src/a11y.test.ts, src/interaction.test.ts) prove the CSS/TS
// *source* carries the contract and that tc-slider's dispatch logic is correct in
// jsdom. What no test exercised — and what the story's Debug Log flagged as the
// PARTIAL "rendered-pixel pass" (Chrome automation wasn't connected that session) —
// is that the contract actually *takes effect in a real browser*: the focus ring
// paints on keyboard focus, tabs measure ≥44px, `prefers-reduced-motion` truly
// halts the shared halos/shimmers and snaps the gauges, the breakpoints reflow the
// layout, and the slider commits once on a real pointer drag. This spec closes that
// gap by reading computed styles / geometry / real PointerEvents out of the bundled
// card in the demo harness. Default demo scenario is awake/charging, so the battery
// shimmer + ring pulse are live and the charging panel (with its tc-slider) is open.
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
      outlineOffset: cs.outlineOffset,
    };
  });
}

// ── AC1a: focus contract — the ring paints on keyboard focus, not on mouse ──
test.describe('focus ring — keyboard-visible, mouse-silent (AC1a)', () => {
  test('keyboard-tabbing to a control paints the 2px --tc-focus ring', async ({ demo, page }) => {
    await demo.open({ scenario: 'awake' });

    // Walk real Tab presses until focus lands on a card tab (deepest active is a
    // [role=tab] inside the shadow tree). The harness page has a few light-DOM
    // buttons first, so allow a bounded number of hops.
    let info: Awaited<ReturnType<typeof deepFocusInfo>> = null;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      info = await deepFocusInfo(page);
      if (info?.role === 'tab') break;
    }
    expect(info?.role, 'keyboard Tab should reach a card tab button').toBe('tab');
    // The shared :focus-visible rule applies --tc-focus (2px solid blue) + a 2px offset.
    expect(info!.focusVisible, 'keyboard focus must match :focus-visible').toBe(true);
    expect(info!.outlineStyle).toBe('solid');
    expect(info!.outlineWidth).toBe('2px');
    expect(info!.outlineColor).toBe(BLUE);
    expect(info!.outlineOffset).toBe('2px');
  });

  test('a mouse click leaves the control ringless (:focus:not(:focus-visible))', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    const climate = demo.tab('Climate');
    await climate.click();
    // Focused by the click, but NOT focus-visible → the suppression rule wins.
    const outlineStyle = await climate.evaluate((el) => {
      el.focus();
      return getComputedStyle(el).outlineStyle;
    });
    // Re-read after the click actually focused it (Playwright click focuses the button).
    const ringless = await climate.evaluate(
      (el) => !el.matches(':focus-visible') && getComputedStyle(el).outlineStyle === 'none'
    );
    expect(outlineStyle === 'none' || ringless, 'mouse-focused tab must not show the ring').toBeTruthy();
  });
});

// ── AC1b: ≥44×44 tap-target floor — measured in the real layout ─────────────
test.describe('tap-target floor — tabs measure ≥44×44 (AC1b)', () => {
  for (const width of [1280, 400]) {
    test(`every tab is ≥44×44 at viewport ${width}px (${width < 760 ? 'compact icon-only' : 'labelled'})`, async ({
      demo,
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await demo.open({ scenario: 'awake' });
      const tabs = demo.tablist.getByRole('tab');
      const count = await tabs.count();
      expect(count, 'card should render its tab strip').toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = await tabs.nth(i).boundingBox();
        const label = await tabs.nth(i).innerText();
        expect(box, `tab ${i} has no box`).not.toBeNull();
        expect(box!.height, `tab "${label}" height ≥44 @${width}px`).toBeGreaterThanOrEqual(44);
        expect(box!.width, `tab "${label}" width ≥44 @${width}px`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

// ── AC1c: reduced-motion — the shared guard truly flips the rendered motion ──
// Two halves of the same contract: motion runs by default; under reduce it halts
// (the shared halo/shimmer) and snaps (the gauge). Reading the live computed styles
// proves the @media block is wired to the same selectors the keyframes/transition
// use. We exercise the battery gauge — the one shared-motion primitive that mounts
// on the default view. The ring pulse (tc-pulse on `.tc-ring`) shares the identical
// shared-CSS guard but `.tc-ring` is an as-yet-unmounted ui.ts primitive (no panel
// renders it today), so its runtime guard is left to the static gate in a11y.test.ts
// — it gains E2E coverage automatically once a panel mounts a ring.
const SHIMMER = '.tc-bat.charging .tc-bat-fill'; // the shimmer is the ::after of the FILL, not the bar.

test.describe('reduced-motion — default motion runs (AC1c control)', () => {
  test('the battery shimmer animates and its gauge transitions by default', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    const shimmer = await demo.card
      .locator(SHIMMER)
      .first()
      .evaluate((el) => getComputedStyle(el, '::after').animationName);
    expect(shimmer, 'battery shimmer animates by default').toBe('tc-shimmer');

    const fillDur = await demo.card
      .locator('.tc-bat-fill')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(fillDur, 'gauge width transition is live by default').not.toBe('0s');
  });
});

test.describe('reduced-motion — shared guard halts & snaps (AC1c)', () => {
  test('the shared shimmer HALTS under prefers-reduced-motion', async ({ demo, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await demo.open({ scenario: 'awake' });
    const shimmer = await demo.card
      .locator(SHIMMER)
      .first()
      .evaluate((el) => getComputedStyle(el, '::after').animationName);
    expect(shimmer, 'battery shimmer must halt (animation:none)').toBe('none');
  });

  test('the data-bearing gauge SNAPS (transition killed) under reduced-motion', async ({ demo, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await demo.open({ scenario: 'awake' });
    const fillDur = await demo.card
      .locator('.tc-bat-fill')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(fillDur, 'battery fill must snap (transition:none → 0s)').toBe('0s');
  });
});

// ── AC2: responsive contract — the breakpoints reflow the real layout ───────
test.describe('responsive contract — 1080 cap / 540 collapse / 760 labels (AC2)', () => {
  test('.root honours max-width:1080px on a wide viewport', async ({ demo, page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await demo.open({ scenario: 'awake' });
    const box = await demo.card.locator('.root').first().boundingBox();
    expect(box, '.root has no box').not.toBeNull();
    expect(box!.width, '.root must not sprawl past 1080px').toBeLessThanOrEqual(1080);
  });

  test('the g3 stats grid collapses to 2 columns ≤540px and expands ≥760px', async ({ demo, page }) => {
    const trackCount = () =>
      demo.card
        .locator('.g3')
        .first()
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length);

    // Wide: the full column count (>2).
    await page.setViewportSize({ width: 900, height: 900 });
    await demo.open({ scenario: 'awake' });
    expect(await trackCount(), 'g3 keeps its full columns ≥760px').toBeGreaterThan(2);

    // Compact: collapsed to exactly 2.
    await page.setViewportSize({ width: 400, height: 900 });
    await demo.open({ scenario: 'awake' });
    expect(await trackCount(), 'g3 collapses to 2 columns ≤540px').toBe(2);
  });

  test('inactive tab labels react to the CARD width, not the viewport (@container — D-CQ-1)', async ({ demo, page }) => {
    // Select by CSS (.tab:not(.active) span), NOT getByRole({name}): at narrow
    // width the label is display:none so the tab has no accessible name to match.
    // The label is a flex item, so `display:inline` blockifies to computed 'block'
    // when revealed — the contract is "hidden vs shown", i.e. none vs not-none.
    // Since D-CQ-1 the reveal keys on `.root`'s OWN inline size via @container, so
    // we drive the CARD width (the #stage column) and hold the viewport WIDE — the
    // 2026-07-03 tab-overlap fix: pre-fix a viewport @media revealed labels a
    // narrow card could not fit, overlapping each icon into its neighbour's label.
    const labelDisplay = () =>
      demo.card
        .locator('.tab:not(.active) span')
        .first()
        .evaluate((el) => getComputedStyle(el).display);
    const setCardWidth = (px: number) =>
      page.evaluate((w) => (document.getElementById('stage')!.style.maxWidth = `${w}px`), px);

    await demo.open({ scenario: 'awake' });

    // Card ≥760px wide → labels revealed, and it stays revealed across viewports
    // (proving the reveal is card-relative, not viewport-relative).
    await setCardWidth(900);
    for (const width of [1400, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await labelDisplay(), `labels reveal when the CARD is ≥760px (viewport ${width})`).not.toBe('none');
    }

    // Card <760px wide → icon-only EVEN in a wide viewport (the exact bug geometry:
    // narrow card, wide viewport). Element-relative, so the viewport is irrelevant.
    await setCardWidth(510);
    for (const width of [1400, 400]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await labelDisplay(), `labels hide when the CARD is <760px (viewport ${width})`).toBe('none');
    }
  });
});

// ── AC3: interaction — slider commits on release, never mid-drag (real pointers) ──
test.describe('interaction — drag commit-on-release (AC3)', () => {
  test('tc-slider fires value-changed once on pointer-up, never during the drag', async ({ demo, page }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Charging');

    const slider = demo.card.locator('tc-slider').first();
    await expect(slider).toBeVisible();

    // Count value-changed on the real element (the metered-API contract: one call
    // per gesture, on release). rAF/pointer plumbing is real here, unlike jsdom.
    await slider.evaluate((el) => {
      (window as unknown as { __vc: number[] }).__vc = [];
      el.addEventListener('value-changed', (e) =>
        (window as unknown as { __vc: number[] }).__vc.push((e as CustomEvent<{ value: number }>).detail.value)
      );
    });

    const track = slider.locator('.track');
    // The charge-limit slider sits below the fold on the default viewport — raw
    // page.mouse coords are viewport-relative, so scroll it in first or the pointer
    // lands on empty space and the drag never reaches the track.
    await track.scrollIntoViewIfNeeded();
    const box = await track.boundingBox();
    expect(box, 'slider track has no box').not.toBeNull();
    const yc = box!.y + box!.height / 2;

    await page.mouse.move(box!.x + box!.width * 0.15, yc);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.45, yc, { steps: 5 });
    await page.mouse.move(box!.x + box!.width * 0.7, yc, { steps: 5 });

    const midDrag = await page.evaluate(() => (window as unknown as { __vc: number[] }).__vc.length);
    expect(midDrag, 'no mid-drag commits — value-changed must not fire on pointermove').toBe(0);

    await page.mouse.up();
    const afterRelease = await page.evaluate(() => (window as unknown as { __vc: number[] }).__vc);
    expect(afterRelease.length, 'exactly one commit on pointer-up').toBe(1);
  });
});
