# Privacy — no network egress, no telemetry (gate + human review)

**The card makes no network egress of its own and sends no telemetry.** It opens
no socket of its own, embeds no analytics SDK, phones home to nobody, and your
vehicle's GPS never leaves your Home Assistant instance via this card. You can
trust it with your car's **location** (the `panel-location` map) on that basis.

How the card actually moves data:

- **Reads `hass.states`** — in-memory state already on the page. Not a network
  call. The location map renders from the vehicle's GPS *attributes* in
  `hass.states`; it does not itself fetch map tiles from card code (Home
  Assistant's map / Leaflet handles its own tiles outside the card's bundle — the
  card just passes lat/long).
- **Writes via `hass.callService(...)`** — lock/unlock, climate, charging, media,
  etc. These ride **Home Assistant's own authenticated connection** (the
  WebSocket/REST link the HA frontend already established): the path is
  **card → HA → Tesla**, never a socket the card opened.

This is the distinction that matters: the claim is **no card-originated egress /
no telemetry**, *not* "the card never causes any byte to leave HA." Causing HA to
talk to your car on your behalf is the entire point of a Lovelace card. The
**forbidden** thing is the card opening its *own* connection to phone home.

This is enforced in **two layers** — an automated gate and human review. The gate
is **necessary, not sufficient**: a static scan can see the AST of the card's own
source, but it **cannot see obfuscated access** (`window['fet'+'ch']`), code run
through `eval` / `new Function`, or egress buried inside a transitively-imported
third-party runtime dependency. Those are caught by Layer 2.

## Layer 1 — the automated gate (merge-blocking)

`scripts/lint/no-network-egress.mjs`, wired into `npm run lint` (5th gate, after
`no-bare-hass.states` → `no-cycle` → `trade-dress` → `import-allowlist`) and the
merge-blocking `lint` job in `.github/workflows/validate.yml` (same tier as
type-check / build). It scans the **bundled runtime graph** — non-test
`src/**/*.ts`, reachable from the Rollup entry `src/tesla-card.ts` (including the
lazily-`import('./editor')`'d editor) — and **fails the build** on any direct
browser network primitive:

- **`fetch(...)`** — the bare global, or a `window` / `globalThis` / `self`-qualified
  `fetch(...)`.
- **`navigator.sendBeacon(...)`**.
- **`new XMLHttpRequest()`**, **`new WebSocket(...)`**, **`new EventSource(...)`**,
  **`new RTCPeerConnection(...)`** — bare or global-qualified.

The denylist inside the script is a small named set — adding a primitive later is
a one-line edit; never weaken it silently.

Detection uses the already-installed **TypeScript AST** (no ESLint, no new
dependency), mirroring `import-allowlist.mjs` / `no-cycle.mjs`. That gives **zero
false-positives** from the word `fetch` in a string (`'fetch data'`), a comment,
or an identifier like `prefetch` / `refetch`, and lets the gate distinguish a
**bare global `fetch(...)`** (forbidden) from a **method named `fetch` on some
object** (`this.fetch()`, `store.fetchState()` — fine, not flagged). The sanctioned
`hass.*` channels are simply not in the denylist, so they pass naturally; type
positions are AST type nodes, never call/new expressions, so they never match.

### Scope and what the gate deliberately does NOT scan

**Out of scope** (never flagged): `*.test.ts` (Vitest specs legitimately use
`execFileSync` / `node:*`), `scripts/` (the gates themselves), `tests/` (Playwright
E2E), `src/fixtures/*.json`, and config files. The gate never walks outside `src/`
and drops `.test.ts` via the shared `collectTs` filter — it constrains only the JS
that actually ships in `dist/tesla-card.js`.

The card already complies today: the only outbound call anywhere in `src/` is
`hass.callService`, so the gate ships **green**. Its value is making future drift
**impossible to merge**.

## Layer 2 — human review

A static scan can't catch every vector. When a change touches the network surface
or adds runtime code, a reviewer should confirm:

- [ ] No obfuscated or dynamically-constructed access to a network primitive
      (per the obfuscation examples in the intro above).
- [ ] No new runtime dependency that itself phones home (the `import-allowlist`
      gate freezes runtime deps to `{lit, @mdi/js}`, but eyeball any change there).
- [ ] No analytics / telemetry / "usage ping" added under any name.
- [ ] All outbound traffic still rides Home Assistant's connection
      (`hass.callService` / `callWS` / `callApi` / `connection.*`) — never a socket
      the card opens itself.

_(AR-17 — privacy affirmation. The card reads vehicle location and the design
implied, but never stated, "no network egress / no telemetry"; this makes it
explicit on the page and enforced by CI.)_
