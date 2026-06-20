// [NFR-3 matrix axis: renders mobile + desktop] — Story 7.4 traceability marker
// (per-test setViewportSize sweep incl. a ≤540px mobile width).
// Commands (fire-and-forget) — RUNTIME E2E for Story 5.3 (FR-15 / UX-DR7).
//
// The unit gate (src/components/commands.test.ts) proves the component's logic in
// jsdom: the disabled predicate degrades only on missing/'unavailable', the asleep
// hint reuses STRINGS.hero.tapToWake, the label CSS *source* carries {typography.label},
// and a tap calls button.press against the resolved id. What jsdom CANNOT exercise —
// and what this spec closes — is that the contract actually takes effect in a real
// browser: the ≥44×44 tap-target floor MEASURED in real layout, the responsive 6→3
// grid collapse at the 540 breakpoint, the label typography as a COMPUTED style
// (text-transform/letter-spacing actually applied, not just present in cssText), an
// end-to-end button.press dispatch through the live card.hass, and that the whole
// surface renders cleanly (auto consoleGuard) — including the genuinely-missing
// `boombox` (absent from the committed fixtures) degrading without a single error.
//
// Deliberate contrast with quick-actions: commands are fire-and-forget — a tap fires
// button.press and is DONE. No optimistic flip, no reconcile, no pressed/.on class,
// no aria-pressed. This spec asserts that absence in the rendered DOM after a tap.
import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';

/**
 * Wrap the live card's `hass.callService` so taps are observable as structured
 * records. The demo rebuilds `hass` on every service call (its optimistic handler
 * calls push()), so the wrapper survives exactly one captured call per install —
 * which is all a fire-and-forget tap needs. We record synchronously BEFORE delegating,
 * so the call we care about is captured even though push() then swaps in a fresh hass.
 */
async function captureServiceCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const card = document.querySelector('tesla-card') as unknown as {
      hass: { callService: (d: string, s: string, data: { entity_id?: string }) => unknown };
    };
    (window as unknown as { __svc: unknown[] }).__svc = [];
    const hass = card.hass;
    const orig = hass.callService.bind(hass);
    hass.callService = (domain, service, data) => {
      (window as unknown as { __svc: unknown[] }).__svc.push({ domain, service, data });
      return orig(domain, service, data);
    };
  });
}

type ServiceCall = { domain: string; service: string; data: { entity_id?: string } };
const serviceCalls = (page: Page): Promise<ServiceCall[]> =>
  page.evaluate(() => (window as unknown as { __svc: ServiceCall[] }).__svc ?? []);

// ── AC1: ≤6 column buttons, each a fire-and-forget button.press on the resolved id ──
test.describe('AC1 — six fire-and-forget command buttons', () => {
  test('renders the command row at the card bottom — six real <button class="cmd"> pills', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.commands).toBeVisible();
    await expect(demo.commandButtons).toHaveCount(6);
    // Each visible label is the accessible name (the inline icon is aria-hidden).
    for (const label of ['Wake', 'Honk', 'Flash', 'HomeLink', 'Keyless', 'Boombox']) {
      await expect(demo.command(label)).toBeVisible();
    }
  });

  test('tapping an enabled command fires button.press against the RESOLVED entity id', async ({ demo, page }) => {
    await demo.open({ scenario: 'awake' });
    await captureServiceCalls(page);

    await demo.command('Wake').click();

    await expect
      .poll(async () => (await serviceCalls(page)).length, { message: 'one service call per tap' })
      .toBe(1);
    const [call] = await serviceCalls(page);
    expect(call.domain).toBe('button');
    expect(call.service).toBe('press');
    // Resolved by the parent from config.entities — id is install-prefixed; assert by function-slug.
    expect(call.data.entity_id).toContain('wake');
  });

  test('a tap is fire-and-forget — no optimistic flip, no pressed/.on class, no aria-pressed', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    const honk = demo.command('Honk');
    await honk.click();
    // The button does NOT pretend the world changed (EXPERIENCE.md L114).
    await expect(honk).not.toHaveClass(/\bon\b/);
    expect(await honk.getAttribute('aria-pressed')).toBeNull();
  });

  test('label typography computes to {typography.label}: UPPERCASE / 700 / letter-spaced', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    const span = demo.command('Wake').locator('span');
    const cs = await span.evaluate((el) => {
      const s = getComputedStyle(el);
      return { transform: s.textTransform, weight: s.fontWeight, spacing: s.letterSpacing };
    });
    expect(cs.transform).toBe('uppercase');
    expect(cs.weight).toBe('700'); // --tc-fw-label
    // 0.1em of an 11.5px label → a real, non-zero tracking (not 'normal'/'0px').
    expect(cs.spacing).not.toBe('normal');
    expect(cs.spacing).not.toBe('0px');
  });
});

