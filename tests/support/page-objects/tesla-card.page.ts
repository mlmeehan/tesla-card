// Page object for the Tesla card running inside the demo harness. Centralises
// selectors so specs read as behaviour, not DOM. The card is a Lit web component
// with nested shadow roots — Playwright's CSS/role/text engines pierce open shadow
// DOM automatically, so locators scoped to `tesla-card` reach into every child
// (tc-hero, tc-panel-*). Tabs are real `<button role="tab">` with text labels, so
// getByRole is the resilient selector (the card ships no data-testid hooks).
import { expect, type Locator, type Page } from '@playwright/test';
import { buildDemoUrl, type DemoOptions, type PanelId } from '../helpers/demo-url';
import { installHermeticRouting } from '../helpers/hermetic';

export type PanelName =
  | 'Climate'
  | 'Charging'
  | 'Closures'
  | 'Tyres'
  | 'Location'
  | 'Media'
  | 'Energy';

export class TeslaCardPage {
  readonly card: Locator;

  constructor(readonly page: Page) {
    this.card = page.locator('tesla-card');
  }

  /** Navigate to the demo with the given options and wait for first meaningful paint. */
  async open(opts: DemoOptions = {}): Promise<void> {
    await installHermeticRouting(this.page);
    await this.page.goto(buildDemoUrl(opts));
    // Card upgraded (custom element defined) + Lit's first render flushed.
    await expect(this.card).toBeVisible();
    await expect(this.tablist).toBeVisible();
  }

  get tablist(): Locator {
    return this.card.getByRole('tablist');
  }

  /** A panel tab button by its visible label. */
  tab(name: PanelName): Locator {
    return this.card.getByRole('tab', { name });
  }

  /** Click a tab and confirm it became the selected one. */
  async openPanel(name: PanelName): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
  }

  /** First element inside the card whose text contains `needle` (substring match). */
  text(needle: string): Locator {
    return this.card.getByText(needle, { exact: false }).first();
  }

  /** The hero shell root — carries `class="hero surface"` (the .surface/xl elevation stage, AC1). */
  get hero(): Locator {
    return this.card.locator('.hero');
  }

  /** The hero stage — holds the car svg (default/paint/recolor) or flat <img> (image mode). */
  get heroStage(): Locator {
    return this.card.locator('.car-stage');
  }

  /** The recolorable hero <svg> (bundled generic-EV default or body stack; the 1024×687 contract). */
  get heroSvg(): Locator {
    return this.heroStage.locator('svg').first();
  }

  /** The inner <svg> nested inside the bundled generic-EV — keeps its intrinsic 1024×480 art, fitted. */
  get heroInnerSvg(): Locator {
    return this.heroSvg.locator('svg').first();
  }

  /** The legacy flat hero image (?image=1). */
  get heroImage(): Locator {
    return this.heroStage.locator('img');
  }

  /** The Hero status line (dot + label + sub-hint, incl. the "updated Nm ago" freshness hint). */
  get heroStatus(): Locator {
    return this.hero.locator('.status');
  }

  /** The status-line LABEL ("Parked" / "Plugged-idle" / "Charging" / …) — Story 3.4 a11y. */
  get heroStatusLabel(): Locator {
    return this.hero.locator('.st-label');
  }

  /** The charge-port glow + cable group on the bundled EV (present only when plugged/charging). */
  get heroPort(): Locator {
    return this.heroStage.locator('.tc-port');
  }

  /** All four aperture open-state overlays (Story 3.5) — always present in the DOM, opacity-toggled. */
  get heroApertures(): Locator {
    return this.heroStage.locator('.ap');
  }

  /** A single aperture overlay by name (.ap-frunk / .ap-liftgate / .ap-door / .ap-window). */
  aperture(name: 'frunk' | 'liftgate' | 'door' | 'window'): Locator {
    return this.heroStage.locator(`.ap-${name}`);
  }

  /** The tappable battery row — a real <button> that dispatches open-panel{charging} (AC3). */
  get heroBattery(): Locator {
    return this.hero.locator('button.battery');
  }

  /** The battery percentage readout ("64%" / "—"). */
  get heroBatteryPct(): Locator {
    return this.hero.locator('.bat-pct');
  }

  async setEnv(env: 'default' | 'renamed'): Promise<void> {
    // Harness env toggles live in the page's light DOM (stable ids), not the card.
    await this.page.locator(env === 'renamed' ? '#b-renamed' : '#b-default').click();
  }

  async setScenario(scenario: 'awake' | 'asleep'): Promise<void> {
    await this.page.locator(scenario === 'asleep' ? '#b-asleep' : '#b-awake').click();
  }
}

export type { DemoOptions, PanelId };
