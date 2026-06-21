// Co-located test for the Story 1.7 no-bare-hass.states gate (the data-access
// boundary AR-1/D2/D3): `hass.states` / `hass.entities` / `hass.devices` reads are
// allowed ONLY inside src/data/. The gate is the one hard architectural boundary of
// the suite — so, exactly like the trade-dress / import-allowlist / no-network-egress
// gates, this spec proves the gate actually WORKS, not just that it exports green:
//   (a) the pure `findViolations` matcher FLAGS each bare state-read form and PASSES
//       sanctioned `hass.*` / non-hass / string-or-comment forms (no false positives);
//   (b) the REAL gate exits non-zero + emits a FAIL line on a planted bare read (RED);
//   (c) the REAL gate exits 0 CLEAN on the committed repo (GREEN) — the boundary holds.
// Without (b) a refactor that silently neutered the AST walk would ship green; this is
// the meta-test that closes that gap (traceability gate, condition #1).
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { findViolations, RULE } from '../scripts/lint/no-bare-hass-states.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'no-bare-hass-states.mjs');
const CARD_ROOT = join(HERE, '..');

/** Member names present in the returned hits. */
const membersOf = (src: string): string[] =>
  findViolations('snippet.ts', src).map((h: { member: string }) => h.member);

describe('no-bare-hass.states gate — findViolations matcher', () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('no-bare-hass.states');
  });

  // --- FLAGS: each guarded bare state/registry read ---

  test('FLAGS property-access reads: hass.states / hass.entities / hass.devices', () => {
    expect(membersOf(`const s = hass.states;\n`)).toEqual(['states']);
    expect(membersOf(`const e = hass.entities;\n`)).toEqual(['entities']);
    expect(membersOf(`const d = hass.devices;\n`)).toEqual(['devices']);
  });

  test('FLAGS element-access reads: hass["states"] and the indexed entity read', () => {
    expect(membersOf(`const all = hass['states'];\n`)).toEqual(['states']);
    expect(membersOf(`const one = hass['states']['sensor.odometer'];\n`)).toEqual(['states']);
  });

  test('FLAGS this.hass.states / *.hass.states (a property access whose name is hass)', () => {
    expect(membersOf(`const s = this.hass.states['x'];\n`)).toEqual(['states']);
    expect(membersOf(`const s = card.hass.states;\n`)).toEqual(['states']);
  });

  test('reports the correct 1-based line for a hit deeper in the file', () => {
    const hits = findViolations('snippet.ts', `const a = 1;\nconst b = 2;\nconst s = hass.states;\n`);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 3, member: 'states' });
  });

  test('returns EVERY hit (the CLI reports all failures, not just the first)', () => {
    const src = `const s = hass.states;\nconst e = hass.entities;\n`;
    expect(membersOf(src)).toEqual(['states', 'entities']);
  });

  // --- PASSES: sanctioned + benign forms (no false positives) ---

  test('PASSES non-state hass.* access (callService / localize / locale / connection)', () => {
    const src =
      `hass.callService('lock', 'lock', { entity_id: 'lock.x' });\n` +
      `hass.localize('ui.x');\nconst l = hass.locale;\nhass.connection.subscribeMessage(cb);\n`;
    expect(findViolations('snippet.ts', src)).toEqual([]);
  });

  test('PASSES a `states`/`entities` member on a NON-hass object', () => {
    expect(findViolations('snippet.ts', `const x = store.states;\nconst y = model.entities['a'];\n`)).toEqual([]);
  });

  test('does NOT false-positive on strings or comments mentioning hass.states', () => {
    const src = `// read hass.states only inside data/\nconst note = 'hass.states is boundary-gated';\n`;
    expect(findViolations('snippet.ts', src)).toEqual([]);
  });
});

// Runs the REAL gate over a temporarily-planted src file and returns its exit
// status + output. Proves the full collectTs → AST → findViolations → exit path.
// The probe is .gitignored and always cleaned up (Story 2.7 review-fix precedent).
function runGateWithProbe(source: string): { status: number; output: string } {
  const probe = join(CARD_ROOT, 'src', '__no_bare_hass_probe__.ts');
  try {
    writeFileSync(probe, source, 'utf8');
    try {
      const stdout = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
      return { status: 0, output: stdout };
    } catch (err: any) {
      return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  } finally {
    rmSync(probe, { force: true });
  }
}

describe('no-bare-hass.states gate — RED path: the real gate FAILS on a planted bare read', () => {
  test('exits non-zero + emits a FAIL line on hass.states outside src/data/', () => {
    const { status, output } = runGateWithProbe(`export const read = (hass: any) => hass.states['sensor.odometer'];\n`);
    expect(status).not.toBe(0);
    expect(output).toContain(`FAIL ${RULE}`);
    expect(output).toContain('hass.states');
    expect(output).toContain('__no_bare_hass_probe__.ts');
  });

  test('exits non-zero on a bare hass.entities registry read too', () => {
    const { status, output } = runGateWithProbe(`export const reg = (hass: any) => hass.entities;\n`);
    expect(status).not.toBe(0);
    expect(output).toContain('hass.entities');
  });
});

describe('no-bare-hass.states gate — sanctioned forms pass through the real AST', () => {
  test('a probe that only calls hass.callService is NOT flagged (gate exits 0)', () => {
    const src =
      `export function act(hass: any) {\n` +
      `  hass.callService('lock', 'lock', { entity_id: 'lock.x' });\n` +
      `}\n`;
    const { status, output } = runGateWithProbe(src);
    expect(status).toBe(0);
    expect(output).toContain(`ok ${RULE}`);
  });
});

describe('no-bare-hass.states gate — end to end on the committed repo', () => {
  test('real gate exits 0 (the boundary holds — no bare state reads outside src/data/)', () => {
    const out = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
    expect(out).toContain(`ok ${RULE}`);
  });
});
