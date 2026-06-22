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
