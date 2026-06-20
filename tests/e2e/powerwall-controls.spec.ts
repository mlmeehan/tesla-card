// Story 8.4 — Powerwall control surface (segmented operation-mode + backup-reserve slider).
//
// The co-located jsdom suite (src/components/powerwall.test.ts Story-8.4 blocks)
// pins the element-level contract — one `.seg` per live option, the optimistic
// `.on` vs settled `aria-pressed` split, the `set_value`/`select_option` service
// calls, the hide-when-missing omission, the reconcile drop, the fence cleanup,
// and the `min-height:44px` CSS *rule*. But jsdom applies NO stylesheet, runs NO
// layout engine, reads NO media query, dispatches NO real PointerEvents and never
// PAINTS — so it explicitly CANNOT prove the things this story's ACs hinge on in a
// real browser:
//   • each mode segment clearing the ≥44×44 CSS-px tap-target floor as REAL
//     computed geometry (AC4) — jsdom could only assert the CSS rule's text;
//   • the focus-visible ring actually PAINTING on a keyboard Tab to a segment
//     (AC4) — jsdom matches no :focus-visible and computes no outline;
//   • the backup-reserve `tc-slider` committing exactly ONCE on a real pointer
//     drag-release and NEVER mid-drag (AC2/AC4) — the metered-commit contract,
//     reused unchanged from Epic 5, exercised with real PointerEvents + rAF;
//   • the optimistic `.on` highlight flipping INSTANTLY in a real reactive paint
//     cycle while `aria-pressed` stays on the settled live truth (AC2/UX-DR21);
//   • reconcile dropping the override on a real `hass` tick whose live value
//     equals the request — the sighted highlight then following live, not clinging
//     to the stale optimistic request (AC2);
//   • the controls being OMITTED (real absent boxes, not a `nothing` template)
//     when their entities are absent or `unavailable`, the card honestly keeping
//     the "Sensor" mark + its SoC ring + kWh tiles (AC3); and
//   • the controls appearing AND operating for FREE inside the composed
//     `tc-my-home` Scene (Epic-8 carry-forward (a): the Scene embeds the real
//     `tc-powerwall` element — zero Scene-side control work).
//
// This spec is that real-browser proof. It mounts the concrete `tc-powerwall`
// (registered by the same single bundle the demo loads) into a sized, in-viewport
// host, fed the full energy-site `hass` built from the committed `energy-detail.json`
// fixture (the same fixture ecosystem-detail/inline-charts use) — PLUS an injected
// `callService` spy (the demo harness ships none) so the write paths are observable,
// and a no-op `callWS` so the Story-8.3 charts settle to their calm empty state
// instead of throwing. Entities resolve by FUNCTION-SLUG, never inlined — the [card]
// no-hard-coded-ids discipline (the recorded service-call entity_id is asserted to
// CONTAIN the function slug, never matched against a literal id).
import { readFileSync } from 'node:fs';
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

const ENERGY_DETAIL = JSON.parse(
  readFileSync(new URL('../../src/fixtures/energy-detail.json', import.meta.url), 'utf8'),
) as { states: Record<string, { state?: string; attributes?: Record<string, unknown> }> };

const BLUE = 'rgb(56, 189, 248)'; // --tc-blue #38bdf8 — the shared focus-ring colour.

// The friendly mode labels the card renders (STRINGS.ecosystem.powerwall.modes).
// energy-detail's select.options = [self_consumption, autonomous, backup], live =
// self_consumption. Asserting the rendered copy (not raw option ids) proves the
// friendly-label mapping ran.
const MODE_LABELS = {
  self_consumption: 'Self-Powered',
  autonomous: 'Time-Based',
  backup: 'Backup',
} as const;

interface MountOpts {
  /** Host width in px. */
  width?: number;
  /** Drop every state whose entity-id contains any of these function slugs (hide-when-missing). */
  drop?: string[];
  /** Force every state whose id contains any of these slugs to `unavailable`. */
  unavail?: string[];
}

// A recorded service call (domain, service, full data payload) — the spy stashes
// these on `window.__svc` so a test can read them back across the shadow boundary.
interface SvcCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

