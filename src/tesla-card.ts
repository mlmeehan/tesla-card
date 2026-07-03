import {
  LitElement,
  html,
  css,
  nothing,
  type TemplateResult,
  type PropertyValues,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  mdiThermometer,
  mdiEvStation,
  mdiSolarPower,
  mdiCarDoor,
  mdiCarTireAlert,
  mdiMapMarkerRadius,
  mdiPlayCircleOutline,
} from '@mdi/js';
import { CARD_VERSION } from './const';
import { resolveEntities } from './data/resolve';
import { detectDialect } from './data/dialect';
import { resolveEnergyEntities, hasEnergySite, type EnergyEntities } from './data/energy';
import { tokens, sharedStyles } from './styles';
import { STRINGS } from './strings';
import { log } from './log';
import { icon } from './ui';
import type { HomeAssistant, TeslaCardConfig, LovelaceCard, PanelId } from './types';

import './components/hero';
import './components/quick-actions';
import './components/commands';
import './components/panel-climate';
import './components/panel-charging';
import './components/panel-energy';
import './components/panel-closures';
import './components/panel-tires';
import './components/panel-location';
import './components/panel-media';
// Epic 6 — standalone ecosystem cards (Story 6.2 + Wall Connector in 6.3).
// Side-effect imports register the custom elements + their window.customCards
// picker entries. These are STANDALONE cards (their own LovelaceCard contract);
// tesla-card.ts does NOT host them — the Scene that composes them is Story 6.5.
import './components/solar';
import './components/powerwall';
import './components/grid';
import './components/home';
import './components/wall-connector';
// Story 9.14 — the Generator card (the first NEW node TYPE; copper source accent).
import './components/generator';
// Epic 6 centrepiece (Story 6.5) — the "My Home" Scene composes the five
// ecosystem cards above into one live SceneBus-driven composition.
import './components/my-home';

type Tab = { id: PanelId; name: string; icon: string };

/**
 * Detail emitted when the hero / quick actions request a panel switch (Story 7.1
 * relocation, E9/AC1). Internal event contract owned by the panel-orchestration
 * parent (this module is the sole `@open-panel` listener) — NOT part of the public
 * `TeslaCardConfig` surface, so it lives with its owner here, not in `types.ts`.
 */
export interface OpenPanelDetail {
  panel: PanelId;
}

const PANELS: Tab[] = [
  { id: 'climate', name: STRINGS.tabs.climate, icon: mdiThermometer },
  { id: 'charging', name: STRINGS.tabs.charging, icon: mdiEvStation },
  { id: 'closures', name: STRINGS.tabs.closures, icon: mdiCarDoor },
  { id: 'tires', name: STRINGS.tabs.tires, icon: mdiCarTireAlert },
  { id: 'location', name: STRINGS.tabs.location, icon: mdiMapMarkerRadius },
  { id: 'media', name: STRINGS.tabs.media, icon: mdiPlayCircleOutline },
];

/** Energy tab, shown only when an energy site is detected (after Charging). */
const ENERGY_TAB: Tab = { id: 'energy', name: STRINGS.tabs.energy, icon: mdiSolarPower };

