import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { mdiChevronUp, mdiChevronDown } from '@mdi/js';
import type {
  HomeAssistant,
  TeslaCardConfig,
  LovelaceCardEditor,
  PanelId,
  NodeCustomization,
} from './types';
import { ROLES, type Role } from './data/registry';
import { STRINGS } from './strings';

const PANELS: { id: PanelId; name: string }[] = [
  { id: 'climate', name: STRINGS.tabs.climate },
  { id: 'charging', name: STRINGS.tabs.charging },
  { id: 'closures', name: STRINGS.tabs.closures },
  { id: 'tyres', name: STRINGS.tabs.tyres },
  { id: 'location', name: STRINGS.tabs.location },
  { id: 'media', name: STRINGS.tabs.media },
];

// Display name for each of the six Scene nodes (Story 9.4). The five energy
// roles reuse the existing `STRINGS.energy.nodes.*` chip labels (single-sourced,
// not duplicated); `vehicle` is editor-owned because `STRINGS.energy.nodes` has
// no `vehicle` key (the Hero silhouette IS the vehicle).
const NODE_LABELS: Record<Role, string> = {
  vehicle: STRINGS.editor.nodeVehicle,
  solar: STRINGS.energy.nodes.solar,
  powerwall: STRINGS.energy.nodes.powerwall,
  grid: STRINGS.energy.nodes.grid,
  home: STRINGS.energy.nodes.home,
  wall_connector: STRINGS.energy.nodes.wall_connector,
};

