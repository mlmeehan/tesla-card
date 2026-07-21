// Charging panel — RUNTIME E2E for Story 5.5 (FR-16, UX-DR8/9). The unit gates
// (src/components/panel-charging.test.ts, src/interaction.test.ts keyboard suite,
// src/ui.test.ts) prove the TS/jsdom logic; what no test exercised is that the
// story's deltas actually take effect in a REAL browser, on the real bundled card:
//   AC1 — a missing entity HIDES its stat tile (asleep → no "—" wall, zero tiles);
//   AC2 — the tc-slider is keyboard-operable with the SAME commit-on-release
//         contract as drag (arrow moves the displayed value live; value-changed
//         commits only on key-RELEASE, never per keydown — Fleet rate-limit), is a
//         NAMED control, and shows the ~18px thumb (not the legacy 5px sliver);
//   AC3 — the range/% toggle flips the headline live; the "Target N%" line renders;
//   AC4 — the live charging cue derives from the canonical charge state.
//
// Sibling a11y-interaction.spec.ts already proves the POINTER-drag release contract
// (Story 2.3); this file is the keyboard half + the 5.5-specific charging surfaces.
// Default demo scenario is awake/charging, so the charging panel is the open panel.
import { test, expect } from '../support/fixtures';

// The window-scoped commit recorder the in-page listeners push to (mirrors the
// pointer-drag spec's __vc pattern — a real CustomEvent counter, not a jsdom spy).
declare global {
  interface Window {
    __vc: number[];
  }
}

// ── AC1 — statTile hides when its entity is missing (no "—" wall) ────────────
test.describe('AC1 — stat tiles hide when their entity is missing', () => {
  test('awake renders all six live stat tiles', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.chargeStatTiles).toHaveCount(6);
  });

  test('asleep (every charge stat unavailable) hides ALL tiles — not a dash-wall', async ({
    demo,
  }) => {
    // The asleep mock marks charger_power/rate/added/time-to-full/voltage/port all
    // `unavailable`; AC1 hides each rather than rendering six "—" tiles. The auto
    // consoleGuard also asserts the fully-degraded panel renders without throwing.
    await demo.open({ scenario: 'asleep' });
    await expect(demo.chargingPanel).toBeVisible();
    await expect(demo.chargeStatTiles).toHaveCount(0);
    // The battery headline collapses to an em-dash, never a false reading.
    await expect(demo.chargeHeadline).toHaveText('—');
  });
});

// ── AC2 — keyboard slider: commit-on-release, named, ~18px thumb ──────────────
test.describe('AC2 — tc-slider keyboard operability (commit-on-release)', () => {
  test('the charge sliders are named controls with role=slider, focusable', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.chargeSliders).toHaveCount(2);
    const limitTrack = demo.chargeSlider('Charge limit').locator('.track');
    await expect(limitTrack).toHaveAttribute('role', 'slider');
    await expect(limitTrack).toHaveAttribute('aria-label', 'Charge limit');
    await expect(limitTrack).toHaveAttribute('tabindex', '0');
    await expect(demo.chargeSlider('Charge current').locator('.track')).toHaveAttribute(
      'aria-label',
      'Charge current'
    );
  });

  test('Arrow moves the displayed value on keydown but commits ONLY on key-release', async ({
    demo,
    page,
  }) => {
    await demo.open({ scenario: 'awake' });
    const slider = demo.chargeSlider('Charge limit');
    const track = slider.locator('.track');
    await track.scrollIntoViewIfNeeded();

    // value-changed is dispatched from the slider HOST (bubbles up) — listen there;
    // focus the inner .track (the role=slider, tabindex=0 target) for real keys.
    await slider.evaluate((el) => {
      window.__vc = [];
      el.addEventListener('value-changed', (e) =>
        window.__vc.push((e as CustomEvent<{ value: number }>).detail.value)
      );
    });
    await track.evaluate((el) => (el as HTMLElement).focus());
    await expect(track).toHaveAttribute('aria-valuenow', '80'); // charge_limit fixture value

    // keydown alone (no keyup): the DISPLAYED value steps but nothing commits.
    await page.keyboard.down('ArrowRight');
    await expect(track, 'aria-valuenow moves live on keydown').toHaveAttribute(
      'aria-valuenow',
      '81'
    );
    expect(
      await page.evaluate(() => window.__vc.length),
      'no value-changed on keydown — commit waits for release'
    ).toBe(0);

    // key-release commits exactly once, with the settled value.
    await page.keyboard.up('ArrowRight');
    expect(
      await page.evaluate(() => window.__vc),
      'exactly one commit on key-release with the settled value'
    ).toEqual([81]);
  });

  test('Home jumps to min and End to max, each committed once on release', async ({
    demo,
    page,
  }) => {
    await demo.open({ scenario: 'awake' });
    const slider = demo.chargeSlider('Charge limit');
    const track = slider.locator('.track');
    await track.scrollIntoViewIfNeeded();
    await slider.evaluate((el) => {
      window.__vc = [];
      el.addEventListener('value-changed', (e) =>
        window.__vc.push((e as CustomEvent<{ value: number }>).detail.value)
      );
    });
    await track.evaluate((el) => (el as HTMLElement).focus());

    // press() = a full keydown+keyup, so each bound commits once on its release.
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    expect(
      await page.evaluate(() => window.__vc),
      'Home → min (50), End → max (100); one commit each'
    ).toEqual([50, 100]);
  });

  test('the thumb is an ~18px circle (not the legacy 5px sliver), hit-area = the 46px bar', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    const handle = demo.chargeSlider('Charge limit').locator('.handle');
    const dims = await handle.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { w: parseFloat(cs.width), h: parseFloat(cs.height) };
    });
    expect(dims.w, 'thumb width ~18px (legible at kiosk distance, D9)').toBeGreaterThanOrEqual(16);
    expect(dims.w).toBeLessThanOrEqual(20);
    expect(dims.h, 'thumb is circular (w === h)').toBe(dims.w);

    // The hit-area stays the full 46px bar (≥44px tap floor, UX-DR21).
    const box = await demo.chargeSlider('Charge limit').locator('.track').boundingBox();
    expect(box, 'slider track has no box').not.toBeNull();
    expect(box!.height, 'track is the ≥44px hit-area').toBeGreaterThanOrEqual(44);
  });
});

