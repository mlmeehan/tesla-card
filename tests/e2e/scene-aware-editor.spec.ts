// Story 10.1 — Scene-aware editor mode for the standalone My-Home card, REAL-BROWSER E2E.
//
// The branch SELECTION (My-Home ⇒ Compose / live preview / Embedded-vehicle Tune) is
// pinned exhaustively in jsdom (src/editor.test.ts). This spec covers only what jsdom
// structurally CANNOT verify (AC4): the live composed-Scene preview — a real scaled
// <tc-my-home> whose source/load cards + Gateway bus need MEASURED rects + rAF that
// jsdom can't lay out — and that a paint change reflects on the embedded vehicle node.
//
// The console-guard fixture (auto) also makes every test a "mounts + renders cleanly in
// a real browser" proof — the composed preview must not throw at edit time.
//
// `&editortype=my-home` opens the editor on a `custom:tc-my-home` config (demo harness).
import { test, expect, TeslaEditorPage } from '../support/fixtures';

test.describe('Story 10.1 AC4 — live composed-Scene Appearance preview (My-Home)', () => {
  test('the preview mounts a real <tc-my-home> (cards + bus), not the lone car hero', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ setup: 'done', editortype: 'my-home' });
    await expect(ed.normalForm).toBeVisible();

    // A live composed card — NOT the vehicle card's single-hero preview. The composed
    // stage carries `.myhome`; the vehicle preview's synthetic tab strip is ABSENT (the
    // Scene has no tab bar). The car that DOES appear is the embedded vehicle NODE — a
    // legitimate part of the Scene (AC4a), not the lone-hero preview.
    await expect(ed.previewSceneCard).toBeVisible();
    await expect(ed.editor.locator('.appearance .preview-stage.myhome')).toBeVisible();
    await expect(ed.editor.locator('.appearance .preview-tabs')).toHaveCount(0);

    // The composed Scene genuinely renders its nodes: the embedded vehicle cell + the
    // Gateway bus overlay (both reached only through the live element, never imported).
    await expect(ed.previewVehicleCell.first()).toBeVisible();
    await expect(ed.previewSceneBus.first()).toBeAttached();

    // The miniature is really shrunk (the scale wrapper has a transform applied).
    const transform = await ed.editor
      .locator('.appearance .myhome-scale')
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform === 'none' || transform.startsWith('matrix')).toBe(true);
    expect(transform).not.toBe('none'); // a scale() resolves to a matrix
  });

  test('a paint pick reflects on the embedded vehicle node in the live preview', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ setup: 'done', editortype: 'my-home' });
    await expect(ed.previewSceneCard).toBeVisible();

    // The embedded vehicle hero carries the resolved paint as a `--tc-paint` custom prop
    // (car.ts sets `style="--tc-paint:<hex>"`). Capture it before, pick the Deep-blue
    // swatch, and confirm the SAME live node re-resolves to a different paint.
    const paintProbe = ed.previewVehicleCell.first().locator('[style*="--tc-paint"]').first();
    await expect(paintProbe).toBeAttached();
    const before = await paintProbe.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--tc-paint').trim()
    );

    await ed.paintSwatch('blue').click();
    await expect.poll(async () =>
      paintProbe.evaluate((el) => getComputedStyle(el).getPropertyValue('--tc-paint').trim())
    ).not.toBe(before);

    // The write path persisted a curated HEX (never the bare keyword — the 9.12 contract).
    const cfg = await ed.lastConfig();
    expect(typeof cfg?.paint).toBe('string');
    expect((cfg?.paint as string).startsWith('#')).toBe(true);
  });

  test('the vehicle card preview is unchanged — lone hero, no composed Scene (AC1)', async ({ page }) => {
    const ed = new TeslaEditorPage(page);
    await ed.open({ setup: 'done' }); // default editortype = vehicle
    await expect(ed.normalForm).toBeVisible();
    await expect(ed.previewCarHero).toBeVisible();
    await expect(ed.previewSceneCard).toHaveCount(0);
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
