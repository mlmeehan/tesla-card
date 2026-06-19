// @vitest-environment jsdom
//
// Zero-YAML auto-detection element test (Story 1.8 — the Epic-1 capstone / FR-26).
//
// Proves the four ACs of the zero-YAML contract end-to-end, against the committed
// corpus (no network, no synthetic vehicles):
//   • AC1 — `getStubConfig` yields a working default via the resolver/dialect path
//           with NO hand-typed entity IDs (lean `{ type }` seed); the vehicle still
//           resolves at render-time.
//   • AC2 — the Energy tab appears ONLY when an energy site is detected: present for
//           model-y-awake (solar/battery/grid/wc), absent for all-unresolved.
//   • AC3 — `detectEnergySite` (the single composing predicate) agrees with the
//           card's rendered tab presence on the same fixtures (no drift).
//   • AC4 — three degradation paths (no hass / empty states / all-unresolved) each
//           return the safe minimal seed and never throw, and render with no crash
//           and NO `/local/...` image request (no 404 — bundled generic-EV path).
//
// Mirrors tesla-card.lifecycle.test.ts (the only other element test): jsdom opt-in,
// side-effect import upgrades the custom element, fixtures import as pure JSON.
import { describe, expect, test, beforeAll } from 'vitest';
import type { HomeAssistant, TeslaCardConfig } from './types';
import { detectEnergySite, hasEnergySite, resolveEnergyEntities } from './data/energy';
import { resolveEntities } from './data/resolve';
import { TeslaCard } from './tesla-card';
import './tesla-card';
import awake from './fixtures/model-y-awake.json';
import allUnresolved from './fixtures/all-unresolved.json';

/** Build a states-only hass from a committed fixture (registry absent, like the live capture). */
function hassFrom(fixture: { states: Record<string, unknown> }): HomeAssistant {
  return {
    states: fixture.states,
    locale: { language: 'en' },
    callService: () => Promise.resolve(),
  } as unknown as HomeAssistant;
}

/** A hass with an empty states map (cold first paint / no entities). */
function emptyStatesHass(): HomeAssistant {
  return { states: {}, callService: () => Promise.resolve() } as unknown as HomeAssistant;
}

type CardEl = HTMLElement & {
  hass?: HomeAssistant;
  setConfig(c: TeslaCardConfig): void;
  updateComplete: Promise<boolean>;
};

function makeCard(): CardEl {
  const el = document.createElement('tesla-card') as CardEl;
  document.body.appendChild(el);
  return el;
}

/** Render the card with a config + hass, return the upgraded element. */
async function renderCard(config: TeslaCardConfig, hass?: HomeAssistant): Promise<CardEl> {
  const el = makeCard();
  el.setConfig(config);
  if (hass) el.hass = hass;
  await el.updateComplete;
  return el;
}

/** Visible tab labels read from the rendered tab list (textContent, CSS-independent). */
function tabLabels(el: CardEl): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.tab span') ?? []).map(
    (s) => s.textContent?.trim() ?? ''
  );
}

/** Recursively collect every <img> src across the card and its nested shadow roots. */
function allImageSrcs(root: ParentNode | null): string[] {
  if (!root) return [];
  const out: string[] = [];
  for (const img of Array.from(root.querySelectorAll('img'))) {
    out.push(img.getAttribute('src') ?? '');
  }
  for (const node of Array.from(root.querySelectorAll('*'))) {
    const sr = (node as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) out.push(...allImageSrcs(sr));
  }
  return out;
}

const hasRoot = (el: CardEl): boolean => !!el.shadowRoot?.querySelector('.root');

beforeAll(() => {
  expect(customElements.get('tesla-card')).toBeTruthy();
});