@customElement('tesla-card')
export class TeslaCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config!: TeslaCardConfig;
  @state() private _panel: PanelId = 'charging';

  /** `_config` with `entities` filled in by auto-resolution; passed to children. */
  private _resolvedConfig?: TeslaCardConfig;
  /** Auto-detected Tesla energy-site + Wall-Connector entities. */
  private _energy?: EnergyEntities;
  /** Inputs the cached resolution was computed from, to skip redundant work. */
  private _resolveCache?: {
    entities: unknown;
    devices: unknown;
    config: TeslaCardConfig;
  };

  public setConfig(config: TeslaCardConfig): void {
    // Forward-compatible (R9): the ONLY validation is presence — a falsy config
    // is the one sanctioned throw. We spread `{ ...config }` so UNKNOWN/future
    // keys are PRESERVED (never enumerated-and-rejected), and validate only what
    // we consume here (`default_panel`). Everything else degrades later in
    // `_resolve()` (entity/energy auto-detect), so old YAML never breaks on a new
    // build and a newer YAML still renders on an older one. Do NOT add eager
    // validation of optional fields — that would break the tolerate-extras contract.
    if (!config) throw new Error('Invalid configuration');
    this._config = { ...config };
    // A garbage/hidden `default_panel` seats here but render() falls it back to
    // the first available tab (never an empty shell) — see `render()`/`_panels()`.
    if (config.default_panel) this._panel = config.default_panel;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') || changed.has('_config')) this._resolve();
  }

  /**
   * The card-only theme override (Story 9.12 / D-9.12-2), read defensively
   * (FR-24): only the exact `'light'`/`'dark'` strings count — anything else
   * (absent / garbage / a future value) degrades to Auto (⇒ no attribute ⇒
   * today's fixed dark default).
   */
  private _resolvedTheme(): 'light' | 'dark' | undefined {
    const t = (this._config?.appearance as { theme?: unknown } | undefined)?.theme;
    return t === 'light' || t === 'dark' ? t : undefined;
  }

  // Reflect the resolved theme onto the card's OWN host attribute. The
  // `:host([theme='light'])` rule (styles.ts) then re-resolves the --tc-* colour
  // tokens for THIS card's surfaces only — never a global HA theme-var write, so
  // the surrounding dashboard chrome is untouched. Auto/absent ⇒ remove the
  // attribute ⇒ the dark default is byte-identical to today.
  protected override updated(): void {
    const t = this._resolvedTheme();
    if (t) this.setAttribute('theme', t);
    else this.removeAttribute('theme');
    // Reflect the compact-variant presentation onto the card's OWN host. Since
    // D-CQ-1 the tab bar's icon-only collapse is element-relative via `@container`
    // on `.root`, so it already fires for the ~376px My-Home embed AND any narrow
    // standalone column — the `:host([compact])` tab rules below are now a
    // redundant-but-harmless backup. Since the D-CQ-1 follow-on the
    // tc-quick-actions/tc-commands child grids ALSO collapse element-relative via
    // their own `@container` (each is its own query container), so the child
    // `:host([compact]) .row` rules are likewise redundant backups now — this
    // attribute no longer strictly drives any layout. Standalone (no `variant`) ⇒
    // no attribute ⇒ byte-identical to today (AC4).
    this.toggleAttribute('compact', this._config?.variant === 'compact');
  }

  /** Resolve entities by stable function-name; memoised on registry/config. */
  private _resolve(): void {
    if (!this._config) return;
    const entities = this.hass?.entities;
    const devices = this.hass?.devices;
    const cache = this._resolveCache;
    if (
      cache &&
      cache.entities === entities &&
      cache.devices === devices &&
      cache.config === this._config
    ) {
      return; // registry + config unchanged → keep the cached resolution
    }
    this._resolvedConfig = {
      ...this._config,
      entities: resolveEntities(this.hass, this._config),
    };
    this._energy = resolveEnergyEntities(this.hass, this._config);
    this._resolveCache = { entities, devices, config: this._config };
  }

  /** Visible tabs: base set, with Energy inserted after Charging when present. */
  private _panels(): Tab[] {
    const showEnergy = !this._config.energy?.hide && hasEnergySite(this._energy);
    if (!showEnergy) return PANELS;
    const out = [...PANELS];
    out.splice(2, 0, ENERGY_TAB);
    return out;
  }

  public getCardSize(): number {
    return 16;
  }

  public static getStubConfig(hass?: HomeAssistant): TeslaCardConfig {
    const stub: TeslaCardConfig = { type: 'custom:tesla-card' };
    // Exercise the data/ detection path so the "working default" claim is real
    // and degradation is safe — but intentionally do NOT persist resolved IDs.
    // Runtime re-resolves every render (survives device renames); baking
    // install-specific IDs into the seed would defeat zero-YAML. These calls are
    // a resolvability probe, not a config writer. All registry/state reads stay
    // behind the data/ boundary (AR-1) — never read hass.* directly here.
    if (hass) {
      void detectDialect(hass, stub); // never throws; surfaces ambiguity to a future editor
      void resolveEntities(hass, stub); // proves the vehicle is resolvable
    }
    return stub;
  }

  public static async getConfigElement(): Promise<HTMLElement> {
    await import('./editor');
    return document.createElement('tesla-card-editor');
  }

  private _openPanel = (e: CustomEvent<OpenPanelDetail>): void => {
    this._panel = e.detail.panel;
  };

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass) return nothing;
    const cfg = this._resolvedConfig ?? this._config;
    // Compact variant (Story 8.10): PRESENTATION only (Story 11.4). `variant: 'compact'`
    // selects the enriched compact hero (asleep-legible paint 11.1, lock chip + last-known
    // SoC/range 11.2, fluid track scaling 11.3) so the card fits a ~380px column — it is
    // read by `<tc-hero>` off the `cfg` forwarded below (`cfg` carries `variant` through
    // `_resolve()`'s spread). It does NOT hide the tab shell: the three sections below
    // render per their OWN `hide_*` flags, so the embedded vehicle cell honors the editor's
    // "Embedded vehicle cell" toggles + `default_panel` (the prior `|| compact` force-hide
    // made those a no-op — Story 11.4 drops it). A standalone card has no `variant`, so the
    // hero stays full there and the dropped `|| compact` is inert on the standalone path.
    const panels = this._panels();
    const current = panels.some((p) => p.id === this._panel) ? this._panel : 'charging';
    return html`
      <div class="root">
        <tc-hero
          .hass=${this.hass}
          .config=${cfg}
          @open-panel=${this._openPanel}
        ></tc-hero>

        ${cfg.hide_quick_actions
          ? nothing
          : html`<tc-quick-actions
              .hass=${this.hass}
              .config=${cfg}
              @open-panel=${this._openPanel}
            ></tc-quick-actions>`}

        ${cfg.hide_panels
          ? nothing
          : html`
              <div class="tabs" role="tablist">
                ${panels.map(
                  (p) => html`
                    <button
                      class="tab ${current === p.id ? 'active' : ''}"
                      role="tab"
                      aria-selected=${current === p.id}
                      aria-label=${p.name}
                      @click=${() => (this._panel = p.id)}
                    >
                      ${icon(p.icon, { size: 18 })}<span>${p.name}</span>
                    </button>
                  `
                )}
              </div>
              <div class="panel">${this._renderPanel(cfg, current)}</div>
            `}

        ${cfg.hide_commands
          ? nothing
          : html`<tc-commands
              .hass=${this.hass}
              .config=${cfg}
            ></tc-commands>`}
      </div>
    `;
  }

  private _renderPanel(cfg: TeslaCardConfig, panel: PanelId): TemplateResult {
    switch (panel) {
      case 'climate':
        return html`<tc-panel-climate .hass=${this.hass} .config=${cfg}></tc-panel-climate>`;
      case 'charging':
        return html`<tc-panel-charging .hass=${this.hass} .config=${cfg}></tc-panel-charging>`;
      case 'energy':
        return html`<tc-panel-energy
          .hass=${this.hass}
          .config=${cfg}
          .entities=${this._energy ?? {}}
        ></tc-panel-energy>`;
      case 'closures':
        return html`<tc-panel-closures .hass=${this.hass} .config=${cfg}></tc-panel-closures>`;
      case 'tires':
        return html`<tc-panel-tires .hass=${this.hass} .config=${cfg}></tc-panel-tires>`;
      case 'location':
        return html`<tc-panel-location .hass=${this.hass} .config=${cfg}></tc-panel-location>`;
      case 'media':
        return html`<tc-panel-media .hass=${this.hass} .config=${cfg}></tc-panel-media>`;
    }
  }

  static override styles = [
    tokens,
    sharedStyles,
    css`
      :host {
        display: block;
      }
      .root {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 1080px;
        margin: 0 auto;
        padding: 2px;
        /* Query container for element-relative responsive collapse (D-CQ-1):
           the tab-label reveal below keys on .root's OWN inline size via
           @container, not the viewport — so a narrow Lovelace column at a wide
           viewport collapses correctly. inline-size also implies layout + style
           containment, so .root becomes a stacking context AND the containing
           block for any position:fixed/absolute descendant. Verified safe: the
           card has zero position:fixed, and every component overlay (hero
           apertures, map, slider, bus) is anchored to a position:relative wrapper
           inside its OWN shadow, so nothing re-anchors onto .root. The block axis
           is uncontained: the 1080px cap + margin:0 auto centring + height are
           unaffected. */
        container-type: inline-size;
      }

      .tabs {
        display: flex;
        gap: 6px;
        padding: 6px;
        background: var(--tc-surface, rgba(255, 255, 255, 0.045));
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        border-radius: var(--tc-pill, 999px);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .tabs::-webkit-scrollbar {
        display: none;
      }
      .tab {
        flex: 0 1 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 10px 13px;
        /* ≥44×44 tap-target floor (UX-DR21) — kiosk-distance hard minimum,
           held in BOTH the compact icon-only state and the labelled state.
           Was ≈38px tall (padding + 13px text); the floor is the shared
           contract (.tc-tap) restated locally because the tab owns its box. */
        min-height: 44px;
        min-width: 44px;
        border: 0;
        background: transparent;
        color: var(--tc-text-dim, #9aa7b8);
        border-radius: var(--tc-pill, 999px);
        font-family: inherit;
        font-size: 13px;
        font-weight: 650;
        cursor: pointer;
        white-space: nowrap;
        transition: color 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), background 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)),
          flex-grow 0.16s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .tab:hover:not(.active) {
        color: var(--tc-text, #f1f5f9);
      }
      .tab.active {
        flex: 1 1 auto;
        background: var(--tc-surface-3, rgba(255, 255, 255, 0.1));
        color: var(--tc-text, #f1f5f9);
        box-shadow: var(--tc-shadow-sm, 0 6px 18px -8px rgba(0, 0, 0, 0.5));
      }
      .tab .tc-ico {
        opacity: 0.95;
      }
      /* Narrow bars (.root inline size below BREAKPOINTS.full): only the active
         tab shows its label; the rest are icon-only. At/above 760px every label
         is shown. The reveal keys on the CARD's own width via @container (D-CQ-1),
         not the viewport — so a narrow Lovelace column at a wide viewport
         collapses correctly (the 2026-07-03 tab-overlap fix). The 760 literal
         MUST equal BREAKPOINTS.full (styles.ts) — CSS can't read the TS constant,
         so a11y.test.ts pins them together.
         a11y: display:none strips the span from the accessibility tree, and the
         icon is aria-hidden — so the button carries an aria-label (its STRINGS
         tab name) to stay a NAMED control in the icon-only state (UX-DR21). */
      .tab span {
        display: none;
      }
      .tab.active span {
        display: inline;
      }
      @container (min-width: 760px) {
        .tab {
          flex: 1 1 auto;
        }
        .tab span {
          display: inline;
        }
      }
      /* Compact embed backup (Story 11.4 / AC9; now redundant post-D-CQ-1):
         the @container reveal above already collapses the ~376px My-Home embed
         to icon-only (376 < 760), so these rules are a belt-and-braces restating
         the icon-only look (only the active tab labelled) via the reflected
         'compact' host attribute. NOTE these are a hard OVERRIDE, not inert: the
         (0,2,0)/(0,3,0) selectors outrank the @container reveal (container queries
         add zero specificity), so a compact card is forced icon-only at ANY width.
         Harmless only because the embed is always ~376px (well under 760) — do not
         assume it agrees with @container if compact is ever widened. Kept to avoid
         disturbing the 11.4 reflection contract; a standalone card (no attribute)
         is unaffected. */
      :host([compact]) .tab {
        flex: 0 1 auto;
      }
      :host([compact]) .tab.active {
        flex: 1 1 auto;
      }
      :host([compact]) .tab span {
        display: none;
      }
      :host([compact]) .tab.active span {
        display: inline;
      }
    `,
  ];
}

(window as Window).customCards = (window as Window).customCards || [];
(window as Window).customCards!.push({
  type: 'tesla-card',
  name: STRINGS.card.name,
  description: STRINGS.card.description,
  preview: true,
  documentationURL: 'https://github.com/mlmeehan/tesla-card',
});

// Neutral startup banner via the single logger — no `#e82127` brand badge (D6).
log.info(`v${CARD_VERSION}`);

declare global {
  interface HTMLElementTagNameMap {
    'tesla-card': TeslaCard;
  }
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}
