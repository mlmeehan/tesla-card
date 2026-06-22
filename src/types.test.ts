// Schema-surface contract tests (Story 7.1, AC1 + AC2).
//
// Story 7.1 consolidated `TeslaCardConfig` into the ONE public type and relocated
// the Hero render-path enums to their owner modules (E9/AR-14). These are pure
// type + source-text guards (no DOM) that keep that consolidation honest so a
// future refactor cannot silently regress it:
//   • AC1 — `types.ts` holds the PUBLIC config surface + the platform HA
//     interfaces ONLY; the relocated internals live with their owners.
//   • AC2 — the D2/D3/D6 additions are present as one coherent, snake_case
//     surface; the now-resolved "Epic 7 owns…" placeholders are gone; the
//     deliberately-deferred D3 helper-ref is recorded (documented, not added).
import { describe, expect, test, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  TeslaCardConfig,
  PanelId,
  EnergyConfig,
  TyresConfig,
  BodyLayers,
  NodeCustomization,
} from './types';
import type { Role } from './data/registry';
// The relocated internal types must now resolve FROM THEIR OWNER modules. These
// type-only imports compile only while the relocation holds (move them back and
// `npm run typecheck` breaks) — the AC1 relocation pin at the type level.
import type { ChargeVisual, ApertureKey, ApertureState } from './components/car';
import type { OpenPanelDetail } from './tesla-card';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const typesSrc = (): string => readFileSync(join(SRC_DIR, 'types.ts'), 'utf8');

/** Every top-level exported declaration name in `types.ts`. */
function exportedDecls(): string[] {
  const out: string[] = [];
  for (const m of typesSrc().matchAll(/^export (?:interface|type) (\w+)/gm)) out.push(m[1]);
  return out.sort();
}

describe('AC1 — types.ts is the PUBLIC TeslaCardConfig surface only (E9/AR-14)', () => {
  test('exports exactly the public-config surface + the platform HA interfaces', () => {
    // Allowlist: the public config type, its sub-shapes, and the minimal HA
    // platform interfaces (no owner module to relocate to). Anything else — esp.
    // a re-added internal enum — fails here, the E9 "only public type" guard.
    expect(exportedDecls()).toEqual(
      [
        'BodyLayers',
        'EnergyConfig',
        'HassEntity',
        'HomeAssistant',
        'LovelaceCard',
        'LovelaceCardEditor',
        'NodeCustomization',
        'PanelId',
        'TeslaCardConfig',
        'TyresConfig',
      ].sort()
    );
  });

  test('the relocated Hero-internal enums are NOT re-declared in types.ts', () => {
    const src = typesSrc();
    // Scan for DECLARATIONS (not the prose relocation note, which names them).
    for (const name of ['ChargeVisual', 'ApertureKey', 'ApertureState', 'OpenPanelDetail']) {
      expect(
        new RegExp(`export (?:interface|type) ${name}\\b`).test(src),
        `${name} must live with its owner module, not in types.ts`
      ).toBe(false);
    }
  });

  test('the relocated enums resolve from their owner modules with their real shapes', () => {
    // car.ts owns the render-path enums…
    expectTypeOf<ChargeVisual>().toEqualTypeOf<'parked' | 'plugged' | 'charging'>();
    expectTypeOf<ApertureKey>().toEqualTypeOf<'frunk' | 'liftgate' | 'door' | 'window'>();
    expectTypeOf<ApertureState>().toEqualTypeOf<Record<ApertureKey, boolean>>();
    // …tesla-card.ts owns the panel-switch event detail.
    expectTypeOf<OpenPanelDetail>().toHaveProperty('panel');
  });

  test('a recorded relocation note documents why nothing internal-only remains', () => {
    expect(typesSrc()).toMatch(/Relocated internal types/i);
  });
});

