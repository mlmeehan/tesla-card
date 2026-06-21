// Co-located test for the Story 7.4 version-sync gate (the 6th structural gate).
//
// The gate lives in scripts/lint/ (a dep-light .mjs run by node directly, like the
// other structural gates). It exports its pure checker (`checkVersionSync`)
// side-effect-free so this Vitest spec can (a) prove matched inputs PASS, (b) plant
// each drift form (version mismatch, filename rename, output-basename rename, a
// CARD_VERSION parse-miss) and prove the checker FLAGS it, and (c) shell out to the
// real gate and prove it exits 0 CLEAN on the committed repo (both 0.1.0 today).
// Mirrors no-network-egress.test.ts / import-allowlist.test.ts.
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { checkVersionSync, checkReleaseTag, RULE, EXPECTED_FILENAME } from '../scripts/lint/version-sync.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'version-sync.mjs');
const CARD_ROOT = join(HERE, '..');

/** A fully in-sync set of inputs at version `v` — the baseline every test mutates. */
const synced = (v = '0.1.0') => ({
  pkgText: JSON.stringify({ name: 'tesla-card', version: v, main: 'dist/tesla-card.js' }),
  constText: `import type { X } from './x';\n\nexport const CARD_VERSION = '${v}';\n`,
  hacsText: JSON.stringify({ name: 'Tesla Card', filename: 'tesla-card.js' }),
  rollupText: `export default { input: 'src/tesla-card.ts', output: { file: 'dist/tesla-card.js', format: 'es' } };\n`,
});

