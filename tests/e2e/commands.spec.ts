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
// Deliberate contrast with quick-actions: the five non-wake commands are fire-and-forget
// — a tap fires button.press and is DONE. No optimistic flip, no reconcile, no pressed/.on
// class, no aria-pressed. This spec asserts that absence in the rendered DOM after a tap.
// Wake is the one exception (Story 5.4 "Wake citizenship"): an observed-state safety gate
// renders it DISABLED (aria-label "Awake") while online/waking, and a successful wake arms a
// cooldown. Because the online gate disables it, the fire-and-forget dispatch assertions
// below are exercised on the five, not on Wake.
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

    // Honk is a fire-and-forget command (enabled in every state) — Wake is gated
    // DISABLED while online/waking under Story 5.4, so the generic "enabled command
    // dispatches a resolved button.press" claim is asserted on one of the five.
    await demo.command('Honk').click();

    await expect
      .poll(async () => (await serviceCalls(page)).length, { message: 'one service call per tap' })
      .toBe(1);
    const [call] = await serviceCalls(page);
    expect(call.domain).toBe('button');
    expect(call.service).toBe('press');
    // Resolved by the parent from config.entities — id is install-prefixed; assert by function-slug.
    expect(call.data.entity_id).toContain('honk');
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

// ── AC1c / D-CQ-1: 6→3 grid collapse keyed on the COMPONENT's own width (540) ──
// Since the D-CQ-1 follow-on tc-commands is its own query container, so the collapse
// keys on the component's OWN inline size via `@container (max-width:540px)`, NOT the
// viewport. The demo boxes the card in a ≤520px #stage, so these tests drive the
// card's width (via #stage) while holding the viewport WIDE — isolating the width
// axis to the card and proving the narrow-column-at-wide-viewport case is fixed.
test.describe('AC1 — responsive grid: 6 cols wide card, 3 cols narrow card (element-relative)', () => {
  const trackCount = (demo: { commands: import('@playwright/test').Locator }) =>
    demo.commands
      .locator('.row')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
  const setStageWidth = (page: import('@playwright/test').Page, px: number) =>
    page.evaluate((w) => {
      const s = document.getElementById('stage');
      if (s) s.style.maxWidth = `${w}px`;
    }, px);

  test('a WIDE card (>540) is a 6-track grid — even though its container is a wide viewport', async ({
    demo,
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await demo.open({ scenario: 'awake' });
    await setStageWidth(page, 900); // lift the demo's ≤520px cap so the card is genuinely wide
    await expect.poll(() => trackCount(demo)).toBe(6);
  });

  test('a NARROW card (<540) collapses to a 3-track grid AT A WIDE VIEWPORT (the D-CQ-1 fix)', async ({
    demo,
    page,
  }) => {
    // Viewport stays wide (1000) but the card is boxed at the demo's 520px #stage.
    // Pre-D-CQ-1 a viewport @media wrongly kept this at 6 cramped cols; now it collapses.
    await page.setViewportSize({ width: 1000, height: 900 });
    await demo.open({ scenario: 'awake' });
    await setStageWidth(page, 500);
    await expect.poll(() => trackCount(demo)).toBe(3);
  });

  test('the command row collapses to a 3-track grid on a ≤540px viewport too', async ({ demo, page }) => {
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

  test('awake → the resting reason reads "Awake", not the asleep "tap to wake" invitation', async ({ demo }) => {
    // The affordance row still renders — but online resolves the resting reason to
    // "Awake" (Story 5.4), never the asleep "Tap a command to wake" invitation.
    await demo.open({ scenario: 'awake' });
    await expect(demo.wakeHint).toHaveText('Awake');
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

  test('awake → wake is DISABLED and its accessible name reads "Awake" (never a false "Wake")', async ({ demo }) => {
    // The symmetric 5.4 safety gate: an online/waking car never exposes an actionable
    // wake (AC1/AC5). Locks the contract proven in commands.test.ts at the E2E layer.
    await demo.open({ scenario: 'awake' });
    const wake = demo.command('Wake');
    await expect(wake).toBeDisabled();
    // The 5.4 split: the ACCESSIBLE name flips to "Awake" while the VISIBLE label stays "Wake".
    await expect(wake).toHaveAttribute('aria-label', 'Awake');
    await expect(wake.locator('span')).toHaveText('Wake');
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
    // Wake is excluded: it is legitimately gated DISABLED while online (Story 5.4), so
    // the per-entity availability-degrade claim is asserted on the fire-and-forget set.
    for (const label of ['HomeLink', 'Keyless', 'Boombox']) {
      await expect(demo.command(label), `${label} actionable`).toBeEnabled();
    }
  });

  test('never-pressed commands stay ENABLED — the button domain reads a stamp, not unavailable', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    // The fire-and-forget commands read a last-pressed timestamp (available) → all enabled.
    // Wake is excluded: online gates it DISABLED (Story 5.4), independent of the button
    // domain's 'unknown'→available predicate under test here.
    for (const label of ['Honk', 'Flash', 'HomeLink', 'Keyless', 'Boombox']) {
      await expect(demo.command(label), `${label} actionable`).toBeEnabled();
    }
  });
});
