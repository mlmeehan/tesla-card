// Co-located test for the Story 2.7 import-allowlist gate.
//
// The gate lives in scripts/lint/ (a dep-light .mjs run by node directly, like the
// other structural gates). It exports its matcher side-effect-free so this Vitest
// spec can (a) plant disallowed imports and prove `classifyImport` FIRES, and
// (b) shell out to the real gate and prove it exits 0 CLEAN on the committed repo
// (the codebase already complies — all runtime imports are lit / lit/decorators.js
// / named @mdi/js / relative). Mirrors trade-dress's "passes clean on the repo".
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { classifyImport, RULE } from '../scripts/lint/import-allowlist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'import-allowlist.mjs');
const CARD_ROOT = join(HERE, '..');

describe('import-allowlist gate — classifyImport matcher', () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('import-allowlist');
  });

  test('FLAGS a disallowed package import (axios)', () => {
    expect(classifyImport({ spec: 'axios', kind: 'default' }).ok).toBe(false);
    expect(classifyImport({ spec: 'axios', kind: 'named' }).ok).toBe(false);
    // a vendored charting lib, etc. — anything outside {lit, @mdi/js}
    expect(classifyImport({ spec: 'd3', kind: 'named' }).ok).toBe(false);
  });

  test('FLAGS a barrel (namespace) @mdi/js import', () => {
    const res = classifyImport({ spec: '@mdi/js', kind: 'namespace' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('named-path');
  });

  test('FLAGS a default @mdi/js import', () => {
    expect(classifyImport({ spec: '@mdi/js', kind: 'default' }).ok).toBe(false);
  });

  test('FLAGS a side-effect @mdi/js import', () => {
    expect(classifyImport({ spec: '@mdi/js', kind: 'side-effect' }).ok).toBe(false);
  });

  test('PASSES named @mdi/js import (the only form the codebase uses)', () => {
    expect(classifyImport({ spec: '@mdi/js', kind: 'named' }).ok).toBe(true);
  });

  test('PASSES lit (named + side-effect) and lit/* subpaths', () => {
    expect(classifyImport({ spec: 'lit', kind: 'named' }).ok).toBe(true);
    expect(classifyImport({ spec: 'lit', kind: 'side-effect' }).ok).toBe(true);
    expect(classifyImport({ spec: 'lit/decorators.js', kind: 'named' }).ok).toBe(true);
    expect(classifyImport({ spec: 'lit/directives/repeat.js', kind: 'named' }).ok).toBe(true);
  });

  test('PASSES relative specifiers regardless of kind (AC3 — assets/internal exempt)', () => {
    expect(classifyImport({ spec: './car', kind: 'named' }).ok).toBe(true);
    expect(classifyImport({ spec: '../helpers', kind: 'named' }).ok).toBe(true);
    expect(classifyImport({ spec: './car.webp', kind: 'default' }).ok).toBe(true);
  });

  // --- boundary cases: the @mdi/js named-only rule must not leak, and the
  //     allowlist must match exactly (no loose prefix bleed). ---

  test('the @mdi/js named-only rule does NOT leak to lit (lit barrel/default pass)', () => {
    // Only @mdi/js is restricted to named imports; lit may be imported any way.
    expect(classifyImport({ spec: 'lit', kind: 'namespace' }).ok).toBe(true);
    expect(classifyImport({ spec: 'lit', kind: 'default' }).ok).toBe(true);
    expect(classifyImport({ spec: 'lit/decorators.js', kind: 'default' }).ok).toBe(true);
  });

  test('FLAGS allowlist look-alikes — match is exact, not a loose prefix', () => {
    // `lit-html`/`litany` are NOT `lit` and do not start with `lit/`.
    expect(classifyImport({ spec: 'lit-html', kind: 'named' }).ok).toBe(false);
    expect(classifyImport({ spec: 'litany', kind: 'named' }).ok).toBe(false);
    // a scoped package that merely begins with the allowed name is still out.
    expect(classifyImport({ spec: '@mdi/js-extra', kind: 'named' }).ok).toBe(false);
    expect(classifyImport({ spec: '@mdi/react', kind: 'named' }).ok).toBe(false);
  });

  test('FLAGS node:* builtins — not in the browser-bundle allowlist (gate header)', () => {
    // node:* legitimately appears only in *.test.ts + scripts/ (out of gate scope);
    // a runtime src import of one is correctly disallowed.
    expect(classifyImport({ spec: 'node:fs', kind: 'named' }).ok).toBe(false);
  });
});

