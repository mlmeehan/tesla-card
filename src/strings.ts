// Centralized user-facing copy for tesla-card (AR-18 / NFR-7).
//
// Single home for the card's OWN user-facing strings — visible text, button /
// command labels, panel & tab titles, fixed status terms, empty-/unavailable-
// state sentences, and state-bearing aria-labels. Components import named
// strings from here instead of inlining literals, so the card's voice is
// consistent and localizable later (English-first now).
//
// Voice is encoded AS the values (UX-DR18): fixed status terms verbatim,
// sentence-case buttons ("Start charging," not Title Case / SHOUTING), American
// "Tires", honest staleness (never "Offline"). Do NOT reword on the move — these
// are the exact strings the components render today.
//
// OUT OF SCOPE (not here): entity-state values formatted by HA
// (`display`/`prettyText`/`hass.formatEntityState` — NFR-7 leaves that surface
// open), entity/function-key IDs (`const.ts`), units & glyph glue (`%`, `kW`,
// `A`, `·`, `°`, `min`). This is leaf data: imports nothing (keeps `no-cycle`
// trivially green and adds no presentation→data edge).

export const STRINGS = {
  // Fixed vehicle status terms (UX-DR18) — single-sourced, verbatim. Shared by
  // the hero status line and the closures lock state.
  status: {
    asleep: 'Asleep',
    charging: 'Charging',
    pluggedIdle: 'Plugged-idle', // connected, at rest (blue) — Story 3.4 / EXPERIENCE.md:134
    driving: 'Driving',
    reverse: 'Reverse',
    neutral: 'Neutral',
    parked: 'Parked',
    inMotion: 'In motion',
    locked: 'Locked',
    unlocked: 'Unlocked',
  },

  // Tab / panel titles. American "Tires" (UX-DR18). Shared by the card chrome
  // (tesla-card.ts) and the editor's default-panel picker.
  tabs: {
    climate: 'Climate',
    charging: 'Charging',
    energy: 'Energy',
    closures: 'Closures',
    tires: 'Tires',
    location: 'Location',
    media: 'Media',
  },

  hero: {
    defaultName: 'Model Y',
    tapToWake: 'Tap a command to wake', // honest asleep affordance (future wake citizenship, Story 5.4)
    openCharging: 'Open charging', // battery button aria-label (unknown-battery fallback)
    // State-bearing battery aria-label (UX-DR21 / EXPERIENCE.md:176 "Battery 64%,
    // opens charging") — composed at the call site with the SETTLED percent + '%'
    // glue: `${battery} ${pct}%, ${opensCharging}`.
    battery: 'Battery',
    opensCharging: 'opens charging',
    // Compact-cell lock/security chip (Story 11.2) — the second glance affordance
    // beside the battery readout. `opensClosures` mirrors `opensCharging` for the
    // chip's state-bearing aria tail ("Locked, opens closures"); the calm/default
    // state words reuse STRINGS.status.locked/.unlocked verbatim. `security.doorOpen`
    // / `.windowOpen` are the ONLY two new labels — a GENERIC SINGULAR (one word
    // regardless of how many are ajar; the closures panel carries per-door detail),
    // amber-escalated on the word (never hue alone). British-English, calm voice.
    opensClosures: 'opens closures',
    security: {
      doorOpen: 'Door open',
      windowOpen: 'Window open',
    },
    // Compact + asleep last-known qualifier (UX-DR18/21 honesty): the aria-label
    // marks a cached SoC as stale — "Battery 71% (last known), opens charging".
    lastKnown: '(last known)',
    // Honest last-updated hint (UX-DR18): "updated 47m ago" / "Just now". Never
    // "Offline"/"No connection" — an asleep car is fine, just idle.
    updatedPrefix: 'updated', // composed: `updated ${age} ago`
    ago: 'ago',
    justNow: 'Just now', // age < 1 min (or indeterminate-but-fresh)
    // State-bearing aperture nouns (Story 3.5) for the car render's aria-label:
    // "Model Y · open: frunk, door". Lower-case sentence-flow nouns (matching the
    // closures.parts convention). The hero says "liftgate" where closures says
    // "trunk" — honest to the DESIGN naming of the rear hatch.
    aperture: {
      open: 'open', // label prefix: `${name} · open: …`
      frunk: 'frunk',
      liftgate: 'liftgate',
      door: 'door',
      window: 'window',
    },
  },

  commands: {
    title: 'Commands',
    wake: 'Wake',
    honk: 'Honk',
    flash: 'Flash',
    homelink: 'HomeLink', // proper noun — single word
    keyless: 'Keyless',
    boombox: 'Boombox',
  },

  // Wake-citizenship affordance copy (Story 5.4 / AR-9 / UX-DR23). Calm + honest
  // (UX-DR18 — never "Offline"): the wake rests, it does not fail. `availableIn`
  // composes the state-bearing button name "Wake — available in 2m" and the
  // resting-reason line "Available in 2m" (capitalized at the call site). `woken…`
  // is the last-wake time co-located in the sparse-data triad.
  wake: {
    online: 'Awake', // car already online → wake non-actionable, no false state
    availableIn: 'available in', // composed: `${wake} — available in ${n}` / `Available in ${n}`
    wokenPrefix: 'Woken', // composed: `Woken ${age} ago` (reuses hero.ago)
    wokenJustNow: 'Woken just now', // last-wake age < 1 min
  },

  quickActions: {
    lock: 'Lock',
    climate: 'Climate',
    port: 'Port',
    frunk: 'Frunk',
    trunk: 'Trunk',
    sentry: 'Sentry',
  },

  charging: {
    start: 'Start charging',
    stop: 'Stop charging',
    chargeLimit: 'Charge limit',
    chargeCurrent: 'Charge current',
    idle: 'Idle', // empty status fallback (otherwise prettyText — unless the dialect's charging override covers the raw value, then the canonical STRINGS.status word; Story 16.1)
    power: 'Power',
    rate: 'Rate',
    added: 'Added',
    timeToFull: 'Time to full',
    voltage: 'Voltage',
    chargePort: 'Charge port',
    // Range-vs-% display toggle (Story 5.5 AC3). The "%" option shows the glyph
    // (glyph glue, not a string); `percent` is its SR-only accessible name.
    display: 'Display units', // segmented-toggle group aria-label
    percent: 'Percent', // % option SR name (visible glyph is "%")
    range: 'Range', // range option label (visible + SR)
    // Charge-target line (Story 5.5 AC3): the honest "Target N%" the car stops at.
    target: 'Target',
  },

  closures: {
    diagramLabel: 'Vehicle closures', // svg aria-label
    allClosed: 'All closed',
    openPrefix: 'Open', // `Open: frunk & trunk`
    openWord: 'open', // zone aria + `${n} open`
    closedWord: 'closed', // zone aria
    // Honesty-first three-state copy (Story 5.7 / UX-DR16/18): a closure we can't
    // confirm is `unknown`, never a false "closed". The status line surfaces this
    // instead of claiming "All closed"; the staleness stamp reuses the hero's
    // honest "updated Nm ago" copy (STRINGS.hero.updatedPrefix/ago/justNow).
    unknownWord: 'unknown', // zone aria for an unconfirmable closure (state-bearing)
    someUnconfirmed: 'Some closures unconfirmed', // status line when nothing is open but a closure is unknown
    lockUnavailable: 'Lock unavailable', // neutral lock name — never a confident "Unlocked" we can't read
    lockedTapToUnlock: 'Locked — tap to unlock',
    unlockedTapToLock: 'Unlocked — tap to lock',
    closeWindows: 'Close windows',
    ventWindows: 'Vent windows',
    hint: 'Tap the frunk, trunk, windows or charge port on the diagram to open or close. Doors are status-only.',
    // Tappable cover-zone labels (aria) — also the visible status-line nouns.
    zones: {
      frunk: 'Frunk',
      trunk: 'Trunk',
      windows: 'Windows',
      sunroof: 'Sunroof',
      chargePort: 'Charge port',
    },
    // Status-line nouns (lower-case, sentence-flow): "Open: frunk & front-left door".
    parts: {
      frunk: 'frunk',
      trunk: 'trunk',
      windows: 'windows',
      chargePort: 'charge port',
      doorFL: 'front-left door',
      doorFR: 'front-right door',
      doorRL: 'rear-left door',
      doorRR: 'rear-right door',
    },
  },

  climate: {
    lowerTemp: 'Lower temperature', // stepper aria
    raiseTemp: 'Raise temperature',
    setpoint: 'Target temperature', // stepper group aria-label (Story 5.6 — names the readout the live region announces)
    on: 'Climate on',
    off: 'Climate off',
    climate: 'Climate', // base noun for the on/off pill's state-bearing accessible name ("Climate, on")
    heater: 'heater', // seat/wheel cycler accessible-name suffix ("Front L heater, High") — lower-case, mid-name
    stateOn: 'on', // settled boolean state word for aria (toggles) — sentence-flow
    stateOff: 'off',
    seatHeating: 'Seat & wheel heating',
    inside: 'Inside',
    outside: 'Outside',
    defrost: 'Defrost',
    cabinOverheat: 'Cabin overheat',
    seats: {
      fl: 'Front L',
      fr: 'Front R',
      wheel: 'Wheel',
      rl: 'Rear L',
      rc: 'Rear C',
      rr: 'Rear R',
    },
  },

  tires: {
    title: 'Tire pressure',
    checkPressure: 'Check pressure',
    allNormal: 'All normal',
    // Freshness-honest summary (Story 5.8 / UX-DR18): shown instead of a confident
    // "All normal" when a present corner is stale/unconfirmable — never claim an
    // all-clear we cannot confirm. The per-corner staleness stamp reuses
    // STRINGS.hero.updatedPrefix/ago/justNow (no duplicate age copy).
    someUnconfirmed: 'Some readings unconfirmed',
    noData: 'No data',
    low: 'Low',
    corners: {
      fl: 'Front L',
      fr: 'Front R',
      rl: 'Rear L',
      rr: 'Rear R',
    },
  },

  media: {
    notPlaying: 'Not playing',
    defaultTitle: 'Tesla audio',
    idle: 'Media player idle',
    previous: 'Previous', // transport aria
    play: 'Play',
    pause: 'Pause',
    next: 'Next',
    mute: 'Mute',
    volume: 'Volume', // slider SR label (UX-DR21 state-bearing name)
  },

  location: {
    mapLabel: 'Vehicle location', // iframe title + empty-state aria intent
    unavailable: 'Location unavailable',
    openMap: 'Open map',
    toArrival: 'To arrival',
    eta: 'ETA',
    traffic: 'Traffic',
    none: 'None',
    odometer: 'Odometer',
    speed: 'Speed',
    power: 'Power',
  },

  energy: {
    title: 'Power flow',
    flowLabel: 'Energy power flow', // svg aria-label
    reserve: 'Reserve',
    mode: 'Mode',
    session: 'Session',
    connector: 'Connector',
    connected: 'Connected',
    unplugged: 'Unplugged',
    // Flow-node chip labels (shared by SceneBusRenderer, panel-energy.ts and
    // my-home.ts) — the colour-blind-safe text every edge carries alongside its
    // kW (AC4: source is never hue-only). Keyed by EnergyRole; "Wall connector"
    // is the car-charging edge (no 6th vehicle node — the silhouette IS the vehicle).
    nodes: {
      solar: 'Solar',
      grid: 'Grid',
      powerwall: 'Powerwall',
      home: 'Home',
      wall_connector: 'Wall connector',
      generator: 'Generator',
    },
  },

  // Standalone ecosystem cards (Epic 6 — Solar/Powerwall/Grid/Home). Per-card
  // description + calm empty-state sentence (UX: "a calm, specific sentence, not
  // a generic stub") + the human-readable RAW-sign direction labels. Card TITLES
  // and node names reuse `STRINGS.energy.nodes.*` (Solar/Powerwall/Grid/Home —
  // identical, not duplicated here); stat labels reuse `STRINGS.energy.reserve`/
  // `.mode`. The direction words live per-card because each card's flow means a
  // different thing (grid import/export vs Powerwall charge/discharge).
  ecosystem: {
    // Detail-layout chrome shared by every ecosystem card (Story 8.1). The
    // deep-link chip navigates to HA's built-in Energy dashboard (`/energy`);
    // `sensorTag` honestly marks read-only Sensor cards (UX-DR24) in the header.
    deepLink: 'Open Energy dashboard',
    sensorTag: 'Sensor',
    // Inline history charts (Story 8.3, FR-36). Titles for the two chart slots +
    // the calm empty-state caption (shown when history is absent/short/failed —
    // never a fabricated curve). `weekdays` (Sun-indexed, `Date.getDay()`) labels
    // the multi-day bars without an Intl dependency.
    chartTodayTitle: 'Today',
    chartHistoryTitle: 'Last 7 days',
    chartEmpty: 'No recent history',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    solar: {
      description: 'Standalone solar production card.',
      empty: 'No solar production reported yet.',
      production: 'Production',
      // Detail stat-grid tile labels (Story 8.1) — cumulative energy totals.
      generated: 'Generated',
      exported: 'Exported',
      // Live weather vignette (Story 6.4). All copy centralized here (no inline
      // literals in the component). `names` is keyed by the day/night-RESOLVED
      // WeatherScene (mirrors the mockup's NAMES map); the renderer looks up a
      // human-readable condition label by scene. `provenanceSep` joins the two
      // honest source ids in the provenance chip (`weather.home · sun.sun`).
      weather: {
        provenanceSep: ' · ',
        names: {
          'clear-day': 'sunny',
          'clear-night': 'clear night',
          'partlycloudy-day': 'partly cloudy',
          'partlycloudy-night': 'partly cloudy',
          cloudy: 'cloudy',
          rainy: 'rainy',
          pouring: 'pouring',
          snowy: 'snowy',
          'lightning-rainy': 'thunderstorm',
        },
      },
    },
    powerwall: {
      description: 'Standalone Powerwall charge & flow card.',
      empty: 'No Powerwall data reported yet.',
      charging: 'Charging',
      discharging: 'Discharging',
      idle: 'Idle',
      charge: 'Charge', // SoC ring sub-label
      // Detail stat-grid tile labels (Story 8.1) — cumulative energy totals.
      charged: 'Charged',
      discharged: 'Discharged',
      // ── Story 8.4 control surface ────────────────────────────────────────
      // The Powerwall's two genuine write controls (operation_mode select +
      // backup_reserve number). `operationMode` names the segment group;
      // `backupReserve` labels the slider block. `modes` maps the raw tesla_fleet
      // select options to friendly display copy — an unknown/future option falls
      // back to prettyText() at the call site (honest + forward-compatible).
      operationMode: 'Operation mode',
      backupReserve: 'Backup reserve',
      modes: {
        self_consumption: 'Self-Powered',
        backup: 'Backup',
        autonomous: 'Time-Based',
      },
    },
    grid: {
      description: 'Standalone grid import/export card.',
      empty: 'No grid data reported yet.',
      importing: 'Importing',
      exporting: 'Exporting',
      idle: 'Idle',
      // Detail stat-grid tile labels (Story 8.1) — cumulative energy totals
      // (nouns, distinct from the present-tense direction words above).
      imported: 'Imported',
      exported: 'Exported',
    },
    home: {
      description: 'Standalone home consumption card.',
      empty: 'No home consumption reported yet.',
      consumption: 'Consumption',
    },
    // Wall Connector (Story 6.3 — the fifth/final ecosystem card). Card TITLE
    // reuses `STRINGS.energy.nodes.wall_connector` ("Wall connector"); the
    // connector status detail reuses `STRINGS.energy.connected`/`.unplugged`.
    // The three state words live here because they are the card's derived
    // three-state classification (available/connected/charging).
    wallConnector: {
      description: 'Standalone Wall Connector state, power & session card.',
      empty: 'No Wall Connector data reported yet.',
      available: 'Available',
      connected: 'Connected',
      charging: 'Charging',
      // Detail stat-grid tile labels (Story 8.1) — live measurement readings.
      voltage: 'Voltage',
      frequency: 'Frequency',
      temperature: 'Temperature',
    },
    // Generator (Story 9.14 — the first new node TYPE). Card TITLE reuses
    // `STRINGS.energy.nodes.generator` ("Generator"). `output` labels the lead
    // power readout; `running`/`idle` are the card's two-state direction words
    // (a generator either produces or is at rest — no import/export polarity).
    generator: {
      description: 'Standalone backup/standby generator output card.',
      empty: 'No generator data reported yet.',
      output: 'Output',
      running: 'Running',
      idle: 'Idle',
    },
  },

  // "My Home" Scene (Story 6.5 — the suite centrepiece, `tc-my-home`). Picker
  // copy + the composed-view group aria-label. Node chip labels + the bus
  // overlay aria-label are NOT here: they reuse `STRINGS.energy.nodes.*` and
  // `STRINGS.energy.flowLabel` (composed by `SceneBusRenderer.label()`) — never
  // duplicated.
  scene: {
    name: 'My Home',
    description: 'Composed live energy Scene — Solar, Powerwall, Grid, Home & Wall Connector on one shared flow model.',
    // Group label for the composed container (the live overlay carries its own
    // state-bearing label from the renderer).
    label: 'My Home energy scene',
    // Summary-ribbon copy (Story 8.7 — enriched from the 6.6 Gen/Cons/Net trio).
    // The ribbon now LEADS with a whole-home "self-powered now %" (the share of
    // consumption NOT met by grid import) + an honest sub-line, followed by one
    // per-node tile per present role. Every figure is derived from the ONE
    // `computeBalance` net the bus walks — ribbon and bus agree by construction.
    // The old `generation`/`consumption`/`net`/`importing`/`exporting`/
    // `selfSupplied` trio copy was REPLACED (the lead % subsumes Net; the per-node
    // tiles subsume Generation/Consumption).
    ribbon: {
      /** The lead-block cap. */
      selfPowered: 'Self-powered now',
      /** The sub-line join — `"7.6 of 11.6 kW"` (single token, no interpolation). */
      coveringOf: 'of',
      /** The grid tile's directional suffix — `"4.0 kW in"` / `"1.2 kW out"`. */
      in: 'in',
      out: 'out',
      /** Per-role tile labels: `powerwall`→"Battery", `wall_connector`→"Car" (the
       *  WC-edge-is-car-charging authority — the vehicle is never a flow node). */
      tile: {
        solar: 'Solar',
        powerwall: 'Battery',
        grid: 'Grid',
        home: 'Home',
        wall_connector: 'Car',
        generator: 'Generator',
      },
      unit: 'kW',
      /** The folded-instance accessible-name tail (Story 9.7 / INV-9) — e.g. the tile
       *  for two arrays announces "Solar, 2, 3.2 kW total" so the sum is never silent. */
      total: 'total',
    },
    /**
     * Story 9.8 (AC8) — the defensive overflow notice. Shown ONLY when a band exceeds the
     * safe wrap capacity (2 sub-rows) AND the excess cards carry NO live flow (|net| ≈ 0):
     * those dead cards are hidden behind an honest "N cards hidden · Show all" toggle to
     * keep overflow legs off the primary cards. A card with ANY live kW is NEVER hidden
     * (clamping a live source would fabricate a phantom — INV-1); the normal ≤2-sub-row
     * wrap shows no notice.
     */
    overflow: {
      /** `"2 cards hidden"` — the count (>1) of dead cards clamped from this band. */
      hidden: 'cards hidden',
      /** The singular form — `"1 card hidden"` (exactly one dead card clamped). */
      hiddenOne: 'card hidden',
      /** The reveal toggle (un-clamps and shows every card). */
      showAll: 'Show all',
      /** The re-clamp toggle (back to the calm hidden state). */
      showFewer: 'Show fewer',
    },
    /**
     * Story 9.10 (AC7/AC8/AC9) — the calm "detected-but-hidden" advisory the card
     * surfaces when discovery finds a LIVE entity for an instance whose card the
     * user hid (`energy.nodes.hide`). Honest, never nagging: states a fact + offers
     * the off switch, never the red alarm role, never animation, never auto-rearrange.
     * Per-instance, labelled by card title. The live region is named; the inline
     * dismiss is disambiguated per instance.
     */
    hiddenNotice: {
      /** The named live region (`role="status"` / `aria-live="polite"`). */
      region: 'Detected-but-hidden notice',
      /** The per-instance line tail — composed `${label} ${detectedSuffix}` →
       *  "Solar · South Array detected — its card is hidden." (`label` is the
       *  title-disambiguated role name, joined by the Scene's `${role} · ${title}`). */
      detectedSuffix: 'detected — its card is hidden.',
      /** The inline dismiss button name — composed `${dismiss} ${label} ${noticeWord}`
       *  → "Dismiss Solar · South Array notice" (disambiguated per instance). */
      dismiss: 'Dismiss',
      noticeWord: 'notice',
    },
  },

  editor: {
    vehicleName: 'Vehicle name',
    namePlaceholder: 'Model Y',
    imageUrl: 'Car image URL',
    imagePlaceholder: 'Leave empty for built-in car',
    defaultPanel: 'Default panel',
    hideQuickActions: 'Hide quick actions',
    hidePanels: 'Hide detail panels',
    hideCommands: 'Hide commands',
    // ── My-Home Scene node customization (Story 9.4, CAP-5 Pillar 4) ──────────
    // The editor surface for the Story 9.1 `energy.nodes.{hide,order}` keys.
    // The six node display names reuse `STRINGS.energy.nodes.*` for the five
    // energy roles; `vehicle` has NO key there (the Hero silhouette IS the
    // vehicle), so its label is sourced here.
    sceneNodesHeading: 'My Home Scene cards',
    sceneNodesShowHint: 'Uncheck a card to hide it from the Scene.',
    sceneNodesOrderHeading: 'Card order',
    sceneNodesOrderHint:
      'Reorder cards left-to-right within their row. Sources and loads stay grouped.',
    moveNodeUp: 'Move earlier',
    moveNodeDown: 'Move later',
    nodeVehicle: 'Vehicle',
    // ── Cross-row promotion (Story 9.15) — assign a node to the Source or Load row ──
    sceneNodesRowLabel: 'Row',
    rowSource: 'Source',
    rowLoad: 'Load',
    // The note wraps a `<code>entities:</code>` element — split around it.
    noteBefore: 'Per-entity overrides are configured in YAML via the',
    noteAfter: 'map. All keys default to the standard Tesla Fleet / Teslemetry entity IDs.',
    // ── Guided first-run re-entry (Story 9.9) ─────────────────────────────────
    // The normal-form action that re-opens the wizard (explicit, distinct from the
    // bare-config auto-trigger). An `@mdi/js` named-path icon sits alongside it.
    runGuidedSetup: 'Run guided setup',
    // ── Normal-form discovery summary (Story 9.10) ────────────────────────────
    // The persistent "Detected on your system" section pinned at the top of the
    // normal form. Role names reuse `NODE_LABELS` (energy.nodes.* + nodeVehicle);
    // the four state words reuse `STRINGS.wizard.detect.{online,unavailable,noData,
    // notFound}` (one shared vocabulary with the wizard Step-1 checklist). The
    // remap-chevron is a labelled button — composed `${remap} ${role}` ("Remap Solar")
    // — the 9.11 per-entity-remap entry seam (9.10 ships the affordance only).
    detectedHeading: 'Detected on your system',
    remap: 'Remap',
    // ── Per-entity remap picker (Story 9.11) ──────────────────────────────────
    // The accordion picker drops into the 9.10 chevron slot. `resetAuto` labels the
    // one-tap revert (shown only when an override is set) — composed `${resetAuto}
    // ${label}` → "Reset to auto Solar". The `— not found` row's chevron is a
    // map-a-miss affordance, composed `${mapManuallyPrefix} ${label}
    // ${mapManuallySuffix}` → "Map Wall connector manually". `remapMapped` composes
    // the polite live-region announcement after a pick — `${label}, ${remapMapped} —
    // ${stateWord}` → "Solar, mapped — unavailable" (honest dead-pick, never icon-only).
    resetAuto: 'Reset to auto',
    mapManuallyPrefix: 'Map',
    mapManuallySuffix: 'manually',
    remapMapped: 'mapped',
    // ── Detected-but-hidden global toggle (Story 9.10, D-9.10-3) ──────────────
    // Opts out of the card-side advisory entirely. A real on/off switch in the
    // editor; the card reads `notify_hidden_detected` to gate the banner.
    notifyHiddenDetected: 'Notify me about detected-but-hidden products',
    // ── Appearance & theming pickers (Story 9.12, D-9.12) ─────────────────────
    // The "Make it yours" surface: paint swatches + a free hex, a card-only
    // Default/Light/Dark theme override, and a present-gated default-panel chooser,
    // over one full-card live preview. British English, calm/plain/honest voice
    // (no hype, no exclamation). Paint labels are GENERIC (no vendor names ship).
    // `announcePrefix` composes the polite live-region update naming the resolved
    // appearance — `${announcePrefix}, ${paint}, ${theme}, ${panel}`.
    appearance: {
      heading: 'Appearance',
      livePreview: 'Live preview',
      paintLabel: 'Paint',
      themeLabel: 'Theme',
      panelLabel: 'Default panel',
      paintWhite: 'White',
      paintSilver: 'Silver',
      paintBlue: 'Deep blue',
      paintBlack: 'Black',
      paintRed: 'Red',
      paintGreen: 'Green',
      paintDefault: 'default paint',
      // Story 10.1 (My-Home variant): the default panel is the EMBEDDED vehicle's
      // opening tab (the Scene itself has no tab bar). `panelLabelMyHome` /
      // `panelNoteMyHome` reframe the present-gated picker.
      panelLabelMyHome: "Vehicle's opening tab",
      panelNoteMyHome: 'The embedded vehicle card opens on this tab.',
      hexLabel: 'Custom hex',
      hexNote: 'Any colour is accepted exactly as typed — never blocked or changed.',
      // Labelled "Default", not "Auto": picking it deletes the key — the card keeps
      // its own dark look and never follows the dashboard theme, so "Auto" would
      // falsely promise adaptivity. (The config VALUE stays 'auto'.)
      themeAuto: 'Default',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeAutoSub: "Light or Dark recolours only this card's surfaces — the dashboard is untouched.",
      panelNote: 'Only panels available for this card are listed.',
      resetDefault: 'Reset to default',
      announcePrefix: 'Preview',
    },
    // ── Tune controls (Story 9.13, D-9.13-1d) ─────────────────────────────────
    // The "Tune" group: tire-pressure units + thresholds, the panel/card hide
    // toggles (re-homed here from their old standalone checkboxes), and Powerwall
    // control visibility — each on its pinned `ha-selector` widget. British English,
    // calm/plain/honest voice (no hype). `announcePrefix` composes the polite
    // live-region update after a Tune change. Labels are per-card globals — NEVER
    // suffixed with a D15 instance title (that disambiguation is the entity pickers'
    // alone). The number field's unit + min/max announcement ("Recommended pressure,
    // bar, range 1.5–4") is composed in `editor.ts` `_renderTune` from the chosen unit
    // and the `tuneNumberRanges` bounds — no separate string key needed.
    tune: {
      heading: 'Tune',
      tireUnitsLabel: 'Tire pressure units',
      tireUnitsAuto: 'Auto (sensor unit)',
      recommendedLabel: 'Recommended pressure',
      marginLabel: 'Warn margin',
      hidePowerwallControls: 'Hide Powerwall controls',
      announcePrefix: 'Tune',
      // Story 10.1 (My-Home variant, D-10.1-3): the three vehicle-tab toggles
      // (hide_quick_actions / hide_panels / hide_commands) are honest governors of the
      // embedded `tesla-card` cell the Scene composes — RELABELED (not suppressed) under
      // this real text heading so they read as the embedded car's controls, not Scene-wide.
      embeddedVehicleHeading: 'Embedded vehicle cell',
      embeddedVehicleSub: 'These control the vehicle card shown inside the Scene.',
    },
  },

  // Guided first-run wizard (Story 9.9 / CAP-5 — the no-YAML first-run flow).
  // British English, calm/plain/honest voice: no hype, no exclamation, no
  // celebration. `strings.test.ts` pins the voice. Step content owned by siblings
  // (remap 9.11, appearance 9.12, Tune 9.13) — this is the frame's copy only.
  wizard: {
    /** Dialog accessible name. */
    title: 'Set up your card',
    // The five stepper node labels (uppercased in CSS) — DETECT · CONFIRM ·
    // APPEARANCE · TUNE · FINISH. The advancing 5-node stepper, never a static header.
    steps: {
      detect: 'Detect',
      confirm: 'Confirm',
      // Story 10.1: the My-Home variant RELABELS the `confirm` step to "Compose"
      // (same StepKey slot, content swapped). The five-step count never changes.
      compose: 'Compose',
      appearance: 'Appearance',
      tune: 'Tune',
      finish: 'Finish',
    },
    // Non-visual stepper position announcement, composed at the call site:
    // `${stepWord} ${n} ${of} 5, ${label}, ${state}` → "Step 2 of 5, Confirm, current".
    stepWord: 'Step',
    of: 'of',
    stateCurrent: 'current',
    stateDone: 'done',
    stateNotStarted: 'not started',
    // Footer controls. `next`/`back`/`skip` are the nav trio; `finishNow` is the
    // persistent early-escape (writes remaining defaults) present on EVERY step;
    // `done` completes the Finish step (distinct from `finishNow` — never conflate).
    back: 'Back',
    skip: 'Skip',
    next: 'Next',
    finishNow: 'Finish now',
    done: 'Done.',
    // Skip announces the default it will apply (never a bare "Skip"). Composed:
    // `${skip} — ${default}`. One honest default sentence per skippable step.
    skipPrefix: 'Skip',
    // ── Step 1 — Detect & discover ────────────────────────────────────────────
    detect: {
      heading: 'Detect & discover',
      subhead: 'Looking for your vehicle and energy devices.',
      // The four honest discovery states (CAP-4 / Story 9.10) — announced in TEXT,
      // never hue-only. `noData` (`unknown` state) is a sibling of `unavailable`:
      // SAME amber ⚠ marker, a distinct "no data yet" sub-label (connected, no value
      // yet — not absent, not dead). `online` attests REACHABLE, never AWAKE (a
      // sleeping car with a present-but-stale state object still reads ✓ — freshness
      // stays the card's job, never overstated in discovery).
      online: 'online',
      unavailable: 'unavailable',
      noData: 'no data yet',
      notFound: 'not found',
      // Empty/fail state — never a fake "all set", never an endless spinner.
      emptyTitle: 'Nothing detected yet',
      emptyBody: 'No Tesla or energy entities detected. Check that your integration is set up.',
      selectManually: 'Select entities manually',
      skipDefault: 'accept the detected devices',
      // When discovery is empty there is nothing to "accept" — Skip just defers setup;
      // the `skipDefault` label would otherwise claim a false action (review fix).
      skipEmpty: 'skip setup for now',
    },
    // ── Step 2 — Confirm & remap (container; controls are Story 9.11) ──────────
    confirm: {
      heading: 'Confirm & remap',
      subhead: 'These are the cards we will show. They look right by default.',
      skipDefault: 'keep the detected mapping',
      // Empty-discovery manual fallback (review fix): when NOTHING auto-resolves, the
      // Confirm step surfaces the unfiltered map-a-miss picker for every role so the
      // user can map entities with no YAML (9.9 AC2 — a real manual route, never a
      // fake "all set" / a dead end).
      manualHeading: 'Map your entities',
      manualSubhead: 'Nothing was detected automatically. Pick the entity for each card.',
    },
    // ── Step 2 (My-Home variant) — Compose (Story 10.1, D-10.1-1) ─────────────
    // The Scene card's `confirm` step is RELABELED to Compose: map each node's entity
    // (the 9.11 picker rows) AND arrange the Scene (hide / Source-Load row / reorder —
    // the controls that exist today). Same StepKey slot, content swapped. Calm/honest
    // voice. The vehicle wizard never sees this — it keeps its Confirm step.
    compose: {
      heading: 'Compose your Scene',
      subhead: 'Map each card to its entities, then arrange the Scene.',
      skipDefault: 'keep the detected cards and layout',
    },
    // ── Step 3 — Make it yours / appearance (container; pickers are Story 9.12) ─
    appearance: {
      heading: 'Make it yours',
      subhead: 'Name, paint and theme. Skip to keep the calm defaults.',
      skipDefault: 'keep the default appearance',
    },
    // ── Step 4 — Tune (optional; widgets are Story 9.13) ──────────────────────
    tune: {
      heading: 'Tune',
      subhead: 'Optional fine-tuning — units, thresholds and what to show.',
      skipDefault: 'keep the standard settings',
    },
    // ── Step 5 — Finish ───────────────────────────────────────────────────────
    finish: {
      heading: 'Finish',
      subhead: 'Here is your card. Open it any time to adjust.',
      skipDefault: 'finish now',
    },
    // Trade-dress: the ONLY mark in wizard chrome (no Tesla marks, no HA copyright).
    disclaimer: 'Not affiliated with Tesla, Inc.',
  },

  // Card-picker catalog copy (window.customCards) — judgment call: card-authored
  // copy, so centralized here for single-sourcing.
  card: {
    name: 'Tesla Card',
    description: 'A Tesla-app-inspired vehicle card for Tesla Fleet / Teslemetry.',
  },
} as const;