// ── AC3 — range-vs-% display toggle + charge-target line ──────────────────────
test.describe('AC3 — range/% toggle + charge-target line', () => {
  test('the range/% toggle flips the headline between percent and range, live', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.chargeHeadline).toHaveText('72'); // battery_level %, the default
    const [pct, range] = [demo.displayOptions.nth(0), demo.displayOptions.nth(1)];
    await expect(pct).toHaveAttribute('aria-pressed', 'true');
    await expect(range).toHaveAttribute('aria-pressed', 'false');

    await range.click();
    await expect(demo.chargeHeadline).toHaveText('235'); // battery_range
    await expect(range).toHaveAttribute('aria-pressed', 'true');
    await expect(pct).toHaveAttribute('aria-pressed', 'false');

    // toggle back — proves it is a real two-way control, not a one-shot.
    await pct.click();
    await expect(demo.chargeHeadline).toHaveText('72');
  });

  test('the charge-target line renders an honest "Target N%"', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    const note = demo.chargeTargetLine;
    await expect(note).toBeVisible();
    await expect(note).toContainText('Target');
    await expect(note).toContainText('80%'); // charge_limit fixture value
  });
});

// ── AC4 — canonical live charging cue ────────────────────────────────────────
// The two fleet-env rows here are ALSO the e2e half of Story 16.1 AC2's fleet
// byte-identity: the default env's words ("Charging"/"Idle") come through the
// prettyText/idle paths untouched by the 16.1 canonical-word substitution —
// they stay green with zero edits.
test.describe('AC4 — live charging cue derives from canonical charge state', () => {
  test('an actively-charging car lights the live cue', async ({ demo }) => {
    await demo.open({ scenario: 'awake' }); // charging_status = "Charging"
    const cue = demo.chargeStatusCue;
    await expect(cue).toHaveClass(/live/);
    await expect(cue).toContainText('Charging');
  });

  test('an asleep car reads "Asleep" — never a false connected state, cue dark (Story 17.1)', async ({
    demo,
  }) => {
    // Story 17.1 UPDATED this row (its pre-change form asserted "Idle" and was
    // the red-first e2e evidence): the panel now consults the SAME isAsleep
    // predicate as the Hero, and the asleep word outranks even the
    // `unavailable`→"Idle" short-circuit (the whole-card asleep posture,
    // EXPERIENCE.md "Hero / whole card" — one rule, no split brain).
    await demo.open({ scenario: 'asleep' }); // status 'off', charging_status unavailable
    const cue = demo.chargeStatusCue;
    await expect(cue).not.toHaveClass(/live/);
    await expect(cue).toHaveText('Asleep'); // normalized-exact: excludes every other word
    // Belt-and-braces vs the words this row must never regress to.
    await expect(cue).not.toContainText('Idle');
    await expect(cue).not.toContainText('Parked');
    await expect(cue).not.toContainText('Plugged-idle');
  });
});

