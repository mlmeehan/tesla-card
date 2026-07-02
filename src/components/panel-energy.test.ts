// @vitest-environment jsdom
//
// Origin-layer render gate for `tc-panel-energy` (`panel-energy.ts`) — the module
// that DEFINES the raw sensor-sign convention every ecosystem card later pins its
// own copy of (battery negative = charging, grid positive = import). The panel had
// ZERO test-file importers, so a sign flip HERE — a user-facing honesty lie — fails
// nothing today. These pins close that gap.
//
// The panel is a flow DIAGRAM: it encodes direction GEOMETRICALLY (an animated
// `line.flow` drawn source→sink with a `.head` arrowhead), NOT as a text label. So
// the sign is pinned via the flow line's vector: with a single role wired, exactly
// one `line.flow` exists, and `x2 − x1` (source-rim → sink-arrow, positive = points
// right) flips with the sign. A flipped convention flips that sign → this suite reds.
import { afterEach, describe, expect, test } from 'vitest';
import './panel-energy';
import { STRINGS } from '../strings';
import type { EnergyEntities } from '../data/energy';
import type { HassEntity, HomeAssistant } from '../types';

// Realistic ids satisfying the function-slug matcher (`data/energy` RULES), though
// the panel reads already-resolved ids off its `.entities` property directly.
const ID = {
  battery: 'sensor.garage_battery_power',
  grid: 'sensor.garage_grid_power',
  solar: 'sensor.garage_solar_power',
  status: 'sensor.garage_grid_status',
  reserve: 'number.garage_backup_reserve',
  mode: 'select.garage_operation_mode',
} as const;

/** A single fresh stamp — irrelevant to `numById` (a RAW read, no freshness), present for shape. */
const STAMP = '2026-06-15T15:00:00Z';
function ent(state: string): HassEntity {
  return { state, attributes: {}, last_updated: STAMP, last_changed: STAMP } as unknown as HassEntity;
}
function makeHass(states: Record<string, HassEntity>): HomeAssistant {
  return { states } as unknown as HomeAssistant;
}

