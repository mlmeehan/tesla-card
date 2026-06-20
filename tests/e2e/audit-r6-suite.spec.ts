// R6 SUITE-COMPLETE audit checkpoint — CROSS-COMPONENT runtime E2E (Story 6.8).
//
// 5.11 audited the vehicle card; this is the suite layer one level up: the composed
// "My Home" Scene (the six ecosystem cards + the Gateway bus + the weather vignette)
// exercised as a whole in a REAL browser — the parts jsdom cannot reach (a genuine
// `prefers-reduced-motion` flip on the composed animation set, real `:focus-visible`
// traversal into the Scene, a clean cross-dialect runtime render). The co-located
// jsdom suite (src/audit-r6-suite.test.ts) pins resolution/wiring/values; this pins
// the rendered-pixel + real-interaction contract under the auto console-error guard.
//
//   • AC1 — a COMPOSED reduced-motion sweep over EVERY Scene animation source: the
//     Gateway bus dash (`.sb-flow`) and the weather vignette (`.wx-*`) both HALT
//     (animation:none) while their data cues survive (arrowheads + kW ribbon, the
//     condition art) — "kill the motion, keep the data". Plus keyboard focus lands
//     IN the Scene with the 2px blue ring and no trap (the cross-card/into-Scene seam
//     the per-card specs don't reach).
//   • AC4 — the composed Scene driven against a NON-DEFAULT install prefix renders
//     cleanly (the console guard fails on any uncaught error) — the runtime echo of
//     the jsdom function-name-resolution proof.
import { readFileSync } from 'node:fs';
import { test, expect, AWAKE } from '../support/fixtures';
import type { Page } from '@playwright/test';

// Story 8.8 — the energy-detail fixture carries the FULL deepened surface: the five
// energy roles + the Powerwall operation-mode select + backup-reserve number (so the
// embedded Powerwall renders its 8.4 controls) + the cumulative counters the 8.3
// charts bucket. Driving the composed Scene against it exercises the WHOLE Epic-8
// richness at once (the depth the 6.8 MVP-suite sweep did not reach).
const ENERGY_DETAIL = JSON.parse(
  readFileSync(new URL('../../src/fixtures/energy-detail.json', import.meta.url), 'utf8'),
) as { states: Record<string, unknown> };

// Mount a fresh `tc-my-home` into a sized, in-viewport host, fed the SAME `hass` the
// demo already built — optionally re-prefixed (AC4) and always with a weather/sun
// state injected so the Solar card renders its vignette (the awake fixture carries
// no weather, and the vignette is the AC1 sweep's second animation source).
async function mountScene(page: Page, opts: { reslug?: boolean } = {}): Promise<void> {
  await page.evaluate((o: { reslug?: boolean }) => {
    document.getElementById('scene-host')?.remove();
    const card = document.querySelector('tesla-card') as unknown as { hass: Record<string, unknown> };
    const base = card.hass;

    // Inject HA-core weather + sun so tc-solar renders the live-condition vignette.
    const baseStates = base.states as Record<string, { entity_id?: string }>;
    let states: Record<string, unknown> = {
      ...baseStates,
      'weather.home': { entity_id: 'weather.home', state: 'cloudy', attributes: {}, last_updated: '2026-06-15T14:41:00Z', last_changed: '2026-06-15T14:41:00Z' },
      'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {}, last_updated: '2026-06-15T14:41:00Z', last_changed: '2026-06-15T14:41:00Z' },
    };

    // AC4 — re-prefix every energy id to a synthetic NON-DEFAULT install while
    // preserving the function-slug each data/energy rule keys on. If resolution were
    // prefix-coupled the Scene would render empty; it must still compose five cards.
    if (o.reslug) {
      const remap = (id: string) =>
        id.replace(/my_home_/g, 'acme_ess_').replace(/tesla_wall_connector_/g, 'acme_evse_wall_connector_');
      states = Object.fromEntries(
        Object.entries(states).map(([id, ent]) => {
          const nid = remap(id);
          return [nid, { ...(ent as object), entity_id: nid }];
        }),
      );
    }
    const hass = { ...base, states };

    const host = document.createElement('div');
    host.id = 'scene-host';
    host.style.cssText = 'width:1100px;padding:16px;box-sizing:border-box;';
    document.body.prepend(host); // FIRST child → the Scene leads the tab order
    window.scrollTo(0, 0);

    const scene = document.createElement('tc-my-home') as unknown as {
      setConfig(c: unknown): void;
      hass: unknown;
    };
    scene.setConfig({ type: 'tc-my-home' });
    scene.hass = hass;
    host.appendChild(scene as unknown as HTMLElement);
  }, opts);
}

