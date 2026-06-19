// Hero render modes. The first three are asset-free / committed and always run.
// Recolor needs bring-your-own art under demo/local/ (gitignored — Tesla trade
// dress stays out of the repo), so it is GUARDED: it runs on a dev machine that
// dropped the layers in, and skips on a fresh checkout / CI rather than failing.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '../support/fixtures';

const hasRecolorArt = existsSync(resolve(process.cwd(), 'demo/local/paintmask.png'));

test.describe('hero — render modes', () => {
  test('default: bundled generic-EV silhouette (zero-config)', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroSvg).toBeVisible();
  });

  test('paint: generic EV tints with no external assets', async ({ demo }) => {
    await demo.open({ scenario: 'awake', paint: '#23519e' });
    await expect(demo.heroSvg).toBeVisible();
    // Not just "rendered" — the resolved literal must actually drive the host's
    // --tc-paint custom property (the recolor stack reads it). Locked in a real
    // browser against the built bundle, not only the car.test.ts render unit.
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#23519e/);
  });

  test('image: legacy flat car.svg', async ({ demo }) => {
    await demo.open({ scenario: 'awake', image: true });
    await expect(demo.heroImage).toBeVisible();
    await expect(demo.heroImage).toHaveAttribute('src', /car\.svg$/);
  });

  test('recolor: photoreal body stack from demo/local/', async ({ demo }) => {
    test.skip(!hasRecolorArt, 'demo/local/ recolor art absent (gitignored / CI checkout)');
    await demo.open({ scenario: 'awake', recolor: true, paint: '#2a4f93' });
    await expect(demo.heroSvg).toBeVisible();
  });
});

// FR-1 (Story 3.2) — the paint *resolver* locked at the integration level: in a
// real browser, against the built bundle, the three resolution forms and the
// degradation chain must drive --tc-paint on the host the recolor stack reads.
// car.test.ts pins the render-function plumbing; these pin the resolvePaint()
// chain end-to-end (config → hero.ts → resolvePaint → --tc-paint).
test.describe('hero — paint resolution (FR-1: forms + degradation)', () => {
  // AC1b — a GENERIC preset *name* (not a CSS keyword) maps through PAINT_PRESETS
  // to its hex. "charcoal" isn't a CSS named colour, so it resolves via the map.
  test('AC1b: generic preset name resolves to its hex', async ({ demo }) => {
    await demo.open({ scenario: 'awake', paint: 'charcoal' });
    await expect(demo.heroSvg).toBeVisible();
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#1f2226/);
  });

  // AC1 ordering subtlety — a CSS keyword wins over the preset map: "blue" is a
  // CSS named colour, so it passes through verbatim and must NOT become the
  // preset PAINT_PRESETS.blue (#2a4f93). Locks the resolve order in-browser.
  test('AC1: CSS keyword wins over the preset map', async ({ demo }) => {
    await demo.open({ scenario: 'awake', paint: 'blue' });
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*blue\b/);
    await expect(demo.heroSvg).not.toHaveAttribute('style', /#2a4f93/);
  });

  // AC2 — degradation chain's final link: zero-config (no paint at all) lands on
  // the caller's neutral silver DEFAULT_PAINT (#c6c8c9) on the recolorable host.
  test('AC2: no paint degrades to neutral silver #c6c8c9', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroSvg).toBeVisible();
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#c6c8c9/);
  });

  // AC3 — flat image mode IGNORES paint: even with ?paint set, the <img> carries
  // no --tc-paint and no contract SVG is on the stage. (car.test.ts asserts the
  // same on the render unit; this is the shipped-bundle, real-DOM confirmation.)
  test('AC3: image mode ignores paint (no --tc-paint on the <img>)', async ({ demo }) => {
    await demo.open({ scenario: 'awake', image: true, paint: '#23519e' });
    await expect(demo.heroImage).toBeVisible();
    await expect(demo.heroImage).not.toHaveAttribute('style', /--tc-paint/);
    await expect(demo.heroStage.locator('svg')).toHaveCount(0);
  });
});

