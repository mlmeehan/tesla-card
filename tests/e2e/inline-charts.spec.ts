// Story 8.3 — Inline history charts (today sparkline + multi-day bars).
//
// The co-located jsdom suites (src/components/chart.test.ts, src/data/history.test.ts,
// and the per-card *.test.ts Story-8.3 blocks) pin the element-level contract — the
// parse honesty, the empty-state caption, the id-gated fetch, the structural shape of
// `svg.spark` / `.bcol`. But jsdom applies NO stylesheet, runs NO layout engine, reads
// NO media query, and never actually PAINTS — so it explicitly CANNOT prove the things
// this story's ACs hinge on in a real browser:
//   • the one genuinely new data path actually completing end-to-end: the async
//     `hass.callWS('history/history_during_period')` fetch RESOLVING and the card
//     re-rendering a chart from the awaited series (AC1/AC3) — jsdom only awaits a
//     mocked promise, it never proves the real reactive fetch→@state→paint cycle;
//   • the today sparkline drawing a REAL SVG line with non-zero geometry
//     (`getTotalLength() > 0`) inside the `preserveAspectRatio="none"` box (AC1);
//   • the multi-day bars laying out with REAL, proportional computed pixel heights
//     (AC1) — jsdom returns zero-sized boxes, so a `height:%` rule is unobservable;
//   • the calm empty chart genuinely SUPPRESSING the curve (no `svg.spark`, no
//     zero-height `.bcol`) when the recorder returns nothing — "empty ≠ zero" as a
//     rendered fact, not a template assertion (AC2/AC5);
//   • a rejected fetch degrading to the calm empty chart with NO uncaught error
//     reaching the page (AC2/AC5 — proven by the auto console-error guard);
//   • the draw-on animation TRULY flipping off under `prefers-reduced-motion: reduce`
//     as REAL computed `animation-name` (AC4) — jsdom reads no media query at all;
//   • the per-id fetch gate holding across real `hass` ticks — no re-fetch (AC3);
//   • and the charts appearing for FREE inside the composed `tc-my-home` Scene
//     (Epic-8 carry-forward (a): the Scene embeds the real card elements).
//
// This spec is that real-browser proof. It mounts the concrete ecosystem cards
// (registered by the same single bundle the demo loads) into a sized, in-viewport
// host, fed the full energy-site `hass` built from the committed `energy-detail.json`
// fixture (the same fixture ecosystem-detail.spec + the jsdom resolution gate use) —
// PLUS an injected mock `hass.callWS`, because the demo harness ships none, so without
// it every chart would (correctly) fall to its calm empty state. Entities resolve by
// FUNCTION-SLUG, never inlined — the [card] no-hard-coded-ids discipline.
import { readFileSync } from 'node:fs';
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

const ENERGY_DETAIL = JSON.parse(
  readFileSync(new URL('../../src/fixtures/energy-detail.json', import.meta.url), 'utf8'),
) as { states: Record<string, { last_updated?: string; last_changed?: string }> };

// The fixture's HA "now" = the max last_updated/last_changed across its states. This
// is exactly what `referenceNow(hass)` reads (HA's own time base, never Date.now()),
// and the value the card passes as the chart fetch window's anchor — so the injected
// sample history MUST be anchored to it for samples to land inside today / 7-day.
const FIXTURE_NOW = (() => {
  let max = -Infinity;
  for (const e of Object.values(ENERGY_DETAIL.states)) {
    for (const ts of [e.last_updated, e.last_changed]) {
      const ms = ts ? Date.parse(ts) : NaN;
      if (Number.isFinite(ms) && ms > max) max = ms;
    }
  }
  return max;
})();

type EcoTag = 'tc-solar' | 'tc-grid' | 'tc-home' | 'tc-wall-connector' | 'tc-powerwall';

/** What the injected callWS should do for a test. */
type WsMode = 'data' | 'empty' | 'reject';

interface MountOpts {
  width?: number;
  /** Mock recorder behaviour: real series, an empty result, or a rejected call. */
  ws?: WsMode;
  /** Replace the hass states with an empty map (the calm-empty path). */
  empty?: boolean;
}

