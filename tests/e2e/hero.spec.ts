// Hero render modes. The first three are asset-free / committed and always run.
// Recolor needs bring-your-own art under demo/local/ (gitignored — Tesla trade
// dress stays out of the repo), so it is GUARDED: it runs on a dev machine that
// dropped the layers in, and skips on a fresh checkout / CI rather than failing.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '../support/fixtures';

const hasRecolorArt = existsSync(resolve(process.cwd(), 'demo/local/paintmask.png'));

test.describe('hero — render modes', () => {
  test('default: bundled generic-EV silhouette (zero-config)', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroSvg).toBeVisible();
  });

  test('paint: generic EV tints with no external assets', async ({ demo }) => {
    await demo.open({ scenario: 'awake', paint: '#23519e' });
    await expect(demo.heroSvg).toBeVisible();
    // Not just "rendered" — the resolved literal must actually drive the host's
    // --tc-paint custom property (the recolor stack reads it). Locked in a real
    // browser against the built bundle, not only the car.test.ts render unit.
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#23519e/);
  });

  test('image: legacy flat car.svg', async ({ demo }) => {
    await demo.open({ scenario: 'awake', image: true });
    await expect(demo.heroImage).toBeVisible();
    await expect(demo.heroImage).toHaveAttribute('src', /car\.svg$/);
  });

  test('recolor: photoreal body stack from demo/local/', async ({ demo }) => {
    test.skip(!hasRecolorArt, 'demo/local/ recolor art absent (gitignored / CI checkout)');
    await demo.open({ scenario: 'awake', recolor: true, paint: '#2a4f93' });
    await expect(demo.heroSvg).toBeVisible();
  });
});

// FR-1 (Story 3.2) — the paint *resolver* locked at the integration level: in a
// real browser, against the built bundle, the three resolution forms and the
// degradation chain must drive --tc-paint on the host the recolor stack reads.
// car.test.ts pins the render-function plumbing; these pin the resolvePaint()
// chain end-to-end (config → hero.ts → resolvePaint → --tc-paint).
test.describe('hero — paint resolution (FR-1: forms + degradation)', () => {
  // AC1b — a GENERIC preset *name* (not a CSS keyword) maps through PAINT_PRESETS
  // to its hex. "charcoal" isn't a CSS named colour, so it resolves via the map.
  test('AC1b: generic preset name resolves to its hex', async ({ demo }) => {
    await demo.open({ scenario: 'awake', paint: 'charcoal' });
    await expect(demo.heroSvg).toBeVisible();
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#1f2226/);
  });

  // AC1 ordering subtlety — a CSS keyword wins over the preset map: "blue" is a
  // CSS named colour, so it passes through verbatim and must NOT become the
  // preset PAINT_PRESETS.blue (#2a4f93). Locks the resolve order in-browser.
  test('AC1: CSS keyword wins over the preset map', async ({ demo }) => {
    await demo.open({ scenario: 'awake', paint: 'blue' });
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*blue\b/);
    await expect(demo.heroSvg).not.toHaveAttribute('style', /#2a4f93/);
  });

  // AC2 — degradation chain's final link: zero-config (no paint at all) lands on
  // the caller's neutral silver DEFAULT_PAINT (#c6c8c9) on the recolorable host.
  test('AC2: no paint degrades to neutral silver #c6c8c9', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroSvg).toBeVisible();
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#c6c8c9/);
  });

  // AC3 — flat image mode IGNORES paint: even with ?paint set, the <img> carries
  // no --tc-paint and no contract SVG is on the stage. (car.test.ts asserts the
  // same on the render unit; this is the shipped-bundle, real-DOM confirmation.)
  test('AC3: image mode ignores paint (no --tc-paint on the <img>)', async ({ demo }) => {
    await demo.open({ scenario: 'awake', image: true, paint: '#23519e' });
    await expect(demo.heroImage).toBeVisible();
    await expect(demo.heroImage).not.toHaveAttribute('style', /--tc-paint/);
    await expect(demo.heroStage.locator('svg')).toHaveCount(0);
  });
});

// AC1c — entity-driven PaintSource: the colour is read LIVE from an entity and
// mapped. The demo routes ?colorentity through the recolor body stack, which
// needs the gitignored demo/local art (else its <image> layers 404 and trip the
// console guard) — so these are GUARDED like the recolor test above: they run on
// a dev machine with the art and skip on a fresh checkout / CI. The host's
// --tc-paint is set from the resolved entity colour regardless of art presence.
test.describe('hero — entity-driven paint (AC1c live read + degradation)', () => {
  test.skip(!hasRecolorArt, 'demo/local/ recolor art absent (gitignored / CI checkout)');

  // AC1c — entity state "charcoal" → read live (via the data/ readRaw reader) →
  // mapped through PAINT_PRESETS to its hex on --tc-paint.
  test('AC1c: entity colour is read live and mapped to its preset hex', async ({ demo }) => {
    await demo.open({ scenario: 'awake', colorentity: 'charcoal' });
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#1f2226/);
  });

  // AC2 (entity branch) — an UNUSABLE entity state (unavailable/unknown/'' …)
  // degrades to the PaintSource's own `default` (the harness sets #9aa3ad),
  // never throwing on the missing exterior-colour attribute.
  test('AC2: unusable entity state degrades to the source default', async ({ demo }) => {
    await demo.open({ scenario: 'awake', colorentity: 'unavailable' });
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#9aa3ad/);
  });
});

// AC3 — the 1024×687 coordinate contract, and AC1 — the .surface/xl stage —
// locked at the integration level (real browser, built bundle), not just in the
// car.test.ts render-function unit. Epic 4's HeroSvgRenderer and Story 3.5's
// aperture overlays anchor to this exact viewBox, so a regression here breaks
// downstream compositing — these gates catch it against the shipped dist.
test.describe('hero — 1024×687 coordinate contract (AC3) + surface stage (AC1)', () => {
  test('zero-config hero SVG carries the 1024×687 contract viewBox', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroSvg).toHaveAttribute('viewBox', '0 0 1024 687');
  });

  test('bundled EV fits its intrinsic 1024×480 art undistorted (nested viewBox + meet)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    // The inner <svg> keeps the hand-tuned 1024×480 art and is centred + aspect-
    // preserved within the 1024×687 contract — never stretched.
    await expect(demo.heroInnerSvg).toHaveAttribute('viewBox', '0 0 1024 480');
    await expect(demo.heroInnerSvg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  test('hero renders on the .surface elevation stage', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.hero).toHaveClass(/\bsurface\b/);
  });

  test('image mode falls through cleanly: a flat <img>, no contract SVG on the stage', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake', image: true });
    await expect(demo.heroImage).toBeVisible();
    await expect(demo.heroStage.locator('svg')).toHaveCount(0);
  });
});
