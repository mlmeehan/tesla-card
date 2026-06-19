// Copy-contract gate for Story 2.5 (centralized strings / AR-18 / NFR-7 / UX-DR18).
//
// Gate-shaped, not claim-shaped (Epic-1 retro lesson): the voice contract is
// asserted against the actual exported values, and the migration itself is
// backed by a real corpus scan — not the Dev Agent Record's word.
//   (a) fixed status terms exist verbatim and single-sourced (UX-DR18);
//   (b) British "Tyres" is the label, and NO user-facing "Tires" survives in src/;
//   (c) button/command labels are sentence-case (first word capitalized, the
//       rest lower — not Title-Cased multi-word);
//   (d) the key copy-bearing components actually import from `./strings`
//       (a light backstop that the relocation happened, per Task 4's optional).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { STRINGS } from './strings';

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

describe('centralized strings — voice contract (Story 2.5)', () => {
  test('AC1: fixed status terms present verbatim, single-sourced', () => {
    // UX-DR18 — these are the exact words the hero + closures render; moving
    // them must not reword them.
    expect(STRINGS.status).toMatchObject({
      asleep: 'Asleep',
      charging: 'Charging',
      driving: 'Driving',
      reverse: 'Reverse',
      neutral: 'Neutral',
      parked: 'Parked',
      locked: 'Locked',
      unlocked: 'Unlocked',
    });
  });

  test('AC1: tab/panel label is British "Tyres"', () => {
    expect(STRINGS.tabs.tyres).toBe('Tyres');
    expect(STRINGS.tyres.title).toBe('Tyre pressure');
  });

  test('AC1: no user-facing "Tires" (American spelling) anywhere in src/', () => {
    // The internal entity function-keys are `tire_*` (lower-case, singular) and
    // are out of scope; the American plural "Tires" must never reach the user.
    const offenders = srcFiles(SRC_DIR).filter((f) => /Tires/.test(readFileSync(f, 'utf8')));
    expect(offenders, `found "Tires" in: ${offenders.join(', ')}`).toEqual([]);
  });

  test('AC1: button/command labels are sentence-case (not Title-Cased multi-word)', () => {
    // Sentence-case = first word capitalized, every following word lower-case
    // (proper nouns would be allow-listed; this set has none). Catches a
    // regression to "Start Charging"/"Vent Windows".
    const labels = [
      STRINGS.charging.start, // Start charging
      STRINGS.charging.stop, // Stop charging
      STRINGS.charging.chargeLimit, // Charge limit
      STRINGS.charging.chargeCurrent, // Charge current
      STRINGS.closures.closeWindows, // Close windows
      STRINGS.closures.ventWindows, // Vent windows
      STRINGS.charging.timeToFull, // Time to full
      STRINGS.charging.chargePort, // Charge port
    ];
    for (const label of labels) {
      const words = label.split(' ');
      expect(words[0], `"${label}" first word not capitalized`).toMatch(/^[A-Z]/);
      for (const w of words.slice(1)) {
        expect(w, `"${label}" is Title-Cased, not sentence-case`).toMatch(/^[a-z]/);
      }
    }
  });

  test('AC1 (UX-DR18): no STRINGS value overstates freshness — never "Offline"', () => {
    // The one unforgivable copy error (UX-DR18): the card must never say
    // "Offline" — it shows honest staleness ("Asleep · updated 47m ago")
    // instead. Walk the actual exported values (not the raw file, which
    // mentions "Offline" only in an explanatory comment) so the gate tests the
    // shipped copy, not the source prose.
    const values: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') values.push(node);
      else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(STRINGS);
    const offenders = values.filter((v) => /\boffline\b/i.test(v) || /\bTires\b/.test(v));
    expect(offenders, `forbidden copy in STRINGS values: ${offenders.join(', ')}`).toEqual([]);
  });

  test('AC1 (UX-DR18): honest asleep affordance is preserved verbatim', () => {
    // The honest "tap a command to wake" phrasing (vs. an alarming "Offline")
    // is the positive half of the freshness contract — assert it survived the
    // move byte-identical.
    expect(STRINGS.hero.tapToWake).toBe('Tap a command to wake');
  });

  test('Story 5.4: wake-citizenship copy is calm + honest (never overstates freshness)', () => {
    // The resting wake is honest (UX-DR18): it shows "Awake"/"available in Nm"/
    // last-wake time, never an alarming "Offline"/"No connection".
    expect(STRINGS.wake.online).toBe('Awake');
    expect(STRINGS.wake.availableIn).toBe('available in');
    expect(STRINGS.wake.wokenPrefix).toBe('Woken');
    expect(STRINGS.wake.wokenJustNow).toBe('Woken just now');
    // Composes the AC's state-bearing button name verbatim.
    expect(`${STRINGS.commands.wake} — ${STRINGS.wake.availableIn} 2m`).toBe(
      'Wake — available in 2m'
    );
  });

  test('Story 5.5: charging panel gains the display-toggle + charge-target copy', () => {
    // The range/% toggle labels and the honest "Target" line are new user-facing
    // copy (AC3) — single-sourced here, sentence-case, no duplicate literals.
    expect(STRINGS.charging.range).toBe('Range');
    expect(STRINGS.charging.percent).toBe('Percent');
    expect(STRINGS.charging.display).toBe('Display units');
    expect(STRINGS.charging.target).toBe('Target');
    // Sentence-case (first word capitalized, the rest lower) like the other labels.
    for (const label of [STRINGS.charging.range, STRINGS.charging.target, STRINGS.charging.display]) {
      const words = label.split(' ');
      expect(words[0]).toMatch(/^[A-Z]/);
      for (const w of words.slice(1)) expect(w).toMatch(/^[a-z]/);
    }
  });

  test('Story 5.6: climate panel gains the accessible-name fragments (toggles + cyclers + setpoint)', () => {
    // The optimistic toggles announce a settled boolean ("Climate, on"), the seat
    // cyclers a settled level ("Front L heater, High"), and the stepper group is
    // named — all new user-facing copy (DoD a11y), single-sourced here.
    expect(STRINGS.climate.climate).toBe('Climate');
    expect(STRINGS.climate.heater).toBe('heater');
    expect(STRINGS.climate.stateOn).toBe('on');
    expect(STRINGS.climate.stateOff).toBe('off');
    expect(STRINGS.climate.setpoint).toBe('Target temperature');
    // Composes the AC's state-bearing names verbatim.
    expect(`${STRINGS.climate.defrost}, ${STRINGS.climate.stateOn}`).toBe('Defrost, on');
    expect(`${STRINGS.climate.seats.fl} ${STRINGS.climate.heater}`).toBe('Front L heater');
  });

  test('migration backstop: copy-bearing components import from ./strings', () => {
    const consumers = [
      'tesla-card.ts',
      'editor.ts',
      'components/hero.ts',
      'components/commands.ts',
      'components/quick-actions.ts',
      'components/panel-charging.ts',
      'components/panel-climate.ts',
      'components/panel-closures.ts',
      'components/panel-tyres.ts',
      'components/panel-media.ts',
      'components/panel-location.ts',
      'components/panel-energy.ts',
    ];
    for (const rel of consumers) {
      const src = readFileSync(join(SRC_DIR, rel), 'utf8');
      expect(src, `${rel} does not import STRINGS`).toMatch(/from '\.\.?\/strings'/);
    }
  });
});