// Mount one concrete ecosystem card into a fresh, sized, in-viewport host, fed the
// energy-detail `hass` with a mock `callWS` installed on it. The callWS is built ONCE
// per page and stashed on `window.__chartWS` (so a later `hass` re-assignment can reuse
// the SAME spy — proving the per-id fetch gate). `window.__wsCalls` counts invocations.
async function mountCard(page: Page, tag: EcoTag, opts: MountOpts = {}): Promise<void> {
  await page.evaluate(
    ({ tag, fixtureStates, opts, nowMs }) => {
      const w = window as unknown as {
        __chartWS?: (msg: { entity_ids: string[] }) => Promise<unknown>;
        __wsCalls?: number;
        __wsMode?: string;
      };
      w.__wsCalls = 0;
      w.__wsMode = opts.ws ?? 'data';

      // Two days × two samples anchored to the fixture's HA now → the today series has
      // ≥2 points (a drawable line) and the cumulative counter yields a real daily
      // delta per day (yesterday +3, today +6). Mirrors the jsdom SAMPLE_HISTORY.
      const day = 86_400_000;
      const sample = (id: string) => ({
        [id]: [
          { s: '10', lu: (nowMs - day - 3_600_000) / 1000 },
          { s: '13', lu: (nowMs - day - 1000) / 1000 },
          { s: '20', lu: (nowMs - 3_600_000) / 1000 },
          { s: '26', lu: (nowMs - 1000) / 1000 },
        ],
      });

      // Build the spy once; subsequent mounts on the same page reuse it.
      w.__chartWS = (msg: { entity_ids: string[] }) => {
        w.__wsCalls = (w.__wsCalls ?? 0) + 1;
        if (w.__wsMode === 'reject') return Promise.reject(new Error('recorder unavailable'));
        if (w.__wsMode === 'empty') return Promise.resolve({});
        return Promise.resolve(sample(msg.entity_ids[0]));
      };

      document.getElementById('eco-host')?.remove();
      const states = opts.empty ? {} : fixtureStates;
      const card = document.querySelector('tesla-card') as unknown as {
        hass: Record<string, unknown>;
      };
      const hass = { ...card.hass, states, callWS: w.__chartWS };

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
    { tag, fixtureStates: ENERGY_DETAIL.states, opts, nowMs: FIXTURE_NOW },
  );
}

/** Re-assign a FRESH hass object (HA replaces it every tick) reusing the same spy. */
async function tickHass(page: Page, tag: EcoTag): Promise<void> {
  await page.evaluate(
    ({ tag, fixtureStates }) => {
      const w = window as unknown as { __chartWS?: unknown };
      const card = document.querySelector('tesla-card') as unknown as {
        hass: Record<string, unknown>;
      };
      const el = document.querySelector(tag) as unknown as { hass: unknown };
      el.hass = { ...card.hass, states: fixtureStates, callWS: w.__chartWS };
    },
    { tag, fixtureStates: ENERGY_DETAIL.states },
  );
}

const card = (page: Page, tag: EcoTag) => page.locator(tag);
const chartsRegion = (page: Page, tag: EcoTag) => card(page, tag).locator('.eco-charts');
const spark = (page: Page, tag: EcoTag) => card(page, tag).locator('svg.spark');
const bars = (page: Page, tag: EcoTag) => card(page, tag).locator('.bars');
const wsCalls = (page: Page) => page.evaluate(() => (window as unknown as { __wsCalls: number }).__wsCalls);

test.describe('Story 8.3 — inline history charts (real browser)', () => {
  test.beforeEach(async ({ demo }) => {
    // Load the demo so the single bundle parses and registers the ecosystem cards
    // (+ tc-my-home). We then mount our own card fed the energy-detail hass + mock WS.
    await demo.open(AWAKE.open);
  });

  // ── AC1/AC3 — the new data path completes: async callWS → real sparkline + bars ──

  test('AC1/AC3 — Solar fetches history and draws a REAL sparkline line + proportional day bars', async ({
    page,
  }) => {
    await mountCard(page, 'tc-solar');

    // The region appears only AFTER the async callWS resolves and the card re-renders
    // from @state — auto-retrying expect proves the real fetch→paint cycle (jsdom gap).
    await expect(chartsRegion(page, 'tc-solar')).toHaveCount(1);
    await expect(spark(page, 'tc-solar')).toHaveCount(1);

    // The today line path has REAL drawn geometry — not just a `d` attribute string.
    const lineLen = await spark(page, 'tc-solar')
      .locator('path.ct-line')
      .evaluate((p) => (p as unknown as SVGPathElement).getTotalLength());
    expect(lineLen).toBeGreaterThan(0);
    // And the filled area path exists beneath it.
    await expect(spark(page, 'tc-solar').locator('path.ct-area')).toHaveCount(1);

    // The 7-day bars lay out with REAL, proportional computed heights (delta 3 vs 6 ⇒
    // the later bar is taller). jsdom returns zero boxes, so this is real-layout-only.
    await expect(bars(page, 'tc-solar')).toHaveCount(1);
    const barHeights = await bars(page, 'tc-solar')
      .locator('.bcol i')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).getBoundingClientRect().height));
    expect(barHeights.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...barHeights)).toBeGreaterThan(0); // every bar has a real box
    expect(Math.max(...barHeights)).toBeGreaterThan(Math.min(...barHeights)); // genuinely scaled
  });

  test('AC1 — a today-only card (Wall Connector) draws a sparkline and NO multi-day bars', async ({
    page,
  }) => {
    // WC charts wc_power (today) only — session energy resets per-session, so there is
    // deliberately NO honest daily-bar series. The bars region must be absent, not a
    // row of fabricated zero bars.
    await mountCard(page, 'tc-wall-connector');
    await expect(spark(page, 'tc-wall-connector')).toHaveCount(1);
    await expect(bars(page, 'tc-wall-connector')).toHaveCount(0);
  });

  // ── AC2/AC5 — empty ≠ zero: a barren recorder renders the calm empty chart ───────

  test('AC2/AC5 — a resolved entity but EMPTY recorder result shows the calm caption, never a fabricated curve', async ({
    page,
  }) => {
    await mountCard(page, 'tc-solar', { ws: 'empty' });

    // The chart region still renders (the entity resolved), but as the calm caption —
    // NOT a flat fake line at 0 and NOT a row of zero-height bars.
    await expect(chartsRegion(page, 'tc-solar').locator('.ct-empty')).not.toHaveCount(0);
    await expect(spark(page, 'tc-solar')).toHaveCount(0);
    await expect(card(page, 'tc-solar').locator('.bcol')).toHaveCount(0);
  });

  test('AC2/AC5 — a REJECTED recorder fetch degrades to the calm empty chart with no page error', async ({
    page,
  }) => {
    // The fetch is wrapped in try/catch → resolves to an empty series → calm chart.
    // The auto console-error guard (teardown) proves nothing threw to the page; the
    // module's single log.warn is a console.warn, which the guard does not flag.
    await mountCard(page, 'tc-solar', { ws: 'reject' });
    await expect(chartsRegion(page, 'tc-solar').locator('.ct-empty')).not.toHaveCount(0);
    await expect(spark(page, 'tc-solar')).toHaveCount(0);
  });

  test('AC5 — charts are additive to the live detail path ONLY: none on the calm-empty path', async ({
    page,
  }) => {
    // An essentially-empty hass falls through to the Epic-6 calm-empty shell — the
    // detail layout (and therefore the whole `.eco-charts` region) is absent.
    await mountCard(page, 'tc-solar', { empty: true });
    await expect(card(page, 'tc-solar').locator('.eco-empty')).toHaveCount(1);
    await expect(chartsRegion(page, 'tc-solar')).toHaveCount(0);
    await expect(card(page, 'tc-solar').locator('.chart')).toHaveCount(0);
  });

  // ── AC4 — reduced-motion: the draw-on animation truly flips off (the jsdom gap) ──

  test('AC4 — the sparkline draw-on animation runs by default (control)', async ({ page }) => {
    await mountCard(page, 'tc-solar');
    await expect(spark(page, 'tc-solar')).toHaveCount(1);
    const animName = await spark(page, 'tc-solar').evaluate(
      (el) => getComputedStyle(el).animationName,
    );
    // Default (no reduced-motion): the content-free fade-in keyframe is live.
    expect(animName).not.toBe('none');
    expect(animName).toBe('chartIn');
  });

  test('AC4 — under prefers-reduced-motion the sparkline animation is FROZEN to none', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountCard(page, 'tc-solar');
    await expect(spark(page, 'tc-solar')).toHaveCount(1);

    const sparkAnim = await spark(page, 'tc-solar').evaluate(
      (el) => getComputedStyle(el).animationName,
    );
    const barsAnim = await bars(page, 'tc-solar').evaluate(
      (el) => getComputedStyle(el).animationName,
    );
    // The @media (prefers-reduced-motion: reduce) block zeroes both — a static chart
    // that keeps the full data (colour-blind-safe: shape + magnitude, not hue-only).
    expect(sparkAnim).toBe('none');
    expect(barsAnim).toBe('none');
    // The data is still fully drawn — the line geometry survives the freeze.
    const lineLen = await spark(page, 'tc-solar')
      .locator('path.ct-line')
      .evaluate((p) => (p as unknown as SVGPathElement).getTotalLength());
    expect(lineLen).toBeGreaterThan(0);
  });

  // ── AC3 — one-shot, gated by charted id: no re-fetch on an unrelated hass tick ───

  test('AC3 — the fetch is gated per charted-id: NO re-fetch across real hass ticks (UX-DR23 no-poll)', async ({
    page,
  }) => {
    await mountCard(page, 'tc-grid');
    await expect(spark(page, 'tc-grid')).toHaveCount(1);
    const afterFirst = await wsCalls(page);
    expect(afterFirst).toBeGreaterThan(0);

    // Replace `hass` twice with fresh objects carrying the SAME states (the per-tick
    // churn HA actually produces). The charted-id set is unchanged ⇒ no extra fetch.
    await tickHass(page, 'tc-grid');
    await card(page, 'tc-grid').evaluate((el) => (el as unknown as { updateComplete: Promise<unknown> }).updateComplete);
    await tickHass(page, 'tc-grid');
    await card(page, 'tc-grid').evaluate((el) => (el as unknown as { updateComplete: Promise<unknown> }).updateComplete);

    expect(await wsCalls(page)).toBe(afterFirst);
    // The chart is still drawn after the ticks (the cached series is reused).
    await expect(spark(page, 'tc-grid')).toHaveCount(1);
  });
});

