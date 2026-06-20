// Tyres panel — RUNTIME E2E for Story 5.8 (FR-19). The unit gate
// (src/components/panel-tyres.test.ts) proves the TS/jsdom logic — the computed
// margin check, temperature-robustness, freshness honesty. What no test exercised
// is that the panel's deltas actually render on the REAL bundled card, in a real
// browser, when a user opens the Tyres tab:
//   AC1 — four corners each render their live pressure + native unit (bar, 1-dp)
//         under the British "Tyre pressure" title; the generic silhouette paints;
//   AC2 — the integration's TPMS warning still surfaces (the OR/augment), and it
//         does so as a "Low" CHIP (icon + text), never colour alone — the
//         colour-blind-safe contract — while the unflagged corners stay calm
//         (the live fixture does not false-trip the other three);
//   AC3 — a foreign/unconfigured install still renders the panel calmly (em-dash
//         placeholders, no throw) — the auto consoleGuard is the "never crash" half.
//
// The Tyres panel is NOT the default open panel (charging is), so every test opens
// it first. Sibling panels.spec.ts proves the tab strip + navigation generically;
// this file is the 5.8-specific tyres surface. Fixture values (awake corpus):
// FL/RL/RR = 2.9 bar, FR = 2.6 bar with tire_warn_fr ON → exactly the FR corner
// warns via TPMS; recommended = max = 2.9, default margin 0.3 → threshold 2.6, so
// the computed check alone does NOT trip FR (2.6 is not < 2.6) — proving the warn
// here comes from the OR-ed TPMS sensor, never an under-warn.
import { test, expect } from '../support/fixtures';

// ── AC1 — four corners render pressure + unit under the British title ──────────
test.describe('AC1 — corners render live pressure + bar unit, British title', () => {
  test('the Tyres tab opens and renders four corner cards', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Tyres');
    await expect(demo.tyresPanel).toBeVisible();
    await expect(demo.tyreCorners).toHaveCount(4);
  });

  test('each corner shows its pressure with the native bar unit (1-dp)', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Tyres');
    await expect(demo.tyreCorner('fl')).toContainText('2.9');
    await expect(demo.tyreCorner('fl')).toContainText('bar');
    await expect(demo.tyreCorner('fr')).toContainText('2.6');
  });

  test('the "Tyre pressure" title and the generic car silhouette render', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Tyres');
    await expect(demo.tyresPanel.getByText('Tyre pressure')).toBeVisible();
    await expect(demo.tyresPanel.locator('.car svg')).toBeVisible();
  });
});

// ── AC2 — TPMS OR/augment surfaces as a colour-blind-safe "Low" chip ──────────
test.describe('AC2 — TPMS warning surfaces as a text+icon chip, not colour alone', () => {
  test('the TPMS-flagged corner (FR) warns; the other three stay calm', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Tyres');
    // Exactly one corner warns in the live fixture (FR via its TPMS binary_sensor).
    await expect(demo.tyreCorner('fr')).toHaveClass(/warn/);
    await expect(demo.tyreWarnChips).toHaveCount(1);
    for (const pos of ['fl', 'rl', 'rr'] as const) {
      await expect(demo.tyreCorner(pos)).not.toHaveClass(/warn/);
    }
  });

  test('the low signal is a "Low" chip (icon + real text), never colour-only', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Tyres');
    const chip = demo.tyreCorner('fr').locator('.c-warn');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Low'); // real text — colour-blind safe (UX-DR21)
    await expect(chip.locator('svg')).toBeVisible(); // the mdiAlertCircle glyph
  });

  test('the head summary reflects the warning honestly ("Check pressure")', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Tyres');
    await expect(demo.tyresSummary).toContainText('Check pressure');
  });
});

// ── AC3 — graceful degradation on a foreign/unconfigured install ──────────────
test.describe('AC3 — foreign install renders the panel calmly, no crash', () => {
  test('an unresolved install shows em-dash placeholders, never a false reading', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'unresolved' });
    await demo.openPanel('Tyres');
    await expect(demo.tyresPanel).toBeVisible();
    await expect(demo.tyreCorners).toHaveCount(4); // the four placeholders still paint
    await expect(demo.tyreCorner('fl')).toContainText('—'); // NaN-safe neutral placeholder
    // No corner fabricates a warn on absent data, and the summary is the "No data"
    // calm state — never a confident reading the card cannot back up.
    await expect(demo.tyreWarnChips).toHaveCount(0);
    await expect(demo.tyresSummary).toContainText('No data');
    // consoleGuard (auto fixture) asserts the fully-degraded panel emitted no
    // console/page error while a real browser upgraded and rendered it.
  });
});
