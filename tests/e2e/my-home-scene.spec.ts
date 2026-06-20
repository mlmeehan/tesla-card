// Story 6.6 — `tc-my-home` polished composed view, the LIVE-GEOMETRY + REAL-INTERACTION E2E layer.
//
// 6.5 shipped the orchestrator + the SceneBus STAR over a functional grid; this
// spec layer was its `.sb-chip` proof. Story 6.6 RETIRES the star: it replaces the
// chip junction with the Gateway running-net TRUNK (drawn in the element overlay
// from the pure `gatewaySegments`), adds the summary RIBBON, the hover/keyboard
// FOCUS-HIGHLIGHT, the explicit `380px×3`/80px two-row grid, and the `≤540px`
// phone-reflow that re-routes the bus VERTICALLY.
//
// The co-located jsdom suites pin the WIRING + the pure math (the Gateway trunk is
// drawn not the star, the axis flips on reflow, the segment running-net) — but
// jsdom returns ZERO-sized rects and applies no stylesheet, so it cannot prove the
// things ONLY a real layout engine + a real interaction produce: the trunk anchored
// at live `getBoundingClientRect()` centres, the ribbon laid out ABOVE the grid, the
// focus dim/light as REAL computed opacity, and the genuine `@media (max-width:540px)`
// reflow flipping the bus axis to vertical. This spec is that proof, under the auto
// console-error guard.
//
// Entity ids are matched by FUNCTION-SLUG substring (never inlined), mirroring how
// `data/energy` resolves them — the [card] no-hard-coded-ids discipline.
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

