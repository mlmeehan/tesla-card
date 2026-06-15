// Brand face + stat-key — runtime E2E for Story 2.2 (semantic accents, `.surface`
// recipe & brand face / AC3).
//
// The unit gate (src/styles.test.ts) proves the SOURCE wires `--tc-font-display`
// onto the display-role elements and reconciles the `.stat .k` token to 11.5px/700.
// What no test exercised is the AC3 RUNTIME claim: those reads must actually resolve
// at render time (the var() chain is live, not collapsed), the deliberate stat-key
// visual change must really paint at 11.5/700, and the name-only display face must
// DEGRADE CLEANLY where Plus Jakarta Sans is absent (headless Chrome ships no PJS,
// so this is exactly the stock-HACS-install path the story says is a no-op). This
// spec reads computed values out of the real bundled card to close that gap.
import { test, expect } from '../support/fixtures';

// The body stack tail shared by --tc-font and the --tc-font-display fallback. A
// display element that degrades cleanly ends with this exact tail; a body element
// resolves to it with no Plus Jakarta Sans prefix. Chrome normalises single→double
// quotes and collapses whitespace in computed font-family, so compare lowercased.
const BODY_STACK_TAIL = 'ui-sans-serif, system-ui, -apple-system, "segoe ui", roboto, sans-serif';

const family = (el: import('@playwright/test').Locator) =>
  el.evaluate((e) => getComputedStyle(e).fontFamily.toLowerCase());

test.describe('brand display face — runtime wiring & degradation (Story 2.2 AC3)', () => {
  test('display-role element renders the name-only Plus Jakarta Sans chain', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    const name = demo.card.locator('.name').first();
    await expect(name).toBeVisible();

    const fam = await family(name);
    // The var(--tc-font-display, …) read resolved at runtime (not empty/collapsed):
    // Plus Jakarta Sans is requested by name, ahead of the body-stack fallback.
    expect(fam, 'hero name must request the display face first').toContain('plus jakarta sans');
    expect(fam, 'display read must degrade to the shared body stack').toContain(BODY_STACK_TAIL);
  });

  test('body/running text stays on the body face (no display face leak)', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    // Stat VALUES (.stat .v) are running text and must NOT carry the display face —
    // only the stat KEY and other display roles do. This proves the wiring is
    // scoped, not blanket-applied to the whole card.
    const value = demo.card.locator('.stat .v').first();
    await expect(value).toBeVisible();

    const fam = await family(value);
    expect(fam, 'running text must not request the display face').not.toContain('plus jakarta sans');
    expect(fam, 'running text resolves to the body stack').toContain(BODY_STACK_TAIL);
  });

  test('AC3 degrades cleanly: display + body share one resolved stack where PJS is absent', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    // Headless Chrome has no Plus Jakarta Sans installed — the stock-install path.
    // Stripping the (unavailable) PJS prefix, the display element's family must be
    // byte-identical to the body element's: i.e. wiring the brand face is a true
    // no-op on installs without the font, exactly as the story claims.
    const nameFam = (await family(demo.card.locator('.name').first()))
      .replace(/"?plus jakarta sans"?,\s*/, '');
    const bodyFam = await family(demo.card.locator('.stat .v').first());
    expect(nameFam, 'degraded display stack == body stack (no-op on stock installs)').toBe(bodyFam);
  });
});

test.describe('stat-key reconciliation — runtime (Story 2.2 AC3)', () => {
  test('the deliberate stat-key visual change paints at 11.5px / 700', async ({ demo }) => {
    // Story 2.1 left .stat .k at 10.5px/600; Story 2.2 reconciled it to the
    // DESIGN.md stat-key contract (11.5px/700) as an OWNED visual change. Prove the
    // var(--tc-fs-stat-key)/var(--tc-fw-stat-key) reads resolve and the tiles
    // actually render at the reconciled values (a reviewer must not mistake the
    // deliberate nudge for a regression — nor a silent revert to 10.5/600).
    await demo.open({ scenario: 'awake', panel: 'charging' });
    const key = demo.card.locator('.stat .k').first();
    await expect(key).toBeVisible();

    const { size, weight } = await key.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, weight: cs.fontWeight };
    });
    expect(size, 'stat-key resolves to the reconciled 11.5px').toBe('11.5px');
    expect(weight, 'stat-key resolves to the reconciled 700').toBe('700');
  });
});
