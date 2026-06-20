// Story 8.1 — Ecosystem card detail shell + per-card stat grids + deep-links.
//
// The co-located jsdom suite (src/components/ecosystem-card.test.ts + the per-card
// *.test.ts) pins the element-level contract, but jsdom applies NO stylesheet and
// runs NO layout engine — so it explicitly CANNOT prove the things this story's ACs
// hinge on in a real browser:
//   • the `.grid.g3` stat grid collapsing 3-col → 2-col at the real `@media
//     (max-width:540px)` breakpoint (UX-DR22 / AC1) — jsdom reads no media query;
//   • the deep-link chip's ≥44×44px hit area as REAL computed layout (AC2) — the
//     jsdom test could only assert the `min-height:44px` CSS rule exists;
//   • the deep-link genuinely pushing `/energy` + firing `location-changed` without
//     a full page reload, end-to-end in a real History/DOM (AC1/AC2);
//   • hide-when-missing producing real absent boxes, not just a `nothing` template;
//   • Sensor cards carrying NO interactive write surface in a fully-rendered card
//     (UX-DR24 / AC3); and the calm-empty fall-through staying clean (AC4).
//
// This spec is that real-browser proof. It mounts the concrete ecosystem cards
// (`tc-solar`/`tc-grid`/`tc-home`/`tc-wall-connector`/`tc-powerwall`) — registered
// by the same single bundle entry the demo loads — into a sized, in-viewport host,
// fed a full energy-site `hass` built from the committed `energy-detail.json`
// fixture (the same fixture the jsdom resolution gate uses, real live object-ids +
// deliberate decoys). Entities are matched by FUNCTION-SLUG substring, never inlined
// — mirroring how `data/energy` resolves them (the [card] no-hard-coded-ids rule).
import { readFileSync } from 'node:fs';
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

// The full energy-site fixture (read in Node; injected into the page). Carries the
// new Story-8.1 telemetry keys (solar_generated/exported, grid_imported/exported,
// battery_charged/discharged, wc_voltage/frequency/temperature) AND decoys, so the
// per-card stat grids resolve real tiles. All entities share one `last_updated`, so
// `referenceNow` (the max stamp) reads them all FRESH — no staleness stamps, the
// status dot follows the live/idle value.
const ENERGY_DETAIL = JSON.parse(
  readFileSync(new URL('../../src/fixtures/energy-detail.json', import.meta.url), 'utf8'),
) as { states: Record<string, unknown> };

type EcoTag = 'tc-solar' | 'tc-grid' | 'tc-home' | 'tc-wall-connector' | 'tc-powerwall';
const SENSOR_TAGS: EcoTag[] = ['tc-solar', 'tc-grid', 'tc-home', 'tc-wall-connector', 'tc-powerwall'];

interface MountOpts {
  /** Host width in px (sizes the card; the @540 grid collapse follows the VIEWPORT, set separately). */
  width?: number;
  /** Drop every state whose entity-id contains any of these function slugs (hide-when-missing tests). */
  drop?: string[];
  /** Replace the hass states with an empty map (the calm-empty path). */
  empty?: boolean;
}

// Mount one concrete ecosystem card into a fresh, sized, in-viewport host, fed the
// energy-detail `hass` (states overridden onto the live card's hass so any incidental
// field a card reads is still present — the my-home-scene mount pattern). The element
// is addressable via its `tc-*` locator (Playwright pierces open shadow DOM).
async function mountCard(page: Page, tag: EcoTag, opts: MountOpts = {}): Promise<void> {
  await page.evaluate(
    ({ tag, fixtureStates, opts }) => {
      document.getElementById('eco-host')?.remove();
      const drops = opts.drop ?? [];
      const states = opts.empty
        ? {}
        : Object.fromEntries(
            Object.entries(fixtureStates).filter(
              ([id]) => !drops.some((slug) => id.includes(slug)),
            ),
          );
      const card = document.querySelector('tesla-card') as unknown as { hass: Record<string, unknown> };
      const hass = { ...card.hass, states };

      // First child + scroll-to-top keeps the card inside the viewport.
      const host = document.createElement('div');
      host.id = 'eco-host';
      host.style.cssText = `width:${opts.width ?? 720}px;padding:16px;box-sizing:border-box;`;
      document.body.prepend(host);
      window.scrollTo(0, 0);

      const el = document.createElement(tag) as unknown as {
        setConfig(c: unknown): void;
        hass: unknown;
      };
      el.setConfig({ type: tag });
      el.hass = hass;
      host.appendChild(el as unknown as HTMLElement);
    },
    { tag, fixtureStates: ENERGY_DETAIL.states, opts },
  );
}

const card = (page: Page, tag: EcoTag) => page.locator(tag);
const detail = (page: Page, tag: EcoTag) => card(page, tag).locator('.surface.eco-detail');
const deepLink = (page: Page, tag: EcoTag) => card(page, tag).locator('.eco-deeplink');
const grid = (page: Page, tag: EcoTag) => card(page, tag).locator('.grid.g3.eco-grid');

