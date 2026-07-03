#!/usr/bin/env bash
# pre-flip-guard — release-time manual check to run BEFORE making this repo public
# (`gh repo edit mlmeehan/tesla-card --visibility public`).
#
# WHY THIS EXISTS: the `no-planning-artifacts.mjs` gate (npm run lint / pre-commit)
# is HEAD-only and NAME-only. Flipping a repo to public exposes the ENTIRE git
# history and every file's CONTENT, so this adds the two dimensions that gate
# can't see, plus a secret smell-test:
#   L1  the existing name/dir gate on the tracked tree        (baseline reuse)
#   L2  content fingerprint over UNTRUSTED tracked files       (planning doc under an innocuous name)
#   L3  planning-artifact NAMES anywhere in git HISTORY        (public exposes all commits/branches)
#   L4  secret/credential smell in the tree + history          (tokens, keys, real .env)
#
# This is NOT wired into `npm run lint`: it is a heavier, human-run release gate
# (it walks `git log --all`), meant to be run once before the visibility flip.
# Exit 0 = clear to flip. Non-zero = stop and inspect the flagged items.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
fail=0
hr() { printf '\n\033[1m── %s ──\033[0m\n' "$1"; }

hr "L1  name/dir gate on tracked tree (authoritative denylist)"
if node scripts/lint/no-planning-artifacts.mjs --tracked; then :; else fail=1; fi

hr "L2  content fingerprint over tracked files (catches innocuous names)"
# High-signal, artifact-BODY fingerprints — chosen so they fire on a pasted BMAD
# document but NOT on casual mentions in code comments. Bare "bmad" / "FR-<n>" /
# "retrospective" are intentionally absent (they live in legit provenance comments);
# the bmad-<skill> alternation lists only DOC-producing skills, excluding test-infra
# skills (bmad-qa-*, bmad-testarch-*) that appear in test provenance comments.
FINGERPRINT='Claude-Session:|bmad-(create-story|dev-story|create-epics|prd|correct-course|retrospective|sprint-planning|story-automator|create-architecture)|sprint-status\.ya?ml|traceability[- ]matrix|^#{1,4}[[:space:]]+(Acceptance Criteria|Tasks ?/ ?Subtasks|Dev Agent Record|Dev Notes|Change Log)\b|As a .*I want .*so that'
# EXCLUDE the files whose JOB is to describe the planning split — this guard and the
# name-gate + their tests, the infra that wires them (.gitignore/package.json/CI/hook),
# and the curated PUBLIC doc set (docs/**, incl. the KEEP allowlist). These trusted
# paths are covered by L1 (names) + L3 (history); L2 polices the UNTRUSTED remainder
# (src/…). pre-flip-guard.sh excludes ITSELF because it literally contains these
# fingerprint patterns (same self-reference reason no-planning-artifacts.mjs is excluded).
hits=$(git grep -nIiE "$FINGERPRINT" -- \
        ':!scripts/lint/pre-flip-guard.sh' \
        ':!scripts/lint/no-planning-artifacts.mjs' \
        ':!src/no-planning-artifacts.test.ts' \
        ':!.gitignore' \
        ':!package.json' \
        ':!.github/**' \
        ':!scripts/hooks/**' \
        ':!docs/**' \
        ':!tests/README.md' 2>/dev/null)
if [ -n "$hits" ]; then
  printf '\033[31mpotential planning content in untrusted tracked files:\033[0m\n%s\n' "$hits"
  echo "→ review each; a pasted story/PRD/retro body here must move to the sibling repo."
  fail=1
else
  echo "ok — no artifact-body fingerprints outside the trusted guard/doc paths"
fi

hr "L3  planning-artifact NAMES anywhere in git history (all commits/branches)"
# Every path that ever existed in history, run through the SAME matcher the gate uses.
node -e '
  import("./scripts/lint/no-planning-artifacts.mjs").then(async (m) => {
    const { execFileSync } = await import("node:child_process");
    const paths = new Set(
      String(execFileSync("git", ["log","--all","--pretty=format:","--name-only","--diff-filter=AM"]))
        .split("\n").map(s=>s.trim()).filter(Boolean)
    );
    const bad = [...paths].map(p => [p, m.matchPlanningArtifact(p)]).filter(([,h])=>h);
    if (bad.length) {
      console.error("\x1b[31mplanning artifacts in HISTORY (exposed once public):\x1b[0m");
      for (const [p,h] of bad) console.error(`  ${p} — ${h}`);
      process.exit(1);
    }
    console.error(`ok — ${paths.size} historical path(s) scanned, 0 planning artifacts in history`);
  }).catch(e=>{console.error(e);process.exit(2)});
' || fail=1

hr "L4  secret / credential smell (tree + history object names)"
SECRET='ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}'
tree_hits=$(git grep -nIE "$SECRET" -- ':!scripts/lint/pre-flip-guard.sh' 2>/dev/null)
# Real env / key files ever committed. Match a bare `.env` and real-value variants
# (.env.local/.production/…) but NOT placeholder templates (.example/.sample/.template/.dist).
env_hist=$(git log --all --pretty=format: --name-only --diff-filter=A | sort -u \
            | grep -iE '(^|/)\.env($|\.(local|production|prod|dev|development|staging|test))|\.pem$|\.p12$|id_rsa|(^|/)secrets?\.(json|ya?ml|txt)$' \
            | grep -ivE '\.(example|sample|template|dist)$' || true)
if [ -n "$tree_hits" ] || [ -n "$env_hist" ]; then
  [ -n "$tree_hits" ] && printf '\033[31msecret-shaped strings in tree:\033[0m\n%s\n' "$tree_hits"
  [ -n "$env_hist" ]  && printf '\033[31mreal secret/env files in history:\033[0m\n%s\n' "$env_hist"
  fail=1
else
  echo "ok — no secret-shaped strings in tree, no real .env/key files in history (templates ignored)"
fi

hr "VERDICT"
if [ "$fail" -eq 0 ]; then
  echo -e "\033[32m✔ CLEAR to make public.\033[0m  Then: gh repo edit mlmeehan/tesla-card --visibility public --accept-visibility-change-consequences"
else
  echo -e "\033[31m✘ HOLD — resolve the flagged items above before flipping visibility.\033[0m"
fi
exit $fail