describe('version-sync gate — checkVersionSync (pure)', () => {
  test('rule id + expected filename are stable', () => {
    expect(RULE).toBe('version-sync');
    expect(EXPECTED_FILENAME).toBe('tesla-card.js');
  });

  // --- PASSES: a fully synced set yields zero failures ---
  test('PASSES when version, CARD_VERSION, filename and output basename all agree', () => {
    expect(checkVersionSync(synced())).toEqual([]);
  });

  test('PASSES at an arbitrary matching version (not hard-coded to 0.1.0)', () => {
    expect(checkVersionSync(synced('9.9.9'))).toEqual([]);
  });

  // --- FLAGS: the AC2 version drift (the #1 deliverable) ---
  test('FLAGS package.json version ≠ CARD_VERSION, printing both values', () => {
    const inputs = synced();
    inputs.constText = `export const CARD_VERSION = '0.1.1';\n`; // pkg stays 0.1.0
    const failures = checkVersionSync(inputs);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`FAIL ${RULE}`);
    expect(failures[0]).toContain("'0.1.0'");
    expect(failures[0]).toContain("'0.1.1'");
    expect(failures[0]).toMatch(/version drift/i);
  });

  // --- FLAGS: parse-miss must fail loudly, never silently pass ---
  test('FLAGS a missing/reshaped CARD_VERSION declaration (no silent pass)', () => {
    const inputs = synced();
    inputs.constText = `export const CARD_VER = "0.1.0";\n`; // wrong name + double quotes
    const failures = checkVersionSync(inputs);
    expect(failures.some((f: string) => f.includes('exactly one') && f.includes('CARD_VERSION'))).toBe(true);
  });

  test('FLAGS two CARD_VERSION declarations (ambiguous → fail)', () => {
    const inputs = synced();
    inputs.constText = `export const CARD_VERSION = '0.1.0';\nexport const CARD_VERSION = '0.1.0';\n`;
    expect(checkVersionSync(inputs).some((f: string) => f.includes('found 2'))).toBe(true);
  });

  // --- FLAGS: AC1 filename invariants ---
  test('FLAGS hacs.json filename that is not tesla-card.js', () => {
    const inputs = synced();
    inputs.hacsText = JSON.stringify({ name: 'Tesla Card', filename: 'tesla.js' });
    const failures = checkVersionSync(inputs);
    expect(failures.some((f: string) => f.includes('hacs.json') && f.includes("'tesla.js'"))).toBe(true);
  });

  test('FLAGS a rollup output.file whose basename drifts from tesla-card.js', () => {
    const inputs = synced();
    inputs.rollupText = `export default { input: 'src/tesla-card.ts', output: { file: 'dist/tesla.js', format: 'es' } };\n`;
    const failures = checkVersionSync(inputs);
    // Both the basename≠expected and the hacs↔rollup disagreement fire.
    expect(failures.some((f: string) => f.includes('output.file') || f.includes('output basename'))).toBe(true);
  });

  test('FLAGS invalid package.json / hacs.json JSON rather than throwing', () => {
    const inputs = synced();
    inputs.pkgText = '{ not valid json';
    const failures = checkVersionSync(inputs);
    expect(failures.some((f: string) => f.includes('package.json is not valid JSON'))).toBe(true);
  });

  // --- FLAGS: package.json `version` present but not a string (QA gap: non-string branch) ---
  test('FLAGS a non-string package.json version (e.g. a number) without throwing', () => {
    const inputs = synced();
    inputs.pkgText = JSON.stringify({ name: 'tesla-card', version: 123, main: 'dist/tesla-card.js' });
    const failures = checkVersionSync(inputs);
    // The non-string is reported; and because pkgVersion is cleared, NO false "version drift" fires.
    expect(failures.some((f: string) => f.includes('`version` is not a string'))).toBe(true);
    expect(failures.some((f: string) => /version drift/i.test(f))).toBe(false);
  });

  // --- FLAGS: invalid hacs.json JSON specifically (QA gap: only package.json was covered) ---
  test('FLAGS invalid hacs.json JSON rather than throwing', () => {
    const inputs = synced();
    inputs.hacsText = '{ not valid json';
    const failures = checkVersionSync(inputs);
    expect(failures.some((f: string) => f.includes('hacs.json is not valid JSON'))).toBe(true);
  });

  // --- FLAGS: rollup output.file count ≠ 1 (QA gap: single-bundle output-shape drift) ---
  test('FLAGS a missing rollup output.file (found 0 — single-bundle shape changed)', () => {
    const inputs = synced();
    inputs.rollupText = `export default { input: 'src/tesla-card.ts', output: { format: 'es' } };\n`;
    const failures = checkVersionSync(inputs);
    expect(failures.some((f: string) => f.includes('output.file') && f.includes('found 0'))).toBe(true);
  });

  test('FLAGS multiple rollup output.file declarations (found 2 — ambiguous output shape)', () => {
    const inputs = synced();
    inputs.rollupText =
      `export default [\n` +
      `  { input: 'a.ts', output: { file: 'dist/tesla-card.js', format: 'es' } },\n` +
      `  { input: 'b.ts', output: { file: 'dist/tesla-card.js', format: 'es' } },\n` +
      `];\n`;
    const failures = checkVersionSync(inputs);
    expect(failures.some((f: string) => f.includes('output.file') && f.includes('found 2'))).toBe(true);
  });

  // --- FLAGS: hacs.json filename and rollup basename disagree, isolated (QA gap: weakly covered) ---
  test('FLAGS hacs.json filename ↔ rollup output basename disagreement explicitly', () => {
    const inputs = synced();
    // Both reference a real .js basename, but a DIFFERENT one each — neither is tesla-card.js,
    // so the disagreement message must fire alongside the per-side basename mismatches.
    inputs.hacsText = JSON.stringify({ name: 'Tesla Card', filename: 'foo.js' });
    inputs.rollupText = `export default { input: 'src/tesla-card.ts', output: { file: 'dist/bar.js', format: 'es' } };\n`;
    const failures = checkVersionSync(inputs);
    expect(failures.some((f: string) => f.includes('disagree'))).toBe(true);
  });

  test('surfaces MULTIPLE violations at once (reports all, not just the first)', () => {
    const inputs = synced();
    inputs.constText = `export const CARD_VERSION = '0.2.0';\n`; // version drift
    inputs.hacsText = JSON.stringify({ filename: 'wrong.js' }); // filename drift
    const failures = checkVersionSync(inputs);
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });
});

