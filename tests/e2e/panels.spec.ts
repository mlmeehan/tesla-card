// Panel navigation: the tab strip, the conditionally-inserted Energy tab (proves
// energy-site auto-detection end-to-end), and that data flows into a panel.
import { test, expect, ALL_PANELS } from '../support/fixtures';

test.describe('panels — navigation + auto-detected energy', () => {
  test('charging is the default open panel', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.tab('Charging')).toHaveAttribute('aria-selected', 'true');
  });

  test('every panel tab opens and becomes selected', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    for (const name of ALL_PANELS) {
      await demo.openPanel(name);
    }
  });

  test('energy tab is present when a Powerwall site is detected', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.tab('Energy')).toBeVisible();
  });

  test('media panel surfaces now-playing metadata', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    await expect(demo.text('Bohemian Rhapsody')).toBeVisible();
    await expect(demo.text('Queen')).toBeVisible();
  });

  test('default_panel config option is honoured', async ({ demo }) => {
    await demo.open({ scenario: 'awake', panel: 'media' });
    await expect(demo.tab('Media')).toHaveAttribute('aria-selected', 'true');
  });
});
