# Tesla Card

A Tesla-app-inspired vehicle card for Home Assistant, built for the
**Tesla Fleet** / **Teslemetry** integrations. Centred car render, circular
quick-action controls, and six purpose-built detail panels — a tappable
closures diagram, live charging controls, climate with seat heaters, tyre
pressures, a map, and the media player.

![Tesla Card — charging](docs/screenshot-charging.png)

## Features

- **Centred hero** — your car render front-and-centre with a live battery
  bar, charge-limit marker, charging shimmer, and a status line that reads
  *Charging · 1h 30m to 80%*, *Parked · Locked*, *Driving*, or *Asleep*.
- **Quick actions** — circular toggles for lock, climate, charge port, frunk,
  trunk, and sentry. Active controls light up in their own accent colour.
- **Closures diagram** — a top-down car schematic. Tap the frunk, trunk,
  windows, or charge port to open/close; doors show open/closed status; a
  centre lock glyph and a primary lock button keep it secure. No more a wall
  of identical buttons.
- **Charging** — battery summary, start/stop, draggable charge-limit and
  charge-current sliders, plus power / rate / energy / time-to-full / voltage.
- **Climate** — temperature stepper, per-seat heater cyclers (Off→Low→Med→High),
  steering-wheel heater, defrost, and cabin-overheat protection.
- **Tyres** — pressures laid out at each corner of the car with low-pressure
  warnings.
- **Location** — embedded OpenStreetMap with odometer, speed, power, and live
  ETA when a route is active.
- **Media** — now-playing, transport, and a volume slider.
- **Graceful asleep state** — when the vehicle is offline the card dims rather
  than showing a wall of *Unknown*.
- **Zero entity config** — auto-detects your Tesla device and resolves every
  entity by its stable function-name, so it works whatever your vehicle is
  called. Every key is still overridable.

## Screenshots

|  |  |  |
| :---: | :---: | :---: |
| ![Closures](docs/screenshot-closures.png) | ![Climate](docs/screenshot-climate.png) | ![Tyres](docs/screenshot-tyres.png) |
| Tappable **closures** diagram | **Climate** & seat heaters | **Tyre** pressures |
| ![Media](docs/screenshot-media.png) | ![Asleep](docs/screenshot-asleep.png) | ![Charging](docs/screenshot-charging.png) |
| **Media** player | Graceful **asleep** state | **Charging** controls |

## Installation

### HACS (recommended)

1. HACS → **⋮** → *Custom repositories*.
2. Add `https://github.com/mlmeehan/tesla-card` with category **Dashboard**.
3. Install **Tesla Card**, then reload your browser.

The resource is registered automatically. For YAML-mode dashboards add:

```yaml
resources:
  - url: /hacsfiles/tesla-card/tesla-card.js
    type: module
```

### Manual

1. Download `tesla-card.js` from the [latest release](https://github.com/mlmeehan/tesla-card/releases).
2. Copy it to `config/www/tesla-card.js`.
3. *Settings → Dashboards → ⋮ → Resources → Add* `/local/tesla-card.js` as a
   **JavaScript module**.

## Usage

```yaml
type: custom:tesla-card
name: Model Y
image: /local/model_y.png
```

Drop your car render (a transparent PNG works best) into `config/www/` and
point `image:` at it.

## Options

| Option               | Type    | Default          | Description                                          |
| -------------------- | ------- | ---------------- | ---------------------------------------------------- |
| `type`               | string  | —                | `custom:tesla-card` (required).                      |
| `name`               | string  | `Model Y`        | Vehicle name shown in the hero.                      |
| `image`              | string  | `/local/model_y.png` | Car render URL.                                  |
| `device`             | string  | _auto_           | Vehicle device id or name, if you have more than one Tesla. |
| `prefix`             | string  | _auto_           | Force the entity-id prefix slug (e.g. `model_y`). Rarely needed. |
| `default_panel`      | string  | `charging`       | One of `climate`, `charging`, `closures`, `tyres`, `location`, `media`. |
| `hide_quick_actions` | boolean | `false`          | Hide the circular quick-action row.                  |
| `hide_panels`        | boolean | `false`          | Hide the tabbed detail panels.                       |
| `hide_commands`      | boolean | `false`          | Hide the command buttons (wake/honk/flash/…).        |
| `entities`           | map     | _auto_           | Per-key entity overrides — see below.                |

### Entity resolution (automatic)

You normally **don't configure any entities**. The card finds your Tesla device
from the integration and resolves every value it needs by the entity's stable
function-name — the language-independent slug of its friendly name, e.g.
*Time to full charge* → `time_to_full_charge`. Only the device-name prefix of an
entity id varies between installs (`garage_model_y_…` vs `model_y_…` vs
`tesla_…`); the function-name does not, so matching on it works across
environments without hard-coded ids.

If you have **more than one Tesla**, point the card at the right one by device
name (or registry id):

```yaml
type: custom:tesla-card
device: Model Y          # or the device's name in Settings → Devices
```

### Entity overrides (escape hatch)

Auto-resolution falls back to sensible defaults, so overrides are only needed
when something is renamed unusually. Override only the keys that differ:

```yaml
type: custom:tesla-card
entities:
  battery_level: sensor.my_tesla_battery_level
  lock: lock.my_tesla_lock
  charge_limit: number.my_tesla_charge_limit
  # …any of the keys in src/const.ts
```

The full list of keys (≈80) lives in [`src/const.ts`](src/const.ts).

## Development

```bash
npm install
npm run build      # → dist/tesla-card.js
npm run watch      # rebuild on change
npm run typecheck  # strict tsc, no emit
npm run demo       # static server → http://localhost:8080/demo/
```

The `demo/` harness renders the card against a mock `hass` object (awake /
charging and asleep scenarios) with no Home Assistant required — handy for
visual work. Append `?panel=climate` or `?scenario=asleep` to jump straight to
a state.

## License

[MIT](LICENSE) © Mike Meehan. Not affiliated with Tesla, Inc.
