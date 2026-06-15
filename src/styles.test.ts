// Token-contract gate for Story 2.1 (`--tc-*` token contract / FR-28).
//
// Two assertions, both gate-shaped (not claims) per the Epic-1 retro lesson:
//   (a) the type-ramp + spacing + radius/shadow tokens exist in the `tokens`
//       declaration block (AC1);
//   (b) ZERO bare `var(--tc-*)` reads remain anywhere in src/ — every
//       consumption carries a DESIGN.md fallback (AC2). Mirrors the Story 1.7
//       structural-gate shape; backs the corpus-wide claim with a real scan.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { tokens } from './styles';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Recursively collect every non-test .ts file under src/. */
function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...srcFiles(full));
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('--tc-* token contract (Story 2.1)', () => {
  const css = (tokens as unknown as { cssText: string }).cssText;

  test('AC1: type ramp — all 8 DESIGN.md roles define size + weight tokens', () => {
    const roles = [
      'label', 'name', 'body', 'stat-key',
      'battery', 'charging-display', 'climate-readout', 'display',
    ];
    for (const r of roles) {
      expect(css, `missing --tc-fs-${r}`).toContain(`--tc-fs-${r}:`);
      expect(css, `missing --tc-fw-${r}`).toContain(`--tc-fw-${r}:`);
    }
    expect(css, 'missing --tc-font-display').toContain('--tc-font-display:');
  });

  test('AC1: spacing scale — 4px-based --tc-space-1..4 with -4 = --tc-gap = 16px', () => {
    expect(css).toContain('--tc-space-1: 4px;');
    expect(css).toContain('--tc-space-2: 8px;');
    expect(css).toContain('--tc-space-3: 12px;');
    expect(css).toContain('--tc-space-4: 16px;');
    expect(css).toContain('--tc-gap: 16px;');
  });

  test('AC1: radius ramp + shadows match DESIGN.md verbatim', () => {
    expect(css).toContain('--tc-radius-sm: 12px;');
    expect(css).toContain('--tc-radius-md: 16px;');
    expect(css).toContain('--tc-radius-lg: 22px;');
    expect(css).toContain('--tc-radius-xl: 28px;');
    expect(css).toContain('--tc-pill: 999px;');
    expect(css).toContain('--tc-shadow: 0 18px 48px -16px rgba(0, 0, 0, 0.55);');
    expect(css).toContain('--tc-shadow-sm: 0 6px 18px -8px rgba(0, 0, 0, 0.5);');
  });

  test('AC2: zero bare var(--tc-*) reads — every consumption carries a fallback', () => {
    // bare = var( --tc-NAME ) with no comma (i.e. no fallback). A declaration
    // (`--tc-NAME: ...;`) never starts with `var(`, so it cannot match.
    const bare = /var\(\s*--tc-[a-z0-9-]+\s*\)/g;
    const offenders: string[] = [];
    for (const file of srcFiles(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(bare)) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders, `bare var(--tc-*) reads must carry a fallback:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('AC3: no token derives from an HA theme var except --tc-font (font chain)', () => {
    // Pull the :host declaration lines and ensure none read an HA theme var
    // (--ha-*, --primary-*, --paper-*, --card-*, --divider-*, --accent) except
    // the two font tokens, which legitimately inherit the host font chain.
    const lines = css.split('\n');
    const offenders = lines.filter((l) => {
      const decl = l.match(/^\s*(--tc-[a-z0-9-]+):/);
      if (!decl) return false;
      if (decl[1] === '--tc-font' || decl[1] === '--tc-font-display') return false;
      return /var\(\s*--(ha|primary|paper|card|divider|accent)/.test(l);
    });
    expect(offenders, `tokens must be literal (HA-theme-independent):\n${offenders.join('\n')}`).toEqual([]);
  });
});
