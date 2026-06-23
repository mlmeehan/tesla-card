// Story 9.9 — guided first-run wizard, REAL-BROWSER E2E.
//
// The wizard's logic is exhaustively pinned in jsdom (src/editor.test.ts, 42 tests).
// This spec covers only what jsdom structurally CANNOT verify, by driving the real
// lazy-loaded editor (tesla-card-editor, mounted exactly as Lovelace mounts it — via
// getConfigElement — by the harness's ?editor=1 mode) in Chromium:
//   • computed ≥44×44 touch/keyboard targets (jsdom asserts the CSS *string*, never layout)
//   • real `prefers-reduced-motion` behaviour (jsdom asserts the rule exists, never that it cuts)
//   • real keyboard focus traversal (jsdom can't Tab through focusable controls)
//   • the full Detect→…→Finish→Done click-through rendering cleanly (console-guard, auto)
//   • Detect honesty (found vs empty) against the card's own resolvers in a live DOM
//
// The console-guard fixture (auto) fails any test where the editor emits an uncaught
// exception or unexpected console error — so every test below is also a "mounts and
// renders cleanly in a real browser" proof, which the jsdom suite cannot give.
import { test, expect, TeslaEditorPage } from '../support/fixtures';

// Deepest active element across nested shadow roots (focus order crosses the editor's
// shadow boundary, so document.activeElement alone is not enough).
async function deepActiveClass(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a ? a.className : '';
  });
}

