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

  test('Story 9.12 / K10: appearance.theme=light APPLIES on the rendered card and cascades into nested children', async ({
    demo,
  }) => {
    // The unit corpus proves the pieces separately (attr reflection, the static
    // :host([theme='light']) CSS text, the editor preview) — but a typo'd host
    // selector or a broken shadow-DOM cascade would pass all three. This reads the
    // COMPUTED values off the live bundled card: host token re-resolution, child
    // consumption (the hero name's color), and accent stability.
    await demo.open({ scenario: 'awake' });
    const name = demo.card.locator('.name').first();
    await expect(name).toBeVisible();
    expect(await name.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(241, 245, 249)'); // dark baseline

    // Apply the override exactly as the editor writes it (public setConfig, R9 spread).
    await demo.card.evaluate((host) => {
      const el = host as unknown as {
        _config?: Record<string, unknown>;
        setConfig(c: unknown): void;
        updateComplete: Promise<boolean>;
      };
      el.setConfig({ ...(el._config ?? { type: 'custom:tesla-card' }), appearance: { theme: 'light' } });
      return el.updateComplete;
    });
    await expect(demo.card).toHaveAttribute('theme', 'light');

    // Host: the LIGHT_TOKENS block re-resolves the colour tokens (computed, not static CSS text).
    const light = await readTokens(demo.card);
    expect(light['--tc-text'], 'light text token applied on the host').toBe('#101725');
    expect(light['--tc-surface'], 'light surface ladder applied').toBe('rgba(10, 14, 26, 0.04)');
    // Accents are semantic on BOTH grounds — they must NOT move under light.
    expect(light['--tc-blue'], 'accents stay put under light').toBe('#38bdf8');

    // Nested child CONSUMPTION: the hero name (inside tc-hero's shadow root) now reads
    // the light text colour — the token override cascades with no per-child edit.
    expect(await name.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(16, 23, 37)');
    // And a token READ inside a nested child host resolves light (shadow-DOM inheritance).
    const heroSurface = await demo.card
      .locator('tc-hero')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--tc-surface').trim().toLowerCase());
    expect(heroSurface).toBe('rgba(10, 14, 26, 0.04)');
  });

  test('Story 9.12 / K10: deleting the override (Auto) restores the dark default byte-for-byte', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    const before = await readTokens(demo.card);
    // light on, then Auto (key DELETED, the editor's reset shape — never theme:'')…
    await demo.card.evaluate((host) => {
      const el = host as unknown as {
        _config?: Record<string, unknown>;
        setConfig(c: unknown): void;
        updateComplete: Promise<boolean>;
      };
      el.setConfig({ ...(el._config ?? { type: 'custom:tesla-card' }), appearance: { theme: 'light' } });
      return el.updateComplete;
    });
    await expect(demo.card).toHaveAttribute('theme', 'light');
    await demo.card.evaluate((host) => {
      const el = host as unknown as {
        _config?: Record<string, unknown>;
        setConfig(c: unknown): void;
        updateComplete: Promise<boolean>;
      };
      const next = { ...(el._config ?? { type: 'custom:tesla-card' }) } as Record<string, unknown>;
      delete next.appearance;
      el.setConfig(next);
      return el.updateComplete;
    });
    // …→ attribute removed and every contract token back to its dark-first literal.
    await expect(demo.card).not.toHaveAttribute('theme');
    expect(await readTokens(demo.card)).toEqual(before);
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
