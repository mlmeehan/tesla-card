// Co-located test for the no-planning-artifacts gate (keeps BMAD / planning
// artifacts out of this public-bound card repo; they live in the private sibling
// github.com/mlmeehan/tesla-card-planning).
//
// The gate lives in scripts/lint/ (a dep-light .mjs run by node directly, like the
// other structural gates) and exports its matcher side-effect-free so this Vitest
// spec can (a) prove the matcher FIRES on BMAD artifact names/dirs — including THIS
// project's real conventions (epic-story-slug, sprint-status.yaml), (b) prove it does
// NOT fire on the doc-project outputs the user keeps public (KEEP) or on ordinary
// code/docs/date-named files, and (c) exercise the CLI contract (--check / --staged /
// usage error) the two bash guard layers depend on. Mirrors trade-dress-denylist.test.ts.
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// @ts-expect-error — dep-light .mjs gate, no .d.ts (matches scripts/lint/* convention)
import { matchPlanningArtifact, toRepoRelative, KEEP, RULE } from '../scripts/lint/no-planning-artifacts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'scripts', 'lint', 'no-planning-artifacts.mjs');
const CARD_ROOT = join(HERE, '..');

/** Run the gate CLI, returning its exit status + combined output (no throw on non-zero). */
function runGate(args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync('node', [GATE, ...args], { cwd: CARD_ROOT, encoding: 'utf8' });
    return { status: 0, out };
  } catch (e: any) {
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('no-planning-artifacts gate — matcher fires on BMAD artifacts', () => {
  test('rule id is stable', () => {
    expect(RULE).toBe('no-planning-artifacts');
  });

  test('flags BMAD install / output / toolchain directories (the git add -f vector)', () => {
    expect(matchPlanningArtifact('_bmad/config.toml')).not.toBeNull();
    expect(matchPlanningArtifact('_bmad-output/brainstorming/session.md')).not.toBeNull();
    expect(matchPlanningArtifact('.claude/settings.json')).not.toBeNull();
  });

  test("flags THIS project's real story-file conventions (epic-story-slug, sharded, stories/)", () => {
    expect(matchPlanningArtifact('docs/5-10-media-panel.md')).not.toBeNull();
    expect(matchPlanningArtifact('1-1-bootstrap-the-verification-harness-step-0.md')).not.toBeNull();
    expect(matchPlanningArtifact('8-12-gw-term-anchor-to-card-visible-bottom.md')).not.toBeNull();
    expect(matchPlanningArtifact('8.12.md')).not.toBeNull(); // sharded epic.story
    expect(matchPlanningArtifact('story-8.12.md')).not.toBeNull();
    expect(matchPlanningArtifact('docs/8.12.story.md')).not.toBeNull();
    expect(matchPlanningArtifact('docs/stories/8.12.md')).not.toBeNull();
  });

  test('flags BMAD artifact filenames, in any directory, case-insensitive', () => {
    expect(matchPlanningArtifact('docs/prd.md')).not.toBeNull();
    expect(matchPlanningArtifact('PRD.md')).not.toBeNull();
    expect(matchPlanningArtifact('docs/epics.md')).not.toBeNull();
    expect(matchPlanningArtifact('epic-8.md')).not.toBeNull();
    expect(matchPlanningArtifact('docs/spec-gateway-bus-placement.md')).not.toBeNull();
    expect(matchPlanningArtifact('docs/ux-home-assistant-2026-06-14.md')).not.toBeNull();
    expect(matchPlanningArtifact('brief-home-assistant-2026-06-20.md')).not.toBeNull(); // bare 'brief-'
    expect(matchPlanningArtifact('product-brief.md')).not.toBeNull();
    expect(matchPlanningArtifact('prfaq.md')).not.toBeNull();
    expect(matchPlanningArtifact('market-research.md')).not.toBeNull();
    expect(matchPlanningArtifact('traceability-matrix.md')).not.toBeNull();
    expect(matchPlanningArtifact('test-design.md')).not.toBeNull();
    expect(matchPlanningArtifact('test-review.md')).not.toBeNull();
    expect(matchPlanningArtifact('nfr-assessment.md')).not.toBeNull();
    expect(matchPlanningArtifact('implementation-readiness-report-2026-06-15.md')).not.toBeNull();
    expect(matchPlanningArtifact('project-context.md')).not.toBeNull();
  });

  test('flags sprint-status YAML (the real artifact) and the real sprint .md names', () => {
    expect(matchPlanningArtifact('sprint-status.yaml')).not.toBeNull();
    expect(matchPlanningArtifact('docs/sprint-status.yml')).not.toBeNull();
    expect(matchPlanningArtifact('sprint-status.md')).not.toBeNull();
    expect(matchPlanningArtifact('sprint-planning.md')).not.toBeNull();
    expect(matchPlanningArtifact('docs/sprint-change-proposal.md')).not.toBeNull();
    expect(matchPlanningArtifact('correct-course.md')).not.toBeNull();
  });

  test('flags retrospectives even when date-prefixed or epic-prefixed', () => {
    expect(matchPlanningArtifact('retrospective.md')).not.toBeNull();
    expect(matchPlanningArtifact('2026-06-20-retrospective.md')).not.toBeNull();
    expect(matchPlanningArtifact('epic-8-retro.md')).not.toBeNull();
  });

  test('tolerates ./, leading slash and backslash separators', () => {
    expect(matchPlanningArtifact('./docs/prd.md')).not.toBeNull();
    expect(matchPlanningArtifact('/docs/prd.md')).not.toBeNull();
    expect(matchPlanningArtifact('docs\\prd.md')).not.toBeNull();
  });
});

describe('no-planning-artifacts gate — does NOT touch public docs / code', () => {
  test('keeps the doc-project siblings the user chose to publish (KEEP)', () => {
    for (const path of KEEP) {
      expect(matchPlanningArtifact(path as string)).toBeNull();
    }
    expect(matchPlanningArtifact('docs/architecture.md')).toBeNull();
    expect(matchPlanningArtifact('docs/source-tree-analysis.md')).toBeNull();
    expect(matchPlanningArtifact('docs/component-inventory.md')).toBeNull();
    expect(matchPlanningArtifact('docs/layer-contract.md')).toBeNull();
    expect(matchPlanningArtifact('docs/audit-r6-suite.md')).toBeNull();
    expect(matchPlanningArtifact('docs/audit-r6-vehicle-card.md')).toBeNull();
  });

  test('does not flag date-named docs (only epic-story numeric prefixes, ≤3 digits)', () => {
    expect(matchPlanningArtifact('docs/2026-06-20.md')).toBeNull();
    expect(matchPlanningArtifact('docs/2026-06-20-release-notes.md')).toBeNull(); // 4-digit year
    expect(matchPlanningArtifact('2026.06.md')).toBeNull();
  });

  test('does not flag look-alike names that are not BMAD artifacts', () => {
    expect(matchPlanningArtifact('docs/storybook.md')).toBeNull();
    expect(matchPlanningArtifact('docs/epicenter.md')).toBeNull();
    expect(matchPlanningArtifact('docs/special.md')).toBeNull(); // not spec
    expect(matchPlanningArtifact('docs/specification.md')).toBeNull(); // not spec
    expect(matchPlanningArtifact('docs/profiler-checklist-nfr1.md')).toBeNull();
    expect(matchPlanningArtifact('src/components/Button.stories.md')).toBeNull(); // Storybook docs
  });

  test('narrowed sprint rule allows a plausible public "sprint-board" UI doc', () => {
    expect(matchPlanningArtifact('docs/sprint-board.md')).toBeNull();
    expect(matchPlanningArtifact('docs/sprinting-fast.md')).toBeNull();
  });

  test('does not flag ordinary repo files', () => {
    expect(matchPlanningArtifact('README.md')).toBeNull();
    expect(matchPlanningArtifact('PUBLISHING.md')).toBeNull();
    expect(matchPlanningArtifact('docs/development-guide.md')).toBeNull();
    expect(matchPlanningArtifact('docs/privacy.md')).toBeNull();
    expect(matchPlanningArtifact('src/data/history.ts')).toBeNull();
    expect(matchPlanningArtifact('src/data/history.test.ts')).toBeNull();
    expect(matchPlanningArtifact('src/components/Button.stories.ts')).toBeNull();
    expect(matchPlanningArtifact('tests/e2e/vehicle-card.spec.ts')).toBeNull();
    expect(matchPlanningArtifact('package.json')).toBeNull();
  });
});

describe('no-planning-artifacts gate — toRepoRelative skips out-of-repo operands', () => {
  test('returns null for paths that resolve outside the repo', () => {
    expect(toRepoRelative('../tesla-card-planning/prd.md')).toBeNull();
    expect(toRepoRelative('/tmp/prd.md')).toBeNull();
    expect(toRepoRelative('./../prd.md')).toBeNull();
  });

  test('returns the repo-relative path for in-repo operands', () => {
    expect(toRepoRelative('docs/prd.md')).toBe('docs/prd.md');
    expect(toRepoRelative('./docs/prd.md')).toBe('docs/prd.md');
    expect(toRepoRelative(join(CARD_ROOT, 'docs/prd.md'))).toBe('docs/prd.md');
  });
});

describe('no-planning-artifacts gate — CLI contract (used by the bash guards)', () => {
  test('--check blocks a deny path (exit 1) and allows a KEEP path (exit 0)', () => {
    expect(runGate(['--check', 'docs/prd.md']).status).toBe(1);
    expect(runGate(['--check', '5-10-media-panel.md']).status).toBe(1);
    expect(runGate(['--check', 'sprint-status.yaml']).status).toBe(1);
    expect(runGate(['--check', 'docs/architecture.md']).status).toBe(0);
  });

  test('--check ignores an operand outside the repo (the sibling-repo move case)', () => {
    expect(runGate(['--check', '../tesla-card-planning/prd.md']).status).toBe(0);
  });

  test('an unknown argument is a usage error (exit 2)', () => {
    const r = runGate(['--bogus']);
    expect(r.status).toBe(2);
    expect(r.out).toContain('unknown argument');
  });

  test('passes clean (exit 0) on the tracked tree', () => {
    const r = runGate(['--tracked']);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`ok ${RULE}`);
  });
});