describe('version-sync gate — end to end on the committed repo', () => {
  test('real gate exits 0 (package.json ↔ CARD_VERSION in sync; filename pinned)', () => {
    // Throws (non-zero exit) if the gate finds any drift on the committed repo.
    const out = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
    expect(out).toContain(`ok ${RULE}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Story 7.4 AC2 — the git-TAG leg of the version-sync invariant, now locally
// testable. release.yml invokes `version-sync.mjs --release-tag "$TAG"`; the logic
// is `checkReleaseTag`, exercised here (pure + via the real gate sub-mode) so the
// tag↔version equality is no longer enforced only by inline shell at release time.
// ─────────────────────────────────────────────────────────────────────────────
describe('version-sync gate — checkReleaseTag (pure)', () => {
  test('a matched tag (v${version} === v${CARD_VERSION}) passes', () => {
    expect(checkReleaseTag({ tag: 'v1.2.3', pkgVersion: '1.2.3', cardVersion: '1.2.3' })).toEqual([]);
  });

  test('FLAGS a tag that does not equal v${version}', () => {
    const f = checkReleaseTag({ tag: 'v1.2.4', pkgVersion: '1.2.3', cardVersion: '1.2.3' });
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(`FAIL ${RULE}`);
    expect(f[0]).toContain("'v1.2.4' != 'v1.2.3'");
  });

  test('FLAGS a tag missing the leading v', () => {
    expect(checkReleaseTag({ tag: '1.2.3', pkgVersion: '1.2.3', cardVersion: '1.2.3' })).toHaveLength(1);
  });

  test('FLAGS package.json ↔ CARD_VERSION drift (defensive — the lint gate should catch it first)', () => {
    const f = checkReleaseTag({ tag: 'v1.2.3', pkgVersion: '1.2.3', cardVersion: '1.2.4' });
    expect(f.some((m: string) => m.includes("!= CARD_VERSION"))).toBe(true);
  });

  test('FLAGS an unparseable CARD_VERSION', () => {
    const f = checkReleaseTag({ tag: 'v1.2.3', pkgVersion: '1.2.3', cardVersion: undefined });
    expect(f.some((m: string) => m.includes('could not parse CARD_VERSION'))).toBe(true);
  });
});

describe('version-sync gate — RED/GREEN: the real --release-tag sub-mode on the committed repo', () => {
  // The committed repo is at one synced version; derive it so the test tracks bumps.
  const VERSION = JSON.parse(readFileSync(join(CARD_ROOT, 'package.json'), 'utf8')).version as string;

  const runReleaseTag = (tag: string): { status: number; output: string } => {
    try {
      const stdout = execFileSync('node', [GATE, '--release-tag', tag], { cwd: CARD_ROOT, encoding: 'utf8' });
      return { status: 0, output: stdout };
    } catch (err: any) {
      return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  test(`GREEN — the correct tag (v${'${VERSION}'}) exits 0`, () => {
    const { status, output } = runReleaseTag(`v${VERSION}`);
    expect(status).toBe(0);
    expect(output).toContain(`ok ${RULE}`);
  });

  test('RED — a wrong tag exits non-zero + emits a FAIL line', () => {
    const { status, output } = runReleaseTag('v999.0.0');
    expect(status).not.toBe(0);
    expect(output).toContain(`FAIL ${RULE}`);
    expect(output).toContain(`!= 'v${VERSION}'`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Story 7.4 AC3 — distribution-floor declarations are PINNED (no silent drift).
//
// The CI "matrix" is, by deliberate decision, in-test viewport + colour-scheme
// sweeps under a single Chromium project — Chromium is what the HA frontend and the
// companion-app webviews actually run, so a multi-engine Playwright matrix buys no
// real coverage for a Lovelace card and is WAIVED. What we CAN pin locally is that
// the declared runtime floors don't silently drift: Node 20 (the .nvmrc the test/
// validate/release workflows consume) and the HACS minimum HA version. These were
// previously config-only declarations with no assertion; now they're invariants.
// ─────────────────────────────────────────────────────────────────────────────
describe('Story 7.4 AC3 — distribution floors are pinned', () => {
  test('the Node floor is 20 and the workflows consume that single source (.nvmrc)', () => {
    expect(readFileSync(join(CARD_ROOT, '.nvmrc'), 'utf8').trim()).toBe('20');
    // The test workflow reads .nvmrc; validate/release pin node-version: 20 directly —
    // assert neither drifted off the declared floor.
    const testYml = readFileSync(join(CARD_ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
    expect(testYml).toContain('node-version-file: .nvmrc');
    for (const wf of ['validate.yml', 'release.yml']) {
      const txt = readFileSync(join(CARD_ROOT, '.github', 'workflows', wf), 'utf8');
      expect(txt, `${wf} pins the Node 20 floor`).toMatch(/node-version:\s*20\b/);
    }
  });

  test('the HACS minimum Home Assistant version is the declared floor (>= 2024.4)', () => {
    const hacs = JSON.parse(readFileSync(join(CARD_ROOT, 'hacs.json'), 'utf8'));
    expect(hacs.homeassistant, 'hacs.json declares the minimum HA version').toBe('2024.4.0');
    expect(hacs.filename).toBe(EXPECTED_FILENAME);
  });

  test('release.yml delegates the tag check to the version-sync gate (no inline reimplementation)', () => {
    // Guards the single-source-of-truth refactor: if someone re-inlines the tag logic
    // in shell, this fails — the workflow must call the tested gate.
    const releaseYml = readFileSync(join(CARD_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(releaseYml).toContain('version-sync.mjs --release-tag');
  });
});
