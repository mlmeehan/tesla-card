import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import {
  mdiChevronUp,
  mdiChevronDown,
  mdiCheck,
  mdiCheckCircle,
  mdiAlertCircleOutline,
  mdiAutoFix,
} from '@mdi/js';
import type {
  HomeAssistant,
  TeslaCardConfig,
  LovelaceCardEditor,
  PanelId,
  NodeCustomization,
  SceneRow,
} from './types';
import { ROLES, type Role } from './data/registry';
import { resolveEntities } from './data/resolve';
import { resolveEnergyEntities, stateById } from './data/energy';
import { UNAVAILABLE_STATES } from './helpers';
import { STRINGS } from './strings';

// ── Guided first-run wizard (Story 9.9) ───────────────────────────────────────
// The five steps, in order. `label` is the stepper node copy; `skipDefault` is the
// honest sentence the footer's Skip announces (never a bare "Skip"). The deep
// per-step CONTENT is owned by siblings (Confirm→9.11, Appearance→9.12, Tune→9.13);
// this list is the frame's spine.
type StepKey = 'detect' | 'confirm' | 'appearance' | 'tune' | 'finish';
const WIZARD_STEPS: { key: StepKey; label: string; skipDefault: string }[] = [
  { key: 'detect', label: STRINGS.wizard.steps.detect, skipDefault: STRINGS.wizard.detect.skipDefault },
  { key: 'confirm', label: STRINGS.wizard.steps.confirm, skipDefault: STRINGS.wizard.confirm.skipDefault },
  { key: 'appearance', label: STRINGS.wizard.steps.appearance, skipDefault: STRINGS.wizard.appearance.skipDefault },
  { key: 'tune', label: STRINGS.wizard.steps.tune, skipDefault: STRINGS.wizard.tune.skipDefault },
  { key: 'finish', label: STRINGS.wizard.steps.finish, skipDefault: STRINGS.wizard.finish.skipDefault },
];
const FINISH_STEP = WIZARD_STEPS.length - 1;

