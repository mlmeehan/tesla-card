// [NFR-3 matrix axis: renders mobile + desktop] — Story 7.4 traceability marker
// (375/500px phone vs 1280px desktop axis-selection sweep).
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
import { test, expect, AWAKE, ASLEEP } from '../support/fixtures';
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
  /**
   * Extra config keys merged into `setConfig({ type: 'tc-my-home', ... })`. Used by
   * the Story 9.1 block to mount the live Scene WITH an `energy.nodes` block (well-
   * formed or garbage) and prove the additive schema is inert at the real-layout tier.
   * Cast through `unknown` so garbage shapes can be exercised the way a stale/future
   * YAML would deliver them.
   */
  config?: Record<string, unknown>;
  /**
   * Extra hass states merged into the base map (Story 9.14) — used to inject a
   * synthetic generator output sensor so the live Scene renders the NEW copper source
   * node TYPE. Keyed by entity-id; the generator card resolves it by function-slug
   * (`generator_power`), exactly as `data/energy` does.
   */
  inject?: Record<string, unknown>;
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
    const hass = { ...base, states: { ...states, ...(o.inject ?? {}) } };

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
    scene.setConfig({ type: 'tc-my-home', ...(o.config ?? {}) });
    scene.hass = hass;
    host.appendChild(scene as unknown as HTMLElement);
  }, opts);
}

const scene = (page: Page) => page.locator('tc-my-home');
// The ENERGY ecosystem cells/legs only — the shared 6.6/6.7 assertions are about the
// five flow nodes, so they exclude the Story-8.5/8.10 vehicle cell (a
// `.scene-cell[data-node="vehicle"]`, the trailing load-row cell since Story 8.10) +
// its WC→Vehicle overlay leg (`.gw-leg[data-role="vehicle"]`, a horizontal in-line edge).
// The vehicle is asserted directly by those attributes in the Story-8.5/8.10 block below
// (mirrors the jsdom suite's `:not([data-node="vehicle"])` scoping).
const cells = (page: Page) => scene(page).locator('.scene-cell:not([data-node="vehicle"])');
const legs = (page: Page) => scene(page).locator('.gw-leg:not([data-role="vehicle"])');
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

    // The ribbon leads with the self-powered cap and carries the per-node aggregate
    // tiles (copy from STRINGS, not inlined). NB: Story 8.7 REPLACED the original
    // Generation/Consumption/Net aggregates with the "Self-powered now" % lead + the
    // per-node tiles (Solar/Battery/Grid/Home/Car); this 6.6 assertion was left stale
    // by that change and is corrected to the current copy by the Story 8.8 R6 depth audit.
    const txt = (await ribbon(page).textContent()) ?? '';
    expect(txt).toMatch(/Self-powered/i); // the 8.7 lead cap
    expect(txt).toMatch(/Solar|Battery|Grid|Home|Car/i); // ≥1 per-node aggregate tile label
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

  test('Story 9.14 — a present generator renders a copper SOURCE card + a real bus tap', async ({
    page,
  }) => {
    // Inject a synthetic generator output sensor (resolved by the `generator_power`
    // function-slug, exactly like data/energy). The Scene must pack it into the source
    // band, embed the tc-generator child, and draw its tap leg at a live anchor.
    await mountScene(page, {
      width: 1100,
      inject: {
        'sensor.my_home_generator_power': {
          entity_id: 'sensor.my_home_generator_power',
          state: '3.4',
          attributes: { unit_of_measurement: 'kW', device_class: 'power' },
          last_changed: new Date().toISOString(),
          last_updated: new Date().toISOString(),
        },
      },
    });
    const genCell = scene(page).locator('.source-row .scene-cell[data-node="generator"]');
    await expect(genCell).toHaveCount(1);
    await expect(genCell.locator('tc-generator')).toHaveCount(1);
    // The copper source accent rides as the cell's --node-accent (a real computed value).
    const accent = await genCell
      .locator('.surface')
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--node-accent').trim());
    expect(accent).not.toBe('');
    // Its bus tap is drawn at a live anchor once the geometry recompute lands.
    await waitForTrunk(page);
    await expect(scene(page).locator('.gw-leg[data-role="generator"]')).toHaveCount(1);
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
    // NB: the wall_connector is present-gated by its `total_power` sensor (the energy
    // resolver's `wc_power: has ['total_power']`), so dropping it uses that slug — the
    // real WC power id is `…wall_connector_total_power`, which has no `wc_power` text.
    // Also drop `battery_level` so the Story-8.5 vehicle cell is absent — it would
    // otherwise sit beside Home in the load row and skew this energy-packing geometry
    // (the vehicle's own packing is proven in the Story-8.5 block).
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, {
      dropSlugs: ['solar_power', 'battery_power', 'total_power', 'battery_level'],
      width: 1100,
    });
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
    // The KEY proof is `y1 ≈ y2` (horizontal, NOT the phone's vertical re-route); the
    // span is intrinsically SMALL here because the two packed cards are centre-aligned
    // (source over load), so the horizontal trunk is short — it is still a real
    // left→right segment (x-span > 0), never a vertical line (which would be x-span ≈ 0).
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // constant y ⇒ horizontal
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(10); // a real (if short) left→right span
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

// ═══════════════════════════════════════════════════════════════════════════
// Story 8.5 — the vehicle node in the "My Home" Scene, the LIVE-LAYOUT proof.
//
// The co-located jsdom suite (`src/components/my-home.test.ts`) pins the WIRING +
// the pure agreement (`wcVehicleEdge` is the ONE source the cell badge + the
// WC→Vehicle overlay edge consume; the anchor exclusion; the slice-gate). But
// jsdom returns ZERO-sized rects and applies NO stylesheet, so it cannot prove the
// things ONLY a real layout engine + a real interaction produce: the vehicle cell
// laid out as the compact embedded card in the TRAILING load-row cell (Story 8.10)
// with a real box, the WC→Vehicle leg drawn at LIVE `getBoundingClientRect()` anchors
// as a single in-line leg (horizontal across the inter-card gap on desktop, a vertical
// drop down the collapsed gap at ≤540px), and the focus coupling as REAL computed opacity
// (vehicle ⇄ wall_connector light; the rest dim). This spec is that proof, under
// the auto console-error guard. Entity ids are matched by FUNCTION-SLUG substring
// (never inlined), mirroring `data/energy`.
// ═══════════════════════════════════════════════════════════════════════════

const vehCell = (page: Page) => scene(page).locator('.scene-cell[data-node="vehicle"]');
const vehLeg = (page: Page) => scene(page).locator('.gw-leg[data-role="vehicle"]');
const wcCell = (page: Page) => scene(page).locator('.scene-cell[data-node="wall_connector"]');

test.describe('tc-my-home Scene — Story 8.5 vehicle node (live layout)', () => {
  test.beforeEach(async ({ demo }) => {
    // AWAKE / charging: the demo hass carries the vehicle entities (battery 72%,
    // 235 mi, Charging) + the live energy site, so the vehicle cell + a flowing
    // WC→Vehicle edge both render.
    await demo.open(AWAKE.open);
  });

  // ── AC1 — the vehicle is the compact tesla-card as the TRAILING load-row cell (Story 8.10) ─

  test('AC1 — a present car renders the compact tesla-card as the LAST load-row cell (real geometry)', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // The cell exists exactly once and is keyboard-focusable (the a11y floor).
    await expect(vehCell(page)).toHaveCount(1);
    expect(await vehCell(page).getAttribute('tabindex')).toBe('0');

    // It has a real, non-zero box — jsdom cannot produce this (a genuine layout ran).
    const box = await vehCell(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // It IS a load-row cell again (Story 8.10 reverts the 8.9 own-row band) — and the
    // LAST one, after Home · Wall Connector. There is NO `.vehicle-row` band.
    await expect(scene(page).locator('.load-row .scene-cell[data-node="vehicle"]')).toHaveCount(1);
    await expect(scene(page).locator('.vehicle-row')).toHaveCount(0);
    const lastLoadNode = await scene(page)
      .locator('.load-row > .scene-cell')
      .last()
      .getAttribute('data-node');
    expect(lastLoadNode).toBe('vehicle');

    const geo = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      const rect = (sel: string) => {
        const r = root.querySelector(sel)!.getBoundingClientRect();
        return { cx: r.left + r.width / 2, top: Math.round(r.top), bottom: Math.round(r.bottom), height: r.height };
      };
      return { veh: rect('.scene-cell[data-node="vehicle"]'), wc: rect('.scene-cell[data-node="wall_connector"]') };
    });
    // The vehicle is in line with the WC (the same load row): their tops align within a
    // couple px, and the vehicle sits to the RIGHT of the WC (the trailing packed cell).
    expect(Math.abs(geo.veh.top - geo.wc.top)).toBeLessThanOrEqual(2);
    expect(geo.veh.cx).toBeGreaterThan(geo.wc.cx);

    // It reuses the detailed `tesla-card` (compact variant) — the hero renders inside the
    // cell (a shadow-piercing text match; the battery/charge reads are covered by the
    // hero suite). The name is the most stable single-node text.
    await expect(vehCell(page).locator('tesla-card')).toHaveCount(1);
    await expect(vehCell(page).getByText('Model Y').first()).toBeVisible();
  });

  // ── AC2 — the WC edge IS the car-charging edge, drawn at LIVE anchors ──────────

  test('AC2 — the WC→Vehicle edge draws at live anchors and AGREES with the cell badge', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // The overlay edge exists, with the always-present calm base + (charging) an
    // animated `sb-flow` dash. The cell shows "Charging · N.N kW" — the same source.
    await expect(vehLeg(page)).toHaveCount(1);
    await expect(vehLeg(page).locator('.gw-leg-base')).toHaveCount(1);
    await expect(vehLeg(page).locator('.sb-flow')).toHaveCount(1); // active ⇒ dash

    // The embedded card's hero shows the SAME charge read (one wcVehicleEdge source),
    // so the cell badge and the overlay edge agree by construction.
    await expect(vehCell(page).getByText(/charging/i).first()).toBeVisible();

    // Story 8.10: the base is a single horizontal `<line>` at the cards' shared cross-y
    // (the WC's vehicle-facing side-edge → the vehicle's WC-facing side-edge), not a drop
    // polyline. Read x1/y1/x2/y2 and prove it ran HORIZONTALLY across a real, non-zero
    // span — proof it consumed live geometry (jsdom would collapse the coords onto 0).
    const seg = await vehLeg(page)
      .locator('.gw-leg-base')
      .evaluate((l) => ({
        x1: Number(l.getAttribute('x1')),
        y1: Number(l.getAttribute('y1')),
        x2: Number(l.getAttribute('x2')),
        y2: Number(l.getAttribute('y2')),
      }));
    expect(Math.abs(seg.y2 - seg.y1)).toBeLessThanOrEqual(1); // horizontal: constant y
    expect(Math.abs(seg.x2 - seg.x1)).toBeGreaterThan(20); // a real WC→vehicle run
    // The line runs TOWARD the vehicle (WC is left of the vehicle in the packed row).
    const cx = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      const mid = (sel: string) => {
        const r = root.querySelector(sel)!.getBoundingClientRect();
        return r.left + r.width / 2;
      };
      return {
        wc: mid('.scene-cell[data-node="wall_connector"]'),
        veh: mid('.scene-cell[data-node="vehicle"]'),
      };
    });
    expect(cx.wc < cx.veh ? seg.x2 > seg.x1 : seg.x2 < seg.x1).toBe(true);
  });

  // ── AC6/AC9 — the compact embed fits the 380px load-row track (the variant's reason) ─

  test('AC6/AC9 — the compact vehicle cell fits the 380px track (width parity, no overflow, ≥44×44)', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    const vehBox = await vehCell(page).boundingBox();
    const wcBox = await wcCell(page).boundingBox();
    expect(vehBox).not.toBeNull();
    expect(wcBox).not.toBeNull();
    // The cell is PINNED to the 380px grid track — not merely "as wide as the WC cell"
    // (that parity is trivially true since both are fixed 380px tracks and tells us
    // nothing). The compact card must NOT widen its cell past the column: the host's own
    // 1080px .root cap must not apply once width:100% fills the track. jsdom collapses
    // every box to 0, so only a REAL layout catches a re-widening regression.
    expect(Math.abs(vehBox!.width - wcBox!.width)).toBeLessThanOrEqual(2);
    expect(vehBox!.width).toBeGreaterThanOrEqual(378);
    expect(vehBox!.width).toBeLessThanOrEqual(382);
    // No horizontal overflow at EITHER scope the variant must keep inside the track: the
    // CELL itself (it would scroll if the card content forced it wider than the 380px
    // track) AND the embedded card's inner .root (it would scroll if the hero/status
    // overflowed the column). The inner-.root probe alone is NOT enough — it cannot see
    // the cell-vs-track fit, the actual thing the compact variant exists to guarantee.
    const fit = await vehCell(page).evaluate((cell) => {
      const card = cell.querySelector('tesla-card') as HTMLElement | null;
      const root = (card?.shadowRoot?.querySelector('.root') ?? card) as HTMLElement | null;
      return {
        cell: cell.scrollWidth - cell.clientWidth,
        host: card ? card.scrollWidth - card.clientWidth : 0,
        root: root ? root.scrollWidth - root.clientWidth : 0,
      };
    });
    expect(fit.cell).toBeLessThanOrEqual(1);
    expect(fit.host).toBeLessThanOrEqual(1);
    expect(fit.root).toBeLessThanOrEqual(1);
    // The a11y floor — the focusable cell stays ≥44×44.
    expect(vehBox!.width).toBeGreaterThanOrEqual(44);
    expect(vehBox!.height).toBeGreaterThanOrEqual(44);
  });

  // ── AC1/AC2 — focus coupling as REAL computed opacity (jsdom can't see this) ───

  test('AC3 — focusing the VEHICLE lights {vehicle, wall_connector} and DIMS the rest (real opacity)', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    await vehCell(page).hover();
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);

    // The vehicle's only feed is the Wall Connector — focusing it lights exactly
    // {vehicle, wall_connector}; every other card dims. REAL computed opacity.
    const lit = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      const out = { litNodes: [] as (string | undefined)[], dimOpacities: [] as number[], litOpacities: [] as number[] };
      root.querySelectorAll<HTMLElement>('.scene-cell').forEach((c) => {
        const op = Number(getComputedStyle(c).opacity);
        if (c.classList.contains('lit')) {
          out.litNodes.push(c.dataset.node);
          out.litOpacities.push(op);
        } else {
          out.dimOpacities.push(op);
        }
      });
      return out;
    });
    expect(new Set(lit.litNodes)).toEqual(new Set(['vehicle', 'wall_connector']));
    expect(lit.litOpacities.every((o) => o === 1)).toBe(true);
    expect(lit.dimOpacities.length).toBeGreaterThan(0);
    expect(lit.dimOpacities.every((o) => o < 1)).toBe(true);
  });

  test('AC3 — focusing the WALL CONNECTOR also lights the vehicle (the WC edge feeds it)', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    await wcCell(page).hover();
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);

    const litNodes = await scene(page).evaluate((el) =>
      [...(el as HTMLElement).shadowRoot!.querySelectorAll<HTMLElement>('.scene-cell.lit')].map(
        (c) => c.dataset.node,
      ),
    );
    // A LOAD lights all sources + itself; the vehicle rides along on the WC.
    expect(litNodes).toContain('wall_connector');
    expect(litNodes).toContain('vehicle');
  });

  // ── AC4 — arbitrary-topology: an absent car omits the cell AND its edge ────────

  test('AC4 — an absent car omits the vehicle cell AND its WC→Vehicle leg (rest unchanged)', async ({
    page,
  }) => {
    // Drop the vehicle battery entity (function-slug match) → not present.
    await mountScene(page, { dropSlug: 'battery_level' });
    await waitForTrunk(page);

    await expect(vehCell(page)).toHaveCount(0); // no cell
    await expect(vehLeg(page)).toHaveCount(0); // no WC→Vehicle leg

    // The five energy ecosystem cards are intact — minimal-to-full topology holds.
    await expect(cells(page)).toHaveCount(5);
    const tags = await cells(page).evaluateAll((cs) =>
      cs.map((c) => (c.firstElementChild?.tagName ?? '').toLowerCase()),
    );
    expect(tags).toEqual(['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector']);
  });
});