test.describe('Story 9.9 wizard — trigger + chrome (real browser)', () => {
  test('a bare config opens the 5-node wizard; a configured card opens the normal form', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open(); // bare ⇒ wizard
    await expect(ed.wizard).toBeVisible();
    await expect(ed.normalForm).toHaveCount(0);
    await expect(ed.steps).toHaveCount(5); // DETECT · CONFIRM · APPEARANCE · TUNE · FINISH
    await expect(ed.step(0)).toHaveClass(/current/); // never static — starts AT Detect

    await ed.openAt('done'); // completed ⇒ normal form forever
    await expect(ed.normalForm).toBeVisible();
    await expect(ed.wizard).toHaveCount(0);
  });

  test('every footer control clears the ≥44×44 target floor (computed layout, not CSS source)', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open();
    // Advance to Confirm so Back is enabled (it is disabled — and zero-sized intent
    // aside, still rendered — on Detect); then all four footer controls are live.
    await ed.clickNext();
    await expect(ed.step(1)).toHaveClass(/current/);

    const count = await ed.footerButtons.count();
    expect(count).toBe(4); // Back · Skip · Next · Finish now
    for (let i = 0; i < count; i++) {
      const box = await ed.footerButtons.nth(i).boundingBox();
      expect(box, `footer button ${i} has a layout box`).not.toBeNull();
      expect(box!.height, `footer button ${i} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `footer button ${i} width`).toBeGreaterThanOrEqual(44);
    }
  });

  test('keyboard focus order is Back → Skip → Next → Finish now', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open();
    await ed.clickNext(); // → Confirm, Back now enabled
    await expect(ed.step(1)).toHaveClass(/current/);

    await ed.footerBtn('tertiary').focus(); // start on Back
    expect(await deepActiveClass(page)).toContain('tertiary');
    await page.keyboard.press('Tab');
    expect(await deepActiveClass(page)).toContain('secondary'); // Skip
    await page.keyboard.press('Tab');
    expect(await deepActiveClass(page)).toContain('primary'); // Next
    await page.keyboard.press('Tab');
    expect(await deepActiveClass(page)).toContain('quiet'); // Finish now
  });

  test('state is encoded by shape — a completed step renders a tick glyph, not a number', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open();
    await ed.clickNext(); // Detect → done
    const done = ed.step(0);
    await expect(done).toHaveClass(/done/);
    await expect(done.locator('.step-mark svg')).toHaveCount(1); // tick (shape, not hue-only)
    await expect(done.locator('.step-mark .step-num')).toHaveCount(0); // no number
  });
});

test.describe('Story 9.9 wizard — reduced motion (real media query)', () => {
  test('the step crossfade animates by default and is cut under prefers-reduced-motion', async ({ page }) => {
    const ed = new TeslaEditorPage(page);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await ed.open();
    expect(await ed.body.evaluate((el) => getComputedStyle(el).animationName)).toBe('wiz-fade');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ed.open();
    expect(await ed.body.evaluate((el) => getComputedStyle(el).animationName)).toBe('none'); // instant cut, no info lost
  });
});

test.describe('Story 9.9 wizard — Detect honesty (live resolvers)', () => {
  test('found: the vehicle reads online and an absent product reads "not found" (three-state in text)', async ({
    page,
  }) => {
    const ed = new TeslaEditorPage(page); // default scenario → vehicle resolves, energy absent
    await ed.open();
    await expect(ed.discoRows).toHaveCount(7); // all seven roles shown; absent shown absent (CAP-4)
    await expect(ed.discoRows.filter({ hasText: 'online' }).first()).toBeVisible();
    // At least one role is honestly absent (— not found), never an empty field to fill.
    await expect(ed.editor.locator('.disco-row.absent').first()).toBeVisible();
    // States are announced in TEXT, never hue-only.
    const vehicle = ed.discoRows.filter({ hasText: 'Vehicle' }).first();
    await expect(vehicle).toHaveAttribute('aria-label', /Vehicle, online/);
  });

  test('empty: an honest message + manual fallback; Next gated; never a fake "all set"', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ scenario: 'unresolved' }); // nothing Tesla resolves
    await expect(ed.emptyPanel).toBeVisible();
    await expect(ed.emptyPanel).toHaveAttribute('role', 'status'); // labelled live region
    await expect(ed.footerBtn('primary')).toBeDisabled(); // Next gated — must go manual
    const manual = ed.emptyPanel.getByRole('button', { name: 'Select entities manually' });
    await expect(manual).toBeVisible();
    await manual.click();
    await expect(ed.step(1)).toHaveClass(/current/); // routed into Step-2 mapping
  });
});

test.describe('Story 9.9 wizard — Finish, persistence, re-entry', () => {
  test('click-through Detect→Finish→Done writes a complete config and reverts to the normal form', async ({
    page,
  }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open();
    await ed.clickNext(); // Detect → Confirm
    await ed.clickNext(); // Confirm → Appearance
    await ed.clickNext(); // Appearance → Tune
    await ed.clickNext(); // Tune → Finish
    await expect(ed.step(4)).toHaveClass(/current/);
    await expect(ed.result).toBeVisible();
    await expect(ed.result).not.toContainText('%'); // freshness discipline — no fabricated SoC

    await ed.clickNext(); // Done.
    const cfg = await ed.lastConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.setup_complete).toBe(true); // complete, forward-compatible write to Lovelace
    expect(cfg!.type).toBe('custom:tesla-card');

    // The editor reverts to the normal (non-wizard) form on completion.
    await expect(ed.normalForm).toBeVisible();
    await expect(ed.wizard).toHaveCount(0);
  });

  test('leaving Detect persists setup_complete:false to Lovelace (refresh-resumable marker)', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open();
    await ed.clickNext(); // leave Detect
    const cfg = await ed.lastConfig();
    expect(cfg!.setup_complete).toBe(false); // written to config, not browser-local scratch
  });

  test('an in-progress config resumes the wizard past Detect at Confirm', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.openAt('progress'); // setup_complete:false
    await expect(ed.wizard).toBeVisible();
    await expect(ed.step(1)).toHaveClass(/current/); // resumed at Confirm (step 2)
  });

  test('"Run guided setup" re-enters the wizard from the normal form at Detect', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.openAt('done');
    await expect(ed.runSetup).toBeVisible();
    await ed.runSetup.click();
    await expect(ed.wizard).toBeVisible();
    await expect(ed.step(0)).toHaveClass(/current/); // restarts at Detect
  });
});

test.describe('Story 9.9 wizard — trade-dress chrome', () => {
  test('the only mark is the disclaimer — no Tesla render, no HA copyright', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open();
    await expect(ed.disclaimer).toHaveText('Not affiliated with Tesla, Inc.');
    const chrome = (await ed.wizard.innerText()) ?? '';
    expect(chrome).not.toContain('©');
    expect(chrome).not.toContain('HOME ASSISTANT');
  });
});

// Story 9.10 — normal-form discovery summary, REAL-BROWSER E2E. The summary's logic is
// pinned in jsdom (src/editor.test.ts); this covers only what jsdom structurally cannot:
// the section renders pinned at the top of the live normal form, and its remap chevrons
// clear the computed ≥44×44 target floor. (The detected-but-hidden ADVISORY is a
// card-layer surface gated on `energy.nodes.hide`, which the demo harness exposes no
// param for — it is covered by the my-home jsdom suite's 8 advisory tests.)
test.describe('Story 9.10 discovery summary (real browser)', () => {
  test('the "Detected on your system" summary pins at the top of the normal form', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.openAt('done'); // completed ⇒ normal form
    await expect(ed.discoverySummary).toBeVisible();
    // Pinned at the top: the summary is the first child of the form.
    const firstClass = await ed.normalForm.evaluate((f) => f.firstElementChild?.className ?? '');
    expect(firstClass).toContain('disco-summary');
    // The demo's awake car + energy site resolves several roles → real rows render.
    expect(await ed.summaryRows.count()).toBeGreaterThan(0);
  });

  test('every remap chevron clears the ≥44×44 touch/keyboard target floor', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.openAt('done');
    const n = await ed.remapChevrons.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const box = await ed.remapChevrons.nth(i).boundingBox();
      expect(box, `chevron ${i} has a layout box`).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

// Story 9.11 — per-entity remap accordion, REAL-BROWSER E2E. The picker's read/write
// logic + Reset-to-auto pruning + dead-pick mirror are exhaustively pinned in jsdom
// (src/editor.test.ts). This covers only what jsdom structurally cannot: the accordion
// mounts IN PLACE (the at-a-glance list is NOT replaced) and its expand transition really
// cuts under prefers-reduced-motion.
//
// HARNESS GAP (honest, not silent): the native `<ha-selector>` is registered ONLY inside
// the Home-Assistant frontend, which the demo harness does not load — so the picker body
// renders empty (zero-height) here and cannot be measured or driven. The ≥44×44 picker-row
// target, the Reset-to-auto visibility toggle, and the dead-pick mirror+announce all depend
// on a functioning picker and/or a config entity OVERRIDE the harness exposes no param to
// seed; the jsdom tier covers all three. The chevron's own ≥44×44 floor is proven by the
// Story 9.10 spec above. (Same class of gap the 9.10 advisory noted.) Because the panel is
// zero-height, these assert `toBeAttached` (not `toBeVisible`) + read computed CSS, which
// `getComputedStyle` resolves on attached-but-hidden elements.
test.describe('Story 9.11 per-entity remap accordion (real browser)', () => {
  test('a present row expands IN PLACE — the accordion mounts and the summary list stays put', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.openAt('done');
    const before = await ed.summaryRows.count();
    expect(before).toBeGreaterThan(0);
    await ed.remapChevrons.first().click();
    await expect(ed.remapPanel).toBeAttached(); // the entity-picker-row dropped into the slot
    await expect(ed.remapChevrons.first()).toHaveAttribute('aria-expanded', 'true');
    // Expand-in-place (D-9.11-1): the at-a-glance list is NOT replaced — every row remains.
    expect(await ed.summaryRows.count()).toBe(before);
  });

  test('the accordion panel fades by default and is cut under prefers-reduced-motion', async ({ page }) => {
    const ed = new TeslaEditorPage(page);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await ed.openAt('done');
    await ed.remapChevrons.first().click();
    await expect(ed.remapPanel).toBeAttached();
    expect(await ed.remapPanel.evaluate((el) => getComputedStyle(el).animationName)).toBe('wiz-fade');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ed.openAt('done');
    await ed.remapChevrons.first().click();
    await expect(ed.remapPanel).toBeAttached();
    expect(await ed.remapPanel.evaluate((el) => getComputedStyle(el).animationName)).toBe('none'); // instant cut
  });

  // Re-clicking the chevron collapses the disclosure (AC4 accordion) and RETURNS FOCUS to
  // the chevron (Task 2 focus management). jsdom can't traverse focus across the editor's
  // shadow boundary, so this real-browser proof is the only place the focus-return is pinned
  // — and it needs no `ha-selector` (focus lands on the always-present chevron, not the picker).
  test('re-clicking the chevron collapses in place and returns focus to the chevron', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.openAt('done');
    const chevron = ed.remapChevrons.first();

    await chevron.click(); // expand
    await expect(ed.remapPanel).toBeAttached();
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');

    await chevron.click(); // collapse
    await expect(ed.remapPanel).toHaveCount(0); // panel removed — disclosure closed
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    // Focus is moved back to the chevron the user came from (keyboard/SR continuity).
    expect(await deepActiveClass(page)).toContain('remap-chevron');
  });

  // AC1 / D-9.11-2 map-a-miss: an absent (`— not found`) role in the normal-form summary is
  // ALSO chevron-tappable, but its label is the honest first-mapping verb ("Map … manually",
  // never "Remap"), and tapping it expands the same accordion panel. The default demo scenario
  // resolves the vehicle but leaves the energy roles absent, so ≥1 map-a-miss chevron renders.
  // (The unfiltered picker body itself is the documented harness gap — covered in jsdom.)
  test('an absent summary row exposes a "Map … manually" chevron that expands in place', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.openAt('done');
    const miss = ed.mapManuallyChevrons.first();
    await expect(miss).toBeVisible(); // a real missed detection is fixable in place, not hidden
    // The verb is honest about a FIRST mapping — never "Remap" on a product that was not found.
    const label = await miss.getAttribute('aria-label');
    expect(label).toMatch(/^Map .+ manually$/);
    expect(label).not.toContain('Remap');

    await miss.click();
    await expect(ed.remapPanel).toBeAttached(); // the (unfiltered) map-a-miss picker dropped in
    await expect(miss).toHaveAttribute('aria-expanded', 'true');
  });
});

// Story 9.11 — wizard Step-2 (Confirm & remap) full-list layout (AC1, Task 5), REAL-BROWSER.
// The `_renderConfirm` present-only full list is jsdom-pinned, but the `.confirm-row` wrappers
// render independently of the (harness-absent) `ha-selector` body, so the layout + the
// present-only filter are structurally verifiable in a live DOM.
test.describe('Story 9.11 wizard Confirm full-list (real browser)', () => {
  test('Step-2 shows a present-only entity-picker-row per detected role (no "— not found" row)', async ({
    page,
  }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open(); // bare ⇒ wizard at Detect (default scenario: vehicle present, energy absent)
    const detected = await ed.discoRows.count(); // all seven roles shown at Detect
    expect(detected).toBe(7);

    await ed.clickNext(); // Detect → Confirm
    await expect(ed.step(1)).toHaveClass(/current/);

    const rows = await ed.confirmRows.count();
    expect(rows).toBeGreaterThan(0); // every present role gets a picker row
    expect(rows).toBeLessThan(detected); // present-only — the absent roles are filtered OUT
    await expect(ed.confirmAbsentRows).toHaveCount(0); // Priya never sees a product she lacks
  });
});
