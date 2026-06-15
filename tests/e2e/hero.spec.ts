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
    await demo.open({ scenario: 'awake', recolor: true, paint: 'Deep Blue' });
    await expect(demo.heroSvg).toBeVisible();
  });
});