const scene = (page: Page) => page.locator('tc-my-home');
const flowDash = (page: Page) => scene(page).locator('.sb-flow').first();
const animName = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => getComputedStyle(el).animationName);

test.describe('R6 suite — composed reduced-motion sweep (AC1)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open); // parse the bundle + build the mock hass on the live card
  });

  test('AC1 control — the Gateway bus dash + weather vignette ANIMATE by default', async ({ page }) => {
    await mountScene(page);
    await expect(flowDash(page)).toHaveCount(1);
    expect(await animName(flowDash(page)), 'bus dash animates by default').toBe('sb-flow-dash');

    // The vignette's cloud drift animates (the awake-injected cloudy sky).
    const cloud = scene(page).locator('.wx-cloud').first();
    await expect(cloud).toBeAttached();
    expect(await animName(cloud), 'vignette cloud drifts by default').not.toBe('none');
  });

  test('AC1 — reduced-motion HALTS every Scene animation while the data cues survive', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountScene(page);

    // 1) The Gateway bus dash freezes (animation:none) — but the arrowheads remain.
    await expect(flowDash(page)).toHaveCount(1);
    expect(await animName(flowDash(page)), 'bus dash must halt under reduced-motion').toBe('none');
    await expect(scene(page).locator('.gw-head').first(), 'arrowheads survive (the colour-blind-safe cue)').toBeAttached();

    // 2) The summary ribbon stays a legible static read — node names + kW magnitude.
    const ribbon = (await scene(page).locator('.ribbon').textContent()) ?? '';
    expect(ribbon, 'the running-net ribbon stays legible with motion off').toMatch(/kW/);

    // 3) The weather vignette freezes ALL wx-* motion — the condition art stays legible.
    const cloud = scene(page).locator('.wx-cloud').first();
    await expect(cloud).toBeAttached();
    expect(await animName(cloud), 'vignette must freeze under reduced-motion').toBe('none');
    await expect(scene(page).locator('.wx-art').first(), 'the condition art (the sky) stays drawn').toBeAttached();
  });

  test('AC1 — reduced-motion freezes the THIRD source (the focus-highlight transition) while the dim/light cue survives', async ({ page }) => {
    // The Task-1 inventory names THREE Scene animation sources: the bus dash, the
    // weather vignette (both swept above), AND the focus-highlight opacity transition
    // (`my-home.ts:732`). Closing the last enumerated source: focusing a card must
    // still de-emphasize the rest (the data cue), but the transition is an INSTANT
    // cut under reduced-motion — "kill the motion, keep the data".
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountScene(page);

    // Engage the focus-highlight (focusin → .scene gains .focus, the focused card lights).
    await scene(page).locator('.scene-cell').first().focus();
    await expect(scene(page).locator('.scene.focus'), 'focusing a card engages the highlight').toHaveCount(1);

    const cells = await scene(page)
      .locator('.scene-cell')
      .evaluateAll((els) =>
        els.map((el) => {
          const cs = getComputedStyle(el);
          return { lit: el.classList.contains('lit'), dur: cs.transitionDuration, opacity: Number(cs.opacity) };
        }),
      );
    // Motion killed: every cell's focus-highlight transition is an instant cut.
    expect(cells.every((c) => c.dur === '0s'), 'focus-highlight transition must be killed under reduced-motion').toBe(true);
    // Data survives: the focused card stays lit (opacity 1) — the dim/light highlight still reads.
    expect(cells.some((c) => c.lit && c.opacity === 1), 'the focused card stays fully lit (the cue survives)').toBe(true);
  });
});