type SceneOpts = {
  /** Drop every state whose entity-id contains this function slug (degradation tests). */
  dropSlug?: string;
  /** Drop every state whose id contains ANY of these slugs (multi-node subset tests, 6.7). */
  dropSlugs?: string[];
  /** Replace the hass states with an empty map (the calm-empty case). */
  empty?: boolean;
  /** Host width in px — used to size the mount (and to fit a narrowed viewport). */
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
    const drops = ([] as string[]).concat(o.dropSlug ?? [], o.dropSlugs ?? []);
    const states = o.empty
      ? {}
      : Object.fromEntries(
          Object.entries(base.states as Record<string, unknown>).filter(
            ([id]) => !drops.some((slug) => id.includes(slug)),
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
const legs = (page: Page) => scene(page).locator('.gw-leg');
const trunk = (page: Page) => scene(page).locator('.gw-trunk-base');
const overlay = (page: Page) => scene(page).locator('.scene-bus');
const ribbon = (page: Page) => scene(page).locator('.ribbon');
const grid = (page: Page) => scene(page).locator('.scene-grid');

// The Gateway trunk is drawn only AFTER the rAF-coalesced geometry recompute fed the
// overlay live anchors. Wait for the rail before asserting its geometry.
const waitForTrunk = async (page: Page): Promise<void> => {
  await expect(trunk(page)).toHaveCount(1);
};

// Read the trunk rail endpoints (container-px space — no viewBox).
const trunkLine = (page: Page) =>
  trunk(page).evaluate((l) => ({
    x1: Number(l.getAttribute('x1')),
    y1: Number(l.getAttribute('y1')),
    x2: Number(l.getAttribute('x2')),
    y2: Number(l.getAttribute('y2')),
  }));

test.describe('tc-my-home Scene — Gateway bus, ribbon, focus & reflow (6.6)', () => {
  test.beforeEach(async ({ demo }) => {
    // Load the demo so the bundle is parsed (registers tc-my-home + the five cards)
    // and the mock `hass` is built on the live card. We then mount our own Scene.
    await demo.open(AWAKE.open);
  });

  // ── AC1 — explicit two-row grid + summary ribbon ──────────────────────────────

  test('AC1 — composes five Scene-unaware child cards with real, non-zero layout', async ({
    page,
  }) => {
    await mountScene(page);
    await expect(cells(page)).toHaveCount(5);

    // The explicit grid-template-areas lays the five energy roles source-row / load-row.
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

  test('AC1a — the explicit two-row grid lays sources OVER loads (real layout geometry)', async ({
    page,
  }) => {
    await mountScene(page);
    await expect(cells(page)).toHaveCount(5);

    // Read each present cell's role + live top — jsdom cannot produce these rows.
    const rows = await cells(page).evaluateAll((cs) =>
      cs.map((c) => ({
        role: (c as HTMLElement).dataset.node,
        top: Math.round(c.getBoundingClientRect().top),
      })),
    );
    const topOf = (role: string) => rows.find((r) => r.role === role)!.top;
    // Sources (solar/grid) sit on a strictly higher row than loads (home/wall_connector):
    // the explicit `grid-template-areas` two-row layout, not source order or auto-fit.
    const sourceRow = Math.max(topOf('solar'), topOf('grid'));
    const loadRow = Math.min(topOf('home'), topOf('wall_connector'));
    expect(sourceRow).toBeLessThan(loadRow);
  });

  test('AC1b — the summary ribbon renders ABOVE the grid with the aggregate labels', async ({
    page,
  }) => {
    await mountScene(page);
    await expect(ribbon(page)).toHaveCount(1);
    await expect(grid(page)).toHaveCount(1);

    // The ribbon is laid out strictly above the card grid (real boxes, not DOM order).
    const rb = await ribbon(page).boundingBox();
    const gb = await grid(page).boundingBox();
    expect(rb).not.toBeNull();
    expect(gb).not.toBeNull();
    expect(rb!.y + rb!.height).toBeLessThanOrEqual(gb!.y + 1); // ribbon ends at/above the grid top

    // The three whole-home aggregates are present (copy from STRINGS, not inlined).
    const txt = (await ribbon(page).textContent()) ?? '';
    expect(txt).toMatch(/Generation/i);
    expect(txt).toMatch(/Consumption/i);
    expect(txt).toMatch(/Net/i);
    expect(txt).toMatch(/kW/); // the magnitude carries its unit (colour-blind-safe)
  });

  // ── AC2 — the Gateway running-net trunk replaces the star ──────────────────────

  test('AC2 — the overlay draws the Gateway TRUNK at live anchors, not the star chips', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // The Gateway trunk + one leg per present node — the star `.sb-chip` is retired.
    await expect(legs(page)).toHaveCount(5);
    await expect(scene(page).locator('.sb-chip')).toHaveCount(0);

    // The trunk runs HORIZONTAL between the two rows on a wide spread (constant cross
    // axis) and spans a real, non-zero distance — proof it consumed live geometry.
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // horizontal: constant y
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50); // real left→right span

    // The legs tap onto the trunk at spatially-distinct live x positions (jsdom would
    // collapse them all onto the origin).
    const legXs = await scene(page)
      .locator('.gw-leg-base')
      .evaluateAll((ls) => ls.map((l) => Math.round(Number(l.getAttribute('x1')))));
    expect(new Set(legXs).size).toBeGreaterThan(1);
  });

  test('AC2 — the bus overlay carries the colour-blind-safe aria-label (node + kW floor)', async ({
    page,
  }) => {
    await mountScene(page);
    await expect(overlay(page)).toHaveCount(1);
    const label = (await overlay(page).getAttribute('aria-label')) ?? '';
    expect(label.length).toBeGreaterThan(0);
    expect(label).toMatch(/kW/); // every present node names its magnitude in text
  });

  test('AC2/AC3d — a single pointer-events:none overlay sits on top and lets taps fall through', async ({
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
      const cardHost = sceneEl.querySelector('.scene-cell')!.firstElementChild!;
      const r = cardHost.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const childTags = ['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector'];
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

  // ── AC3 — hover / keyboard focus-highlight (dim the rest, light the coupled) ────

  test('AC3 — HOVER lights the focused card + its couplings and DIMS the rest (real opacity)', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // Focus a LOAD (home): on the shared bus a load lights all sources but NOT the
    // other loads — so wall_connector (the other present load) stays dimmed. Both
    // home + wall_connector are present in the awake/charging scenario, so this is
    // deterministic regardless of the exact kW values.
    const home = cells(page).filter({ has: page.locator('tc-home') });
    await home.hover();

    // The Scene enters focus mode (a dim/light enhancement — NO page change).
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);

    // REAL computed opacity (jsdom applies no stylesheet): every cell carrying `.lit`
    // renders at full opacity; every cell without it is genuinely dimmed (<1).
    const groups = await scene(page).evaluate((el) => {
      const sceneEl = (el as HTMLElement).shadowRoot!.querySelector('.scene')!;
      const out = { lit: [] as number[], dim: [] as number[] };
      sceneEl.querySelectorAll('.scene-cell').forEach((c) => {
        const op = Number(getComputedStyle(c).opacity);
        (c.classList.contains('lit') ? out.lit : out.dim).push(op);
      });
      return out;
    });
    expect(groups.lit.length).toBeGreaterThan(0);
    expect(groups.dim.length).toBeGreaterThan(0); // home (load) leaves wall_connector dimmed
    expect(groups.lit.every((o) => o === 1)).toBe(true);
    expect(groups.dim.every((o) => o < 1)).toBe(true);
  });

  test('AC3 — KEYBOARD focus triggers the same highlight and the cell is focusable', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // Cards are keyboard-reachable (tabindex=0); focusing one fires the same focusin
    // path as hover — the accessibility floor.
    const tabindexes = await cells(page).evaluateAll((cs) =>
      cs.map((c) => c.getAttribute('tabindex')),
    );
    expect(tabindexes.every((t) => t === '0')).toBe(true);

    // Programmatic focus = keyboard focus path (focusin). The cell becomes the deep
    // active element and the Scene lights up.
    const isActive = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      const cell = root.querySelector<HTMLElement>('.scene-cell[data-node="solar"]')!;
      cell.focus();
      return root.activeElement === cell;
    });
    expect(isActive).toBe(true);
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);
  });

  test('AC3 — focusing a card adds/removes NO cards (no navigation, no page change)', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);
    const before = await cells(page).evaluateAll((cs) =>
      cs.map((c) => (c as HTMLElement).dataset.node),
    );

    await cells(page).filter({ has: page.locator('tc-solar') }).hover();
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);

    const during = await cells(page).evaluateAll((cs) =>
      cs.map((c) => (c as HTMLElement).dataset.node),
    );
    expect(during).toEqual(before); // same cards — a dim/light, never a swap

    // Moving focus away clears it (and still no card churn).
    await page.mouse.move(0, 0);
    await scene(page).evaluate((el) =>
      (el as HTMLElement).shadowRoot!.querySelector<HTMLElement>('.scene-cell')!.dispatchEvent(
        new Event('mouseleave', { bubbles: true }),
      ),
    );
    await expect(scene(page).locator('.scene.focus')).toHaveCount(0);
    await expect(cells(page)).toHaveCount(before.length);
  });

  // ── AC4 — reflow, don't shrink: desktop horizontal → phone vertical bus ────────

  test('AC4 — desktop wide viewport keeps the HORIZONTAL Gateway bus', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // constant y ⇒ horizontal trunk
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50);
  });

  test('AC4 — phone ≤540px stacks one column and RE-ROUTES the bus VERTICALLY', async ({
    page,
  }) => {
    // A genuine `@media (max-width:540px)` reflow: the packed rows collapse to one
    // column, the cards stack tall, the live anchor spread becomes vertical, and the
    // breakpoint-driven axis flips — the trunk re-routes down between the cards.
    await page.setViewportSize({ width: 500, height: 1000 });
    await mountScene(page, { width: 460 });
    await expect(cells(page)).toHaveCount(5);
    await waitForTrunk(page);

    // Each packed row collapsed to a SINGLE column (one track) — the phone reflow.
    // (Story 6.7: `.scene-grid` is now the flex wrapper; the source/load rows are the
    // grids, each `grid-template-columns:1fr` at ≤540px.)
    const cols = await scene(page)
      .locator('.source-row')
      .evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(1);

    // The cards now stack: every cell shares (roughly) the same left, with distinct
    // tops — the vertical spread the busAxis routes along.
    const boxes = await cells(page).evaluateAll((cs) =>
      cs.map((c) => {
        const r = c.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top) };
      }),
    );
    expect(new Set(boxes.map((b) => b.left)).size).toBe(1); // one column
    expect(new Set(boxes.map((b) => b.top)).size).toBeGreaterThan(1); // stacked rows

    // The trunk re-routes VERTICAL (constant x) with a real top→bottom span.
    const t = await trunkLine(page);
    expect(Math.abs(t.x1 - t.x2)).toBeLessThanOrEqual(1); // constant x ⇒ vertical trunk
    expect(Math.abs(t.y2 - t.y1)).toBeGreaterThan(50);
  });

  test('AC4 — a real ResizeObserver reflow recomputes geometry (the trunk repositions)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const before = await trunkLine(page);

    // Shrink the host — a genuine reflow the ResizeObserver observes. The coalesced
    // recompute re-reads live rects and the overlay redraws at new anchors.
    await page.evaluate(() => {
      const host = document.getElementById('scene-host')!;
      host.style.width = '760px';
    });
    await expect
      .poll(async () => {
        const t = await trunkLine(page);
        return `${t.x1},${t.x2}`;
      })
      .not.toBe(`${before.x1},${before.x2}`);
  });

  // ── AC1c/AC4 — honest degradation (the present-gating + teardown hold) ──────────

  test('AC1c — an absent node is omitted with its bus leg (no card, no leg)', async ({ page }) => {
    // Drop the Powerwall power reading (function-slug match, never an inlined id).
    await mountScene(page, { dropSlug: 'battery_power' });
    await expect(cells(page)).toHaveCount(4);
    await expect(scene(page).locator('tc-powerwall')).toHaveCount(0);
    await waitForTrunk(page);
    await expect(legs(page)).toHaveCount(4);
    await expect(scene(page).locator('.gw-leg[data-role="powerwall"]')).toHaveCount(0);
  });

  test('AC1c — an essentially-empty hass renders a calm Scene (no crash, no overlay)', async ({
    page,
  }) => {
    await mountScene(page, { empty: true });
    await expect(scene(page).locator('.scene')).toHaveCount(1);
    await expect(cells(page)).toHaveCount(0);
    await expect(overlay(page)).toHaveCount(0);
    await expect(ribbon(page)).toHaveCount(0); // empty Scene ⇒ no ribbon (calm)
    // The auto console-guard asserts the empty mount emitted no errors at teardown.
  });

  // ── Story 6.7 — arbitrary-topology tolerance (minimal → full, pack + re-route) ──

  test('6.7 — minimal Grid+Home packs two adjacent cards with a HORIZONTAL desktop bus', async ({
    page,
  }) => {
    // The minimal energy-flow topology (Vehicle is NOT a flow node). Drop the other
    // three sources/loads' power sensors → only grid (source) + home (load) present.
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { dropSlugs: ['solar_power', 'battery_power', 'wc_power'], width: 1100 });
    await expect(cells(page)).toHaveCount(2);

    const tags = await cells(page).evaluateAll((cs) =>
      cs.map((c) => (c.firstElementChild?.tagName ?? '').toLowerCase()),
    );
    expect(tags).toEqual(['tc-grid', 'tc-home']); // sources-then-loads, present only

    await waitForTrunk(page);
    await expect(legs(page)).toHaveCount(2); // one leg per present node, no ghost leg

    // The two present cards PACK: grid (source) sits strictly above home (load), and
    // their horizontal centres are near-aligned (each row centres its single card) —
    // NOT two lonely cards in opposite corners of a three-column grid (which would put
    // their centres ~900px apart). This is the "no ghost space" proof (AC2).
    const boxes = await cells(page).evaluateAll((cs) =>
      cs.map((c) => {
        const r = c.getBoundingClientRect();
        return { role: (c as HTMLElement).dataset.node, cx: r.left + r.width / 2, top: Math.round(r.top) };
      }),
    );
    const gridCell = boxes.find((b) => b.role === 'grid')!;
    const homeCell = boxes.find((b) => b.role === 'home')!;
    expect(gridCell.top).toBeLessThan(homeCell.top); // source over load
    expect(Math.abs(gridCell.cx - homeCell.cx)).toBeLessThan(200); // centred/packed, not opposite corners

    // The desktop trunk stays HORIZONTAL even at this near-degenerate 1-source/1-load
    // topology — the axis follows the breakpoint (Task 2), not the collapsed spread.
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // constant y ⇒ horizontal
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50); // real left→right span
  });

  test('6.7 — an absent SOURCE card packs the row (no dead column) and the bus re-routes', async ({
    page,
  }) => {
    // A mid-size subset: Solar absent → the source row packs Powerwall+Grid adjacent,
    // with NO leading 380px ghost cell where Solar was (the reflow-around-a-gap proof).
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { dropSlug: 'solar_power', width: 1100 });
    await expect(cells(page)).toHaveCount(4);
    await expect(scene(page).locator('tc-solar')).toHaveCount(0);
    await waitForTrunk(page);
    await expect(legs(page)).toHaveCount(4); // four legs, no ghost leg for Solar

    // The source row now holds exactly its two present cards, packed adjacent: their
    // centres are within one packed column (≈ card + gap), NOT a dropped-cell gap apart.
    const srcXs = await scene(page)
      .locator('.source-row .scene-cell')
      .evaluateAll((cs) =>
        cs.map((c) => {
          const r = c.getBoundingClientRect();
          return Math.round(r.left + r.width / 2);
        }),
      );
    expect(srcXs).toHaveLength(2);
    expect(Math.abs(srcXs[1] - srcXs[0])).toBeLessThan(380 + 80 + 40); // adjacent, no 380px dead column

    // The trunk re-routes around the gap and stays horizontal on the wide desktop.
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // constant y ⇒ horizontal
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50);
  });

  test('AC4 — disconnecting the Scene tears down cleanly under live reflow', async ({ page }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // Remove the element, then storm the page with resizes: a leaked ResizeObserver
    // or rAF on the detached element would surface as a console/page error (guarded).
    await page.evaluate(() => document.getElementById('scene-host')!.remove());
    for (const w of [800, 1200, 600]) {
      await page.setViewportSize({ width: w, height: 720 });
    }
    await expect(scene(page)).toHaveCount(0);
  });
});