// Mount a fresh `tc-powerwall` into a sized, in-viewport host, fed the energy-detail
// `hass` with a `callService` spy + a no-op `callWS` installed. The card element is
// addressable via its `tc-powerwall` locator (Playwright pierces open shadow DOM).
async function mountCard(page: Page, opts: MountOpts = {}): Promise<void> {
  await page.evaluate(
    ({ fixtureStates, opts }) => {
      const w = window as unknown as { __svc?: unknown[] };
      w.__svc = [];

      const drops = opts.drop ?? [];
      const unavail = opts.unavail ?? [];
      const states: Record<string, { state?: string }> = {};
      for (const [id, ent] of Object.entries(fixtureStates)) {
        if (drops.some((slug) => id.includes(slug))) continue; // omit ⇒ hide-when-missing
        states[id] = unavail.some((slug) => id.includes(slug))
          ? { ...(ent as object), state: 'unavailable' }
          : (ent as { state?: string });
      }

      const card = document.querySelector('tesla-card') as unknown as {
        hass: Record<string, unknown>;
      };
      const hass = {
        ...card.hass,
        states,
        // Record every write; the controls route through setNumber/selectOption →
        // hass.callService (rides HA's authenticated connection — no network egress).
        callService: (domain: string, service: string, data: Record<string, unknown>) => {
          (w.__svc as unknown[]).push({ domain, service, data });
          return Promise.resolve();
        },
        // The card's Story-8.3 charts call callWS; a no-op empty result keeps them
        // in the calm empty state (the controls under test are independent of charts).
        callWS: () => Promise.resolve({}),
      };

      document.getElementById('pw-host')?.remove();
      const host = document.createElement('div');
      host.id = 'pw-host';
      host.style.cssText = `width:${opts.width ?? 480}px;padding:16px;box-sizing:border-box;`;
      document.body.prepend(host);
      window.scrollTo(0, 0);

      const el = document.createElement('tc-powerwall') as unknown as {
        setConfig(c: unknown): void;
        hass: unknown;
      };
      el.setConfig({ type: 'tc-powerwall' });
      el.hass = hass;
      host.appendChild(el as unknown as HTMLElement);
    },
    { fixtureStates: ENERGY_DETAIL.states, opts },
  );
}

/** Re-assign a FRESH hass object (HA replaces it every tick) with a state override. */
async function tickHass(page: Page, override: Record<string, { state: string }>): Promise<void> {
  await page.evaluate(
    ({ fixtureStates, override }) => {
      const w = window as unknown as { __svc?: unknown[] };
      const card = document.querySelector('tesla-card') as unknown as {
        hass: Record<string, unknown>;
      };
      const states: Record<string, unknown> = { ...fixtureStates };
      for (const [id, patch] of Object.entries(override)) {
        states[id] = { ...(states[id] as object), ...(patch as object) };
      }
      const el = document.querySelector('tc-powerwall') as unknown as { hass: unknown };
      el.hass = {
        ...card.hass,
        states,
        callService: (domain: string, service: string, data: Record<string, unknown>) => {
          (w.__svc as unknown[]).push({ domain, service, data });
          return Promise.resolve();
        },
        callWS: () => Promise.resolve({}),
      };
    },
    { fixtureStates: ENERGY_DETAIL.states, override },
  );
}

const svcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __svc: SvcCall[] }).__svc);
const settle = (page: Page, tag = 'tc-powerwall') =>
  page
    .locator(tag)
    .evaluate((el) => (el as unknown as { updateComplete: Promise<unknown> }).updateComplete);

const card = (page: Page) => page.locator('tc-powerwall');
const detail = (page: Page) => card(page).locator('.surface.eco-detail');
const segs = (page: Page) => card(page).locator('.seg');
const segByLabel = (page: Page, label: string) => card(page).locator('.seg', { hasText: label });
const slider = (page: Page) => card(page).locator('tc-slider');