test.describe('tc-my-home Scene — Story 8.5 vehicle: half-alive (asleep) is calm, not broken', () => {
  test.beforeEach(async ({ demo }) => {
    // ASLEEP: the car sleeps (battery reads `unavailable`, present) while the local
    // energy site stays LIVE — the NORMAL half-alive state (FR-34).
    await demo.open(ASLEEP.open);
  });

  test('AC3 — asleep car: the embedded detailed card degrades calm (Asleep), the WC→Vehicle edge is quiescent', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // The cell still renders (an asleep battery is `unavailable`, which IS present),
    // REUSING the detailed `tesla-card` — which owns its own calm asleep read.
    await expect(vehCell(page)).toHaveCount(1);
    await expect(vehCell(page).locator('tesla-card')).toHaveCount(1);
    await expect(vehCell(page).getByText(/asleep/i).first()).toBeVisible();

    // The WC→Vehicle edge degrades to its calm read — no animated `sb-flow` dash
    // (the scene-level "never a false charge").
    await expect(vehLeg(page).locator('.sb-flow')).toHaveCount(0);
  });

  test('Story 8.11 — the asleep compact embed shows last-known SoC/range (dimmed), not "—"', async ({
    page,
  }) => {
    await mountScene(page);
    await waitForTrunk(page);

    // The embed is variant:'compact', so an asleep car falls back to the cached
    // usable_battery_level (71%) / estimate_battery_range (230 mi) — REAL sensors that
    // survive sleep — instead of blanking the only readout to "—".
    await expect(vehCell(page).getByText('71%').first()).toBeVisible();
    await expect(vehCell(page).getByText('230 mi').first()).toBeVisible();

    // The readout is MARKED stale in a REAL browser (the only tier that renders the
    // CSS cascade): the row carries .last-known + the numbers .tc-stale-copy, and the
    // headline % resolves to the dim token via --bat-pct-color — the exact property
    // jsdom cannot verify (it does not resolve var()/cascade).
    await expect(vehCell(page).locator('.battery.last-known')).toHaveCount(1);
    await expect(vehCell(page).locator('.bat-top.tc-stale-copy')).toHaveCount(1);
    const pctColor = await vehCell(page)
      .locator('.bat-pct')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(pctColor).toBe('rgb(154, 167, 184)'); // --tc-text-dim (#9aa7b8), NOT the live --tc-text white

    // a11y parity: the battery aria-label says the value is last-known, never live.
    const aria = await vehCell(page).locator('.battery').getAttribute('aria-label');
    expect(aria?.toLowerCase()).toContain('last known');

    // The honest stamp still reads "updated 47m ago" — sourced from the SHOWN cached
    // sensor (back-dated like the car), never a fabricated fresh "Just now".
    await expect(vehCell(page).getByText(/updated 47m ago/i).first()).toBeVisible();
  });

  // Story 11.1 — the asleep COMPACT EMBED is the PRIMARY real-world case (the cell is
  // asleep almost all the time, my-home.ts:1106 / hero.ts:217-218), so closing the AC1
  // "render keeps hue" contract for the embed matters more than for the standalone card.
  // hero.spec.ts pins the standalone full card; this pins the embed. jsdom cannot
  // resolve a computed `filter`, so a real-browser proof is the only tier that catches
  // a regression re-grayscaling the embedded render. The compact embed SUPPRESSES the
  // Flow overlay (compact ⇒ nothing, hero.ts:313), so the render WAS the only thing the
  // old grayscale(1) hit — exactly the node that turned a dark preset near-black.
  test('Story 11.1 — the asleep compact embed keeps its paint hue (opacity dim, NO grayscale on the render)', async ({
    page,
  }) => {
    // Hand the embed the exact dark preset (red #9e2228) that collapsed to near-black
    // under the old grayscale(1). The my-home top-level `paint` flows into the embed via
    // `{ ...this._config, ...c.config, variant: 'compact' }` (my-home.ts:1106).
    await mountScene(page, { config: { paint: '#9e2228' } });
    await waitForTrunk(page);

    const stage = vehCell(page).locator('.car-stage');
    // The stage carries the opacity-dim marker, never the bare grayscale recipe class…
    await expect(stage).toHaveClass(/\basleep\b/);
    await expect(stage).not.toHaveClass(/\btc-asleep\b/);
    await expect(stage).toHaveCSS('opacity', '0.5');
    // …and the stage itself is NOT grayscaled (the over-broad filter the fix re-scoped off).
    await expect(stage).not.toHaveCSS('filter', /grayscale/);

    // The render keeps its resolved red AND carries no grayscale in its computed filter
    // (only its own drop-shadow) — a DIM RED, not near-black. This is the embed-tier
    // proof that AC1's "whole vehicle render keeps its hue" holds where the bug lived.
    const render = stage.locator('svg').first();
    await expect(render).toHaveAttribute('style', /--tc-paint:\s*#9e2228/);
    await expect(render).not.toHaveCSS('filter', /grayscale/);
  });
});

