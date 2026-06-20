// [NFR-3 matrix axis: light + dark host theme] — Story 7.4 traceability marker.
// Token contract — runtime E2E for Story 2.1 (`--tc-*` token contract / FR-28).
//
// The unit gate (src/styles.test.ts) proves the tokens *exist* and that every
// `var(--tc-*)` *read* in source carries a fallback. What no test exercised was
// the AC3 runtime claim: the card is dark-first by construction, its tokens are
// literal (not HA-theme-derived), so they must resolve to the SAME correct values
// whether the host page is light or dark — and the white-alpha surface/text ladder
// must read correctly regardless of the host background. The Dev Notes flag that
// the interactive light-host sweep was never run; this spec closes that gap by
// reading computed values out of the real bundled card in both host themes.
import { test, expect } from '../support/fixtures';

// A representative slice of the contract: text ramp, accents, surfaces, border,
// radius, shadow + one new ramp token. Their declared dark-first literals come
// straight from styles.ts `tokens` (the source of truth). Browsers normalise
// custom-property values minimally; we compare trimmed/lowercased text and only
// assert the substantive payload so the test isn't brittle to whitespace.
const EXPECTED: Record<string, string> = {
  '--tc-text': '#f1f5f9',
  '--tc-text-dim': '#9aa7b8',
  '--tc-text-mute': '#64748b',
  '--tc-blue': '#38bdf8',
  '--tc-surface': 'rgba(255, 255, 255, 0.045)',
  '--tc-border': 'rgba(255, 255, 255, 0.09)',
  '--tc-radius-md': '16px',
  '--tc-pill': '999px',
  '--tc-space-4': '16px',
};

/** Read every contract token off the card host as trimmed/lowercased strings. */
async function readTokens(card: import('@playwright/test').Locator) {
  return card.evaluate((host, names: string[]) => {
    const cs = getComputedStyle(host);
    const out: Record<string, string> = {};
    for (const n of names) out[n] = cs.getPropertyValue(n).trim().toLowerCase();
    return out;
  }, Object.keys(EXPECTED));
}

/** Force the host page background — proves token resolution is host-theme-independent. */
async function setHostBackground(page: import('@playwright/test').Page, bg: string) {
  await page.evaluate((b) => {
    document.documentElement.style.colorScheme = b === '#ffffff' ? 'light' : 'dark';
    document.body.style.background = b;
  }, bg);
}

test.describe('token contract — runtime resolution (Story 2.1)', () => {
  test('AC3: tokens resolve to their dark-first literals on the card host', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    const got = await readTokens(demo.card);
    for (const [token, expected] of Object.entries(EXPECTED)) {
      expect(got[token], `${token} must resolve to its DESIGN.md dark-first literal`).toBe(
        expected.toLowerCase(),
      );
    }
  });

  test('AC3: token values are identical under a light vs dark host theme', async ({ demo, page }) => {
    await demo.open({ scenario: 'awake' });

    // Default demo host is dark (radial-gradient navy).
    const onDark = await readTokens(demo.card);

    // Flip the host to a bright white background — a literal-token card must not move.
    await setHostBackground(page, '#ffffff');
    const onLight = await readTokens(demo.card);

    expect(onLight, 'tokens are literal → must be byte-identical across host themes').toEqual(onDark);
  });

  test('AC3: rendered text reads the dark-first colour regardless of host background', async ({ demo, page }) => {
    await demo.open({ scenario: 'awake' });
    // The hero vehicle name always renders and consumes var(--tc-text, #f1f5f9).
    const name = demo.card.locator('.name').first();
    await expect(name).toBeVisible();

    const colorOnDark = await name.evaluate((el) => getComputedStyle(el).color);
    expect(colorOnDark, 'vehicle name reads the dark-first --tc-text').toBe('rgb(241, 245, 249)');

    // White host background must not bleed into the card's literal text colour
    // (white-alpha ladder + literal text are theme-independent by construction).
    await setHostBackground(page, '#ffffff');
    const colorOnLight = await name.evaluate((el) => getComputedStyle(el).color);
    expect(colorOnLight, 'text colour is host-theme-independent').toBe(colorOnDark);
  });

  test('AC2: consumed var(--tc-*) reads resolve at runtime (fallback path is live)', async ({ demo }) => {
    // The demo provides NO host `--tc-*` theme override, so every consuming read
    // resolves through the token declaration / fallback chain. A real opaque colour
    // (not empty / `transparent`) proves the var() reads resolve rather than collapse.
    await demo.open({ scenario: 'awake' });
    const name = demo.card.locator('.name').first();
    const color = await name.evaluate((el) => getComputedStyle(el).color);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });
});
