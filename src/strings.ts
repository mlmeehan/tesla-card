// Centralized user-facing copy for tesla-card (AR-18 / NFR-7).
//
// Single home for the card's OWN user-facing strings — visible text, button /
// command labels, panel & tab titles, fixed status terms, empty-/unavailable-
// state sentences, and state-bearing aria-labels. Components import named
// strings from here instead of inlining literals, so the card's voice is
// consistent and localizable later (English-first now).
//
// Voice is encoded AS the values (UX-DR18): fixed status terms verbatim,
// sentence-case buttons ("Start charging," not Title Case / SHOUTING), British
// "Tyres", honest staleness (never "Offline"). Do NOT reword on the move — these
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

  // Tab / panel titles. British "Tyres" (UX-DR18). Shared by the card chrome
  // (tesla-card.ts) and the editor's default-panel picker.
  tabs: {
    climate: 'Climate',
    charging: 'Charging',
    energy: 'Energy',
    closures: 'Closures',
    tyres: 'Tyres',
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
    idle: 'Idle', // empty status fallback (HA value via prettyText otherwise)
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

  tyres: {
    title: 'Tyre pressure',
    checkPressure: 'Check pressure',
    allNormal: 'All normal',
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
    // Flow-node chip labels (Story 4.3 HeroSvgRenderer) — the colour-blind-safe
    // text every edge carries alongside its kW (AC4: source is never hue-only).
    // Keyed by EnergyRole; "Wall connector" is the car-charging edge (no 6th
    // vehicle node — the Hero silhouette IS the vehicle).
    nodes: {
      solar: 'Solar',
      grid: 'Grid',
      powerwall: 'Powerwall',
      home: 'Home',
      wall_connector: 'Wall connector',
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
    // The note wraps a `<code>entities:</code>` element — split around it.
    noteBefore: 'Per-entity overrides are configured in YAML via the',
    noteAfter: 'map. All keys default to the standard Tesla Fleet / Teslemetry entity IDs.',
  },

  // Card-picker catalog copy (window.customCards) — judgment call: card-authored
  // copy, so centralized here for single-sourcing.
  card: {
    name: 'Tesla Card',
    description: 'A Tesla-app-inspired vehicle card for Tesla Fleet / Teslemetry.',
  },
} as const;
