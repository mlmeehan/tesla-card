import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import {
  mdiChevronUp,
  mdiChevronDown,
  mdiChevronRight,
  mdiCheck,
  mdiCheckCircle,
  mdiAlertCircleOutline,
  mdiAutoFix,
  mdiRestore,
} from '@mdi/js';
import type {
  HomeAssistant,
  TeslaCardConfig,
  AppearanceConfig,
  TyresConfig,
  LovelaceCardEditor,
  PanelId,
  NodeCustomization,
  SceneRow,
} from './types';
import type { EntityKey } from './const';
import { ROLES, type Role, type EnergyKey } from './data/registry';
import { resolveEntities } from './data/resolve';
import { resolveEnergyEntities, hasEnergySite } from './data/energy';
import { resolvePaint, normalizeKey, PAINT_PRESETS } from './paint';
import { carView, carStyles } from './components/car';
import { LIGHT_TOKENS } from './styles';
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

// Sensible `ha-selector` `number` bounds for the tyre thresholds, keyed by the
// chosen display unit (Story 9.13). `unit_of_measurement` reflects the chosen unit
// so the native widget announces it (a11y: "Recommended pressure, 2.4 bar"); Auto /
// native leaves the unit undefined (we cannot know the sensor's native unit without
// a `hass.states` read — AR-1) and uses a permissive fine-step range that covers
// both bar and psi. Thresholds are stored in the NATIVE unit (TyresConfig invariant);
// these bounds only constrain the edit widget.
function tuneNumberRanges(units: 'psi' | 'bar' | undefined): {
  unit: string | undefined;
  rec: { min: number; max: number; step: number };
  margin: { min: number; max: number; step: number };
} {
  if (units === 'bar')
    return { unit: 'bar', rec: { min: 1.5, max: 4, step: 0.1 }, margin: { min: 0, max: 1, step: 0.1 } };
  if (units === 'psi')
    return { unit: 'psi', rec: { min: 20, max: 60, step: 1 }, margin: { min: 0, max: 15, step: 1 } };
  return { unit: undefined, rec: { min: 0, max: 100, step: 0.1 }, margin: { min: 0, max: 20, step: 0.1 } };
}

/**
 * A node's honest discovery result (CAP-4 / Story 9.10 AC5). FOUR states now: the
 * `no_data` (`unknown`) sibling of `unavailable` joins the 9.9 three — a registered
 * entity that is connected but has no value yet (amber ⚠, "no data yet" sub-label).
 *   • `online`      — registered + reachable (✓; reachable, NOT necessarily awake)
 *   • `unavailable` — registered, integration can't reach it (⚠)
 *   • `no_data`     — registered, connected, `unknown` value (⚠ + "no data yet")
 *   • `absent`      — not found (—)
 */
type DiscoState = 'online' | 'unavailable' | 'no_data' | 'absent';

/** One discovery row — the shared seam shape both the wizard Step-1 checklist and the
 *  normal-form summary consume (Story 9.10). `instanceId` is the bare `role` today; the
 *  per-instance remap picker (9.11) widens it. `entityId` is the resolved id (or absent). */
interface DiscoveryRow {
  role: Role;
  instanceId: string;
  title?: string;
  state: DiscoState;
  entityId?: string;
}

const PANELS: { id: PanelId; name: string }[] = [
  { id: 'climate', name: STRINGS.tabs.climate },
  { id: 'charging', name: STRINGS.tabs.charging },
  { id: 'closures', name: STRINGS.tabs.closures },
  { id: 'tyres', name: STRINGS.tabs.tyres },
  { id: 'location', name: STRINGS.tabs.location },
  { id: 'media', name: STRINGS.tabs.media },
];

