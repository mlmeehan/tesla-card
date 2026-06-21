#!/usr/bin/env node
// version-sync gate — Story 7.4 (NFR-5 version sync · AC1 filename · 6th structural gate).
//
// Merge-blocking DISTRIBUTION-INVARIANT policy. A HACS release ships ONE file
// (`dist/tesla-card.js`) whose in-bundle banner prints `CARD_VERSION`. Three
// independent declarations therefore have to agree or the install silently breaks
// or lies about its version:
//
//   • `package.json` `version`  — the npm/release identity (and what the git tag
//     mirrors: a `v${version}` release).
//   • `src/const.ts` `CARD_VERSION` — what the running card prints at load
//     (`tesla-card.ts` startup banner) and reports for support.
//   • `hacs.json` `filename` — the basename HACS downloads from the GitHub Release;
//     it MUST equal the asset `release.yml` attaches and the Rollup `output.file`
//     basename, or HACS fetches a file that does not exist.
//
// Until this gate, `package.json` ↔ `CARD_VERSION` agreed only by a HUMAN tick in
// PUBLISHING.md's release checklist — nothing failed CI on drift (bump one, forget
// the other, ship a bundle whose banner lies). This gate closes that for the
// ALWAYS-available pair (version ↔ CARD_VERSION) and pins the AC1 filename chain
// (`hacs.json.filename` ↔ Rollup `output.file` basename ↔ the literal
// `tesla-card.js`). The THIRD leg — the git TAG — is only knowable at release time,
// so it is asserted in `release.yml` (tag === `v${version}` === `v${CARD_VERSION}`),
// NOT here; this per-push gate covers the two halves that exist on every commit.
//
// SCOPE — config-consistency, NOT a code-graph scan. It reads four FILES as text
// (`package.json`, `src/const.ts`, `hacs.json`, `rollup.config.mjs`); it never
// imports `src/` runtime code, reads no `hass.states`, and adds no cross-layer
// import — so `no-bare-hass-states` / `no-cycle` / `import-allowlist` are unaffected
// and it can't trip them (it lives in `scripts/lint/`, never walked by the
// src/-scanning gates). Embeds NO Tesla token → needs no `trade-dress-denylist`
// CONTENT_SKIP entry (that is only for define-to-assert-absence files).
//
// PARSE-MISS HONESTY: the `CARD_VERSION` extraction asserts EXACTLY ONE match of a
// precise regex. If the declaration shape ever changes (rename, reformat) the gate
// FAILS LOUDLY rather than silently passing on zero matches — a gate that can't find
// what it's checking must not report success.
//
// Greppable output (`FAIL version-sync <message>` per violation + an
// `ok version-sync …` success line + `process.exit(1)` on any failure). ESM /
// Node 20. Importing this module is side-effect-free: the checks run only when
// executed as a CLI (main guard at the bottom), so the co-located test can import
// `checkVersionSync`/`RULE` without reading the repo.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

export const RULE = 'version-sync';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // tesla-card/

/** The one basename every reference to the built asset must agree on (AC1). */
export const EXPECTED_FILENAME = 'tesla-card.js';

/** Precise CARD_VERSION literal matcher — single-quoted string export in src/const.ts. */
const CARD_VERSION_RE = /export const CARD_VERSION = '([^']+)'/g;

/**
 * Pure, side-effect-free checker (imported by the co-located test). Takes the raw
 * text of the four distribution files and returns every sync violation as a
 * greppable FAIL line. The CLI `main()` feeds it the real files; the test feeds it
 * planted inputs (matched + mismatched) to prove the gate catches drift, not just
 * passes vacuously.
 *
 * @param {{ pkgText: string, constText: string, hacsText: string, rollupText: string }} inputs
 * @returns {string[]} FAIL messages (empty = in sync).
 */
export function checkVersionSync({ pkgText, constText, hacsText, rollupText }) {
  const failures = [];
  const fail = (msg) => failures.push(`FAIL ${RULE} ${msg}`);

  // --- package.json version ---
  let pkgVersion;
  try {
    pkgVersion = JSON.parse(pkgText).version;
  } catch {
    fail('package.json is not valid JSON — cannot read `version`');
  }
  if (pkgVersion !== undefined && typeof pkgVersion !== 'string') {
    fail(`package.json \`version\` is not a string (got ${JSON.stringify(pkgVersion)})`);
    pkgVersion = undefined;
  }

  // --- src/const.ts CARD_VERSION (parse-miss must FAIL, never silently pass) ---
  const cvMatches = [...constText.matchAll(CARD_VERSION_RE)];
  let cardVersion;
  if (cvMatches.length !== 1) {
    fail(
      `expected exactly one \`export const CARD_VERSION = '…'\` in src/const.ts, found ${cvMatches.length} — the declaration shape changed; update this gate's regex`,
    );
  } else {
    cardVersion = cvMatches[0][1];
  }

  // --- the AC2 equality: package.json version === CARD_VERSION ---
  if (pkgVersion !== undefined && cardVersion !== undefined && pkgVersion !== cardVersion) {
    fail(
      `version drift: package.json \`version\` = '${pkgVersion}' but src/const.ts \`CARD_VERSION\` = '${cardVersion}' — they MUST match (NFR-5); the running card's banner would lie`,
    );
  }

  // --- AC1: hacs.json filename === the one basename ---
  let hacsFilename;
  try {
    hacsFilename = JSON.parse(hacsText).filename;
  } catch {
    fail('hacs.json is not valid JSON — cannot read `filename`');
  }
  if (hacsFilename !== undefined && hacsFilename !== EXPECTED_FILENAME) {
    fail(
      `hacs.json \`filename\` = '${hacsFilename}' but HACS must download '${EXPECTED_FILENAME}' (the released asset basename) — a rename silently breaks HACS install (AC1)`,
    );
  }

  // --- AC1: rollup output.file basename === the one basename, and === hacs filename ---
  const fileMatches = [...rollupText.matchAll(/file:\s*['"]([^'"]+)['"]/g)];
  if (fileMatches.length !== 1) {
    fail(
      `expected exactly one \`output.file\` in rollup.config.mjs, found ${fileMatches.length} — the single-bundle output shape changed`,
    );
  } else {
    const rollupBasename = basename(fileMatches[0][1]);
    if (rollupBasename !== EXPECTED_FILENAME) {
      fail(
        `rollup.config.mjs \`output.file\` basename = '${rollupBasename}' but the released/HACS asset is '${EXPECTED_FILENAME}' — every reference to the built bundle must agree (AC1)`,
      );
    }
    if (hacsFilename !== undefined && rollupBasename !== hacsFilename) {
      fail(
        `hacs.json \`filename\` ('${hacsFilename}') and rollup.config.mjs output basename ('${rollupBasename}') disagree — HACS would fetch a file Rollup never built (AC1)`,
      );
    }
  }

  return failures;
}

