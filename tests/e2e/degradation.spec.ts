// Degradation e2e (Story 1.6, AC1 + AC2 rendered proof). A foreign / unconfigured
// install — no Tesla entities resolve, no registry — must still upgrade and render
// a calm, designed empty state in a real browser: vehicle name + neutral em-dash
// placeholders, the tab strip painted, no Energy tab, and crucially ZERO console /
// page errors. The auto consoleGuard fixture is the machine-checked "never crash /
// never blank" assertion; the absent-strings are the "never a false reading" one.
import { test, expect, UNRESOLVED } from '../support/fixtures';

test.describe('degradation — foreign/unconfigured install renders cleanly', () => {
  test(`renders the designed empty state: ${UNRESOLVED.label}`, async ({ demo }) => {
    await demo.open(UNRESOLVED.open);

    // The custom element upgraded and the tab strip painted (card did not blank).
    await expect(demo.card).toBeVisible();
    await expect(demo.tablist).toBeVisible();

    for (const needle of UNRESOLVED.visible) {
      await expect(demo.text(needle), `expected "${needle}" visible`).toBeVisible();
    }
    for (const needle of UNRESOLVED.absent ?? []) {
      await expect(
        demo.card.getByText(needle, { exact: false }),
        `expected "${needle}" absent (no false reading)`,
      ).toHaveCount(0);
    }

    // No energy site is detected on a foreign install → the Energy tab stays hidden.
    await expect(demo.tab('Energy')).toHaveCount(0);

    // consoleGuard (auto fixture) asserts no console/page error was emitted while a
    // real browser upgraded and rendered the card under fully-degraded data.
  });
});
