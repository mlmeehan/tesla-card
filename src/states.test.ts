// Freshness-first visual state model gates for Story 2.4 (UX-DR19).
//
// The "defining model is freshness, not presence": because the car sleeps and
// the Fleet API is metered, "I have data but it's old" is the NORMAL case. This
// suite pins the six presentation states' reusable visual contract — tokens +
// shared recipes that auto-apply through shadow DOM, plus the exported
// FRESHNESS_STATES map — so the contract is machine-checkable, not prose.
//
// Gate-shaped, not claims (Epic-1 retro lesson): every corpus-wide assertion
// runs a real src/ scan a reviewer can re-run. Reuses the styles.test.ts /
// a11y.test.ts scanner shape (srcFiles + cssText introspection); no parallel one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { tokens, sharedStyles, FRESHNESS_STATES } from './styles';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Pull a single non-nested rule body by selector (first match). */
function ruleBody(css: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'));
  return m ? m[1] : null;
}

const tokenCss = (tokens as unknown as { cssText: string }).cssText;
const sharedCss = (sharedStyles as unknown as { cssText: string }).cssText;

// ── AC1a: Asleep — dim + grayscale recipe single-sourced from tokens ───────
describe('Asleep — dim + grayscale recipe (AC1a)', () => {
  test('dim tokens exist as literal declarations', () => {
    expect(tokenCss, 'missing --tc-dim-opacity').toContain('--tc-dim-opacity:');
    expect(tokenCss, 'missing --tc-dim-grayscale').toContain('--tc-dim-grayscale:');
  });

  test('the disabled + skeleton magnitudes are single-sourced as literal tokens too', () => {
    // The asleep recipe single-sources its magnitude from --tc-dim-*; the
    // disabled and skeleton recipes must do the same (no component hard-codes
    // the opacity/background), so their tokens must be declared literals.
    expect(tokenCss, 'missing --tc-disabled-opacity').toContain('--tc-disabled-opacity:');
    expect(tokenCss, 'missing --tc-skeleton-bg').toContain('--tc-skeleton-bg:');
  });

  test('.tc-asleep applies BOTH opacity and grayscale, reading the dim tokens', () => {
    const body = ruleBody(sharedCss, '.tc-asleep');
    expect(body, '.tc-asleep recipe missing from sharedStyles').not.toBeNull();
    // opacity magnitude single-sourced from the token (not hard-coded).
    expect(body!).toMatch(/opacity:\s*var\(\s*--tc-dim-opacity\b/);
    // desaturation via filter: grayscale(), magnitude from the token.
    expect(body!).toMatch(/filter:\s*grayscale\(/);
    expect(body!).toMatch(/grayscale\(\s*var\(\s*--tc-dim-grayscale\b/);
  });

  test('honest-freshness (UX-DR18): the asleep descriptor shows — and offers manual wake, never auto-wake', () => {
    // The one unforgivable copy error is OVERSTATING freshness. Under asleep the
    // battery must read an em-dash, never a fabricated number, and the card must
    // never auto-wake — it only OFFERS a manual wake affordance.
    const s = FRESHNESS_STATES.asleep;
    expect(s.copy, 'asleep must show — (em-dash), not a stale-but-confident number').toContain('—');
    expect(s.copy, 'asleep copy must forbid a fabricated number').toMatch(/fabricat|never/i);
    expect(s.control, 'asleep must offer a manual wake affordance').toMatch(/wake/i);
    expect(s.control, 'the card never auto-wakes (no-auto-wake ban)').toMatch(/auto-?wake/i);
  });
});

// ── AC1c: Unavailable — disabled-control + staleness-copy recipes ──────────
describe('Unavailable — disabled + staleness-copy recipes (AC1c, applies 2.3 AC1e)', () => {
  test('.tc-disabled dims + makes the control inert (pointer-events:none)', () => {
    const body = ruleBody(sharedCss, '.tc-disabled');
    expect(body, '.tc-disabled recipe missing from sharedStyles').not.toBeNull();
    expect(body!).toMatch(/pointer-events:\s*none/);
    expect(body!).toMatch(/cursor:\s*not-allowed/);
    expect(body!).toMatch(/opacity:\s*var\(\s*--tc-disabled-opacity\b/);
  });

  test('staleness-copy recipe resolves to --tc-text-dim, NEVER --tc-text-mute (UX-DR21)', () => {
    const body = ruleBody(sharedCss, '.tc-stale-copy');
    expect(body, '.tc-stale-copy recipe missing from sharedStyles').not.toBeNull();
    expect(body!).toMatch(/color:\s*var\(\s*--tc-text-dim\b/);
    expect(body!, 'load-bearing staleness copy must not use the 3:1 --tc-text-mute')
      .not.toContain('--tc-text-mute');
  });
});

// ── AC1d: Loading — cold-first-paint skeleton, reduced-motion-safe ─────────
describe('Loading — skeleton recipe halts under reduced-motion (AC1d)', () => {
  test('.tc-skeleton placeholder recipe exists', () => {
    const body = ruleBody(sharedCss, '.tc-skeleton');
    expect(body, '.tc-skeleton recipe missing from sharedStyles').not.toBeNull();
  });

  test('the skeleton is a card-silhouette block + ghost rows (dimmed block + .tc-skeleton-line)', () => {
    // AC1d: the placeholder must match a card silhouette — a dimmed BLOCK
    // (.tc-skeleton, single-sourced from --tc-skeleton-bg) plus GHOST ROWS
    // (.tc-skeleton-line). Both halves are part of the contract.
    const block = ruleBody(sharedCss, '.tc-skeleton');
    expect(block!, 'skeleton block must paint a dimmed background').toMatch(/background/);
    expect(block!, 'skeleton background must single-source --tc-skeleton-bg').toMatch(
      /var\(\s*--tc-skeleton-bg\b/
    );
    const line = ruleBody(sharedCss, '.tc-skeleton-line');
    expect(line, 'ghost-row recipe .tc-skeleton-line missing from sharedStyles').not.toBeNull();
    // A ghost row must carry its OWN single-sourced dimmed fill — without a
    // background it renders transparent (an invisible "row"), so the
    // "block + ghost rows" contract would only be half-real.
    expect(line!, 'ghost row must paint a single-sourced dimmed fill').toMatch(
      /background:\s*var\(\s*--tc-skeleton-bg\b/
    );
  });

  test('the skeleton DOES animate via the shared tc-shimmer keyframe and is unconditionally halted under reduce', () => {
    // Stronger than the "if it animates" gate: the skeleton shimmer is real, so
    // pin that it (a) reuses the SHARED tc-shimmer keyframe and (b) is set to
    // animation:none inside the reduced-motion block — a frozen dimmed
    // placeholder is the required reduced-motion end state (no motion escapes).
    const body = ruleBody(sharedCss, '.tc-skeleton')!;
    expect(body, 'skeleton must animate so the reduced-motion halt is meaningful').toMatch(
      /animation:\s*tc-shimmer\b/
    );
    const idx = sharedCss.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(idx, 'no shared reduced-motion block').toBeGreaterThan(-1);
    const reduced = sharedCss.slice(idx);
    expect(reduced, 'skeleton must be halted under reduced-motion').toMatch(
      /\.tc-skeleton[^{]*\{\s*animation:\s*none/
    );
  });

  test('skeleton motion (if any) is disabled under the shared reduced-motion block', () => {
    const idx = sharedCss.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(idx, 'no shared reduced-motion block').toBeGreaterThan(-1);
    const reduced = sharedCss.slice(idx);
    const body = ruleBody(sharedCss, '.tc-skeleton')!;
    // If the skeleton animates, the reduced block must halt it (a frozen dimmed
    // placeholder is the required reduced-motion end state).
    if (/animation:/.test(body)) {
      expect(reduced).toMatch(/\.tc-skeleton[^{]*\{\s*animation:\s*none/);
    }
  });

  test('the skeleton reuses an existing shared keyframe — no NEW keyframe added', () => {
    // Reusing tc-shimmer keeps the a11y keyframe-set gate exactly
    // {tc-pulse, tc-shimmer}. If a future edit adds a skeleton-only keyframe it
    // must also extend a11y.test.ts — this gate flags the divergence early.
    const keyframes = [...sharedCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
    expect(keyframes).toEqual(['tc-pulse', 'tc-shimmer']);
  });
});

// ── AC2 / AC1: exported machine-checkable map + Staleness crosswalk ────────
describe('FRESHNESS_STATES — the single adoption surface for Epics 3–6 (AC2)', () => {
  test('the map enumerates EXACTLY the six UX-DR19 states', () => {
    expect(Object.keys(FRESHNESS_STATES).sort()).toEqual(
      ['asleep', 'empty', 'loading', 'optimistic', 'unavailable', 'wake-pending']
    );
  });

  test('every state carries treatment + copy + control + gated (+ staleness crosswalk)', () => {
    for (const [name, s] of Object.entries(FRESHNESS_STATES)) {
      expect(s.treatment.length, `${name} has no treatment`).toBeGreaterThan(0);
      expect(s.copy.length, `${name} has no copy rule`).toBeGreaterThan(0);
      expect(s.control.length, `${name} has no control rule`).toBeGreaterThan(0);
      expect(typeof s.gated, `${name} has no gated flag`).toBe('boolean');
      expect('staleness' in s, `${name} missing staleness crosswalk field`).toBe(true);
    }
  });

  test('each statically-checkable (gated) treatment matches a real recipe in sharedStyles', () => {
    const offenders: string[] = [];
    for (const [name, s] of Object.entries(FRESHNESS_STATES)) {
      if (!s.gated) continue;
      // gated states must name a real recipe class that exists in the CSS.
      if (!s.recipe || ruleBody(sharedCss, s.recipe) === null) {
        offenders.push(`${name} → ${s.recipe ?? '(no recipe)'}`);
      }
    }
    expect(offenders, `gated states must back a real shared recipe:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('Staleness crosswalk: data-derived states map to a bucket; UI-lifecycle states map to null', () => {
    // Pairs with data/freshness.ts Staleness = fresh|stale|asleep|unavailable —
    // documented by crosswalk, NOT imported (Epic 2 = presentation-only).
    expect(FRESHNESS_STATES.asleep.staleness).toBe('asleep');
    expect(FRESHNESS_STATES.unavailable.staleness).toBe('unavailable');
    // UI-lifecycle states are NOT derivable from staleness alone.
    expect(FRESHNESS_STATES['wake-pending'].staleness).toBeNull();
    expect(FRESHNESS_STATES.loading.staleness).toBeNull();
    expect(FRESHNESS_STATES.optimistic.staleness).toBeNull();
  });

  test('gated flags are exactly correct: gated ⇔ backed by a shared recipe, ungated ⇔ no recipe', () => {
    // AC2: the `gated` flag separates statically-checkable treatments (a test
    // backs them against a real recipe) from review-enforced / impl-pinned ones.
    // Pin the exact split so a future edit can't quietly downgrade a gate.
    const gated = Object.entries(FRESHNESS_STATES)
      .filter(([, s]) => s.gated)
      .map(([k]) => k)
      .sort();
    expect(gated).toEqual(['asleep', 'loading', 'unavailable']);
    for (const [name, s] of Object.entries(FRESHNESS_STATES)) {
      // gated ⇒ names a recipe; ungated ⇒ recipe is null (review/impl-pinned).
      expect(Boolean(s.recipe), `${name}: gated=${s.gated} must agree with recipe presence`).toBe(s.gated);
    }
  });

  test('Wake-pending descriptor pins the visual + boundary (pending-immediately, last-wake time, cooldown out of scope)', () => {
    // AC1b: define the VISUAL state + where the last-wake time renders, NOT the
    // timer. State the boundary so a reviewer doesn't flag the missing cooldown
    // logic (interval, observed-state gate = AR-9 / Story 5.4) as a miss.
    const s = FRESHNESS_STATES['wake-pending'];
    expect(s.treatment, 'must reflect pending immediately').toMatch(/pending/i);
    expect(s.control, 'must surface the last-wake time').toMatch(/last-?wake/i);
    expect(s.control, 'must mark the cooldown LOGIC out of scope (AR-9 / Story 5.4)').toMatch(
      /5\.4|AR-9|out of scope/i
    );
  });

  test('Empty / NaN-safe descriptor pins the rule (hide-or-neutral, NaN-safe; copy is downstream)', () => {
    // AC1f: a missing / non-numeric read hides or renders neutral — never blank,
    // never a crash, never a misleading default. Here we pin the RULE; the
    // per-panel copy strings are Story 2.5 / owning-epic work.
    const s = FRESHNESS_STATES.empty;
    expect(s.treatment, 'must hide or render neutral, never a misleading default').toMatch(
      /hide|neutral/i
    );
    expect(s.control, 'must pin the NaN-safe read rule').toMatch(/NaN-?safe|numById|stateById/i);
    expect(s.staleness, 'empty derives from available:false, not a staleness bucket').toBeNull();
  });

  test('Optimistic descriptor stays pinned to its existing impl (preserve, do not rewrite)', () => {
    // 2.3 codified the optimistic-then-reconcile toggle as quick-actions; 2.4
    // ties it into the freshness model and reaffirms the D1 boundary.
    expect(FRESHNESS_STATES.optimistic.control).toContain('quick-actions');
    expect(FRESHNESS_STATES.optimistic.control).toMatch(/D1|edge/i);
  });

  test('the model adds NO data/ import and NO hass.states read (Epic 2 boundary)', () => {
    // styles.ts is a root presentation module; importing data/ or reading
    // hass.states would cross the AR-1 boundary the no-cycle / no-bare-hass gates
    // enforce. Belt-and-braces static check co-located with the contract.
    const styles = readFileSync(join(SRC_DIR, 'styles.ts'), 'utf8');
    expect(styles, "styles.ts must not import from data/").not.toMatch(/from\s+['"][./]*data\//);
    // a real read is `hass.states[...]` / `hass.states.foo`; prose mentions of
    // the boundary (`hass.states` in a comment) are not reads, so match access.
    expect(styles, 'styles.ts must not read hass.states').not.toMatch(/hass\.states\s*[[.]/);
  });
});
