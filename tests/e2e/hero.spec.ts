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
