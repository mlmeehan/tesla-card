#!/usr/bin/env node
// trade-dress denylist gate — Story 2.6 (AR-12 / AR-11 / D6 · §12.1 / SM-C3).
//
// Merge-blocking build invariant: no Tesla trade dress may ship. This gate scans
// the COMMITTED tree (via `git ls-files`, never the working tree / gitignored art)
// and fails CI on Tesla brand tokens that can leak through source:
//   • the brand red `#e82127` AS A STYLE VALUE, plus its rgb()/hsl() forms;
//   • Tesla option codes (PPSW / PBSB / … — the bundled palette's API codes);
//   • Tesla wordmark used AS BRANDING (`Tesla®`, `Tesla™`, `Tesla, Inc.`);
//   • committed logo/badge/wordmark/raster asset FILENAMES (a "T" badge, a Tesla
//     render) — the regex can only see the filename, not the pixels.
//
// NECESSARY, NOT SUFFICIENT. A regex CANNOT see a logo inside a raster, a traced
// silhouette, or paraphrased branding. Pair every NET-NEW asset *category* (a
// committed WebP/PNG/SVG render, a new font, an icon set) with the human review
// step in docs/trade-dress.md. This pattern list is the maintained, append-only
// denylist — extend it when a new leak vector appears; never weaken it silently.
//
// WHY value-form + an allowlist, not "any occurrence" (the AST-vs-regex lesson
// from no-bare-hass-states.mjs): the project is legitimately *named* `tesla-card`
// (repo, <tesla-card> element, the `tesla_fleet` integration id, page objects),
// and a few meta-files deliberately mention `#e82127` to ASSERT its absence
// (src/log.test.ts, this gate, this gate's test). A gate that flags `tesla-card`
// on every line is worse than useless — it gets disabled. So: match `#e82127`
// only as a *style value* (`: #e82127`), gate the option codes hard (they never
// appear legitimately), treat the wordmark CONSERVATIVELY (registered-mark forms
// only — factual "Tesla Powerwall" / `tesla_fleet` references are review's job,
// not the gate's), and exempt the absence-asserting meta-files via CONTENT_SKIP.
//
// Dep-light: node:fs + node:child_process + git only. No ESLint, no new deps
// (this repo deliberately runs no ESLint — custom gates are scripts/lint/*.mjs).
// ESM / Node 20. Importing this module is side-effect-free; the scan runs only
// when executed as a CLI (see the main guard at the bottom), so the co-located
// test can import the matchers without triggering a repo scan.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

export const RULE = 'trade-dress';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/

// Files exempt from the CONTENT scan: they carry brand tokens on purpose, to
// DEFINE or ASSERT their absence. (Filename checks still apply to every file.)
//   • this gate — it literally contains the denylist patterns;
//   • src/trade-dress-denylist.test.ts — this gate's test plants brand tokens to
//     prove the matcher fires;
//   • src/log.test.ts — Story 2.5's neutral-logger gate asserts `#e82127` is gone;
//   • src/paint.test.ts — Story 2.6's paint relabel test plants option codes /
//     marketing names to assert PAINT_PRESETS bundles NONE of them.
//   • src/layer-contract.test.ts — Story 3.6's contract test plants option codes
//     in an absence-asserting regex (`/#e82127|ppsw|pbsb|pmng|pn00/`) to prove
//     LAYER_CONTRACT bundles NONE of them — identical DEFINE-to-assert-absence
//     rationale as src/paint.test.ts (added here in Story 3.7, the gate's first
//     run over the 3.6-expanded src/ surface).
//   • docs/trade-dress.md — the policy doc itself DEFINES the denylist, listing the
//     brand red rgb() form and every option code (PPSW/PBSB/…) as the tokens the
//     gate catches; same DEFINE-the-tokens rationale as this gate + its test.
export const CONTENT_SKIP = new Set([
  'scripts/lint/trade-dress-denylist.mjs',
  'src/trade-dress-denylist.test.ts',
  'src/log.test.ts',
  'src/paint.test.ts',
  'src/layer-contract.test.ts',
  'docs/trade-dress.md',
]);

// Binary / asset extensions: never content-scanned (a regex over bytes is noise),
// but their FILENAMES are still checked by scanFilename.
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'zip', 'gz', 'mp4', 'mov',
]);

