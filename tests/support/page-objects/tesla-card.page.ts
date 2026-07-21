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
  | 'Tires'
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

  /** The fire-and-forget commands block (Story 5.3) — sits at the card bottom. */
  get commands(): Locator {
    return this.card.locator('tc-commands');
  }

  /** Every command pill (`<button class="cmd">`) in render order: wake·honk·flash·HomeLink·keyless·boombox. */
  get commandButtons(): Locator {
    return this.commands.locator('button.cmd');
  }

  /** A single command pill by its visible label ("Wake", "Honk", …). */
  command(label: string): Locator {
    return this.commands.locator('button.cmd', { hasText: label });
  }

  /**
   * The wake-affordance resting reason (`.wake-reason` inside `.wake-affordance`,
   * Story 5.4): "Tap a command to wake" when asleep, "Awake" when online. Renamed
   * from the 5.3 `.wake-hint` when 5.4 bundled the sparse-data triad.
   */
  get wakeHint(): Locator {
    return this.commands.locator('.wake-reason');
  }

  // ── Charging panel (Story 5.5) — the default open panel ────────────────────
  /** The charging panel root (`tc-panel-charging`). */
  get chargingPanel(): Locator {
    return this.card.locator('tc-panel-charging');
  }

  /** The battery headline number ("72" in % mode / "235" in range mode). */
  get chargeHeadline(): Locator {
    return this.chargingPanel.locator('.bnum .big');
  }

  /** Every charge `tc-slider` in render order: [charge limit, charge current]. */
  get chargeSliders(): Locator {
    return this.chargingPanel.locator('tc-slider');
  }

  /** A charge slider addressed by its state-bearing aria-label ("Charge limit"/"Charge current"). */
  chargeSlider(label: 'Charge limit' | 'Charge current'): Locator {
    return this.chargingPanel.locator(`tc-slider[label="${label}"]`);
  }

  /** The range-vs-% segmented toggle (AC3). */
  get displayToggle(): Locator {
    return this.chargingPanel.locator('.seg');
  }

  /** Both toggle options in render order: ["%", "Range"]. */
  get displayOptions(): Locator {
    return this.chargingPanel.locator('.seg-opt');
  }

  /** The honest "Target N%" charge-target line (AC3) — present only when charge_limit resolves. */
  get chargeTargetLine(): Locator {
    return this.chargingPanel.locator('.limit-note');
  }

  /** Every live stat tile in the charging grid — hides individually when its entity is missing (AC1). */
  get chargeStatTiles(): Locator {
    return this.chargingPanel.locator('.grid.g3 .stat');
  }

  /** The live charge-state cue ("Charging"/"Idle"/"Asleep") — `.live` when canonical state is charging (AC4). */
  get chargeStatusCue(): Locator {
    return this.chargingPanel.locator('.cstatus');
  }

  /** The Start/Stop-charging pill (`.bigpill`) — disabled when charge_switch is unresolvable (Story 17.1). */
  get chargeStartPill(): Locator {
    return this.chargingPanel.locator('.bigpill');
  }

  // ── Tires panel (Story 5.8) ────────────────────────────────────────────────
  /** The tires panel root (`tc-panel-tires`) — rendered only when the Tires tab is open. */
  get tiresPanel(): Locator {
    return this.card.locator('tc-panel-tires');
  }

  /** All four corner cards in render order (fl, fr, rl, rr). */
  get tireCorners(): Locator {
    return this.tiresPanel.locator('.corner');
  }

  /** A single corner card by position ('fl' | 'fr' | 'rl' | 'rr'). */
  tireCorner(pos: 'fl' | 'fr' | 'rl' | 'rr'): Locator {
    return this.tiresPanel.locator(`.corner.${pos}`);
  }

  /** The freshness-honest head summary ("Check pressure" / "All normal" / "No data"). */
  get tiresSummary(): Locator {
    return this.tiresPanel.locator('.summary');
  }

  /** Every warned-corner "Low" chip (icon + text — the colour-not-only-signal cue). */
  get tireWarnChips(): Locator {
    return this.tiresPanel.locator('.c-warn');
  }

  // ── Location panel (Story 5.9) ─────────────────────────────────────────────
  /** The location panel root (`tc-panel-location`) — rendered only when the Location tab is open. */
  get locationPanel(): Locator {
    return this.card.locator('tc-panel-location');
  }

  /** The grayscale OSM map iframe — present only when coordinates resolve (AC1). */
  get mapIframe(): Locator {
    return this.locationPanel.locator('.map iframe');
  }

  /** The map-card backdrop (`.map`) — carries the one sanctioned FR-28 gradient exception (AC2). */
  get mapBackdrop(): Locator {
    return this.locationPanel.locator('.map');
  }

  /** The "Location unavailable" empty state (marker icon + text) — shown when no coords (AC3). */
  get mapEmpty(): Locator {
    return this.locationPanel.locator('.map-empty');
  }

  /** The coordinate readout in the map foot ("37.7749, -122.4194" / "—"). */
  get mapCoord(): Locator {
    return this.locationPanel.locator('.coord');
  }

  /** The keyboard-focusable Open-map external link (`<a rel="noopener noreferrer" target="_blank">`). */
  get openMapLink(): Locator {
    return this.locationPanel.locator('a.maplink');
  }

  /** Every stat tile in the panel (the route row + the persistent odo/speed/power row). */
  get locationStatTiles(): Locator {
    return this.locationPanel.locator('.stat');
  }

  /** A single location stat tile by its visible label ("Odometer"/"Speed"/"Power"/"ETA"/…). */
  locationStat(label: string): Locator {
    return this.locationPanel.locator('.stat').filter({ hasText: label });
  }

  /** The "updated Nm ago" last-known coordinate staleness stamp (dim `.tc-stale-copy`) — stale-only. */
  get mapStaleStamp(): Locator {
    return this.locationPanel.locator('.map-stale');
  }

  // ── Media panel (Story 5.10) ───────────────────────────────────────────────
  /** The media panel root (`tc-panel-media`) — rendered only when the Media tab is open. */
  get mediaPanel(): Locator {
    return this.card.locator('tc-panel-media');
  }

  /** The now-playing art well (`.art`) — holds the `<img>` cover or the music-note glyph fallback. */
  get mediaArt(): Locator {
    return this.mediaPanel.locator('.art');
  }

  /** The cover-art `<img src=entity_picture>` — present only when the player exposes entity_picture. */
  get mediaArtImg(): Locator {
    return this.mediaPanel.locator('.art img');
  }

  /** The now-playing title ("Bohemian Rhapsody" / "Not playing"). */
  get mediaTitle(): Locator {
    return this.mediaPanel.locator('.title');
  }

  /** The now-playing artist ("Queen" / "Media player idle"). */
  get mediaArtist(): Locator {
    return this.mediaPanel.locator('.artist');
  }

  /** Every transport button in render order: [previous, play/pause, next]. */
  get transportButtons(): Locator {
    return this.mediaPanel.locator('.transport .tbtn');
  }

  /** A transport button by its state-bearing aria-label ("Previous"/"Next"). */
  transportButton(label: 'Previous' | 'Next'): Locator {
    return this.mediaPanel.locator(`.transport .tbtn[aria-label="${label}"]`);
  }

  /** The central play/pause button (`.tbtn.play`) — its aria-label reflects the settled transport state. */
  get playButton(): Locator {
    return this.mediaPanel.locator('.tbtn.play');
  }

  /** The mute toggle (`.mute`) — `.on` + red tint + glyph swap when muted; carries settled aria-pressed. */
  get muteButton(): Locator {
    return this.mediaPanel.locator('.mute');
  }

  /** The volume `tc-slider` (5.5 primitive) — carries label="Volume" for SR context. */
  get volumeSlider(): Locator {
    return this.mediaPanel.locator('tc-slider');
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
