// Story 6.5 — `tc-my-home` Scene orchestrator, the LIVE-GEOMETRY E2E layer.
//
// The co-located jsdom suite (src/components/my-home.test.ts) pins the WIRING — one
// model, one renderer, overlay present/top/pass-through, slice-gating, teardown —
// but jsdom returns ZERO-sized rects, so it cannot prove the one thing 6.5 actually
// introduces: the card's FIRST contact with live DOM geometry. This spec is that
// proof. It mounts `tc-my-home` in a REAL browser (Chromium), feeds it the demo
// harness's mock `hass`, and asserts the behaviours that only a real layout engine
// produces: non-zero child rects, the bus overlay anchored at live `getBoundingClientRect()`
// centres, a real `ResizeObserver` recompute on reflow, `pointer-events:none`
// tap-through, and honest degradation — all under the auto console-error guard.
//
// Entity ids are matched by FUNCTION-SLUG substring (never inlined), mirroring how
// `data/energy` resolves them — the [card] no-hard-coded-ids discipline.
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

type SceneOpts = {
  /** Drop every state whose entity-id contains this function slug (degradation tests). */
  dropSlug?: string;
  /** Replace the hass states with an empty map (the calm-empty case). */
  empty?: boolean;
  /** Container width in px — used to force a reflow between two mounts. */
  width?: number;
};