test.describe('R6 suite — keyboard focus lands IN the Scene with the ring, no trap (AC1)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC1 — Tab reaches a Scene card; it paints the 2px blue ring and the Scene highlights', async ({ page }) => {
    await mountScene(page); // host is the document's FIRST child → cards lead tab order
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Walk real Tab presses until the deep active element is a Scene card cell.
    const onCell = async () =>
      page.evaluate(() => {
        let el: Element | null = document.activeElement;
        while (el && (el as HTMLElement).shadowRoot?.activeElement) {
          el = (el as HTMLElement).shadowRoot!.activeElement;
        }
        if (!el || !el.classList.contains('scene-cell')) return null;
        const cs = getComputedStyle(el);
        return {
          node: (el as HTMLElement).dataset.node,
          focusVisible: el.matches(':focus-visible'),
          outlineWidth: cs.outlineWidth,
          outlineStyle: cs.outlineStyle,
          outlineColor: cs.outlineColor,
        };
      });

    let info: Awaited<ReturnType<typeof onCell>> = null;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      info = await onCell();
      if (info) break;
    }
    expect(info, 'keyboard Tab should land on a Scene card cell').not.toBeNull();
    // The 2px --tc-blue focus ring (the a11y floor) paints on keyboard focus.
    expect(info!.focusVisible).toBe(true);
    expect(info!.outlineStyle).toBe('solid');
    expect(info!.outlineWidth).toBe('2px');
    expect(info!.outlineColor).toBe('rgb(56, 189, 248)'); // --tc-blue #38bdf8
    // Focusing a card highlights the Scene (focusin path) — no navigation, no trap.
    await expect(scene(page).locator('.scene.focus')).toHaveCount(1);

    // No focus TRAP: tabbing past all five cells must let focus LEAVE the Scene —
    // a trap would re-capture focus onto a scene-cell forever (the story's explicit
    // "the Scene introduces no focus trap"). Five Tabs ⇒ guaranteed past every cell.
    let escaped = false;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if ((await onCell()) === null) {
        escaped = true;
        break;
      }
    }
    expect(escaped, 'focus must be able to leave the Scene — no focus trap').toBe(true);
  });
});

test.describe('R6 suite — the composed Scene under a non-default install prefix (AC4)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC4 — re-prefixed energy ids still compose five cards + a named bus, zero console errors', async ({ page }) => {
    await mountScene(page, { reslug: true });
    // The five ENERGY ecosystem cards (the Story-8.5 vehicle cell is appended to the
    // load row and is asserted in my-home-scene.spec.ts — exclude it here, mirroring
    // the jsdom suite's `:not([data-node="vehicle"])` scoping).
    const ecoCells = scene(page).locator('.scene-cell:not([data-node="vehicle"])');
    await expect(ecoCells).toHaveCount(5); // all roles resolved by slug
    const tags = await ecoCells.evaluateAll((cs) =>
      cs.map((c) => (c.firstElementChild?.tagName ?? '').toLowerCase()),
    );
    expect(tags).toEqual(['tc-solar', 'tc-powerwall', 'tc-grid', 'tc-home', 'tc-wall-connector']);
    // The bus overlay names a present node (no blank) and carries a kW magnitude.
    const label = (await scene(page).locator('.scene-bus').getAttribute('aria-label')) ?? '';
    expect(label).toMatch(/kW/);
    // No 'NaN' painted anywhere under the strange prefix.
    expect(await scene(page).textContent()).not.toContain('NaN');
    // The console-guard fixture fails the test at teardown on any uncaught error.
  });
});

// ════════════════════════════════════════════════════════════════════════════
// STORY 8.8 — Epic-8 DEPTH runtime sweep (the deepened Scene the 6.8 sweep didn't
// reach). 6.8 froze the three MVP animations (bus dash, vignette, focus-highlight);
// this freezes the NEW Epic-8 sources TOGETHER in one composed render — per-node
// hero art (`nhPulse`) + inline charts (`chartIn`) + the segmented control (`.seg`)
// — and walks the keyboard through the NEW controls (deep-link → seg → slider →
// scene cells) with the ring and no trap. The per-story specs verified each source
// in isolation; this is the composed proof the cross-component pass demands.
// ════════════════════════════════════════════════════════════════════════════

