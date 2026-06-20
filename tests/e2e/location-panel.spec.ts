// Location panel — RUNTIME E2E for Story 5.9 (FR-20, UX-DR17, FR-28 gradient
// exception). The unit gate (src/components/panel-location.test.ts) proves the
// TS/jsdom logic — the coordinate guard, the route-row conditional, and the
// freshness-honest staleness stamps (deterministic by injection). What no test
// exercised is that the panel's contract actually holds on the REAL bundled card,
// in a real browser, when a user opens the Location tab — and three of those
// guarantees are things jsdom physically cannot assert because it never lays out
// or computes adopted-stylesheet styles:
//   AC1 — a GRAYSCALE map: the unit test can only assert `grayscale(1)` appears in
//         the styles TEXT; here we assert the browser actually COMPUTES that filter
//         on the live iframe — plus the coords readout, the Open-map link (real
//         `rel`/`target`/`href`), and the odo/speed/power statTiles render;
//   AC2 — the one sanctioned FR-28 gradient EXCEPTION actually PAINTS (the real
//         `.map` backdrop resolves to a linear-gradient), and the empty-state copy
//         resolves to the dim (4.5:1) token, not a void or the mute token;
//   AC3 — no location ⇒ the "Location unavailable" empty state (marker icon + text),
//         coord "—", the odo/speed/power tiles degrade NaN-safe to "—" (never hidden,
//         never fabricated), Open-map absent, and ZERO console/page errors (the auto
//         consoleGuard is the "never crash" half); a sleeping car renders its
//         last-known coords + odometer calmly (annotated last-known beats a void).
//
// Location is NOT the default open panel (charging is), so every test opens it
// first. Sibling panels.spec.ts proves the tab strip generically; this file is the
// 5.9-specific location surface. Fixture values (awake corpus): location
// 37.7749 / -122.4194 fresh; odometer 12,345; speed/power 0; the route entities
// (distance/eta/traffic) are `unavailable` awake → the route row (and its ETA tile)
// is correctly ABSENT — "no trip ⇒ no trip stats", not a bug.
//
// NB on freshness: the staleness STAMP ("updated Nm ago") is owned by the unit
// gate, which injects a forward server reference so location/odometer classify
// stale deterministically. The demo's `asleep` builder only back-dates
// battery_level, so referenceNow (= MAX stamp across states) still tracks the
// fixture instant and location/odometer read FRESH there — so this runtime spec
// asserts the asleep DEGRADATION (last-known coords kept, volatile tiles → "—",
// no crash), not the stamp, which the demo harness cannot reach.
import { test, expect } from '../support/fixtures';

// ── AC1 — grayscale map + coords + Open-map + odo/speed/power tiles ───────────
test.describe('AC1 — grayscale map, coordinate readout, Open-map, travel-stat tiles', () => {
  test('the Location tab opens and the OSM map iframe renders with the live bbox + marker', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Location');
    await expect(demo.locationPanel).toBeVisible();
    await expect(demo.mapIframe).toBeVisible();
    // The bbox + marker carry the live coords (37.7749 / -122.4194); the title is
    // the SR-legible map label (UX-DR21).
    const src = await demo.mapIframe.getAttribute('src');
    expect(src, 'iframe src carries the marker latitude').toContain('37.7749');
    expect(src, 'iframe src carries the marker longitude').toContain('-122.4194');
    await expect(demo.mapIframe).toHaveAttribute('title', 'Vehicle location');
  });

  test('the map is FULLY grayscale — the browser computes grayscale(1) on the iframe', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Location');
    // The runtime-unique assertion: jsdom never computes adopted-stylesheet filters,
    // so the unit test can only check the styles text. Here the REAL browser has
    // resolved the rule — AC1/UX-DR17 require a grayscale map, not the prototype's
    // 20% desaturation. A computed `grayscale(1)` proves the literal AC gap is shut.
    const filter = await demo.mapIframe.evaluate((el) => getComputedStyle(el).filter);
    expect(filter, 'iframe renders fully grayscale, not the prototype 20%').toContain(
      'grayscale(1)'
    );
    expect(filter).not.toContain('grayscale(0.2)');
  });

  test('the coordinate readout shows the formatted lat, lon', async ({ demo }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Location');
    await expect(demo.mapCoord).toContainText('37.7749');
    await expect(demo.mapCoord).toContainText('-122.4194');
  });

  test('Open-map is a real, keyboard-focusable <a> carrying the coords + rel="noopener noreferrer"', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Location');
    const link = demo.openMapLink;
    await expect(link).toBeVisible();
    await expect(link).toContainText('Open map');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer'); // keep — security (UX-DR21)
    await expect(link).toHaveAttribute('target', '_blank');
    const href = await link.getAttribute('href');
    expect(href, 'Open-map href carries the live coords').toContain('37.7749');
    expect(href).toContain('-122.4194');
    // It is a genuine focus target (keyboard-operable), not a div-with-onclick.
    await link.focus();
    await expect(link).toBeFocused();
  });

  test('the odometer / speed / power statTiles (5.5 primitive) render with live values', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Location');
    await expect(demo.locationStat('Odometer')).toBeVisible();
    await expect(demo.locationStat('Odometer')).toContainText('12,345');
    await expect(demo.locationStat('Speed')).toBeVisible();
    await expect(demo.locationStat('Power')).toBeVisible();
  });

  test('the route row + ETA tile are ABSENT when no trip is active (awake fixture)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Location');
    // distance/eta/traffic are `unavailable` awake → hasRoute is false → the whole
    // route row (and its ETA tile) hides as a GROUP. The persistent odo/speed/power
    // row still renders, so the panel shows exactly the three travel-stat tiles.
    await expect(demo.locationStat('ETA')).toHaveCount(0);
    await expect(demo.locationStat('To arrival')).toHaveCount(0);
    await expect(demo.locationStatTiles).toHaveCount(3);
  });
});