// ── Carry-forward (a) — the composed Scene gets charts for free ────────────────────
test.describe('Story 8.3 — charts render inside the composed "My Home" Scene', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('the embedded ecosystem cards draw their sparklines inside tc-my-home (zero Scene-side work)', async ({
    page,
  }) => {
    // tc-my-home embeds the REAL card elements (carry-forward (a)), so charts appear in
    // the Scene with no Scene-side chart code. Inject the same mock callWS into the
    // Scene's hass and assert at least one sparkline paints among the embedded cards.
    await page.evaluate(
      ({ fixtureStates, nowMs }) => {
        const w = window as unknown as { __wsCalls?: number };
        w.__wsCalls = 0;
        const day = 86_400_000;
        const sample = (id: string) => ({
          [id]: [
            { s: '10', lu: (nowMs - day - 3_600_000) / 1000 },
            { s: '13', lu: (nowMs - day - 1000) / 1000 },
            { s: '20', lu: (nowMs - 3_600_000) / 1000 },
            { s: '26', lu: (nowMs - 1000) / 1000 },
          ],
        });
        const callWS = (msg: { entity_ids: string[] }) => {
          w.__wsCalls = (w.__wsCalls ?? 0) + 1;
          return Promise.resolve(sample(msg.entity_ids[0]));
        };

        document.getElementById('scene-host')?.remove();
        const card = document.querySelector('tesla-card') as unknown as {
          hass: Record<string, unknown>;
        };
        const hass = { ...card.hass, states: fixtureStates, callWS };

        const host = document.createElement('div');
        host.id = 'scene-host';
        host.style.cssText = 'width:1100px;padding:16px;box-sizing:border-box;';
        document.body.prepend(host);
        window.scrollTo(0, 0);

        const scene = document.createElement('tc-my-home') as unknown as {
          setConfig(c: unknown): void;
          hass: unknown;
        };
        scene.setConfig({ type: 'tc-my-home' });
        scene.hass = hass;
        host.appendChild(scene as unknown as HTMLElement);
      },
      { fixtureStates: ENERGY_DETAIL.states, nowMs: FIXTURE_NOW },
    );

    // Playwright pierces the nested open shadow roots (tc-my-home → tc-solar → svg.spark).
    await expect(page.locator('tc-my-home svg.spark').first()).toBeVisible();
    // And the Scene genuinely drove the new data path (callWS fired for the embedded cards).
    expect(await wsCalls(page)).toBeGreaterThan(0);
  });
});
