// Dedicated value-pin home for `flow/renderer.ts` (Story 12.1 review debt).
//
// WHY THIS FILE EXISTS — the tsc-keys-not-values blind spot: `NODE_COLOR` /
// `NODE_ICON` are typed `Record<EnergyRole, string>`, so TypeScript proves the
// KEYS are complete but says NOTHING about the VALUES. A wrong copper hex, a
// swapped MDI icon, or a bad `edgeVisual` coefficient all compile green and ship.
// The R1 proof in `scene-bus.test.ts` is self-referential (renderer output vs
// `edgeVisual()`'s OWN return), so it cannot catch a regression in the formula
// itself either. These absolute pins can. Until now they lived only in the
// sibling `scene-bus.test.ts` (re-homed there when `hero-svg.test.ts` was deleted
// in Epic 12) — one refactor from silent loss. This is their authoritative home;
// it does not contradict the sibling pins, it owns them.
//
// Environment 'node' (pure math + constant tables, no DOM — no jsdom pragma).
import { describe, expect, test } from 'vitest';
import { edgeVisual, edgeVisuals, NODE_COLOR, NODE_ICON } from './renderer';
import { ENERGY_ROLES } from './binding';
import type { FlowEdge } from './model';
import {
  mdiSolarPower,
  mdiHomeBattery,
  mdiTransmissionTower,
  mdiHomeLightningBolt,
  mdiEvStation,
  mdiGeneratorStationary,
} from '@mdi/js';

