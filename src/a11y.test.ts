// Accessibility, responsive & interaction-contract gates for Story 2.3
// (UX-DR21 a11y floor / UX-DR22 responsive / UX-DR23 interaction + bans).
//
// Gate-shaped, not claims (Epic-1 retro lesson): every corpus-wide assertion
// runs a real src/ scan so a reviewer re-running `npm run test` re-verifies it
// independently. Reuses the styles.test.ts scanner shape (srcFiles + cssText
// introspection) rather than re-introducing a parallel one.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  tokens,
  sharedStyles,
  BREAKPOINTS,
  INTERACTION_PRIMITIVES,
  INTERACTION_BANS,
} from './styles';

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

const tokenCss = (tokens as unknown as { cssText: string }).cssText;
const sharedCss = (sharedStyles as unknown as { cssText: string }).cssText;

/** Pull a single non-nested rule body by selector (first match). */
function ruleBody(css: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'));
  return m ? m[1] : null;
}

// ── AC1a: focus contract ──────────────────────────────────────────────────
describe('Focus contract — token + shared :focus-visible (AC1a)', () => {
  test('--tc-focus token exists and is a 2px outline (not the hairline)', () => {
    const decl = tokenCss.match(/--tc-focus:[^;]*;/);
    expect(decl, '--tc-focus declaration missing').not.toBeNull();
    expect(decl![0]).toContain('2px');
    // It must be a real outline contract, NOT --tc-border-strong reused.
    expect(decl![0]).not.toContain('--tc-border-strong');
    // colour family: blue or text accent (DESIGN.md says either clears 3:1).
    expect(decl![0]).toMatch(/--tc-(blue|text)\b/);
    expect(tokenCss).toContain('--tc-focus-offset:');
  });

  test('exactly one shared :focus-visible rule applies the token + an offset', () => {
    const body = ruleBody(sharedCss, ':focus-visible');
    expect(body, ':focus-visible rule missing from sharedStyles').not.toBeNull();
    expect(body!).toMatch(/outline:\s*var\(\s*--tc-focus\b/); // references the token
    expect(body!).toMatch(/outline-offset:\s*var\(\s*--tc-focus-offset\b/);
    // mouse clicks must not show the ring.
    expect(ruleBody(sharedCss, ':focus:not(:focus-visible)')).toMatch(/outline:\s*none/);
  });
});

// ── AC1b: ≥44×44 tap-target floor ─────────────────────────────────────────
describe('Tap-target floor — .tc-tap helper + tab fix (AC1b)', () => {
  test('.tc-tap is a ≥44×44 floor recipe', () => {
    const body = ruleBody(sharedCss, '.tc-tap');
    expect(body, '.tc-tap helper missing').not.toBeNull();
    expect(body!).toMatch(/min-height:\s*44px/);
    expect(body!).toMatch(/min-width:\s*44px/);
  });

  test('no shared interactive primitive declares a sub-44 fixed height', () => {
    // .ctrl (sharedStyles) 58, slider .track 46 — both clear it; .tab must now
    // carry the floor (was ≈38). Scan each owning rule for a FIXED height.
    const checks: Array<[string, string, string]> = [
      ['.ctrl', sharedCss, 'styles.ts'],
      ['.track', readFileSync(join(SRC_DIR, 'components', 'slider.ts'), 'utf8'), 'slider.ts'],
      ['.tab', readFileSync(join(SRC_DIR, 'tesla-card.ts'), 'utf8'), 'tesla-card.ts'],
    ];
    const offenders: string[] = [];
    for (const [sel, css, where] of checks) {
      const body = ruleBody(css, sel);
      expect(body, `${sel} rule not found in ${where}`).not.toBeNull();
      const h = body!.match(/(?<!min-|max-)height:\s*(\d+)px/);
      if (h && Number(h[1]) < 44) offenders.push(`${where} ${sel}: height ${h[1]}px`);
    }
    expect(offenders, `sub-44 fixed heights on shared primitives:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('the tab bar carries the ≥44 floor (incl. compact icon-only)', () => {
    const tab = ruleBody(readFileSync(join(SRC_DIR, 'tesla-card.ts'), 'utf8'), '.tab');
    expect(tab!).toMatch(/min-height:\s*44px/);
    expect(tab!).toMatch(/min-width:\s*44px/);
  });
});

// ── AC1c: reduced-motion ──────────────────────────────────────────────────
describe('Reduced-motion — shared halos/shimmers halt, gauges snap (AC1c)', () => {
  // The reduced-motion guard is the LAST block in sharedStyles; take from its
  // open to the end of the cssText (reliable: nothing follows it).
  const idx = sharedCss.indexOf('@media (prefers-reduced-motion: reduce)');
  const reduced = idx >= 0 ? sharedCss.slice(idx) : '';

  test('a shared prefers-reduced-motion block exists', () => {
    expect(idx, 'no shared @media (prefers-reduced-motion: reduce) block').toBeGreaterThan(-1);
  });

  test('every keyframe-driven motion in sharedStyles is disabled under reduced-motion', () => {
    // Lock the corpus: the shared block defines exactly tc-shimmer + tc-pulse.
    // A new keyframe added later trips this gate, forcing it (and the reduced
    // block) to be extended — that is the point (Epic-1 retro: back the claim).
    const keyframes = [...sharedCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
    expect(keyframes).toEqual(['tc-pulse', 'tc-shimmer']);
    // Each declared keyframe is actually consumed by an animation: usage.
    for (const kf of keyframes) {
      expect(sharedCss, `keyframe ${kf} declared but unused`).toMatch(new RegExp(`animation:\\s*${kf}\\b`));
    }
    // …and the reduced block halts BOTH consuming selectors.
    expect(reduced).toMatch(/\.tc-bat\.charging \.tc-bat-fill::after\s*\{\s*animation:\s*none/);
    expect(reduced).toMatch(/\.tc-ring svg\.charging \.prog\s*\{\s*animation:\s*none/);
  });

  test('the two data-bearing gauge transitions SNAP under reduced-motion', () => {
    expect(reduced).toMatch(/\.tc-bat-fill\s*\{\s*transition:\s*none/);
    expect(reduced).toMatch(/\.tc-ring \.prog\s*\{\s*transition:\s*none/);
  });
});

// ── AC2: responsive contract ──────────────────────────────────────────────
describe('Responsive contract — single-sourced breakpoints (AC2)', () => {
  test('BREAKPOINTS is the single exported source of truth', () => {
    expect(BREAKPOINTS.compact).toBe(540);
    expect(BREAKPOINTS.full).toBe(760);
  });

  test('the shared breakpoint literals equal the BREAKPOINTS constants', () => {
    // CSS can't read the TS constant, so each literal must match it. The child
    // grids still collapse on a viewport @media (max-width: compact); the card's
    // tab-label reveal keys on the element via @container (min-width: full) since
    // D-CQ-1 (the 2026-07-03 narrow-column tab-overlap fix), not the viewport.
    expect(sharedCss).toContain(`@media (max-width: ${BREAKPOINTS.compact}px)`);
    const card = readFileSync(join(SRC_DIR, 'tesla-card.ts'), 'utf8');
    expect(card).toContain(`@container (min-width: ${BREAKPOINTS.full}px)`);
  });

  test('the tab reveal is element-relative: .root is a query container (D-CQ-1)', () => {
    const root = ruleBody(readFileSync(join(SRC_DIR, 'tesla-card.ts'), 'utf8'), '.root');
    expect(root, '.root rule not found').not.toBeNull();
    expect(root!).toMatch(/container-type:\s*inline-size/);
  });

  test('max-width:1080px preserved on .root', () => {
    const root = ruleBody(readFileSync(join(SRC_DIR, 'tesla-card.ts'), 'utf8'), '.root');
    expect(root, '.root rule not found').not.toBeNull();
    expect(root!).toMatch(/max-width:\s*1080px/);
  });

  test('the ≤540 grid-collapse + ≥760 tab-label reveals are intact', () => {
    // g4/g3 collapse to 2-col under compact (viewport @media — child grids).
    const idx = sharedCss.indexOf('@media (max-width: 540px)');
    const compact = sharedCss.slice(idx, idx + 220);
    expect(compact).toMatch(/\.g4\s*\{\s*grid-template-columns:\s*repeat\(2,/);
    expect(compact).toMatch(/\.g3\s*\{\s*grid-template-columns:\s*repeat\(2,/);
    // ≥760 (of the card's OWN width, via @container — D-CQ-1) reveals every tab
    // label (tab span → display:inline).
    const card = readFileSync(join(SRC_DIR, 'tesla-card.ts'), 'utf8');
    const full = card.slice(card.indexOf('@container (min-width: 760px)'));
    expect(full).toMatch(/\.tab span\s*\{\s*display:\s*inline/);
  });
});

// ── AC3: interaction primitives + bans ────────────────────────────────────
describe('Interaction primitives + bans codified (AC3)', () => {
  test('the four interaction primitives are the documented vocabulary', () => {
    expect(Object.keys(INTERACTION_PRIMITIVES).sort()).toEqual(
      ['crossfade', 'drag', 'tap', 'toggle']
    );
    for (const [k, v] of Object.entries(INTERACTION_PRIMITIVES)) {
      expect(v.meaning.length, `${k} has no meaning`).toBeGreaterThan(0);
      expect(v.impl.length, `${k} has no impl anchor`).toBeGreaterThan(0);
    }
    // commit-on-release & optimistic-then-reconcile pinned to their impls.
    expect(INTERACTION_PRIMITIVES.drag.impl).toBe('tc-slider');
    expect(INTERACTION_PRIMITIVES.toggle.impl).toBe('quick-actions');
  });

  test('all five bans are codified', () => {
    expect(Object.keys(INTERACTION_BANS).sort()).toEqual([
      'no-auto-wake',
      'no-background-polling',
      'no-decorative-motion',
      'no-gamification',
      'no-mid-drag-commits',
    ]);
  });

  test('no-background-polling: zero setInterval/polling timers in component src (rAF-only)', () => {
    // rAF is the only sanctioned loop; none exists today either. A polling timer
    // would spend Tesla's server budget on the card's own initiative (banned).
    const offenders: string[] = [];
    for (const file of srcFiles(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bsetInterval\s*\(/g)) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders, `setInterval (background polling) is banned:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('no-mid-drag-commits: tc-slider dispatches value-changed only from _up (release)', () => {
    // Static backstop for the element-level test: _move never dispatches; the
    // single value-changed dispatch lives in the _up (pointerup/cancel) handler.
    const slider = readFileSync(join(SRC_DIR, 'components', 'slider.ts'), 'utf8');
    const moveBody = slider.match(/private _move =[\s\S]*?\n  \};/);
    expect(moveBody, '_move handler not found').not.toBeNull();
    expect(moveBody![0], '_move must not dispatch — that would be a mid-drag commit')
      .not.toContain('dispatchEvent');
    // exactly one value-changed DISPATCH in the whole component (the doc comment
    // mentions the event name too, so match the CustomEvent construction), in _up.
    expect([...slider.matchAll(/new CustomEvent\(\s*'value-changed'/g)].length).toBe(1);
    const upBody = slider.match(/private _up =[\s\S]*?\n  \};/);
    expect(upBody![0]).toContain('value-changed');
    // the template wires release handlers (pointerup/pointercancel) to _up.
    expect(slider).toMatch(/@pointerup=\$\{this\._up\}/);
    expect(slider).toMatch(/@pointercancel=\$\{this\._up\}/);
  });
});