describe('AC1 — getStubConfig yields a working default with no hand-typed IDs', () => {
  test('no-arg and hass-arg both return the lean { type } seed (no entities map)', () => {
    const bare = TeslaCard.getStubConfig();
    const withHass = TeslaCard.getStubConfig(hassFrom(awake));
    for (const stub of [bare, withHass]) {
      expect(stub.type).toBe('custom:tesla-card');
      // Zero-YAML: the persisted seed carries NO hand-typed entity IDs.
      expect('entities' in stub).toBe(false);
      expect('image' in stub).toBe(false);
      expect('integration' in stub).toBe(false);
    }
  });

  test('the seed is resolvable: the vehicle resolves via the resolver, not just bundled defaults', () => {
    const hass = hassFrom(awake);
    const stub = TeslaCard.getStubConfig(hass);
    const resolved = resolveEntities(hass, stub);
    // garage_model_y_* anchored id present in the awake corpus resolves.
    expect(resolved.battery_level).toBe('sensor.garage_model_y_battery_level');
    // …and the bare-device quirk resolves too (proves states-path, not a default guess).
    expect(resolved.odometer).toBe('sensor.odometer');
  });
});

describe('AC2 — Energy tab gated by the predicate, proven both ways', () => {
  test('awake fixture (energy present): Energy tab shown and vehicle renders', async () => {
    const hass = hassFrom(awake);
    const el = await renderCard(TeslaCard.getStubConfig(hass), hass);
    expect(hasRoot(el)).toBe(true); // vehicle reads render, not nothing/blank
    expect(el.shadowRoot?.querySelector('tc-hero')).toBeTruthy();
    expect(tabLabels(el)).toContain('Energy');
    el.remove();
  });

  test('all-unresolved fixture (no energy): Energy tab excluded', async () => {
    const hass = hassFrom(allUnresolved);
    const el = await renderCard(TeslaCard.getStubConfig(hass), hass);
    expect(hasRoot(el)).toBe(true);
    expect(tabLabels(el)).not.toContain('Energy');
    el.remove();
  });
});

describe('AC3 — exactly one predicate, importable, no drift', () => {
  test('detectEnergySite agrees with hasEnergySite(resolveEnergyEntities(...)) and the card', async () => {
    const awakeHass = hassFrom(awake);
    const unresolvedHass = hassFrom(allUnresolved);
    const stub = TeslaCard.getStubConfig();

    expect(detectEnergySite(awakeHass, stub)).toBe(true);
    expect(detectEnergySite(unresolvedHass, stub)).toBe(false);

    // detectEnergySite is exactly hasEnergySite ∘ resolveEnergyEntities (one definition).
    expect(detectEnergySite(awakeHass, stub)).toBe(
      hasEnergySite(resolveEnergyEntities(awakeHass, stub))
    );

    // …and it agrees with the card's rendered tab presence (no second predicate drifts).
    const awakeEl = await renderCard(stub, awakeHass);
    expect(tabLabels(awakeEl).includes('Energy')).toBe(detectEnergySite(awakeHass, stub));
    awakeEl.remove();

    const unresolvedEl = await renderCard(stub, unresolvedHass);
    expect(tabLabels(unresolvedEl).includes('Energy')).toBe(
      detectEnergySite(unresolvedHass, stub)
    );
    unresolvedEl.remove();
  });
});

describe('AC4 — three degradation paths: safe minimal seed, no throw, no /local 404', () => {
  test('getStubConfig(undefined / empty-states / all-unresolved) returns the safe seed without throwing', () => {
    expect(() => TeslaCard.getStubConfig(undefined)).not.toThrow();
    expect(TeslaCard.getStubConfig(undefined)).toEqual({ type: 'custom:tesla-card' });
    expect(() => TeslaCard.getStubConfig(emptyStatesHass())).not.toThrow();
    expect(TeslaCard.getStubConfig(emptyStatesHass())).toEqual({ type: 'custom:tesla-card' });
    expect(() => TeslaCard.getStubConfig(hassFrom(allUnresolved))).not.toThrow();
    expect(TeslaCard.getStubConfig(hassFrom(allUnresolved))).toEqual({
      type: 'custom:tesla-card',
    });
  });

  test('rendering the safe seed over empty-states and all-unresolved never throws and requests no /local image', async () => {
    for (const hass of [emptyStatesHass(), hassFrom(allUnresolved)]) {
      const stub = TeslaCard.getStubConfig(hass);
      const el = await renderCard(stub, hass);
      // Seed carries no image/body → falls to the bundled generic EV (no /local/ asset).
      const localRequests = allImageSrcs(el.shadowRoot).filter((s) => s.includes('/local/'));
      expect(localRequests).toEqual([]);
      el.remove();
    }
  });
});