// ── AC2 — the sanctioned FR-28 gradient actually paints; dim empty-state token ─
test.describe('AC2 — the one sanctioned gradient exception paints; empty-state uses the dim token', () => {
  test('the map-card backdrop resolves to the sanctioned linear-gradient (the one exception)', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'awake' });
    await demo.openPanel('Location');
    // Runtime-unique: the unit/styles gates own the "only one exception" guarantee
    // in the source; here we prove the deliberate chromatic backdrop actually
    // renders (a real linear-gradient, not a flat token surface) behind the map.
    const bg = await demo.mapBackdrop.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg, 'the FR-28 map-card backdrop paints a linear-gradient').toContain('linear-gradient');
  });

  test('the empty-state copy computes the dim (4.5:1) token colour, never a void', async ({
    demo,
  }) => {
    // The unresolved install has no location → the empty state renders; assert its
    // copy actually computes a real colour (the dim token, #9aa7b8 → rgb(154,167,184)),
    // the load-bearing 4.5:1 fix — not the mute token, not transparent.
    await demo.open({ scenario: 'unresolved' });
    await demo.openPanel('Location');
    await expect(demo.mapEmpty).toBeVisible();
    const color = await demo.mapEmpty.evaluate((el) => getComputedStyle(el).color);
    expect(color, 'empty-state copy uses the dim 4.5:1 token').toBe('rgb(154, 167, 184)');
  });
});

// ── AC3 — empty state on no coords; honest degradation on a sleeping car ──────
test.describe('AC3 — "Location unavailable" empty state + honest last-known degradation', () => {
  test('no location ⇒ the "Location unavailable" empty state (marker + text), never a frame', async ({
    demo,
  }) => {
    await demo.open({ scenario: 'unresolved' });
    await demo.openPanel('Location');
    await expect(demo.locationPanel).toBeVisible();
    // The empty state: a marker glyph (colour is never the only signal) + real text.
    await expect(demo.mapEmpty).toBeVisible();
    await expect(demo.mapEmpty).toContainText('Location unavailable');
    await expect(demo.mapEmpty.locator('svg')).toBeVisible();
    // No iframe, the coord foot reads "—", and Open-map is GONE (no false action).
    await expect(demo.mapIframe).toHaveCount(0);
    await expect(demo.mapCoord).toContainText('—');
    await expect(demo.openMapLink).toHaveCount(0);
    // The persistent odo/speed/power row still renders (a Location panel keeps its
    // travel-stat row), but each tile degrades NaN-safe to "—" — never hidden, never
    // a fabricated reading. `display()` returns "—" (not undefined), so the 5.5
    // hide-on-undefined contract is deliberately NOT exercised here.
    await expect(demo.locationStatTiles).toHaveCount(3);
    await expect(demo.locationStat('Odometer')).toContainText('—');
    await expect(demo.locationStat('Speed')).toContainText('—');
    await expect(demo.locationStat('Power')).toContainText('—');
    // consoleGuard (auto) asserts the fully-unresolved panel emitted no console/page
    // error while a real browser upgraded and rendered it.
  });

  test('a sleeping car keeps its last-known location calmly — annotated last-known, not a void', async ({
    demo,
  }) => {
    // Honest-freshness, runtime half: a parked/asleep car's location panel is NOT
    // blanked — the last-known marker still paints (annotated last-known beats an
    // empty frame), the last-known coords + odometer are retained, and the panel
    // renders without throwing (consoleGuard). The "updated Nm ago" staleness STAMP
    // itself is unit-covered: the demo's `asleep` builder only back-dates
    // battery_level, so referenceNow (= MAX stamp across states) still tracks the
    // fixture instant and location/odometer read FRESH here — the demo harness can't
    // reach a stale-location runtime state, so the stamp is asserted in the jsdom gate.
    await demo.open({ scenario: 'asleep' });
    await demo.openPanel('Location');
    await expect(demo.locationPanel).toBeVisible();
    await expect(demo.mapIframe).toBeVisible(); // last-known marker, not a void
    await expect(demo.mapCoord).toContainText('37.7749'); // last-known coords retained
    await expect(demo.openMapLink).toBeVisible(); // the action still resolves on last-known
    await expect(demo.locationStat('Odometer')).toContainText('12,345'); // last-known odometer
  });
});
