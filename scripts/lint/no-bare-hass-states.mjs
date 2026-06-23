#!/usr/bin/env node
// no-bare-hass.states gate — Story 1.7 (AR-1 / D2 / D3).
//
// Entity STATE reads — `hass.states`, plus the `hass.entities` / `hass.devices`
// registries — are allowed ONLY inside `src/data/` (the freshness reader is the
// sole reader). This gate fails CI on a bare state read ANYWHERE else (every
// component, `ui.ts`, `editor.ts`, the future `flow/`), so the one hard
// data-access boundary can't erode as the codebase grows.
//
// Non-state `hass.*` access stays open everywhere — `callService`, `localize`,
// `formatEntityState`, `locale`, `themes`, `connection`, … — commands and
// display formatting legitimately need them. This gate governs state reads only.
//
// WHY a TS AST and not regex/ESLint: we walk the AST with the already-installed
// `typescript` devDep, so a `"hass.states"` string in a comment or a
// `callService('…')` argument never false-positives — with zero new deps. This
// project deliberately runs no ESLint (custom gates are scripts/lint/*.mjs).
// ESM / Node 20.

// Importing this module is side-effect-free: the scan runs only when executed as a
// CLI (main guard at the bottom), so the co-located test can import
// `findViolations`/`RULE` without triggering a repo scan (parity with
// no-network-egress.mjs / import-allowlist.mjs).
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

export const RULE = 'no-bare-hass.states';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/
const SRC = join(ROOT, 'src');
const DATA = join(SRC, 'data'); // the only allowed home for state reads

// The registry/state members this gate guards (everything else on `hass` is fine).
const STATE_MEMBERS = new Set(['states', 'entities', 'devices']);

// Baseline allowlist — the pre-migration breaches that still read state outside
// `data/`. Self-invalidating (asserted below): the gate ERRORS if an entry is
// missing or no longer contains a bare read, so the list can only SHRINK toward
// empty. The boundary ratchets shut, never re-opens. Each entry names the story
// that retires it. NEW breaches in any other file fail the gate.
const BASELINE = [
  // 'src/energy.ts' retired in Story 4.1: reads→data/energy.ts, math→flow/. The
  // boundary ratcheted shut here — the self-invalidation assertion below fails if
  // this entry returns, so it stays gone.
  'src/helpers.ts', // → legacy (hass,config,EntityKey) state-read helpers fold into data/
  'src/tesla-card.ts', // → fold the parent's registry (hass.entities/devices) reads into data/ resolve
  // Story 9.10 — the DELIBERATE, REVIEWED editor-discovery AR-1 exception (NOT a
  // pre-migration debt that shrinks away). The editor's discovery seam reads its OWN
  // hass directly — `hass.states` for liveness + the `hass.entities` registry for
  // presence — via the public surface only (never a HA-frontend src/data/* import).
  // Recorded as the system-of-record in architecture.md (Core Architectural Decisions
  // → D7) + the UX decision log (.decision-log.md §Story 9.10 D-9.10-4). The card
  // RUNTIME (my-home.ts, components, flow/) stays clean — only editor.ts is excepted.
  'src/editor.ts',
];
const BASELINE_SET = new Set(BASELINE);

/** Posix-style path relative to repo root, for stable output + allowlist matching. */
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/** Recursively collect non-test `.ts` files under `dir`, skipping `skip` subtrees. */
function collectTs(dir, skip, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      if (skip.some((s) => full === s || full.startsWith(s + '/'))) continue;
      collectTs(full, skip, out);
    } else if (name.name.endsWith('.ts') && !name.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Is `expr` a reference to a `hass` object? Covers `hass` and `this.hass` / `*.hass`.
 * Name-based (no type-checker): a destructure (`const { states } = hass`) or an
 * alias to a non-`hass` identifier would slip past — acceptable for a ratchet,
 * and an alias that keeps the name `hass` (the common `const hass = this.hass`)
 * is still caught.
 */
function isHassRef(expr) {
  if (!expr) return false;
  if (ts.isIdentifier(expr)) return expr.text === 'hass';
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === 'hass';
  return false;
}

/**
 * Pure, side-effect-free matcher (imported by the co-located test). Finds bare
 * state reads in one file via AST walk. Returns [{ line, col, member }]. The CLI
 * `main()` feeds it each scanned file; the test feeds it planted snippets.
 */
export function findViolations(filePath, text) {
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits = [];
  const visit = (node) => {
    let objectExpr;
    let member;
    if (ts.isPropertyAccessExpression(node)) {
      objectExpr = node.expression;
      member = node.name.text;
    } else if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      // `hass['states']` style — read the member from the string literal.
      objectExpr = node.expression;
      member = node.argumentExpression.text;
    }
    if (member && STATE_MEMBERS.has(member) && isHassRef(objectExpr)) {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      hits.push({ line: line + 1, col: character + 1, member });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function main() {
  // Scan every non-test .ts under src/, excluding the allowed `data/` home and the
  // test-only `fixtures/` (mock hass objects are constructed there legitimately).
  const files = collectTs(SRC, [DATA, join(SRC, 'fixtures')]);
  const failures = [];
  const baselineHadRead = new Set();
  let scanned = 0;

  for (const file of files) {
    scanned += 1;
    const r = rel(file);
    const violations = findViolations(file, readFileSync(file, 'utf8'));
    if (BASELINE_SET.has(r)) {
      if (violations.length > 0) baselineHadRead.add(r); // baselined — suppressed
      continue;
    }
    for (const v of violations) {
      failures.push(`FAIL ${RULE} ${r}:${v.line}:${v.col} hass.${v.member}`);
    }
  }

  // Self-invalidation: every baseline entry MUST exist and still contain a bare
  // read. A dev who removes the last breach is forced to delete the stale entry.
  for (const entry of BASELINE) {
    const full = join(ROOT, entry);
    if (!existsSync(full)) {
      failures.push(`FAIL ${RULE} baseline entry stale: ${entry} no longer exists — remove it from BASELINE`);
    } else if (!baselineHadRead.has(entry)) {
      failures.push(
        `FAIL ${RULE} baseline entry stale: ${entry} has no bare state read — the boundary ratcheted shut; remove it from BASELINE`,
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\n${RULE}: ${failures.length} violation(s).`);
    process.exit(1);
  }

  console.log(
    `ok ${RULE} — ${scanned} files scanned, 0 bare state reads outside src/data/ (baseline: ${BASELINE.join(', ')})`,
  );
}

// CLI-only: importing this module (for the test) must not run the scan.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
