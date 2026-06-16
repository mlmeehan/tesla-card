// Neutral-logger gate for Story 2.5 (F6 / D6 — single `[tesla-card]` logger, no `#e82127`).
//
// Gate-shaped, backed by a real corpus scan (Epic-1 retro lesson):
//   (a) `console.*` appears ONLY in src/log.ts — every other module routes
//       through the `log` singleton;
//   (b) log.ts carries no brand colour — no `#e82127`, no Tesla-red rgb()/hsl();
//   (c) the logger prefixes a neutral `[tesla-card]` tag.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { log } from './log';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Recursively collect every non-test .ts file under src/ (styles.test.ts pattern). */
function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...srcFiles(full));
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('neutral logger (Story 2.5)', () => {
  test('AC2: console.* appears only in src/log.ts', () => {
    const offenders = srcFiles(SRC_DIR).filter(
      (f) => f !== join(SRC_DIR, 'log.ts') && /\bconsole\s*\.\s*\w+/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders, `console.* outside log.ts: ${offenders.join(', ')}`).toEqual([]);
  });

  test('AC2: log.ts carries no brand colour (#e82127 / Tesla red) — not even in comments', () => {
    const src = readFileSync(join(SRC_DIR, 'log.ts'), 'utf8');
    // AC3(b): zero `#e82127`/Tesla-red in log.ts. Assert the literal hex is
    // absent entirely (so the no-brand gate is unambiguous), plus the rgb() form.
    expect(/e82127/i.test(src), 'log.ts contains the Tesla-red hex e82127').toBe(false);
    expect(/rgb\(\s*232\s*,\s*33\s*,\s*39/i.test(src)).toBe(false);
  });

  test('AC2: logger prefixes a neutral [tesla-card] tag', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    log.info('hello');
    expect(spy).toHaveBeenCalledWith('[tesla-card]', 'hello');
    spy.mockRestore();
  });

  test('AC2: every logger level (info/warn/error/debug) carries the neutral prefix', () => {
    // The info path is gated above; warn/error/debug share the same contract —
    // assert the whole surface prefixes `[tesla-card]` so a future level can't
    // silently drop it.
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      const spy = vi.spyOn(console, level).mockImplementation(() => {});
      log[level]('payload', 1);
      expect(spy, `log.${level} dropped the prefix`).toHaveBeenCalledWith('[tesla-card]', 'payload', 1);
      spy.mockRestore();
    }
  });

  test('AC2: the startup banner is rerouted through `log` — no `%c` badge, no Tesla-red', () => {
    // The actual trade-dress blocker lived at the banner site in tesla-card.ts
    // (`console.info('%c TESLA-CARD %c …', 'background:#e82127;…')`), not in
    // log.ts. Gate the site directly: it must route through the logger, make no
    // direct `console.*` call, carry no `%c` styled-badge directive, and ship no
    // Tesla-red brand value. (`#e82127` appears only in an explanatory comment,
    // so match the styled-hex form `:#e82127` / `rgb(232,33,39)`, not the bare
    // word, to avoid false-positiving on the comment.)
    const src = readFileSync(join(SRC_DIR, 'tesla-card.ts'), 'utf8');
    expect(/console\s*\.\s*\w+/.test(src), 'tesla-card.ts still calls console.* directly').toBe(false);
    expect(/%c/.test(src), 'tesla-card.ts still uses a `%c` styled console badge').toBe(false);
    expect(/:\s*#e82127/i.test(src), 'tesla-card.ts still ships the Tesla-red hex as a style value').toBe(
      false
    );
    expect(/rgb\(\s*232\s*,\s*33\s*,\s*39/i.test(src)).toBe(false);
    expect(/\blog\s*\.\s*info\b/.test(src), 'tesla-card.ts banner not rerouted through log.info').toBe(true);
  });

  test('AC3: strings.ts and log.ts are leaf modules (import nothing) — keeps no-cycle green', () => {
    // Both new root modules must import nothing (no `data/`/`flow/`/`components/`
    // /`styles.ts` edge) so the dependency direction stays intact and no-cycle is
    // trivially green — a unit-level backstop for the structural lint.
    for (const rel of ['strings.ts', 'log.ts']) {
      const src = readFileSync(join(SRC_DIR, rel), 'utf8');
      const imports = src.match(/^\s*import\b.*$/gm) ?? [];
      expect(imports, `${rel} is not a leaf module — imports: ${imports.join(' | ')}`).toEqual([]);
    }
  });
});
