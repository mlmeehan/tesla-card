#!/usr/bin/env node
// test-census gate — the mechanical test-count / spec-file inventory check.
//
// WHY THIS EXISTS. Three straight retrospectives (Epics 11, 12, 14) pointed at the
// same missing control: story Dev Records record test counts ("unit 1688 / e2e 300")
// and File Lists by hand, and they drift — Epic 14 shipped a record claiming 1666/298
// against a tree that actually had 1675/300, caught only when a human re-measured a
// story later. The recurring wart is "File-List-omits-e2e" + stale counts. The lesson
// the suite kept re-learning: a claim isn't a control until something mechanical
// enforces it. This is that control.
//
// WHAT IT DOES. `tests/test-census.json` is the AUTHORITATIVE snapshot of:
//   unitTests    — count of collected unit test cases (`vitest list`)
//   e2eTests     — playwright default-grep total ("Total: N tests"; @visual excluded,
//                  matching `npm run test:e2e`)
//   e2eSpecFiles — sorted list of tests/e2e/**/*.spec.ts on disk
// The gate recomputes these from the live tree and fails if the committed census is
// stale. So you CANNOT add/remove a test or an e2e spec without the census going red,
// which forces `--write` in the same change — and the regenerated census is the
// ground truth a story Dev Record / File List transcribes from (no more guessing).
//
// USAGE:
//   node scripts/lint/test-census.mjs            # check — exit 1 on drift (ladder mode)
//   node scripts/lint/test-census.mjs --write     # regenerate tests/test-census.json
//   node scripts/lint/test-census.mjs --json       # print the computed census, no check
//
// This is a TEST-INVENTORY check, not a structural `src/` gate — it invokes the test
// runners (~4s, mostly vitest collection), so it lives OUTSIDE `npm run lint` (the 8
// fast static gates) as its own `npm run test:census` ladder step, wired into
// ci-local.sh and the CI lint job. ESM / Node 20+.
//
// Importing this module is side-effect-free (main runs only under the CLI guard at the
// bottom), so the co-located test can import the pure parsers without spawning runners.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

export const RULE = 'test-census';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/
const CENSUS = join(ROOT, 'tests', 'test-census.json');
const E2E_DIR = join(ROOT, 'tests', 'e2e');

/** Posix-style path relative to repo root, for stable, cross-platform output. */
const rel = (p) => relative(ROOT, p).split('\\').join('/');

// ── Pure parsers (unit-tested; no side effects) ──────────────────────────────

/**
 * `vitest list` prints one collected test case per line, formatted
 * `file > describe > … > test name`. Count the lines carrying that ` > ` separator
 * (ignores any blank lines or stray runner chatter). This matches the "Tests N"
 * total `vitest run` reports for a suite with no skips.
 */
export function parseVitestListCount(stdout) {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes(' > ')).length;
}

/**
 * `playwright test --list` ends with `Total: N tests in M files`. Parse N.
 * With the default grep (VISUAL unset) this equals what `npm run test:e2e` runs.
 */
export function parsePlaywrightTotal(stdout) {
  const m = stdout.match(/Total:\s+(\d+)\s+tests?\b/);
  if (!m) {
    throw new Error(
      `${RULE}: could not find "Total: N tests" in playwright --list output — did the runner error?`,
    );
  }
  return Number(m[1]);
}

/**
 * Compare a committed census against a freshly computed one. Returns an array of
 * human-readable problem strings (empty ⇒ in sync). Pure — used by main() and tested.
 */
