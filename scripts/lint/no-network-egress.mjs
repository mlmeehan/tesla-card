#!/usr/bin/env node
// no-network-egress gate — Story 2.8 (AR-17 privacy affirmation · 5th structural gate).
//
// Merge-blocking PRIVACY policy: the bundled card opens NO network connection of
// its own and ships NO telemetry. It reads `hass.states` (in-memory) and writes
// via `hass.callService` — both ride Home Assistant's OWN authenticated connection
// (card → HA → Tesla). This gate fails the build on any DIRECT browser network
// primitive in the bundled `src/` runtime graph, so a future contributor (human or
// agent) can never merge a `fetch('https://analytics…')` / `navigator.sendBeacon`
// "phone-home" past CI. The codebase already complies today (zero forbidden forms);
// the gate's value is blocking FUTURE drift, not fixing a present violation.
//
// DENYLIST (the six forbidden primitives — direct, card-originated egress):
//   • `fetch(...)`            — bare global `fetch`, or `window`/`globalThis`/`self`-qualified
//   • `navigator.sendBeacon(...)`
//   • `new XMLHttpRequest()`  — bare or `window`/`globalThis`/`self`-qualified
//   • `new WebSocket(...)`    — "
//   • `new EventSource(...)`  — "
//   • `new RTCPeerConnection(...)` — "
// Maintained as named sets below; adding a primitive later is a one-line edit.
//
// SANCTIONED — NEVER flagged (the card → HA → Tesla path): `hass.callService`,
// `hass.callWS`, `hass.callApi`, `hass.connection.*`, `hass.fetchWithAuth`, and
// reading `hass.states`. These ride HA's existing authenticated WebSocket/REST
// connection (established by the HA frontend, not a socket the card opened) — they
// are not in any denylist set, so they pass naturally. Talking to your own HA
// instance is the entire point of a Lovelace card; the claim is "no card-originated
// egress / no telemetry", NOT "the card never causes any byte to leave HA".
//
// PRECISION (AC3): `fetch` flags ONLY when the callee is an unqualified `Identifier`
// or a `window`/`globalThis`/`self`-qualified property access — a method named
// `fetch` on some other object (`this.fetch()`, `x.fetch()`, a future `data/`
// helper `fetchState()`) is NOT egress and is NOT flagged. Detection is via the
// already-installed `typescript` AST (no ESLint, no new dep), mirroring
// `import-allowlist.mjs` / `no-cycle.mjs` — so strings (`'fetch data'`), comments,
// and `prefetch`/`refetch`-style identifiers never false-positive. Type positions
// are AST type nodes (not call/new expressions) → they never match.
//
// SCOPE — the bundled runtime graph only. Scans NON-TEST `src/**/*.ts` (the Rollup
// entry `src/tesla-card.ts` and everything it reaches, incl. the lazily
// `import('./editor')`'d `src/editor.ts`). OUT OF SCOPE, never flagged:
//   • `*.test.ts` (Vitest specs legitimately use `execFileSync`/`node:*`) — dropped
//     by `collectTs`;
//   • `scripts/` (the gates themselves), `tests/` (Playwright E2E),
//     `src/fixtures/*.json`, and config files — we never walk outside `src/`.
//
// NECESSARY, NOT SUFFICIENT (AC4): a static scan cannot see obfuscated access
// (`window['fet'+'ch']`), `eval`/`new Function`, or egress buried inside a
// transitively-imported third-party runtime dep. The import-allowlist gate (2.7)
// already freezes runtime deps to {lit, @mdi/js}, so the realistic surface is
// direct card-authored calls — which this gate covers. Pair with human review,
// same honesty as trade-dress's "the gate cannot see a logo inside a raster".
//
// Greppable output (`FAIL no-network-egress <path>:<line> <message>` + an
// `ok no-network-egress …` success line + `process.exit(1)` on any failure). ESM /
// Node 20. Importing this module is side-effect-free: the scan runs only when
// executed as a CLI (main guard at the bottom), so the co-located test can import
// `findEgress`/`RULE` without triggering a repo scan.

