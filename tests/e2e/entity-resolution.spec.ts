// The card resolves entities by function-name against whatever the device is
// called — not a hard-coded prefix. Same vehicle, two installs: garage_model_y_*
// vs my_tesla_*. Both must render identical data.
import { test, expect, AWAKE_RENAMED, CARD_NAME } from '../support/fixtures';

test.describe('entity resolution — name-based, prefix-independent', () => {
  test('resolves a differently-named device (my_tesla_*) at load', async ({ demo }) => {
    await demo.open(AWAKE_RENAMED.open);
    for (const needle of AWAKE_RENAMED.visible) {
      await expect(demo.text(needle), `expected "${needle}" visible`).toBeVisible();
    }
  });

  test('re-resolves when the device is swapped at runtime', async ({ demo }) => {
    await demo.open({ scenario: 'awake' }); // garage_model_y_*
    await expect(demo.text('72%')).toBeVisible();

    await demo.setEnv('renamed'); // my_tesla_*
    await expect(demo.text(CARD_NAME)).toBeVisible();
    await expect(demo.text('72%')).toBeVisible(); // same battery, new prefix
  });
});
