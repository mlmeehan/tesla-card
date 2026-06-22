// Co-located unit test for the canonical function-key registry (Story 1.2, AC3).
// Pure-hub test: environment 'node' (default), hermetic — reads only committed
// source files via fs, makes ZERO network calls. Enforces the three registry
// invariants so the suite-wide vocabulary cannot rot:
//   (a) uniqueness across all roles,
//   (b) snake_case + exactly-one-role namespacing,
//   (c) no inlined function-key literal anywhere outside the registry.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ALL_KEYS, BUS_ORIENTATION, FUNCTION_KEYS, ROLES, roleOf } from './registry';

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively collect every `.ts` source under src/. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...tsFiles(full));
    else if (ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('canonical function-key registry (Story 1.2)', () => {
  test('(a) every key is unique across all roles', () => {
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
  });

  test('(b) every key is snake_case and belongs to exactly one role', () => {
    const snake = /^[a-z][a-z0-9_]*$/;
    for (const key of ALL_KEYS) {
      expect(key, `${key} must be snake_case`).toMatch(snake);
      // roleOf must resolve, and that role must be the *only* one containing it.
      const role = roleOf(key);
      expect(role, `${key} must resolve to a role`).toBeDefined();
      const owners = ROLES.filter((r) => (FUNCTION_KEYS[r] as readonly string[]).includes(key));
      expect(owners, `${key} must live in exactly one role`).toEqual([role]);
    }
  });

  test('(b) all seven roles are present and non-empty', () => {
    expect([...ROLES].sort()).toEqual(
      ['generator', 'grid', 'home', 'powerwall', 'solar', 'vehicle', 'wall_connector']
    );
    for (const role of ROLES) {
      expect(FUNCTION_KEYS[role].length, `${role} must be non-empty`).toBeGreaterThan(0);
    }
  });

  // Story 9.14 — the generator is a SOURCE: a positive canonical reading injects
  // into the bus (`+1`), the same polarity as solar/grid. This is the only
  // role-dependent fact `flow/balance.ts` consults, so adding it here (registry
  // metadata) is what keeps the compute engine role-generic — no balance edit.
  test('(b2) BUS_ORIENTATION.generator is +1 — a source, same sign as solar/grid', () => {
    expect(BUS_ORIENTATION.generator).toBe(1);
    expect(BUS_ORIENTATION.generator).toBe(BUS_ORIENTATION.solar);
    expect(BUS_ORIENTATION.generator).toBe(BUS_ORIENTATION.grid);
  });

  // (c) No function-key literal *re-declares the vocabulary outside the type system*.
  //
  // Scope (AC-3 scoping decision): the registry already CLOSES the vocabulary at the
  // type level — `EntityKey`/`EnergyKey` derive from it, so every type-checked key
  // argument (e.g. `entityId(cfg, 'climate')`, `attr(hass, cfg, 'charge_limit', …)`)
  // is bound to the registry and cannot drift. Those typed call-args are therefore
  // legitimate and intentionally NOT flagged. What the guard forbids is RAW MAP-ACCESS
  // by literal — `entities['solar_power']`, `hass.states['battery_level']` — i.e. a key
  // used to index a record OUTSIDE the type system, the one pattern that can silently
  // reconstruct the vocabulary and drift from the registry. The fix for a true hit is
  // to route through the typed resolver/helper (which imports the key from here) — the
  // AR-2 outcome.
  //
  // Allowlist: const.ts + energy.ts are the value-table homes (object-key declarations
  // and energy.ts's RULES `has`/`not` detection substrings, which are entity-id
  // fragments that happen to equal a key, not map-access). Both are typecheck-bound to
  // the registry by `satisfies`/the drift guard, so excluding them is safe.
  test('(c) no function-key literal indexes a record outside the registry/type system', () => {
    const ALLOWLIST = new Set(['const.ts', 'energy.ts']); // value-table homes (see comment)
    // Bracket-index access by a function-key literal: `[ '<key>' ]` / `[ "<key>" ]`.
    const bracketIndex = (key: string) => new RegExp(`\\[\\s*(['"\`])${key}\\1\\s*\\]`);

    const violations: string[] = [];
    for (const file of tsFiles(SRC_ROOT)) {
      const base = file.slice(SRC_ROOT.length + 1); // path relative to src/
      const name = base.split('/').pop()!;
      if (name === 'registry.ts' || name.endsWith('.test.ts') || ALLOWLIST.has(name)) continue;
      const text = readFileSync(file, 'utf8');
      for (const key of ALL_KEYS) {
        if (bracketIndex(key).test(text)) violations.push(`${base}: ['${key}']`);
      }
    }

    expect(violations, `raw map-access by function-key literal (route through the typed resolver/helper instead):\n${violations.join('\n')}`).toEqual([]);
  });
});
