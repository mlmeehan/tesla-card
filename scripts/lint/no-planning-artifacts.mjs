#!/usr/bin/env node
// no-planning-artifacts gate — keep BMAD / planning artifacts OUT of this repo.
//
// This (public-bound) tesla-card repo holds the CARD; the BMAD planning artifacts
// (PRD, epics, stories, sprint status, retrospectives, brainstorming, research,
// test-architecture matrices, …) live in the PRIVATE sibling repo
// github.com/mlmeehan/tesla-card-planning. BMAD is already configured to write
// there (_bmad/config.toml: `output_folder = "{project-root}/../tesla-card-planning"`),
// but a stray workflow output, a `git add -f`, or a hand-written planning doc can
// still land here. This gate is the hard, single-source-of-truth backstop that the
// three layers share:
//   • npm run lint  → runs `--tracked`  (whole committed tree must be clean) → CI.
//   • scripts/hooks/pre-commit → runs `--staged` (this commit must be clean).
//   • .claude/hooks/guard-no-planning-artifacts.sh → `--staged` on `git commit`
//     and `--check <paths>` on `git add -f`, so Claude is blocked pre-emptively.
//
// NECESSARY, NOT SUFFICIENT (the trade-dress-denylist.mjs lesson): a filename regex
// cannot read content, so a planning doc saved under an innocuous name (`notes.md`)
// slips through. This is a high-signal NAME/dir denylist, not a content classifier —
// extend it (append-only) when a new BMAD output name appears; never weaken silently.
//
// DELIBERATELY ANCHORED so it never fights real work: it matches the BMAD install/
// output dirs (_bmad/, _bmad-output/, .claude/) and a curated set of BMAD artifact
// FILENAMES — NOT broad terms like "architecture", "audit", "source-tree",
// "component", "layer", or "nfr", which are legitimate PUBLIC docs here. The six
// doc-project outputs the user chose to keep public are pinned in KEEP below.
//
// Dep-light: node:child_process + git + node:path only. No new deps, no ESLint
// (this repo runs custom scripts/lint/*.mjs gates). ESM / Node 20. Importing this
// module is side-effect-free — the co-located Vitest spec imports the matcher; the
// scan runs only when executed as a CLI (see the main guard at the bottom).

import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const RULE = 'no-planning-artifacts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/

// The private sibling repo these artifacts belong in (named in failure output).
const PLANNING_REPO = 'github.com/mlmeehan/tesla-card-planning';

// ── KEEP: doc-project outputs the user confirmed stay PUBLIC in this repo (decision
// recorded 2026-06-21). These are brownfield docs describing the shipped code, not
// private planning. None are matched by the patterns below — KEEP is belt-and-
// suspenders + executable documentation of the decision, so a future pattern tweak
// can never accidentally evict them. Exact posix paths relative to repo root. ──────
export const KEEP = new Set([
  'docs/architecture.md',
  'docs/source-tree-analysis.md',
  'docs/component-inventory.md',
  'docs/layer-contract.md',
  'docs/audit-r6-suite.md',
  'docs/audit-r6-vehicle-card.md',
]);

