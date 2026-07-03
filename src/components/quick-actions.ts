import { html, css, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  mdiLock,
  mdiLockOpenVariant,
  mdiAirConditioner,
  mdiEvStation,
  mdiCarBack,
  mdiCar,
  mdiShieldCar,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { STRINGS } from '../strings';
import { icon } from '../ui';
import { normalizeCoverState, normalizeLockState } from '../data/dialect';
import type { EntityKey } from '../const';
import {
  entityId,
  rawState,
  isUnavailable,
  toggleEntity,
  srState,
  prettyText,
} from '../helpers';

/**
 * Per-tap reconcile fence (ms). A stuck optimistic override would lie forever if
 * the command silently failed or the car is asleep, so each tap arms a single
 * one-shot timer that drops the override → reverts to real (truth). This is NOT
 * background polling (UX-DR23 bans polling/auto-wake): it is a bounded, per-tap
 * expiry — the same exemption rAF gets — cleared on reconcile and on disconnect.
 */
export const RECONCILE_TIMEOUT_MS = 10_000;

interface QuickAction {
  key: EntityKey;
  label: string;
  accent: string;
  /** icon shown when "on"/active, and when off. */
  iconOn: string;
  iconOff: string;
  /** is the control in its active/highlighted state? */
  on: (s: string | undefined) => boolean;
}

const ACTIONS: QuickAction[] = [
  {
    key: 'lock',
    label: STRINGS.quickActions.lock,
    accent: 'var(--tc-green, #34d399)',
    iconOn: mdiLock,
    iconOff: mdiLockOpenVariant,
    // Route through the dialect seam (Story 5.11) — no inline fleet-shaped
    // `=== 'locked'`; behaviour-identical for tesla_fleet (default LOCK_MAP).
    on: (s) => normalizeLockState(s) === 'locked',
  },
  {
    key: 'climate',
    label: STRINGS.quickActions.climate,
    accent: 'var(--tc-teal, #2dd4bf)',
    iconOn: mdiAirConditioner,
    iconOff: mdiAirConditioner,
    on: (s) => s !== undefined && s !== 'off' && !isUnavailable(s),
  },
  {
    key: 'charge_port',
    label: STRINGS.quickActions.port,
    accent: 'var(--tc-blue, #38bdf8)',
    iconOn: mdiEvStation,
    iconOff: mdiEvStation,
    on: (s) => normalizeCoverState(s) === 'open',
  },
  {
    key: 'frunk',
    label: STRINGS.quickActions.frunk,
    accent: 'var(--tc-amber, #fbbf24)',
    iconOn: mdiCar,
    iconOff: mdiCar,
    on: (s) => normalizeCoverState(s) === 'open',
  },
  {
    key: 'trunk',
    label: STRINGS.quickActions.trunk,
    accent: 'var(--tc-amber, #fbbf24)',
    iconOn: mdiCarBack,
    iconOff: mdiCarBack,
    on: (s) => normalizeCoverState(s) === 'open',
  },
  {
    key: 'sentry',
    label: STRINGS.quickActions.sentry,
    accent: 'var(--tc-red, #f87171)',
    iconOn: mdiShieldCar,
    iconOff: mdiShieldCar,
    on: (s) => s === 'on',
  },
];

@customElement('tc-quick-actions')
export class TcQuickActions extends TcBase {
  /**
   * Optimistic overrides: `EntityKey` → the requested `on` value. The VISUAL pill
   * (icon + `.ctrl.on`) reads this immediately on tap so the control feels
   * responsive; the SCREEN-READER state (aria-pressed + accessible name) ignores
   * it and always reflects the real, settled `hass` value (UX-DR21). An entry is
   * dropped when the real state catches up (reconcile IS the feedback) or when the
   * per-tap fence expires (honest revert).
   */
  @state() private _optimistic: Record<string, boolean> = {};

  /** One-shot reconcile-fence timer per pending key (cleared on reconcile/disconnect). */
  private _timers = new Map<EntityKey, ReturnType<typeof setTimeout>>();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // No orphaned reconcile fences once we leave the DOM.
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
  }

  /**
   * Reconcile on every `hass` tick: when the live state of a pending control
   * matches its optimistic request, the round-trip landed → drop the override
   * (and its fence). Re-derive from the live `ACTIONS` predicate — never a frozen
   * tap-time snapshot — so reconcile is correct even if the car was toggled
   * elsewhere. A still-disagreeing tick is the expected in-flight window; only the
   * fence (or a matching tick) clears it.
   */
  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has('hass')) return;
    for (const a of ACTIONS) {
      if (!(a.key in this._optimistic)) continue;
      const real = a.on(rawState(this.hass, this.config, a.key));
      if (real === this._optimistic[a.key]) this._reconcile(a.key);
    }
  }

  // Reflect the compact-variant presentation onto the host (Story 11.4 /
  // D-11.4-4). Since the D-CQ-1 follow-on the pill-grid collapse is driven by the
  // `@container (max-width:540px)` rule below (the host is its own query
  // container), which already fires for the ~376px embed — so this reflected
  // attribute is now only a redundant `:host([compact]) .row` backup, kept to
  // preserve the 11.4 contract. A standalone card has no `variant` ⇒ no attribute
  // ⇒ the 6-col grid is byte-identical to today (AC4).
  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.toggleAttribute('compact', this.config?.variant === 'compact');
  }

  private _tap(a: QuickAction): void {
    if (!this.hass) return;
    const s = rawState(this.hass, this.config, a.key);
    if (isUnavailable(s)) return; // a disabled control never enters the optimistic path
    const nextOn = !a.on(s);
    this._optimistic = { ...this._optimistic, [a.key]: nextOn };
    // Arm a fresh single-shot fence (replacing any prior one for this key).
    this._clearTimer(a.key);
    this._timers.set(
      a.key,
      setTimeout(() => this._reconcile(a.key), RECONCILE_TIMEOUT_MS)
    );
    toggleEntity(this.hass, entityId(this.config, a.key));
  }

  /** Drop a pending override + its fence (reconciled or expired → back to truth). */
  private _reconcile(key: EntityKey): void {
    this._clearTimer(key);
    if (!(key in this._optimistic)) return;
    const next = { ...this._optimistic };
    delete next[key];
    this._optimistic = next;
  }

  private _clearTimer(key: EntityKey): void {
    const t = this._timers.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      this._timers.delete(key);
    }
  }

  protected override render(): TemplateResult {
    return html`
      <div class="row">
        ${ACTIONS.map((a) => {
          const s = rawState(this.hass, this.config, a.key);
          const unavailable = isUnavailable(s);
          const settled = a.on(s); // real, reconciled state → drives the SR announce
          const active = a.key in this._optimistic ? this._optimistic[a.key] : settled;
          // Sighted feedback is optimistic (instant); SR feedback is the settled
          // truth — never tell a screen-reader a toggle happened that may not have.
          const srLabel =
            unavailable || s === undefined ? a.label : srState(a.label, prettyText(s));
          return html`
            <div class="ctrl-wrap">
              <button
                class="ctrl ${active ? 'on' : ''}"
                style="--accent:${a.accent}"
                ?disabled=${unavailable}
                @click=${() => this._tap(a)}
                aria-label=${srLabel}
                aria-pressed=${settled}
              >
                ${icon(active ? a.iconOn : a.iconOff, { size: 24 })}
              </button>
              <span class="ctrl-name">${a.label}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  static override styles = [
    sharedStyles,
    css`
      /* Query container for the element-relative pill-grid collapse below (the
         D-CQ-1 child-grid convergence). The host is a stretched flex item of the
         card's .root column, so its inline size == the card's content width; the
         @container rule keys the 6→3 col collapse on THAT, not the viewport — so a
         narrow Lovelace column at a wide viewport (and the ~376px My-Home embed)
         both collapse correctly. Same fix class as the tab-overlap bug. inline-size
         implies layout+style containment (host becomes a stacking context and the
         containing block for abs/fixed descendants); verified safe here — this
         shadow has zero positioned/overflow descendants. Block axis uncontained. */
      :host {
        container-type: inline-size;
      }
      .row {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 8px;
        padding: 4px 2px;
      }
      .ctrl[disabled] {
        opacity: 0.35;
        cursor: default;
        pointer-events: none;
      }
      /* 540 = BREAKPOINTS.compact (styles.ts) — canonical source of truth, now
         measured against the component's OWN width via @container (D-CQ-1). */
      @container (max-width: 540px) {
        .row {
          grid-template-columns: repeat(3, 1fr);
          gap: 14px 8px;
        }
      }
      /* Compact embed (Story 11.4): redundant-but-harmless backup since D-CQ-1 —
         the @container collapse above already fires for the ~376px embed (376 <
         540). Kept to preserve the 11.4 reflected-attribute contract, mirroring the
         parent .root's :host([compact]) tab backup. A standalone card has no
         compact attribute, so this is inert there (AC4 byte-identical). */
      :host([compact]) .row {
        grid-template-columns: repeat(3, 1fr);
        gap: 14px 8px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-quick-actions': TcQuickActions;
  }
}