import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

export const RULE = 'no-network-egress';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/
const SRC = join(ROOT, 'src');

/** Global objects that, when qualifying a network primitive, still mean the real global. */
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
/** Constructors forbidden as `new X(...)` (bare or global-qualified). */
const NEW_DENY = new Set(['XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection']);

/** Posix-style path relative to repo root, for stable output. */
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/** Recursively collect non-test `.ts` files under `dir` (verbatim `no-cycle`/`import-allowlist` filter). */
function collectTs(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) collectTs(full, out);
    else if (name.name.endsWith('.ts') && !name.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Is `expr` one of the global objects (`window`/`globalThis`/`self`) as a bare identifier? */
function isGlobalObject(expr) {
  return ts.isIdentifier(expr) && GLOBAL_OBJECTS.has(expr.text);
}

/**
 * Pure, side-effect-free matcher (imported by the co-located test). Parses
 * `sourceText` with the real TS AST and returns every direct-egress hit. The CLI
 * `main()` feeds it each scanned file; the test feeds it planted snippets.
 * @param {string} sourceText
 * @param {string} [fileName] — used only for the parser's diagnostics label.
 * @returns {{ primitive: string, line: number }[]} 1-based line numbers.
 */
export function findEgress(sourceText, fileName = 'snippet.ts') {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node) => {
    // CallExpression — `fetch(...)`, `window.fetch(...)`, `navigator.sendBeacon(...)`.
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // Bare global `fetch(...)` — unqualified Identifier callee (AC3: only this form).
      if (ts.isIdentifier(callee) && callee.text === 'fetch') {
        hits.push({ primitive: 'fetch', line: at(node) });
      } else if (ts.isPropertyAccessExpression(callee)) {
        const prop = callee.name.text;
        // `window`/`globalThis`/`self`.fetch(...) — still the real global.
        if (prop === 'fetch' && isGlobalObject(callee.expression)) {
          hits.push({ primitive: `${callee.expression.text}.fetch`, line: at(node) });
        }
        // `navigator.sendBeacon(...)`.
        else if (prop === 'sendBeacon' && ts.isIdentifier(callee.expression) && callee.expression.text === 'navigator') {
          hits.push({ primitive: 'navigator.sendBeacon', line: at(node) });
        }
        // NOTE: any other `x.fetch()` (a method named fetch on a non-global object)
        // is intentionally NOT a hit — that is an arbitrary method, not egress (AC3).
      }
    }
    // NewExpression — `new XMLHttpRequest()` / `new WebSocket(...)` / etc., bare or global-qualified.
    if (ts.isNewExpression(node)) {
      const ctor = node.expression;
      if (ts.isIdentifier(ctor) && NEW_DENY.has(ctor.text)) {
        hits.push({ primitive: `new ${ctor.text}`, line: at(node) });
      } else if (
        ts.isPropertyAccessExpression(ctor) &&
        NEW_DENY.has(ctor.name.text) &&
        isGlobalObject(ctor.expression)
      ) {
        hits.push({ primitive: `new ${ctor.expression.text}.${ctor.name.text}`, line: at(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** The FAIL message for one hit — greppable and self-explaining (cites AR-17). */
function failMessage(primitive) {
  return `direct network egress '${primitive}' is forbidden — the card must route all traffic through Home Assistant (hass.callService/callWS); no telemetry (AR-17)`;
}

function main() {
  const files = collectTs(SRC);
  const failures = [];

  for (const file of files) {
    for (const { primitive, line } of findEgress(readFileSync(file, 'utf8'), file)) {
      failures.push(`FAIL ${RULE} ${rel(file)}:${line} ${failMessage(primitive)}`);
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\n${RULE}: ${failures.length} direct network egress call(s).`);
    console.error('The card opens no socket of its own and sends no telemetry — route all traffic through HA (AR-17).');
    process.exit(1);
  }

  console.log(`ok ${RULE} — ${files.length} runtime files scanned, no direct network egress (hass-only outbound)`);
}

// CLI-only: importing this module (for the test) must not run the scan.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
