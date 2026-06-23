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
import { tokens, sharedStyles, ACCENT_SEMANTICS, LIGHT_TOKENS } from './styles';

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

// ── Story 9.12 gate — card-only Light theme token block ───────────────────
// The `:host([theme='light'])` override re-resolves ONLY the colour tokens to the
// light palette, single-sourced from LIGHT_TOKENS (shared with the editor preview).
// Accents stay byte-identical across themes (semantic, ground-independent).
describe('Story 9.12 — :host([theme=light]) light token block', () => {
  const css = (tokens as unknown as { cssText: string }).cssText;
  const lightBlock = (): string => {
    const m = css.match(/:host\(\[theme='light'\]\)\s*\{([^}]*)\}/);
    expect(m, ':host([theme=light]) block not found in tokens').not.toBeNull();
    return m![1];
  };

  test('the light block defines every LIGHT_TOKENS pair verbatim (single source)', () => {
    const block = lightBlock();
    for (const [k, v] of Object.entries(LIGHT_TOKENS)) {
      expect(block, `light block missing ${k}: ${v}`).toContain(`${k}: ${v};`);
    }
  });

  test('every overridden token NAME also exists in the dark :host default (parity)', () => {
    for (const k of Object.keys(LIGHT_TOKENS)) {
      expect(css, `dark :host missing ${k}`).toContain(`${k}:`);
    }
  });

  test('the accents are NOT re-listed under light (semantic, ground-independent)', () => {
    const block = lightBlock();
    for (const name of Object.keys(ACCENT_SEMANTICS)) {
      expect(block, `accent --tc-${name} must NOT be re-listed under light`).not.toContain(`--tc-${name}:`);
    }
  });
});

// ── Story 2.2 gates ──────────────────────────────────────────────────────
// Accents carry meaning (not decoration), `.surface` is the single elevation
// recipe, and the brand display face is wired. Each is gate-shaped; corpus-wide
// claims are backed by a real src/ scan (Epic-1 retro lesson).

/** The 7 canonical accent hexes (lower-case), from the contract map. */
const ACCENT_HEXES = Object.values(ACCENT_SEMANTICS).map((a) => a.hex.toLowerCase());