/**
 * Pure check for the RELEASE-TIME leg of the version-sync invariant (Story 7.4 /
 * NFR-5): the published git tag MUST equal `v${version}`, and (defensively)
 * package.json `version` MUST equal CARD_VERSION. Returns FAIL lines (empty = ok).
 *
 * The per-push lint gate already proves package.json === CARD_VERSION; the git TAG
 * is only knowable at release time. `release.yml` invokes this via
 * `node scripts/lint/version-sync.mjs --release-tag "$TAG"`, so the SHIPPED logic
 * IS the logic this module's co-located test exercises (single source of truth) —
 * closing the prior gap where the tag leg lived only as inline shell, untested
 * locally and silently breakable if the workflow regressed.
 *
 * @param {{ tag: string, pkgVersion: string|undefined, cardVersion: string|undefined }} inputs
 * @returns {string[]} FAIL messages (empty = the tag is in sync).
 */
export function checkReleaseTag({ tag, pkgVersion, cardVersion }) {
  const failures = [];
  const fail = (msg) => failures.push(`FAIL ${RULE} ${msg}`);
  if (!cardVersion) fail('could not parse CARD_VERSION from src/const.ts');
  if (!pkgVersion) fail('could not read package.json `version`');
  if (pkgVersion && cardVersion && pkgVersion !== cardVersion) {
    fail(`package.json version ('${pkgVersion}') != CARD_VERSION ('${cardVersion}') — the lint gate should have caught this`);
  }
  if (pkgVersion && tag !== `v${pkgVersion}`) {
    fail(`published tag '${tag}' != 'v${pkgVersion}' — the tag must equal v\${version}/v\${CARD_VERSION} (NFR-5)`);
  }
  return failures;
}

/** Parse the single CARD_VERSION literal from src/const.ts text (undefined-safe). */
function parseCardVersion(constText) {
  const m = [...constText.matchAll(CARD_VERSION_RE)];
  return m.length === 1 ? m[0][1] : undefined;
}

/** CLI sub-mode: assert the release tag matches the synced version (reads real files). */
function releaseTagMain(tag) {
  let pkgVersion;
  try {
    pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    pkgVersion = undefined;
  }
  const cardVersion = parseCardVersion(readFileSync(join(ROOT, 'src', 'const.ts'), 'utf8'));
  const failures = checkReleaseTag({ tag, pkgVersion, cardVersion });
  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\n${RULE}: release tag '${tag}' does not match the synced version.`);
    process.exit(1);
  }
  console.log(`ok ${RULE} — release tag '${tag}', package.json version, and CARD_VERSION all agree on '${pkgVersion}'`);
}

function main() {
  const failures = checkVersionSync({
    pkgText: readFileSync(join(ROOT, 'package.json'), 'utf8'),
    constText: readFileSync(join(ROOT, 'src', 'const.ts'), 'utf8'),
    hacsText: readFileSync(join(ROOT, 'hacs.json'), 'utf8'),
    rollupText: readFileSync(join(ROOT, 'rollup.config.mjs'), 'utf8'),
  });

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`\n${RULE}: ${failures.length} distribution-invariant violation(s).`);
    console.error(
      'package.json `version`, src/const.ts `CARD_VERSION`, hacs.json `filename`, and the Rollup output basename must all agree (NFR-5 / AC1). The git tag is checked separately in release.yml.',
    );
    process.exit(1);
  }

  console.log(`ok ${RULE} — package.json/CARD_VERSION in sync; hacs.json filename ↔ rollup output basename = '${EXPECTED_FILENAME}'`);
}

// CLI-only: importing this module (for the test) must not run the checks.
// `--release-tag <tag>` runs the release-time tag check; otherwise the per-push
// distribution-invariant scan. Both share one implementation with the co-located test.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--release-tag');
  if (i !== -1) releaseTagMain(argv[i + 1] ?? '');
  else main();
}
