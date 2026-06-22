import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { mdiChevronUp, mdiChevronDown } from '@mdi/js';
import type {
  HomeAssistant,
  TeslaCardConfig,
  LovelaceCardEditor,
  PanelId,
  NodeCustomization,
  SceneRow,
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

// Display name for each of the seven Scene nodes (Stories 9.4 + 9.14). The six
// energy roles reuse the existing `STRINGS.energy.nodes.*` chip labels (single-
// sourced, not duplicated); `vehicle` is editor-owned because `STRINGS.energy.nodes`
// has no `vehicle` key (the Hero silhouette IS the vehicle).
const NODE_LABELS: Record<Role, string> = {
  vehicle: STRINGS.editor.nodeVehicle,
  solar: STRINGS.energy.nodes.solar,
  powerwall: STRINGS.energy.nodes.powerwall,
  grid: STRINGS.energy.nodes.grid,
  home: STRINGS.energy.nodes.home,
  wall_connector: STRINGS.energy.nodes.wall_connector,
  generator: STRINGS.energy.nodes.generator,
};

/** True iff `a` is the same roles in the same order as `b`. */
function rolesEqual(a: readonly Role[], b: readonly Role[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

// The editor mirrors the card's row model (`my-home.ts` SOURCE_ROW /
// LOAD_ROW_WITH_VEHICLE / SCENE_ROW_ORDER) so its grouped preview AND the `order`
// it emits match what the Scene renders. NOTE: hand-duplicated, not typecheck-bound
// to the card — see deferred-work.md (SOURCE_ROLES parity). `SCENE_ROW_ORDER` is the
// canonical (default) Scene sequence: every source role, then every load role + the
// synthetic `vehicle` cell (trailing, so a defaulted order keeps the car last).
const SOURCE_ROLES: readonly Role[] = ['solar', 'powerwall', 'grid', 'generator'];
const LOAD_ROLES: readonly Role[] = ['home', 'wall_connector', 'vehicle'];
const SCENE_ROW_ORDER: readonly Role[] = [...SOURCE_ROLES, ...LOAD_ROLES];
const canonicalRow = (role: Role): SceneRow => (SOURCE_ROLES.includes(role) ? 'source' : 'load');

// A role's EFFECTIVE row: a valid `'source'`/`'load'` override wins, anything else
// (absent / invalid / a garbage non-object `rows`) falls through to canonical — the
// same defensive read as the card's `_rowOf` (FR-24). `rows` is read as a loose record
// so a garbage value can't throw.
function effectiveRow(role: Role, rows: NodeCustomization['rows']): SceneRow {
  const v = (rows as Record<string, unknown> | undefined)?.[role];
  return v === 'source' || v === 'load' ? v : canonicalRow(role);
}

// The flat `order` an UNCONFIGURED order yields for the given row overrides: each
// effective row's members in canonical Scene sequence, sources then loads. The
// zero-diff prune (SM-C4) compares the emitted order against THIS — so a row-grouped
// no-op reorder, and a promotion's re-grouped order, both serialize byte-for-byte.
function canonicalOrder(rows: NodeCustomization['rows']): Role[] {
  return [
    ...SCENE_ROW_ORDER.filter((r) => effectiveRow(r, rows) === 'source'),
    ...SCENE_ROW_ORDER.filter((r) => effectiveRow(r, rows) === 'load'),
  ];
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
    // Clone ONLY well-formed containers. A garbage string/number `hide`/`order`/`rows`
    // (FR-24: tolerated and never consumed by the card) must NOT be spread — `[...'nope']`
    // / `{ ...'nope' }` would persist a corrupted char-indexed value on an unrelated edit,
    // and `[...42]` throws. Leave a malformed sibling byte-identical so it round-trips.
    if (Array.isArray(nodes.hide)) nodes.hide = [...nodes.hide];
    if (Array.isArray(nodes.order)) nodes.order = [...nodes.order];
    if (nodes.rows && typeof nodes.rows === 'object' && !Array.isArray(nodes.rows))
      nodes.rows = { ...nodes.rows };
    mutate(nodes);

    if (Array.isArray(nodes.hide) && nodes.hide.length === 0) delete nodes.hide;
    // Prune `order` when it is the no-op default for the CURRENT row overrides — compared
    // against the EFFECTIVE canonical sequence (not registry `ROLES`), so a row-grouped
    // reorder restored to default, and a promotion's re-grouped order, both prune to
    // zero-diff (SM-C4).
    if (
      Array.isArray(nodes.order) &&
      (nodes.order.length === 0 || rolesEqual(nodes.order, canonicalOrder(nodes.rows)))
    )
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

  /**
   * A node is hidden when it appears in `energy.nodes.hide`. Reads defensively
   * (`Array.isArray`, mirroring the card's `_hiddenRoles`): a non-array `hide`
   * (FR-24 garbage / future build) degrades to "nothing hidden" — never a `.includes`
   * throw, and a string `hide` never substring-matches a role.
   */
  private _isHidden(role: Role): boolean {
    const hide = this._config.energy?.nodes?.hide;
    return Array.isArray(hide) && hide.includes(role);
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

  // Move a node one step earlier/later WITHIN its effective row, emitting the full
  // row-grouped order (sources ++ loads). Gated at the row's edges (not the flat list),
  // so a move never crosses the source/load boundary — promotion is the row selector's
  // job. `_commitNodes` deletes `order` if the result restores the canonical sequence.
  private _moveNode(role: Role, dir: -1 | 1): void {
    const row = this._nodeRow(role);
    const within = this._rowOrder(row);
    const i = within.indexOf(role);
    const j = i + dir;
    if (j < 0 || j >= within.length) return; // no-op at the row edges
    [within[i], within[j]] = [within[j], within[i]];
    const source = row === 'source' ? within : this._rowOrder('source');
    const load = row === 'load' ? within : this._rowOrder('load');
    this._commitNodes((nodes) => {
      nodes.order = [...source, ...load];
    });
  }

  // Story 9.15 — the node's EFFECTIVE row from `energy.nodes.rows`, defensively read
  // (FR-24, mirrors `_isHidden`): a valid `'source'`/`'load'` override wins, anything
  // else (absent / invalid / garbage) falls through to the role's canonical row. Drives
  // the row selector's selected value, matching the card's `_rowOf` classifier.
  private _nodeRow(role: Role): SceneRow {
    return effectiveRow(role, this._config.energy?.nodes?.rows);
  }

  /**
   * The display (and emitted) order for one effective row: the configured `order`
   * entries whose effective row is `row` (valid, de-duplicated, first-occurrence
   * wins), then that row's remaining canonical members in Scene sequence. Mirrors
   * the card's per-row `orderRow` (`my-home.ts`) so the grouped preview matches the
   * Scene. Reads `order` defensively (`Array.isArray`) — a garbage `order` degrades
   * to canonical (FR-24), never throws, exactly as the card's `_orderList` tolerates.
   */
  private _rowOrder(row: SceneRow): Role[] {
    const order = this._config.energy?.nodes?.order;
    const listed: Role[] = [];
    const seen = new Set<Role>();
    for (const r of Array.isArray(order) ? order : []) {
      if (ROLES.includes(r) && this._nodeRow(r) === row && !seen.has(r)) {
        listed.push(r);
        seen.add(r);
      }
    }
    const rest = SCENE_ROW_ORDER.filter((r) => this._nodeRow(r) === row && !seen.has(r));
    return [...listed, ...rest];
  }

  // Promote a node to the chosen row (Story 9.15). Commits through `_commitNodes` with a
  // DELETE-ON-CANONICAL prune: a `rows[role]` equal to the role's canonical row (or an
  // emptied `rows` map) is removed, so a defaulted node serializes byte-identically
  // (SM-C4). The `Object.keys(nodes).length` prune then drops an emptied `nodes`/`energy`.
  private _setNodeRow(role: Role, row: SceneRow): void {
    this._commitNodes((nodes) => {
      const rows = { ...(nodes.rows ?? {}) };
      if (row === canonicalRow(role)) delete rows[role];
      else rows[role] = row;
      if (Object.keys(rows).length > 0) nodes.rows = rows;
      else delete nodes.rows;
    });
  }

  // Inline monoline mdi icon (path from `@mdi/js`), `fill: currentColor` — matches
  // the `ui.ts` `icon()` pattern; kept local so the editor pulls no extra module.
  private _icon(path: string): TemplateResult {
    return html`<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d=${path}></path>
    </svg>`;
  }

  // One node-row: a show/hide checkbox, the node name, the Source/Load promotion
  // select (Story 9.15), and move-earlier/later buttons gated at the node's OWN row
  // edges (`i`/`within` scope the gating to this effective row, so a move never crosses
  // the source/load boundary). The checkbox carries its own accessible name (the visible
  // label sits in the sibling `.node-name`).
  private _renderNodeRow(role: Role, i: number, within: readonly Role[]): TemplateResult {
    return html`
      <div class="node-row">
        <label class="check node-check">
          <input
            type="checkbox"
            aria-label=${NODE_LABELS[role]}
            .checked=${!this._isHidden(role)}
            @change=${() => this._toggleNode(role)}
          />
        </label>
        <span class="node-name">${NODE_LABELS[role]}</span>
        <select
          class="row-select"
          aria-label=${`${STRINGS.editor.sceneNodesRowLabel}: ${NODE_LABELS[role]}`}
          .value=${this._nodeRow(role)}
          @change=${(e: Event) =>
            this._setNodeRow(role, (e.target as HTMLSelectElement).value as SceneRow)}
        >
          <option value="source">${STRINGS.editor.rowSource}</option>
          <option value="load">${STRINGS.editor.rowLoad}</option>
        </select>
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
          ?disabled=${i === within.length - 1}
          @click=${() => this._moveNode(role, 1)}
        >
          ${this._icon(mdiChevronDown)}
        </button>
      </div>
    `;
  }

  // One row group (Sources / Loads): a sub-heading + the row's present-order nodes.
  private _renderRowGroup(row: SceneRow, heading: string): TemplateResult {
    const within = this._rowOrder(row);
    return html`
      <span class="group-heading">${heading}</span>
      ${within.map((role, i) => this._renderNodeRow(role, i, within))}
    `;
  }

  // The "My Home Scene cards" group: two row-grouped sub-lists (Sources, then Loads),
  // each carrying its nodes' show/hide + Source/Load + move-within-row controls. The
  // grouping mirrors the card's two-row Scene so the preview matches what renders.
  // Reads only the static `ROLES` vocabulary + the config (no `hass.states`, AR-1).
  private _renderSceneNodes(): TemplateResult {
    return html`
      <div class="group" role="group" aria-label=${STRINGS.editor.sceneNodesHeading}>
        <span class="group-heading">${STRINGS.editor.sceneNodesHeading}</span>
        <span class="hint">${STRINGS.editor.sceneNodesShowHint}</span>
        <span class="hint">${STRINGS.editor.sceneNodesOrderHint}</span>
        ${this._renderRowGroup('source', STRINGS.editor.rowSource)}
        ${this._renderRowGroup('load', STRINGS.editor.rowLoad)}
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
    /* Story 9.15 — the per-node Source/Load row selector, sized to sit inline with the
       move buttons without stealing the node-name's flex room. */
    .row-select {
      min-height: 44px;
      padding: 0 8px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      background: var(--card-background-color, rgba(127, 127, 127, 0.08));
      color: var(--primary-text-color, inherit);
      font-family: inherit;
      font-size: 13px;
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
