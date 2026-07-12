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
    // Story 12.1 (AC1 e2e arm) — the Hero emits NO energy-flow overlay, even on an
    // awake card with an energy site present (the scenario that previously drew it).
    // A regression that re-introduces `svg.tc-flow-overlay` fails here in a real browser.
    await expect(demo.heroStage.locator('.tc-flow-overlay')).toHaveCount(0);
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
    // No CAR-RENDER (contract) SVG in image mode — the car IS the flat <img>. (Story
    // 12.1 removed the flow overlay, so the stage carries no SVG at all in image mode.)
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
// car.test.ts render-function unit. Story 3.5's aperture overlays anchor to this
// exact viewBox, so a regression here breaks downstream compositing — these gates
// catch it against the shipped dist.
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
    // No CAR-RENDER (contract) SVG — image mode is a flat <img>. (Story 12.1 removed
    // the flow overlay, so the stage carries no SVG at all in image mode.)
    await expect(demo.heroStage.locator('svg')).toHaveCount(0);
  });
});

// Story 3.3 — status line + tappable battery, locked in a real browser against
// the built bundle (jsdom can't measure layout, so the ≥44×44 hit target is
// proven HERE; the honest "updated Nm ago" hint depends on demo last_updated
// stamps that only the bundle + harness exercise end-to-end).
test.describe('hero — status line + tappable battery (Story 3.3)', () => {
  test('AC4: asleep render keeps its hue (opacity dim, NO grayscale) + "Asleep · updated …" + battery —', async ({
    demo,
  }) => {
    // Story 11.1: a dark preset (red #9e2228) must read as a DIM RED, not near-black.
    // grayscale is re-scoped OFF the render — the stage dims via opacity only.
    await demo.open({ scenario: 'asleep', paint: '#9e2228' });
    // The stage carries the opacity dim marker, never the grayscale recipe.
    await expect(demo.heroStage).toHaveClass(/\basleep\b/);
    await expect(demo.heroStage).not.toHaveClass(/\btc-asleep\b/);
    await expect(demo.heroStage).toHaveCSS('opacity', '0.5');
    // The stage itself is NOT grayscaled (that is what stripped the render's hue before).
    await expect(demo.heroStage).not.toHaveCSS('filter', /grayscale/);
    // The render keeps its resolved paint hue AND carries no grayscale in its computed
    // filter (only its own drop-shadow) — a real-browser proof jsdom cannot measure.
    await expect(demo.heroSvg).toHaveAttribute('style', /--tc-paint:\s*#9e2228/);
    await expect(demo.heroSvg).not.toHaveCSS('filter', /grayscale/);
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

  // Story 15.1 — the tesla_custom BOOLEAN dialect classifies end-to-end in a real
  // browser against the built bundle: registry probe → parent stamp → adapter.
  // The demo env carries the dialect's real shape (binary_sensor.charging +
  // binary_sensor.charger derived per-scenario from the fleet string — see
  // demo/index.html toTeslaCustomShape), so this PAIR pins the derivation, not
  // just the happy path: awake ⇒ boolean 'on' ⇒ green; parked ⇒ 'off' + plug
  // 'off' ⇒ neutral Parked (a hardcoded 'on' in the env would fail the second).
  test('Story 15.1: tesla_custom awake — the boolean derives the GREEN charge visual', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake', env: 'tesla_custom' });
    await expect(demo.heroStatusLabel).toHaveText('Charging');
    await expect(demo.heroPort).toBeVisible();
    await expect(demo.heroStage.locator('.tc-port-core')).toHaveCSS(
      'fill',
      'rgb(52, 211, 153)'
    );
    await expect(demo.heroSvg).toHaveClass(/\bcharging\b/);
  });

  test('Story 15.1: tesla_custom parked — boolean off + plug off reads Parked (no port, no halo)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'parked', env: 'tesla_custom' });
    await expect(demo.heroStatusLabel).toHaveText('Parked');
    await expect(demo.heroPort).toHaveCount(0);
    await expect(demo.heroSvg).not.toHaveClass(/\bcharging\b/);
  });
});

// Story 3.5 — aperture open-state overlays, locked in a real browser against the
// built bundle. jsdom proves the classifier + class hooks + node presence; only
// here can the crossfade opacity + the reduced-motion INSTANT CUT be measured.
test.describe('hero — aperture overlays (Story 3.5)', () => {
  test('AC1: all four overlays are always in the DOM and visible (opacity 1) when open', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'apertures' });
    // Always-present endpoints: four .ap nodes exist regardless of open state.
    await expect(demo.heroApertures).toHaveCount(4);
    for (const name of ['frunk', 'liftgate', 'door', 'window'] as const) {
      await expect(demo.aperture(name)).toHaveCSS('opacity', '1');
    }
  });

  test('AC1 independence: a single open aperture shows ONLY its overlay (others stay opacity 0)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'apertures', apertures: ['frunk'] });
    await expect(demo.aperture('frunk')).toHaveCSS('opacity', '1');
    // The other three are present but faded out — no false "open".
    await expect(demo.aperture('liftgate')).toHaveCSS('opacity', '0');
    await expect(demo.aperture('door')).toHaveCSS('opacity', '0');
    await expect(demo.aperture('window')).toHaveCSS('opacity', '0');
  });

  // AC1 independence, the canonical "any combination" case: three open + one
  // closed at once (frunk+door+window up, liftgate shut). The single-aperture
  // test above proves one toggle; this proves the overlays are TRULY independent
  // (never a combinatorial state set) — a mixed combination renders exactly the
  // open three and leaves liftgate faded out (no false open), measured live in
  // the shipped bundle.
  test('AC1 independence (mixed): three open + one closed — only the open three are visible', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'apertures', apertures: ['frunk', 'door', 'window'] });
    await expect(demo.aperture('frunk')).toHaveCSS('opacity', '1');
    await expect(demo.aperture('door')).toHaveCSS('opacity', '1');
    await expect(demo.aperture('window')).toHaveCSS('opacity', '1');
    // liftgate stays shut — present in the DOM but faded out, never a false open.
    await expect(demo.aperture('liftgate')).toHaveCSS('opacity', '0');
  });

  test('AC3 graceful degrade: an unavailable aperture entity stays hidden (opacity 0), never a false open', async ({
    demo,
  }) => {
    // Open all four, but force the frunk entity unavailable → its overlay must hide.
    await demo.open({ scenario: 'apertures', unavail: 'frunk' });
    await expect(demo.aperture('frunk')).toHaveCSS('opacity', '0');
    // The others remain genuinely open.
    await expect(demo.aperture('liftgate')).toHaveCSS('opacity', '1');
  });

  test('AC2: the opened panel skin is neutral silver #c6c8c9, not the paint tint', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'apertures', apertures: ['frunk'], paint: '#23519e' });
    // The silver skin path inside the frunk overlay fills #c6c8c9 = rgb(198, 200, 201),
    // independent of the car's --tc-paint (#23519e) — recolor of exposed paint is v2.
    const skin = demo.aperture('frunk').locator('path').last();
    await expect(skin).toHaveCSS('fill', 'rgb(198, 200, 201)');
  });

  // AC4 — under prefers-reduced-motion the crossfade becomes an INSTANT CUT: the
  // overlay transition-duration collapses to 0s (the open/closed state is still
  // fully shown — only the fade is removed). Without the AC4 guard the duration
  // would remain 0.3s.
  test('AC4: reduced-motion turns the aperture crossfade into an instant cut (transition none)', async ({
    demo,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await demo.open({ scenario: 'apertures', apertures: ['door'] });
    // The open door is still shown (information preserved)…
    await expect(demo.aperture('door')).toHaveCSS('opacity', '1');
    // …but its transition is cut to 0s (no fade).
    await expect(demo.aperture('door')).toHaveCSS('transition-duration', '0s');
  });

  test('AC4 (control): WITHOUT reduced-motion the overlay carries the 0.3s fade', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'apertures', apertures: ['door'] });
    await expect(demo.aperture('door')).toHaveCSS('transition-duration', '0.3s');
  });

  // DoD a11y floor (EXPERIENCE.md:176) — the open state must not be overlay-only.
  // The shipped bundle composes the open apertures into the car svg's aria-label
  // ("Model Y · open: frunk, door"), so a screen-reader / colour-blind user reads
  // the open state from words, never the silver overlay alone. jsdom pins the
  // string (hero.test.ts); this confirms it survives the build + real-DOM render.
  test('a11y (DoD): open apertures make the car aria-label state-bearing (real bundle)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'apertures', apertures: ['frunk', 'door'] });
    // Label order is fixed (frunk, liftgate, door, window) → "open: frunk, door".
    await expect(demo.heroSvg).toHaveAttribute('aria-label', /·\s*open:\s*frunk,\s*door\b/);
    await expect(demo.heroSvg).not.toHaveAttribute('aria-label', /liftgate|window/);
  });

  // The other half of the a11y contract: when no aperture cue is shown the hero
  // keeps the plain name and never announces "all closed" (the closures panel
  // owns that detail) — so the label only ever ADDS information, never asserts a
  // closed state it would have to keep honest. Asleep is the guaranteed cue-free
  // render: the isAsleep gate forces CLOSED_APERTURES, so this also proves the
  // asleep gate suppresses the aperture state in the SR label, not just the overlay
  // (the "asleep still wins" DoD, measured at the bundle tier).
  test('a11y (DoD): asleep suppresses the aperture label → plain name (no "open:" announced)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'asleep' });
    await expect(demo.heroSvg).toHaveAttribute('aria-label', 'Model Y');
    await expect(demo.heroSvg).not.toHaveAttribute('aria-label', /open:/);
  });
});