/** A node's honest three-state discovery result (CAP-4 / AC2). */
type DiscoState = 'online' | 'unavailable' | 'absent';

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

  // ── Guided first-run wizard (Story 9.9) ─────────────────────────────────────
  // Current wizard step (0–4). Within-session navigation lives here; the cross-
  // session resume STEP is derived from the persisted Lovelace config (never browser
  // state) on first paint — see `_initResume` (run in `willUpdate`, AR-15).
  @state() private _step = 0;
  // "Run guided setup" re-entry: an EXPLICIT re-run from the normal form, distinct
  // from the bare-config auto-trigger. Set true ⇒ render the wizard even on a
  // completed config (the `setup_complete` marker is NOT cleared — re-running is
  // explicit, AC6). Cleared when the wizard completes.
  @state() private _wizardOverride = false;
  // One-shot guard so the resume step is derived ONCE (from the first config we see),
  // not reset when HA echoes our own `config-changed` back through `setConfig`.
  private _resumed = false;

  protected override willUpdate(changed: Map<string, unknown>): void {
    // Derive the resume step from the persisted config the first time we hold one
    // (AR-15: resolution in willUpdate, never render()). Detect persists
    // `setup_complete: false`, so a refresh/reopen resumes PAST Detect at Confirm;
    // a fresh bare stub starts at Detect. The stub steps (Confirm/Appearance/Tune)
    // write zero-diff defaults so they persist no distinguishing key — finer per-step
    // resume across them lands with 9.11/9.12/9.13. (The pre-any-input first paint is
    // the one non-resumable moment — HA discards an unsaved brand-new card on a hard
    // refresh, AC6 build note.)
    if (!this._resumed && this._config && changed.has('_config')) {
      this._resumed = true;
      if (!this._wizardOverride) this._step = this._config.setup_complete === false ? 1 : 0;
    }
  }

  // True iff the config is a bare stub — only `type` (+ the wizard marker), no
  // user-set keys. A bare stub auto-opens the wizard; a pre-existing user config
  // (name/paint/entities/…) opens the normal form (the wizard never hijacks it).
  private _isBareConfig(c: TeslaCardConfig): boolean {
    return Object.keys(c).every((k) => k === 'type' || k === 'setup_complete');
  }

  // Whether the wizard owns this render. `true` ⇒ finished, normal form forever
  // (until an explicit re-run). `false` ⇒ in progress (resume). Absent ⇒ auto-open
  // only for a bare stub. An explicit "Run guided setup" override always wins.
  private get _wizardActive(): boolean {
    if (this._wizardOverride) return true;
    const c = this._config;
    if (c.setup_complete === true) return false;
    if (c.setup_complete === false) return true;
    return this._isBareConfig(c);
  }

  // Advance from the current step (shared by Next AND Skip — a skipped stub step
  // applies its zero-diff sensible default, so both just move on). Leaving Detect
  // persists the in-progress marker so a refresh resumes the wizard rather than
  // restarting (AC6). No-op past the last step.
  private _advance = (): void => {
    if (this._step === 0 && this._config.setup_complete === undefined) {
      this._patch({ setup_complete: false });
    }
    if (this._step < FINISH_STEP) this._step += 1;
  };

  private _back = (): void => {
    if (this._step > 0) this._step -= 1;
  };

  // Complete: write the COMPLETE, forward-compatible config (spread preserves
  // unknown/future keys — R9) with the marker set, and drop any re-entry override.
  // The skipped steps' sensible defaults are zero-diff (the card's own runtime
  // defaults), so completion adds only the marker. Shared by "Done." and "Finish now".
  private _complete = (): void => {
    this._wizardOverride = false;
    this._emit({ ...this._config, setup_complete: true });
  };

  // Empty-discovery escape: route into the Step-2 mapping (the manual fallback).
  private _selectManually = (): void => {
    this._advance();
  };

  // Explicit re-entry from the normal form. Restart at Detect; the marker stays put.
  private _runGuidedSetup = (): void => {
    this._resumed = true;
    this._step = 0;
    this._wizardOverride = true;
  };

  // Honest reachability probe (AC2 three-state). Routes the read through `data/`
  // (`stateById` → freshness reader) — NEVER a bare `editor.ts` hass.states lookup
  // (AR-1). An id absent from hass ⇒ `absent` (— not found); a present-but-
  // unavailable/unknown state ⇒ `unavailable` (⚠); else `online` (✓).
  private _probe(id?: string): DiscoState {
    const raw = stateById(this.hass, id);
    if (raw === undefined) return 'absent';
    return UNAVAILABLE_STATES.includes(raw) ? 'unavailable' : 'online';
  }

  // Discover every Scene role's three-state status via the EXISTING boundary-safe
  // resolvers (vehicle → `resolveEntities`, energy products → `resolveEnergyEntities`),
  // exactly as `getStubConfig` probes — the entity reads happen inside `src/data/`
  // (AR-1). No hard-coded entity ids: the probe ids come from the registry-keyed
  // resolvers. (The dialect-ambiguity summary + the formal AR-1 boundary-decision-log
  // entry are Story 9.10's; 9.9 consumes the existing boundary-safe path.)
  private _discovery(): { role: Role; state: DiscoState }[] {
    const c = this._config;
    const vehicle = resolveEntities(this.hass, c);
    const energy = resolveEnergyEntities(this.hass, c);
    const idFor: Record<Role, string | undefined> = {
      vehicle: vehicle.status ?? vehicle.battery_level,
      solar: energy.solar_power,
      powerwall: energy.battery_power,
      grid: energy.grid_power,
      home: energy.load_power,
      wall_connector: energy.wc_power,
      generator: energy.generator_power,
    };
    return ROLES.map((role) => ({ role, state: this._probe(idFor[role]) }));
  }

  private _discoStateWord(s: DiscoState): string {
    return s === 'online'
      ? STRINGS.wizard.detect.online
      : s === 'unavailable'
        ? STRINGS.wizard.detect.unavailable
        : STRINGS.wizard.detect.notFound;
  }

  // The advancing 5-node labelled stepper (the biggest reconcile fix — NEVER the
  // mocks' static "DETECT" header). State by COLOUR AND SHAPE (current = blue filled
  // number, done = green tick, future = dim hollow number), and announced non-visually
  // ("Step 2 of 5, Confirm, current") so a reader never relies on hue.
  private _renderStepper(): TemplateResult {
    return html`
      <ol class="stepper" role="list" aria-label=${STRINGS.wizard.title}>
        ${WIZARD_STEPS.map((s, i) => {
          const cls = i === this._step ? 'current' : i < this._step ? 'done' : 'future';
          const word =
            i === this._step
              ? STRINGS.wizard.stateCurrent
              : i < this._step
                ? STRINGS.wizard.stateDone
                : STRINGS.wizard.stateNotStarted;
          const aria = `${STRINGS.wizard.stepWord} ${i + 1} ${STRINGS.wizard.of} ${WIZARD_STEPS.length}, ${s.label}, ${word}`;
          return html`
            <li
              class="step ${cls}"
              aria-current=${i === this._step ? 'step' : nothing}
              aria-label=${aria}
            >
              <span class="step-mark" aria-hidden="true">
                ${i < this._step
                  ? this._icon(mdiCheck)
                  : html`<span class="step-num">${i + 1}</span>`}
              </span>
              <span class="step-label" aria-hidden="true">${s.label}</span>
            </li>
          `;
        })}
      </ol>
    `;
  }

  // Step 1 — Detect & discover (AC2). Found ⇒ the three-state list; empty/fail ⇒ a
  // calm honest message + the manual-selection fallback (never a fake "all set",
  // never an endless spinner). The empty body is a labelled live region.
  private _renderDetect(): TemplateResult {
    const disco = this._discovery();
    const empty = disco.every((d) => d.state === 'absent');
    if (empty) {
      return html`
        <div class="wiz-empty" role="status" aria-label=${STRINGS.wizard.detect.emptyTitle}>
          <span class="wiz-h">${STRINGS.wizard.detect.emptyTitle}</span>
          <span class="wiz-sub">${STRINGS.wizard.detect.emptyBody}</span>
          <button type="button" class="wiz-btn primary" @click=${this._selectManually}>
            ${STRINGS.wizard.detect.selectManually}
          </button>
        </div>
      `;
    }
    return html`
      <span class="wiz-h">${STRINGS.wizard.detect.heading}</span>
      <span class="wiz-sub">${STRINGS.wizard.detect.subhead}</span>
      <ul class="disco" role="list">
        ${disco.map(
          ({ role, state }) => html`
            <li class="disco-row ${state}" aria-label=${`${NODE_LABELS[role]}, ${this._discoStateWord(state)}`}>
              <span class="disco-mark" aria-hidden="true">
                ${state === 'online'
                  ? this._icon(mdiCheckCircle)
                  : state === 'unavailable'
                    ? this._icon(mdiAlertCircleOutline)
                    : html`<span class="disco-dash">—</span>`}
              </span>
              <span class="disco-name" aria-hidden="true">${NODE_LABELS[role]}</span>
              <span class="disco-state" aria-hidden="true">${this._discoStateWord(state)}</span>
            </li>
          `
        )}
      </ul>
    `;
  }

  // Steps 2/3/4 — skippable containers the siblings enrich (Confirm→9.11,
  // Appearance→9.12, Tune→9.13). Each renders a heading + subhead now so the wizard
  // flows end-to-end; the footer's Skip applies the (zero-diff) sensible default.
  private _renderStub(heading: string, subhead: string): TemplateResult {
    return html`
      <span class="wiz-h">${heading}</span>
      <span class="wiz-sub">${subhead}</span>
    `;
  }

  // Step 5 — Finish (AC3). An honest confirmation of the card that will be created —
  // NO confetti, NO "Success!", and NO fabricated telemetry (the live generic-EV hero
  // preview is Story 9.12's seam; this frame never invents SoC/range, honouring the
  // card's freshness discipline by construction). "Done." commits the complete config.
  private _renderFinish(): TemplateResult {
    const name = this._config.name?.trim() || STRINGS.hero.defaultName;
    return html`
      <span class="wiz-h">${STRINGS.wizard.finish.heading}</span>
      <span class="wiz-sub">${STRINGS.wizard.finish.subhead}</span>
      <div class="wiz-result" aria-label=${name}>
        <span class="wiz-result-name">${name}</span>
      </div>
    `;
  }

  private _renderStepBody(): TemplateResult {
    switch (WIZARD_STEPS[this._step].key) {
      case 'detect':
        return this._renderDetect();
      case 'confirm':
        return this._renderStub(STRINGS.wizard.confirm.heading, STRINGS.wizard.confirm.subhead);
      case 'appearance':
        return this._renderStub(
          STRINGS.wizard.appearance.heading,
          STRINGS.wizard.appearance.subhead
        );
      case 'tune':
        return this._renderStub(STRINGS.wizard.tune.heading, STRINGS.wizard.tune.subhead);
      case 'finish':
        return this._renderFinish();
    }
  }

  // Footer: Back · Skip · Next (primary, the single emphatic control) + persistent
  // "Finish now". On Finish the primary is "Done." (distinct from "Finish now"). On
  // the empty-discovery state the primary Next is DISABLED (the body's
  // "Select entities manually" is the way forward). Focus order Back→Skip→Next→Finish.
  private _renderFooter(nextDisabled: boolean): TemplateResult {
    const isFinish = this._step === FINISH_STEP;
    const skipDefault = WIZARD_STEPS[this._step].skipDefault;
    return html`
      <div class="wiz-footer">
        <button
          type="button"
          class="wiz-btn tertiary"
          ?disabled=${this._step === 0}
          @click=${this._back}
        >
          ${STRINGS.wizard.back}
        </button>
        ${isFinish
          ? nothing
          : html`
              <button
                type="button"
                class="wiz-btn secondary"
                aria-label=${`${STRINGS.wizard.skipPrefix} — ${skipDefault}`}
                @click=${this._advance}
              >
                ${STRINGS.wizard.skip}
              </button>
            `}
        ${isFinish
          ? html`<button type="button" class="wiz-btn primary" @click=${this._complete}>
              ${STRINGS.wizard.done}
            </button>`
          : html`<button
              type="button"
              class="wiz-btn primary"
              ?disabled=${nextDisabled}
              @click=${this._advance}
            >
              ${STRINGS.wizard.next}
            </button>`}
        <button type="button" class="wiz-btn quiet finish-now" @click=${this._complete}>
          ${STRINGS.wizard.finishNow}
        </button>
      </div>
    `;
  }

  private _renderWizard(): TemplateResult {
    // Next is gated only on the Detect EMPTY/fail state (nothing found): there is
    // nothing to confirm, so the user must take the manual route.
    const nextDisabled =
      this._step === 0 && this._discovery().every((d) => d.state === 'absent');
    return html`
      <div class="wizard" role="dialog" aria-label=${STRINGS.wizard.title}>
        ${this._renderStepper()}
        ${keyed(this._step, html`<div class="wiz-body">${this._renderStepBody()}</div>`)}
        ${this._renderFooter(nextDisabled)}
        <span class="wiz-disclaimer">${STRINGS.wizard.disclaimer}</span>
      </div>
    `;
  }

  protected override render(): TemplateResult {
    if (!this._config) return html``;
    return this._wizardActive ? this._renderWizard() : this._renderNormalForm();
  }

  private _renderNormalForm(): TemplateResult {
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

        <button type="button" class="run-setup" @click=${this._runGuidedSetup}>
          ${this._icon(mdiAutoFix)}
          <span>${STRINGS.editor.runGuidedSetup}</span>
        </button>
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

    /* ── Guided first-run wizard (Story 9.9) ──────────────────────────────────
       Built against the canonical --tc-* tokens (DESIGN.md), NOT the mocks' M3
       palette; HA theme tokens supply the fallbacks so the shell reads correctly
       inside the card-config dialog. Every control clears ≥44px (AC5). */
    .run-setup {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      align-self: flex-start;
      min-height: 44px;
      margin-top: 2px;
      padding: 0 14px;
      border-radius: var(--tc-radius-md, 12px);
      border: 1px solid var(--tc-border, var(--divider-color, rgba(127, 127, 127, 0.3)));
      background: var(--tc-surface, var(--card-background-color, rgba(127, 127, 127, 0.08)));
      color: var(--primary-text-color, inherit);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .run-setup .ico {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    /* Dialog shell — full takeover of HA's card-config dialog. */
    .wizard {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: min(90vw, 580px);
      max-width: 100%;
      padding: 18px;
      border-radius: var(--tc-radius-xl, 28px);
      background: var(--tc-surface, var(--card-background-color, rgba(127, 127, 127, 0.06)));
      color: var(--primary-text-color, #e1e1e1);
      box-sizing: border-box;
    }
    /* The advancing 5-node stepper — state by COLOUR AND SHAPE. */
    .stepper {
      display: flex;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .step {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .step-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 13px;
      font-weight: 700;
    }
    .step-mark .ico {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    /* future = dim HOLLOW (dashed) circle (shape ≠ current/done) */
    .step.future .step-mark {
      border: 1px dashed var(--tc-text-dim, #9aa7b8);
      color: var(--tc-text-dim, #9aa7b8);
    }
    /* current = blue FILLED circle */
    .step.current .step-mark {
      background: var(--tc-blue, #38bdf8);
      color: #0b1220;
    }
    /* done = green circle with a TICK glyph (shape ≠ a number) */
    .step.done .step-mark {
      background: var(--tc-green, #34d399);
      color: #0b1220;
    }
    .step-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
    }
    .step.current .step-label {
      color: var(--primary-text-color, #e1e1e1);
    }
    /* Step body — crossfade on change (keyed re-create replays it); reduced-motion
       degrades to an instant cut with no info lost (CAP-6). */
    .wiz-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 120px;
      animation: wiz-fade 180ms var(--tc-ease, ease);
    }
    @keyframes wiz-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .wiz-body {
        animation: none;
      }
    }
    .wiz-h {
      font-size: 16px;
      font-weight: 700;
      color: var(--primary-text-color, #e1e1e1);
    }
    .wiz-sub {
      font-size: 13px;
      line-height: 1.45;
      color: var(--secondary-text-color, #9aa7b8);
    }
    /* Detect — three-state discovery list (CAP-4). */
    .disco {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
    }
    .disco-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .disco-mark {
      display: inline-flex;
      width: 20px;
      height: 20px;
    }
    .disco-mark .ico {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .disco-dash {
      width: 20px;
      text-align: center;
      color: var(--tc-text-dim, #9aa7b8);
    }
    .disco-name {
      flex: 1;
      font-weight: 600;
    }
    .disco-state {
      font-size: 12px;
      color: var(--secondary-text-color, #9aa7b8);
    }
    .disco-row.online .disco-mark {
      color: var(--tc-green, #34d399);
    }
    .disco-row.unavailable .disco-mark {
      color: var(--tc-amber, #fbbf24);
    }
    /* absent rows read visually distinct — dim + italic "not found" (never an empty
       field to fill, CAP-4). */
    .disco-row.absent {
      opacity: 0.6;
    }
    .disco-row.absent .disco-state {
      font-style: italic;
    }
    .wiz-empty {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: flex-start;
    }
    .wiz-result {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 60px;
      border-radius: var(--tc-radius-lg, 18px);
      border: 1px solid var(--tc-border, var(--divider-color, rgba(127, 127, 127, 0.3)));
      background: var(--tc-surface-2, rgba(127, 127, 127, 0.06));
    }
    .wiz-result-name {
      font-size: 18px;
      font-weight: 700;
      color: var(--primary-text-color, #e1e1e1);
    }
    /* Footer — Back · Skip · Next(primary)/Done · Finish now. */
    .wiz-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding-top: 6px;
      border-top: 1px solid var(--tc-border, var(--divider-color, rgba(127, 127, 127, 0.3)));
    }
    .wiz-btn {
      min-height: 44px;
      padding: 0 16px;
      border-radius: var(--tc-radius-md, 12px);
      border: 1px solid transparent;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      color: var(--primary-text-color, inherit);
      background: transparent;
    }
    .wiz-btn.tertiary {
      border-color: var(--tc-border, var(--divider-color, rgba(127, 127, 127, 0.3)));
    }
    .wiz-btn.secondary {
      border-color: var(--tc-border-strong, var(--divider-color, rgba(127, 127, 127, 0.4)));
      background: var(--tc-surface-2, rgba(127, 127, 127, 0.08));
    }
    /* Next/Done — the single emphatic control. Pushed to the right of the nav trio. */
    .wiz-btn.primary {
      margin-left: auto;
      background: var(--tc-blue, #38bdf8);
      color: #0b1220;
    }
    .wiz-btn.quiet {
      color: var(--secondary-text-color, #9aa7b8);
      text-decoration: underline;
      padding: 0 8px;
    }
    .wiz-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .wiz-disclaimer {
      font-size: 11px;
      text-align: center;
      color: var(--tc-text-mute, var(--secondary-text-color, #64748b));
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'tesla-card-editor': TeslaCardEditor;
  }
}
