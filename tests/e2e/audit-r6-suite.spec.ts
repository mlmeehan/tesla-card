// R6 SUITE-COMPLETE audit checkpoint — CROSS-COMPONENT runtime E2E (Story 6.8).
//
// 5.11 audited the vehicle card; this is the suite layer one level up: the composed
// "My Home" Scene (the six ecosystem cards + the Gateway bus + the weather vignette)
// exercised as a whole in a REAL browser — the parts jsdom cannot reach (a genuine
// `prefers-reduced-motion` flip on the composed animation set, real `:focus-visible`
// traversal into the Scene, a clean cross-dialect runtime render). The co-located
// jsdom suite (src/audit-r6-suite.test.ts) pins resolution/wiring/values; this pins
// the rendered-pixel + real-interaction contract under the auto console-error guard.
//
//   • AC1 — a COMPOSED reduced-motion sweep over EVERY Scene animation source: the
//     Gateway bus dash (`.sb-flow`) and the weather vignette (`.wx-*`) both HALT
//     (animation:none) while their data cues survive (arrowheads + kW ribbon, the
//     condition art) — "kill the motion, keep the data". Plus keyboard focus lands
//     IN the Scene with the 2px blue ring and no trap (the cross-card/into-Scene seam
//     the per-card specs don't reach).
//   • AC4 — the composed Scene driven against a NON-DEFAULT install prefix renders
//     cleanly (the console guard fails on any uncaught error) — the runtime echo of
//     the jsdom function-name-resolution proof.
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

// Mount a fresh `tc-my-home` into a sized, in-viewport host, fed the SAME `hass` the
// demo already built — optionally re-prefixed (AC4) and always with a weather/sun
// state injected so the Solar card renders its vignette (the awake fixture carries
// no weather, and the vignette is the AC1 sweep's second animation source).
async function mountScene(page: Page, opts: { reslug?: boolean } = {}): Promise<void> {
  await page.evaluate((o: { reslug?: boolean }) => {
    document.getElementById('scene-host')?.remove();
    const card = document.querySelector('tesla-card') as unknown as { hass: Record<string, unknown> };
    const base = card.hass;

    // Inject HA-core weather + sun so tc-solar renders the live-condition vignette.
    const baseStates = base.states as Record<string, { entity_id?: string }>;
    let states: Record<string, unknown> = {
      ...baseStates,
      'weather.home': { entity_id: 'weather.home', state: 'cloudy', attributes: {}, last_updated: '2026-06-15T14:41:00Z', last_changed: '2026-06-15T14:41:00Z' },
      'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {}, last_updated: '2026-06-15T14:41:00Z', last_changed: '2026-06-15T14:41:00Z' },
    };

    // AC4 — re-prefix every energy id to a synthetic NON-DEFAULT install while
    // preserving the function-slug each data/energy rule keys on. If resolution were
    // prefix-coupled the Scene would render empty; it must still compose five cards.
    if (o.reslug) {
      const remap = (id: string) =>
        id.replace(/my_home_/g, 'acme_ess_').replace(/tesla_wall_connector_/g, 'acme_evse_wall_connector_');
      states = Object.fromEntries(
        Object.entries(states).map(([id, ent]) => {
          const nid = remap(id);
          return [nid, { ...(ent as object), entity_id: nid }];
        }),
      );
    }
    const hass = { ...base, states };

    const host = document.createElement('div');
    host.id = 'scene-host';
    host.style.cssText = 'width:1100px;padding:16px;box-sizing:border-box;';
    document.body.prepend(host); // FIRST child → the Scene leads the tab order
    window.scrollTo(0, 0);

    const scene = document.createElement('tc-my-home') as unknown as {
      setConfig(c: unknown): void;
      hass: unknown;
    };
    scene.setConfig({ type: 'tc-my-home' });
    scene.hass = hass;
    host.appendChild(scene as unknown as HTMLElement);
  }, opts);
}

const scene = (page: Page) => page.locator('tc-my-home');
const flowDash = (page: Page) => scene(page).locator('.sb-flow').first();
const animName = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => getComputedStyle(el).animationName);

