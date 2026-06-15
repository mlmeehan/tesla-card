// Visual regression — OPT-IN (@visual). Excluded from the default gate because
// cross-OS font/anti-aliasing differences make pixel baselines machine-specific.
// Run with: npm run test:e2e:visual   (seed/update baselines: -- --update-snapshots)
// Baselines are committed under visual.spec.ts-snapshots/ and are per-platform.
//
// We snapshot the whole card in stable views only — never the Location panel,
// whose map iframe is intentionally blocked (hermetic) and would render empty.
import { test, expect } from '../support/fixtures';

test.describe('@visual card appearance', () => {
  test('awake / charging (default view)', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.tablist).toBeVisible();
    await expect(demo.card).toHaveScreenshot('card-awake-charging.png');
  });

  test('asleep', async ({ demo }) => {
    await demo.open({ scenario: 'asleep' });
    await expect(demo.tablist).toBeVisible();
    await expect(demo.card).toHaveScreenshot('card-asleep.png');
  });
});
