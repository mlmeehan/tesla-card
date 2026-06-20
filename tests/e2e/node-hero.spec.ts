// Story 8.2 — Per-node hero art (the real-browser proof layer).
//
// The co-located jsdom suite (src/components/node-hero.test.ts + the per-card
// *.test.ts) pins the element-level contract — each helper's recognizable SVG
// structure, the no-raw-hex invariant, the decorative role, and the presence of a
// `prefers-reduced-motion` block in `nodeHeroStyles`. But jsdom applies NO
// stylesheet and runs NO media-query engine, so it explicitly CANNOT prove the
// things these ACs hinge on in a real browser:
//   • AC1/AC5 — the hero actually fills the `.eco-hero` slot as REAL, non-zero,
//     visible layout (the `.eco-hero:empty { display:none }` collapse only has
//     meaning with a real stylesheet);
//   • AC1 — Solar keeps its weather vignette (`.wx-art`) and grows NO `.nh-art`
//     (no duplicate node art) in a fully-rendered card;
//   • AC2 — every colour genuinely RESOLVES through the shadow-DOM token cascade
//     and the art is TOKEN-DRIVEN (recolors when the host `--tc-*` changes), not
//     baked — jsdom computes no `var(--tc-*)`;
//   • AC3 — `prefers-reduced-motion: reduce` FREEZES the WC status-dot pulse
//     (animation:none) while the dot stays a legible static read — jsdom reads no
//     media query (the audit-r6 reduced-motion pattern);
//   • AC4 — the hero is additive to the LIVE detail path only: an essentially-empty
//     hass falls through to the calm Epic-6 empty state with NO hero rendered;
//   • the Dev-Notes carry-forward — `tc-my-home` embeds the real cards, so the node
//     heroes appear in the COMPOSED Scene with zero Scene-side work.
//
// This spec is that real-browser proof. It mounts the concrete ecosystem cards
// (registered by the same single bundle the demo loads) into a sized, in-viewport
// host, fed the full energy-site `hass` built from the committed `energy-detail.json`
// fixture (the same fixture Story 8.1's spec + the resolution gate use). Entities
// are matched by FUNCTION-SLUG substring, never inlined — the [card] no-hard-coded-ids
// rule. The auto console-guard fails any spec that emits a console error.
import { readFileSync } from 'node:fs';
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

// The full energy-site fixture (read in Node; injected into the page). All entities
// share one `last_updated`, so every card resolves its live detail path (not the
// calm-empty path) and therefore renders its hero.
const ENERGY_DETAIL = JSON.parse(
  readFileSync(new URL('../../src/fixtures/energy-detail.json', import.meta.url), 'utf8'),
) as { states: Record<string, unknown> };

type EcoTag = 'tc-solar' | 'tc-grid' | 'tc-home' | 'tc-wall-connector' | 'tc-powerwall';
// The four cards that gain a hand-rolled hero (Solar reuses its weather vignette).
const HERO_TAGS: EcoTag[] = ['tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector'];

interface MountOpts {
  /** Replace the hass states with an empty map (the calm-empty path). */
  empty?: boolean;
  /** Inline host-style overrides (e.g. `--tc-green: rgb(1,2,3)` to prove token-driven recolor). */
  hostStyle?: string;
  /** Inject HA-core `weather.home` + `sun.sun` so Solar's vignette honesty gate opens. */
  withWeather?: boolean;
}

// HA-core weather state (NOT a Tesla function-slug) that opens the Solar vignette's
// honesty gate — `weatherVignette` omits the sky when `readRaw(weather.home)` is
// absent, so the energy-detail fixture alone leaves Solar's hero empty (correct).
const WEATHER_STATES = {
  'weather.home': { state: 'partlycloudy', attributes: {}, last_updated: '2026-06-20T12:00:00+00:00' },
  'sun.sun': { state: 'above_horizon', attributes: {}, last_updated: '2026-06-20T12:00:00+00:00' },
};