test.describe('R6 suite — composed reduced-motion sweep (AC1)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open); // parse the bundle + build the mock hass on the live card
  });

  test('AC1 control — the Gateway bus dash + weather vignette ANIMATE by default', async ({ page }) => {
    await mountScene(page);
    await expect(flowDash(page)).toHaveCount(1);
    expect(await animName(flowDash(page)), 'bus dash animates by default').toBe('sb-flow-dash');

    // The vignette's cloud drift animates (the awake-injected cloudy sky).
    const cloud = scene(page).locator('.wx-cloud').first();
    await expect(cloud).toBeAttached();
    expect(await animName(cloud), 'vignette cloud drifts by default').not.toBe('none');
  });

  test('AC1 — reduced-motion HALTS every Scene animation while the data cues survive', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountScene(page);

    // 1) The Gateway bus dash freezes (animation:none) — but the arrowheads remain.
    await expect(flowDash(page)).toHaveCount(1);
    expect(await animName(flowDash(page)), 'bus dash must halt under reduced-motion').toBe('none');
    await expect(scene(page).locator('.gw-head').first(), 'arrowheads survive (the colour-blind-safe cue)').toBeAttached();

    // 2) The summary ribbon stays a legible static read — node names + kW magnitude.
    const ribbon = (await scene(page).locator('.ribbon').textContent()) ?? '';
    expect(ribbon, 'the running-net ribbon stays legible with motion off').toMatch(/kW/);

    // 3) The weather vignette freezes ALL wx-* motion — the condition art stays legible.
    const cloud = scene(page).locator('.wx-cloud').first();
    await expect(cloud).toBeAttached();
    expect(await animName(cloud), 'vignette must freeze under reduced-motion').toBe('none');
    await expect(scene(page).locator('.wx-art').first(), 'the condition art (the sky) stays drawn').toBeAttached();
  });

  test('AC1 — reduced-motion freezes the THIRD source (the focus-highlight transition) while the dim/light cue survives', async ({ page }) => {
    // The Task-1 inventory names THREE Scene animation sources: the bus dash, the
    // weather vignette (both swept above), AND the focus-highlight opacity transition
    // (`my-home.ts:732`). Closing the last enumerated source: focusing a card must
    // still de-emphasize the rest (the data cue), but the transition is an INSTANT
    // cut under reduced-motion — "kill the motion, keep the data".
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountScene(page);

    // Engage the focus-highlight (focusin → .scene gains .focus, the focused card lights).
    await scene(page).locator('.scene-cell').first().focus();
    await expect(scene(page).locator('.scene.focus'), 'focusing a card engages the highlight').toHaveCount(1);

    const cells = await scene(page)
      .locator('.scene-cell')
      .evaluateAll((els) =>
        els.map((el) => {
          const cs = getComputedStyle(el);
          return { lit: el.classList.contains('lit'), dur: cs.transitionDuration, opacity: Number(cs.opacity) };
        }),
      );
    // Motion killed: every cell's focus-highlight transition is an instant cut.
    expect(cells.every((c) => c.dur === '0s'), 'focus-highlight transition must be killed under reduced-motion').toBe(true);
    // Data survives: the focused card stays lit (opacity 1) — the dim/light highlight still reads.
    expect(cells.some((c) => c.lit && c.opacity === 1), 'the focused card stays fully lit (the cue survives)').toBe(true);
  });
});

test.describe('R6 suite — keyboard focus lands IN the Scene with the ring, no trap (AC1)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC1 — Tab reaches a Scene card; it paints the 2px blue ring and the Scene highlights', async ({ page }) => {
    await mountScene(page); // host is the document's FIRST child → cards lead tab order
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Walk real Tab presses until the deep active element is a Scene card cell.
    const onCell = async () =>
      page.evaluate(() => {
        let el: Element | null = document.activeElement;
        while (el && (el as HTMLElement).shadowRoot?.activeElement) {
          el = (el as HTMLElement).shadowRoot!.activeElement;
        }
        if (!el || !el.classList.contains('scene-cell')) return null;
        const cs = getComputedStyle(el);
        return {
          node: (el as HTMLElement).dataset.node,
          focusVisible: el.matches(':focus-visible'),
          outlineWidth: cs.outlineWidth,
          outlineStyle: cs.outlineStyle,
          outlineColor: cs.outlineColor,
        };
      });

    let info: Awaited<ReturnType<typeof onCell>> = null;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      info = await onCell();
      if (info) break;
    }
    expect(info, 'keyboard Tab should land on a Scene card cell').not.toBeNull();
    // The 2px --tc-blue focus ring (the a11y floor) paints on keyboard focus.
    expect(info!.focusVisible).toBe(true);
    expect(info!.outlineStyle).toBe('solid');
    expect(info!.outlineWidth).toBe('2px');
    expect(info!.outlineColor).toBe('rgb(56, 189, 248)'); // --tc-blue #38bdf8
    // Focusing a card highlights the Scene (focusin path) — no navigation, no trap.
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);

    // No focus TRAP: tabbing past all five cells must let focus LEAVE the Scene —
    // a trap would re-capture focus onto a scene-cell forever (the story's explicit
    // "the Scene introduces no focus trap"). Five Tabs ⇒ guaranteed past every cell.
    let escaped = false;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if ((await onCell()) === null) {
        escaped = true;
        break;
      }
    }
    expect(escaped, 'focus must be able to leave the Scene — no focus trap').toBe(true);
  });
});

test.describe('R6 suite — the composed Scene under a non-default install prefix (AC4)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC4 — re-prefixed energy ids still compose five cards + a named bus, zero console errors', async ({ page }) => {
    await mountScene(page, { reslug: true });
    await expect(scene(page).locator('.scene-cell')).toHaveCount(5); // all roles resolved by slug
    const tags = await scene(page)
      .locator('.scene-cell')
      .evaluateAll((cs) => cs.map((c) => (c.firstElementChild?.tagName ?? '').toLowerCase()));
    expect(tags).toEqual(['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector']);
    // The bus overlay names a present node (no blank) and carries a kW magnitude.
    const label = (await scene(page).locator('.scene-bus').getAttribute('aria-label')) ?? '';
    expect(label).toMatch(/kW/);
    // No 'NaN' painted anywhere under the strange prefix.
    expect(await scene(page).textContent()).not.toContain('NaN');
    // The console-guard fixture fails the test at teardown on any uncaught error.
  });
});
