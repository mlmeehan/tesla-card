// Co-located test for the Story 2.8 no-network-egress gate.
//
// The gate lives in scripts/lint/ (a dep-light .mjs run by node directly, like the
// other structural gates). It exports its matcher (`findEgress`) side-effect-free so
// this Vitest spec can (a) plant each forbidden primitive and prove the matcher
// FLAGS it, (b) prove the sanctioned/benign forms PASS (no false positives), and
// (c) shell out to the real gate and prove it exits 0 CLEAN on the committed repo
// (the codebase already complies — the only outbound call is hass.callService).
// Mirrors import-allowlist.test.ts's "passes clean on the repo".
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { findEgress, RULE } from '../scripts/lint/no-network-egress.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'no-network-egress.mjs');
const CARD_ROOT = join(HERE, '..');

/** Primitives present in the returned hits. */
const primitivesOf = (src: string): string[] => findEgress(src).map((h: { primitive: string }) => h.primitive);

describe('no-network-egress gate — findEgress matcher', () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('no-network-egress');
  });

  // --- FLAGS: each forbidden direct egress primitive ---

  test('FLAGS a bare global fetch(...)', () => {
    const hits = findEgress(`fetch('https://analytics.example/collect');\n`);
    expect(hits).toHaveLength(1);
    expect(hits[0].primitive).toBe('fetch');
    expect(hits[0].line).toBe(1);
  });

  test('FLAGS window/globalThis/self-qualified fetch(...)', () => {
    expect(primitivesOf(`window.fetch('/x');\n`)).toEqual(['window.fetch']);
    expect(primitivesOf(`globalThis.fetch('/x');\n`)).toEqual(['globalThis.fetch']);
    expect(primitivesOf(`self.fetch('/x');\n`)).toEqual(['self.fetch']);
  });

  test('FLAGS navigator.sendBeacon(...)', () => {
    expect(primitivesOf(`navigator.sendBeacon('/t', 'data');\n`)).toEqual(['navigator.sendBeacon']);
  });

  test('FLAGS new XMLHttpRequest / WebSocket / EventSource / RTCPeerConnection', () => {
    expect(primitivesOf(`const x = new XMLHttpRequest();\n`)).toEqual(['new XMLHttpRequest']);
    expect(primitivesOf(`const w = new WebSocket('wss://x');\n`)).toEqual(['new WebSocket']);
    expect(primitivesOf(`const e = new EventSource('/s');\n`)).toEqual(['new EventSource']);
    expect(primitivesOf(`const p = new RTCPeerConnection();\n`)).toEqual(['new RTCPeerConnection']);
  });

  test('FLAGS global-qualified constructors too', () => {
    expect(primitivesOf(`new window.WebSocket('wss://x');\n`)).toEqual(['new window.WebSocket']);
  });

  test('reports the correct line for a hit deeper in the file', () => {
    const src = `const a = 1;\nconst b = 2;\nfetch('/late');\n`;
    expect(findEgress(src)).toEqual([{ primitive: 'fetch', line: 3 }]);
  });

  // --- PASSES: sanctioned HA channel + benign forms (AC3 precision, no false positives) ---

  test('PASSES the sanctioned hass.callService(...) outbound (card → HA → Tesla)', () => {
    expect(findEgress(`hass.callService('lock', 'lock', { entity_id: 'lock.x' });\n`)).toEqual([]);
  });

  test('PASSES other hass.* channels (callWS / callApi / connection)', () => {
    expect(findEgress(`hass.callWS({ type: 'x' });\nhass.callApi('get', 'states');\nhass.connection.subscribeMessage(cb);\n`)).toEqual([]);
  });

  test('PASSES a non-global method named fetch (x.fetch / this.fetch — AC3 precision)', () => {
    expect(findEgress(`obj.fetch();\nthis.fetch('row');\nstore.fetchState('id');\n`)).toEqual([]);
  });

  test('PASSES reading hass.states (in-memory property access, not network)', () => {
    expect(findEgress(`const s = hass.states['sensor.odometer'];\nconst all = hass.states;\n`)).toEqual([]);
  });

  test('does NOT false-positive on strings, comments, or prefetch-style identifiers', () => {
    const src =
      `// fetch the data and sendBeacon later\n` +
      `const note = 'call fetch() to refetch';\n` +
      `function prefetch() {}\nfunction refetch() {}\nprefetch();\n`;
    expect(findEgress(src)).toEqual([]);
  });

  test('does NOT flag a type position referencing a network type', () => {
    // AST type nodes are never call/new expressions → never matched.
    expect(findEgress(`let s: WebSocket | null = null;\nfunction f(r: XMLHttpRequest) { return r; }\n`)).toEqual([]);
  });

  // --- COMPLETENESS + extra precision (gaps surfaced by QA generate-e2e-tests) ---

  test('returns EVERY hit in source order (main() reports all failures, not just the first)', () => {
    // The CLI main() iterates findEgress(...) per file — it must surface all hits,
    // so a contributor planting two egress calls can't slip the second past CI.
    const src = `fetch('/a');\nconst w = new WebSocket('wss://b');\nnavigator.sendBeacon('/c', 'd');\n`;
    expect(findEgress(src)).toEqual([
      { primitive: 'fetch', line: 1 },
      { primitive: 'new WebSocket', line: 2 },
      { primitive: 'navigator.sendBeacon', line: 3 },
    ]);
  });

  test('PASSES a non-navigator .sendBeacon() method (AC3 precision — symmetric to .fetch())', () => {
    // Only `navigator.sendBeacon(...)` is egress; an arbitrary method named
    // sendBeacon on some other object is not (mirrors the obj.fetch() precision rule).
    expect(findEgress(`obj.sendBeacon('/x', 'd');\nthis.sendBeacon('y');\n`)).toEqual([]);
  });

  test('FLAGS globalThis/self-qualified constructors too (parity with window.*)', () => {
    // The gate treats window/globalThis/self uniformly for `new` — not just window.
    expect(primitivesOf(`new globalThis.WebSocket('wss://x');\n`)).toEqual(['new globalThis.WebSocket']);
    expect(primitivesOf(`new self.XMLHttpRequest();\n`)).toEqual(['new self.XMLHttpRequest']);
    expect(primitivesOf(`new window.EventSource('/s');\n`)).toEqual(['new window.EventSource']);
  });

  test('FLAGS an optional-call fetch?.(...) (no evasion via optional chaining)', () => {
    expect(primitivesOf(`fetch?.('https://x/collect');\n`)).toEqual(['fetch']);
  });
});