// Mount a DEEPENED tc-my-home: the energy-detail hass (Powerwall controls + counters)
// + injected weather/sun (the Solar vignette) + a mock callWS that returns a real
// history series (so the embedded cards draw charts) + a callService spy. First child
// of <body> ⇒ the Scene leads the tab order.
async function mountDeepScene(page: Page): Promise<void> {
  await page.evaluate(
    ({ fixtureStates }) => {
      const w = window as unknown as { __wsCalls?: number; __svc?: unknown[] };
      w.__wsCalls = 0;
      w.__svc = [];
      // A 2-day, 4-sample series per requested id → ≥2 today points ⇒ a real spark.
      const now = Date.now();
      const day = 86_400_000;
      const sample = (id: string) => ({
        [id]: [
          { s: '10', lu: (now - day - 3_600_000) / 1000 },
          { s: '13', lu: (now - day - 1000) / 1000 },
          { s: '20', lu: (now - 3_600_000) / 1000 },
          { s: '26', lu: (now - 1000) / 1000 },
        ],
      });

      const card = document.querySelector('tesla-card') as unknown as { hass: Record<string, unknown> };
      const states: Record<string, unknown> = {
        ...(fixtureStates as Record<string, unknown>),
        'weather.home': { entity_id: 'weather.home', state: 'cloudy', attributes: {}, last_updated: '2026-06-15T14:41:00Z', last_changed: '2026-06-15T14:41:00Z' },
        'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {}, last_updated: '2026-06-15T14:41:00Z', last_changed: '2026-06-15T14:41:00Z' },
      };
      const hass = {
        ...card.hass,
        states,
        callWS: (msg: { entity_ids: string[] }) => {
          w.__wsCalls = (w.__wsCalls ?? 0) + 1;
          return Promise.resolve(sample(msg.entity_ids[0]));
        },
        callService: (domain: string, service: string, data: Record<string, unknown>) => {
          (w.__svc as unknown[]).push({ domain, service, data });
          return Promise.resolve();
        },
      };

      document.getElementById('scene-host')?.remove();
      const host = document.createElement('div');
      host.id = 'scene-host';
      host.style.cssText = 'width:1100px;padding:16px;box-sizing:border-box;';
      document.body.prepend(host);
      window.scrollTo(0, 0);

      const sceneEl = document.createElement('tc-my-home') as unknown as { setConfig(c: unknown): void; hass: unknown };
      sceneEl.setConfig({ type: 'tc-my-home' });
      sceneEl.hass = hass;
      host.appendChild(sceneEl as unknown as HTMLElement);
    },
    { fixtureStates: ENERGY_DETAIL.states },
  );
}

const animOf = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => getComputedStyle(el).animationName);

test.describe('R6 depth — composed reduced-motion over the NEW Epic-8 animation sources (AC1)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC1 control — the NEW sources animate by default in the deepened Scene', async ({ page }) => {
    await mountDeepScene(page);
    // The embedded cards draw their charts via the async callWS → wait for the spark.
    await expect(page.locator('tc-my-home svg.spark').first()).toBeVisible();
    expect(await animOf(page.locator('tc-my-home svg.spark').first()), 'chart draw-on runs by default').toBe('chartIn');
    expect(await animOf(scene(page).locator('.nh-wc-dot').first()), 'WC status dot pulses by default').toBe('nhPulse');
  });

  test('AC1 — reduced-motion FREEZES hero art + charts + the segmented control together, data cues survive', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountDeepScene(page);

    // 1) Inline charts: the draw-on freezes to none, the final static curve stays drawn.
    await expect(page.locator('tc-my-home svg.spark').first()).toBeVisible();
    expect(await animOf(page.locator('tc-my-home svg.spark').first()), 'chartIn must halt under reduced-motion').toBe('none');
    await expect(page.locator('tc-my-home svg.spark path.ct-line').first(), 'the final curve stays drawn (data survives)').toBeAttached();

    // 2) Per-node hero art: the WC status-dot pulse freezes; the dot stays visible.
    const dot = scene(page).locator('.nh-wc-dot').first();
    await expect(dot).toBeAttached();
    expect(await animOf(dot), 'nhPulse must halt under reduced-motion').toBe('none');

    // 3) The Powerwall segmented control: its transition is an instant cut; labels stay.
    const seg = scene(page).locator('.seg').first();
    await expect(seg, 'the embedded Powerwall renders its operation-mode segments').toBeAttached();
    const segDur = await seg.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(segDur, 'the .seg transition must be killed under reduced-motion').toBe('0s');

    // 4) And the 6.8 trio still freezes composed (the bus dash) — the data cue survives.
    expect(await animOf(scene(page).locator('.sb-flow').first()), 'bus dash still halts at depth').toBe('none');
    await expect(scene(page).locator('.gw-head').first(), 'arrowheads survive (the colour-blind-safe cue)').toBeAttached();
  });
});