// ── Story 16.1 (AC3) — tesla_custom renders the canonical WORD, never "On"/"Off" ──
// Sibling of the AC4 describe above, REUSING its `chargeStatusCue` locator (no
// second `.cstatus` getter). The demo env carries the dialect's REAL
// boolean/cable/online shape derived per-scenario from the fleet entities
// (demo/index.html `toTeslaCustomShape`): the default/awake scenario IS the
// charging scenario (boolean 'on'; the charging panel is the open default
// panel), and scenario=parked derives boolean 'off' + plug 'off'.
// SHAPE-asserting per the demo-env Testing rule: the cue's literal WORD is
// pinned — a clean render of the wrong words would not pass.
test.describe('Story 16.1 — tesla_custom charge words in the panel cue (shape assertions)', () => {
  test("charging (default awake scenario) — the cue reads 'Charging', never the raw boolean", async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake', env: 'tesla_custom' });
    const cue = demo.chargeStatusCue;
    await expect(cue).toHaveClass(/live/);
    await expect(cue).toContainText('Charging');
    // Belt-and-braces vs the exact pre-16.1 defect (the span read "On"/"Off").
    await expect(cue).not.toHaveText(/^(On|Off)$/);
  });

  test("parked — boolean off + plug off reads 'Parked', never 'Off'", async ({ demo }) => {
    await demo.open({ scenario: 'parked', env: 'tesla_custom' });
    const cue = demo.chargeStatusCue;
    await expect(cue).not.toHaveClass(/live/);
    await expect(cue).toContainText('Parked');
    await expect(cue).not.toHaveText(/^(On|Off)$/);
  });
});

// ── Story 17.1 (AC1/AC2/AC6) — env=tesla_custom renders the COMPLETE card ─────
// The demo's toTeslaCustomShape now renames EVERY divergent alias key (not just
// the charging triple) and deletes the ABSENT-key fleet twins, so battery /
// charge controls / lock resolve for real under the flagship env.
// SHAPE-asserting per the demo-env Testing rule — each awake/parked row was RED
// against the pre-17.1 demo (the exact ledger symptom: "—" headline, disabled
// Start-charging pill, disabled amps slider, dead lock signal). The asleep row
// proves the Story-17.1 panel gate END-TO-END through the dialect path (the
// derived binary_sensor.…_online 'off' drives isAsleep via the resolved
// `status` alias).
test.describe('Story 17.1 — tesla_custom renders the complete card (shape assertions)', () => {
  test('awake: numeric battery headline — never the "—" dash-out', async ({ demo }) => {
    await demo.open({ scenario: 'awake', env: 'tesla_custom' });
    await expect(demo.chargeHeadline).toHaveText('72'); // sensor.…_battery resolves
  });

  test('awake: the Start/Stop pill and the amps slider are ENABLED (charge controls resolve)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake', env: 'tesla_custom' });
    await expect(demo.chargeStartPill).toBeEnabled(); // switch.…_charger resolves
    // number.…_charging_amps resolves → the slider is live (focusable track, a
    // real numeric value, no .disabled recipe).
    const ampsTrack = demo.chargeSlider('Charge current').locator('.track');
    await expect(ampsTrack).toHaveAttribute('tabindex', '0');
    await expect(ampsTrack).toHaveAttribute('aria-valuenow', /^\d+$/);
    await expect(ampsTrack).not.toHaveClass(/disabled/);
  });

  test('awake: the Time-to-full tile is PRESENT and honestly "—" — the timestamp is never mirrored-as-hours', async ({
    demo,
  }) => {
    // Review 17.1: sensor.…_time_charge_complete carries an ISO TIMESTAMP under
    // this dialect (AC2) — the panel's hours parse NaNs to the honest dash. Any
    // digit in this tile means the demo mirrored the fleet HOURS value — the
    // exact plausible-but-false "1h 30m" AC2 exists to prevent. This row is the
    // ttf special-case's drift alarm (title-claim ⇒ body-assertion).
    await demo.open({ scenario: 'awake', env: 'tesla_custom' });
    const tile = demo.chargeStatTiles.filter({ hasText: 'Time to full' });
    await expect(tile).toHaveCount(1); // resolves → present, never hidden
    await expect(tile).toContainText('—');
    await expect(tile).not.toContainText(/\d/); // never a mirrored "Nh Nm"
  });

  test('parked: the lock signal is PRESENT — hero reads "Locked", the Lock quick-action reads locked (lock.…_doors)', async ({
    demo,
  }) => {
    // Pre-17.1 the lock alias guess dead-ended → the hero status carried no
    // lock word and the Lock quick-action sat disabled, aria-pressed 'false'.
    await demo.open({ scenario: 'parked', env: 'tesla_custom' });
    await expect(demo.heroStatus).toContainText('Locked'); // the hero lock word, via lock.…_doors
    const lockPill = demo.card.getByRole('button', { name: 'Lock' });
    await expect(lockPill).toBeEnabled();
    await expect(lockPill).toHaveAttribute('aria-pressed', 'true');
  });

  test('asleep × tesla_custom: the cue reads "Asleep" through the dialect path, cue dark', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'asleep', env: 'tesla_custom' });
    const cue = demo.chargeStatusCue;
    await expect(cue).not.toHaveClass(/live/);
    await expect(cue).toHaveText('Asleep');
  });
});
