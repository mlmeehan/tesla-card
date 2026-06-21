#!/usr/bin/env node
// token-defined gate — release-readiness (the demonstrated-cost 7th structural gate).
//
// Merge-blocking DESIGN-TOKEN-CONTRACT invariant: every `--tc-*` custom property a
// component REFERENCES (`var(--tc-name, …)`) must be a REAL token — either declared
// in the canonical contract (`src/styles.ts` `:host`) or set locally by the file
// that reads it. A reference to a token that no one defines is a silent visual bug:
// the browser falls back to the (often wrong) literal, or to nothing at all.
//
// WHY THIS GATE EXISTS — a demonstrated 2-bug cost. Epic 8 shipped two real defects
// of exactly this shape that every existing gate was blind to:
//   • `.ribbon-age` read `var(--tc-fs-xs)` — a font-size token that was NEVER in the
//     contract, so the stamp silently mis-sized;
//   • the same family of "referenced-but-undefined" drift recurred as `--tc-radius`
//     (the contract defines `--tc-radius-sm/md/lg/xl/pill`, never a bare `--tc-radius`).
// Both render "fine enough" via the fallback literal, so they pass typecheck, tests,
// and human review — only a contract-completeness scan catches them. This is that scan.
//
// SCOPE — the `--tc-*` PROJECT NAMESPACE ONLY. It deliberately does NOT police:
//   • Home Assistant theme tokens (`--primary-text-color`, `--card-background-color`,
//     `--divider-color`, …) — those are DEFINED BY HA's theme, not by us, and are
//     always read with a fallback. Policing them would flag correct code.
//   • component-local non-tc tokens (`--bat-pct-color`, `--accent`, `--c`, `--fo-c`,
//     `--sb-c`, `--node-accent`, `--paint`) — set + read within one component.
//   • the SISTER concern "staleness copy must use `--tc-text-dim`, never the 3:1
//     `--tc-text-mute`" (the other half of the Epic-8 lesson). That is CONTEXT-
//     semantic (which selector is "staleness copy"?), not a contract-completeness
//     question, and is already covered by unit tests (src/states.test.ts,
//     src/audit-r6-suite.test.ts). This gate stays focused on its name: DEFINED.
//
// A REFERENCE is `var(--tc-NAME ...)`. Dynamic forms (`var(--tc-${expr})`) cannot be
// resolved statically and are skipped — the NAME regex requires a literal token, so a
// `${` interpolation (and the `var(--tc-*)` doc-comment shorthand) simply never match.
//
// Scans the COMMITTED, SHIPPED source (`git ls-files src/**.ts`, excluding `*.test.ts`
// — tests don't ship and this gate's own test plants undefined tokens on purpose).
//
// Dep-light: node:fs + node:child_process + git only (no ESLint — this repo's gates
// are scripts/lint/*.mjs). ESM / Node 20. Importing this module is side-effect-free
// (the scan runs only under the CLI main-guard), so the co-located test imports the
// pure matchers without triggering a repo scan.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const RULE = 'token-defined';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/
const CONTRACT_FILE = 'src/styles.ts'; // the canonical `:host` token contract

// Legitimately-dynamic `--tc-*` tokens that are SET at runtime (JS `setProperty`
// / inline style attr) rather than declared in a parseable `--tc-x: …;` site, so the
// static set-scan can miss them. Keep this list SHORT and justified — it is the
// escape hatch, not the rule. (Empty today; `--tc-paint` is caught by the set-scan.)
export const REFERENCE_ALLOWLIST = new Set([]);

/**
 * Collect every `--tc-*` token DECLARED (set) in a chunk of source: CSS custom-property
 * declarations (`--tc-x: 16px;`), object-literal token maps (`'--tc-x': …`), and
 * inline-style attr fragments. Pure + side-effect-free. Used both to read the contract
 * (from styles.ts) and to learn each file's locally-set tokens.
 * @param {string} text
 * @returns {Set<string>}
 */
export function scanDefinedTokens(text) {
  const defined = new Set();
  // `--tc-name` followed by `:` (CSS decl `--tc-x: …`, quoted object key `'--tc-x':`,
  // inline style). The leading boundary stops `var(--tc-x)` being read as a decl; the
  // optional closing quote handles object-literal token maps.
  for (const m of text.matchAll(/(?:^|[^a-z0-9)-])(--tc-[a-z0-9]+(?:-[a-z0-9]+)*)['"`]?\s*:/gi)) {
    defined.add(m[1]);
  }
  // `setProperty('--tc-name', …)` — runtime declaration with no colon.
  for (const m of text.matchAll(/setProperty\(\s*['"`](--tc-[a-z0-9]+(?:-[a-z0-9]+)*)['"`]/gi)) {
    defined.add(m[1]);
  }
  return defined;
}

/**
 * Find every `--tc-*` token REFERENCED via `var(--tc-name …)` in a chunk of source.
 * The NAME pattern requires a real literal token, so `var(--tc-${expr})` and the
 * `var(--tc-*)` doc shorthand never match (they have no literal name). Pure.
 * @param {string} text
 * @returns {Array<{ token: string, line: number, col: number }>}
 */
export function scanReferences(text) {
  const hits = [];
  const lines = text.split('\n');
  const re = /var\(\s*(--tc-[a-z0-9]+(?:-[a-z0-9]+)*)\b/gi;
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      hits.push({ token: m[1], line: i + 1, col: m.index + 1 });
    }
  }
  return hits;
}

/**
 * Compute undefined-token violations for one file given the set of valid tokens.
 * Pure — the unit of the gate the co-located test drives directly.
 * @param {string} text  the file's source
 * @param {Set<string>} valid  contract ∪ all-local-sets ∪ allowlist
 * @returns {Array<{ token: string, line: number, col: number }>}
 */
export function violationsFor(text, valid) {
  return scanReferences(text).filter((ref) => !valid.has(ref.token));
}

/** Enumerate COMMITTED, shipped source: `src/**.ts` minus the non-shipping `*.test.ts`. */
function shippedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'));
}

function main() {
  const files = shippedSourceFiles();

  // The contract is the source of truth; locally-set tokens (e.g. `--tc-paint`) and the
  // allowlist extend it. Build the valid set from ALL shipped files first.
  const contract = scanDefinedTokens(readFileSync(join(ROOT, CONTRACT_FILE), 'utf8'));
  const valid = new Set([...contract, ...REFERENCE_ALLOWLIST]);
  const texts = new Map();
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    texts.set(rel, text);
    for (const t of scanDefinedTokens(text)) valid.add(t);
  }

  const failures = [];
  let refs = 0;
  for (const [rel, text] of texts) {
    const local = violationsFor(text, valid);
    refs += scanReferences(text).length;
    for (const v of local) {
      failures.push(
        `FAIL ${RULE} ${rel}:${v.line}:${v.col} references undefined design token ${v.token} ` +
          `— declare it in ${CONTRACT_FILE} (:host) or fix the token name`,
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\n${RULE}: ${failures.length} undefined --tc-* token reference(s).`);
    console.error(
      'A referenced token with no definition renders via its fallback literal (or nothing) — ' +
        'silent visual drift. Add it to the contract or correct the name.',
    );
    process.exit(1);
  }

  console.log(
    `ok ${RULE} — ${refs} var(--tc-*) reference(s) across ${files.length} shipped files, ` +
      `all resolve to ${valid.size} defined tokens (contract ${contract.size} + local/allowlist).`,
  );
}

// CLI-only: importing this module (for the test) must not run the scan.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
