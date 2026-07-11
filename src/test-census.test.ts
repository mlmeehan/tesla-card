// Co-located test for the test-census gate's pure parsers/comparators.
// (Mirrors src/no-cycle.test.ts: import the helpers, never spawn the runners.)
import { describe, test, expect } from 'vitest';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { parseVitestListCount, parsePlaywrightTotal, compareCensus, RULE } from '../scripts/lint/test-census.mjs';

describe(`${RULE} gate — pure parsers`, () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('test-census');
  });

  describe('parseVitestListCount', () => {
    test('counts only lines carrying the " > " separator', () => {
      const out = [
        'src/a.test.ts > suite > does a thing',
        'src/a.test.ts > suite > does another thing',
        'src/b.test.ts > top-level test', // still has " > "
        '', // blank
        'some stray runner line without a separator',
      ].join('\n');
      expect(parseVitestListCount(out)).toBe(3);
    });

    test('tolerates trailing newline / blank lines (no off-by-one)', () => {
      expect(parseVitestListCount('src/x.test.ts > only test\n')).toBe(1);
      expect(parseVitestListCount('\n\n')).toBe(0);
      expect(parseVitestListCount('')).toBe(0);
    });
  });

  describe('parsePlaywrightTotal', () => {
    test('parses "Total: N tests in M files"', () => {
      expect(parsePlaywrightTotal('  [chromium] › a.spec.ts\nTotal: 300 tests in 23 files')).toBe(300);
    });

    test('handles the singular "1 test" form', () => {
      expect(parsePlaywrightTotal('Total: 1 test in 1 file')).toBe(1);
    });

    test('throws when the total line is absent (runner error)', () => {
      expect(() => parsePlaywrightTotal('Error: no tests found')).toThrow(/Total: N tests/);
    });
  });

  describe('compareCensus', () => {
    const base = { unitTests: 1688, e2eTests: 300, e2eSpecFiles: ['tests/e2e/a.spec.ts', 'tests/e2e/b.spec.ts'] };

    test('in-sync census yields no problems', () => {
      expect(compareCensus(base, { ...base })).toEqual([]);
    });

    test('flags a unit-count drift with a signed delta', () => {
      const problems = compareCensus(base, { ...base, unitTests: 1675 });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('unitTests');
      expect(problems[0]).toContain('(-13)');
    });

    test('flags an e2e-count drift with a signed delta', () => {
      const problems = compareCensus(base, { ...base, e2eTests: 302 });
      expect(problems[0]).toContain('e2eTests');
      expect(problems[0]).toContain('(+2)');
    });

    test('flags a NEW spec file on disk that the census omits (the File-List-omits-e2e wart)', () => {
      const actual = { ...base, e2eSpecFiles: [...base.e2eSpecFiles, 'tests/e2e/new.spec.ts'] };
      const problems = compareCensus(base, actual);
      expect(problems.some((p: string) => p.includes('NEW spec') && p.includes('new.spec.ts'))).toBe(true);
    });

    test('flags a census spec that no longer exists on disk', () => {
      const actual = { ...base, e2eSpecFiles: ['tests/e2e/a.spec.ts'] };
      const problems = compareCensus(base, actual);
      expect(problems.some((p: string) => p.includes('no longer on disk') && p.includes('b.spec.ts'))).toBe(true);
    });

    test('reports several drifts at once', () => {
      const actual = {
        unitTests: 1690,
        e2eTests: 301,
        e2eSpecFiles: ['tests/e2e/a.spec.ts', 'tests/e2e/c.spec.ts'],
      };
      // unit + e2e + one added (c) + one removed (b) = 4 problems
      expect(compareCensus(base, actual)).toHaveLength(4);
    });
  });
});
