// Story 6.1 — Shared ecosystem-card shell (the DAG root of Epic 6).
//
// 6.1 builds the shared chrome the ecosystem cards stand on, but "nothing renders
// a real entity yet": EcosystemCard is an ABSTRACT, deliberately-UNREGISTERED base
// (no @customElement, not side-effect-imported in tesla-card.ts), so it is
// tree-shaken out of the runtime bundle entirely. The element-level ACs (AC1–AC4)
// live in the jsdom suite (src/components/ecosystem-card.test.ts) — they are the
// real verification layer for this story.
//
// This E2E spec therefore pins the *negative runtime contract* the demo harness
// CAN observe end-to-end against the built bundle: the shell must introduce no
// stray registered custom element, no inter-card messaging surface, and must not
// disturb the existing card. It is the regression guard for 6.2/6.3 — the moment a
// concrete `tc-solar`/`tc-powerwall` is registered (or the base is accidentally
// side-effect-imported) this spec's intent is revisited.
import { test, expect, AWAKE } from '../support/fixtures';

test.describe('ecosystem shell (6.1) — deliberate no-runtime-surface contract', () => {
  test('the existing card still renders cleanly — the shell base disturbs nothing', async ({
    demo,
  }) => {
    await demo.open(AWAKE.open);
    await expect(demo.card).toBeVisible();
    await expect(demo.tablist).toBeVisible();
    // consoleGuard (auto) asserts no uncaught exception / unexpected console.error.
  });

  test('no stray ecosystem element is registered in the production runtime', async ({ demo }) => {
    await demo.open(AWAKE.open);
    // The base is unregistered by design; the jsdom test-only fixtures
    // (tc-eco-fixture / tc-eco-raw) must never leak into the shipped bundle, and no
    // concrete ecosystem card lands until 6.2/6.3.
    const registered = await demo.page.evaluate(() =>
      [
        'ecosystem-card',
        'tc-ecosystem-card',
        'tc-eco-fixture',
        'tc-eco-raw',
        'tc-solar',
        'tc-powerwall',
        'tc-grid',
        'tc-home',
        'tc-wall-connector',
      ].filter((tag) => customElements.get(tag) !== undefined),
    );
    expect(registered).toEqual([]);
  });

  test('the shell ships no inter-card messaging on the page (shared-hass-only interlink)', async ({
    demo,
  }) => {
    await demo.open(AWAKE.open);
    // FR-32: coherence is the shared injected hass ONLY — no cross-card event bus /
    // peer-directed broadcast / shared mutable singleton hung off the page.
    const messagingGlobals = await demo.page.evaluate(() =>
      Object.keys(window).filter((k) =>
        /tesla.*(bus|channel|broadcast)|ecosystem.*(bus|channel|broadcast)/i.test(k),
      ),
    );
    expect(messagingGlobals).toEqual([]);
  });
});
