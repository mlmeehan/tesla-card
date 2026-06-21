#!/usr/bin/env node
// no-cycle gate — Story 1.7 (AR-11 structural).
//
// The `src/` module graph (relative ESM imports) must be ACYCLIC. This guards
// the dependency-direction boundary `data/ ← flow/ ← components/` so the layers
// can't tangle as the codebase grows. `flow/` doesn't exist yet (Epic 4), so the
// gate is implemented as a generic acyclic-import-graph check: it passes on
// today's graph and automatically covers `flow/` the moment it lands.
//
// We extract import specifiers with the already-installed `typescript` AST (no
// new dep, no false-positives from strings/comments). Only RELATIVE specifiers
// (`./x`, `../x`) become edges; bare specifiers (`lit`, `@mdi/js`, `node:*`),
// JSON, and `*.test.ts` are ignored. ESM / Node 20.

// Importing this module is side-effect-free: the scan runs only when executed as a
// CLI (main guard at the bottom), so the co-located test can import
// `findCycles`/`importSpecifiers`/`RULE` without triggering a repo scan (parity
// with no-network-egress.mjs / import-allowlist.mjs).
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';

export const RULE = 'no-cycle';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/
const SRC = join(ROOT, 'src');

/** Posix-style path relative to repo root, for stable output. */
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/** Recursively collect non-test `.ts` files under `dir`. */
function collectTs(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) collectTs(full, out);
    else if (name.name.endsWith('.ts') && !name.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * Does an import/export declaration create a RUNTIME edge? Type-only imports
 * (`import type …`, or named bindings that are all `type`-qualified) are erased
 * by the compiler and form no runtime cycle — they must not count. Side-effect
 * imports (`import './x'`), default/namespace imports, and any value-named
 * binding DO create an edge.
 */
function isRuntimeImport(node) {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return false; // `export type … from` is erased
    const ec = node.exportClause;
    // `export * from` / `export * as ns from` re-export values → runtime edge
    if (!ec || ts.isNamespaceExport(ec)) return true;
    // `export { a, type B } from` → edge iff at least one binding is a value
    return ec.elements.some((el) => !el.isTypeOnly);
  }
  const clause = node.importClause;
  if (!clause) return true; // side-effect import `import './x'` — runs the module
  if (clause.isTypeOnly) return false; // `import type { … }`
  if (clause.name) return true; // default import
  const bindings = clause.namedBindings;
  if (!bindings) return true; // (defensive) treat as value
  if (ts.isNamespaceImport(bindings)) return true; // `import * as ns`
  // named imports — an edge exists if at least one binding is a value (not `type`)
  return bindings.elements.some((el) => !el.isTypeOnly);
}

/** Extract relative RUNTIME module specifiers (static + export-from + dynamic import). */
export function importSpecifiers(filePath, text) {
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specs = [];
  const visit = (node) => {
    // `import … from '…'` and `export … from '…'` — runtime (value) edges only
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isRuntimeImport(node)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    // dynamic `import('…')` — always a runtime edge
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs.filter((s) => s.startsWith('./') || s.startsWith('../'));
}

/** Resolve a relative specifier from `fromFile` to a concrete `.ts` node, or null. */
function resolveSpec(fromFile, spec) {
  const base = resolvePath(dirname(fromFile), spec.replace(/\.js$/, ''));
  const candidates = [base + '.ts', join(base, 'index.ts'), base];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile() && c.endsWith('.ts') && !c.endsWith('.test.ts')) return c;
  }
  return null;
}

/**
 * Pure, side-effect-free cycle detector (imported by the co-located test). Takes a
 * directed graph `Map<node, node[]>` and returns every distinct cycle as a chain of
 * node keys (closing node repeated, e.g. `[a, b, a]`). DFS with a gray (on-stack) /
 * black (done) colouring: a back edge to a gray node is a cycle. Node keys are
 * opaque to the detector — `main()` passes absolute paths; the test passes strings.
 */
export function findCycles(graph) {
  const GRAY = new Set();
  const BLACK = new Set();
  const stack = [];
  const cycles = [];
  const seenCycle = new Set();

  const dfs = (node) => {
    GRAY.add(node);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (BLACK.has(dep)) continue;
      if (GRAY.has(dep)) {
        const chain = stack.slice(stack.indexOf(dep)).concat(dep);
        const key = chain.join(' → ');
        if (!seenCycle.has(key)) {
          seenCycle.add(key);
          cycles.push(chain);
        }
        continue;
      }
      dfs(dep);
    }
    stack.pop();
    GRAY.delete(node);
    BLACK.add(node);
  };

  for (const node of graph.keys()) if (!BLACK.has(node)) dfs(node);
  return cycles;
}

function main() {
  // Build the directed module graph.
  const files = collectTs(SRC);
  const nodes = new Set(files);
  const graph = new Map(); // file → [file]
  let edgeCount = 0;
  for (const file of files) {
    const deps = [];
    for (const spec of importSpecifiers(file, readFileSync(file, 'utf8'))) {
      const target = resolveSpec(file, spec);
      if (target && nodes.has(target)) {
        deps.push(target);
        edgeCount += 1;
      }
    }
    graph.set(file, deps);
  }

  const cycles = findCycles(graph);

  if (cycles.length > 0) {
    for (const chain of cycles) console.error(`FAIL ${RULE} ${chain.map(rel).join(' → ')}`);
    console.error(`\n${RULE}: ${cycles.length} import cycle(s).`);
    process.exit(1);
  }

  console.log(`ok ${RULE} — ${nodes.size} modules, ${edgeCount} edges, no import cycles`);
}

// CLI-only: importing this module (for the test) must not run the scan.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