// Runs the REAL gate over a temporarily-planted src file and returns its exit
// status + output. Proves the full AST → classify → exit path (the matcher tests
// above feed synthetic {spec, kind}; these exercise importEntries' real TS-AST
// extraction + import-kind classification). The probe is always cleaned up.
function runGateWithProbe(source: string): { status: number; output: string } {
  const probe = join(CARD_ROOT, 'src', '__import_allowlist_probe__.ts');
  try {
    writeFileSync(probe, source, 'utf8');
    try {
      const stdout = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
      return { status: 0, output: stdout };
    } catch (err: any) {
      // execFileSync throws on non-zero exit; FAIL lines go to stderr.
      return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  } finally {
    rmSync(probe, { force: true });
  }
}

describe('import-allowlist gate — RED path: the real gate FAILS on violations', () => {
  test('exits non-zero + emits a FAIL line on a disallowed package import', () => {
    const { status, output } = runGateWithProbe(`import axios from 'axios';\n`);
    expect(status).not.toBe(0);
    expect(output).toContain(`FAIL ${RULE}`);
    expect(output).toContain("runtime import 'axios' is not in the allowlist");
  });

  test('exits non-zero on a barrel (namespace) @mdi/js import', () => {
    const { status, output } = runGateWithProbe(`import * as mdi from '@mdi/js';\n`);
    expect(status).not.toBe(0);
    expect(output).toContain('named-path imports only');
    expect(output).toContain('namespace import');
  });

  test('exits non-zero on a default @mdi/js import', () => {
    const { status, output } = runGateWithProbe(`import mdi from '@mdi/js';\n`);
    expect(status).not.toBe(0);
    expect(output).toContain('default import');
  });

  test('exits non-zero on a side-effect @mdi/js import', () => {
    const { status, output } = runGateWithProbe(`import '@mdi/js';\n`);
    expect(status).not.toBe(0);
    expect(output).toContain('side-effect import');
  });
});

describe('import-allowlist gate — exemptions hold through the real TS-AST', () => {
  test('type-only import of a disallowed package is NOT flagged (AC4 — compiler-erased)', () => {
    // Proven through importEntries' real extraction, not a synthetic kind.
    const { status, output } = runGateWithProbe(`import type { Foo } from 'axios';\n`);
    expect(status).toBe(0);
    expect(output).toContain(`ok ${RULE}`);
  });

  test('all-type named bindings are erased and NOT flagged (AC4)', () => {
    const { status } = runGateWithProbe(`import { type Foo, type Bar } from 'd3';\n`);
    expect(status).toBe(0);
  });

  test('relative imports are NOT flagged regardless of form (AC3)', () => {
    const src = `import './side-effect';\nimport icon from './car.webp';\nexport * from '../helpers';\n`;
    const { status } = runGateWithProbe(src);
    expect(status).toBe(0);
  });

  test('named @mdi/js + lit + lit/* subpath all pass through the real AST', () => {
    const src =
      `import { mdiLock } from '@mdi/js';\n` +
      `import { LitElement } from 'lit';\n` +
      `import { customElement } from 'lit/decorators.js';\n`;
    const { status, output } = runGateWithProbe(src);
    expect(status).toBe(0);
    expect(output).toContain(`ok ${RULE}`);
  });
});

describe('import-allowlist gate — end to end on the committed repo', () => {
  test('real gate exits 0 (the codebase already complies)', () => {
    // Throws (non-zero exit) if the gate finds any disallowed runtime import.
    const out = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
    expect(out).toContain(`ok ${RULE}`);
  });
});