// Story 3.6 — the body-mode charge overlay (fulfilling the Story 3.4 deferral) and
// the AC3 non-conforming-body fall-through, locked in a real browser against the
// built bundle. jsdom proves the node presence + class hooks (car.test.ts); only
// here can the resolved GREEN glow be measured, and the fall-through silhouette be
// confirmed end-to-end against the shipped dist.
test.describe('hero — body-mode charge overlay + fall-through (Story 3.6)', () => {
  // AC2 — a CONFORMING body render + charging shows the green charge-port glow OVER
  // the body render (not only the bundled EV). Needs the gitignored demo/local art,
  // so it is GUARDED like the recolor render test above (runs on a dev machine with
  // the art, skips on a fresh checkout / CI).
  test('AC2: body render + charging shows the green port glow over the body', async ({
    demo,
  }) => {
    test.skip(!hasRecolorArt, 'demo/local/ recolor art absent (gitignored / CI checkout)');
    await demo.open({ recolor: true, charge: 'charging' });
    await expect(demo.heroSvg).toBeVisible();
    // It is the body render (the recolor paint mask is present), not the bundled EV.
    await expect(demo.heroStage.locator('mask#tc-paintmask')).toHaveCount(1);
    // The charge-port overlay renders over the body and resolves GREEN (charging).
    await expect(demo.heroPort).toBeVisible();
    await expect(demo.heroStage.locator('.tc-port-core')).toHaveCSS('fill', 'rgb(52, 211, 153)');
    await expect(demo.heroSvg).toHaveClass(/\bcharging\b/);
  });

  // AC3 — a NON-CONFORMING body (mask dropped) falls THROUGH to the bundled EV:
  // never a broken <image>, the .tc-ev silhouette renders. Needs NO art (the body
  // never renders, so its ./local images are never requested, no 404) → runs
  // UNGUARDED, including in CI. The honest log.warn is a console.warn (not an
  // error), so the console guard does not trip on it.
  test('AC3: a non-conforming body falls through to the bundled EV (no broken image)', async ({
    demo,
  }) => {
    await demo.open({ recolor: 'broken' });
    // The bundled EV silhouette is what renders (the body fell through cleanly).
    await expect(demo.heroSvg).toBeVisible();
    await expect(demo.heroSvg).toHaveClass(/\btc-ev\b/);
    // No body recolor stack, and NO <image> element on the stage — so no broken /
    // 404 href can exist (the exact AR-13/FR-2 failure AC3 forbids).
    await expect(demo.heroStage.locator('mask#tc-paintmask')).toHaveCount(0);
    await expect(demo.heroStage.locator('image')).toHaveCount(0);
  });
});