/** True iff `a` is the same roles in the same order as `b`. */
function rolesEqual(a: readonly Role[], b: readonly Role[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

/**
 * The order the editor displays (and the card draws, per Story 9.3): the
 * configured `order` entries — valid, de-duplicated, in listed order — followed
 * by the remaining `ROLES` in canonical order. Unknown/absent entries are
 * ignored, mirroring the render-side stable partition so the editor preview
 * matches the Scene.
 */
function orderedRoles(order: readonly Role[] | undefined): Role[] {
  const listed: Role[] = [];
  const seen = new Set<Role>();
  for (const r of order ?? []) {
    if (ROLES.includes(r) && !seen.has(r)) {
      listed.push(r);
      seen.add(r);
    }
  }
  return [...listed, ...ROLES.filter((r) => !seen.has(r))];
}

@customElement('tesla-card-editor')
export class TeslaCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config!: TeslaCardConfig;

  public setConfig(config: TeslaCardConfig): void {
    // Forward-compatible like the card's `setConfig` (Story 7.1): spread preserves
    // UNKNOWN/future keys, so editing a config carrying a field this build doesn't
    // know round-trips through `config-changed` without silently dropping it. The
    // editor never enumerate-rejects keys.
    this._config = { ...config };
  }

  // Commit a WHOLE config as the new state and notify HA. The caller owns the
  // shape — so a removal (a copy with a key deleted) actually propagates, unlike
  // a merge which can only add/override. Unknown/future keys live on whatever
  // copy the caller passes, so they round-trip intact.
  private _emit(config: TeslaCardConfig): void {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Add/override a key — correct for bool toggles + the panel select, which only
  // ever SET a value (a `false`/explicit panel is harmless to carry).
  private _patch(patch: Partial<TeslaCardConfig>): void {
    this._emit({ ...this._config, ...patch });
  }

  private _text(e: Event, key: 'name' | 'image'): void {
    const v = (e.target as HTMLInputElement).value.trim();
    // Build the full next config and REPLACE (via `_emit`), not merge: clearing a
    // field deletes its key, and a merge (`_patch`) would re-add it from the old
    // `_config` (omission ≠ override). The `{ ...this._config }` copy preserves
    // unknown/future keys, so replacement stays forward-compatible.
    const next = { ...this._config };
    if (v) next[key] = v;
    else delete next[key];
    this._emit(next);
  }

  private _bool(key: 'hide_quick_actions' | 'hide_panels' | 'hide_commands', e: Event): void {
    this._patch({ [key]: (e.target as HTMLInputElement).checked });
  }

  // ── My-Home Scene node customization (Story 9.4) ─────────────────────────────
  // Single immutable update primitive shared by the hide-toggle and order paths.
  // Clones `energy.nodes` (preserving `instances`/unknown sub-keys), applies the
  // caller's mutation, then PRUNES so an unconfigured Scene serializes to today's
  // config byte-for-byte (AC3 / SM-C4): an emptied `hide`, an empty/canonical
  // `order`, an emptied `nodes`, and an emptied `energy` are each DELETED — never
  // persisted as an empty value. Uses `_emit` (whole-config replace) because a
  // merge can't delete. The `{ ...c }`/`{ ...energy }` copies keep unknown
  // top-level + energy keys intact (the Story 7.2 spread-copy contract).
  private _commitNodes(mutate: (nodes: NodeCustomization) => void): void {
    const c = this._config;
    const nodes: NodeCustomization = { ...(c.energy?.nodes ?? {}) };
    if (nodes.hide) nodes.hide = [...nodes.hide];
    if (nodes.order) nodes.order = [...nodes.order];
    mutate(nodes);

    if (nodes.hide && nodes.hide.length === 0) delete nodes.hide;
    if (nodes.order && (nodes.order.length === 0 || rolesEqual(nodes.order, ROLES)))
      delete nodes.order;

    const next: TeslaCardConfig = { ...c };
    const energy = { ...(c.energy ?? {}) };
    // Keep `nodes` iff anything survives the prune — `Object.keys` (not an
    // enumerated hide/order/instances check) so an unknown/future `nodes`
    // sub-key round-trips, matching the `energy`-level forward-compat prune below.
    if (Object.keys(nodes).length > 0) energy.nodes = nodes;
    else delete energy.nodes;
    if (Object.keys(energy).length > 0) next.energy = energy;
    else delete next.energy;
    this._emit(next);
  }

  /** A node is hidden when it appears in `energy.nodes.hide`. */
  private _isHidden(role: Role): boolean {
    return (this._config.energy?.nodes?.hide ?? []).includes(role);
  }

  // Show/hide toggle: checked = visible, so a `change` flips membership in `hide`.
  // The `hide` list is rebuilt in canonical `ROLES` order for a deterministic,
  // zero-diff serialization regardless of click order.
  private _toggleNode(role: Role): void {
    this._commitNodes((nodes) => {
      const hidden = new Set(nodes.hide ?? []);
      if (hidden.has(role)) hidden.delete(role);
      else hidden.add(role);
      nodes.hide = ROLES.filter((r) => hidden.has(r));
    });
  }

  // Move a node one step earlier/later in the displayed order, emitting the full
  // six-node order. `_commitNodes` deletes it if the swap restores canonical order.
  private _moveNode(role: Role, dir: -1 | 1): void {
    const current = orderedRoles(this._config.energy?.nodes?.order);
    const i = current.indexOf(role);
    const j = i + dir;
    if (j < 0 || j >= current.length) return; // no-op at the edges
    const nextOrder = [...current];
    [nextOrder[i], nextOrder[j]] = [nextOrder[j], nextOrder[i]];
    this._commitNodes((nodes) => {
      nodes.order = nextOrder;
    });
  }

  // Inline monoline mdi icon (path from `@mdi/js`), `fill: currentColor` — matches
  // the `ui.ts` `icon()` pattern; kept local so the editor pulls no extra module.
  private _icon(path: string): TemplateResult {
    return html`<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d=${path}></path>
    </svg>`;
  }

  // The "My Home Scene cards" group: a per-node show/hide checkbox column plus an
  // ordered move-up/down list. Reads only the static `ROLES` vocabulary + the
  // config (no `hass.states`, AR-1). Mirrors the existing hide-toggle family (AC2).
  private _renderSceneNodes(): TemplateResult {
    const ordered = orderedRoles(this._config.energy?.nodes?.order);
    return html`
      <div class="group" role="group" aria-label=${STRINGS.editor.sceneNodesHeading}>
        <span class="group-heading">${STRINGS.editor.sceneNodesHeading}</span>
        <span class="hint">${STRINGS.editor.sceneNodesShowHint}</span>
        ${ROLES.map(
          (role) => html`
            <label class="check">
              <input
                type="checkbox"
                .checked=${!this._isHidden(role)}
                @change=${() => this._toggleNode(role)}
              />
              <span>${NODE_LABELS[role]}</span>
            </label>
          `
        )}
        <span class="group-heading">${STRINGS.editor.sceneNodesOrderHeading}</span>
        <span class="hint">${STRINGS.editor.sceneNodesOrderHint}</span>
        ${ordered.map(
          (role, i) => html`
            <div class="node-row">
              <span class="node-name">${NODE_LABELS[role]}</span>
              <button
                type="button"
                class="move"
                aria-label=${`${STRINGS.editor.moveNodeUp}: ${NODE_LABELS[role]}`}
                ?disabled=${i === 0}
                @click=${() => this._moveNode(role, -1)}
              >
                ${this._icon(mdiChevronUp)}
              </button>
              <button
                type="button"
                class="move"
                aria-label=${`${STRINGS.editor.moveNodeDown}: ${NODE_LABELS[role]}`}
                ?disabled=${i === ordered.length - 1}
                @click=${() => this._moveNode(role, 1)}
              >
                ${this._icon(mdiChevronDown)}
              </button>
            </div>
          `
        )}
      </div>
    `;
  }

  protected override render(): TemplateResult {
    if (!this._config) return html``;
    const c = this._config;
    return html`
      <div class="form">
        <label class="field">
          <span>${STRINGS.editor.vehicleName}</span>
          <input
            type="text"
            .value=${c.name ?? ''}
            placeholder=${STRINGS.editor.namePlaceholder}
            @change=${(e: Event) => this._text(e, 'name')}
          />
        </label>

        <label class="field">
          <span>${STRINGS.editor.imageUrl}</span>
          <input
            type="text"
            .value=${c.image ?? ''}
            placeholder=${STRINGS.editor.imagePlaceholder}
            @change=${(e: Event) => this._text(e, 'image')}
          />
        </label>

        <label class="field">
          <span>${STRINGS.editor.defaultPanel}</span>
          <select
            .value=${c.default_panel ?? 'charging'}
            @change=${(e: Event) =>
              this._patch({ default_panel: (e.target as HTMLSelectElement).value as PanelId })}
          >
            ${PANELS.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
          </select>
        </label>

        <label class="check">
          <input
            type="checkbox"
            .checked=${!!c.hide_quick_actions}
            @change=${(e: Event) => this._bool('hide_quick_actions', e)}
          />
          <span>${STRINGS.editor.hideQuickActions}</span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            .checked=${!!c.hide_panels}
            @change=${(e: Event) => this._bool('hide_panels', e)}
          />
          <span>${STRINGS.editor.hidePanels}</span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            .checked=${!!c.hide_commands}
            @change=${(e: Event) => this._bool('hide_commands', e)}
          />
          <span>${STRINGS.editor.hideCommands}</span>
        </label>

        ${this._renderSceneNodes()}

        <p class="note">
          ${STRINGS.editor.noteBefore}
          <code>entities:</code> ${STRINGS.editor.noteAfter}
        </p>
      </div>
    `;
  }

  static override styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 4px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color, #e1e1e1);
    }
    input[type='text'],
    select {
      padding: 9px 11px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      background: var(--card-background-color, rgba(127, 127, 127, 0.08));
      color: var(--primary-text-color, inherit);
      font-family: inherit;
      font-size: 14px;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color, #e1e1e1);
      cursor: pointer;
    }
    .check input {
      width: 18px;
      height: 18px;
      /* ≥44px keyboard/touch hit target without enlarging the visual control */
      margin: 13px;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .group-heading {
      font-size: 13px;
      font-weight: 700;
      color: var(--primary-text-color, #e1e1e1);
    }
    .group-heading:not(:first-child) {
      margin-top: 6px;
    }
    .hint {
      font-size: 12px;
      line-height: 1.45;
      color: var(--secondary-text-color, #9aa7b8);
    }
    .node-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color, #e1e1e1);
    }
    .node-name {
      flex: 1;
    }
    .move {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      /* ≥44×44 hit target (AC5), keyboard-operable native button, no motion */
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      background: var(--card-background-color, rgba(127, 127, 127, 0.08));
      color: var(--primary-text-color, inherit);
      cursor: pointer;
    }
    .move:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .move .ico {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
    .note {
      margin: 4px 0 0;
      font-size: 12px;
      line-height: 1.45;
      color: var(--secondary-text-color, #9aa7b8);
    }
    code {
      font-family: ui-monospace, monospace;
      background: rgba(127, 127, 127, 0.18);
      padding: 1px 5px;
      border-radius: 4px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'tesla-card-editor': TeslaCardEditor;
  }
}
