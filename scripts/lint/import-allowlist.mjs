#!/usr/bin/env node
// import-allowlist gate — Story 2.7 (AR-11 CI gate suite · NFR-2 dependency policy · D5/D6).
//
// Merge-blocking dependency policy: every RUNTIME import in the bundled `src/`
// graph must resolve to the allowlist `{lit (+ `lit/*` subpaths), @mdi/js}` plus
// internal relative modules. `@mdi/js` is restricted to NAMED-PATH imports only
// (`import { mdiLock } from '@mdi/js'`) — the default, the namespace/barrel
// (`import * as mdi from '@mdi/js'`) and the side-effect form all defeat
// tree-shaking and bloat the single shipped bundle (NFR-1), so they FAIL. This
// makes NFR-2 enforced by CI, not just documented: no third runtime dep and no
// barrel `@mdi/js` import can ever slip into `dist/tesla-card.js`.
//
// SCOPE — the bundled runtime graph only. Scans NON-TEST `src/**/*.ts` (the Rollup
// entry `src/tesla-card.ts` and everything it reaches, incl. the lazily
// `import('./editor')`'d `src/editor.ts`). OUT OF SCOPE, never flagged:
//   • `*.test.ts` (Vitest specs legitimately import `vitest`, `node:*`, fixtures,
//     and `../scripts/lint/*.mjs`) — dropped by `collectTs`;
//   • `scripts/` (the gates themselves use `typescript` + `node:*`), `tests/`
//     (Playwright E2E), `src/fixtures/*.json`, and config files — we never walk
//     outside `src/`.
// TYPE-ONLY EXCLUDED (AC4): NFR-2 governs the JS *bundle*; `import type …` and
// all-`type` named bindings are compiler-erased (zero runtime weight) — not
// flagged. ASSETS / RELATIVE EXEMPT (AC3): the policy constrains only bare/package
// specifiers (the runtime-dependency surface); relative specifiers (`./x`, `../x`,
// incl. any future `import url from './car.webp'`) are always allowed — internal
// `src/` graph integrity is owned by `no-cycle`. A runtime `node:*` import would
// NOT be in the browser-bundle allowlist, so failing it is correct (none exist in
// `src/` today — they live only in `*.test.ts` + `scripts/`).
//
// Specifiers are extracted with the already-installed `typescript` AST (no ESLint,
// no new dep), mirroring `no-cycle.mjs`'s `importSpecifiers` + `isRuntimeImport` —
// zero false-positives from strings/comments and exact import-kind classification.
// The only differences from `no-cycle`: it keeps RELATIVE specifiers and discards
// bare ones; here we do the inverse (check bare/package specifiers, ignore
// relative) AND additionally record the import KIND (default / namespace / named /
// side-effect) to enforce the `@mdi/js` named-only rule. Greppable output
// (`FAIL import-allowlist <path>:<line> <message>` + an `ok import-allowlist …`
// success line + `process.exit(1)` on any failure). ESM / Node 20.
//
// Importing this module is side-effect-free: the scan runs only when executed as a
// CLI (see the main guard at the bottom), so the co-located test can import
// `classifyImport`/`RULE` without triggering a repo scan.

import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

export const RULE = 'import-allowlist';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/
const SRC = join(ROOT, 'src');