// AC1c — entity-driven PaintSource: the colour is read LIVE from an entity and
// mapped. The demo routes ?colorentity through the recolor body stack, which
// needs the gitignored demo/local art (else its <image> layers 404 and trip the
// console guard) — so these are GUARDED like the recolor test above: they run on
// a dev machine with the art and skip on a fresh checkout / CI. The host's
// --tc-paint is set from the resolved entity colour regardless of art presence.
test.describe('hero — entity-driven paint (AC1c live read + degradation)', () => {
  test.skip(!hasRecolorArt, 'demo/local/ recolor art absent (gitignored / CI checkout)');

  // AC1c — entity state "charcoal" → read live (via the data/ readRaw reader) →
  // mapped through PAINT_PRESETS to its hex on --tc-paint.
  test('AC1c: entity colour is read live and mapped to its preset hex', async ({ demo }) => {
    await demo.open({ scenario: 'awake', colorentity: 'charcoal' });
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#1f2226/);
  });

  // AC2 (entity branch) — an UNUSABLE entity state (unavailable/unknown/'' …)
  // degrades to the PaintSource's own `default` (the harness sets #9aa3ad),
  // never throwing on the missing exterior-colour attribute.
  test('AC2: unusable entity state degrades to the source default', async ({ demo }) => {
    await demo.open({ scenario: 'awake', colorentity: 'unavailable' });
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#9aa3ad/);
  });
});

// AC3 — the 1024×687 coordinate contract, and AC1 — the .surface/xl stage —
// locked at the integration level (real browser, built bundle), not just in the
// car.test.ts render-function unit. Epic 4's HeroSvgRenderer and Story 3.5's
// aperture overlays anchor to this exact viewBox, so a regression here breaks
// downstream compositing — these gates catch it against the shipped dist.
test.describe('hero — 1024×687 coordinate contract (AC3) + surface stage (AC1)', () => {
  test('zero-config hero SVG carries the 1024×687 contract viewBox', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroSvg).toHaveAttribute('viewBox', '0 0 1024 687');
  });

  test('bundled EV fits its intrinsic 1024×480 art undistorted (nested viewBox + meet)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    // The inner <svg> keeps the hand-tuned 1024×480 art and is centred + aspect-
    // preserved within the 1024×687 contract — never stretched.
    await expect(demo.heroInnerSvg).toHaveAttribute('viewBox', '0 0 1024 480');
    await expect(demo.heroInnerSvg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  test('hero renders on the .surface elevation stage', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.hero).toHaveClass(/\bsurface\b/);
  });

  test('image mode falls through cleanly: a flat <img>, no contract SVG on the stage', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake', image: true });
    await expect(demo.heroImage).toBeVisible();
    await expect(demo.heroStage.locator('svg')).toHaveCount(0);
  });
});

// Story 3.3 — status line + tappable battery, locked in a real browser against
// the built bundle (jsdom can't measure layout, so the ≥44×44 hit target is
// proven HERE; the honest "updated Nm ago" hint depends on demo last_updated
// stamps that only the bundle + harness exercise end-to-end).
test.describe('hero — status line + tappable battery (Story 3.3)', () => {
  test('AC4: asleep → dim+grayscale render (.tc-asleep) + "Asleep · updated …" + battery —', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'asleep' });
    // Shared .tc-asleep recipe backs the render: opacity 0.5 + full grayscale.
    await expect(demo.heroStage).toHaveClass(/\btc-asleep\b/);
    await expect(demo.heroStage).toHaveCSS('opacity', '0.5');
    await expect(demo.heroStage).toHaveCSS('filter', /grayscale\(1\)/);
    // Honest status: drive-state + last-updated hint, never "Offline".
    await expect(demo.heroStatus).toContainText('Asleep');
    await expect(demo.heroStatus).toContainText(/updated \d+m ago/);
    await expect(demo.heroStatus).not.toContainText(/Offline|No connection/i);
    // Battery shows the em-dash, never a fabricated number.
    await expect(demo.heroBatteryPct).toHaveText('—');
  });

  test('AC1: awake status line carries a fresh last-updated hint', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    // Fixture stamps are all at one instant → fresh → "Just now".
    await expect(demo.heroStatus).toContainText('Just now');
  });

  test('AC3: the battery row is a real <button> with a ≥44×44 hit target', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroBattery).toBeVisible();
    const box = await demo.heroBattery.boundingBox();
    expect(box, 'battery button must have a measurable box').not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test('AC3: tapping the battery dispatches open-panel{panel:"charging"} (bubbles + composed)', async ({
    demo,
    page,
  }) => {
    await demo.open({ scenario: 'awake' });
    // The intent bubbles + composed, so it reaches document — capture it there.
    await page.evaluate(() => {
      (window as unknown as { __panel?: string }).__panel = undefined;
      document.addEventListener(
        'open-panel',
        (e) => {
          (window as unknown as { __panel?: string }).__panel = (
            e as CustomEvent<{ panel: string }>
          ).detail.panel;
        },
        { once: true }
      );
    });
    await demo.heroBattery.click();
    const panel = await page.evaluate(
      () => (window as unknown as { __panel?: string }).__panel
    );
    expect(panel).toBe('charging');
  });
});