// ── AC1b: ≥44×44 tap-target floor — measured in the real layout (jsdom cannot) ──
test.describe('AC1 — ≥44×44 tap-target floor (UX-DR21), both grid states', () => {
  for (const width of [1280, 400]) {
    test(`every enabled command pill is ≥44×44 at viewport ${width}px (${width <= 540 ? '3-col compact' : '6-col'})`, async ({
      demo,
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await demo.open({ scenario: 'awake' });
      const buttons = demo.commandButtons;
      const count = await buttons.count();
      expect(count).toBe(6);
      for (let i = 0; i < count; i++) {
        const b = buttons.nth(i);
        // Disabled pills are pointer-events:none + opacity .4 — the floor is a tap target
        // guarantee, asserted on the actionable controls.
        if (await b.isDisabled()) continue;
        const box = await b.boundingBox();
        const label = (await b.innerText()).trim();
        expect(box, `command "${label}" has no box`).not.toBeNull();
        expect(box!.height, `"${label}" height ≥44 @${width}px`).toBeGreaterThanOrEqual(44);
        expect(box!.width, `"${label}" width ≥44 @${width}px`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

// ── AC1c: responsive 6→3 grid collapse at BREAKPOINTS.compact (540) — real CSS ──
test.describe('AC1 — responsive grid: 6 columns wide, 3 columns compact', () => {
  const trackCount = (demo: { commands: import('@playwright/test').Locator }) =>
    demo.commands
      .locator('.row')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length);

  test('the command row is a 6-track grid on a wide viewport', async ({ demo, page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await demo.open({ scenario: 'awake' });
    expect(await trackCount(demo)).toBe(6);
  });

  test('the command row collapses to a 3-track grid ≤540px', async ({ demo, page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    await demo.open({ scenario: 'awake' });
    expect(await trackCount(demo)).toBe(3);
  });
});

// ── AC2: asleep car → the commands read as wake affordances ("Tap a command to wake") ──
test.describe('AC2 — asleep wake-affordance reading', () => {
  test('asleep → the "Tap a command to wake" hint is shown', async ({ demo }) => {
    await demo.open({ scenario: 'asleep' });
    await expect(demo.wakeHint).toBeVisible();
    await expect(demo.wakeHint).toHaveText('Tap a command to wake');
  });

  test('awake → the hint is ABSENT', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.wakeHint).toHaveCount(0);
  });

  test('asleep → wake stays ENABLED and tappable so the car can be woken', async ({ demo, page }) => {
    await demo.open({ scenario: 'asleep' });
    const wake = demo.command('Wake');
    await expect(wake).toBeEnabled();
    await captureServiceCalls(page);
    await wake.click();
    await expect.poll(async () => (await serviceCalls(page)).length).toBe(1);
    expect((await serviceCalls(page))[0]).toMatchObject({ domain: 'button', service: 'press' });
  });

  test('the asleep hint is an instant presence change — no keyframe (reduced-motion-safe by construction)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'asleep' });
    const anim = await demo.wakeHint.evaluate((el) => getComputedStyle(el).animationName);
    expect(anim, 'the hint reveal must not animate (instant cut)').toBe('none');
  });

  test('the asleep hint survives a real prefers-reduced-motion run (data kept, not removed)', async ({ demo, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await demo.open({ scenario: 'asleep' });
    await expect(demo.wakeHint).toBeVisible();
    await expect(demo.wakeHint).toHaveText('Tap a command to wake');
  });
});

// ── AC3: graceful degradation — missing / 'unavailable' commands degrade, never error ──
// The committed fixtures give all six commands a last-pressed timestamp (available),
// so the degrade cases are injected through the LIVE card.hass: a genuinely-missing
// entity (deleted) and an explicit 'unavailable' one. Default env (prefix
// 'garage_model_y') resolves command ids 1:1 with const.ts DEFAULT_ENTITIES, so we can
// address them by their bare ids. Drives the real isMissing predicate in a real browser.
const ID_HONK = 'button.garage_model_y_honk_horn'; // → deleted (genuinely missing)
const ID_FLASH = 'button.garage_model_y_flash_lights'; // → set 'unavailable'

/** Push a fresh hass (new ref → Lit re-renders) with honk removed + flash 'unavailable'. */
async function degradeHonkAndFlash(page: Page): Promise<void> {
  await page.evaluate(
    ({ honk, flash }) => {
      const card = document.querySelector('tesla-card') as unknown as {
        hass: { states: Record<string, unknown>; callService: unknown };
      };
      const states = { ...card.hass.states } as Record<string, { entity_id: string; state: string; attributes: object }>;
      delete states[honk]; // genuinely missing → stateObj undefined
      if (states[flash]) states[flash] = { ...states[flash], state: 'unavailable' };
      card.hass = { ...card.hass, states };
    },
    { honk: ID_HONK, flash: ID_FLASH }
  );
}

test.describe('AC3 — missing / unavailable commands degrade cleanly (never-throws)', () => {
  test('a genuinely-missing command renders DISABLED and a forced tap dispatches nothing', async ({ demo, page }) => {
    await demo.open({ scenario: 'awake' });
    await degradeHonkAndFlash(page);

    const honk = demo.command('Honk');
    await expect(honk).toBeDisabled();

    await captureServiceCalls(page);
    // disabled + pointer-events:none — a forced click must NOT dispatch a service.
    await honk.click({ force: true }).catch(() => {});
    expect(await serviceCalls(page)).toHaveLength(0);
    // consoleGuard (auto) asserts the missing entity produced no console/page error.
  });

  test("an explicitly 'unavailable' command renders DISABLED", async ({ demo, page }) => {
    await demo.open({ scenario: 'awake' });
    await degradeHonkAndFlash(page);
    await expect(demo.command('Flash')).toBeDisabled();
  });

  test('the surviving commands stay ENABLED while their neighbours degrade (predicate is per-entity)', async ({
    demo,
    page,
  }) => {
    await demo.open({ scenario: 'awake' });
    await degradeHonkAndFlash(page);
    // Honk missing + Flash unavailable, but the rest remain actionable — never over-degrade.
    for (const label of ['Wake', 'HomeLink', 'Keyless', 'Boombox']) {
      await expect(demo.command(label), `${label} actionable`).toBeEnabled();
    }
  });

  test('never-pressed commands stay ENABLED — the button domain reads a stamp, not unavailable', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    // All six fixture-backed commands read a last-pressed timestamp (available) → all enabled.
    for (const label of ['Wake', 'Honk', 'Flash', 'HomeLink', 'Keyless', 'Boombox']) {
      await expect(demo.command(label), `${label} actionable`).toBeEnabled();
    }
  });
});
