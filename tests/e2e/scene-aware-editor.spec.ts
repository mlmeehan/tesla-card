// Scene-aware editor mode for the standalone My-Home card, REAL-BROWSER E2E.
//
// The branch SELECTION (My-Home ⇒ Compose / Embedded-vehicle Tune) is pinned exhaustively
// in jsdom (src/editor.test.ts). This spec covers what jsdom structurally cannot: that the
// My-Home Appearance step renders NO in-editor preview (sprint-change-proposal-2026-06-23
// #3 — supersedes Story 10.1 AC4 / D-10.1-2/F-1; HA's native card-editor split-pane preview
// is authoritative, so the embedded scaled <tc-my-home> mount was redundant), while a paint
// pick still round-trips a hex config, and the VEHICLE card preview still renders unchanged.
//
// The console-guard fixture (auto) also makes every test a "mounts + renders cleanly in a
// real browser" proof — the appearance step must lay out without the preview, no throw.
//
// `&editortype=my-home` opens the editor on a `custom:tc-my-home` config (demo harness).
import { test, expect, TeslaEditorPage } from '../support/fixtures';

test.describe('#3 — My-Home Appearance step renders NO in-editor preview', () => {
  test('the My-Home appearance step shows no embedded preview (HA pane is authoritative)', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ setup: 'done', editortype: 'my-home' });
    await expect(ed.normalForm).toBeVisible();

    // No in-editor preview frame at all, and no composed <tc-my-home> mounted. The
    // `.appearance-preview` guard is meaningful, not tautological — the vehicle path DOES
    // emit it (asserted present in the vehicle test below), so its absence here is a real
    // signal that the My-Home preview was removed.
    await expect(ed.appearancePreview).toHaveCount(0);
    await expect(ed.previewComposedCard).toHaveCount(0);

    // The appearance group still lays out cleanly — the pickers render with no preview.
    await expect(ed.paintSwatch('blue')).toBeVisible();
  });

  test('a paint pick still round-trips a hex config on the My-Home path', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ setup: 'done', editortype: 'my-home' });
    await expect(ed.paintSwatch('blue')).toBeVisible();

    await ed.paintSwatch('blue').click();

    // The write path persisted a curated HEX (never the bare keyword — the 9.12 contract),
    // and the config still carries the My-Home type (round-trip preserved).
    const cfg = await ed.lastConfig();
    expect(typeof cfg?.paint).toBe('string');
    expect((cfg?.paint as string).startsWith('#')).toBe(true);
    expect(cfg?.type).toBe('custom:tc-my-home');
  });

  test('the vehicle card preview is unchanged — lone hero, no composed Scene (AC1)', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ setup: 'done' }); // default editortype = vehicle
    await expect(ed.normalForm).toBeVisible();
    await expect(ed.previewCarHero).toBeVisible();
    await expect(ed.previewComposedCard).toHaveCount(0); // lone hero, never a composed Scene
  });
});

test.describe('Story 10.1 AC2/AC6 — Compose wizard step (My-Home), real layout', () => {
  test('a bare My-Home config reaches Compose with node blocks clearing the ≥44×44 floor', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ editortype: 'my-home' }); // bare ⇒ wizard at Detect
    await expect(ed.wizard).toBeVisible();
    await expect(ed.steps).toHaveCount(5); // never a step added/removed

    await ed.clickNext(); // Detect → Compose (step 2)
    await expect(ed.step(1)).toHaveClass(/current/);
    await expect(ed.composeNodes.first()).toBeVisible();

    // Every Compose move-button clears the ≥44×44 target floor (computed layout, not CSS).
    const moves = ed.editor.locator('.wiz-body .compose .compose-node .move');
    const n = await moves.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const box = await moves.nth(i).boundingBox();
      expect(box, `compose move ${i} has a layout box`).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });
});