type Panel = HTMLElement & {
  hass?: HomeAssistant;
  entities: EnergyEntities;
  updateComplete: Promise<boolean>;
};
async function mount(states: Record<string, HassEntity>, entities: EnergyEntities): Promise<Panel> {
  const el = document.createElement('tc-panel-energy') as Panel;
  el.hass = makeHass(states);
  el.entities = entities;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const sr = (el: Panel) => el.shadowRoot!;
const bodyText = (el: Panel) => sr(el).textContent ?? '';
const flowLine = (el: Panel): SVGLineElement | null => sr(el).querySelector('line.flow');
const arrowhead = (el: Panel): SVGPathElement | null => sr(el).querySelector('path.head');
/** Flow vector along x: source-rim (x1) → sink-arrow (x2). Positive points right. */
function flowDx(el: Panel): number {
  const l = flowLine(el)!;
  return Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('panel shell + flow diagram render', () => {
  test('renders the flow title and the aria-labelled flow svg', async () => {
    const el = await mount({ [ID.solar]: ent('3.0') }, { solar_power: ID.solar });
    expect(sr(el).querySelector('.ftitle')?.textContent).toContain(STRINGS.energy.title);
    const svg = sr(el).querySelector('svg.flow');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-label')).toBe(STRINGS.energy.flowLabel);
  });
});

describe('battery raw sign — negative = charging, positive = discharging', () => {
  test('a NEGATIVE battery_power flows toward the Powerwall (charging)', async () => {
    // Powerwall node sits to the RIGHT of Home; charging = Home→Powerwall = rightward.
    const el = await mount({ [ID.battery]: ent('-2.5') }, { battery_power: ID.battery });
    expect(flowLine(el)).not.toBeNull(); // one active edge
    expect(arrowhead(el)).not.toBeNull();
    expect(flowDx(el)).toBeGreaterThan(0);
  });

  test('a POSITIVE battery_power flows toward Home (discharging)', async () => {
    // Discharging = Powerwall→Home = leftward. A flipped sign would red this.
    const el = await mount({ [ID.battery]: ent('2.5') }, { battery_power: ID.battery });
    expect(flowLine(el)).not.toBeNull();
    expect(flowDx(el)).toBeLessThan(0);
  });

  test('a sub-deadband battery magnitude claims NO direction (idle, only the faint track)', async () => {
    // |0.02| < 0.05 kW THRESH → the edge is drawn inert (track only), never an
    // animated flow with an arrowhead → no false charge/discharge claim.
    const el = await mount({ [ID.battery]: ent('0.02') }, { battery_power: ID.battery });
    expect(flowLine(el)).toBeNull();
    expect(arrowhead(el)).toBeNull();
    expect(sr(el).querySelector('line.track')).not.toBeNull();
  });

  test('an unavailable battery degrades honestly — em-dash value, no fabricated direction', async () => {
    // NaN-safe: `numById` yields undefined → the node reads "—" and the edge stays
    // inert. The one unforgivable error would be inventing a direction here.
    const el = await mount({ [ID.battery]: ent('unavailable') }, { battery_power: ID.battery });
    expect(flowLine(el)).toBeNull();
    expect(bodyText(el)).toContain('—');
    expect(bodyText(el)).not.toContain('NaN');
  });
});

describe('grid raw sign — positive = import (grid→home), negative = export', () => {
  test('a POSITIVE grid_power flows from the Grid toward Home (importing)', async () => {
    // Grid node sits to the LEFT of Home; import = Grid→Home = rightward.
    const el = await mount({ [ID.grid]: ent('2.0') }, { grid_power: ID.grid });
    expect(flowLine(el)).not.toBeNull();
    expect(flowDx(el)).toBeGreaterThan(0);
  });

  test('a NEGATIVE grid_power flows from Home toward the Grid (exporting)', async () => {
    const el = await mount({ [ID.grid]: ent('-3.0') }, { grid_power: ID.grid });
    expect(flowLine(el)).not.toBeNull();
    expect(flowDx(el)).toBeLessThan(0);
  });

  test('a sub-deadband grid magnitude claims NO direction (idle)', async () => {
    const el = await mount({ [ID.grid]: ent('0.02') }, { grid_power: ID.grid });
    expect(flowLine(el)).toBeNull();
    expect(arrowhead(el)).toBeNull();
  });
});

describe('grid_status metadata chip (panel metadata, NOT a flow input)', () => {
  test('an on-grid status renders the ok chip', async () => {
    const el = await mount({ [ID.status]: ent('on_grid') }, { grid_status: ID.status });
    const chip = sr(el).querySelector('.gchip');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('ok')).toBe(true);
  });

  test('an off-grid status renders the warn chip', async () => {
    const el = await mount({ [ID.status]: ent('off_grid') }, { grid_status: ID.status });
    const chip = sr(el).querySelector('.gchip');
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains('warn')).toBe(true);
  });

  test('an absent/unavailable grid_status renders no chip', async () => {
    const unavailable = await mount({ [ID.status]: ent('unavailable') }, { grid_status: ID.status });
    expect(sr(unavailable).querySelector('.gchip')).toBeNull();
    const absent = await mount({ [ID.grid]: ent('2.0') }, { grid_power: ID.grid });
    expect(sr(absent).querySelector('.gchip')).toBeNull();
  });
});

describe('detail tiles degrade honestly (present shows, unavailable hides — never NaN)', () => {
  test('a present backup_reserve tile renders; an unavailable operation_mode tile is hidden', async () => {
    const el = await mount(
      { [ID.reserve]: ent('20'), [ID.mode]: ent('unavailable') },
      { backup_reserve: ID.reserve, operation_mode: ID.mode }
    );
    expect(bodyText(el)).toContain(STRINGS.energy.reserve); // present value → tile shown
    expect(bodyText(el)).not.toContain(STRINGS.energy.mode); // unavailable → tile hidden, not blanked
    expect(bodyText(el)).not.toContain('NaN');
  });
});