// ── Directory / path-shape denials (tested against the full posix relpath). ───────
const DIR_DENY = [
  // The BMAD install + its local output dir, and the local-only Claude toolchain.
  // All gitignored already; denied here so a `git add -f _bmad-output/x` is caught.
  { re: /^_bmad(-output)?\//i, msg: 'BMAD install / output directory' },
  { re: /^\.claude\//i, msg: 'local-only Claude toolchain (skills/hooks/settings)' },
  // A markdown file under any `stories/` directory == BMAD story file. Scoped to
  // `.md` so Storybook `*.stories.ts` never matches, and the negative lookahead also
  // lets a Storybook docs page (`*.stories.md`) through (this repo ships no Storybook;
  // belt-and-suspenders + the KEEP escape hatch cover the rest).
  { re: /(^|\/)stories\/(?![^/]*\.stories\.md$)[^/]*\.md$/i, msg: 'BMAD story markdown (stories/*.md)' },
];

// ── Filename denials (tested against the basename, case-insensitive). Each pattern
// uses the `name([-_. ]…)?\.md` shape so it matches `name.md` and `name-<suffix>.md`
// but NOT a longer word that merely starts with it (e.g. `storybook.md`, `epicenter
// .md`, `architecture.md` all fall through). Append-only — add a row per new BMAD
// output name, with a comment naming the producing workflow. ──────────────────────
const NAME_DENY = [
  // Story files. THIS project's real convention (verified in the sibling planning
  // repo's implementation-artifacts/) is `<epic>-<story>-<slug>.md`
  // (e.g. 5-10-media-panel.md, 8-12-gw-term-anchor.md) and sharded `<epic>.<story>.md`
  // (e.g. 8.12.md), in ADDITION to the generic bmad-create-story `story-*.md` /
  // `*.story.md` forms. The numeric prefixes are bounded to 1–3 digits and the slug
  // form requires a LETTER, so a date-named doc (2026-06-20.md / 2026-06-20-notes.md)
  // can never match.
  { re: /^\d{1,3}-\d{1,3}-.*[a-z].*\.md$/i, msg: 'BMAD story file (epic-story-slug, bmad-create-story)' },
  { re: /^\d{1,3}\.\d{1,3}\.md$/i, msg: 'BMAD sharded story file (epic.story, bmad-create-story)' },
  { re: /^story([-_. ].*)?\.md$/i, msg: 'story file (bmad-create-story)' },
  { re: /\.story\.md$/i, msg: 'story file (bmad-create-story)' },
  { re: /^prd([-_. ].*)?\.md$/i, msg: 'PRD (bmad-prd)' },
  { re: /^epics?([-_. ].*)?\.md$/i, msg: 'epics list (bmad-create-epics-and-stories)' },
  { re: /^spec([-_. ].*)?\.md$/i, msg: 'SPEC kernel (bmad-spec)' },
  { re: /^ux[-_ ].+\.md$/i, msg: 'UX spec / design (bmad-ux)' },
  // Sprint artifacts — narrowed to the real bmad-sprint-* / correct-course output
  // names so a plausible PUBLIC "sprint-board.md" UI doc is NOT collateral (matches
  // the .gitignore globs). The canonical sprint-status is YAML, not Markdown.
  { re: /^sprint[-_ ](status|planning|plan|change)([-_. ].*)?\.md$/i, msg: 'sprint status / plan / change (bmad-sprint-*)' },
  { re: /^sprint[-_ ]?status([-_. ].*)?\.ya?ml$/i, msg: 'sprint status (bmad-sprint-planning, YAML)' },
  { re: /^correct[-_ ]course([-_. ].*)?\.md$/i, msg: 'sprint change proposal (bmad-correct-course)' },
  // retro: token-anywhere (not only leading) so a date-prefixed 2026-06-20-retro.md
  // or epic-8-retro.md is caught too.
  { re: /(^|[-_ ])retro(spective)?([-_. ].*)?\.md$/i, msg: 'retrospective (bmad-retrospective)' },
  { re: /^brainstorming([-_. ].*)?\.md$/i, msg: 'brainstorming session (bmad-brainstorming)' },
  // product brief — `product` prefix optional (this project names briefs `brief-<slug>`).
  { re: /^(product[-_ ]?)?brief([-_. ].*)?\.md$/i, msg: 'product brief (bmad-product-brief)' },
  { re: /^pr[-_ ]?faq([-_. ].*)?\.md$/i, msg: 'PRFAQ (bmad-prfaq)' },
  { re: /^(market|domain|technical)[-_ ]research([-_. ].*)?\.md$/i, msg: 'research report (bmad-*-research)' },
  { re: /^traceability[-_ ]matrix([-_. ].*)?\.md$/i, msg: 'traceability matrix (bmad-testarch-trace)' },
  { re: /^test[-_ ]design([-_. ].*)?\.md$/i, msg: 'test design (bmad-testarch-test-design)' },
  { re: /^test[-_ ]review([-_. ].*)?\.md$/i, msg: 'test review (bmad-testarch-test-review)' },
  { re: /^nfr[-_ ]assessment([-_. ].*)?\.md$/i, msg: 'NFR assessment (bmad-testarch-nfr)' },
  { re: /^implementation[-_ ]readiness([-_. ].*)?\.md$/i, msg: 'implementation readiness (bmad-check-implementation-readiness)' },
  { re: /^project[-_ ]context\.md$/i, msg: 'project context (bmad-generate-project-context)' },
];

/**
 * Classify a repo-relative path. Returns a short reason string when the path is a
 * planning artifact that must NOT live in this repo, or null when it's allowed.
 * Pure + side-effect-free so the co-located Vitest spec can assert deny/keep cases.
 * @param {string} relPath posix-ish path relative to repo root (./, \\ tolerated)
 * @returns {string|null}
 */
export function matchPlanningArtifact(relPath) {
  const rel = String(relPath ?? '')
    .replace(/\\/g, '/') // tolerate Windows separators
    .replace(/^\.\//, '') // strip a leading ./
    .replace(/^\/+/, ''); // a leading slash → treat as repo-relative
  if (!rel) return null;
  if (KEEP.has(rel)) return null;

  for (const { re, msg } of DIR_DENY) if (re.test(rel)) return msg;

  const base = rel.split('/').pop() || '';
  for (const { re, msg } of NAME_DENY) if (re.test(base)) return msg;

  return null;
}

// ── CLI plumbing ──────────────────────────────────────────────────────────────────

/** NUL-split, drop empties — for `-z` git output. */
function nulList(buf) {
  return String(buf).split('\0').filter(Boolean);
}

/** Files in the committed tree (default / --tracked mode). */
function trackedFiles() {
  return nulList(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }));
}

/**
 * Files staged for THIS commit (--staged mode). diff-filter ACMRT = Added/Copied/
 * Modified/Renamed/Type-changed — everything except a pure Deletion (removing a
 * planning artifact is fine). T is included so a regular-file→symlink swap of a
 * blocked name is still caught (the matcher is name-based, so widening is safe).
 */
function stagedFiles() {
  return nulList(
    execFileSync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z'],
      { cwd: ROOT, encoding: 'utf8' },
    ),
  );
}

