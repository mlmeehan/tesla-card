// Media panel — RUNTIME E2E for Story 5.10 (FR-21, NFR-4 optimistic-then-reconcile,
// UX-DR21 a11y floor). The unit gate (src/components/panel-media.test.ts, 20 tests)
// proves the TS/jsdom logic — the optimistic `_optimistic`/`_arm`/`willUpdate`
// reconcile, the settled-aria discipline, the NaN-safe volume guard, the off-state
// empty collapse — all by deterministic hass injection. What no test exercised is
// that the panel's contract holds on the REAL bundled card, in a real browser, when
// a user opens the Media tab and actually TAPS the controls — and three of those
// guarantees are things jsdom physically cannot assert because it never lays out:
//   AC1 — the now-playing block (glyph-fallback art + title/artist), the transport
//         row, mute and the volume slider all render on the live card;
//   DoD a11y — the LITERAL gap this story closed: the prev/next .tbtn now COMPUTES
//         ≥44×44 in the browser (jsdom can't measure boundingBox), the play button
//         stays 64px and mute 46px, and the volume slider is a real keyboard-operable
//         role=slider named "Volume";
//   AC2 — the optimistic controls work END-TO-END against the demo's interactive
//         callService (which mutates state + re-pushes hass): tapping play flips the
//         transport glyph + settled aria-label and reconciles; tapping mute lights the
//         `.on` red tint AND swaps the glyph (colour-is-never-the-only-signal); the
//         volume slider commits volume_set on key-RELEASE (Fleet rate-limit) and HOLDS
//         the requested level;
//   AC3 — an asleep player (media_player → 'off') and a foreign install both degrade
//         to the calm empty state ("Not playing" / "Media player idle", controls
//         disabled), with ZERO console/page errors (the auto consoleGuard is the
//         "never crash, never false 'playing'" half).
//
// Media is NOT the default open panel (charging is), so every test opens it first.
// Fixture values (awake corpus): media_player 'playing', "Bohemian Rhapsody" / "Queen",
// volume_level 0.4 (→ 40), is_volume_muted false, NO entity_picture (→ glyph art).
// The demo harness callService is interactive (volume_set/volume_mute/media_play_pause
// mutate the mock + re-push hass), so optimism reconciles near-instantly here — this
// spec asserts the user-visible OUTCOME + settled-aria truth, while the pre-reconcile
// optimistic flip itself stays unit-covered (jsdom freezes hass between ticks).
import { test, expect } from '../support/fixtures';

const VOLUME = 'Volume'; // STRINGS.media.volume — the slider SR label

// ── AC1 — the now-playing surface renders on the live card ────────────────────
test.describe('AC1 — now-playing art/metadata + transport + mute + volume render', () => {
  test('the Media tab opens and shows the now-playing title + artist', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    await expect(demo.mediaPanel).toBeVisible();
    await expect(demo.mediaTitle).toHaveText('Bohemian Rhapsody');
    await expect(demo.mediaArtist).toHaveText('Queen');
  });

  test('the cover art falls back to the music-note glyph (the fixture has no entity_picture)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    // No entity_picture in the awake corpus → the `<img>` is absent and the art well
    // renders the inline music-note glyph (colour-is-never-the-only-signal placeholder).
    await expect(demo.mediaArtImg).toHaveCount(0);
    await expect(demo.mediaArt.locator('svg')).toBeVisible();
  });

  test('the transport row renders prev / play-pause / next with state-bearing aria-labels', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    await expect(demo.transportButtons).toHaveCount(3);
    await expect(demo.transportButton('Previous')).toBeVisible();
    await expect(demo.transportButton('Next')).toBeVisible();
    // The player is playing → the central button announces the settled "Pause" action.
    await expect(demo.playButton).toHaveAttribute('aria-label', 'Pause');
  });

  test('the mute toggle + volume slider render; the slider reflects the fixture volume (40)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    await expect(demo.muteButton).toBeVisible();
    await expect(demo.muteButton).toHaveAttribute('aria-pressed', 'false'); // settled unmuted
    const track = demo.volumeSlider.locator('.track');
    await expect(track).toHaveAttribute('aria-label', VOLUME); // SR label passed through
    await expect(track).toHaveAttribute('aria-valuenow', '40'); // volume_level 0.4 → 40
  });
});