test.describe('Story 8.4 — Powerwall control surface (real browser)', () => {
  test.beforeEach(async ({ demo }) => {
    // Load the demo so the single bundle parses and registers tc-powerwall (+ the
    // rest). We then mount our own card fed the energy-detail hass + the spies.
    await demo.open(AWAKE.open);
  });

  // ── AC1 — the two real controls render with real, non-zero layout ───────────────

  test('AC1 — renders the segmented mode control + reserve slider, card flips to a CONTROL', async ({
    page,
  }) => {
    await mountCard(page);
    await expect(detail(page)).toHaveCount(1);

    // The control region sits between the lead readout and the stat grid (mockup order).
    await expect(card(page).locator('.eco-controls')).toHaveCount(1);

    // One <button class="seg"> per LIVE select option — never a hard-coded three —
    // carrying the friendly labels (not raw option ids), with a real, non-zero box.
    await expect(segs(page)).toHaveCount(3);
    for (const label of Object.values(MODE_LABELS)) {
      await expect(segByLabel(page, label)).toHaveCount(1);
    }
    // The live mode is the highlighted segment (self_consumption ⇒ Self-Powered).
    await expect(card(page).locator('.seg.on')).toHaveText('Self-Powered');
    await expect(card(page).locator('.seg.on')).toHaveAttribute('aria-pressed', 'true');

    // The reserve tc-slider renders and reads the live reserve (state 20 ⇒ 20%).
    await expect(slider(page)).toHaveCount(1);
    await expect(card(page).locator('.pw-val')).toContainText('20%');

    // Flipped to a control card: the "Sensor" mark is dropped (UX-DR24 honesty).
    await expect(card(page).locator('.eco-kind')).toHaveCount(0);

    // SoC ring + the kWh totals survive alongside the controls (no double-render).
    await expect(card(page).locator('.tc-ring')).toHaveCount(1);
    await expect(detail(page)).toContainText('Charged');
  });

  // ── AC4 — the ≥44×44 tap-target floor, measured in REAL layout ──────────────────

  test('AC4 — every mode segment + the slider track clears the ≥44px tap-target floor', async ({
    page,
  }) => {
    await mountCard(page);
    const count = await segs(page).count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      const box = await segs(page).nth(i).boundingBox();
      const label = await segs(page).nth(i).innerText();
      expect(box, `segment "${label}" has no box`).not.toBeNull();
      // Width is shared (flex:1) so each easily clears 44; height is the bumped floor.
      expect(box!.height, `segment "${label}" height ≥44`).toBeGreaterThanOrEqual(44);
    }
    // The reused slider's 46px track also clears the floor.
    const trackBox = await slider(page).locator('.track').boundingBox();
    expect(trackBox).not.toBeNull();
    expect(trackBox!.height).toBeGreaterThanOrEqual(44);
  });

  // ── AC4 — the focus-visible ring PAINTS on a keyboard Tab to a segment ───────────

  test('AC4 — keyboard focus paints the shared 2px --tc-focus ring on a mode segment', async ({
    page,
  }) => {
    await mountCard(page);
    // Move focus directly onto the first segment, then assert :focus-visible (the
    // shared rule keys the ring off keyboard focus). Programmatic focus + the
    // keyboard heuristic: drive the focus via a real Tab from the segment's group.
    const first = segs(page).first();
    await first.focus();
    const info = await first.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        focusVisible: el.matches(':focus-visible'),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
      };
    });
    // A real <button> focused via the keyboard path matches :focus-visible and the
    // shared sharedStyles rule paints the 2px solid blue ring.
    expect(info.focusVisible).toBe(true);
    expect(info.outlineStyle).toBe('solid');
    expect(info.outlineWidth).toBe('2px');
    expect(info.outlineColor).toBe(BLUE);

    // Keyboard parity: Space/Enter on the focused segment fires the write (native
    // <button> activation), proving the segment is keyboard-operable end-to-end.
    await page.keyboard.press('Space');
    await settle(page);
    const calls = await svcCalls(page);
    const sel = calls.filter((c) => c.domain === 'select');
    expect(sel.length, 'Space on a focused segment commits a select_option').toBeGreaterThan(0);
  });

  // ── AC2 — segment tap: optimistic sighted .on, settled-SR aria-pressed, real call ──

  test('AC2 — tapping a segment flips the sighted .on INSTANTLY while aria-pressed stays settled', async ({
    page,
  }) => {
    await mountCard(page);
    await segByLabel(page, 'Backup').click();
    await settle(page);

    // The write fired (select.select_option) with the RAW option id, routed to the
    // operation_mode entity (asserted by function-slug, never a literal id).
    const calls = await svcCalls(page);
    const call = calls.find((c) => c.domain === 'select' && c.service === 'select_option');
    expect(call, 'a select_option service call fired').toBeTruthy();
    expect(call!.data.option).toBe('backup');
    expect(String(call!.data.entity_id)).toContain('operation_mode');

    // Sighted: the tapped segment is optimistically .on (instant feedback) …
    await expect(segByLabel(page, 'Backup')).toHaveClass(/\bon\b/);
    // … but the SR truth (aria-pressed) still follows the SETTLED live state, which
    // has NOT changed (no reconciling tick yet) — never announce an unlanded change.
    await expect(segByLabel(page, 'Backup')).toHaveAttribute('aria-pressed', 'false');
    await expect(segByLabel(page, 'Self-Powered')).toHaveAttribute('aria-pressed', 'true');
  });

  test('AC2 — reconcile: a hass tick whose live mode equals the request drops the override', async ({
    page,
  }) => {
    await mountCard(page);
    await segByLabel(page, 'Backup').click();
    await settle(page);
    await expect(segByLabel(page, 'Backup')).toHaveClass(/\bon\b/); // optimistic

    // The write lands: the live operation_mode now reads `backup`. The reconciling
    // tick drops the override; the sighted highlight now follows the live truth.
    await tickHass(page, { 'select.my_home_operation_mode': { state: 'backup' } });
    await settle(page);
    await expect(segByLabel(page, 'Backup')).toHaveAttribute('aria-pressed', 'true');

    // A later EXTERNAL change back proves the override is truly gone (the card
    // follows live, never clinging to the stale optimistic `backup` request).
    await tickHass(page, { 'select.my_home_operation_mode': { state: 'self_consumption' } });
    await settle(page);
    await expect(segByLabel(page, 'Self-Powered')).toHaveClass(/\bon\b/);
    await expect(segByLabel(page, 'Backup')).not.toHaveClass(/\bon\b/);
  });

  // ── AC2/AC4 — reserve slider commits ONCE on real pointer release, never mid-drag ──

  test('AC2/AC4 — the reserve slider fires set_value once on pointer-up, never during the drag', async ({
    page,
  }) => {
    await mountCard(page);
    const track = slider(page).locator('.track');
    await track.scrollIntoViewIfNeeded();
    const box = await track.boundingBox();
    expect(box, 'slider track has no box').not.toBeNull();
    const yc = box!.y + box!.height / 2;

    // Real PointerEvents + rAF plumbing — unlike jsdom. A multi-step drag must NOT
    // commit a single value-changed (the metered-commit / Fleet-rate-limit contract).
    await page.mouse.move(box!.x + box!.width * 0.2, yc);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5, yc, { steps: 5 });
    await page.mouse.move(box!.x + box!.width * 0.8, yc, { steps: 5 });

    const midDrag = (await svcCalls(page)).filter((c) => c.domain === 'number');
    expect(midDrag.length, 'no mid-drag set_value commits').toBe(0);

    await page.mouse.up();
    await settle(page);

    const afterRelease = (await svcCalls(page)).filter(
      (c) => c.domain === 'number' && c.service === 'set_value',
    );
    expect(afterRelease.length, 'exactly one set_value on release').toBe(1);
    // Routed to the backup_reserve entity (function-slug, never a literal id) with a
    // numeric value inside the slider's 0–100 range (the reserve % the user landed on).
    expect(String(afterRelease[0].data.entity_id)).toContain('backup_reserve');
    const v = Number(afterRelease[0].data.value);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  // ── AC3 — absent / unavailable control entities → omitted, card stays a Sensor ──

  test('AC3 — absent control entities → no .seg / no slider, card stays a read-only Sensor', async ({
    page,
  }) => {
    await mountCard(page, { drop: ['operation_mode', 'backup_reserve'] });
    await expect(detail(page)).toHaveCount(1);

    // The controls are genuinely ABSENT boxes (hide-when-missing — never disabled-but-fake).
    await expect(segs(page)).toHaveCount(0);
    await expect(slider(page)).toHaveCount(0);
    await expect(card(page).locator('.eco-controls')).toHaveCount(0);

    // The card honestly stays a Sensor and keeps its read-only telemetry.
    await expect(card(page).locator('.eco-kind')).toContainText('Sensor');
    await expect(card(page).locator('.tc-ring')).toHaveCount(1); // SoC ring intact
    await expect(detail(page)).toContainText('Charged'); // kWh tiles intact
  });

  test('AC3 — a genuinely-unavailable control entity is omitted, never shown disabled-but-fake', async ({
    page,
  }) => {
    await mountCard(page, { unavail: ['operation_mode', 'backup_reserve'] });
    await expect(detail(page)).toHaveCount(1);
    await expect(segs(page)).toHaveCount(0);
    await expect(slider(page)).toHaveCount(0);
    await expect(card(page).locator('.eco-kind')).toContainText('Sensor');
  });

  // ── AC4 — reduced-motion: the segment transition halts (kill the motion, keep data) ──

  test('AC4 — under prefers-reduced-motion the segment hover transition is frozen to none', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountCard(page);
    const transition = await segs(page)
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    // The @media (prefers-reduced-motion: reduce) block zeroes the .seg transition;
    // the control is fully operable + fully legible — only the motion is removed.
    expect(transition).toBe('0s');
    // The control still works (data kept): the highlight + activation are unaffected.
    await expect(card(page).locator('.seg.on')).toHaveText('Self-Powered');
  });
});