// Probe the DEEP active element across nested open shadow roots → a stable signature
// (which NEW affordance is focused) + the focus-ring computed style. Mirrors the 6.8
// onCell probe, generalized to the new control set.
async function deepFocusKind(page: Page) {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    while (el && (el as HTMLElement).shadowRoot?.activeElement) {
      el = (el as HTMLElement).shadowRoot!.activeElement;
    }
    if (!el) return null;
    const cl = el.classList;
    // The slider's focusable node is its inner `<div role="slider">` (tabindex 0),
    // not the tc-slider host — detect it by role, the others by class.
    const kind = cl.contains('eco-deeplink')
      ? 'deeplink'
      : cl.contains('seg')
        ? 'seg'
        : el.getAttribute('role') === 'slider'
          ? 'slider'
          : cl.contains('scene-cell')
            ? 'scene-cell'
            : null;
    if (!kind) return { kind: null as string | null };
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      kind,
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      w: box.width,
      h: box.height,
    };
  });
}

test.describe('R6 depth — keyboard traverses the NEW controls with the ring, no trap (AC1)', () => {
  test.beforeEach(async ({ demo }) => {
    await demo.open(AWAKE.open);
  });

  test('AC1 — Tab reaches the deep-link, segmented control, reserve slider AND the scene cells; each paints the 2px blue ring; ≥44px; no trap', async ({ page }) => {
    await mountDeepScene(page);
    await expect(page.locator('tc-my-home .seg').first(), 'the deepened Scene exposes the new controls').toBeAttached();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Walk the whole keyboard path; collect each NEW affordance the focus lands on,
    // and verify a representative of each paints the 2px --tc-blue ring at ≥44px.
    const seen = new Set<string>();
    const ringed = new Set<string>(); // cleared the SHARED 2px --tc-blue :focus-visible ring
    const sized = new Set<string>(); // cleared the ≥44×44 CSS-px tap-target floor
    let escapedAfterLast = false;
    let sawAnyControl = false;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const info = await deepFocusKind(page);
      if (!info || !info.kind) {
        // Focus left the scene-cell/control set: a trap would never allow this once
        // we've been on a control. Record the escape as proof of "no trap".
        if (sawAnyControl) escapedAfterLast = true;
        continue;
      }
      sawAnyControl = true;
      seen.add(info.kind);
      if ((info.w ?? 0) >= 44 && (info.h ?? 0) >= 44) sized.add(info.kind);
      if (
        info.focusVisible &&
        info.outlineStyle === 'solid' &&
        info.outlineWidth === '2px' &&
        info.outlineColor === 'rgb(56, 189, 248)'
      ) {
        ringed.add(info.kind);
      }
    }

    // Every NEW affordance type is reachable by keyboard in the composed Scene.
    for (const kind of ['deeplink', 'seg', 'slider', 'scene-cell']) {
      expect(seen.has(kind), `keyboard Tab must reach the ${kind}`).toBe(true);
    }
    // The shared-outline controls paint the 2px --tc-blue ring on keyboard focus
    // (the deeplink/seg/scene-cell :focus-visible recipe). The tc-slider's focus
    // affordance is its thumb/track (commit-on-release, pinned in
    // powerwall-controls.spec + a11y-interaction.spec), not the shared outline.
    for (const kind of ['deeplink', 'seg', 'scene-cell']) {
      expect(ringed.has(kind), `the ${kind} must paint the 2px blue ring on keyboard focus`).toBe(true);
    }
    // Every new affordance clears the ≥44×44 tap-target floor (incl. the 46px slider track).
    for (const kind of ['deeplink', 'seg', 'slider', 'scene-cell']) {
      expect(sized.has(kind), `the ${kind} must clear the ≥44px tap-target floor`).toBe(true);
    }
    // No focus trap: focus could leave the control/cell set after landing on it.
    expect(escapedAfterLast, 'focus must be able to leave the Scene controls — no trap').toBe(true);
  });
});
