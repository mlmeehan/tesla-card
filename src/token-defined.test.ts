// Co-located test for the token-defined gate (scripts/lint/token-defined.mjs).
//
// The gate lives in scripts/lint/ (a dep-light .mjs run by node directly, like the
// other structural gates). It exports its matchers side-effect-free so this Vitest
// spec can (a) plant an undefined `--tc-*` reference and prove the matcher FIRES
// (the demonstrated `--tc-fs-xs` / `--tc-radius` Epic-8 bug class), and (b) shell out
// to the real gate and prove it passes CLEAN on the committed tree. Mirrors how the
// other gate tests isolate their pure scanners.
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { scanDefinedTokens, scanReferences, violationsFor, RULE } from '../scripts/lint/token-defined.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'token-defined.mjs');
const CARD_ROOT = join(HERE, '..');

describe('token-defined gate — rule id', () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('token-defined');
  });
});

describe('token-defined gate — scanDefinedTokens', () => {
  test('collects CSS custom-property declarations', () => {
    const d = scanDefinedTokens('    --tc-radius-md: 16px;\n    --tc-text-dim: #9aa7b8;');
    expect(d.has('--tc-radius-md')).toBe(true);
    expect(d.has('--tc-text-dim')).toBe(true);
  });

  test('collects object-literal token keys and setProperty() runtime declarations', () => {
    expect(scanDefinedTokens("{ '--tc-paint': value }").has('--tc-paint')).toBe(true);
    expect(scanDefinedTokens("el.style.setProperty('--tc-paint', hex)").has('--tc-paint')).toBe(
      true,
    );
  });

  test('a var() READ is not mistaken for a declaration', () => {
    // `var(--tc-x):` could look like a decl to a naive `name:` regex — the leading
    // boundary excludes the `)` so the reference is not counted as a definition.
    expect(scanDefinedTokens('border-radius: var(--tc-radius-md, 16px);').has('--tc-radius-md')).toBe(
      false,
    );
  });
});

describe('token-defined gate — scanReferences', () => {
  test('finds a var(--tc-*) reference with 1-based line/col', () => {
    const hits = scanReferences('a\n  color: var(--tc-text-dim, #9aa7b8);');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ token: '--tc-text-dim', line: 2 });
    expect(hits[0].col).toBeGreaterThan(1);
  });

  test('skips dynamic var(--tc-${expr}) and the var(--tc-*) doc shorthand (no literal name)', () => {
    expect(scanReferences('color: var(--tc-${key}, #000);')).toHaveLength(0);
    expect(scanReferences('// every var(--tc-*) carries its own fallback')).toHaveLength(0);
  });

  test('does not match non-tc tokens (HA theme / component-local namespaces)', () => {
    expect(scanReferences('color: var(--primary-text-color);')).toHaveLength(0);
    expect(scanReferences('color: var(--bat-pct-color, #fff);')).toHaveLength(0);
  });
});

describe('token-defined gate — violationsFor (the demonstrated bug class)', () => {
  const valid = new Set(['--tc-text-dim', '--tc-radius-md']);

  test('FLAGS a referenced-but-undefined token (the --tc-fs-xs / --tc-radius Epic-8 defect)', () => {
    expect(violationsFor('font-size: var(--tc-fs-xs);', valid)).toHaveLength(1);
    expect(violationsFor('border-radius: var(--tc-radius, 14px);', valid)).toHaveLength(1);
  });

  test('PASSES a reference that resolves to a defined token', () => {
    expect(violationsFor('color: var(--tc-text-dim, #9aa7b8);', valid)).toHaveLength(0);
    expect(violationsFor('border-radius: var(--tc-radius-md, 16px);', valid)).toHaveLength(0);
  });

  test('a fallback literal does NOT excuse an undefined token (the silent-drift trap)', () => {
    // The Epic-8 bug rendered "fine enough" via the fallback — the gate must still fire.
    expect(violationsFor('font-size: var(--tc-fs-xs, 10px);', valid)).toHaveLength(1);
  });
});

describe('token-defined gate — end to end on the committed repo', () => {
  test('passes clean (exit 0): every shipped var(--tc-*) resolves to a defined token', () => {
    const out = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
    expect(out).toContain(`ok ${RULE}`);
  });
});