export function compareCensus(expected, actual) {
  const problems = [];
  if (expected.unitTests !== actual.unitTests) {
    const d = actual.unitTests - expected.unitTests;
    problems.push(
      `unitTests: census says ${expected.unitTests}, tree has ${actual.unitTests} (${d >= 0 ? '+' : ''}${d})`,
    );
  }
  if (expected.e2eTests !== actual.e2eTests) {
    const d = actual.e2eTests - expected.e2eTests;
    problems.push(
      `e2eTests: census says ${expected.e2eTests}, tree has ${actual.e2eTests} (${d >= 0 ? '+' : ''}${d})`,
    );
  }
  const before = new Set(expected.e2eSpecFiles ?? []);
  const after = new Set(actual.e2eSpecFiles ?? []);
  const added = [...after].filter((f) => !before.has(f)).sort();
  const removed = [...before].filter((f) => !after.has(f)).sort();
  for (const f of added) problems.push(`e2eSpecFiles: NEW spec on disk not in census — ${f}`);
  for (const f of removed) problems.push(`e2eSpecFiles: census lists a spec no longer on disk — ${f}`);
  return problems;
}

// ── Live computation (spawns the runners / walks the tree) ───────────────────

function runnerBin(name) {
  // Prefer the local binary (fast, no npx resolution); fall back to npx if absent.
  const bin = join(ROOT, 'node_modules', '.bin', name);
  return existsSync(bin) ? { cmd: bin, pre: [] } : { cmd: 'npx', pre: [name] };
}

function countUnitTests() {
  const { cmd, pre } = runnerBin('vitest');
  const out = execFileSync(cmd, [...pre, 'list'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return parseVitestListCount(out);
}

function countE2eTests() {
  const { cmd, pre } = runnerBin('playwright');
  const out = execFileSync(cmd, [...pre, 'test', '--list'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return parsePlaywrightTotal(out);
}

function collectE2eSpecFiles() {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.spec.ts')) out.push(rel(full));
    }
  };
  walk(E2E_DIR);
  return out.sort();
}

function computeCensus() {
  return {
    unitTests: countUnitTests(),
    e2eTests: countE2eTests(),
    e2eSpecFiles: collectE2eSpecFiles(),
  };
}

/** Serialize with a stable shape + trailing newline so `--write` diffs are clean. */
function serializeCensus(census) {
  return (
    JSON.stringify(
      {
        _README:
          'AUTHORITATIVE test census. Regenerate with `npm run test:census -- --write` ' +
          'whenever you add/remove tests or e2e specs, and transcribe these counts into ' +
          'the story File List / Dev Record. Enforced by scripts/lint/test-census.mjs.',
        unitTests: census.unitTests,
        e2eTests: census.e2eTests,
        e2eSpecFiles: census.e2eSpecFiles,
      },
      null,
      2,
    ) + '\n'
  );
}

function main() {
  const write = process.argv.includes('--write');
  const jsonOnly = process.argv.includes('--json');

  const actual = computeCensus();

  if (jsonOnly) {
    process.stdout.write(serializeCensus(actual));
    return;
  }

  if (write) {
    writeFileSync(CENSUS, serializeCensus(actual));
    console.log(
      `ok ${RULE} — wrote ${rel(CENSUS)}: ${actual.unitTests} unit, ${actual.e2eTests} e2e, ${actual.e2eSpecFiles.length} spec files`,
    );
    return;
  }

  if (!existsSync(CENSUS)) {
    console.error(
      `FAIL ${RULE} — ${rel(CENSUS)} is missing. Create it with:\n    npm run test:census -- --write`,
    );
    process.exit(1);
  }

  let expected;
  try {
    expected = JSON.parse(readFileSync(CENSUS, 'utf8'));
  } catch (e) {
    console.error(`FAIL ${RULE} — ${rel(CENSUS)} is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  const problems = compareCensus(expected, actual);
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL ${RULE} ${p}`);
    console.error(
      `\n${RULE}: the committed census is stale. Regenerate it in this change:\n` +
        `    npm run test:census -- --write\n` +
        `Authoritative current counts — transcribe these into the story File List / Dev Record:\n` +
        `    unit ${actual.unitTests} · e2e ${actual.e2eTests} · ${actual.e2eSpecFiles.length} e2e spec files`,
    );
    process.exit(1);
  }

  console.log(
    `ok ${RULE} — ${actual.unitTests} unit, ${actual.e2eTests} e2e, ${actual.e2eSpecFiles.length} spec files (census in sync)`,
  );
}

// CLI-only: importing this module (for the test) must not spawn runners.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