// Story 3.4 — the three glanceable charge states, locked in a real browser against
// the built bundle. jsdom proves the DOM/class presence; only here can the port
// glow's resolved COLOUR (the --tc-* tokens), the green halo filter and the
// reduced-motion static-glow be measured. Colours: --tc-green #34d399 =
// rgb(52, 211, 153); --tc-blue #38bdf8 = rgb(56, 189, 248).
test.describe('hero — charge visual states (Story 3.4)', () => {
  test('charging (default awake): green port glow + "· N.N kW" + the .charging halo hook', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroStatusLabel).toHaveText('Charging');
    await expect(demo.heroStatus).toContainText('11.5 kW');
    // Port glow present and resolved GREEN (charging).
    await expect(demo.heroPort).toBeVisible();
    await expect(demo.heroStage.locator('.tc-port-core')).toHaveCSS(
      'fill',
      'rgb(52, 211, 153)'
    );
    // The body-halo hook is on (the pulsing green drop-shadow animates over it).
    await expect(demo.heroSvg).toHaveClass(/\bcharging\b/);
  });

  test('plugged-idle: blue port glow + cable + "Plugged-idle", and NO charging halo', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'plugged' });
    await expect(demo.heroStatusLabel).toHaveText('Plugged-idle');
    await expect(demo.heroPort).toBeVisible();
    await expect(demo.heroStage.locator('.tc-port-cable')).toBeVisible();
    // Resolved BLUE (connected, at rest), and the calm state never gets the halo.
    await expect(demo.heroStage.locator('.tc-port-core')).toHaveCSS(
      'fill',
      'rgb(56, 189, 248)'
    );
    await expect(demo.heroSvg).toHaveClass(/\bplugged\b/);
    await expect(demo.heroSvg).not.toHaveClass(/\bcharging\b/);
  });

  test('parked: neither glow nor cable — a neutral car', async ({ demo }) => {
    await demo.open({ scenario: 'parked' });
    await expect(demo.heroStatusLabel).toHaveText('Parked');
    await expect(demo.heroPort).toHaveCount(0);
    await expect(demo.heroSvg).not.toHaveClass(/\bcharging\b/);
    await expect(demo.heroSvg).not.toHaveClass(/\bplugged\b/);
  });

  // AC4 — under prefers-reduced-motion the pulsing halo resolves to a STATIC green
  // glow (the loop does not run; the green is PRESENT, not removed). We assert the
  // resolved filter carries the green drop-shadow on the charging car.
  test('AC4: reduced-motion keeps a static green glow on the charging car (loop off, green present)', async ({
    demo,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await demo.open({ scenario: 'awake' });
    await expect(demo.heroSvg).toHaveClass(/\bcharging\b/);
    // The static filter pins the green drop-shadow (rgb(52, 211, 153)) — without
    // the AC4 fix the base filter would carry no green at all.
    await expect(demo.heroSvg).toHaveCSS('filter', /rgb\(52, 211, 153\)/);
  });

  // AC4 (the other half, Task 4 "confirm it is unaffected") — the plugged-idle blue
  // glow is INHERENTLY static (no keyframe), so reduced-motion must leave it fully
  // present: blue port glow + cable, NO green, and never the charging halo. The
  // reduced-motion fix touches only .tc-car.charging; this proves the calm state is
  // untouched by the media query.
  test('AC4: reduced-motion leaves the plugged-idle blue glow intact (static, no halo, no green)', async ({
    demo,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await demo.open({ scenario: 'plugged' });
    await expect(demo.heroPort).toBeVisible();
    await expect(demo.heroStage.locator('.tc-port-core')).toHaveCSS(
      'fill',
      'rgb(56, 189, 248)'
    );
    await expect(demo.heroSvg).not.toHaveClass(/\bcharging\b/);
    // The green halo must NOT bleed into the calm plugged state under reduced-motion.
    await expect(demo.heroSvg).not.toHaveCSS('filter', /rgb\(52, 211, 153\)/);
  });

  // AC3 (integration, graceful read) — kW is a CHARGING-only readout. A plugged-but-
  // idle car draws nothing, so the status must surface NO rate (never "0.0 kW" or a
  // fabricated figure off the 0-power entity); the blue state's sub is the lock line.
  test('AC3: plugged-idle surfaces no kW rate (the kW readout is charging-only)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'plugged' });
    await expect(demo.heroStatusLabel).toHaveText('Plugged-idle');
    await expect(demo.heroStatus).not.toContainText('kW');
  });
});