// Mount a fresh `tc-my-home` into a sized, in-viewport host, fed the SAME `hass`
// the demo already built for the live `tesla-card`. Returns nothing; the element is
// addressable via the `tc-my-home` locator (Playwright pierces open shadow DOM).
async function mountScene(page: Page, opts: SceneOpts = {}): Promise<void> {
  await page.evaluate((o: SceneOpts) => {
    document.getElementById('scene-host')?.remove();
    const card = document.querySelector('tesla-card') as unknown as { hass: Record<string, unknown> };
    const base = card.hass;
    const states = o.empty
      ? {}
      : Object.fromEntries(
          Object.entries(base.states as Record<string, unknown>).filter(
            ([id]) => !(o.dropSlug && id.includes(o.dropSlug)),
          ),
        );
    const hass = { ...base, states };

    // First child + scroll-to-top keeps the Scene inside the viewport so the
    // IntersectionObserver visibility gate stays open (off-screen ⇒ no geometry work).
    const host = document.createElement('div');
    host.id = 'scene-host';
    host.style.cssText = `width:${o.width ?? 1100}px;padding:16px;box-sizing:border-box;`;
    document.body.prepend(host);
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
const cells = (page: Page) => scene(page).locator('.scene-cell');
const chips = (page: Page) => scene(page).locator('.sb-chip');
const overlay = (page: Page) => scene(page).locator('.scene-bus');

test.describe('tc-my-home Scene — live geometry (6.5, AC1/AC3/AC4)', () => {
  test.beforeEach(async ({ demo }) => {
    // Load the demo so the bundle is parsed (registers tc-my-home + the five cards)
    // and the mock `hass` is built on the live card. We then mount our own Scene.
    await demo.open(AWAKE.open);
  });

  test('AC1 — composes five Scene-unaware child cards with real, non-zero layout', async ({
    page,
  }) => {
    await mountScene(page);
    await expect(cells(page)).toHaveCount(5);

    // The functional grid lays the five energy roles in canonical order.
    const tags = await cells(page).evaluateAll((cs) =>
      cs.map((c) => (c.firstElementChild?.tagName ?? '').toLowerCase()),
    );
    expect(tags).toEqual(['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector']);

    // The jsdom suite cannot see this: every cell has a real, non-zero box because a
    // genuine layout engine ran (the whole point of the live-geometry wiring).
    for (let i = 0; i < 5; i++) {
      const box = await cells(page).nth(i).boundingBox();
      expect(box, `cell ${i} has a live box`).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    }
  });

  test('AC1c/AC3 — the bus overlay is anchored at LIVE getBoundingClientRect() centres', async ({
    page,
  }) => {
    await mountScene(page);
    // One chip per present, anchored node — drawn only after the reflow-driven
    // recompute fed the renderer REAL rects (proves setAnchors got live geometry).
    await expect(chips(page)).toHaveCount(5);

    // Each chip is translated to its node's container-relative centre. In jsdom those
    // are all (0,0); here they are real, distinct, non-zero positions.
    const xs = await chips(page).evaluateAll((gs) =>
      gs.map((g) => {
        const m = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '');
        return m ? [Number(m[1]), Number(m[2])] : [0, 0];
      }),
    );
    // At least one chip sits at a genuine non-origin position, and the chips do not
    // all collapse onto one point (live anchors are spatially distinct).
    expect(xs.some(([x, y]) => x !== 0 || y !== 0)).toBe(true);
    const uniqueX = new Set(xs.map(([x]) => Math.round(x)));
    expect(uniqueX.size).toBeGreaterThan(1);
  });

  test('AC3d — a single pointer-events:none overlay sits on top and lets taps fall through', async ({
    page,
  }) => {
    await mountScene(page);
    await expect(overlay(page)).toHaveCount(1);

    // The overlay is the LAST (top) layer and computes to pointer-events:none.
    const layering = await scene(page).evaluate((el) => {
      const sceneEl = (el as HTMLElement).shadowRoot!.querySelector('.scene')!;
      const ov = sceneEl.querySelector('.scene-bus')!;
      return {
        isLast: sceneEl.lastElementChild === ov,
        pe: getComputedStyle(ov).pointerEvents,
      };
    });
    expect(layering.isLast).toBe(true);
    expect(layering.pe).toBe('none');

    // Real hit-test: a point over the first child card resolves (piercing shadow) to
    // the card beneath, never the overlay SVG — so taps reach the cards' own controls.
    const hit = await scene(page).evaluate((el) => {
      const sceneEl = (el as HTMLElement).shadowRoot!.querySelector('.scene')!;
      // Aim at the CHILD CARD's own centre — the grid stretches cells taller than the
      // card, so the cell centre can fall on empty cell area; the card host cannot.
      const cardHost = sceneEl.querySelector('.scene-cell')!.firstElementChild!;
      const r = cardHost.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const childTags = ['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector'];
      // Descend through open shadow roots to the genuinely topmost element at (x,y).
      let node: Element | null = document.elementFromPoint(x, y);
      const hostTags: string[] = [];
      while (node) {
        hostTags.push(node.tagName.toLowerCase());
        const inner = node.shadowRoot?.elementFromPoint(x, y) ?? null;
        if (!inner || inner === node) break;
        node = inner;
      }
      return {
        reachedAChildCard: hostTags.some((t) => childTags.includes(t)),
        hitOverlay: (node as Element)?.closest?.('.scene-bus') != null,
      };
    });
    expect(hit.reachedAChildCard).toBe(true);
    expect(hit.hitOverlay).toBe(false);
  });

  test('AC3a — a real ResizeObserver reflow recomputes geometry (chips reposition)', async ({
    page,
  }) => {
    await mountScene(page, { width: 1100 });
    await expect(chips(page)).toHaveCount(5);
    const before = await chips(page).evaluateAll((gs) =>
      gs.map((g) => g.getAttribute('transform')),
    );

    // Shrink the container — a genuine reflow the ResizeObserver observes. The
    // coalesced recompute re-reads live rects and the overlay redraws at new anchors.
    await page.evaluate(() => {
      const host = document.getElementById('scene-host')!;
      host.style.width = '560px';
    });

    await expect
      .poll(async () =>
        chips(page).evaluateAll((gs) => gs.map((g) => g.getAttribute('transform')).join('|')),
      )
      .not.toBe(before.join('|'));
  });

  test('AC4 — an absent node is omitted with its bus edge (no card, no chip)', async ({ page }) => {
    // Drop the Powerwall power reading (function-slug match, never an inlined id).
    await mountScene(page, { dropSlug: 'battery_power' });
    await expect(cells(page)).toHaveCount(4);
    await expect(scene(page).locator('tc-powerwall')).toHaveCount(0);
    await expect(chips(page)).toHaveCount(4);
    await expect(scene(page).locator('.sb-chip[data-role="powerwall"]')).toHaveCount(0);
  });

  test('AC4 — an essentially-empty hass renders a calm Scene (no crash, no overlay)', async ({
    page,
  }) => {
    await mountScene(page, { empty: true });
    await expect(scene(page).locator('.scene')).toHaveCount(1);
    await expect(cells(page)).toHaveCount(0);
    await expect(overlay(page)).toHaveCount(0);
    // The auto console-guard asserts the empty mount emitted no errors at teardown.
  });

  test('AC3/AC4 — disconnecting the Scene tears down cleanly under live reflow', async ({
    page,
  }) => {
    await mountScene(page);
    await expect(chips(page)).toHaveCount(5);

    // Remove the element, then storm the page with resizes: a leaked ResizeObserver
    // or rAF on the detached element would surface as a console/page error (guarded).
    await page.evaluate(() => document.getElementById('scene-host')!.remove());
    for (const w of [800, 1200, 600]) {
      await page.setViewportSize({ width: w, height: 720 });
    }
    await expect(scene(page)).toHaveCount(0);
  });
});
