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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { checkVersionSync, RULE, EXPECTED_FILENAME } from '../scripts/lint/version-sync.mjs';

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