describe('AC2 — the D2/D3/D6 additions are one reviewed, coherent delta', () => {
  test('D2 integration, D3 tyres, D6 body/paint/image are all on the public surface', () => {
    expectTypeOf<TeslaCardConfig>().toHaveProperty('integration'); // D2 (Epic 1)
    expectTypeOf<TeslaCardConfig>().toHaveProperty('tyres'); // D3 threshold-overrides (Epic 5)
    expectTypeOf<TeslaCardConfig>().toHaveProperty('body'); // D6 layer-pack ref (Epic 3)
    expectTypeOf<TeslaCardConfig>().toHaveProperty('paint'); // D6
    expectTypeOf<TeslaCardConfig>().toHaveProperty('image'); // D6
    // Sub-shapes stay part of the public config surface (not relocated).
    expectTypeOf<TeslaCardConfig['energy']>().toEqualTypeOf<EnergyConfig | undefined>();
    expectTypeOf<TeslaCardConfig['tyres']>().toEqualTypeOf<TyresConfig | undefined>();
    expectTypeOf<TeslaCardConfig['body']>().toEqualTypeOf<BodyLayers | undefined>();
    expectTypeOf<TeslaCardConfig['default_panel']>().toEqualTypeOf<PanelId | undefined>();
  });

  test('the multi-word surface keys are snake_case (F4 config-key convention)', () => {
    // Pinning the exact snake_case names guards against a camelCase regression on
    // the public YAML surface (F4 — snake_case on the surface, no mapping layer).
    expectTypeOf<TeslaCardConfig>().toHaveProperty('default_panel');
    expectTypeOf<TeslaCardConfig>().toHaveProperty('hide_panels');
    expectTypeOf<TeslaCardConfig>().toHaveProperty('hide_quick_actions');
    expectTypeOf<TeslaCardConfig>().toHaveProperty('hide_commands');
    expectTypeOf<TeslaCardConfig>().toHaveProperty('wake_cooldown');
    // No camelCased multi-word key snuck onto the interface.
    for (const camel of ['defaultPanel', 'hidePanels', 'wakeCooldown', 'hideQuickActions']) {
      expect(typesSrc().includes(camel), `surface key must be snake_case, not ${camel}`).toBe(false);
    }
  });

  test('the now-resolved "Epic 7 owns…" placeholder comments are removed', () => {
    // Epic 7 IS now consolidating; the deferral placeholders must be gone.
    expect(typesSrc()).not.toMatch(/Epic 7 owns the consolidated schema/i);
  });

  test('the deferred D3 opt-in helper-ref is recorded (documented, not implemented)', () => {
    const src = typesSrc();
    // The deferral is documented so a reviewer does not flag a "missing" field…
    expect(src).toMatch(/shared-HA-wake-helper/i);
    expect(src).toMatch(/DEFERRED/i);
    // …but it must NOT be implemented as a real config key (YAGNI, architecture D3).
    expectTypeOf<TeslaCardConfig>().not.toHaveProperty('wake_helper');
    expectTypeOf<TeslaCardConfig>().not.toHaveProperty('wake_helper_entity');
  });

  test('the top-level forward-compatibility contract is documented on the type', () => {
    // The contract a future epic's field relies on (R9) is stated in the JSDoc.
    expect(typesSrc()).toMatch(/forward-compat/i);
    expect(typesSrc()).toMatch(/unknown keys[\s*]+are TOLERATED/i);
  });
});

describe('Story 9.1 — energy.nodes is an ADDITIVE, optional, Role-keyed delta', () => {
  // Type-level surface pins for the Epic 9 node-customization hook. Coverage of
  // the RUNTIME forward-compat behavior (tolerate/preserve/omit-is-default) lives
  // in tesla-card.config.test.ts (the R9 corpus); these are the static-shape pins
  // and live here — not contract.test.ts — because types.test.ts is the
  // established home for `expectTypeOf` schema-surface assertions (contract.test.ts
  // pins the bundle/registration contract, a different concern).

  test('NodeCustomization hangs OPTIONALLY off EnergyConfig (energy.nodes?)', () => {
    expectTypeOf<EnergyConfig>().toHaveProperty('nodes');
    expectTypeOf<EnergyConfig['nodes']>().toEqualTypeOf<NodeCustomization | undefined>();
    // …and stays reachable from the public config root (energy?.nodes?).
    expectTypeOf<TeslaCardConfig['energy']>().toEqualTypeOf<EnergyConfig | undefined>();
  });

  test('the node-customization keyspace is `Role` (includes vehicle), NOT EnergyRole', () => {
    // hide/order are Role[] — `Role` is the six suite nodes INCLUDING `vehicle`,
    // exactly the "registry roles plus vehicle" AC1/AC4 require. Using EnergyRole
    // here (which excludes the car) would fail this assertion.
    expectTypeOf<NonNullable<NodeCustomization['hide']>>().toEqualTypeOf<Role[]>();
    expectTypeOf<NonNullable<NodeCustomization['order']>>().toEqualTypeOf<Role[]>();
    // `vehicle` is a valid member of the keyspace (the load-bearing AC1 point).
    expectTypeOf<'vehicle'>().toMatchTypeOf<Role>();
  });

  test('instances is a forward-compat placeholder: Partial<Record<Role, number>>', () => {
    expectTypeOf<NonNullable<NodeCustomization['instances']>>().toEqualTypeOf<
      Partial<Record<Role, number>>
    >();
  });

  test('all three sub-keys are OPTIONAL (omit ⇒ today, SM-C4)', () => {
    // `{}` satisfies NodeCustomization — every field is optional.
    expectTypeOf<Record<string, never>>().toMatchTypeOf<NodeCustomization>();
    expectTypeOf<NodeCustomization['hide']>().toEqualTypeOf<Role[] | undefined>();
    expectTypeOf<NodeCustomization['order']>().toEqualTypeOf<Role[] | undefined>();
  });

  test('the keyspace stays in snake_case (F4) and reuses the registry Role union', () => {
    const src = typesSrc();
    // The customization block reuses the registry vocabulary rather than inlining
    // a parallel union that could drift (the AC1/AC4 anti-drift requirement).
    expect(src).toMatch(/import type \{ Role \} from '\.\/data\/registry'/);
    // No camelCased customization key snuck onto the surface.
    for (const camel of ['nodeCustomization', 'hideNodes', 'nodeOrder']) {
      expect(src.includes(camel), `customization key must be snake_case, not ${camel}`).toBe(false);
    }
  });

  test('the additive/semver back-compat intent is JSDoc-pinned (9.1 is the contract)', () => {
    const src = typesSrc();
    expect(src).toMatch(/Semver back-compat/i);
    expect(src).toMatch(/ADDITIVE \+ OPTIONAL/);
    // Precedence (hide wins) is documented for the dependent stories to enforce.
    expect(src).toMatch(/HIDDEN \(hide wins\)/);
  });
});