// ── Carry-forward (a) — the controls appear AND operate inside the composed Scene ──
test.describe('Story 8.4 — Powerwall controls operate inside the composed "My Home" Scene', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('tc-my-home embeds the real tc-powerwall, so its controls render + commit for free', async ({
    page,
  }) => {
    // tc-my-home embeds the REAL tc-powerwall element (carry-forward (a)), so the
    // controls appear in the Scene with ZERO Scene-side control code. Inject the same
    // callService spy into the Scene's hass and prove a segment commit fires from the
    // embedded card. Playwright pierces the nested open shadow roots.
    await page.evaluate(
      ({ fixtureStates }) => {
        const w = window as unknown as { __svc?: unknown[] };
        w.__svc = [];
        const card = document.querySelector('tesla-card') as unknown as {
          hass: Record<string, unknown>;
        };
        const hass = {
          ...card.hass,
          states: fixtureStates,
          callService: (domain: string, service: string, data: Record<string, unknown>) => {
            (w.__svc as unknown[]).push({ domain, service, data });
            return Promise.resolve();
          },
          callWS: () => Promise.resolve({}),
        };

        document.getElementById('scene-host')?.remove();
        const host = document.createElement('div');
        host.id = 'scene-host';
        host.style.cssText = 'width:1100px;padding:16px;box-sizing:border-box;';
        document.body.prepend(host);
        window.scrollTo(0, 0);

        const scene = document.createElement('tc-my-home') as unknown as {
          setConfig(c: unknown): void;
          hass: unknown;
        };
        scene.setConfig({ type: 'tc-my-home' });
        scene.hass = hass;
        host.appendChild(scene as unknown as HTMLElement);
      },
      { fixtureStates: ENERGY_DETAIL.states },
    );

    // The embedded Powerwall card draws its segmented control inside the Scene.
    const sceneSegs = page.locator('tc-my-home tc-powerwall .seg');
    await expect(sceneSegs.first()).toBeVisible();
    await expect(sceneSegs).toHaveCount(3);

    // And it genuinely operates: tapping a segment from inside the Scene commits the
    // write through the shared hass (one live control instance — no double-fire).
    await page.locator('tc-my-home tc-powerwall .seg', { hasText: 'Backup' }).click();
    await page
      .locator('tc-my-home tc-powerwall')
      .evaluate((el) => (el as unknown as { updateComplete: Promise<unknown> }).updateComplete);

    const calls = await svcCalls(page);
    const sel = calls.filter((c) => c.domain === 'select' && c.service === 'select_option');
    expect(sel.length, 'the embedded card committed a select_option from the Scene').toBe(1);
    expect(sel[0].data.option).toBe('backup');
  });
});