describe('Semantic accent contract (Story 2.2 AC1)', () => {
  const css = (tokens as unknown as { cssText: string }).cssText;

  test('all 8 accents define their canonical hex token', () => {
    for (const [name, { hex }] of Object.entries(ACCENT_SEMANTICS)) {
      expect(css, `missing --tc-${name}: ${hex}`).toContain(`--tc-${name}: ${hex};`);
    }
    // Exactly these 8 — copper (Story 9.14) is the generator source accent.
    expect(Object.keys(ACCENT_SEMANTICS)).toEqual([
      'blue', 'green', 'amber', 'red', 'purple', 'orange', 'teal', 'copper',
    ]);
  });

  test('each accent has a non-empty suite-wide meaning (contract is checkable)', () => {
    for (const [name, { meaning }] of Object.entries(ACCENT_SEMANTICS)) {
      expect(meaning.length, `accent ${name} has no meaning`).toBeGreaterThan(0);
    }
    // Pin the meanings verbatim to the DESIGN.md §Colors contract so a silent
    // re-purposing (e.g. purple → non-media) fails the gate, not just review.
    expect(ACCENT_SEMANTICS.blue.meaning).toBe('plugged / info');
    expect(ACCENT_SEMANTICS.green.meaning).toBe('charging / OK / solar');
    expect(ACCENT_SEMANTICS.amber.meaning).toBe('mid / caution');
    expect(ACCENT_SEMANTICS.red.meaning).toBe('low / alert');
    expect(ACCENT_SEMANTICS.purple.meaning).toBe('media');
    expect(ACCENT_SEMANTICS.orange.meaning).toBe('climate / heat');
    expect(ACCENT_SEMANTICS.teal.meaning).toBe('secondary / ecosystem');
    expect(ACCENT_SEMANTICS.copper.meaning).toBe('generator / fuel');
  });

  test('the human-readable meaning comment sits beside each accent declaration', () => {
    // The token block carries a terse `/* meaning */` next to each accent; assert
    // the comment half of the contract stays in sync with the map half.
    expect(css).toContain('/* plugged / info */');
    expect(css).toContain('/* charging / OK / solar */');
    expect(css).toContain('/* mid / caution */');
    expect(css).toContain('/* low / alert */');
    expect(css).toContain('/* climate / heat */');
  });

  test('zero raw accent hexes in src/ outside token decls + var() fallbacks', () => {
    // Allowed canonical homes for an accent hex: a `--tc-<accent>: #hex` token
    // declaration, the ACCENT_SEMANTICS `hex: '#hex'` contract registry, and
    // var(--tc-*, #hex) fallbacks. Strip those, then any remaining hex is a raw,
    // decorative use — exactly what AC1 forbids.
    const hexAlt = ACCENT_HEXES.map((h) => h.slice(1)).join('|');
    const rawHex = new RegExp(`#(${hexAlt})\\b`, 'gi');
    const offenders: string[] = [];
    for (const file of srcFiles(SRC_DIR)) {
      let text = readFileSync(file, 'utf8');
      text = text.replace(/--tc-[a-z0-9-]+:\s*#[0-9a-f]{3,8}/gi, ''); // token decls
      text = text.replace(/hex:\s*'#[0-9a-f]{3,8}'/gi, ''); // contract registry
      // var(...) fallbacks (loop to unwrap nested var() chains)
      let prev: string;
      do {
        prev = text;
        text = text.replace(/var\([^()]*\)/gi, '');
      } while (text !== prev);
      for (const m of text.matchAll(rawHex)) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders, `raw accent hexes (decorative use forbidden):\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('.surface is the single elevation primitive (Story 2.2 AC2)', () => {
  const shared = (sharedStyles as unknown as { cssText: string }).cssText;

  test('.surface = 180° surface-2→surface gradient + 1px border hairline + shadow', () => {
    const block = shared.match(/\.surface\s*\{[^}]*\}/);
    expect(block, '.surface rule not found').not.toBeNull();
    const rule = block![0];
    expect(rule).toContain('linear-gradient(');
    expect(rule).toContain('180deg');
    expect(rule).toContain('--tc-surface-2');
    expect(rule).toContain('--tc-surface,'); // the gradient bottom stop
    expect(rule).toMatch(/border:\s*1px solid var\(--tc-border/);
    expect(rule).toMatch(/box-shadow:\s*var\(--tc-shadow/);
    // backdrop-filter is deliberately NOT baked in (host supplies blur).
    expect(rule).not.toContain('backdrop-filter');
  });

  test('no backdrop-filter anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of srcFiles(SRC_DIR)) {
      if (readFileSync(file, 'utf8').includes('backdrop-filter')) offenders.push(file);
    }
    expect(offenders, `backdrop-filter must not appear in src/:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('no second 180° elevation gradient outside .surface', () => {
    // The location-map background is linear-gradient(135deg, …) — the one
    // sanctioned chromatic exception. It is 135°, not 180°, so a 180deg scan
    // naturally excludes it; assert there is exactly ONE 180deg, in styles.ts.
    const hits: string[] = [];
    for (const file of srcFiles(SRC_DIR)) {
      for (const _ of readFileSync(file, 'utf8').matchAll(/180deg/g)) hits.push(file);
    }
    expect(hits.length, `expected exactly one 180deg gradient (.surface), found:\n${hits.join('\n')}`).toBe(1);
    expect(hits[0].endsWith('styles.ts')).toBe(true);
  });

  test('AC2 consumer side: all 7 panels + hero render class="surface …"', () => {
    // The recipe being the single primitive only means something if the
    // surfaces actually consume it. AC2: "All 7 panels + hero + ecosystem
    // surfaces consume .surface". Gate the consumer side so a regression that
    // swaps in a private elevation recipe (drops the class) fails here, not in
    // a reviewer's eyes.
    const consumers = [
      'panel-tyres.ts', 'panel-climate.ts', 'panel-charging.ts', 'panel-closures.ts',
      'panel-location.ts', 'panel-energy.ts', 'panel-media.ts', 'hero.ts',
      // Epic 6: the shared ecosystem-card shell renders the surface for the
      // concrete ecosystem cards (tc-solar/tc-powerwall/… in 6.2/6.3).
      'ecosystem-card.ts',
    ];
    const missing: string[] = [];
    for (const name of consumers) {
      const text = readFileSync(join(SRC_DIR, 'components', name), 'utf8');
      if (!/class="[^"]*\bsurface\b/.test(text)) missing.push(name);
    }
    expect(missing, `these surfaces must consume class="surface …":\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('Brand display face is wired (Story 2.2 AC3)', () => {
  test('--tc-font-display is consumed by the display-role elements (with fallbacks)', () => {
    // AC3 requires the display face be ACTUALLY consumed — not just defined.
    // Every read must carry a fallback (Story 2.1 AC2 invariant), so we count
    // only `var(--tc-font-display,` reads (comma ⇒ fallback present).
    const read = /var\(\s*--tc-font-display\s*,/g;
    const consumers = new Map<string, number>();
    for (const file of srcFiles(SRC_DIR)) {
      const n = [...readFileSync(file, 'utf8').matchAll(read)].length;
      if (n > 0) consumers.set(file, n);
    }
    const total = [...consumers.values()].reduce((a, b) => a + b, 0);
    // 6 display sites: .label (styles), .name + .bat-pct (hero), .bnum .big
    // (charging), .readout .t (climate), .ftitle (energy).
    expect(total, `expected ≥6 font-display reads, found ${total}`).toBeGreaterThanOrEqual(6);
    const files = [...consumers.keys()].map((f) => f.split('/').pop());
    for (const f of ['styles.ts', 'hero.ts', 'panel-charging.ts', 'panel-climate.ts', 'panel-energy.ts']) {
      expect(files, `expected font-display consumer in ${f}`).toContain(f);
    }
  });

  test('stat-key token, consumer, and contract agree at 11.5px / 700', () => {
    const css = (tokens as unknown as { cssText: string }).cssText;
    const shared = (sharedStyles as unknown as { cssText: string }).cssText;
    // token (source of truth)
    expect(css).toContain('--tc-fs-stat-key: 11.5px;');
    expect(css).toContain('--tc-fw-stat-key: 700;');
    // consumer (.stat .k) now reads the token, ending the 10.5/600 drift
    const block = shared.match(/\.stat \.k\s*\{[^}]*\}/);
    expect(block, '.stat .k rule not found').not.toBeNull();
    expect(block![0]).toContain('var(--tc-fs-stat-key, 11.5px)');
    expect(block![0]).toContain('var(--tc-fw-stat-key, 700)');
    expect(block![0]).not.toContain('10.5px');
  });

  test('--tc-font-display is name-only Plus Jakarta Sans degrading to the body stack', () => {
    // AC3 contract: the display face is referenced BY NAME ('Plus Jakarta Sans')
    // with the --tc-font body stack as the documented fallback — no webfont
    // package. Pin the token value so a future edit can't quietly swap the
    // family or drop the body-stack degradation.
    const css = (tokens as unknown as { cssText: string }).cssText;
    const decl = css.match(/--tc-font-display:[^;]*;/s);
    expect(decl, '--tc-font-display declaration not found').not.toBeNull();
    expect(decl![0]).toContain("'Plus Jakarta Sans'");
    expect(decl![0]).toMatch(/var\(\s*--tc-font\b/); // degrades to the body stack
  });

  test('AC3 per-element: every named display-role selector carries the display face', () => {
    // Counting reads (≥6) can pass even if a read drifts off the intended
    // element. Pin each named display-role selector to a font-display read so
    // moving one (e.g. off .bat-pct) fails the gate. Selectors per the Story 2.2
    // brand-face migration map.
    const sites: Array<[string, string]> = [
      ['styles.ts', '.label'],
      ['components/hero.ts', '.name'],
      ['components/hero.ts', '.bat-pct'],
      ['components/panel-charging.ts', '.bnum .big'],
      ['components/panel-climate.ts', '.readout .t'],
      ['components/panel-energy.ts', '.ftitle'],
    ];
    const missing: string[] = [];
    for (const [rel, selector] of sites) {
      const text = readFileSync(join(SRC_DIR, rel), 'utf8');
      const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const block = text.match(new RegExp(`${esc}\\s*\\{[^}]*\\}`, 's'));
      if (!block || !/var\(\s*--tc-font-display\s*,/.test(block[0])) {
        missing.push(`${rel} → ${selector}`);
      }
    }
    expect(missing, `these display-role selectors must read var(--tc-font-display, …):\n${missing.join('\n')}`).toEqual([]);
  });
});

// ── Story 5.9 gate — the sanctioned map-card gradient exception (AC2 / FR-28) ──
// The location map-card background is the ONE hard-coded colour exception in the
// suite (FR-28 / UX-DR17). The "no second 180deg" test above already excludes it
// (it's 135deg); this names it explicitly — AC2 requires the exception be
// DOCUMENTED, not merely incidentally tolerated. We pin: (a) the exact sanctioned
// gradient lives in panel-location.ts, (b) it carries the in-code documentation,
// and (c) its two raw hexes are CONFINED to that one file (never relocated or a
// second departure spawned elsewhere).
describe('Location map gradient — the one sanctioned colour exception (Story 5.9 AC2 / FR-28)', () => {
  const PANEL = join(SRC_DIR, 'components', 'panel-location.ts');
  /** The two sanctioned non-accent hexes — the only raw colour the suite allows. */
  const MAP_HEXES = ['#1b2533', '#0f1620'];

  test('the 135deg map gradient with its sanctioned hexes lives in panel-location.ts', () => {
    const text = readFileSync(PANEL, 'utf8');
    expect(text).toMatch(/linear-gradient\(\s*135deg,\s*#1b2533,\s*#0f1620\s*\)/);
  });

  test('the exception is DOCUMENTED in code — named FR-28, not silently tolerated', () => {
    // A future contributor tempted to "tokenize that hex" must see, AT the gradient,
    // why it is allowed when every other colour routes through --tc-*. AC2 = "(documented)".
    const text = readFileSync(PANEL, 'utf8');
    expect(text).toContain('FR-28');
    expect(text.toUpperCase()).toContain('SANCTIONED EXCEPTION');
  });

  test('the sanctioned hexes are CONFINED to panel-location.ts (the only departure, not relocated)', () => {
    const offenders: string[] = [];
    for (const file of srcFiles(SRC_DIR)) {
      if (file === PANEL) continue;
      const text = readFileSync(file, 'utf8');
      for (const hex of MAP_HEXES) if (text.includes(hex)) offenders.push(`${file}: ${hex}`);
    }
    expect(
      offenders,
      `the map gradient hexes must stay confined to panel-location.ts:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});

describe('Asset-light brand face — no bundled webfont (Story 2.2 AC3 / NFR-2)', () => {
  test('no @font-face, @import url, or <link rel> webfont anywhere in src/', () => {
    // NFR-2: the display face is name-only — bringing in a webfont via @import,
    // @font-face, or a <link> tag is forbidden. Patterns match REAL usage so the
    // styles.ts comment that merely mentions "@import/<link>" is not a false hit:
    //   @font-face  ·  @import url(/'/"  ·  <link …rel=…>
    const webfont = /@font-face\b|@import\s+(?:url|['"])|<link\b[^>]*\brel\b/i;
    const offenders: string[] = [];
    for (const file of srcFiles(SRC_DIR)) {
      const m = readFileSync(file, 'utf8').match(webfont);
      if (m) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders, `asset-light NFR-2: no bundled webfont allowed:\n${offenders.join('\n')}`).toEqual([]);
  });
});