/** Posix-style path relative to repo root, for stable output. */
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/** Recursively collect non-test `.ts` files under `dir` (verbatim `no-cycle` filter). */
function collectTs(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) collectTs(full, out);
    else if (name.name.endsWith('.ts') && !name.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * Pure, side-effect-free matcher (imported by the co-located test). Decides
 * whether one runtime import specifier is allowed.
 * @param {{spec: string, kind: 'named'|'default'|'namespace'|'side-effect'}} entry
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function classifyImport({ spec, kind }) {
  // Relative specifiers are internal modules / asset references — never
  // constrained here (AC3); `no-cycle` owns the internal graph.
  if (spec.startsWith('./') || spec.startsWith('../')) return { ok: true };

  // Allowlist (AC1): `lit`, `lit/*` subpaths (`lit/decorators.js`, future
  // `lit/directives/*`), and `@mdi/js`. Anything else is a disallowed runtime dep.
  const allowed = spec === 'lit' || spec.startsWith('lit/') || spec === '@mdi/js';
  if (!allowed) {
    return { ok: false, message: `runtime import '${spec}' is not in the allowlist {lit, @mdi/js}` };
  }

  // `@mdi/js` named-path rule (AC2): only named imports survive. A default,
  // namespace/barrel, or side-effect import defeats tree-shaking (NFR-1).
  if (spec === '@mdi/js' && kind !== 'named') {
    return {
      ok: false,
      message: `@mdi/js must be named-path imports only — never the ${kind} import (NFR-1 tree-shaking)`,
    };
  }

  return { ok: true };
}

/**
 * Extract RUNTIME import specifiers with their import KIND from a source file
 * (mirror `no-cycle.mjs`'s `importSpecifiers` + `isRuntimeImport`, extended to
 * record kind). Handles `import … from '…'`, `export … from '…'`, and dynamic
 * `import('…')`. Type-only imports/exports (compiler-erased) are excluded (AC4).
 * Returns `[{ spec, kind, line }]` (1-based line).
 */
function importEntries(filePath, text) {
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const entries = [];
  const add = (spec, kind, node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    entries.push({ spec, kind, line: line + 1 });
  };
  const visit = (node) => {
    // `import … from '…'`
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (!clause) {
        add(spec, 'side-effect', node.moduleSpecifier); // `import '…'` — runs the module
      } else if (!clause.isTypeOnly) {
        // `import type …` is erased (AC4) — only value bindings reach here.
        if (clause.name) add(spec, 'default', node.moduleSpecifier); // default binding
        const bindings = clause.namedBindings;
        if (bindings) {
          if (ts.isNamespaceImport(bindings)) add(spec, 'namespace', node.moduleSpecifier); // `* as ns`
          // named imports — only if ≥1 binding is a value (not `type`-qualified)
          else if (ts.isNamedImports(bindings) && bindings.elements.some((el) => !el.isTypeOnly)) {
            add(spec, 'named', node.moduleSpecifier);
          }
        }
      }
    }
    // `export … from '…'` — value re-exports only (type-only erased, AC4)
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      const spec = node.moduleSpecifier.text;
      const ec = node.exportClause;
      if (!ec || ts.isNamespaceExport(ec)) add(spec, 'namespace', node.moduleSpecifier); // `export *` / `export * as ns`
      else if (ts.isNamedExports(ec) && ec.elements.some((el) => !el.isTypeOnly)) {
        add(spec, 'named', node.moduleSpecifier); // `export { a } from`
      }
    }
    // dynamic `import('…')` — pulls the whole module namespace → treat as namespace
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      add(node.arguments[0].text, 'namespace', node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return entries;
}

function main() {
  const files = collectTs(SRC);
  const failures = [];
  let pkgImports = 0;

  for (const file of files) {
    for (const { spec, kind, line } of importEntries(file, readFileSync(file, 'utf8'))) {
      if (spec.startsWith('./') || spec.startsWith('../')) continue; // relative — exempt (AC3)
      pkgImports += 1;
      const res = classifyImport({ spec, kind });
      if (!res.ok) failures.push(`FAIL ${RULE} ${rel(file)}:${line} ${res.message}`);
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\n${RULE}: ${failures.length} disallowed runtime import(s).`);
    console.error('Runtime deps are frozen to {lit, @mdi/js} (NFR-2); @mdi/js named-path only, never the barrel.');
    process.exit(1);
  }

  console.log(
    `ok ${RULE} — ${files.length} runtime files scanned, ${pkgImports} package imports, all ⊆ {lit, @mdi/js}`,
  );
}

// CLI-only: importing this module (for the test) must not run the scan.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