// ── Story 8.12 — gw-term anchors at the card's VISIBLE bottom (live layout) ─────────
// The ONLY tier that proves the fix: jsdom has zero layout, so the source-row align flip
// is invisible there. Here, in real Chromium, the short Solar cell genuinely shrinks to
// content under align-items:start, so its terminal rises to the visible bottom and the
// source row reads with RAGGED bottoms — while the inter-row trunk Y holds (the existing
// AC2/AC4 trunk-Y assertions above are the guard, unchanged).
test.describe('tc-my-home Scene — Story 8.12: gw-term anchors at the card visible bottom', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC1 — the Solar terminal sits at the Solar card VISIBLE bottom (ragged row), not in ballooned dead space', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);

    // Geometry in the overlay's container space (the `.scene` box — the overlay has no
    // viewBox and draws relative to it, exactly as `relativeAnchors` subtracts the host top).
    const geom = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      const sceneTop = root.querySelector('.scene')!.getBoundingClientRect().top;
      const bottomOf = (sel: string) =>
        root.querySelector(sel)!.getBoundingClientRect().bottom - sceneTop;
      return {
        solarBottom: bottomOf('.scene-cell[data-node="solar"]'),
        powerwallBottom: bottomOf('.scene-cell[data-node="powerwall"]'),
      };
    });
    const solarTermCy = Number(
      await scene(page).locator('.gw-leg[data-role="solar"] .gw-term').first().getAttribute('cy'),
    );

    // RAGGED bottoms — the red→green discriminator. Before 8.12, align-items:stretch
    // ballooned Solar to its taller row-mate Powerwall's height, so both source cells
    // shared an EQUAL bottom; after, align:start shrinks Solar to its own content, so it
    // ends well ABOVE the taller Powerwall.
    expect(geom.solarBottom).toBeLessThan(geom.powerwallBottom - 20);
    // AC1: the terminal anchors at Solar's OWN visible bottom (within a few px — the ring
    // `cy` IS the cell's near edge `rect.top + rect.height`, now honest after the shrink).
    expect(Math.abs(solarTermCy - geom.solarBottom)).toBeLessThanOrEqual(5);
    // …and therefore the ring sits well above where the old ballooned bottom dropped it —
    // no dead gap between the visible Solar artwork and its terminal.
    expect(solarTermCy).toBeLessThan(geom.powerwallBottom - 20);
  });

  test('AC2 — the inter-row trunk Y is unchanged by the align flip (still a horizontal trunk between the rows)', async ({
    page,
  }) => {
    // The bus trunk Y is invariant to align-items (the row TRACK height = the tallest
    // card's height either way), so the existing AC2/AC4 trunk-Y guards hold. Re-assert
    // the trunk is a real horizontal rail BETWEEN the source and load rows here too.
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // horizontal: constant y
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50); // real left→right span

    // The trunk sits between the source bottoms and the load tops (it did not jump onto a row).
    const rows = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      const sceneTop = root.querySelector('.scene')!.getBoundingClientRect().top;
      const cellBottom = (sel: string) =>
        root.querySelector(sel)!.getBoundingClientRect().bottom - sceneTop;
      const cellTop = (sel: string) =>
        root.querySelector(sel)!.getBoundingClientRect().top - sceneTop;
      return {
        sourceMaxBottom: cellBottom('.scene-cell[data-node="powerwall"]'),
        loadMinTop: cellTop('.scene-cell[data-node="home"]'),
      };
    });
    expect(t.y1).toBeGreaterThan(rows.sourceMaxBottom - 1);
    expect(t.y1).toBeLessThan(rows.loadMinTop + 1);
  });

  test('AC3 — the long Solar leg carries the `.long` conduit class on desktop (short hops do not)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const solarLong = await scene(page)
      .locator('.gw-leg[data-role="solar"] .gw-leg-base')
      .first()
      .evaluate((l) => l.classList.contains('long'));
    expect(solarLong).toBe(true);
    // A short hop (Home — a load card adjacent to the trunk) stays a calm hairline.
    const homeLong = await scene(page)
      .locator('.gw-leg[data-role="home"] .gw-leg-base')
      .first()
      .evaluate((l) => l.classList.contains('long'));
    expect(homeLong).toBe(false);
  });

  test('AC4 — at phone ≤540px NO leg crosses the threshold (the `.long` polish never reaches phone — layout identical to today)', async ({
    page,
  }) => {
    // `.long` is horiz-gated in `_legs` (`horiz && len > LONG_LEG_PX`), so at the ≤540px
    // phone reflow (vertical bus, `_axis === 'y'`) it is suppressed for EVERY leg regardless
    // of length — the phone layout stays identical to today. This count-0 assertion is the
    // real-≤540px-layout backstop; the guard that proves it is the GATE (not merely that no
    // phone leg happens to be long enough) is the unit test "Task 6/AC4" (forced `_axis='y'`,
    // a 300px vertical leg that still stays calm).
    await page.setViewportSize({ width: 500, height: 1000 });
    await mountScene(page, { width: 460 });
    await waitForTrunk(page);
    await expect(scene(page).locator('.gw-leg-base.long')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.7 — `energy.nodes.instances` is CONSUMED at the live Scene tier (the 9.1
// schema hook is now fully read: `hide` by 9.2, `order` by 9.3, `instances` by 9.7).
// The old "inert until 9.7" assertion is retired — a duplicated role renders N live
// cells, while a stale count-shaped value still degrades to today's Scene (R9).
//
// The co-located jsdom corpus (`src/tesla-card.config.test.ts`) already pins the
// four runtime guarantees (tolerated / preserved / garbage-degrades / omitted-is-
// default) and `types.test.ts` pins the static shape. But jsdom returns ZERO-sized
// rects and applies NO stylesheet, so it CANNOT prove the load-bearing SM-C4 / AC2
// claim at the layer that actually matters: that a real user adding `energy.nodes`
// to their YAML sees a My-Home Scene whose LIVE LAYOUT is byte-for-byte today's —
// the same packed cells in the same canonical order, the same Gateway trunk + legs,
// drawn at genuine non-zero geometry — and that even GARBAGE in the new keys leaves
// the real browser console clean (FR-24). This spec is that proof — the seam at which
// `tc-my-home.setConfig` stores `{ ...config }` and feeds `bindFlowModel` is EXACTLY
// where 9.2/9.3 will later consume these keys, so an unchanged Scene here is the
// regression guard that 9.1 shipped the schema with NO behavior. Under the auto
// console-error guard. The well-formed config deliberately names `hide:['solar']`
// and `order:['grid','home']` — keys that WOULD drop/reorder cells if consumed — so
// an identical cell roster is a precise "not consumed in 9.1" assertion, not a vague
// "still renders".
// ═══════════════════════════════════════════════════════════════════════════

// The canonical Scene fingerprint a real layout produces with no customization:
// the five energy cells in source-then-load order + the trailing vehicle cell.
const sceneFingerprint = (page: Page) =>
  scene(page).evaluate((el) => {
    const root = (el as HTMLElement).shadowRoot!;
    const cellNodes = [...root.querySelectorAll<HTMLElement>('.scene-cell')].map(
      (c) => c.dataset.node,
    );
    return {
      cellNodes, // ordered, INCLUDING the vehicle cell
      legCount: root.querySelectorAll('.gw-leg').length,
      hasRibbon: root.querySelector('.ribbon') != null,
      hasTrunk: root.querySelector('.gw-trunk-base') != null,
    };
  });

test.describe('tc-my-home Scene — Story 9.7: energy.nodes.instances is consumed at the live layout tier', () => {
  test.beforeEach(async ({ demo }) => {
    // AWAKE / charging: a live energy site + a present vehicle, so the full Scene
    // (five energy cells + vehicle cell + trunk + legs + ribbon) renders — the
    // richest baseline to prove the additive keys change nothing.
    await demo.open(AWAKE.open);
  });

  test('AC9 — a LIST-shaped energy.nodes.instances is CONSUMED: a duplicated role renders N live cells (a STALE count shape stays inert)', async ({
    page,
  }) => {
    // Baseline: today's single-solar Scene. A single instance keeps the BARE `solar`
    // data-node — FR-33 zero-diff (no `:1` suffix).
    await mountScene(page);
    await waitForTrunk(page);
    const baseline = await sceneFingerprint(page);
    expect(baseline.cellNodes).toEqual([
      'solar',
      'powerwall',
      'grid',
      'home',
      'wall_connector',
      'vehicle',
    ]);

    // 9.7 consumes `instances` at the SAME `flowInputsFrom` seam 9.1 reserved it: two
    // solar instances ⇒ two live cells (`solar:1` / `solar:2`), each its own bus tap —
    // the bare `solar` id is gone (duplicated ⇒ all instances suffixed).
    await mountScene(page, {
      config: { energy: { nodes: { instances: { solar: [{}, {}] } } } },
    });
    await waitForTrunk(page);
    const dup = await sceneFingerprint(page);
    expect(dup.cellNodes).toContain('solar:1');
    expect(dup.cellNodes).toContain('solar:2');
    expect(dup.cellNodes).not.toContain('solar');
    // exactly one MORE leg than baseline (the 2nd solar tap); still one trunk + ribbon.
    expect(dup.legCount).toBe(baseline.legCount + 1);
    expect(dup.hasTrunk).toBe(true);
    expect(dup.hasRibbon).toBe(true);

    // Forward-compat (R9): a STALE count-shaped value (the pre-9.7 placeholder) is a
    // non-array ⇒ treated as "no instances declared" ⇒ today's single bare-id Scene.
    await mountScene(page, {
      config: { energy: { nodes: { instances: { solar: 2 } } } },
    });
    await waitForTrunk(page);
    const stale = await sceneFingerprint(page);
    expect(stale.cellNodes).toEqual(baseline.cellNodes); // byte-for-byte today's roster
    expect(stale.cellNodes).not.toContain('solar:1');

    // The trunk is still drawn at live geometry — a real horizontal rail.
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50);
    // consoleGuard (auto fixture) asserts every mount above emitted no errors.
  });

  test('AC3/FR-24 — GARBAGE in energy.nodes still renders the full Scene at live geometry, console-clean', async ({
    page,
  }) => {
    // The stale/future-YAML shape: wrong-typed and unknown values in every new key,
    // delivered the way a real config would (cast through unknown by the helper).
    await mountScene(page, {
      config: {
        energy: {
          nodes: { hide: ['not_a_node', 42], order: 'nope', instances: { vehicle: 'two' } },
        },
      },
    });
    await waitForTrunk(page);

    // Garbage in EVERY key degrades to "exactly today" — the full roster still renders
    // (auto-detect owns the Scene; garbage is never validated-and-thrown — FR-24/R9 —
    // incl. a non-array `instances`), with real non-zero cell boxes a real layout produced.
    const fp = await sceneFingerprint(page);
    expect(fp.cellNodes).toEqual([
      'solar',
      'powerwall',
      'grid',
      'home',
      'wall_connector',
      'vehicle',
    ]);
    expect(fp.hasTrunk).toBe(true);
    expect(fp.hasRibbon).toBe(true);
    const firstBox = await cells(page).first().boundingBox();
    expect(firstBox).not.toBeNull();
    expect(firstBox!.width).toBeGreaterThan(0);
    expect(firstBox!.height).toBeGreaterThan(0);
    // consoleGuard (auto fixture) is the machine-checked "never crash" assertion for
    // the garbage mount — FR-24 degradation proven in a real browser, not jsdom.
  });

  test('AC5/R9 — energy.nodes survives a real render+update cycle on the live element (round-trip preserved)', async ({
    page,
  }) => {
    // The story's explicit worry: a round-trip through the editor's `config-changed`
    // must not DROP the new keys before 9.2/9.3 read them. jsdom pins the spread on
    // `_config`; here we prove it survives a genuine Lit render + reactive update in a
    // real browser (a different engine than the jsdom corpus runs on).
    const nodes = { hide: ['vehicle'], order: ['solar'], instances: { home: 2 } };
    await mountScene(page, { config: { energy: { nodes } } });
    await waitForTrunk(page);

    const stored = await scene(page).evaluate((el) => {
      const cfg = (el as unknown as { _config?: { energy?: { nodes?: unknown } } })._config;
      return cfg?.energy?.nodes ?? null;
    });
    expect(stored).toEqual(nodes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.2 — hide a present node by config: hidden == absent at the LIVE-LAYOUT tier.
//
// The co-located jsdom suite pins the wiring (a hidden role drops at the shared model,
// the vehicle hide omits cell + edge, the reflow fires once). But jsdom returns ZERO-
// sized rects, so it CANNOT prove the load-bearing CAP-4/AC3 claim where it matters: a
// Scene with `energy.nodes.hide:['solar']` lays out BYTE-FOR-BYTE like the same Scene
// with solar's entity genuinely ABSENT — the same packed cells, the same Gateway trunk
// + legs at the SAME live geometry, the bus re-routed identically around the gap with no
// orphaned tap. This block is that proof, under the auto console-error guard.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('tc-my-home Scene — Story 9.2: a hidden node renders identically to an absent one', () => {
  test.beforeEach(async ({ demo }) => {
    // AWAKE / charging: full five-energy + present vehicle — the richest baseline.
    await demo.open(AWAKE.open);
  });

  test('AC1/AC3 — hide:["solar"] is byte-for-byte == solar genuinely absent (roster, legs, trunk geometry)', async ({
    page,
  }) => {
    // (a) Solar genuinely ABSENT — drop its power sensor by function-slug (no inlined id).
    await mountScene(page, { dropSlug: 'solar_power' });
    await waitForTrunk(page);
    const absentFp = await sceneFingerprint(page);
    const absentTrunk = await trunkLine(page);

    // (b) Solar PRESENT but HIDDEN by config — the Story 9.2 consumption path. The
    // Story 9.10 detected-but-hidden advisory is DISABLED here (`notify_hidden_detected:
    // false`): it deliberately surfaces a hidden-but-LIVE node (so it is NOT zero-diff vs
    // absent — that is its whole point), which would add an amber strip above the grid and
    // shift the live trunk geometry. Disabling it isolates the Story 9.2 LAYOUT-tier
    // invariant (hidden == absent at the roster/legs/trunk geometry) this test proves.
    await mountScene(page, {
      config: { energy: { nodes: { hide: ['solar'] } }, notify_hidden_detected: false },
    });
    await waitForTrunk(page);
    const hiddenFp = await sceneFingerprint(page);
    const hiddenTrunk = await trunkLine(page);

    // Byte-for-byte: identical roster + leg count + ribbon + trunk, AND identical LIVE
    // trunk geometry — the bus re-routed the SAME way around the gap (hidden == absent).
    expect(hiddenFp).toEqual(absentFp);
    expect(hiddenTrunk).toEqual(absentTrunk);
    // Specifically: Solar is gone from BOTH, the rest packed in canonical order.
    expect(hiddenFp.cellNodes).not.toContain('solar');
    expect(hiddenFp.cellNodes).toEqual(['powerwall', 'grid', 'home', 'wall_connector', 'vehicle']);
  });

  test('AC1 — the hidden Solar leaves NO cell and NO bus leg; the trunk stays a real horizontal rail', async ({
    page,
  }) => {
    await mountScene(page, { config: { energy: { nodes: { hide: ['solar'] } } } });
    await waitForTrunk(page);
    await expect(scene(page).locator('.scene-cell[data-node="solar"]')).toHaveCount(0);
    await expect(scene(page).locator('.gw-leg[data-role="solar"]')).toHaveCount(0);
    await expect(legs(page)).toHaveCount(4); // four energy legs remain, no orphaned solar tap
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // constant y ⇒ horizontal
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50); // a real left→right span
  });

  test('AC2 — hide:["vehicle"] omits the vehicle cell AND its WC→Vehicle leg; the WC cell stays', async ({
    page,
  }) => {
    await mountScene(page, { config: { energy: { nodes: { hide: ['vehicle'] } } } });
    await waitForTrunk(page);
    await expect(vehCell(page)).toHaveCount(0); // no presentation cell
    await expect(vehLeg(page)).toHaveCount(0); // no orphaned WC→Vehicle leg
    await expect(wcCell(page)).toHaveCount(1); // the Wall-Connector energy node is untouched
    await expect(cells(page)).toHaveCount(5); // the five energy cells are intact
  });

  test('AC4 — hiding every node collapses to the calm empty Scene: no bus overlay, console-clean', async ({
    page,
  }) => {
    await mountScene(page, {
      config: {
        energy: { nodes: { hide: ['solar', 'powerwall', 'grid', 'home', 'wall_connector', 'vehicle'] } },
      },
    });
    // No overlay (the degenerate single-anchor bus is suppressed), no cells — but the
    // Scene container still renders calm (not blank, not crashed; consoleGuard asserts clean).
    await expect(scene(page).locator('.scene')).toHaveCount(1);
    await expect(cells(page)).toHaveCount(0);
    await expect(vehCell(page)).toHaveCount(0);
    await expect(overlay(page)).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.3 — reorder present nodes WITHIN their row by config, at the LIVE-LAYOUT
// tier. The co-located jsdom suite pins the rendered cell SEQUENCE, but jsdom returns
// ZERO-sized rects, so it CANNOT prove the load-bearing AC1/AC2 claim where it matters:
// reordering the cells moves their DOM anchors, and the Gateway bus FOLLOWS because
// `gatewaySegments` taps sort by SPATIAL position (the anchor centre), NOT by
// `SCENE_NODES`/model order. This block is that proof — the source cells render in the
// configured left→right order at genuine non-zero geometry, and each leg's tap walks
// the bus in that SAME reordered spatial order — under the auto console-error guard.
// ═══════════════════════════════════════════════════════════════════════════

// The source-row cells' `data-node` ordered by their LIVE left edge (the real
// left→right layout order a genuine engine produced — jsdom cannot see this).
const sourceOrderByX = (page: Page) =>
  scene(page).evaluate((el) => {
    const root = (el as HTMLElement).shadowRoot!;
    return [...root.querySelectorAll<HTMLElement>('.source-row .scene-cell')]
      .map((c) => ({ node: c.dataset.node, x: c.getBoundingClientRect().left }))
      .sort((a, b) => a.x - b.x)
      .map((c) => c.node);
  });

// Each present source role → its leg tap centre along the (horizontal) trunk — the
// bus's spatial tap-walk handle. `.gw-tap` cx is container-relative overlay px, so we
// compare ORDERING (not absolute values vs the page-space cell boxes).
const tapXByRole = (page: Page, role: string) =>
  scene(page)
    .locator(`.gw-leg[data-role="${role}"] .gw-tap`)
    .first()
    .evaluate((c) => Number(c.getAttribute('cx')));

test.describe('tc-my-home Scene — Story 9.3: reorder follows live geometry (the bus tracks the moved anchors)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC1/AC2 — order:["grid","solar"] packs the source row [grid, solar, powerwall] AND the bus taps walk that SAME spatial order', async ({
    page,
  }) => {
    // Canonical baseline first: the un-reordered source row is [solar, powerwall, grid].
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    expect(await sourceOrderByX(page)).toEqual(['solar', 'powerwall', 'grid']);

    // Now reorder via config — grid + solar listed (user order), powerwall trails canonical.
    await mountScene(page, { width: 1100, config: { energy: { nodes: { order: ['grid', 'solar'] } } } });
    await waitForTrunk(page);

    // (AC1) The LIVE layout packs the cells in the configured left→right order.
    expect(await sourceOrderByX(page)).toEqual(['grid', 'solar', 'powerwall']);

    // (AC2) The Gateway bus FOLLOWS: each leg's tap sits at its cell's spatial centre,
    // so the taps walk the trunk in the SAME reordered order (grid → solar → powerwall).
    // This is the geometry proof — the bus read the moved anchors, never `SCENE_NODES`.
    const gridTap = await tapXByRole(page, 'grid');
    const solarTap = await tapXByRole(page, 'solar');
    const pwTap = await tapXByRole(page, 'powerwall');
    expect(gridTap).toBeLessThan(solarTap);
    expect(solarTap).toBeLessThan(pwTap);

    // The trunk is still a real horizontal rail spanning the reordered row (no sign flip,
    // no collapsed line) — the energy math is untouched, only the spatial walk reordered.
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.x2 - t.x1)).toBeGreaterThan(50);
  });

  test('AC2 — reorder preserves the Kirchhoff-honest roster: same leg count + the bus still names every present node (colour-blind floor)', async ({
    page,
  }) => {
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const baseLegs = await legs(page).count();
    const baseLabel = await overlay(page).getAttribute('aria-label');

    await mountScene(page, { width: 1100, config: { energy: { nodes: { order: ['grid', 'solar'] } } } });
    await waitForTrunk(page);

    // Reordering is a VIEW over the same present set: no node gained or lost, no edge
    // re-signed. The leg count is identical and the overlay's state-bearing label (built
    // from the canonical model, not render order) still names every node + kW unchanged.
    expect(await legs(page).count()).toBe(baseLegs);
    expect(await overlay(page).getAttribute('aria-label')).toBe(baseLabel);
  });

  test('AC4 — order:["vehicle","home"] places the car BEFORE home/WC at live geometry; its WC→Vehicle leg follows', async ({
    page,
  }) => {
    await mountScene(page, { width: 1100, config: { energy: { nodes: { order: ['vehicle', 'home'] } } } });
    await waitForTrunk(page);

    // The vehicle cell lays out as the LEFTMOST load-row cell (it moved within its row).
    const loadOrder = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      return [...root.querySelectorAll<HTMLElement>('.load-row .scene-cell')]
        .map((c) => ({ node: c.dataset.node, x: c.getBoundingClientRect().left }))
        .sort((a, b) => a.x - b.x)
        .map((c) => c.node);
    });
    expect(loadOrder).toEqual(['vehicle', 'home', 'wall_connector']);

    // It remains a presentation cell with its WC→Vehicle overlay leg intact (drawn from
    // the cell's live anchor wherever it landed) — the edge followed the moved cell.
    await expect(vehCell(page)).toHaveCount(1);
    await expect(vehLeg(page)).toHaveCount(1);
  });

  test('AC4/FR-24 — GARBAGE order (non-array) renders the canonical Scene at live geometry, console-clean', async ({
    page,
  }) => {
    await mountScene(page, { width: 1100, config: { energy: { nodes: { order: 'nope' } } } });
    await waitForTrunk(page);
    // Degrades to today's canonical packing — no crash, no blank (consoleGuard asserts clean).
    expect(await sourceOrderByX(page)).toEqual(['solar', 'powerwall', 'grid']);
    await expect(cells(page)).toHaveCount(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.7 — multi-instance WRAP overflow (AC5 / D15). The pixel-geometry tier the
// jsdom suite cannot reach: a band over 3 cards splits into a primary + an offset
// overflow sub-row whose legs comb to the ONE Gateway trunk WITHOUT crossing a
// primary card. Two solar instances (both resolving the same sensor — the GEOMETRY
// is under test, not distinct values) ⇒ 4 source cards ⇒ wrap. Under the auto
// console-error guard.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('tc-my-home Scene — Story 9.7: multi-instance wrap overflow (AC5)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  const wrapCfg = { energy: { nodes: { instances: { solar: [{}, {}] } } } };

  test('AC5 — the 4-source band wraps; the overflow leg combs to ONE trunk through a channel (no crossing)', async ({
    page,
  }) => {
    await mountScene(page, { width: 1400, config: wrapCfg });
    await waitForTrunk(page);

    // The duplicated solar gives solar:1 / solar:2 → 4 sources → the band WRAPS.
    const band = scene(page).locator('.source-row');
    await expect(band).toHaveClass(/wrapped/);
    const primaryCells = scene(page).locator('.subrow.primary .scene-cell');
    const overflowCells = scene(page).locator('.subrow.overflow .scene-cell');
    await expect(primaryCells).toHaveCount(3);
    await expect(overflowCells).toHaveCount(1);

    // ONE trunk, horizontal (AR-7 — a 2nd tap-Y + longer legs, never a 2nd trunk).
    await expect(trunk(page)).toHaveCount(1);
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1);

    // The overflow card keeps standalone width (never shrunk below the 380px track).
    const overflowBox = await overflowCells.first().evaluate((c) => {
      const r = c.getBoundingClientRect();
      return { centerX: r.left + r.width / 2, width: r.width, top: r.top };
    });
    expect(overflowBox.width).toBeGreaterThanOrEqual(360);

    // NO-CROSS: the overflow card's centre-x (where its leg drops) falls in a CHANNEL
    // between primary cards — outside every primary card's horizontal extent — so the
    // leg combs straight down to the trunk without passing through a primary card.
    const primaryBoxes = await primaryCells.evaluateAll((cs) =>
      cs.map((c) => {
        const r = c.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
      }),
    );
    for (const b of primaryBoxes) {
      expect(
        overflowBox.centerX < b.left - 1 || overflowBox.centerX > b.right + 1,
        `overflow centre ${overflowBox.centerX} must sit in a channel, not within [${b.left},${b.right}]`,
      ).toBe(true);
      // AC7 — cards never shrink below standalone size (the 380px track) under wrap, so
      // every focus target stays well over the 44×44 CSS-px floor.
      expect(b.width).toBeGreaterThanOrEqual(360);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }

    // The overflow sub-row is the FAR (top) row — visually ABOVE the primary, so its
    // legs are the long comb legs and the primary sits just above the trunk.
    expect(overflowBox.top).toBeLessThan(primaryBoxes[0].top);

    // The wrap path shows NO overflow notice — it just reflows taller (clamp is 9.8).
    await expect(scene(page).locator('.clamp-note')).toHaveCount(0);
  });

  test('AC5 — every source leg (incl. the overflow comb) reaches the single trunk; the longer combs earn .long (9.6 LONG_LEG_PX holds)', async ({
    page,
  }) => {
    await mountScene(page, { width: 1400, config: wrapCfg });
    await waitForTrunk(page);

    // 4 present source taps + 2 loads = 6 energy legs, all to the one trunk.
    await expect(legs(page)).toHaveCount(6);
    // The far overflow comb spans well over LONG_LEG_PX (160) → .long; the primary
    // legs stay short/calm — so the existing 9.6 threshold needs NO retune.
    await expect(scene(page).locator('.gw-leg-base.long')).not.toHaveCount(0);
  });

  test('AC5 — at phone (≤540px viewport) the band does NOT wrap into channels — one vertical column', async ({
    page,
  }) => {
    // The wrap reset is a genuine `@media (max-width:540px)` rule (keyed on the VIEWPORT,
    // like the rest of the Scene's phone reflow) — so narrow the viewport, not just the host.
    await page.setViewportSize({ width: 500, height: 1100 });
    await mountScene(page, { width: 460, config: wrapCfg });
    await waitForTrunk(page);
    // The wrapped DOM still exists, but the ≤540px reset drops the offset + order flip:
    // every source card stacks in one column. Assert the overflow card is NOT pushed into
    // a channel (its left edge aligns with the primary cards' — no 230px horizontal offset).
    const primaryLeft = await scene(page)
      .locator('.subrow.primary .scene-cell')
      .first()
      .evaluate((c) => c.getBoundingClientRect().left);
    const overflowLeft = await scene(page)
      .locator('.subrow.overflow .scene-cell')
      .first()
      .evaluate((c) => c.getBoundingClientRect().left);
    expect(Math.abs(overflowLeft - primaryLeft)).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.8 — multi-vehicle overflow hardening (the LIVE-LAYOUT tier). Two cars wrap
// the load row exactly as 9.7's energy wrap does (a vehicle in the overflow position
// routes correctly); and the AC8 defensive ≈0-kW clamp hides ONLY dead excess cards
// behind an honest "Show all" toggle — never a card carrying live kW (the phantom
// INV-1 forbids). Both bare cars resolve the SAME battery (geometry under test, not
// distinct values). Under the auto console-error guard.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('tc-my-home Scene — Story 9.8: multi-vehicle wrap + ≈0-kW clamp guard', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  const twoCarCfg = { energy: { nodes: { instances: { vehicle: [{ title: 'Model Y' }, { title: 'Garage' }] } } } };

  test('AC4 — home + WC + 2 cars (4 load cards) WRAPS; a vehicle rides the overflow sub-row', async ({
    page,
  }) => {
    await mountScene(page, { width: 1400, config: twoCarCfg });
    await waitForTrunk(page);

    const band = scene(page).locator('.load-row');
    await expect(band).toHaveClass(/wrapped/);
    // Two veh-cells with distinct per-instance data-node ids.
    await expect(scene(page).locator('.scene-cell.veh-cell')).toHaveCount(2);
    await expect(scene(page).locator('.scene-cell[data-node="vehicle:1"]')).toHaveCount(1);
    await expect(scene(page).locator('.scene-cell[data-node="vehicle:2"]')).toHaveCount(1);
    // A car lands in the overflow sub-row (the 4th cell after home·wc·car1).
    const overflowVeh = scene(page).locator('.subrow.overflow .scene-cell.veh-cell');
    await expect(overflowVeh).toHaveCount(1);
    // It keeps the standalone track (never shrunk below ~360px) and never overflows the host.
    const box = await overflowVeh.first().evaluate((c) => {
      const r = c.getBoundingClientRect();
      return { width: r.width, right: r.right };
    });
    expect(box.width).toBeGreaterThanOrEqual(360);
    const hostRight = await page.locator('#scene-host').evaluate((h) => h.getBoundingClientRect().right);
    expect(box.right).toBeLessThanOrEqual(hostRight + 1); // no horizontal overflow

    // The NORMAL 2-car wrap shows NO clamp notice (within the 2-sub-row safe capacity).
    await expect(scene(page).locator('.clamp-note')).toHaveCount(0);
  });

  test('AC5/AC4 — each car owns its OWN live-anchored WC→Vehicle overlay edge; the overflow car\'s edge tracks it to the 2nd sub-row', async ({
    page,
  }) => {
    await mountScene(page, { width: 1400, config: twoCarCfg });
    await waitForTrunk(page);

    // One WC→Vehicle overlay leg PER car, each keyed by its per-instance id (AC5). The
    // single shared WC feeds both (single-WC fallback), but each car gets its OWN edge —
    // the co-located jsdom suite proves the two legs EXIST (`data-role` vehicle:1 / :2);
    // only a real layout proves they were drawn at two DISTINCT live anchor positions
    // (jsdom collapses every rect to 0, so both legs would coincide at the origin there).
    const veh1 = scene(page).locator('.scene-bus .gw-leg[data-role="vehicle:1"]');
    const veh2 = scene(page).locator('.scene-bus .gw-leg[data-role="vehicle:2"]');
    await expect(veh1).toHaveCount(1);
    await expect(veh2).toHaveCount(1);

    const baseOf = (leg: ReturnType<typeof scene>) =>
      leg.locator('.gw-leg-base').evaluate((l) => {
        const x1 = Number(l.getAttribute('x1'));
        const y1 = Number(l.getAttribute('y1'));
        const x2 = Number(l.getAttribute('x2'));
        const y2 = Number(l.getAttribute('y2'));
        return { x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1), midX: (x1 + x2) / 2 };
      });
    const b1 = await baseOf(veh1);
    const b2 = await baseOf(veh2);

    // Each leg is a REAL, non-zero run (live geometry ran — jsdom would collapse to 0).
    expect(b1.len).toBeGreaterThan(10);
    expect(b2.len).toBeGreaterThan(10);

    // The overflow car (vehicle:2, the 4th load cell) wraps into the 2nd sub-row offset
    // ~230px into the channels (AC4: "only its WC→Vehicle overlay edge follows it to the
    // sub-row"). Its overlay edge therefore tracks that displacement — vehicle:2's leg
    // sits at a clearly different horizontal position than vehicle:1's, NOT a duplicate of
    // the same shared leg. The overflow car must actually be on the 2nd sub-row.
    await expect(scene(page).locator('.subrow.overflow .scene-cell[data-node="vehicle:2"]')).toHaveCount(1);
    expect(Math.abs(b2.midX - b1.midX)).toBeGreaterThan(50);
  });

  test('AC2/AC4 — a vehicle (even duplicated) draws NO bus tap: its WC→Vehicle overlay never reaches the trunk', async ({
    page,
  }) => {
    await mountScene(page, { width: 1400, config: twoCarCfg });
    await waitForTrunk(page);

    const t = await trunkLine(page); // horizontal desktop trunk ⇒ constant y
    const trunkY = t.y1;

    // The Vehicle is a PRESENTATION cell, not a flow node (no Role / no BUS_ORIENTATION /
    // no sixth FlowNode) — so a vehicle NEVER becomes a bus tap, the load-bearing
    // invariant the whole story rides. Its only edge is the horizontal WC→Vehicle overlay,
    // which touches NO trunk. NEITHER duplicated car's leg (vehicle:1 / vehicle:2) may
    // have an endpoint sitting ON the trunk line.
    for (const id of ['vehicle:1', 'vehicle:2']) {
      const b = await scene(page)
        .locator(`.scene-bus .gw-leg[data-role="${id}"] .gw-leg-base`)
        .evaluate((l) => ({ y1: Number(l.getAttribute('y1')), y2: Number(l.getAttribute('y2')) }));
      const nearestToTrunk = Math.min(Math.abs(b.y1 - trunkY), Math.abs(b.y2 - trunkY));
      expect(nearestToTrunk, `${id} must NOT tap the trunk`).toBeGreaterThan(2);
    }

    // Calibration: an ENERGY load leg (home) DOES tap the trunk — one endpoint sits ON
    // trunkY (≤2px). This proves the "no tap" metric above is meaningful, not vacuous: a
    // real tap lands on the trunk; the vehicle overlays deliberately do not.
    const homeLeg = await scene(page)
      .locator('.scene-bus .gw-leg[data-role="home"] .gw-leg-base')
      .evaluate((l) => ({ y1: Number(l.getAttribute('y1')), y2: Number(l.getAttribute('y2')) }));
    expect(Math.min(Math.abs(homeLeg.y1 - trunkY), Math.abs(homeLeg.y2 - trunkY))).toBeLessThanOrEqual(2);
  });

  test('AC8 — a band beyond the safe capacity (home + 6 dead cars, no WC) clamps a dead card behind "Show all"', async ({
    page,
  }) => {
    // Six bare cars (all resolve the same battery ⇒ all present) + the WC DROPPED (its
    // power entity carries the `total_power` signature — see KEY_SIGNATURES.wc_power) ⇒
    // each car reads NO live charge (≈0 kW = dead). Load band = home + 6 cars = 7 > SAFE (6).
    const sixDeadCars = {
      energy: { nodes: { instances: { vehicle: [{}, {}, {}, {}, {}, {}] } } },
    };
    await mountScene(page, { width: 1400, config: sixDeadCars, dropSlug: 'total_power' });
    await waitForTrunk(page);

    // The honest notice appears (only ≈0-kW cards were hidden), default calm-clamped.
    const note = scene(page).locator('.clamp-note');
    await expect(note).toHaveCount(1);
    await expect(note).toContainText(/\d+ cards? hidden/); // singular ("1 card") or plural
    const clampedVeh = await scene(page).locator('.scene-cell.veh-cell').count();
    expect(clampedVeh).toBeLessThan(6); // at least one dead car hidden

    // "Show all" reveals every card; the toggle is a ≥44px control and flips to "Show fewer".
    const toggle = scene(page).locator('.clamp-note-toggle');
    const tBox = await toggle.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(tBox.w).toBeGreaterThanOrEqual(44);
    expect(tBox.h).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(scene(page).locator('.scene-cell.veh-cell')).toHaveCount(6); // all shown
    await expect(scene(page).locator('.clamp-note-toggle')).toHaveText(/fewer/i);
  });

  test('AC8 — a LIVE card is NEVER clamped: home (live) survives an over-capacity dead-car band', async ({
    page,
  }) => {
    const sixDeadCars = {
      energy: { nodes: { instances: { vehicle: [{}, {}, {}, {}, {}, {}] } } },
    };
    await mountScene(page, { width: 1400, config: sixDeadCars, dropSlug: 'total_power' });
    await waitForTrunk(page);
    // Home is a live load — it must remain rendered (clamping a live source fabricates a
    // phantom, INV-1; the guard hides only dead cards).
    await expect(scene(page).locator('.scene-cell[data-node="home"]')).toHaveCount(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.14 — the GENERATOR, a new copper SOURCE node TYPE, at the LIVE-LAYOUT tier.
//
// The co-located jsdom corpus (`src/components/generator.test.ts`, `flow/my-home.test.ts`,
// the registry/energy/styles role-count guards) already pins the WIRING + pure math: the
// generator is the 6th energy role, resolves `generator_power`, nets `BUS_ORIENTATION(+1)`
// as a source, folds into `sceneAggregates.generation`, and the multi-instance machinery is
// the reused 9.7 core. But jsdom returns ZERO-sized rects and applies NO stylesheet, so it
// CANNOT prove the things only a real layout engine + a real interaction produce, and which
// the lone in-block 9.14 test ("a present generator renders a copper SOURCE card + a real
// bus tap") leaves uncovered:
//   • FR-33 zero-diff (AC5) — an ABSENT generator leaves today's EXACT live roster + legs +
//     trunk geometry (no generator cell, no orphan tap, no ribbon tile) — proven by a
//     fingerprint compare, the same way 9.2 proves hidden==absent.
//   • AC4 — the generator's tap walks the bus among the SOURCE taps (left of the loads'),
//     and the summary ribbon COUNTS it as generation with its own "Generator" tile.
//   • AC4/AC3 — focusing the generator (a SOURCE) lights the loads + itself and DIMS the
//     other sources, as REAL computed opacity (jsdom applies no stylesheet).
//   • AC7 — multi-instance composes FOR FREE: two `instances.generator` render
//     `generator:1`/`generator:2` cells, each its OWN bus tap at a DISTINCT live anchor —
//     no generator-specific wrap/instance code.
// Under the auto console-error guard. The generator sensor is injected by FUNCTION-SLUG
// (`generator_power`), exactly as `data/energy` resolves it — the [card] no-inlined-ids floor.
// ═══════════════════════════════════════════════════════════════════════════

// A synthetic generator output sensor, resolved by the `generator_power` function-slug
// (never an inlined id) — the opt-in that turns the new copper source node ON.
const GEN_INJECT = {
  'sensor.my_home_generator_power': {
    entity_id: 'sensor.my_home_generator_power',
    state: '3.4',
    attributes: { unit_of_measurement: 'kW', device_class: 'power' },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  },
};

const genCell = (page: Page) => scene(page).locator('.scene-cell[data-node="generator"]');
const genLeg = (page: Page) => scene(page).locator('.gw-leg[data-role="generator"]');

test.describe('tc-my-home Scene — Story 9.14: generator (copper source) at live layout', () => {
  test.beforeEach(async ({ demo }) => {
    // AWAKE / charging: the richest baseline (five energy cells + vehicle + trunk +
    // legs + ribbon), so adding/omitting the generator is a precise diff against today.
    await demo.open(AWAKE.open);
  });

  test('AC5/FR-33 — an ABSENT generator leaves today\'s EXACT Scene (roster, legs, trunk geometry unchanged)', async ({
    page,
  }) => {
    // (a) The canonical Scene with NO generator injected — today's roster + live geometry.
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const baseFp = await sceneFingerprint(page);
    const baseTrunk = await trunkLine(page);
    expect(baseFp.cellNodes).toEqual([
      'solar',
      'powerwall',
      'grid',
      'home',
      'wall_connector',
      'vehicle',
    ]);
    // No opt-in ⇒ the generator is an absent node: no cell, no bus leg (FR-33 zero-diff).
    await expect(genCell(page)).toHaveCount(0);
    await expect(genLeg(page)).toHaveCount(0);

    // (b) The SAME mount again — byte-for-byte stable roster + identical live trunk
    // geometry (the absent generator contributes NOTHING to the running sum or layout).
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    expect(await sceneFingerprint(page)).toEqual(baseFp);
    expect(await trunkLine(page)).toEqual(baseTrunk);
    // consoleGuard (auto fixture) asserts the no-generator mounts emitted no errors.
  });

  test('AC4 — a present generator ADDS exactly one SOURCE cell + one bus leg; the ribbon COUNTS it as generation', async ({
    page,
  }) => {
    // Baseline (no generator) leg count first, then inject — the generator must add
    // EXACTLY one cell + one leg, nothing else churns.
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const baseLegs = await legs(page).count();

    await mountScene(page, { width: 1100, inject: GEN_INJECT });
    await waitForTrunk(page);

    // Exactly one new source cell + one new leg — the generator joined the source band.
    await expect(scene(page).locator('.source-row .scene-cell[data-node="generator"]')).toHaveCount(1);
    await expect(genLeg(page)).toHaveCount(1);
    expect(await legs(page).count()).toBe(baseLegs + 1);

    // The summary ribbon COUNTS the generator as generation — it carries a "Generator"
    // tile (single-sourced from STRINGS.energy.nodes.generator) alongside its kW magnitude.
    // jsdom cannot prove the laid-out ribbon; here the real layout renders it above the grid.
    const rb = (await ribbon(page).textContent()) ?? '';
    expect(rb).toMatch(/Generator/i);
    expect(rb).toMatch(/kW/);

    // The bus NAMES the generator in its colour-blind-safe label (every present node + kW).
    const label = (await overlay(page).getAttribute('aria-label')) ?? '';
    expect(label).toMatch(/kW/);
  });

  test('AC4 — a single generator wraps the 4-source band yet still TAPS the one trunk as a source (unlike the vehicle)', async ({
    page,
  }) => {
    // One generator ⇒ the source band is 4 cards (solar·powerwall·grid·generator) ⇒ it
    // WRAPS by the D15 band>3 rule (the 9.7 machinery, composing for free for this NEW
    // node type — no generator-specific wrap code). The generator must still comb to the
    // ONE trunk as a real source tap (BUS_ORIENTATION +1), where the vehicle NEVER does.
    await page.setViewportSize({ width: 1400, height: 900 });
    await mountScene(page, { width: 1400, inject: GEN_INJECT });
    await waitForTrunk(page);

    // The band wrapped (4 source cards), but there is still exactly ONE trunk (AR-7).
    await expect(scene(page).locator('.source-row')).toHaveClass(/wrapped/);
    await expect(trunk(page)).toHaveCount(1);
    const t = await trunkLine(page); // horizontal desktop trunk ⇒ constant y
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1);
    const trunkY = t.y1;

    // The generator leg is a real tap ON the trunk: one of its base endpoints sits on the
    // trunk line (≤2px) — the same metric the 9.8 vehicle test uses, here proving the
    // POSITIVE (a source DOES tap), the contrast to the vehicle's non-tapping overlay.
    await expect(genLeg(page)).toHaveCount(1);
    const gb = await genLeg(page)
      .locator('.gw-leg-base')
      .evaluate((l) => ({ y1: Number(l.getAttribute('y1')), y2: Number(l.getAttribute('y2')) }));
    const nearest = Math.min(Math.abs(gb.y1 - trunkY), Math.abs(gb.y2 - trunkY));
    expect(nearest, 'the generator (a source) must tap the trunk').toBeLessThanOrEqual(2);

    // Calibration: a known source (solar) taps the trunk the same way — so the metric is
    // meaningful, not vacuously satisfied by any geometry.
    const sb = await scene(page)
      .locator('.gw-leg[data-role="solar"] .gw-leg-base')
      .first()
      .evaluate((l) => ({ y1: Number(l.getAttribute('y1')), y2: Number(l.getAttribute('y2')) }));
    expect(Math.min(Math.abs(sb.y1 - trunkY), Math.abs(sb.y2 - trunkY))).toBeLessThanOrEqual(2);
  });

  test('AC4/AC3 — focusing the generator (a SOURCE) lights the loads + itself and DIMS the other sources (real opacity)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountScene(page, { width: 1100, inject: GEN_INJECT });
    await waitForTrunk(page);

    // Hover the generator cell — a source lights all LOADS + itself; the other present
    // sources (solar/powerwall/grid) dim. REAL computed opacity (jsdom applies no CSS).
    await genCell(page).hover();
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);

    const groups = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      const out = { litNodes: [] as (string | undefined)[], litOps: [] as number[], dimNodes: [] as (string | undefined)[], dimOps: [] as number[] };
      root.querySelectorAll<HTMLElement>('.scene-cell').forEach((c) => {
        const op = Number(getComputedStyle(c).opacity);
        if (c.classList.contains('lit')) {
          out.litNodes.push(c.dataset.node);
          out.litOps.push(op);
        } else {
          out.dimNodes.push(c.dataset.node);
          out.dimOps.push(op);
        }
      });
      return out;
    });
    // The generator lights itself + at least one load; the other sources are present and dim.
    expect(groups.litNodes).toContain('generator');
    expect(groups.litNodes).toContain('home');
    expect(groups.litOps.every((o) => o === 1)).toBe(true);
    // The other sources (solar/powerwall/grid) sit in the dim group — a source does NOT
    // light its source siblings (they share the bus only through the loads).
    expect(groups.dimNodes).toContain('solar');
    expect(groups.dimOps.length).toBeGreaterThan(0);
    expect(groups.dimOps.every((o) => o < 1)).toBe(true);
  });

  test('AC7 — multi-instance composes FOR FREE: two instances render generator:1/generator:2 cells, each its OWN distinct bus tap', async ({
    page,
  }) => {
    // Two `instances.generator` (both resolve the SAME injected sensor — the GEOMETRY /
    // per-instance identity is under test, not distinct values), exactly the 9.7 core
    // reused. A wide desktop keeps every source card at standalone width.
    await page.setViewportSize({ width: 1400, height: 900 });
    await mountScene(page, {
      width: 1400,
      inject: GEN_INJECT,
      config: { energy: { nodes: { instances: { generator: [{}, {}] } } } },
    });
    await waitForTrunk(page);

    // Per-instance ids — the bare `generator` is gone (duplicated ⇒ all suffixed), exactly
    // the solar:1/solar:2 + vehicle:1/vehicle:2 scheme — NO generator-specific code.
    await expect(scene(page).locator('.scene-cell[data-node="generator:1"]')).toHaveCount(1);
    await expect(scene(page).locator('.scene-cell[data-node="generator:2"]')).toHaveCount(1);
    await expect(genCell(page)).toHaveCount(0); // no bare-id cell once duplicated
    // Each instance embeds the tc-generator child.
    await expect(scene(page).locator('.scene-cell[data-node="generator:1"] tc-generator')).toHaveCount(1);
    await expect(scene(page).locator('.scene-cell[data-node="generator:2"] tc-generator')).toHaveCount(1);

    // Each instance gets its OWN bus tap, drawn at a DISTINCT live anchor (jsdom would
    // collapse both onto the origin) — proof the multi-instance taps are real geometry.
    const leg1 = scene(page).locator('.gw-leg[data-role="generator:1"]');
    const leg2 = scene(page).locator('.gw-leg[data-role="generator:2"]');
    await expect(leg1).toHaveCount(1);
    await expect(leg2).toHaveCount(1);
    const tap1 = await tapXByRole(page, 'generator:1');
    const tap2 = await tapXByRole(page, 'generator:2');
    expect(Math.abs(tap2 - tap1)).toBeGreaterThan(10); // two distinct taps, not a duplicate

    // Still ONE trunk, one ribbon — the wrap is the 9.7 machinery (AR-7: never a 2nd trunk).
    await expect(trunk(page)).toHaveCount(1);
    await expect(ribbon(page)).toHaveCount(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Story 9.15 — cross-row promotion at LIVE geometry. The pixel tier jsdom cannot
// reach: a promoted card actually lays out in the chosen row (real top), the Gateway
// trunk RE-SEATS in the new inter-row gap (the Hazard-A proof — only provable with a
// layout engine), the promoted card's tap rides the bus, and a load promoted into the
// source row still reads as a LOAD on the bus (AC2 — the state-bearing overlay label is
// byte-identical to canonical, because balance never reads the rendered row).
// ═══════════════════════════════════════════════════════════════════════════
test.describe('tc-my-home Scene — Story 9.15: cross-row promotion follows live geometry', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC1/AC3 — rows:{wall_connector:"source"} draws the WC in the SOURCE row AND the trunk re-seats below the new grouping with the WC tap on the bus', async ({
    page,
  }) => {
    // Drop Solar so the promotion stays WITHIN the 3-slot source band (no 9.7 wrap) — a
    // clean inter-row gap to assert the re-seat against. The promotion×wrap composition is
    // proven in the jsdom suite; this e2e isolates the bus-Y re-seat at live geometry.
    await mountScene(page, {
      width: 1100,
      dropSlug: 'solar_power',
      config: { energy: { nodes: { rows: { wall_connector: 'source' } } } },
    });
    await waitForTrunk(page);

    // (AC1) The WC card now lays out in the SOURCE row: it shares the source band's top
    // (near grid) and sits strictly ABOVE the remaining load card (home) — the render moved
    // the card, not just a flag.
    const boxes = await scene(page).evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot!;
      return [...root.querySelectorAll<HTMLElement>('.scene-cell')].map((c) => {
        const r = c.getBoundingClientRect();
        return { node: c.dataset.node, top: Math.round(r.top), cy: r.top + r.height / 2 };
      });
    });
    const wc = boxes.find((b) => b.node === 'wall_connector')!;
    const grid = boxes.find((b) => b.node === 'grid')!;
    const home = boxes.find((b) => b.node === 'home')!;
    // WC shares the SOURCE band (near grid's top) and sits strictly above home (the load row).
    expect(Math.abs(wc.top - grid.top)).toBeLessThan(40);
    expect(wc.top).toBeLessThan(home.top);

    // (AC3) The trunk re-seats in the NEW inter-row gap: its y lands strictly between the
    // (now 3-card) source band bottom and the load band top — BELOW the promoted WC.
    const t = await trunkLine(page);
    expect(Math.abs(t.y1 - t.y2)).toBeLessThanOrEqual(1); // still a horizontal rail
    expect(t.y1).toBeGreaterThan(wc.cy); // below the promoted source card (re-seated)
    expect(t.y1).toBeLessThan(home.cy); // above the load row

    // The WC's bus tap still rides the trunk (its leg is drawn at its new source anchor).
    await expect(scene(page).locator('.gw-leg[data-role="wall_connector"]')).toHaveCount(1);
    // Source row now packs the WC after the two remaining sources (powerwall, grid).
    expect(await sourceOrderByX(page)).toEqual(['powerwall', 'grid', 'wall_connector']);
  });

  test('AC2 — a LOAD (home) promoted to the source row still reads as a LOAD on the bus (the state-bearing overlay label is unchanged)', async ({
    page,
  }) => {
    // Canonical baseline — capture the overlay's accessible name (built from the model's
    // measured net, never the rendered row).
    await mountScene(page, { width: 1100 });
    await waitForTrunk(page);
    const baseLabel = await overlay(page).getAttribute('aria-label');

    // Promote home into the source row. The card moves; the SIGN must not.
    await mountScene(page, {
      width: 1100,
      config: { energy: { nodes: { rows: { home: 'source' } } } },
    });
    await waitForTrunk(page);

    // home actually rendered in the source row…
    expect(await sourceOrderByX(page)).toContain('home');
    // …yet the bus's state-bearing label is byte-identical — same nodes, same kW, same
    // signs (home still a load). The promotion is purely presentational (AR-6 witness).
    expect(await overlay(page).getAttribute('aria-label')).toBe(baseLabel);
  });

  test('AC5/FR-24 — a GARBAGE rows (non-object) renders the canonical Scene at live geometry, console-clean', async ({
    page,
  }) => {
    await mountScene(page, { width: 1100, config: { energy: { nodes: { rows: 'nope' } } } });
    await waitForTrunk(page);
    // Degrades to today's canonical packing — no crash, no blank (consoleGuard asserts clean).
    expect(await sourceOrderByX(page)).toEqual(['solar', 'powerwall', 'grid']);
    await expect(cells(page)).toHaveCount(5);
  });
});

// ── Story 9.10 — detected-but-hidden advisory, REAL-BROWSER E2E ─────────────────
//
// The advisory's LOGIC (the opposite-of-hide probe, per-instance keying, dismiss
// scopes, the default-on/off toggle) is exhaustively pinned in jsdom
// (src/components/my-home.test.ts, the Story 9.10 AC7/AC8/AC9 block). This layer
// covers ONLY what jsdom structurally cannot — and what the dev story flagged as
// "add a card-render e2e for the advisory if a DOM path is reachable": it IS reachable,
// because the demo's AWAKE solar is genuinely LIVE and `mountScene` accepts an
// `energy.nodes.hide` config (the same seam the 9.2 block drives at :1198). The
// real-browser-only proofs:
//   • the amber strip lays out ABOVE the grid with a real, non-zero box (jsdom = 0-rects)
//   • the dismiss button clears the computed ≥44×44 target floor (AC9 — jsdom asserts
//     the CSS *string*, never layout)
//   • a REAL click dismisses just that instance (jsdom clicks a detached node)
//   • the strip carries NO animation in a live engine (AC7/AC9 "never animates")
// All under the auto console-error guard ⇒ also a "renders cleanly in a real browser" proof.
const advisory = (page: Page) => scene(page).locator('.hidden-advisory');
const advisoryRows = (page: Page) => scene(page).locator('.hidden-advisory-row');
const advisoryDismiss = (page: Page) => scene(page).locator('.hidden-advisory-dismiss');

test.describe('tc-my-home Scene — Story 9.10: detected-but-hidden advisory (real browser)', () => {
  test.beforeEach(async ({ demo }) => {
    // AWAKE / charging: solar is genuinely LIVE in this scenario, so hiding it is the
    // hidden-AND-live case the advisory exists for.
    await demo.open(AWAKE.open);
  });

  test('AC7 — hiding LIVE solar surfaces one calm amber strip ABOVE the grid, a named role=status region', async ({
    page,
  }) => {
    // Default toggle (notify_hidden_detected absent ⇒ ON): the advisory must fire.
    await mountScene(page, { config: { energy: { nodes: { hide: ['solar'] } } } });
    await waitForTrunk(page);

    await expect(advisory(page)).toHaveCount(1);
    await expect(advisoryRows(page)).toHaveCount(1); // exactly one hidden-and-live instance

    // A named live region, polite (never assertive) — announced, not alarmed.
    await expect(advisory(page)).toHaveAttribute('role', 'status');
    await expect(advisory(page)).toHaveAttribute('aria-live', 'polite');
    await expect(advisory(page)).toHaveAttribute('aria-label', 'Detected-but-hidden notice');

    // Labelled by the role name in WORDS (honest, never glyph/hue alone), stating the fact.
    const txt = (await advisoryRows(page).first().textContent()) ?? '';
    expect(txt).toMatch(/Solar/i);
    expect(txt).toMatch(/detected — its card is hidden\./);

    // Real layout the jsdom suite cannot see: a non-zero strip laid out strictly ABOVE
    // the card grid (it mounts before the ribbon, at the top of the Scene).
    const ab = await advisory(page).boundingBox();
    const gb = await grid(page).boundingBox();
    expect(ab, 'advisory has a live box').not.toBeNull();
    expect(ab!.height).toBeGreaterThan(0);
    expect(ab!.y).toBeLessThan(gb!.y); // above the grid
  });

  test('AC9 — the dismiss button clears the computed ≥44×44 touch/keyboard floor and is per-instance labelled', async ({
    page,
  }) => {
    await mountScene(page, { config: { energy: { nodes: { hide: ['solar'] } } } });
    await waitForTrunk(page);
    await expect(advisoryDismiss(page)).toHaveCount(1);

    // Computed layout (NOT the CSS source string jsdom checks) clears the a11y floor.
    const box = await advisoryDismiss(page).boundingBox();
    expect(box, 'dismiss has a layout box').not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Disambiguated per instance, in reading order (AC9): "Dismiss Solar … notice".
    await expect(advisoryDismiss(page)).toHaveAttribute('aria-label', /Dismiss .*Solar.* notice/);
  });

  test('AC8 — a real click on dismiss collapses the advisory (session-scoped, the card stays hidden)', async ({
    page,
  }) => {
    await mountScene(page, { config: { energy: { nodes: { hide: ['solar'] } } } });
    await waitForTrunk(page);
    await expect(advisory(page)).toHaveCount(1);

    await advisoryDismiss(page).click();
    await expect(advisory(page)).toHaveCount(0); // collapsed to nothing — never auto-un-hides

    // The card stays hidden: the dismiss silences the notice, it does not restore the cell.
    await expect(scene(page).locator('.scene-cell[data-node="solar"]')).toHaveCount(0);
  });

  test('AC7/AC9 — the strip never animates (no transition/animation in a live engine)', async ({
    page,
  }) => {
    await mountScene(page, { config: { energy: { nodes: { hide: ['solar'] } } } });
    await waitForTrunk(page);
    const motion = await advisory(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { animationName: cs.animationName, transition: cs.transitionDuration };
    });
    expect(motion.animationName).toBe('none'); // honesty contract — never animates for attention
    expect(motion.transition).toBe('0s');
  });

  test('AC8 — the global toggle off (notify_hidden_detected:false) suppresses the advisory entirely', async ({
    page,
  }) => {
    await mountScene(page, {
      config: { energy: { nodes: { hide: ['solar'] } }, notify_hidden_detected: false },
    });
    await waitForTrunk(page);
    await expect(advisory(page)).toHaveCount(0); // opted out ⇒ no compute, no banner (zero-diff)
  });

  test('AC7 — hiding an ABSENT node raises no advisory (presence ≠ a phantom)', async ({ page }) => {
    // Drop solar's live sensor AND hide it: hidden-but-NOT-live ⇒ nothing to surface.
    await mountScene(page, {
      dropSlug: 'solar_power',
      config: { energy: { nodes: { hide: ['solar'] } } },
    });
    await waitForTrunk(page);
    await expect(advisory(page)).toHaveCount(0);
  });
});