// ── Appearance paint swatches (Story 9.12) ───────────────────────────────────
// The curated bundled-preset grid (the mock's six). Each swatch carries the
// curated automotive `hex` (sourced from `PAINT_PRESETS`, plus a curated green),
// and the picker writes THAT hex to `config.paint` — NOT the bare `key`. This is
// load-bearing: `resolvePaint` honours a CSS keyword (`'blue'`/`'red'`/`'green'`…)
// as the PURE CSS colour BEFORE it ever consults `PAINT_PRESETS` (pinned +
// deliberate — `paint.test.ts`), so writing the generic name would render a
// garish primary (#0000ff) instead of the curated #2a4f93. Writing the hex makes
// the rendered car match the swatch chip exactly. `key` stays the stable DOM /
// roving-tabindex identity (and a back-compat selection match for a legacy
// name-valued `config.paint`). Labels are generic (no vendor names ship — the
// denylist governs bundled assets; a user's free hex is config, out of scope).
const PAINT_SWATCHES: { key: string; label: string; hex: string }[] = [
  { key: 'white', label: STRINGS.editor.appearance.paintWhite, hex: PAINT_PRESETS.white },
  { key: 'silver', label: STRINGS.editor.appearance.paintSilver, hex: PAINT_PRESETS.silver },
  { key: 'blue', label: STRINGS.editor.appearance.paintBlue, hex: PAINT_PRESETS.blue },
  { key: 'black', label: STRINGS.editor.appearance.paintBlack, hex: PAINT_PRESETS.black },
  { key: 'red', label: STRINGS.editor.appearance.paintRed, hex: PAINT_PRESETS.red },
  { key: 'green', label: STRINGS.editor.appearance.paintGreen, hex: '#2f9e6b' },
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

// ── Per-entity override targets (Story 9.11, the seam discovery + remap share) ──
// Each discovery role maps to ONE representative function-key whose override lives
// on an existing config surface (PRD §13): `vehicle` writes `config.entities.status`,
// every energy role writes `config.energy.entities.<*_power>`. SINGLE-SOURCED here so
// `_discover`'s resolution and the remap picker's write target the SAME key (no drift)
// — `_discover` derives its `idFor` from this table, the picker writes/reads/resets it.
// Discriminated on `surface` so `key` narrows to the right keyspace with no cast.
type OverrideTarget =
  | { surface: 'vehicle'; key: EntityKey }
  | { surface: 'energy'; key: EnergyKey };
const OVERRIDE_TARGET: Record<Role, OverrideTarget> = {
  vehicle: { surface: 'vehicle', key: 'status' },
  solar: { surface: 'energy', key: 'solar_power' },
  powerwall: { surface: 'energy', key: 'battery_power' },
  grid: { surface: 'energy', key: 'grid_power' },
  home: { surface: 'energy', key: 'load_power' },
  wall_connector: { surface: 'energy', key: 'wc_power' },
  generator: { surface: 'energy', key: 'generator_power' },
};

// Per-role PERMISSIVE entity-picker filters (EXPERIENCE.md:181–182). A list-of-filters
// is OR: a correctly-detected entity that an integration-only filter would wrongly hide
// (e.g. a cross-integration power hub, or a self-keyed `sensor.solar_power` from a
// non-Tesla inverter) is never filtered out of its own remap list — the domain/
// device_class fallback admits it. Pinned against the live corpus: the vehicle's
// representative `status` is `binary_sensor.garage_model_y_status` (tesla_fleet); every
// energy `*_power` is `sensor.my_home_*_power` (tesla_fleet / powerwall), device_class
// `power`. The `— not found` row uses NO filter (broad registry + native type-ahead).
const VEHICLE_FILTER: readonly unknown[] = [
  { integration: 'tesla_fleet' },
  { integration: 'teslemetry' },
  { integration: 'tessie' },
  { domain: 'binary_sensor' },
];
const ENERGY_FILTER: readonly unknown[] = [
  { integration: 'tesla_fleet' },
  { integration: 'powerwall' },
  { domain: 'sensor', device_class: 'power' },
  { domain: 'sensor', device_class: 'energy' },
];

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

  // ── Editor discovery seam (Story 9.10 — relax AR-1, registry + liveness) ──────
  // The ONE discovery function both the wizard Step-1 checklist (`_renderDetect`) and
  // the normal-form summary (`_renderDiscoverySummary`) consume, so they cannot drift
  // (EXPERIENCE.md:147). Key→entity resolution stays through the UNCHANGED `data/`
  // resolvers (AC1/AC3 — no hard-coded ids); liveness + presence are read from the
  // editor's OWN `hass` via the public surface (the DECIDED AR-1 relaxation, D-9.10-4 /
  // architecture.md D7 / the no-bare-hass-states baseline entry). Persists only resolved
  // ids — re-scans every editor open (no baked snapshot). One bare row per role (the
  // per-instance remap picker is 9.11; `instanceId` is the bare role today).
  private _discover(): DiscoveryRow[] {
    const c = this._config;
    // Defensive (AR-15 / FR-24): a partial `hass` with no `states` map (the editor
    // preview can supply one) is treated as no-hass — the `data/` resolvers' `find`
    // would otherwise `Object.keys(undefined)`-throw. `_liveness` reads `hass.states`
    // optionally, so it stays safe regardless.
    const hass = this.hass?.states ? this.hass : undefined;
    const vehicle = resolveEntities(hass, c);
    const energy = resolveEnergyEntities(hass, c);
    // Single-source the resolved id off OVERRIDE_TARGET (Story 9.11) so discovery and
    // the remap picker target the SAME representative key — the discriminated `surface`
    // narrows `key` to the right resolved map with no cast.
    const idFor = (role: Role): string | undefined => {
      const t = OVERRIDE_TARGET[role];
      return t.surface === 'vehicle' ? vehicle[t.key] : energy[t.key];
    };
    return ROLES.map((role) => {
      const entityId = idFor(role);
      return { role, instanceId: role, state: this._liveness(entityId), entityId };
    });
  }

  // ── Per-entity override read/write (Story 9.11) ───────────────────────────────
  // The CURRENT override value at a role's surface/key (or `undefined` when unset).
  // Reads the SAME representative key `_discover` resolves, so the picker pre-fills
  // and resets exactly what discovery showed.
  private _overrideId(role: Role): string | undefined {
    const t = OVERRIDE_TARGET[role];
    return t.surface === 'vehicle'
      ? this._config.entities?.[t.key]
      : this._config.energy?.entities?.[t.key];
  }

  /** True iff the override key is PRESENT at its surface (drives Reset-to-auto visibility). */
  private _hasOverride(role: Role): boolean {
    return this._overrideId(role) !== undefined;
  }

  // Write (or, when `value` is undefined, DELETE) a role's override at its surface, via
  // a whole-config REPLACE (`_emit`, never `_patch`) so a delete actually propagates and
  // unknown/future keys ride the spread intact (R9). Clones the nested `entities`/`energy`
  // containers (never mutating `_config` in place) and prunes empties byte-for-byte — an
  // emptied `entities`/`energy.entities` → delete, an emptied `energy` → delete — so a
  // Reset restores today's config exactly (SM-C4 / zero-diff). Mirrors `_commitNodes`'
  // prune ladder. Sibling `energy.nodes` + unknown energy sub-keys survive the `{ ...energy }`
  // spread.
  private _writeOverride(role: Role, value: string | undefined): void {
    const t = OVERRIDE_TARGET[role];
    const next: TeslaCardConfig = { ...this._config };
    if (t.surface === 'vehicle') {
      const entities = { ...(next.entities ?? {}) };
      if (value) entities[t.key] = value;
      else delete entities[t.key];
      if (Object.keys(entities).length > 0) next.entities = entities;
      else delete next.entities;
    } else {
      const energy = { ...(next.energy ?? {}) };
      const ents = { ...(energy.entities ?? {}) };
      if (value) ents[t.key] = value;
      else delete ents[t.key];
      if (Object.keys(ents).length > 0) energy.entities = ents;
      else delete energy.entities;
      if (Object.keys(energy).length > 0) next.energy = energy;
      else delete next.energy;
    }
    this._emit(next);
  }

  // `@value-changed` from the picker: persist the picked id (an explicit override is
  // honest — we do NOT prune it even when it equals the auto-resolved id), then announce
  // the settled three-state of the pick via the polite live region (honest dead-pick,
  // AC3 — the pick is saved REGARDLESS of liveness; honesty ≠ refusal). A cleared pick
  // (no id) falls through to a delete (the picker's own reset path).
  private _remapEntity(d: DiscoveryRow, ev: CustomEvent): void {
    const raw = (ev.detail as { value?: unknown } | undefined)?.value;
    const id = typeof raw === 'string' && raw ? raw : undefined;
    this._writeOverride(d.role, id);
    // Label off the per-instance seam (D15) — `title ?? NODE_LABELS[role]` — so the
    // announcement disambiguates "Solar · South Array" additively when 9.7 lands; bare
    // (title-less) today, so the announced label is unchanged.
    const label = d.title ?? NODE_LABELS[d.role];
    this._remapAnnounce = id
      ? `${label}, ${STRINGS.editor.remapMapped} — ${this._discoStateWord(this._liveness(id))}`
      : '';
  }

  // Reset-to-auto (AC4 / D-9.11-4): DELETE the override key (restoring live auto-discovery)
  // and clear the announcement. A removed key, never a blanked value (R9-clean, zero-diff).
  private _resetAuto(role: Role): void {
    this._writeOverride(role, undefined);
    this._remapAnnounce = '';
  }

  /** The per-role permissive picker filter (present rows); the `— not found` row uses none. */
  private _filterFor(role: Role): readonly unknown[] {
    return OVERRIDE_TARGET[role].surface === 'vehicle' ? VEHICLE_FILTER : ENERGY_FILTER;
  }

  /**
   * Honest four-state liveness for a resolved id (AC5). The DELIBERATE, LOGGED AR-1
   * relaxation (Story 9.10): read the editor's OWN `hass` directly via the public
   * surface — `hass.states[id]` for liveness, the `hass.entities` registry for presence
   * — NEVER a Home-Assistant-frontend `src/data/*` import. Registry presence ≠ liveness:
   * a registered-but-dead entity reads ⚠ (`unavailable`), never a false ✓ (the radical-
   * honesty rule). `unknown` ⇒ `no_data` (connected, no value yet). `online` attests
   * REACHABLE, not awake — a sleeping car with a present-but-stale state object is still ✓.
   */
  private _liveness(entityId?: string): DiscoState {
    if (!entityId) return 'absent';
    const st = this.hass?.states?.[entityId]?.state;
    if (st === undefined) {
      // Resolved id (e.g. a config override) not in `states`: registered ⇒ dead (⚠),
      // else genuinely absent. The entity-registry map is the authoritative signal.
      return this._registered(entityId) ? 'unavailable' : 'absent';
    }
    if (st === 'unavailable') return 'unavailable';
    if (st === 'unknown') return 'no_data';
    return 'online';
  }

  /**
   * Registry presence for a resolved id whose state is NOT in `hass.states` — read from
   * the editor's own `hass` (public surface — the logged AR-1 relaxation). The HA-
   * recommended chain is `hass.config.components → hass.devices → hass.entities`; the
   * entity-registry map (`hass.entities`, keyed by entity_id) is the DECISIVE per-entity
   * signal (loaded-integration set + device registry corroborate). Used ONLY to tell a
   * registered-but-dead entity (⚠ `unavailable`) from a genuinely absent one (—): a
   * config override pointing at a registered entity that is momentarily down still reads
   * ⚠, never a false —. When NO registry map is supplied (older HA / a bare editor
   * preview) we cannot confirm registration, so an id absent from `hass.states` is
   * `absent` — discovery never INVENTS a product it can't see (the honesty contract).
   * The richer WS-escalation fields (`config_entry_id`/`disabled_by`/`unique_id`) the
   * four-state output does not need, so no `callWS` escalation is performed (flagged).
   */
  private _registered(entityId: string): boolean {
    const entities = this.hass?.entities;
    if (entities && typeof entities === 'object') return entityId in entities;
    return false; // no registry map → can't confirm presence → treat as absent
  }

  private _discoStateWord(s: DiscoState): string {
    switch (s) {
      case 'online':
        return STRINGS.wizard.detect.online;
      case 'unavailable':
        return STRINGS.wizard.detect.unavailable;
      case 'no_data':
        return STRINGS.wizard.detect.noData;
      case 'absent':
        return STRINGS.wizard.detect.notFound;
    }
  }

  // The discovery mark for a state — ✓ online · ⚠ unavailable/no-data (same amber
  // marker, AC5) · — absent. `aria-hidden` (the row announces role+state in words).
  private _discoMark(s: DiscoState): TemplateResult {
    if (s === 'online') return this._icon(mdiCheckCircle);
    if (s === 'absent') return html`<span class="disco-dash">—</span>`;
    return this._icon(mdiAlertCircleOutline); // unavailable AND no_data → amber ⚠
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
    const disco = this._discover();
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
              <span class="disco-mark" aria-hidden="true">${this._discoMark(state)}</span>
              <span class="disco-name" aria-hidden="true">${NODE_LABELS[role]}</span>
              <span class="disco-state" aria-hidden="true">${this._discoStateWord(state)}</span>
            </li>
          `
        )}
      </ul>
    `;
  }

  // Step 2 — Confirm & remap (Story 9.11, AC1). The FULL list of every PRESENT role's
  // `entity-picker-row`, shown at once (the wizard's full-list layout — same picker
  // component as the accordion, different presentation). PRESENT-ONLY: the onboarding
  // wizard never shows a `— not found` row (Priya never sees a Wall Connector she does
  // not own); the absent-row manual map lives only in the normal-form summary. Reuses
  // the shared `_renderPicker` + write path; the polite live region announces a pick.
  private _renderConfirm(): TemplateResult {
    const present = this._discover().filter((d) => d.state !== 'absent');
    return html`
      <span class="wiz-h">${STRINGS.wizard.confirm.heading}</span>
      <span class="wiz-sub">${STRINGS.wizard.confirm.subhead}</span>
      <ul class="disco confirm-list" role="list">
        ${present.map(
          (d) => html`
            <li class="confirm-row ${d.state}">
              <div class="summary-row-head">
                <span class="disco-mark" aria-hidden="true">${this._discoMark(d.state)}</span>
                <span class="disco-name">${d.title ?? NODE_LABELS[d.role]}</span>
                <span class="disco-state">${this._discoStateWord(d.state)}</span>
              </div>
              ${this._renderPicker(d)}
            </li>
          `
        )}
      </ul>
      ${this._renderAnnounce()}
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
        return this._renderConfirm();
      case 'appearance':
        return this._renderAppearance();
      case 'tune':
        return this._renderTune();
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
      this._step === 0 && this._discover().every((d) => d.state === 'absent');
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

  // ── Normal-form discovery summary (Story 9.10, AC1/AC4/AC5/AC9) ──────────────
  // Which role's remap chevron is expanded (`''` = none). 9.10 ships the affordance
  // + a stable `aria-expanded` seam; the 9.11 per-entity picker drops into the slot.
  @state() private _remapOpen = '';
  // The polite live-region message announced after a pick (AC3) — "Solar, mapped —
  // unavailable". Empty ⇒ the region is silent. Cleared on Reset and on collapse.
  @state() private _remapAnnounce = '';
  // Toggle the accordion picker for a role. On EXPAND, move focus to the revealed
  // `ha-selector` (keyboard/SR, AC cross-cutting); on COLLAPSE, return focus to the
  // chevron and silence the live region. `ha-selector` is inert in jsdom — the optional
  // `.focus?.()` is a safe no-op there.
  private async _toggleRemap(role: Role): Promise<void> {
    const wasOpen = this._remapOpen === role;
    this._remapOpen = wasOpen ? '' : role;
    if (wasOpen) this._remapAnnounce = '';
    await this.updateComplete;
    if (wasOpen) {
      const chev = this.shadowRoot?.querySelector(
        `.remap-chevron[data-role="${role}"]`
      ) as HTMLElement | null;
      chev?.focus?.();
    } else {
      const sel = this.shadowRoot?.querySelector('.remap-panel ha-selector') as HTMLElement | null;
      sel?.focus?.();
    }
  }

  // The polite live region the pick announcement settles into (`role="status"` /
  // `aria-live="polite"`, never assertive, never icon-only). Visually present (not
  // `display:none`) so it is a real announced surface. Shared by both surfaces (the
  // accordion summary + the wizard Confirm list) — only one renders at a time.
  private _renderAnnounce(): TemplateResult {
    return html`<span class="remap-live" role="status" aria-live="polite">${this._remapAnnounce}</span>`;
  }

  // The `entity-picker-row` body shared by BOTH layouts (DESIGN.md:442): the accordion
  // beneath a summary row AND the wizard Step-2 full list. A native `<ha-selector>`
  // (HA-frontend custom element, registered globally by the Lovelace runtime — NO JS
  // import, so the import-allowlist holds) plus a Reset-to-auto button shown only when
  // an override is set. PRESENT rows use the per-role permissive filter, pre-filled with
  // the resolved id; an ABSENT (`— not found`) row uses an UNFILTERED selector with no
  // pre-fill (the map-a-miss escape, D-9.11-2). Per-instance label off `title ??
  // NODE_LABELS` (D15 seam — bare today, additive for 9.7).
  private _renderPicker(d: DiscoveryRow): TemplateResult {
    const label = d.title ?? NODE_LABELS[d.role];
    const absent = d.state === 'absent';
    const selector = absent ? { entity: {} } : { entity: { filter: this._filterFor(d.role) } };
    return html`
      <div class="remap-panel">
        <ha-selector
          .hass=${this.hass}
          .selector=${selector}
          .value=${absent ? undefined : d.entityId}
          @value-changed=${(e: Event) => this._remapEntity(d, e as CustomEvent)}
        ></ha-selector>
        ${this._hasOverride(d.role)
          ? html`<button
              type="button"
              class="reset-auto"
              aria-label=${`${STRINGS.editor.resetAuto} ${label}`}
              @click=${() => this._resetAuto(d.role)}
            >
              ${this._icon(mdiRestore)}
              <span>${STRINGS.editor.resetAuto}</span>
            </button>`
          : nothing}
      </div>
    `;
  }

  // The persistent "Detected on your system" section pinned at the TOP of the normal
  // form (AC4). Consumes the SAME shared seam as the wizard Step-1 checklist. When
  // discovery resolves NOTHING, shows the SAME plain nothing-found face as wizard Step 1
  // (calm message + a manual-selection route), never an empty section implying success.
  private _renderDiscoverySummary(): TemplateResult {
    const disco = this._discover();
    const empty = disco.every((d) => d.state === 'absent');
    return html`
      <div class="group disco-summary" role="group" aria-label=${STRINGS.editor.detectedHeading}>
        <span class="group-heading">${STRINGS.editor.detectedHeading}</span>
        ${empty
          ? this._renderNothingFound()
          : html`<ul class="disco" role="list">${disco.map((d) => this._renderSummaryRow(d))}</ul>`}
        ${this._renderAnnounce()}
      </div>
    `;
  }

  // One summary row: the four-state mark + role + state word (announced in WORDS — the
  // name + state text are NOT aria-hidden, so a reader hears "Solar, online"), then a
  // trailing labelled remap chevron (AC4/AC9). Absent rows are ALSO chevron-tappable
  // (9.11's manual-map seam). The "not found" word + chevron sit at `text-dim` (≥4.5:1),
  // never `text-mute` (the D5 contrast defect) — see styles.
  private _renderSummaryRow(d: DiscoveryRow): TemplateResult {
    const label = d.title ?? NODE_LABELS[d.role];
    const open = this._remapOpen === d.role;
    // A present row's chevron RE-maps ("Remap Solar"); an absent (`— not found`) row's
    // chevron is the map-a-miss affordance ("Map Wall connector manually", D-9.11-2) —
    // there is nothing to re-map, so the verb is honest about a first mapping.
    const chevronLabel =
      d.state === 'absent'
        ? `${STRINGS.editor.mapManuallyPrefix} ${label} ${STRINGS.editor.mapManuallySuffix}`
        : `${STRINGS.editor.remap} ${label}`;
    return html`
      <li class="disco-row summary-row ${d.state}">
        <div class="summary-row-head">
          <span class="disco-mark" aria-hidden="true">${this._discoMark(d.state)}</span>
          <span class="disco-name">${label}</span>
          <span class="disco-state">${this._discoStateWord(d.state)}</span>
          <button
            type="button"
            class="remap-chevron"
            data-role=${d.role}
            aria-label=${chevronLabel}
            aria-expanded=${open ? 'true' : 'false'}
            @click=${() => this._toggleRemap(d.role)}
          >
            ${this._icon(open ? mdiChevronDown : mdiChevronRight)}
          </button>
        </div>
        ${open ? this._renderPicker(d) : nothing}
      </li>
    `;
  }

  // Nothing-found face — the SAME plain message + manual-selection route as wizard
  // Step 1 (reuse, don't fork). "Select entities manually" re-enters the guided setup
  // where the manual mapping lives (AC4). A labelled live region.
  private _renderNothingFound(): TemplateResult {
    return html`
      <div class="wiz-empty disco-empty" role="status" aria-label=${STRINGS.wizard.detect.emptyTitle}>
        <span class="wiz-h">${STRINGS.wizard.detect.emptyTitle}</span>
        <span class="wiz-sub">${STRINGS.wizard.detect.emptyBody}</span>
        <button type="button" class="wiz-btn primary" @click=${this._runGuidedSetup}>
          ${STRINGS.wizard.detect.selectManually}
        </button>
      </div>
    `;
  }

  // ── Appearance & theming pickers (Story 9.12) ────────────────────────────────
  // The polite live-region message announced after a paint/theme/panel pick — the
  // RESOLVED appearance ("Preview, Deep blue, Dark, Charging"). Empty ⇒ silent.
  // Coalesced by construction: every picker fires ONE pick event (a swatch click,
  // an arrow step, a settled ha-selector change), never a per-keystroke churn.
  @state() private _appearanceAnnounce = '';

  /** The card-only theme override, read defensively (FR-24): only 'light'/'dark'
   *  count; anything else (absent / garbage) is Auto. */
  private _resolvedAppTheme(): 'auto' | 'light' | 'dark' {
    const t = (this._config.appearance as { theme?: unknown } | undefined)?.theme;
    return t === 'light' || t === 'dark' ? t : 'auto';
  }

  /** The swatch whose curated `hex` matches the current literal `config.paint`
   *  (the value the picker writes), or — for back-compat — a legacy NAME-valued
   *  `config.paint` matching a swatch `key`. Undefined for a custom hex / PaintSource
   *  / unset ⇒ no swatch selected, the hex field is "active". */
  private _selectedSwatch(): string | undefined {
    const p = this._config.paint;
    if (typeof p !== 'string') return undefined;
    const norm = p.trim().toLowerCase();
    const k = normalizeKey(p);
    return PAINT_SWATCHES.find((s) => s.hex.toLowerCase() === norm || normalizeKey(s.key) === k)?.key;
  }

  // The present panel set (D-9.12 present-gating): the base tabs, plus Energy iff an
  // energy site is detected — the SAME Story 1.8 predicate the card's Energy splice
  // uses (`hasEnergySite`), so the chooser never offers a dead pick. No-hass ⇒ no
  // Energy, gracefully (the `.states` guard mirrors `_discover`).
  private _presentPanels(): { id: PanelId; name: string }[] {
    const hass = this.hass?.states ? this.hass : undefined;
    return hasEnergySite(resolveEnergyEntities(hass, this._config))
      ? [...PANELS, { id: 'energy', name: STRINGS.tabs.energy }]
      : PANELS;
  }

  // ── Write/reset discipline (reuse 9.11's _emit-replace + prune) ──────────────
  // Paint / default-panel live at their existing TOP-LEVEL homes — a pure replace
  // with a delete-on-reset. Unknown/future keys ride the `{ ...config }` spread (R9).
  private _setPaint(value: string | undefined): void {
    const next = { ...this._config };
    // Verbatim — NEVER clamp/validate/substitute (even a brand red is saved as the
    // user typed it; the denylist governs bundled assets, not runtime config, D-9.12-3).
    if (value !== undefined && value !== '') next.paint = value;
    else delete next.paint;
    this._emit(next);
    this._announceAppearance();
  }

  private _setPanel(value: PanelId | undefined): void {
    const next = { ...this._config };
    if (value) next.default_panel = value;
    else delete next.default_panel;
    this._emit(next);
    this._announceAppearance();
  }

  // Theme is the one NEW key — it lives under `appearance`. Clone the container,
  // set/delete `theme`, then PRUNE an emptied `appearance` so Auto/reset restores
  // today's config byte-for-byte (SM-C4). A garbage non-object `appearance` is
  // replaced rather than spread (mirrors `_commitNodes`' defensive clone).
  private _setTheme(value: 'light' | 'dark' | undefined): void {
    const next = { ...this._config };
    const appearance: AppearanceConfig =
      next.appearance && typeof next.appearance === 'object' && !Array.isArray(next.appearance)
        ? { ...next.appearance }
        : {};
    if (value) appearance.theme = value;
    else delete appearance.theme;
    if (Object.keys(appearance).length > 0) next.appearance = appearance;
    else delete next.appearance;
    this._emit(next);
    this._announceAppearance();
  }

  // Compose the resolved-appearance announcement (read AFTER `_emit` updated
  // `_config`). Names what Auto inherits (today's dark) so the announce is honest.
  private _announceAppearance(): void {
    const c = this._config;
    const A = STRINGS.editor.appearance;
    const sel = this._selectedSwatch();
    const paintStr = typeof c.paint === 'string' ? c.paint : undefined;
    const paintWord = sel
      ? PAINT_SWATCHES.find((s) => s.key === sel)!.label
      : paintStr || A.paintDefault;
    const theme = this._resolvedAppTheme();
    const themeWord =
      theme === 'light' ? A.themeLight : theme === 'dark' ? A.themeDark : `${A.themeAuto} (${A.themeDark})`;
    const panelId = (c.default_panel ?? 'charging') as PanelId;
    const panelWord = STRINGS.tabs[panelId] ?? String(panelId);
    this._appearanceAnnounce = `${A.announcePrefix}, ${paintWord}, ${themeWord}, ${panelWord}`;
  }

  // Roving-tabindex radiogroup arrow traversal (shared by the swatch grid + the
  // theme segmented control). Returns the next index, or -1 for a non-arrow key.
  private _radioNext(e: KeyboardEvent, count: number, cur: number): number {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        return (cur + 1) % count;
      case 'ArrowLeft':
      case 'ArrowUp':
        return (cur - 1 + count) % count;
      case 'Home':
        return 0;
      case 'End':
        return count - 1;
      default:
        return -1;
    }
  }

  private _onSwatchKey(e: KeyboardEvent): void {
    const sel = this._selectedSwatch();
    const cur = sel ? PAINT_SWATCHES.findIndex((s) => s.key === sel) : 0;
    const next = this._radioNext(e, PAINT_SWATCHES.length, cur);
    if (next < 0) return;
    e.preventDefault();
    const s = PAINT_SWATCHES[next];
    this._setPaint(s.hex); // write the curated hex (NOT the CSS-keyword key — see PAINT_SWATCHES)
    void this.updateComplete.then(() => {
      (this.shadowRoot?.querySelector(`.swatch[data-key="${s.key}"]`) as HTMLElement | null)?.focus?.();
    });
  }

  private _onThemeKey(e: KeyboardEvent): void {
    const order: ('auto' | 'light' | 'dark')[] = ['auto', 'light', 'dark'];
    const next = this._radioNext(e, 3, order.indexOf(this._resolvedAppTheme()));
    if (next < 0) return;
    e.preventDefault();
    const val = order[next];
    this._setTheme(val === 'auto' ? undefined : val);
    void this.updateComplete.then(() => {
      (this.shadowRoot?.querySelector(`.seg-btn[data-theme="${val}"]`) as HTMLElement | null)?.focus?.();
    });
  }

  // The ha-selector hex field's settled value (D-9.12-3): write the literal
  // VERBATIM (untrimmed casing preserved), or delete on empty (the picker's reset).
  private _onHex(ev: CustomEvent): void {
    const raw = (ev.detail as { value?: unknown } | undefined)?.value;
    const s = typeof raw === 'string' ? raw : '';
    this._setPaint(s.trim() ? s : undefined);
  }

  // A quiet ↺ reset button, present ONLY when the picker's key is set (parity with
  // the 9.11 entity-picker-row reset). Reuses the `.reset-auto` style.
  private _renderReset(onClick: () => void, label: string): TemplateResult {
    return html`<button
      type="button"
      class="reset-auto"
      aria-label=${`${STRINGS.editor.appearance.resetDefault} ${label}`}
      @click=${onClick}
    >
      ${this._icon(mdiRestore)}
      <span>${STRINGS.editor.appearance.resetDefault}</span>
    </button>`;
  }

  // The full-card live preview (D-9.12-4): the real recolorable generic-EV hero
  // (`carView`) re-skinned to the resolved paint, the whole frame flipped
  // light/dark via the SAME LIGHT_TOKENS the card host uses, and a mini tab strip
  // with the chosen default panel active. No fabricated telemetry — `charge:
  // 'parked'`, no SoC/range (the Finish-step honesty discipline carries over).
  private _renderPreview(): TemplateResult {
    const c = this._config;
    const paint = resolvePaint(this.hass, c);
    const light = this._resolvedAppTheme() === 'light';
    const name = c.name?.trim() || STRINGS.hero.defaultName;
    const panel = c.default_panel ?? 'charging';
    const tokenStyle = light
      ? Object.entries(LIGHT_TOKENS)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ')
      : '';
    return html`
      <div class="preview-wrap">
        <span class="preview-lead">${STRINGS.editor.appearance.livePreview}</span>
        <div class="appearance-preview ${light ? 'light' : ''}" style=${tokenStyle || nothing}>
          <div class="preview-stage">${carView({ paint, name, charge: 'parked' })}</div>
          <div class="preview-tabs" role="tablist" aria-label=${STRINGS.editor.appearance.panelLabel}>
            ${this._presentPanels().map(
              (p) => html`<span
                class="preview-tab ${p.id === panel ? 'active' : ''}"
                role="tab"
                aria-selected=${p.id === panel ? 'true' : 'false'}
                >${p.name}</span
              >`
            )}
          </div>
        </div>
      </div>
    `;
  }

  // Paint: an own-rolled radiogroup swatch grid + a free HA-native `text`-selector
  // hex. Selected = a check glyph (distinct from the blue focus ring); the colour
  // NAME is a caption on the surface token, NEVER ink on the paint fill (a11y HIGH).
  private _renderPaintPicker(): TemplateResult {
    const c = this._config;
    const sel = this._selectedSwatch();
    const paintStr = typeof c.paint === 'string' ? c.paint : undefined;
    const hexValue = !sel && paintStr ? paintStr : '';
    const tabIndexFor = (i: number, key: string) => (sel ? (key === sel ? 0 : -1) : i === 0 ? 0 : -1);
    return html`
      <div class="picker-block">
        <div class="plabel">
          <span>${STRINGS.editor.appearance.paintLabel}</span>
          ${c.paint !== undefined
            ? this._renderReset(() => this._setPaint(undefined), STRINGS.editor.appearance.paintLabel)
            : nothing}
        </div>
        <div
          class="swatches"
          role="radiogroup"
          aria-label=${STRINGS.editor.appearance.paintLabel}
          @keydown=${(e: KeyboardEvent) => this._onSwatchKey(e)}
        >
          ${PAINT_SWATCHES.map(
            (s, i) => html`
              <div
                class="swatch ${s.key === sel ? 'sel' : ''}"
                role="radio"
                data-key=${s.key}
                aria-checked=${s.key === sel ? 'true' : 'false'}
                aria-label=${s.label}
                tabindex=${tabIndexFor(i, s.key)}
                @click=${() => this._setPaint(s.hex)}
              >
                ${s.key === sel
                  ? html`<span class="swatch-check" aria-hidden="true">${this._icon(mdiCheck)}</span>`
                  : nothing}
                <span class="swatch-chip" style=${`background: ${s.hex}`}></span>
                <span class="swatch-nm">${s.label}</span>
              </div>
            `
          )}
        </div>
        <label class="hexfield">
          <span class="hexlab">${STRINGS.editor.appearance.hexLabel}</span>
          <ha-selector
            .hass=${this.hass}
            .selector=${{ text: {} }}
            .value=${hexValue}
            @value-changed=${(e: Event) => this._onHex(e as CustomEvent)}
          ></ha-selector>
        </label>
        <p class="picker-note">${STRINGS.editor.appearance.hexNote}</p>
      </div>
    `;
  }

  // Theme: an own-rolled Auto/Light/Dark segmented radiogroup (text-labelled, never
  // colour-coded). Auto ⇒ delete the key (no override); Light/Dark ⇒ write it.
  private _renderThemePicker(): TemplateResult {
    const theme = this._resolvedAppTheme();
    const opts: { val: 'auto' | 'light' | 'dark'; label: string }[] = [
      { val: 'auto', label: STRINGS.editor.appearance.themeAuto },
      { val: 'light', label: STRINGS.editor.appearance.themeLight },
      { val: 'dark', label: STRINGS.editor.appearance.themeDark },
    ];
    return html`
      <div class="picker-block">
        <div class="plabel">
          <span>${STRINGS.editor.appearance.themeLabel}</span>
          ${theme !== 'auto'
            ? this._renderReset(() => this._setTheme(undefined), STRINGS.editor.appearance.themeLabel)
            : nothing}
        </div>
        <div
          class="seg"
          role="radiogroup"
          aria-label=${STRINGS.editor.appearance.themeLabel}
          @keydown=${(e: KeyboardEvent) => this._onThemeKey(e)}
        >
          ${opts.map(
            (o) => html`
              <button
                type="button"
                class="seg-btn ${o.val === theme ? 'on' : ''}"
                role="radio"
                data-theme=${o.val}
                aria-checked=${o.val === theme ? 'true' : 'false'}
                tabindex=${o.val === theme ? 0 : -1}
                @click=${() => this._setTheme(o.val === 'auto' ? undefined : o.val)}
              >
                ${o.val === theme
                  ? html`<span class="seg-check" aria-hidden="true">${this._icon(mdiCheck)}</span>`
                  : nothing}
                <span>${o.label}</span>
              </button>
            `
          )}
        </div>
        <p class="auto-sub">${STRINGS.editor.appearance.themeAutoSub}</p>
      </div>
    `;
  }

  // Default panel: a present-gated HA-native `<select>` (the standalone 7.2 field
  // is SUBSUMED here — one control, no duplication).
  private _renderPanelPicker(): TemplateResult {
    const c = this._config;
    const value = c.default_panel ?? 'charging';
    return html`
      <div class="picker-block">
        <div class="plabel">
          <span>${STRINGS.editor.appearance.panelLabel}</span>
          ${c.default_panel !== undefined
            ? this._renderReset(() => this._setPanel(undefined), STRINGS.editor.appearance.panelLabel)
            : nothing}
        </div>
        <select
          class="panel-select"
          aria-label=${STRINGS.editor.appearance.panelLabel}
          .value=${value}
          @change=${(e: Event) => this._setPanel((e.target as HTMLSelectElement).value as PanelId)}
        >
          ${this._presentPanels().map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select>
        <p class="picker-note">${STRINGS.editor.appearance.panelNote}</p>
      </div>
    `;
  }

  // The pinned "Appearance" section — the SAME component the wizard Step 3 renders
  // (two homes, one component, D-9.12-1). Preview stacks ABOVE the three pickers
  // (narrow-dialog layout); the polite announce shared with the other surfaces.
  private _renderAppearance(): TemplateResult {
    return html`
      <div class="group appearance" role="group" aria-label=${STRINGS.editor.appearance.heading}>
        <span class="group-heading">${STRINGS.editor.appearance.heading}</span>
        ${this._renderPreview()}
        ${this._renderPaintPicker()}
        ${this._renderThemePicker()}
        ${this._renderPanelPicker()}
        <span class="remap-live" role="status" aria-live="polite">${this._appearanceAnnounce}</span>
      </div>
    `;
  }

  // ── Tune controls (Story 9.13, D-9.13-1d) ───────────────────────────────────
  // The "Tune" group — tyre units + thresholds, the panel/card hide toggles
  // (re-homed here from their old standalone checkboxes), and Powerwall control
  // visibility — each on its PINNED `ha-selector` widget (no JS import; the element
  // is registered globally by the Lovelace runtime). The SAME method renders in the
  // wizard Step 4 AND the normal form (two homes, one component — D-9.12-1 precedent).
  // The polite live region announces the resolved Tune state after a change.
  @state() private _tuneAnnounce = '';

  // Tyre display-unit preference — clone the `tyres` container, set/delete `units`,
  // prune an emptied container (mirror `_setTheme`). Auto/reset ⇒ delete the key, so
  // today's native-unit render is restored byte-for-byte (SM-C4 / FR-33 zero-diff).
  private _setTyresUnits(value: 'psi' | 'bar' | undefined): void {
    const next = { ...this._config };
    const tyres = this._cloneTyres(next);
    if (value) tyres.units = value;
    else delete tyres.units;
    this._commitTyres(next, tyres);
    this._announceTune();
  }

  // A tyre threshold (recommended | margin) — stored in the sensor's NATIVE unit
  // (the TyresConfig invariant is unchanged; `units` governs DISPLAY only). Empty /
  // non-finite ⇒ delete the key (reset = a removed key, never a blanked value, R9).
  private _setTyresNum(key: 'recommended' | 'margin', value: number | undefined): void {
    const next = { ...this._config };
    const tyres = this._cloneTyres(next);
    if (value !== undefined && Number.isFinite(value)) tyres[key] = value;
    else delete tyres[key];
    this._commitTyres(next, tyres);
    this._announceTune();
  }

  // Defensive clone of `config.tyres` (a garbage non-object is replaced, mirroring
  // `_setTheme`/`_commitNodes`).
  private _cloneTyres(next: TeslaCardConfig): TyresConfig {
    return next.tyres && typeof next.tyres === 'object' && !Array.isArray(next.tyres)
      ? { ...next.tyres }
      : {};
  }

  private _commitTyres(next: TeslaCardConfig, tyres: TyresConfig): void {
    if (Object.keys(tyres).length > 0) next.tyres = tyres;
    else delete next.tyres;
    this._emit(next);
  }

  // A top-level hide flag. `hide_*` default OFF (false); `notify_hidden_detected`
  // defaults ON (true). Clone+prune delete-on-DEFAULT — setting a key back to its
  // default REMOVES it, so an unconfigured config stays byte-for-byte today's (R9).
  private _setHideFlag(
    key: 'hide_panels' | 'hide_quick_actions' | 'hide_commands' | 'notify_hidden_detected',
    value: boolean
  ): void {
    const next = { ...this._config };
    const dflt = key === 'notify_hidden_detected'; // true for notify, false for hide_*
    if (value === dflt) delete next[key];
    else next[key] = value;
    this._emit(next);
    this._announceTune();
  }

  // Powerwall control visibility — clone `config.energy`, set/delete the gate, prune
  // an emptied `energy` (mirror `_writeOverride`). Sibling energy keys ride the spread.
  private _setHidePowerwall(value: boolean): void {
    const next = { ...this._config };
    const energy = { ...(next.energy ?? {}) };
    if (value) energy.hide_powerwall_controls = true;
    else delete energy.hide_powerwall_controls;
    if (Object.keys(energy).length > 0) next.energy = energy;
    else delete next.energy;
    this._emit(next);
    this._announceTune();
  }

  // Read the settled `value-changed`; coerce to the pinned `'psi'|'bar'` set (any
  // other value — the Auto option's '' — clears the key).
  private _onTyresUnits(ev: CustomEvent): void {
    const raw = (ev.detail as { value?: unknown } | undefined)?.value;
    this._setTyresUnits(raw === 'psi' || raw === 'bar' ? raw : undefined);
  }

  private _onTyresNum(key: 'recommended' | 'margin', ev: CustomEvent): void {
    const raw = (ev.detail as { value?: unknown } | undefined)?.value;
    this._setTyresNum(key, typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined);
  }

  // Compose the polite Tune announce (read AFTER `_emit` updated `_config`): the
  // resolved unit (naming what Auto inherits) + the Powerwall-controls visibility.
  private _announceTune(): void {
    const c = this._config;
    const T = STRINGS.editor.tune;
    const unitsWord = c.tyres?.units ?? T.tyreUnitsAuto;
    const pwWord = c.energy?.hide_powerwall_controls ? T.hidePowerwallControls : '';
    this._tuneAnnounce = `${T.announcePrefix}, ${unitsWord}${pwWord ? `, ${pwWord}` : ''}`;
  }

  // One labelled boolean toggle on the pinned `ha-selector` `boolean` widget. The
  // visible `.tune-lbl` IS the per-card-global label (NEVER D15-instance-suffixed);
  // the selector also carries the accessible name. `value` is the resolved checked
  // state; the writer applies delete-on-default.
  private _renderTuneBool(
    key: 'hide_panels' | 'hide_quick_actions' | 'hide_commands' | 'notify_hidden_detected',
    label: string,
    checked: boolean
  ): TemplateResult {
    return html`
      <div class="tune-row">
        <span class="tune-lbl">${label}</span>
        <ha-selector
          class="tune-bool"
          data-key=${key}
          .hass=${this.hass}
          .selector=${{ boolean: {} }}
          .value=${checked}
          aria-label=${label}
          @value-changed=${(e: Event) =>
            this._setHideFlag(key, !!(e as CustomEvent).detail?.value)}
        ></ha-selector>
      </div>
    `;
  }

  // The pinned "Tune" section — the SAME component the wizard Step 4 renders (two
  // homes, one component, D-9.12-1). Every widget is a PURE config writer (no
  // `hass.states` read — AR-1 boundary holds).
  private _renderTune(): TemplateResult {
    const c = this._config;
    const T = STRINGS.editor.tune;
    const units = c.tyres?.units; // undefined ⇒ Auto / native (zero-diff)
    const r = tuneNumberRanges(units);
    // a11y obligation #3 (EXPERIENCE.md:247-252): the number field announces its
    // unit AND min/max range ("Recommended pressure, bar, range 1.5–4"). Only when a
    // unit is chosen — Auto leaves both off (the permissive range is not meaningful to
    // announce, and the native widget reads the value itself). En-dash for the range.
    const numAria = (label: string, range: { min: number; max: number }): string =>
      r.unit ? `${label}, ${r.unit}, range ${range.min}–${range.max}` : label;
    const recAria = numAria(T.recommendedLabel, r.rec);
    const marAria = numAria(T.marginLabel, r.margin);
    return html`
      <div class="group tune" role="group" aria-label=${T.heading}>
        <span class="group-heading">${T.heading}</span>

        <div class="tune-row">
          <span class="tune-lbl">${T.tyreUnitsLabel}</span>
          <ha-selector
            class="tune-units"
            .hass=${this.hass}
            .selector=${{
              select: {
                mode: 'dropdown',
                options: [
                  { value: '', label: T.tyreUnitsAuto },
                  { value: 'psi', label: 'psi' },
                  { value: 'bar', label: 'bar' },
                ],
              },
            }}
            .value=${units ?? ''}
            aria-label=${T.tyreUnitsLabel}
            @value-changed=${(e: Event) => this._onTyresUnits(e as CustomEvent)}
          ></ha-selector>
        </div>

        <div class="tune-row">
          <span class="tune-lbl">${T.recommendedLabel}</span>
          <ha-selector
            class="tune-recommended"
            .hass=${this.hass}
            .selector=${{
              number: { min: r.rec.min, max: r.rec.max, step: r.rec.step, unit_of_measurement: r.unit, mode: 'box' },
            }}
            .value=${c.tyres?.recommended}
            aria-label=${recAria}
            @value-changed=${(e: Event) => this._onTyresNum('recommended', e as CustomEvent)}
          ></ha-selector>
        </div>

        <div class="tune-row">
          <span class="tune-lbl">${T.marginLabel}</span>
          <ha-selector
            class="tune-margin"
            .hass=${this.hass}
            .selector=${{
              number: { min: r.margin.min, max: r.margin.max, step: r.margin.step, unit_of_measurement: r.unit, mode: 'box' },
            }}
            .value=${c.tyres?.margin}
            aria-label=${marAria}
            @value-changed=${(e: Event) => this._onTyresNum('margin', e as CustomEvent)}
          ></ha-selector>
        </div>

        ${this._renderTuneBool('hide_quick_actions', STRINGS.editor.hideQuickActions, !!c.hide_quick_actions)}
        ${this._renderTuneBool('hide_panels', STRINGS.editor.hidePanels, !!c.hide_panels)}
        ${this._renderTuneBool('hide_commands', STRINGS.editor.hideCommands, !!c.hide_commands)}
        ${this._renderTuneBool('notify_hidden_detected', STRINGS.editor.notifyHiddenDetected, c.notify_hidden_detected !== false)}

        <div class="tune-row">
          <span class="tune-lbl">${T.hidePowerwallControls}</span>
          <ha-selector
            class="tune-hide-powerwall"
            .hass=${this.hass}
            .selector=${{ boolean: {} }}
            .value=${!!c.energy?.hide_powerwall_controls}
            aria-label=${T.hidePowerwallControls}
            @value-changed=${(e: Event) =>
              this._setHidePowerwall(!!(e as CustomEvent).detail?.value)}
          ></ha-selector>
        </div>

        <span class="remap-live" role="status" aria-live="polite">${this._tuneAnnounce}</span>
      </div>
    `;
  }

  private _renderNormalForm(): TemplateResult {
    const c = this._config;
    return html`
      <div class="form">
        ${this._renderDiscoverySummary()}
        ${this._renderAppearance()}
        ${this._renderTune()}
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

  // carStyles brings the recolorable hero's `.car-img`/`.tc-car` rules so the
  // appearance preview reuses the REAL render path (Story 9.12 Task 4).
  static override styles = [carStyles, css`
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
    /* Tune (Story 9.13): one labelled row per pinned ha-selector widget. The label
       sits beside the control; the control keeps its native ≥44px touch target
       (verified on the wall-kiosk surface, never assumed). */
    .tune-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 44px;
    }
    .tune-lbl {
      font-size: 13px;
      color: var(--primary-text-color, #e1e1e1);
    }
    .tune-row ha-selector {
      flex: 0 0 auto;
      min-width: 120px;
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
    /* unavailable AND no_data share the amber ⚠ marker (Story 9.10 AC5 — no_data is a
       sibling of unavailable, same colour, distinguished only by its "no data yet" word). */
    .disco-row.unavailable .disco-mark,
    .disco-row.no_data .disco-mark {
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
    /* ── Normal-form discovery summary (Story 9.10) ───────────────────────────
       Reuses the .disco/.disco-row markup; the net-new bits are the trailing remap
       chevron + the AC9 contrast floor. The summary's state word + chevron sit at
       --tc-text-dim (≥4.5:1), NEVER the dimmer --tc-text-mute (3.69:1 — the D5
       contrast defect must not re-creep); the absent row keeps FULL opacity so its
       "not found" word stays ≥4.5:1 (only the dash glyph reads dim). */
    .summary-row .disco-state {
      color: var(--tc-text-dim, #9aa7b8);
    }
    .summary-row.absent {
      opacity: 1;
    }
    .remap-chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      /* ≥44×44 keyboard/touch target (AC9), no motion */
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--tc-text-dim, #9aa7b8);
      cursor: pointer;
    }
    .remap-chevron .ico {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    /* ── Per-entity remap accordion (Story 9.11) ──────────────────────────────
       The summary row becomes a COLUMN when its picker is open: the head (mark +
       name + state + chevron) keeps its inline layout, the picker panel sits
       BENEATH it (expand-in-place, D-9.11-1 — the at-a-glance list stays visible).
       The panel reuses the wizard's opacity fade and cuts under reduced-motion. */
    .summary-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0;
    }
    .summary-row-head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .remap-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 6px 0 2px;
      animation: wiz-fade 180ms var(--tc-ease, ease);
    }
    @media (prefers-reduced-motion: reduce) {
      .remap-panel {
        animation: none;
      }
    }
    /* The wizard Confirm full-list rows reuse the same head + panel layout. */
    .confirm-row {
      display: flex;
      flex-direction: column;
      gap: 0;
      font-size: 13px;
    }
    .confirm-row .disco-name {
      flex: 1;
      font-weight: 600;
    }
    .confirm-row .disco-state {
      font-size: 12px;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
    }
    .confirm-row.online .disco-mark {
      color: var(--tc-green, #34d399);
    }
    .confirm-row.unavailable .disco-mark,
    .confirm-row.no_data .disco-mark {
      color: var(--tc-amber, #fbbf24);
    }
    ha-selector {
      display: block;
    }
    /* Reset-to-auto — a real labelled button, only present when an override is set,
       dim (≥4.5:1 text-dim, never the dimmer text-mute), ≥44px hit target. */
    .reset-auto {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      gap: 6px;
      min-height: 44px;
      padding: 0 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .reset-auto .ico {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    /* Polite live region — visually present (NOT display:none) so a pick's settled
       three-state is a real announced surface, never icon-only (AC3). */
    .remap-live {
      font-size: 12px;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
    }
    .remap-live:empty {
      display: none;
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

    /* ── Appearance & theming pickers (Story 9.12) ───────────────────────────
       Built against the canonical --tc-* tokens with DESIGN.md HA fallbacks (hard
       gate). The preview frame carries its OWN token block: dark by fallback, and
       the LIGHT_TOKENS set inline (the single-sourced card-only flip). */
    .appearance {
      gap: 12px;
    }
    .picker-block {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .plabel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
    }
    /* Paint swatch grid — own-rolled radiogroup, each radio ≥44×44 (a11y). */
    .swatches {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .swatch {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 10px 6px;
      border-radius: var(--tc-radius-md, 12px);
      border: 1px solid var(--tc-border, var(--divider-color, rgba(127, 127, 127, 0.3)));
      background: var(--tc-surface, var(--card-background-color, rgba(127, 127, 127, 0.06)));
      cursor: pointer;
    }
    /* selected = a check glyph + a stronger border, kept DISTINCT from the shared
       2px blue :focus-visible ring (selected ≠ focused — never one blue ring). */
    .swatch.sel {
      border-color: var(--tc-border-strong, var(--divider-color, rgba(127, 127, 127, 0.5)));
    }
    .swatch-check {
      position: absolute;
      top: 5px;
      right: 6px;
      display: inline-flex;
      width: 16px;
      height: 16px;
      border-radius: var(--tc-pill, 999px);
      background: var(--tc-blue, #38bdf8);
      color: #04121d;
    }
    .swatch-check .ico {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    .swatch-chip {
      width: 30px;
      height: 30px;
      border-radius: var(--tc-pill, 999px);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    /* colour NAME is a caption on the surface token (≥4.5:1), NEVER ink on the
       paint fill (no fixed ink clears AA across pearl-white→obsidian — a11y HIGH). */
    .swatch-nm {
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
    }
    .swatch.sel .swatch-nm {
      color: var(--tc-text, var(--primary-text-color, #f1f5f9));
    }
    .hexfield {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hexlab {
      font-size: 12px;
      font-weight: 600;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
    }
    .picker-note {
      margin: 0;
      font-size: 11px;
      line-height: 1.45;
      color: var(--tc-text-mute, var(--secondary-text-color, #64748b));
    }
    /* Theme segmented control — own-rolled radiogroup, text-labelled. */
    .seg {
      display: flex;
      gap: 4px;
      padding: 4px;
      border-radius: var(--tc-pill, 999px);
      border: 1px solid var(--tc-border, var(--divider-color, rgba(127, 127, 127, 0.3)));
      background: var(--tc-surface-2, var(--card-background-color, rgba(127, 127, 127, 0.08)));
    }
    .seg-btn {
      flex: 1 1 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 44px;
      padding: 8px 6px;
      border: 0;
      border-radius: var(--tc-pill, 999px);
      background: transparent;
      color: var(--tc-text-dim, var(--secondary-text-color, #9aa7b8));
      font: inherit;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      cursor: pointer;
    }
    .seg-btn.on {
      background: var(--tc-surface-3, rgba(127, 127, 127, 0.14));
      color: var(--tc-text, var(--primary-text-color, #f1f5f9));
      box-shadow: inset 0 0 0 1px var(--tc-border-strong, var(--divider-color, rgba(127, 127, 127, 0.4)));
    }
    .seg-check {
      display: inline-flex;
      width: 15px;
      height: 15px;
    }
    .seg-check .ico {
      width: 15px;
      height: 15px;
      fill: currentColor;
    }
    .auto-sub {
      margin: 0;
      font-size: 11px;
      line-height: 1.45;
      color: var(--tc-text-mute, var(--secondary-text-color, #64748b));
    }
    .panel-select {
      min-height: 44px;
      padding: 0 11px;
      border-radius: var(--tc-radius-sm, 10px);
      border: 1px solid var(--tc-border-strong, var(--divider-color, rgba(127, 127, 127, 0.4)));
      background: var(--tc-surface-3, var(--card-background-color, rgba(127, 127, 127, 0.1)));
      color: var(--tc-text, var(--primary-text-color, inherit));
      font: inherit;
      font-size: 13.5px;
    }
    /* Full-card live preview — stacks ABOVE the pickers (narrow-dialog layout). The
       frame carries the dark tokens by fallback; .light overlays LIGHT_TOKENS
       inline (single-sourced with the card host). The re-skin is a decorative
       transition that becomes an instant CUT under reduced motion (CAP-6). */
    .preview-wrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .preview-lead {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--tc-text-mute, var(--secondary-text-color, #64748b));
    }
    .appearance-preview {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border-radius: var(--tc-radius-lg, 18px);
      border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
      background: #0d1424;
      color: var(--tc-text, #f1f5f9);
      transition: background 0.18s var(--tc-ease, ease), color 0.18s var(--tc-ease, ease);
    }
    .appearance-preview.light {
      background: #f3f5f9;
    }
    @media (prefers-reduced-motion: reduce) {
      .appearance-preview {
        transition: none;
      }
    }
    .preview-stage {
      display: flex;
      justify-content: center;
      padding: 6px 0;
    }
    .preview-stage .car-img {
      width: 100%;
      max-width: 240px;
      height: auto;
      display: block;
    }
    .preview-tabs {
      display: flex;
      gap: 4px;
      padding: 4px;
      border-radius: var(--tc-pill, 999px);
      border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
      background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
      overflow: hidden;
    }
    .preview-tab {
      flex: 0 0 auto;
      padding: 6px 9px;
      border-radius: var(--tc-pill, 999px);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      white-space: nowrap;
      color: var(--tc-text-mute, #64748b);
    }
    .preview-tab.active {
      flex: 1 1 auto;
      text-align: center;
      color: var(--tc-text, #f1f5f9);
      background: color-mix(in srgb, var(--tc-blue, #38bdf8) 16%, transparent);
      box-shadow: inset 0 0 0 1px var(--tc-border, rgba(255, 255, 255, 0.09));
    }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    'tesla-card-editor': TeslaCardEditor;
  }
}