// Runs the REAL gate over a temporarily-planted src file and returns its exit
// status + output. Proves the full collectTs → AST → findEgress → exit path. The
// probe is always cleaned up (and .gitignored, so a hard-killed run leaves nothing
// committable — Story 2.7 review-fix precedent).
function runGateWithProbe(source: string): { status: number; output: string } {
  const probe = join(CARD_ROOT, 'src', '__no_network_egress_probe__.ts');
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

describe('no-network-egress gate — RED path: the real gate FAILS on planted egress', () => {
  test('exits non-zero + emits a FAIL line on a global fetch(...)', () => {
    const { status, output } = runGateWithProbe(`export function ping() { fetch('https://x/collect'); }\n`);
    expect(status).not.toBe(0);
    expect(output).toContain(`FAIL ${RULE}`);
    expect(output).toContain("direct network egress 'fetch' is forbidden");
    expect(output).toContain('AR-17');
  });

  test('exits non-zero on new XMLHttpRequest()', () => {
    const { status, output } = runGateWithProbe(`export const x = () => new XMLHttpRequest();\n`);
    expect(status).not.toBe(0);
    expect(output).toContain("'new XMLHttpRequest'");
  });

  test('exits non-zero on new WebSocket(...)', () => {
    const { status, output } = runGateWithProbe(`export const w = () => new WebSocket('wss://x');\n`);
    expect(status).not.toBe(0);
    expect(output).toContain("'new WebSocket'");
  });

  test('exits non-zero on new EventSource(...)', () => {
    const { status, output } = runGateWithProbe(`export const e = () => new EventSource('/s');\n`);
    expect(status).not.toBe(0);
    expect(output).toContain("'new EventSource'");
  });

  test('exits non-zero on navigator.sendBeacon(...)', () => {
    const { status, output } = runGateWithProbe(`export const t = () => navigator.sendBeacon('/t', 'd');\n`);
    expect(status).not.toBe(0);
    expect(output).toContain("'navigator.sendBeacon'");
  });
});

describe('no-network-egress gate — sanctioned forms pass through the real AST', () => {
  test('hass.callService + a non-global .fetch() method are NOT flagged (gate exits 0)', () => {
    const src =
      `export function act(hass: any, store: any) {\n` +
      `  hass.callService('lock', 'lock', { entity_id: 'lock.x' });\n` +
      `  return store.fetch('row');\n` +
      `}\n`;
    const { status, output } = runGateWithProbe(src);
    expect(status).toBe(0);
    expect(output).toContain(`ok ${RULE}`);
  });
});

describe('no-network-egress gate — end to end on the committed repo', () => {
  test('real gate exits 0 (the codebase already complies — hass-only outbound)', () => {
    // Throws (non-zero exit) if the gate finds any direct network egress.
    const out = execFileSync('node', [GATE], { cwd: CARD_ROOT, encoding: 'utf8' });
    expect(out).toContain(`ok ${RULE}`);
  });
});
