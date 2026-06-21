// Co-located test for the Story 1.7 no-cycle gate (AR-11 structural): the src/
// module graph (relative ESM runtime imports) must be ACYCLIC, guarding the
// dependency-direction boundary data/ ← flow/ ← components/. Like the trade-dress /
// import-allowlist / no-network-egress gates, this spec proves the gate WORKS:
//   (a) the pure `findCycles` detector finds back-edges (and only real ones), and
//       `importSpecifiers` counts only relative RUNTIME edges (type-only/bare erased);
//   (b) the REAL gate exits non-zero + names the cycle chain on a planted A↔B import
//       cycle (RED);
//   (c) the REAL gate exits 0 CLEAN on the committed graph (GREEN).
// Closes the meta-test gap (traceability gate, condition #1): a refactor that broke
// the DFS colouring or the type-only-erasure would now fail this, not ship green.
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { findCycles, importSpecifiers, RULE } from '../scripts/lint/no-cycle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'no-cycle.mjs');
const CARD_ROOT = join(HERE, '..');

/** Build a `Map<string, string[]>` graph from a plain object adjacency list. */
const g = (adj: Record<string, string[]>): Map<string, string[]> => new Map(Object.entries(adj));

describe('no-cycle gate — findCycles detector', () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('no-cycle');
  });

  test('an acyclic graph (a → b → c) yields no cycles', () => {
    expect(findCycles(g({ a: ['b'], b: ['c'], c: [] }))).toEqual([]);
  });

  test('a 2-node cycle a → b → a is detected and reported as a closed chain', () => {
    const cycles = findCycles(g({ a: ['b'], b: ['a'] }));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(['a', 'b', 'a']); // closing node repeated
  });

  test('a self-edge a → a is a cycle', () => {
    expect(findCycles(g({ a: ['a'] }))).toEqual([['a', 'a']]);
  });

  test('a longer cycle a → b → c → a is detected', () => {
    const cycles = findCycles(g({ a: ['b'], b: ['c'], c: ['a'] }));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(['a', 'b', 'c', 'a']);
  });

  test('a diamond (shared dep, no back-edge) is NOT a cycle', () => {
    // a → b → d, a → c → d. d is reached twice but never via a back-edge.
    expect(findCycles(g({ a: ['b', 'c'], b: ['d'], c: ['d'], d: [] }))).toEqual([]);
  });

  test('distinct cycles are each reported once (no duplicate chains)', () => {
    const cycles = findCycles(g({ a: ['b'], b: ['a'], c: ['d'], d: ['c'] }));
    expect(cycles).toHaveLength(2);
  });
});

describe('no-cycle gate — importSpecifiers (only relative RUNTIME edges count)', () => {
  test('includes a relative value import', () => {
    expect(importSpecifiers('f.ts', `import { x } from './sibling';\n`)).toEqual(['./sibling']);
  });

  test('includes a default import and a side-effect import', () => {
    expect(importSpecifiers('f.ts', `import foo from './def';\n`)).toEqual(['./def']);
    expect(importSpecifiers('f.ts', `import './side-effect';\n`)).toEqual(['./side-effect']);
  });

  test('includes a dynamic import("./x")', () => {
    expect(importSpecifiers('f.ts', `const m = await import('./dyn');\n`)).toEqual(['./dyn']);
  });

  test('EXCLUDES bare (package) specifiers — they form no relative edge', () => {
    expect(importSpecifiers('f.ts', `import { LitElement } from 'lit';\nimport { mdiCar } from '@mdi/js';\n`)).toEqual([]);
  });

  test('EXCLUDES a type-only import (erased at runtime — no cycle)', () => {
    expect(importSpecifiers('f.ts', `import type { T } from './types';\n`)).toEqual([]);
  });

  test('EXCLUDES an all-type named import, INCLUDES one with ≥1 value binding', () => {
    expect(importSpecifiers('f.ts', `import { type A, type B } from './alltype';\n`)).toEqual([]);
    expect(importSpecifiers('f.ts', `import { type A, b } from './mixed';\n`)).toEqual(['./mixed']);
  });
});

// Plants a mutually-importing probe pair (a ↔ b) under src/, runs the REAL gate,
// and returns its exit status + output. Both probes are .gitignored and always
// cleaned up. A 2-file cycle is the canonical case the gate exists to block.
function runGateWithCycleProbes(): { status: number; output: string } {
  const a = join(CARD_ROOT, 'src', '__no_cycle_probe_a__.ts');
  const b = join(CARD_ROOT, 'src', '__no_cycle_probe_b__.ts');
  try {
    writeFileSync(a, `import './__no_cycle_probe_b__';\nexport const a = 1;\n`, 'utf8');
    writeFileSync(b, `import './__no_cycle_probe_a__';\nexport const b = 1;\n`, 'utf8');
    try {
      const stdout = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
      return { status: 0, output: stdout };
    } catch (err: any) {
      return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  } finally {
    rmSync(a, { force: true });
    rmSync(b, { force: true });
  }
}

describe('no-cycle gate — RED path: the real gate FAILS on a planted import cycle', () => {
  test('exits non-zero + names the cycle chain on a → b → a', () => {
    const { status, output } = runGateWithCycleProbes();
    expect(status).not.toBe(0);
    expect(output).toContain(`FAIL ${RULE}`);
    expect(output).toContain('__no_cycle_probe_a__.ts');
    expect(output).toContain('__no_cycle_probe_b__.ts');
    expect(output).toContain('→'); // the offending path chain is printed
  });
});

describe('no-cycle gate — end to end on the committed repo', () => {
  test('real gate exits 0 (the module graph is acyclic)', () => {
    const out = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
    expect(out).toContain(`ok ${RULE}`);
  });
});