// ── DoD a11y — the LITERAL gap: transport tap targets compute ≥44×44 ──────────
test.describe('DoD a11y — tap targets clear the UX-DR21 ≥44×44 floor in a real browser', () => {
  test('the prev/next .tbtn buttons compute ≥44×44 (the story-5.10 fix; jsdom cannot measure this)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    // The runtime-unique assertion: the prototype prev/next was ~40×40 (28px glyph +
    // 6px padding) — below the floor. The fix lifted them to min 44×44; only a real
    // layout proves the rule resolved, which is exactly what jsdom cannot do.
    for (const label of ['Previous', 'Next'] as const) {
      const box = await demo.transportButton(label).boundingBox();
      expect(box, `${label} button has no box`).not.toBeNull();
      expect(box!.width, `${label} clears the 44px tap floor`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${label} clears the 44px tap floor`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the play button stays 64px and the mute toggle 46px (already-compliant siblings)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    const playBox = await demo.playButton.boundingBox();
    expect(playBox!.width, 'play button is the 64px primary target').toBeGreaterThanOrEqual(60);
    expect(playBox!.height).toBeGreaterThanOrEqual(60);
    const muteBox = await demo.muteButton.boundingBox();
    expect(muteBox!.width, 'mute clears the floor at ~46px').toBeGreaterThanOrEqual(44);
    expect(muteBox!.height).toBeGreaterThanOrEqual(44);
  });

  test('the volume slider is a keyboard-focusable, named role=slider control', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    const track = demo.volumeSlider.locator('.track');
    await expect(track).toHaveAttribute('role', 'slider');
    await expect(track).toHaveAttribute('aria-label', VOLUME);
    await expect(track).toHaveAttribute('tabindex', '0');
    await track.evaluate((el) => (el as HTMLElement).focus());
    await expect(track).toBeFocused();
  });
});

// ── AC2 — optimistic controls act on the resolved entity, end-to-end ──────────
test.describe('AC2 — controls act on the resolved media entity (optimistic where applicable)', () => {
  test('play/pause: tapping the play button flips the glyph + settled aria-label and reconciles', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' }); // playing → settled "Pause"
    await demo.openPanel('Media');
    const before = await demo.playButton.locator('path').getAttribute('d');
    await expect(demo.playButton).toHaveAttribute('aria-label', 'Pause');

    await demo.playButton.click(); // media_play_pause → mock pauses → hass re-pushed
    // The interactive demo reconciles: settled is now paused, so both the SIGHTED
    // glyph AND the settled aria-label flip to the "Play" action — the user sees the
    // transport state change land.
    await expect(demo.playButton).toHaveAttribute('aria-label', 'Play');
    const after = await demo.playButton.locator('path').getAttribute('d');
    expect(after, 'the transport glyph swapped (icon, not just colour)').not.toBe(before);

    // It is a real two-way control — tap again returns to the playing/"Pause" read.
    await demo.playButton.click();
    await expect(demo.playButton).toHaveAttribute('aria-label', 'Pause');
  });

  test('mute: tapping lights the .on red tint AND swaps the glyph (colour is never the only signal)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' }); // unmuted
    await demo.openPanel('Media');
    await expect(demo.muteButton).not.toHaveClass(/\bon\b/);
    await expect(demo.muteButton).toHaveAttribute('aria-pressed', 'false');
    const glyphBefore = await demo.muteButton.locator('path').getAttribute('d');
    const colorBefore = await demo.muteButton.evaluate((el) => getComputedStyle(el).color);

    await demo.muteButton.click(); // volume_mute true → mock mutes → hass re-pushed

    // The settled mute landed: the `.on` class + the settled aria-pressed flip, the
    // colour tints red, AND the icon swaps to mute-off — two independent cues, never
    // colour alone (UX-DR21).
    await expect(demo.muteButton).toHaveClass(/\bon\b/);
    await expect(demo.muteButton).toHaveAttribute('aria-pressed', 'true'); // settled truth
    const glyphAfter = await demo.muteButton.locator('path').getAttribute('d');
    const colorAfter = await demo.muteButton.evaluate((el) => getComputedStyle(el).color);
    expect(glyphAfter, 'the mute glyph swapped to volume-off').not.toBe(glyphBefore);
    expect(colorAfter, 'the muted state also tints (paired cue)').not.toBe(colorBefore);

    // Toggle back — a real two-way control.
    await demo.muteButton.click();
    await expect(demo.muteButton).not.toHaveClass(/\bon\b/);
    await expect(demo.muteButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('volume: a keyboard step commits volume_set ONCE on key-release and HOLDS the level', async ({
    demo,
    page,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    const slider = demo.volumeSlider;
    const track = slider.locator('.track');
    await track.scrollIntoViewIfNeeded();

    // Record the host's committed value-changed events (mirrors the charging spec's
    // __vc recorder — a real CustomEvent counter, not a jsdom spy).
    await slider.evaluate((el) => {
      window.__vc = [];
      el.addEventListener('value-changed', (e) =>
        window.__vc.push((e as CustomEvent<{ value: number }>).detail.value)
      );
    });
    await track.evaluate((el) => (el as HTMLElement).focus());
    await expect(track).toHaveAttribute('aria-valuenow', '40'); // fixture volume

    // keydown alone moves the DISPLAYED value but commits nothing — release-only
    // dispatch respects Fleet rate limits (the tc-slider contract).
    await page.keyboard.down('ArrowRight');
    await expect(track).toHaveAttribute('aria-valuenow', '41');
    expect(
      await page.evaluate(() => window.__vc.length),
      'no volume_set on keydown — commit waits for release'
    ).toBe(0);

    // key-release commits exactly once with the settled value → volume_set fires, the
    // mock updates volume_level, hass re-pushes, and the thumb HOLDS at 41 (no snap-back).
    await page.keyboard.up('ArrowRight');
    expect(
      await page.evaluate(() => window.__vc),
      'exactly one commit on key-release with the requested value'
    ).toEqual([41]);
    await expect(track, 'the slider holds the requested level, never snaps back').toHaveAttribute(
      'aria-valuenow',
      '41'
    );
  });

  test('prev/next are operable fire-and-forget controls — tapping them never throws', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Media');
    // Skip-track has no projectable next-state, so prev/next stay fire-and-forget
    // (deliberate, not a gap). They are still real, enabled <button>s — tapping fires
    // the service; the auto consoleGuard asserts neither call crashed the card.
    await expect(demo.transportButton('Previous')).toBeEnabled();
    await expect(demo.transportButton('Next')).toBeEnabled();
    await demo.transportButton('Next').click();
    await demo.transportButton('Previous').click();
    await expect(demo.mediaPanel).toBeVisible();
  });
});

// ── AC3 — calm empty state on a sleeping / unconfigured player ────────────────
test.describe('AC3 — no media ⇒ a calm empty state, never a false "playing" or a crash', () => {
  test('an asleep player (media_player → off) collapses to the empty state, controls disabled', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'asleep' });
    await demo.openPanel('Media');
    await expect(demo.mediaPanel).toBeVisible();
    // Honest freshness is STRUCTURAL here: a sleeping player reports `off`, so the
    // panel shows the calm idle read — never last-known now-playing metadata as live.
    await expect(demo.mediaTitle).toHaveText('Not playing');
    await expect(demo.mediaArtist).toHaveText('Media player idle');
    await expect(demo.mediaArt).toHaveClass(/\bidle\b/);
    // Every control is non-interactive — no false transport on a dark player.
    await expect(demo.playButton).toBeDisabled();
    await expect(demo.transportButton('Previous')).toBeDisabled();
    await expect(demo.transportButton('Next')).toBeDisabled();
    await expect(demo.muteButton).toBeDisabled();
    await expect(demo.volumeSlider.locator('.track')).not.toHaveAttribute('tabindex', '0');
    // consoleGuard (auto) asserts the fully-idle panel rendered without throwing.
  });

  test('a foreign install (no media entity) renders the empty state with zero errors', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'unresolved' });
    await demo.openPanel('Media');
    await expect(demo.mediaPanel).toBeVisible();
    await expect(demo.mediaTitle).toHaveText('Not playing');
    await expect(demo.playButton).toBeDisabled();
    // The auto consoleGuard is the "never crash on a 0-data hass" half.
  });
});
