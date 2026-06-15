// Smoke: the card upgrades and renders from a mock hass — cleanly (no console/page
// errors, via the auto consoleGuard) — in both the awake and asleep scenarios.
import { test, expect, AWAKE, ASLEEP, type CardExpectation } from '../support/fixtures';

const SCENARIOS: CardExpectation[] = [AWAKE, ASLEEP];

test.describe('smoke — card renders from mock hass', () => {
  for (const scenario of SCENARIOS) {
    test(`renders cleanly: ${scenario.label}`, async ({ demo }) => {
      await demo.open(scenario.open);

      // Custom element upgraded and the tab strip painted.
      await expect(demo.card).toBeVisible();
      await expect(demo.tablist).toBeVisible();

      for (const needle of scenario.visible) {
        await expect(demo.text(needle), `expected "${needle}" visible`).toBeVisible();
      }
      for (const needle of scenario.absent ?? []) {
        await expect(
          demo.card.getByText(needle, { exact: false }),
          `expected "${needle}" absent`,
        ).toHaveCount(0);
      }
      // consoleGuard (auto fixture) asserts no unexpected console/page errors here.
    });
  }
});
