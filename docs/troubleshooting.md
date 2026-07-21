# Troubleshooting — Tesla Card

The [Troubleshooting section in the README](../README.md#troubleshooting) has the
quick hits — the handful of things that fix most problems. This guide goes
deeper: how entity resolution and the integration dialects actually behave, what
the card's calm "asleep" and "stale" states mean, and how to tell a genuine bug
from expected behaviour. Nothing here contradicts the README; it links back to
the README for installation and the options reference rather than repeating them.

If a section doesn't get you unstuck, each one ends with exactly what to gather
before you [open an issue](https://github.com/mlmeehan/tesla-card/issues).

## Quick triage

| What you're seeing | Start here |
| ------------------ | ---------- |
| Card missing from the picker, or *"Custom element doesn't exist: tesla-card"* | [Installation & loading](#installation--loading) |
| **Every** entity reads *"— not found"* | [Entity resolution](#entity-resolution) |
| A **few** entities read ⚠ or *"—"* | [Entity resolution](#entity-resolution) |
| You're on Tessie, `tesla_custom`, TeslaMate, or a key is missing on one of them | [Integration dialects](#integration-dialects) |
| Card is dimmed with numbers that look old | [Asleep, wake & stale data](#asleep-wake--stale-data) |
| **Wake** does nothing, or reads *"Available in 1m"* / *"Awake"* | [Asleep, wake & stale data](#asleep-wake--stale-data) |
| A command entity shows *unknown* in HA Developer Tools | [Asleep, wake & stale data](#asleep-wake--stale-data) |
| Charging says *Parked* / *Plugged-idle* when you didn't expect it | [Charging & states](#charging--states) |
| No **Energy** tab appears | [Energy panel & My Home scene](#energy-panel--my-home-scene) |
| Energy flows draw in the **wrong direction** | [Energy panel & My Home scene](#energy-panel--my-home-scene) |
| A **My Home** node is missing | [Energy panel & My Home scene](#energy-panel--my-home-scene) |
| The visual editor won't open or looks broken | [Editor issues](#editor-issues) |
| `paint: blue` (or `red`) looks garish and over-saturated | [Appearance](#appearance) |
| Privacy or performance questions | [Performance & privacy](#performance--privacy) |

---

## Installation & loading

**Card missing from the picker, or *"Custom element doesn't exist:
tesla-card"*.** The bundle isn't loaded in your browser. In almost every case
it's a stale cache: dashboards cache their resources aggressively, so a
**hard refresh** (Cmd/Ctrl-Shift-R) after installing or updating is the first
thing to try.

**Confirm the bundle actually loaded.** Open your browser's developer console
and look for a single neutral boot line the moment the resource loads:

```
[tesla-card] v1.0.0
```

The card logs this once when its JavaScript is first evaluated (the version you
see is whatever you have installed). **No banner ⇒ the resource isn't loading at
all** — that's a cache or a path/resource-registration problem, not a card fault.
Every message the card prints is prefixed `[tesla-card]`, so you can filter the
console on that tag.

**After a HACS update.** HACS downloads the new `tesla-card.js`, but your browser
may keep serving the old one until you hard-refresh. If the version banner still
shows the old number after refreshing, clear the site's cache for your HA origin.

**YAML-mode dashboards.** HACS registers the resource automatically for
storage/UI-mode dashboards, but on a YAML-mode dashboard you add the resource
entry yourself — see [Installation](../README.md#installation) for the exact
`resources:` block. Double-check the URL is `/hacsfiles/tesla-card/tesla-card.js`
and the type is `module`.

**Manual install.** The file goes to `config/www/tesla-card.js`, and the resource
is `/local/tesla-card.js` registered as a **JavaScript module** (not a
stylesheet). A wrong path or the wrong resource type is the usual cause of a
silent no-load — see [Installation → Manual](../README.md#installation).

**Home Assistant version.** The card's floor is **HA 2024.4.0** (declared in
`hacs.json`); on an older HA some of the UI components the card relies on may not
exist.

*If it's still not loading, include:* your HA version; how you installed (HACS or
manual); dashboard mode (UI or YAML); whether the `[tesla-card] v…` banner
appears in the console; and any red console errors.

---

## Entity resolution

### How it actually works

You normally configure **no entities**. The card:

1. **Finds your Tesla device** — from a Tesla integration platform
   (`tesla_fleet` / `teslemetry` / `tessie` / `tesla_custom` / `tesla`), or,
   failing that, from any device whose manufacturer reads *Tesla*.
2. **Resolves every value by its stable function-name** — the
   language-independent slug of the entity's friendly name (*Time to full
   charge* → `time_to_full_charge`). Only the device-name **prefix** of an entity
   id varies between installs (`garage_model_y_…` vs `model_y_…` vs `tesla_…`);
   the function-name part does not, so matching on it works across environments
   without hard-coded ids.

Roughly a third of the default ids sit on the **bare device** with no prefix at
all (`sensor.odometer`, the tire-pressure sensors, the rear-seat heaters). That's
precisely why resolution matches on function-name rather than a fixed prefix —
and why forcing a prefix onto those bare ids would make them resolve to
*unavailable*. The full key list lives in
[`src/const.ts` → `DEFAULT_ENTITIES`](../src/const.ts) (also referenced from
[Entity resolution](../README.md#entity-resolution-automatic)).

### The first check when *everything* reads "— not found"

Confirm the Tesla integration is genuinely set up **and exposing entities**:
*Settings → Devices & Services →* your Tesla integration *→ entities*. If the
integration has no entities, there is nothing for the card to resolve — this is
the single most common cause of a card where every row reads *"— not found"*.
Then re-run the wizard's **Detect** step.

### Reading the four status markers

The wizard's **Confirm** step (and the everyday editor's discovery summary) tags
every resolved entity with a live marker:

| Marker | Meaning |
| ------ | ------- |
| ✓ **online** | Entity resolved and is reachable. **Reachable ≠ awake** — a sleeping car still shows ✓ on entities HA can see. |
| ⚠ **unavailable** | Resolved, but the entity is currently `unavailable`. |
| ⚠ **no data yet** | Resolved and present, but has no value yet (connected, nothing reported) — not absent, not dead. |
| — **not found** | No entity resolved for this key at all. |

### When to reach for `device:`, `prefix:`, or `integration:`

These are escape hatches — auto-detection handles the common case.

- **`device:`** — you have **more than one Tesla** and the card locked onto the
  wrong one. Point it at the right device by name or registry id.
- **`prefix:`** — rarely needed. Forces the entity-id prefix slug (e.g.
  `model_y`) when the derived prefix is wrong. Remember the bare ids above take
  no prefix.
- **`integration:`** — forces the dialect (`tesla_fleet` / `teslemetry` /
  `tessie` / `tesla_custom` / `tesla`). Auto-detected per your resolved vehicle
  device; you rarely need to set it. See [Integration dialects](#integration-dialects).

**How the card picks a device** when you haven't set `device:` (useful when it
guesses wrong on a mixed install): a device you name in `config.device` always
wins; otherwise it prefers a **vehicle-shaped** device (a car outscores a
higher-entity-count Powerwall), then — if you set `integration:` — a device that
owns that platform, then the richest vehicle-signature match, then simply the
device with the most entities. So on a household with both a car and a Powerwall,
the card resolves against the **car** by design.

### A few keys read ⚠ or "—"

Those specific entities are named unusually in your install — hand-renamed, or an
HA server language that localises the entity-id slug so the function-name no
longer matches. Fix just those keys:

- **In the editor** — expand the entity's row and use **remap**. *Map-a-miss*
  opens an **unfiltered** entity picker so you can point at anything. **Reset to
  auto** removes the override and hands the key back to auto-detection.
- **In YAML** — override only the differing keys under `entities:`; see
  [Entity overrides](../README.md#entity-overrides-escape-hatch). An explicit
  override always wins over auto-detection.

*If keys still won't resolve, include:* which keys show ⚠ / "—"; the real
`entity_id`s in your install (*Developer Tools → States*); your integration; and
whether you have one Tesla or several.

---

## Integration dialects

The card understands five `integration:` values. It auto-detects which one your
resolved vehicle device speaks and stamps it on the config, so you rarely set it
by hand.

- **`tesla_fleet`** — the baseline. The card's bundled entity corpus *is* Fleet,
  so Fleet entities map directly. `tesla_fleet` first shipped with **HA 2024.8**,
  which makes 2024.8 the practical baseline for that integration (the card's own
  floor is still 2024.4.0).
- **`teslemetry`** — Fleet-family; effectively 1:1 with Fleet bar a single
  aliased key.
- **`tessie`** — Fleet-family, with the card's aliases for Tessie's divergent
  keys (vent windows, defrost mode, the seat-heater selects, and the read-only
  auto-climate twins). A couple of keys Tessie doesn't expose read as genuinely
  unavailable. Verified against the integration's source and synthetic fixtures,
  **not yet against a live install**.
- **`tesla_custom`** — the HACS [`alandtse/tesla`](https://github.com/alandtse/tesla)
  integration. Resolves through the card's entity aliases plus **boolean charging
  classification** (below). Verified against source and synthetic fixtures,
  **not yet against a live install**.
- **`tesla`** — the legacy platform key; recognised and treated as Fleet-family.

### What `tesla_custom` charging looks like

`tesla_custom` exposes charging as a **single boolean sensor**, not a status
string, so the card derives the state:

- boolean **on** → **Charging**.
- boolean **off** → the integration collapses *stopped*, *complete*, **and
  *disconnected*** all into `off`, so the card can't tell them apart from the
  boolean alone. It corroborates with the **charge cable**: cable present →
  **Plugged-idle**; cable absent → **Parked**. This is real physical evidence, not
  a guessed charge state.

A consequence that is **expected, not a bug**: a fully-charged car that's still
plugged in reads **Plugged-idle** rather than *complete* (a boolean can't express
"complete"). Visually that's identical to how the Fleet family renders a
finished, still-connected charge.

### What "source-verified, not live-verified" means for you

The Tessie and `tesla_custom` aliases were derived from each integration's
source and exercised against synthetic fixtures — but no maintainer has run them
against a real install of those integrations. Integrations also evolve
release-to-release, so a real install may have drifted. Practically: **most keys
resolve, and any that don't show "—"** — fix those with the editor's **remap**
(or `entities:` in YAML) and please report them so the alias tables can be
updated.

### TeslaMate

**Not supported.** Entity resolution targets the Fleet / Teslemetry / Tessie /
`tesla_custom` naming; TeslaMate names things differently. Manual `entities:`
overrides may get you partial results, but that path is untested — see
[Requirements](../README.md#requirements).

### If the card can't tell which integration you have

An ambiguous or undetectable install falls back **deterministically to the
`tesla_fleet` dialect** rather than guessing — a conservative default that keeps
the card working. You can always force the dialect with `integration:`.

*To report a dialect gap usefully, include:* which **function** is wrong (e.g.
"windows"); the actual `entity_id` **and its domain** in your install; the
**integration and its version**; and **what the card shows versus what you
expect**. That's exactly what's needed to add or correct an alias.

---

## Asleep, wake & stale data

### The calm asleep state is not a fault

When the vehicle is offline the card **dims and shows its last-known values with
an "updated *N*m ago" stamp**, rather than a wall of *Unknown*. That's the
designed behaviour, not an error. The charging panel likewise reads **"Asleep"**
when the car is sleeping.

### The card never wakes the car on its own

To fetch fresher data the card will **never** issue a wake — waking a Tesla is
always **your explicit tap**. This is deliberate: Fleet wake commands are
metered, and silently waking the car to refresh a dashboard would drain that
budget. Tap **Wake** when you actually want fresh values.

### Why the numbers look old — and how freshness is judged

Age is measured against **Home Assistant's own server time** (the most-recent
stamp across all your entities), **not your browser clock** — so a wrong clock on
your laptop can't manufacture fake staleness. Thresholds vary by quantity:

- Most values: **fresh** up to ~5 min, and only genuinely idle (no update for
  ~30 min) reads as **asleep**.
- **Odometer** tolerates about an hour before it's "stale" — it only advances
  while driving.
- **Speed** and **power** go stale within a minute — they move second-by-second,
  so a short gap already means the car stopped reporting.

A confident-but-old reading is shown **dimmed** rather than hidden — the card
prefers honest and stale over a false "everything's fine".

### Wake button behaviour

- **"Awake"** — the car is already online (or a wake is in flight). Wake is
  non-actionable here on purpose; the card won't fire a redundant wake.
- **"Available in 1m"** — you just pressed Wake and it's within the cooldown
  window (default **1 minute**, tunable via
  [`wake_cooldown`](../README.md#options)). Repeat taps inside that window are
  held so frantic tapping can't burn the metered wake budget.
- A **stale** "online" signal never locks you out — if the last-known online
  reading has itself gone stale, an explicit wake is still allowed.

### A command entity showing *unknown* in HA is normal

HA `button` entities (wake, honk, flash, HomeLink, keyless, boombox) have **no
state until first pressed**, and they **reset to `unknown` after every HA
restart**. So *unknown* in *Developer Tools → States* does **not** mean the
button is broken. The card knows this: a command only greys out when its entity
is **genuinely missing or `unavailable`** — never merely because it reads
`unknown`. (Wake additionally greys out while the car is online/waking, per
above.)

*If wake or freshness looks wrong, include:* whether the car is truly asleep
(check its online/status sensor in HA); the "updated … ago" text you see; whether
**Wake** is disabled or shows "Available in …"; and the wake button's entity
state in *Developer Tools → States*.

---

## Charging & states

The card reports three charging states, shown as the status word and the hero's
charge cue:

- **Parked** — disconnected, no cable.
- **Plugged-idle** — connected but not drawing power.
- **Charging** — actively charging.

On the **Fleet family** these derive from the integration's richer charging
status (7 raw states collapse into the three above); an empty status reads
**Idle**. On **`tesla_custom`** they come from the boolean-plus-cable
corroboration described under [Integration dialects](#integration-dialects) — so
if a `tesla_custom` car shows **Plugged-idle** when you expected *charging
complete*, that's expected.

**The charge-limit and charge-current sliders commit on release.** Drag the bar
and **let go** to send the change — the card fires the service call only on
release, so dragging never floods Home Assistant with a call per pixel. Their
min/max/step come from the underlying `number` entity, and a slider is disabled
when its entity is unavailable.

*If a charging state looks wrong, include:* the raw value of the charging-status
entity (*Developer Tools → States*); on `tesla_custom`, the charge-cable
sensor's state too; and your integration.

---

## Energy panel & My Home scene

### No Energy tab

The **Energy** tab appears **only when an energy site is detected** — that is,
when at least one of **solar / battery / grid / Wall-Connector power** resolves to
a live entity. If it's missing:

- Confirm the `powerwall` and/or `tesla_fleet` integration is actually exposing
  those power sensors (*Developer Tools → States* — look for object-ids
  containing `solar_power`, `battery_power`, `grid_power`, or the Wall Connector's
  power).
- Detection matches by **function-slug substring**, prefix-independent, and picks
  the **shortest matching id** that has a live state — so it works across naming
  schemes. If yours still isn't found, wire it explicitly under
  `energy.entities` — see [Energy panel](../README.md#energy-panel).
- If a site **is** detected but you'd rather hide the tab, set `energy.hide:
  true`.

### Flows draw in the wrong direction

The card takes each integration's **raw sign conventions at face value** (battery
negative = charging, grid positive = import) and **cannot detect a flipped
sensor**. A template or custom sensor that reports the opposite sign will draw
that flow backwards. **Fix it at the source: invert the sign in the template** —
see the sign notes in [Energy panel](../README.md#energy-panel). (The discrete
`grid_status` value is panel metadata, not a flow input, so it never affects flow
direction.)

### A My Home node is missing

Absent hardware means **no cell at all** — the scene never draws a ghost node for
something you don't have, so a missing node usually means it simply wasn't
detected. If you **do** have that hardware but it isn't showing, wire its entities
under `energy.entities` (or, for the scene, per-node overrides) so detection can
find it.

### The scene wants a wide column

`tc-my-home` is a **wide composition** — give it a **full-width dashboard
column**. On a phone it packs down to a single column with the Gateway bus
re-routed vertically, and on a narrow column the embedded vehicle cell's tabs
collapse to **icon-only** (it responds to its own width, not the viewport). The
embedded vehicle cell is a real `tesla-card`, so it honours your `default_panel`
and `hide_*` switches.

### Hidden-node advisory

When a node is hidden but its hardware is actually live, the scene shows a calm
**"detected but hidden"** advisory. It's on by default; set
`notify_hidden_detected: false` to silence it.

### A second Powerwall or car

Show more than one of a kind via `energy.nodes.instances` — see
[Customising the scene](../README.md#customising-the-scene).

*If energy detection looks wrong, include:* which power entities exist and their
object-ids (*Developer Tools → States*); your integration; and a screenshot of
the flow or the missing node.

---

## Editor issues

**Resume.** Each wizard step **saves as you go**, so closing the editor,
refreshing, or moving to another device resumes exactly where you left off. If a
step seems not to save, confirm the card is a stored/UI-mode card rather than
raw YAML you're hand-editing.

**"The editor broke after an HA update."** The editor is built on Home
Assistant's own `ha-form` / `ha-selector` components, which are **not a
guaranteed-stable public API**. An HA release that changes those internals can
break the editor UI, and the editor may need an update to match. Two things to
know:

- **An editor break never breaks the card's render.** The card and your saved
  config keep working; you can edit the YAML directly in the meantime.
- This is an **API-stability caveat, not a version cut-off** — every widget the
  editor uses predates the 2024.4.0 floor. See the editor note in
  [Visual editor & guided setup](../README.md#visual-editor--guided-setup).

**Reset to auto.** On any overridden entity, **Reset to auto** simply **removes
the override key** and hands the entity back to auto-detection — it doesn't write
a blank, it deletes.

*If the editor misbehaves, include:* your **HA version** (editor breaks correlate
with HA releases); which step/control; any console errors; and confirmation that
the card itself still renders.

---

## Appearance

**`paint: blue` (or `red`) looks garish.** When `paint` is a plain string, a
**literal CSS colour wins first** — and `blue`, `red`, `white`, `black`,
`silver`, and `grey`/`gray` are all valid CSS colour keywords. So `paint: blue`
renders **pure primary CSS blue (`#0000ff`)**, not the card's softer curated
preset. To get the muted preset instead:

- pass a **hex** (e.g. `paint: '#2a4f93'`), or
- use the **editor's swatch picker**, which writes the preset's hex for you, or
- use a preset name the card doesn't treat as a CSS literal — `charcoal`,
  `lightsilver`, `darkgrey`/`darkgray`, `brightred`, and `darkred` all resolve to
  their curated hex. (The card deliberately recognises only a small set of common
  CSS colour keywords as literals, so these names fall through to the presets —
  even though a browser would accept `darkred` or `darkgray` as CSS colours.)

The full preset list and the three `paint` forms are in [Paint](../README.md#paint).

**A custom image won't recolour.** `paint` tints only the **built-in EV render or
a layered `body:` render** — it has **no effect on a custom `image:`**, which
can't be tinted. For a photoreal render that still recolours, use a layered body
render — see [Recolorable car body](../README.md#recolorable-car-body).

**Theme override is card-only.** `appearance.theme` flips just **this card's**
palette; your dashboard's surrounding chrome is untouched, and **Default** is the
card's own dark look (no override written — it does **not** follow the
dashboard's theme). See [Theming](../README.md#theming).

*If colour looks wrong, include:* your exact `paint` value; whether you use the
built-in render, an `image:`, or a `body:` layer set; and a screenshot.

---

## Performance & privacy

- **One file, no polling.** The card ships as a single bundle
  (`dist/tesla-card.js`) whose only runtime dependencies are `lit` and `@mdi/js`.
  It reads state that's **already in the page** (`hass.states`) and recomputes on
  render — there are no timers polling in the background.
- **No phone-home.** The card **opens no network connection of its own**: it
  reads in-memory state and writes through **Home Assistant's own authenticated
  connection** (`card → HA → Tesla`). There's no telemetry and no analytics, and
  a **merge-blocking CI gate** enforces that no card-originated egress can be
  introduced.
- **The one edge case** is the **Location panel's map tiles**, which are fetched
  by Home Assistant's own map/Leaflet **outside the card's bundle** — the card
  just passes latitude/longitude. The precise claim and its enforcement are in
  [docs/privacy.md](privacy.md).

*If you hit a genuine performance problem, include:* your HA version and browser;
which panel or interaction is slow; and, if you can, a browser performance trace.

---

## Reporting an issue well

A good report is mostly a few facts pasted in. Please include:

- **Home Assistant version.**
- **Your Tesla integration and its version** (`tesla_fleet` / Teslemetry /
  Tessie / `tesla_custom` / legacy `tesla`).
- **The card version.** It's printed once in the browser console when the card
  loads — the `[tesla-card] v1.0.0`-style banner — and is also shown as the
  installed version in HACS.
- **What you see versus what you expect.**
- **Relevant entities** — the `entity_id`s involved and their current states from
  *Developer Tools → States*.
- **Any `[tesla-card]`-prefixed console warnings.** All of the card's own
  messages carry that tag, so filtering the console on `[tesla-card]` surfaces
  exactly its output.
- **Dashboard mode** — UI/storage or YAML.

Then [open an issue](https://github.com/mlmeehan/tesla-card/issues).

Contributors and the adventurous can also reproduce card behaviour with **no Home
Assistant at all** using the demo harness (`npm run dev`), which renders the card
against mock data — handy for isolating whether a problem is the card or the data
feeding it. See the [Development](../README.md#development) section.

---

_Last updated: 2026-07-20 · verified against Tesla Card v1.0.0._
