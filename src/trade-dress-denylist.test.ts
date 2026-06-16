// Co-located test for the Story 2.6 trade-dress denylist gate.
//
// The gate lives in scripts/lint/ (a dep-light .mjs run by node directly, like the
// other structural gates). It exports its matchers side-effect-free so this Vitest
// spec can (a) plant brand tokens and prove the matcher FIRES, and (b) shell out
// to the real gate and prove it passes CLEAN on the committed repo after the
// Story 2.6 relabel/cleanup. Mirrors how the AST gates isolate `findViolations`.
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { scanContent, scanFilename, RULE } from '../scripts/lint/trade-dress-denylist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'trade-dress-denylist.mjs');
const CARD_ROOT = join(HERE, '..');

describe('trade-dress gate — content matcher', () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('trade-dress');
  });

  test('flags the brand red #e82127 as a style value', () => {
    expect(scanContent('  background: #e82127;')).toHaveLength(1);
    expect(scanContent('  border-color:#e82127;')).toHaveLength(1);
  });

  test('flags the brand red in rgb()/hsl() forms', () => {
    expect(scanContent('color: rgb(232, 33, 39)')).toHaveLength(1);
    expect(scanContent('color: rgba(232,33,39,0.5)')).toHaveLength(1);
    expect(scanContent('color: hsl(357, 82%, 52%)')).toHaveLength(1);
  });

  test('flags Tesla paint option codes (case-insensitive, word-bounded)', () => {
    expect(scanContent("ppsw: '#eceeef',")).toHaveLength(1);
    expect(scanContent('PBSB PMNG PPSB')).toHaveLength(3);
    // word-bounded: a substring inside another token must not fire
    expect(scanContent('appswitcher = 1')).toHaveLength(0);
  });

  test('flags the Tesla wordmark with a ®/™ brand mark', () => {
    expect(scanContent('Tesla® is a trademark')).toHaveLength(1);
    expect(scanContent('Tesla™')).toHaveLength(1);
  });

  test('does NOT flag legitimate non-branding references', () => {
    // bare prose mention asserting absence (not a style value)
    expect(scanContent('the log carries no #e82127 brand badge')).toHaveLength(0);
    // the project name, the integration id, factual product references
    expect(scanContent("import './components/tesla-card';")).toHaveLength(0);
    expect(scanContent('the tesla_fleet integration exposes no colour')).toHaveLength(0);
    expect(scanContent('works with a Tesla Powerwall and Wall Connector')).toHaveLength(0);
    // the required legal disclaimer naming the company is allowed
    expect(scanContent('MIT © Mike Meehan. Not affiliated with Tesla, Inc.')).toHaveLength(0);
    // a retained generic palette line (hex kept, name generic) is fine
    expect(scanContent("blue: '#2a4f93',")).toHaveLength(0);
  });

  test('reports 1-based line and column', () => {
    const hits = scanContent('line one\n  background: #e82127;');
    expect(hits[0].line).toBe(2);
    expect(hits[0].col).toBeGreaterThan(1);
  });
});

describe('trade-dress gate — filename matcher', () => {
  test('flags committed Tesla artwork / logo / badge filenames', () => {
    expect(scanFilename('assets/tesla-front.svg')).not.toBeNull();
    expect(scanFilename('assets/tesla-topdown.svg')).not.toBeNull();
    expect(scanFilename('docs/tesla-logo.png')).not.toBeNull();
    expect(scanFilename('img/tesla_badge.webp')).not.toBeNull();
  });

  test('allows the project bundle, page objects and non-Tesla assets', () => {
    expect(scanFilename('dist/tesla-card.js')).toBeNull();
    expect(scanFilename('src/tesla-card.ts')).toBeNull();
    expect(scanFilename('tests/support/page-objects/tesla-card.page.ts')).toBeNull();
    expect(scanFilename('docs/screenshot-asleep.png')).toBeNull();
  });
});

describe('trade-dress gate — end to end on the committed repo', () => {
  test('passes clean (exit 0) after the Story 2.6 relabel + cleanup', () => {
    // Throws (non-zero exit) if the gate finds any violation in the tracked tree.
    const out = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
    expect(out).toContain(`ok ${RULE}`);
  });
});
