# Contributing to Tesla Card

Thanks for helping improve **Tesla Card** — a HACS-distributed Lovelace card for
Home Assistant. A few things worth knowing before you start:

- This is an **unofficial** community project — not affiliated with, endorsed, or
  supported by Tesla, Inc.
- It's **trade-dress-careful** by design: no Tesla artwork, badges, wordmarks,
  vendor colour names, or brand hex ships in this repo (a merge-blocking gate
  keeps it that way). New contributions must hold that line.
- The card ships as a **single dependency-light bundle** and makes **no network
  calls of its own** — both properties are enforced by CI, so keep them in mind
  when adding code.

## Development setup

Use **Node 20** (see [`.nvmrc`](.nvmrc)), then:

```bash
npm ci             # clean, lockfile-exact install
npm run dev        # Vite dev server → http://localhost:5173/  (no Home Assistant needed)
```

`npm run dev` serves the `demo/` harness with hot-reload, rendering the card
against a mock `hass` object (awake/charging and asleep scenarios) — so you can do
almost all development and visual work **without a running Home Assistant**. The
full harness URL-parameter contract is in the
[Development Guide](docs/development-guide.md).

## The verification ladder

Every change must keep all of these green — this is exactly what CI runs, in this
order:

```bash
npm run typecheck        # strict tsc, no emit
npm run typecheck:e2e    # type-check the Playwright suite too
npm run test             # unit tests (Vitest)
npm run lint             # the 8 merge-blocking structural gates (below)
npm run build            # → dist/tesla-card.js (must succeed)
npm run test:e2e         # Playwright end-to-end (offline demo harness)
```

`npm run ci:local` mirrors CI's own chain — clean install, both typechecks, the
8 gates, the test census, the build check, and CI-mode e2e — so you can catch
most failures before pushing. Run `npm run test` yourself for the unit suite
(CI runs it in its own job; `ci:local` doesn't include it).

The **8 lint gates**, in order, are: `no-bare-hass-states` → `no-cycle` →
`trade-dress-denylist` → `import-allowlist` → `no-network-egress` →
`version-sync` → `token-defined` → `no-planning-artifacts`. Each has a clear
message when it fails.

### The test census

The suite's test count is pinned in [`tests/test-census.json`](tests/test-census.json)
so that adding or removing tests is always a deliberate, reviewed change. When you
change the number of tests, regenerate and commit it:

```bash
npm run test:census -- --write   # regenerate tests/test-census.json
```

Commit the updated census alongside your test change, or the census gate fails.

## House rules (and why)

- **Never commit `dist/`.** It's a build artefact — the release build produces it,
  and committing it just creates noise and conflicts.
- **Keep the bundle dependency-free beyond `lit` + `@mdi/js`.** The
  `import-allowlist` gate freezes the runtime dependencies, which keeps the bundle
  small and the "no egress" guarantee auditable. Adding a runtime dependency is a
  design decision, not a casual one.
- **User-facing copy lives in [`src/strings.ts`](src/strings.ts).** One source of
  truth for wording — don't hard-code display text in components.
- **Log through [`src/log.ts`](src/log.ts).** It's the single sanctioned place the
  card calls `console.*`, and it prefixes a neutral `[tesla-card]` tag with no
  brand colour — never call `console.*` directly.
- **Use `var(--tc-*, fallback)` design tokens.** The token must be real *and*
  carry a fallback — two gates check this. Sanctioned hard-coded colours are
  documented in [architecture.md](docs/architecture.md); don't add new ones
  casually.
- **No Tesla trade dress.** Generic EV art only; no vendor names, badges,
  wordmarks, or brand hex — see [trade-dress.md](docs/trade-dress.md). The
  `trade-dress-denylist` gate enforces it.
- **No planning artifacts in this repo.** PRDs, stories, and retros live in a
  separate private planning repo; a gate blocks them from landing here.
- **British spelling** in code comments and docs (*colour*, *customise*,
  *behaviour*) — with the one deliberate exception **"tire"**, matching the Tires
  panel and the Tesla domain.
- **No time estimates** in docs or comments.

## Pull requests

- Keep diffs **small and focused** — one concern per PR.
- **Back behavioural claims with tests.** If you change what the card *does*, a
  test should prove it (and update the census).
- Make sure **all checks are green, including the Burn-In** job (which repeats the
  suite in one session to surface flakiness) before requesting review.
- Match the surrounding code's style and the warm, precise, plain-English voice of
  the existing copy and docs.

## Where to look next

- **[docs/development-guide.md](docs/development-guide.md)** — the full
  build/test/release workflow, the demo harness parameters, and how to add a
  component or an energy node.
- **[docs/architecture.md](docs/architecture.md)** — the invariants. Read
  **AR-6** (the single energy sign-convention authority) before touching
  anything under `src/flow/`.
- **[docs/index.md](docs/index.md)** — the map to the rest of the documentation.

## Licence

By contributing, you agree that your contributions are licensed under the
[MIT Licence](LICENSE), the same licence that covers this project.
