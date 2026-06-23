// Page object for the Tesla card's config editor (tesla-card-editor) running in
// the demo harness's ?editor=1 mode. The editor is the lazy-loaded element Lovelace
// reaches via getConfigElement; the harness mounts it with the same mock hass as
// the card. Centralises the Story 9.9 guided-setup-wizard selectors so the spec
// reads as behaviour. Playwright pierces the open shadow DOM, so locators scoped to
// `tesla-card-editor` reach the wizard chrome inside.
import { expect, type Locator, type Page } from '@playwright/test';
import { buildDemoUrl, type DemoOptions, type SetupState } from '../helpers/demo-url';
import { installHermeticRouting } from '../helpers/hermetic';

export class TeslaEditorPage {
  readonly editor: Locator;

  constructor(readonly page: Page) {
    this.editor = page.locator('tesla-card-editor');
  }

  /** Navigate to the harness in editor mode and wait for the editor to upgrade + render. */
  async open(opts: Omit<DemoOptions, 'editor'> = {}): Promise<void> {
    await installHermeticRouting(this.page);
    await this.page.goto(buildDemoUrl({ ...opts, editor: true }));
    await expect(this.editor).toBeVisible();
  }

  // ── Wizard chrome ──────────────────────────────────────────────────────────
  /** The wizard dialog root (present only when the wizard branch renders). */
  get wizard(): Locator {
    return this.editor.locator('.wizard');
  }

  /** The normal (non-wizard) config form (present for a configured/completed card). */
  get normalForm(): Locator {
    return this.editor.locator('.form');
  }

  /** All five stepper nodes, in order: DETECT · CONFIRM · APPEARANCE · TUNE · FINISH. */
  get steps(): Locator {
    return this.editor.locator('.stepper .step');
  }

  /** A single stepper node by zero-based index. */
  step(i: number): Locator {
    return this.steps.nth(i);
  }

  /** A footer control by its class suffix (tertiary=Back · secondary=Skip · primary=Next/Done · quiet=Finish now). */
  footerBtn(cls: 'tertiary' | 'secondary' | 'primary' | 'quiet'): Locator {
    return this.editor.locator(`.wiz-footer .wiz-btn.${cls}`);
  }

  /** Every footer button, in DOM/focus order (Back→Skip→Next→Finish now). */
  get footerButtons(): Locator {
    return this.editor.locator('.wiz-footer .wiz-btn');
  }

  /** The crossfade body wrapper (the element animated on step change). */
  get body(): Locator {
    return this.editor.locator('.wiz-body');
  }

  /** The Detect step's three-state discovery rows. */
  get discoRows(): Locator {
    return this.editor.locator('.disco-row');
  }

  /** The empty/fail discovery panel (honest "nothing detected" + manual fallback). */
  get emptyPanel(): Locator {
    return this.editor.locator('.wiz-empty');
  }

  /** The Finish step's polished-result block. */
  get result(): Locator {
    return this.editor.locator('.wiz-result');
  }

  /** The normal-form "Run guided setup" re-entry button. */
  get runSetup(): Locator {
    return this.editor.locator('.run-setup');
  }

  // ── Story 9.10 — normal-form discovery summary ───────────────────────────────
  /** The "Detected on your system" section (pinned at the top of the normal form). */
  get discoverySummary(): Locator {
    return this.editor.locator('.disco-summary');
  }

  /** The summary's per-role discovery rows. */
  get summaryRows(): Locator {
    return this.editor.locator('.disco-summary .disco-row');
  }

  /** The summary's per-role remap chevron buttons (the 9.11 entry seam). */
  get remapChevrons(): Locator {
    return this.editor.locator('.disco-summary .remap-chevron');
  }

  // ── Story 9.11 — per-entity remap picker ─────────────────────────────────────
  /** A summary row's remap chevron by its data-role (present row = "Remap", absent = "Map … manually"). */
  remapChevron(role: string): Locator {
    return this.editor.locator(`.disco-summary .remap-chevron[data-role="${role}"]`);
  }

  /** The expanded accordion picker panel (the entity-picker-row, present only when a row is open). */
  get remapPanel(): Locator {
    return this.editor.locator('.disco-summary .remap-panel');
  }

  /** The native ha-selector inside the open accordion panel. */
  get remapPicker(): Locator {
    return this.editor.locator('.disco-summary .remap-panel ha-selector');
  }

  /** The Reset-to-auto button inside the open panel (present only when an override is set). */
  get resetAuto(): Locator {
    return this.editor.locator('.disco-summary .reset-auto');
  }

  /** The polite live region that announces a pick's settled three-state. */
  get remapLive(): Locator {
    return this.editor.locator('.disco-summary .remap-live');
  }

  /** The summary's map-a-miss chevrons — absent (`— not found`) rows, labelled "Map … manually". */
  get mapManuallyChevrons(): Locator {
    return this.editor.locator('.disco-summary .remap-chevron[aria-label*="manually"]');
  }

  /** The wizard Step-2 Confirm full-list rows (present-only). */
  get confirmRows(): Locator {
    return this.editor.locator('.confirm-list .confirm-row');
  }

  /** Absent (`— not found`) confirm rows — should never exist (Confirm is present-only). */
  get confirmAbsentRows(): Locator {
    return this.editor.locator('.confirm-list .confirm-row.absent');
  }

  /** The trade-dress disclaimer line in the wizard chrome. */
  get disclaimer(): Locator {
    return this.editor.locator('.wiz-disclaimer');
  }

  /** Click the emphatic primary control (Next, or Done. on the Finish step). */
  async clickNext(): Promise<void> {
    await this.footerBtn('primary').click();
  }

  /** The last config the editor emitted via `config-changed` (what it would write to Lovelace). */
  async lastConfig(): Promise<Record<string, unknown> | null> {
    return this.page.evaluate(() => (window as unknown as { __lastConfig?: Record<string, unknown> }).__lastConfig ?? null);
  }

  /** Set a wizard step's config state via the harness param and reload (fresh editor). */
  async openAt(setup: SetupState, opts: Omit<DemoOptions, 'editor' | 'setup'> = {}): Promise<void> {
    await this.open({ ...opts, setup });
  }
}