// ── Content patterns (append-only denylist; each commented with what it guards) ─
const CONTENT_PATTERNS = [
  {
    // Brand red AS A STYLE VALUE: `: #e82127`, `=#e82127`, `,#e82127`, `(#e82127`.
    // Value-form (not bare) so prose mentions in absence-asserting tests/comments
    // — e.g. "no `#e82127`" — don't false-positive.
    re: /[:=,(]\s*#e82127\b/gi,
    msg: 'Tesla brand red #e82127 used as a style value — use a neutral colour',
  },
  {
    // Same brand red in rgb()/rgba() form.
    re: /rgba?\(\s*232\s*,\s*33\s*,\s*39\b/gi,
    msg: 'Tesla brand red (rgb 232,33,39) — use a neutral colour',
  },
  {
    // Same brand red in hsl()/hsla() form (#e82127 ≈ hsl(357, 82%, 52%)).
    re: /hsla?\(\s*35[678]\s*,/gi,
    msg: 'Tesla brand red (hsl ~357°) — use a neutral colour',
  },
  {
    // Tesla option / paint API codes — never appear legitimately in this codebase,
    // so gate them hard (word-bounded so they don't hit substrings). The bundled
    // palette must carry generic colour names only (Story 2.6 §2a).
    re: /\b(PPSW|PBSB|PBCW|PMBL|PMNG|PN00|PMSS|PN01|PPSB|PPMR|PR00|PR01)\b/gi,
    msg: 'Tesla paint option code — bundle generic colour names only (user supplies Tesla names via config.paint map)',
  },
  {
    // Tesla wordmark used AS BRANDING — registered/trademark MARK form only.
    // Deliberately conservative: factual references (`tesla_fleet`, "Tesla
    // Powerwall", "the official Tesla Fleet integration") and the *required*
    // legal disclaimer ("Not affiliated with Tesla, Inc.") are NOT branding
    // misuse — they're review's job (AC3), not the gate's. Only the ®/™ mark
    // beside the wordmark is an unambiguous, never-legitimate brand leak.
    re: /tesla\s*(?:®|™)/gi,
    msg: 'Tesla wordmark with ®/™ brand mark — remove the trademark styling',
  },
];

// ── Filename patterns: committed asset files that are Tesla artwork/branding. ───
// A regex can only see the NAME here, not the contents — this is the documented
// necessary-not-sufficient line: pair net-new asset categories with human review.
function isAssetFile(relPath) {
  return /\.(svg|png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(relPath);
}

/**
 * Check a committed file's PATH for Tesla branding artwork. Returns a message, or
 * null. The project's own bundle/page-objects (`tesla-card*`) are allowed.
 * @param {string} relPath posix path relative to repo root
 */
export function scanFilename(relPath) {
  const base = basename(relPath).toLowerCase();
  // Allow the project's own name in any committed code/test/doc file.
  if (base.startsWith('tesla-card')) return null;
  // Explicit logo/badge/wordmark/emblem asset names (any extension).
  if (/tesla[-_ .]?(logo|badge|wordmark|emblem|mark|t)\b/.test(base)) {
    return 'committed Tesla logo/badge/wordmark asset filename — no Tesla artwork ships (bring-your-own, gitignored)';
  }
  // Any committed IMAGE/vector whose name carries `tesla` (a render, a silhouette).
  if (isAssetFile(relPath) && /tesla/.test(base)) {
    return 'committed Tesla-named image/vector asset — no vehicle artwork ships (keep traced art gitignored)';
  }
  return null;
}

/**
 * Scan one file's text content for trade-dress tokens. Pure + side-effect-free so
 * the co-located test can plant strings and assert it fires. Returns
 * [{ line, col, message }] (1-based line/col), empty when clean.
 * @param {string} text file contents
 */
export function scanContent(text) {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, msg } of CONTENT_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        hits.push({ line: i + 1, col: m.index + 1, message: msg });
        if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
      }
    }
  }
  return hits;
}

/** Enumerate COMMITTED files only — gitignored art (assets/*.svg) and dist/ are out. */
function committedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function main() {
  const files = committedFiles();
  const failures = [];
  let scanned = 0;

  for (const relPath of files) {
    // Filename check applies to EVERY committed file (incl. binaries).
    const fnHit = scanFilename(relPath);
    if (fnHit) failures.push(`FAIL ${RULE} ${relPath} ${fnHit}`);

    const ext = (relPath.split('.').pop() || '').toLowerCase();
    if (BINARY_EXT.has(ext)) continue; // don't content-scan binaries
    if (CONTENT_SKIP.has(relPath)) continue; // absence-asserting meta-files

    let text;
    try {
      text = readFileSync(join(ROOT, relPath), 'utf8');
    } catch {
      continue; // unreadable / deleted-but-staged — skip
    }
    scanned += 1;
    for (const v of scanContent(text)) {
      failures.push(`FAIL ${RULE} ${relPath}:${v.line}:${v.col} ${v.message}`);
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\n${RULE}: ${failures.length} trade-dress violation(s).`);
    console.error('A regex cannot see a logo inside a raster — pair net-new assets with the review in docs/trade-dress.md.');
    process.exit(1);
  }

  console.log(
    `ok ${RULE} — ${scanned} committed text files scanned, 0 trade-dress tokens ` +
      `(content-skip meta: ${[...CONTENT_SKIP].join(', ')})`,
  );
}

// CLI-only: importing this module (for the test) must not run the scan.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