// Mount one concrete ecosystem card into a fresh, sized, in-viewport host, fed the
// energy-detail `hass` overlaid onto the live card's hass — the Story-8.1 spec's
// mount pattern. Addressable via its `tc-*` locator (Playwright pierces open shadow).
async function mountCard(page: Page, tag: EcoTag, opts: MountOpts = {}): Promise<void> {
  await page.evaluate(
    ({ tag, fixtureStates, weatherStates, opts }) => {
      document.getElementById('eco-host')?.remove();
      const states = opts.empty
        ? {}
        : opts.withWeather
          ? { ...fixtureStates, ...weatherStates }
          : fixtureStates;
      const card = document.querySelector('tesla-card') as unknown as {
        hass: Record<string, unknown>;
      };
      const hass = { ...card.hass, states };

      const host = document.createElement('div');
      host.id = 'eco-host';
      host.style.cssText = `width:720px;padding:16px;box-sizing:border-box;${opts.hostStyle ?? ''}`;
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
    { tag, fixtureStates: ENERGY_DETAIL.states, weatherStates: WEATHER_STATES, opts },
  );
}

// Mount the COMPOSED Scene fed the energy-detail hass (+ HA-core weather so Solar's
// vignette renders) so the embedded concrete cards each resolve their live detail
// path (and therefore render their hero).
async function mountScene(page: Page): Promise<void> {
  await page.evaluate(
    ({ fixtureStates, weatherStates }) => {
    document.getElementById('scene-host')?.remove();
    const card = document.querySelector('tesla-card') as unknown as {
      hass: Record<string, unknown>;
    };
    const hass = { ...card.hass, states: { ...fixtureStates, ...weatherStates } };

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
    { fixtureStates: ENERGY_DETAIL.states, weatherStates: WEATHER_STATES },
  );
}

const card = (page: Page, tag: EcoTag) => page.locator(tag);
const heroArt = (page: Page, tag: EcoTag) => card(page, tag).locator('.eco-hero svg.nh-art');
// Each node's recognizable structural marker (the jsdom suite pins the rest).
const HERO_MARKER: Record<Exclude<EcoTag, 'tc-solar'>, string> = {
  'tc-powerwall': '.nh-pw-fill',
  'tc-grid': '.nh-cable',
  'tc-home': '.nh-roof',
  'tc-wall-connector': '.nh-wc-dot',
};

const animName = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => getComputedStyle(el).animationName);

test.describe('Story 8.2 — per-node hero art (real browser)', () => {
  test.beforeEach(async ({ demo }) => {
    // Load the demo so the single bundle parses + registers the five ecosystem cards
    // (+ tc-my-home). We then mount our own card/scene fed the energy-detail hass.
    await demo.open(AWAKE.open);
  });

  // ── AC1 / AC5 — each node's hero fills the slot as REAL, visible, non-zero layout ──

  for (const tag of HERO_TAGS) {
    test(`AC1/AC5 — ${tag} renders its recognizable hero in the .eco-hero slot with a real box`, async ({
      page,
    }) => {
      await mountCard(page, tag);
      const art = heroArt(page, tag);
      await expect(art, `${tag}: a single .nh-art hero fills the hero slot`).toHaveCount(1);

      // The node-specific recognizable marker is present (Powerwall fill / Grid cable /
      // House roof / WC status dot) — the hero reads as THIS node, not a generic shape.
      // (Grid carries two cable paths, so assert ≥1 via `.first()`, not an exact count.)
      await expect(
        card(page, tag)
          .locator(`.eco-hero ${HERO_MARKER[tag as Exclude<EcoTag, 'tc-solar'>]}`)
          .first(),
        `${tag}: node-specific marker present`,
      ).toBeVisible();

      // The hero is a render helper, never a custom element (AC5) and carries the
      // decorative contract (role="img") — proven in the real rendered DOM.
      await expect(art).toHaveAttribute('role', 'img');
      await expect(art).toHaveAttribute('viewBox', '0 0 300 138');

      // REAL layout: the slot did NOT collapse (.eco-hero:empty{display:none}); the
      // hero has a genuine non-zero, visible box — the proof jsdom cannot give.
      const box = await art.boundingBox();
      expect(box, `${tag}: hero has a real box`).not.toBeNull();
      expect(box!.width, `${tag}: hero width`).toBeGreaterThan(0);
      expect(box!.height, `${tag}: hero height`).toBeGreaterThan(0);
      await expect(art).toBeVisible();
    });
  }

  // ── AC1 — Solar keeps its weather vignette; it grows NO duplicate node art ───────

  test('AC1 — Solar reuses its weather vignette (.wx-art) and renders NO .nh-art', async ({
    page,
  }) => {
    await mountCard(page, 'tc-solar', { withWeather: true });
    // The vignette hero is present (Story 6.4) and remains Solar's hero.
    await expect(card(page, 'tc-solar').locator('.eco-hero svg.wx-art')).toHaveCount(1);
    // No node-hero art is added to Solar — no duplicate Solar illustration (AC1).
    await expect(card(page, 'tc-solar').locator('.nh-art')).toHaveCount(0);
  });

  // ── AC2 — colours RESOLVE through the shadow-DOM token cascade and are token-driven ──

  test('AC2 — the Powerwall charge fill resolves the green token (not transparent/baked)', async ({
    page,
  }) => {
    await mountCard(page, 'tc-powerwall');
    const fill = await card(page, 'tc-powerwall')
      .locator('.eco-hero .nh-pw-fill')
      .evaluate((el) => getComputedStyle(el).fill);
    // The token cascade actually resolved to a real, non-empty colour in a real
    // browser (jsdom returns ''/none) — proof the art reads its accent at runtime.
    expect(fill).toMatch(/^rgb/);
    expect(fill).not.toBe('none');
  });

  test('AC2 — the hero art is TOKEN-DRIVEN: overriding --tc-green recolors the fill', async ({
    page,
  }) => {
    // Override the green accent token on the host; the `var(--tc-green, …)` fill must
    // follow it (it is NOT a baked hex) — the strongest token-driven proof, and one
    // only a real browser can give.
    await mountCard(page, 'tc-powerwall', { hostStyle: '--tc-green: rgb(1, 2, 3);' });
    const fill = await card(page, 'tc-powerwall')
      .locator('.eco-hero .nh-pw-fill')
      .evaluate((el) => getComputedStyle(el).fill);
    expect(fill).toBe('rgb(1, 2, 3)');
  });

  // ── AC3 — reduced-motion freezes the only motion (the WC status-dot pulse) ───────

  test('AC3 control — the WC status dot pulses by default', async ({ page }) => {
    await mountCard(page, 'tc-wall-connector');
    const dot = card(page, 'tc-wall-connector').locator('.eco-hero .nh-wc-dot');
    await expect(dot).toHaveCount(1);
    expect(await animName(dot), 'WC dot animates by default').toBe('nhPulse');
  });

  test('AC3 — prefers-reduced-motion FREEZES the WC pulse while the dot stays legible', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountCard(page, 'tc-wall-connector');
    const dot = card(page, 'tc-wall-connector').locator('.eco-hero .nh-wc-dot');
    await expect(dot).toHaveCount(1);

    // "Kill the motion, keep the data": the pulse halts (animation:none)…
    expect(await animName(dot), 'WC dot pulse must halt under reduced-motion').toBe('none');
    // …but the dot is still a fully legible static read — a real, non-empty fill.
    const fill = await dot.evaluate((el) => getComputedStyle(el).fill);
    expect(fill).toMatch(/^rgb/);
    await expect(dot).toBeVisible();
  });

  // ── AC4 — the hero is additive to the LIVE detail path only ──────────────────────

  test('AC4 — an essentially-empty hass shows the calm empty state with NO hero', async ({
    page,
  }) => {
    await mountCard(page, 'tc-powerwall', { empty: true });
    // The shell still renders (presence-tolerant) and the calm Epic-6 empty state shows…
    await expect(card(page, 'tc-powerwall').locator('.eco-empty')).toHaveCount(1);
    // …but NO hero art is rendered on the empty path (the hero is live-detail-only).
    await expect(card(page, 'tc-powerwall').locator('.nh-art')).toHaveCount(0);
    // The auto console-guard asserts the empty mount emitted no errors at teardown.
  });

  // ── Dev-Notes carry-forward — the composed Scene gets the heroes for free ────────

  test('composed — the node heroes appear inside the tc-my-home Scene with no Scene-side work', async ({
    page,
  }) => {
    await mountScene(page);
    const scene = page.locator('tc-my-home');
    // The Scene embeds the real concrete cards, so their live heroes render inside it.
    // Powerwall + WC are the two most node-specific markers; both must be present.
    await expect(scene.locator('tc-powerwall .eco-hero .nh-pw-fill')).toHaveCount(1);
    await expect(scene.locator('tc-wall-connector .eco-hero .nh-wc-dot')).toHaveCount(1);
    // Solar still shows its vignette, not a node hero, in the composed Scene too.
    await expect(scene.locator('tc-solar .eco-hero svg.wx-art')).toHaveCount(1);
    await expect(scene.locator('tc-solar .nh-art')).toHaveCount(0);
  });
});