// ───────────────────────────────────────────────────────────────────────────
// edgeVisual — the canonical kW→visual formula (architecture D1.1b):
//   width = 1.6 + |kW|·0.55   dur = max(0.5, 1.7 − |kW|·0.16)
// A coefficient/clamp drift here silently mis-weights EVERY edge on the bus.
// ───────────────────────────────────────────────────────────────────────────
describe('edgeVisual — canonical width/duration coefficients + 0.5s floor', () => {
  test('derives width/duration from |kW| across magnitudes, clamping dur at 0.5s', () => {
    // dur un-clamps only while 1.7 − |kW|·0.16 > 0.5, i.e. |kW| < 7.5; a large kW floors it.
    const cases: Array<{ kW: number; width: number; durSec: number }> = [
      { kW: 0, width: 1.6, durSec: 1.7 }, // no kW → thinnest + slowest
      { kW: 1, width: 1.6 + 1 * 0.55, durSec: 1.7 - 1 * 0.16 },
      { kW: 5, width: 1.6 + 5 * 0.55, durSec: 1.7 - 5 * 0.16 }, // typical mid, un-clamped
      { kW: 20, width: 1.6 + 20 * 0.55, durSec: 0.5 }, // 1.7−3.2 < 0.5 → clamped to floor
    ];
    for (const c of cases) {
      const v = edgeVisual(c.kW);
      expect(v.width).toBeCloseTo(c.width, 9);
      expect(v.durSec).toBeCloseTo(c.durSec, 9);
    }
  });

  test('a small sub-deadband kW still yields a finite width/dur (calm base track has sane thickness)', () => {
    // The formula is pure math: it does NOT zero out below the idle deadband —
    // suppression is the renderer's job, not this function's (source docstring).
    const v = edgeVisual(0.02);
    expect(v.width).toBeCloseTo(1.6 + 0.02 * 0.55, 9);
    expect(v.durSec).toBeCloseTo(1.7 - 0.02 * 0.16, 9);
  });

  test('is sign-agnostic (|kW|-driven): edgeVisual(-4) === edgeVisual(4)', () => {
    // The SIGN drives direction, never the visual weight — a reverse edge is as
    // thick/fast as the equal-magnitude forward edge.
    expect(edgeVisual(-4)).toEqual(edgeVisual(4));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// edgeVisuals — the per-edge derived visual: shared width/dur, model's direction
// passed through UNRE-DERIVED, source-node colour, active = direction !== 'none'.
// ───────────────────────────────────────────────────────────────────────────
describe('edgeVisuals — direction/colour/active from the model, math from edgeVisual', () => {
  const edge = (over: Partial<FlowEdge>): FlowEdge => ({
    from: 'solar',
    to: 'bus',
    kW: 0,
    direction: 'none',
    provenance: 'measured',
    ...over,
  });

  test('a forward edge: width/dur = edgeVisual(kW), colour = source-node accent, active', () => {
    const e = edge({ from: 'solar', kW: 4.2, direction: 'forward' });
    const v = edgeVisuals(e);
    expect(v.width).toBeCloseTo(edgeVisual(4.2).width, 9);
    expect(v.durSec).toBeCloseTo(edgeVisual(4.2).durSec, 9);
    expect(v.direction).toBe('forward');
    expect(v.color).toBe(NODE_COLOR.solar); // hue = where power comes FROM
    expect(v.active).toBe(true);
  });

  test('a reverse (negative-kW) edge: width uses |kW|, direction passed through, still active', () => {
    const e = edge({ from: 'home', kW: -3.1, direction: 'reverse' });
    const v = edgeVisuals(e);
    // Sign lives in `direction`; the visual weight is the |kW| magnitude.
    expect(v.width).toBeCloseTo(edgeVisual(-3.1).width, 9);
    expect(v.width).toBeCloseTo(edgeVisual(3.1).width, 9);
    expect(v.direction).toBe('reverse');
    expect(v.color).toBe(NODE_COLOR.home);
    expect(v.active).toBe(true);
  });

  test('a quiescent (direction:none) edge is inactive — no motion, calm base width retained', () => {
    const e = edge({ from: 'grid', kW: 0.02, direction: 'none', provenance: 'quiescent' });
    const v = edgeVisuals(e);
    expect(v.active).toBe(false); // renderer suppresses motion for this edge
    expect(v.direction).toBe('none');
    expect(v.width).toBeCloseTo(edgeVisual(0.02).width, 9); // still a sane thickness
    expect(v.color).toBe(NODE_COLOR.grid);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// NODE_COLOR — exact per-role VALUES (FR-9 / ACCENT_SEMANTICS). Each value is the
// full `var(--tc-*, #hex)` read: the fallback hex is load-bearing (styles.test.ts
// fallback-required + token-defined gates), so the WHOLE string is pinned, hex too.
// ───────────────────────────────────────────────────────────────────────────
describe('NODE_COLOR — exact per-role accent (var + carried fallback hex)', () => {
  test('every energy role maps to its exact token-with-fallback accent string', () => {
    expect(NODE_COLOR.solar).toBe('var(--tc-amber, #fbbf24)');
    expect(NODE_COLOR.grid).toBe('var(--tc-text-dim, #9aa7b8)');
    expect(NODE_COLOR.powerwall).toBe('var(--tc-green, #34d399)');
    expect(NODE_COLOR.home).toBe('var(--tc-blue, #38bdf8)');
    expect(NODE_COLOR.wall_connector).toBe('var(--tc-teal, #2dd4bf)');
    // Story 9.14 — the 8th accent; copper = generator / fuel (ACCENT_SEMANTICS).
    expect(NODE_COLOR.generator).toBe('var(--tc-copper, #c2855b)');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// NODE_ICON — per-role identity against the imported @mdi/js path constants (not
// raw path strings), so a swapped-but-valid MDI path is still caught by identity.
// ───────────────────────────────────────────────────────────────────────────
describe('NODE_ICON — exact per-role MDI path identity', () => {
  test('every energy role maps to its named @mdi/js icon constant', () => {
    expect(NODE_ICON.solar).toBe(mdiSolarPower);
    expect(NODE_ICON.grid).toBe(mdiTransmissionTower);
    expect(NODE_ICON.powerwall).toBe(mdiHomeBattery);
    expect(NODE_ICON.home).toBe(mdiHomeLightningBolt);
    expect(NODE_ICON.wall_connector).toBe(mdiEvStation);
    expect(NODE_ICON.generator).toBe(mdiGeneratorStationary);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Key-completeness intent — the maps cover EXACTLY the energy roles (no vehicle).
// tsc guarantees the keys at compile time; this pins the runtime intent alongside
// the value pins so the file reads as the single home for the map contract.
// ───────────────────────────────────────────────────────────────────────────
describe('role-keyed maps cover exactly the energy roles (vehicle excluded)', () => {
  test('ENERGY_ROLES excludes vehicle and both maps key precisely those roles', () => {
    expect(ENERGY_ROLES).not.toContain('vehicle'); // flow model is the suite minus the vehicle
    const roles = [...ENERGY_ROLES].sort();
    expect(Object.keys(NODE_COLOR).sort()).toEqual(roles);
    expect(Object.keys(NODE_ICON).sort()).toEqual(roles);
  });
});