/**
 * Normalize an operand to a repo-relative posix path, or return null if it resolves
 * OUTSIDE this repo (an absolute path not under ROOT, or a `../` escape). Callers
 * skip nulls — a `git add -f ../tesla-card-planning/prd.md` (a legit move INTO the
 * sibling repo, which git rejects anyway) must not be reported as polluting THIS repo.
 */
export function toRepoRelative(p) {
  const s = String(p).replace(/\\/g, '/');
  const rootPosix = ROOT.replace(/\\/g, '/').replace(/\/+$/, '');
  if (s === rootPosix) return null; // the repo root itself, not a file
  if (s.startsWith(rootPosix + '/')) return s.slice(rootPosix.length + 1); // absolute, in-repo
  if (s.startsWith('/')) return null; // absolute, outside the repo
  if (s.replace(/^\.\//, '').startsWith('../')) return null; // relative, escapes the repo
  return s.replace(/^\.\//, ''); // ordinary repo-relative
}

function main(argv) {
  const args = argv.slice(2);
  let mode = 'tracked';
  let checkPaths = [];
  if (args[0] === '--staged') mode = 'staged';
  else if (args[0] === '--tracked') mode = 'tracked';
  else if (args[0] === '--check') {
    mode = 'check';
    checkPaths = args.slice(1).map(toRepoRelative).filter((p) => p != null);
  } else if (args.length > 0) {
    console.error(`${RULE}: unknown argument(s): ${args.join(' ')}`);
    console.error('usage: no-planning-artifacts.mjs [--tracked | --staged | --check <path...>]');
    process.exit(2);
  }

  let files;
  if (mode === 'staged') files = stagedFiles();
  else if (mode === 'check') files = checkPaths;
  else files = trackedFiles();

  const failures = [];
  for (const rel of files) {
    const hit = matchPlanningArtifact(rel);
    if (hit) failures.push(`FAIL ${RULE} ${rel} — ${hit}`);
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(
      `\n${RULE}: ${failures.length} planning artifact(s) in the ${mode} set.\n` +
        `These belong in the private ${PLANNING_REPO} repo (BMAD output_folder=../tesla-card-planning), ` +
        `not in this public-bound card repo.\n` +
        `If a file is genuinely a public doc, add its exact path to the KEEP allowlist in ` +
        `scripts/lint/no-planning-artifacts.mjs.`,
    );
    process.exit(1);
  }

  console.log(`ok ${RULE} — ${files.length} ${mode} path(s) checked, 0 planning artifacts`);
}

// CLI-only: importing this module (for the test / the bash guards) must not scan.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv);
}