/** Track count of a `.grid.g3`'s computed `grid-template-columns` (3 wide, 2 ≤540px). */
const gridColumns = (page: Page, tag: EcoTag) =>
  grid(page, tag).evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);

test.describe('Story 8.1 — ecosystem card detail layout, stat grids & deep-link (real browser)', () => {
  test.beforeEach(async ({ demo }) => {
    // Load the demo so the single bundle parses and registers the five ecosystem
    // cards (+ tc-my-home). We then mount our own card fed the energy-detail hass.
    await demo.open(AWAKE.open);
  });

  // ── AC1 — the detail layout composes header → hero slot → readout → grid → chip ──

  test('AC1 — a live card renders the full detail layout with real, non-zero layout', async ({
    page,
  }) => {
    await mountCard(page, 'tc-wall-connector');
    const surf = detail(page, 'tc-wall-connector');
    await expect(surf).toHaveCount(1);

    // Status header: a state dot + the node label, laid out with a real box.
    await expect(surf.locator('.eco-status .eco-dot')).toHaveCount(1);
    await expect(surf.locator('.eco-status .label')).toContainText('Wall');

    // Lead readout row + the stat-grid region both present (WC resolves 3 detail tiles).
    await expect(surf.locator('.eco-readout')).toHaveCount(1);
    await expect(grid(page, 'tc-wall-connector')).toHaveCount(1);

    // Deep-link chip is part of the live layout. Everything has a real, non-zero box
    // (the whole point of the live-layout proof jsdom cannot give).
    const box = await deepLink(page, 'tc-wall-connector').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('AC1 — the status dot reflects the live derived state (charging WC ⇒ .live)', async ({
    page,
  }) => {
    await mountCard(page, 'tc-wall-connector');
    // WC total_power = 7.2 kW (> deadband) ⇒ charging ⇒ the status dot is `.live`.
    await expect(detail(page, 'tc-wall-connector').locator('.eco-dot.live')).toHaveCount(1);
  });

  // ── AC1 / AC5 — the `.grid.g3` reuses the shared responsive grid (no new breakpoint) ──

  test('AC1/AC5 — the stat grid is 3-col on desktop and COLLAPSES to 2-col ≤540px', async ({
    page,
  }) => {
    // Desktop viewport: the shared `.grid.g3` lays three columns.
    await page.setViewportSize({ width: 1280, height: 900 });
    await mountCard(page, 'tc-wall-connector', { width: 720 });
    await expect(grid(page, 'tc-wall-connector')).toHaveCount(1);
    expect(await gridColumns(page, 'tc-wall-connector')).toBe(3);

    // Phone viewport ≤540px: the SAME grid primitive collapses to two columns via the
    // real `@media (max-width:540px)` rule (BREAKPOINTS.compact) — proof the card
    // reused the responsive grid and authored NO new breakpoint of its own.
    await page.setViewportSize({ width: 500, height: 1000 });
    await mountCard(page, 'tc-wall-connector', { width: 460 });
    await expect(grid(page, 'tc-wall-connector')).toHaveCount(1);
    expect(await gridColumns(page, 'tc-wall-connector')).toBe(2);
  });

  // ── AC1 / AC2 — the deep-link chip navigates to /energy (no full reload) ────────

  test('AC2 — the deep-link chip is a real keyboard-operable button with a ≥44×44px hit area', async ({
    page,
  }) => {
    await mountCard(page, 'tc-solar');
    const chip = deepLink(page, 'tc-solar');
    await expect(chip).toHaveAttribute('role', 'button');
    await expect(chip).toHaveAttribute('tabindex', '0');
    await expect(chip).toHaveAttribute('aria-label', 'Open Energy dashboard');

    // REAL computed layout — the assertion jsdom could only approximate with a CSS
    // text match. The chip's live box clears the 44×44 minimum-target floor.
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test('AC1/AC2 — clicking the chip pushes /energy and fires location-changed (NO full reload)', async ({
    page,
  }) => {
    await mountCard(page, 'tc-grid');

    // Listen for the in-app navigation event on the window, and mark the document so
    // a full page reload (which would wipe this flag) is detectable.
    await page.evaluate(() => {
      (window as unknown as { __locEvents: string[] }).__locEvents = [];
      window.addEventListener('location-changed', () =>
        (window as unknown as { __locEvents: string[] }).__locEvents.push(location.pathname),
      );
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    await deepLink(page, 'tc-grid').click();

    const result = await page.evaluate(() => ({
      events: (window as unknown as { __locEvents: string[] }).__locEvents,
      path: location.pathname,
      // If a full reload happened this would be undefined (the page re-initialized).
      noReload: (window as unknown as { __noReload?: boolean }).__noReload === true,
    }));
    expect(result.path).toBe('/energy'); // history.pushState('/energy') landed
    expect(result.events).toContain('/energy'); // location-changed escaped the shadow (composed)
    expect(result.noReload).toBe(true); // pushState navigation, not a document reload
  });

  test('AC1/AC2 — Enter on the focused chip also navigates (keyboard parity)', async ({ page }) => {
    await mountCard(page, 'tc-home');
    await page.evaluate(() => {
      (window as unknown as { __locEvents: string[] }).__locEvents = [];
      window.addEventListener('location-changed', () =>
        (window as unknown as { __locEvents: string[] }).__locEvents.push(location.pathname),
      );
    });

    const chip = deepLink(page, 'tc-home');
    await chip.focus();
    await page.keyboard.press('Enter');

    const events = await page.evaluate(
      () => (window as unknown as { __locEvents: string[] }).__locEvents,
    );
    expect(events).toContain('/energy');
    await expect(page).toHaveURL(/\/energy$/);
  });

  // ── AC2 — per-card stat grids: resolved by function-name, hide-when-missing ─────

  test('AC2 — Solar surfaces its resolving telemetry tiles (production lead + generated/exported)', async ({
    page,
  }) => {
    await mountCard(page, 'tc-solar');
    const surf = detail(page, 'tc-solar');
    // Lead production tile (6.0 kW) in the readout row.
    await expect(surf.locator('.eco-readout')).toContainText('6.0 kW');
    // Two cumulative-energy tiles resolve in the stat grid (15.7 / 2.3 kWh).
    const tileText = (await grid(page, 'tc-solar').textContent()) ?? '';
    expect(tileText).toContain('15.7');
    expect(tileText).toContain('2.3');
  });

  test('AC2 — an ABSENT telemetry entity HIDES its tile (no blank, no fabricated 0)', async ({
    page,
  }) => {
    // Drop the WC handle-temperature sensor by function slug — its tile must vanish,
    // never render blank or a fabricated reading. The other two measurement tiles stay.
    await mountCard(page, 'tc-wall-connector', { drop: ['handle_temperature'] });
    const surf = detail(page, 'tc-wall-connector');
    await expect(surf).toHaveCount(1);

    const gridText = (await grid(page, 'tc-wall-connector').textContent()) ?? '';
    expect(gridText).toContain('Voltage'); // wc_voltage tile present (238 V)
    expect(gridText).toContain('Frequency'); // wc_frequency tile present (59.9 Hz)
    expect(gridText).not.toContain('Temperature'); // dropped ⇒ hidden, not blank
    // The dropped tile leaves NO blank/zero residue in the grid.
    const tileCount = await grid(page, 'tc-wall-connector').locator('.stat').count();
    expect(tileCount).toBe(2);
    expect(gridText).not.toContain('NaN');
  });

  test('AC2/AC4 — Home (lead-only telemetry) renders the detail layout with NO stat-grid region', async ({
    page,
  }) => {
    // Home resolves a lead consumption value but no detail telemetry on this
    // integration — the hide-when-missing grid region is omitted entirely (calm,
    // sparse, correct), while the rest of the detail layout still renders.
    await mountCard(page, 'tc-home');
    const surf = detail(page, 'tc-home');
    await expect(surf).toHaveCount(1);
    await expect(surf.locator('.eco-readout')).toContainText('1.0 kW');
    await expect(grid(page, 'tc-home')).toHaveCount(0); // no tiles resolve ⇒ no empty grid box
    await expect(deepLink(page, 'tc-home')).toHaveCount(1); // deep-link still present
  });

  // ── AC3 — read-vs-control honesty (Sensor cards carry NO write surface) ─────────

  test('AC3 — every Sensor card carries the honest "Sensor" mark and NO interactive write control', async ({
    page,
  }) => {
    for (const tag of SENSOR_TAGS) {
      await mountCard(page, tag);
      const surf = detail(page, tag);
      await expect(surf, `${tag} renders the detail layout`).toHaveCount(1);

      // The header honestly marks the card as a Sensor (UX-DR24) — Powerwall stays a
      // Sensor too this story (its write controls are Story 8.4).
      await expect(surf.locator('.eco-kind'), `${tag} marks Sensor`).toContainText('Sensor');

      // No write surface anywhere in the card: no slider, input, select, native
      // button, or ARIA switch/slider. (The deep-link chip is a span[role=button] —
      // a navigation affordance, NOT a write control — and is excluded by tag/role.)
      const controls = await card(page, tag)
        .locator('tc-slider, input, select, button, [role="switch"], [role="slider"]')
        .count();
      expect(controls, `${tag} exposes no write control`).toBe(0);
    }
  });

  // ── AC4 — graceful degradation: the calm Epic-6 empty state is unchanged ────────

  test('AC4 — an essentially-empty hass falls through to the calm empty state (no chip, no crash)', async ({
    page,
  }) => {
    await mountCard(page, 'tc-solar', { empty: true });
    // The shell still renders (presence-tolerant), via the unchanged renderShell path.
    await expect(card(page, 'tc-solar').locator('.surface')).toHaveCount(1);
    // The calm `.eco-empty` sentence is shown; the detail layout + deep-link are NOT.
    await expect(card(page, 'tc-solar').locator('.eco-empty')).toHaveCount(1);
    await expect(detail(page, 'tc-solar')).toHaveCount(0);
    await expect(deepLink(page, 'tc-solar')).toHaveCount(0);
    // The auto console-guard asserts the empty mount emitted no errors at teardown.
  });
});
