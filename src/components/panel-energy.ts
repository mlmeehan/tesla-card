import { html, svg, css, nothing, type TemplateResult, type SVGTemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import {
  mdiSolarPower,
  mdiHomeBattery,
  mdiTransmissionTower,
  mdiHomeLightningBolt,
  mdiCarElectric,
  mdiBatteryLock,
  mdiCogOutline,
  mdiCounter,
  mdiPowerPlug,
} from '@mdi/js';
import { TcBase } from '../base';
import { sharedStyles } from '../styles';
import { statTile } from '../ui';
import { numById, stateById, type EnergyEntities } from '../energy';
import { formatNumber, prettyText, isUnavailable } from '../helpers';

/** Power magnitude (kW) below which a flow is considered idle. */
const THRESH = 0.05;

interface Node {
  x: number;
  y: number;
  r: number;
  color: string;
  icon: string;
}

/**
 * Cross layout (home-centric, matching the Tesla app / HA energy-distribution
 * card): solar top, grid left, Powerwall right, home centre, car below.
 * Coordinates are in the 100×102 viewBox.
 */
const N: Record<'home' | 'solar' | 'grid' | 'powerwall' | 'car', Node> = {
  home: { x: 50, y: 50, r: 15, color: 'var(--tc-blue, #38bdf8)', icon: mdiHomeLightningBolt },
  solar: { x: 50, y: 15, r: 13, color: 'var(--tc-amber, #fbbf24)', icon: mdiSolarPower },
  grid: { x: 15, y: 50, r: 13, color: 'var(--tc-text-dim, #9aa7b8)', icon: mdiTransmissionTower },
  powerwall: { x: 85, y: 50, r: 13, color: 'var(--tc-green, #34d399)', icon: mdiHomeBattery },
  car: { x: 50, y: 85, r: 13, color: 'var(--tc-teal, #2dd4bf)', icon: mdiCarElectric },
};

interface Geom {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  ux: number;
  uy: number;
}

/** Edge endpoints on the two circle rims, plus the source→sink unit vector. */
function geom(a: Node, b: Node): Geom {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  return {
    sx: a.x + a.r * ux,
    sy: a.y + a.r * uy,
    ex: b.x - b.r * ux,
    ey: b.y - b.r * uy,
    ux,
    uy,
  };
}

/**
 * A connector between `src` and `dst`. Always draws a faint base track; when
 * `active`, overlays a coloured animated dash flowing src→sink with an
 * arrowhead at the sink rim.
 */
function edge(src: Node, dst: Node, color: string, active: boolean): SVGTemplateResult {
  const g = geom(src, dst);
  const track = svg`<line
    class="track"
    x1=${g.sx}
    y1=${g.sy}
    x2=${g.ex}
    y2=${g.ey}
  ></line>`;
  if (!active) return track;

  // Arrowhead triangle at the sink rim, pointing along the flow.
  const a = 4.4;
  const w = a * 0.6;
  const bx = g.ex - a * g.ux;
  const by = g.ey - a * g.uy;
  const px = -g.uy;
  const py = g.ux;
  const lx = bx + w * px;
  const ly = by + w * py;
  const rx = bx - w * px;
  const ry = by - w * py;
  return svg`
    ${track}
    <line
      class="flow"
      style="stroke:${color}"
      x1=${g.sx}
      y1=${g.sy}
      x2=${bx}
      y2=${by}
    ></line>
    <path class="head" style="fill:${color}" d="M ${g.ex} ${g.ey} L ${lx} ${ly} L ${rx} ${ry} Z"></path>
  `;
}

@customElement('tc-panel-energy')
export class TcPanelEnergy extends TcBase {
  @property({ attribute: false }) public entities!: EnergyEntities;

  private _kw(v: number | undefined): SVGTemplateResult {
    if (v === undefined) return svg`—`;
    return svg`${formatNumber(Math.abs(v), 1)}<tspan class="u" dx="0.7">kW</tspan>`;
  }

  private _pct(v: number | undefined): SVGTemplateResult {
    if (v === undefined) return svg`—`;
    return svg`${formatNumber(v, 0)}<tspan class="u" dx="0.4">%</tspan>`;
  }

  private _node(n: Node, value: SVGTemplateResult, active: boolean): SVGTemplateResult {
    const s = 12;
    return svg`
      <g class="node ${active ? 'on' : ''}" style="--c:${n.color}">
        <circle class="ring" cx=${n.x} cy=${n.y} r=${n.r}></circle>
        <g class="ico" transform="translate(${n.x - s / 2} ${n.y - 9}) scale(${s / 24})">
          <path d=${n.icon}></path>
        </g>
        <text class="val" x=${n.x} y=${n.y + 8} text-anchor="middle">${value}</text>
      </g>
    `;
  }

  protected override render(): TemplateResult {
    const hass = this.hass;
    const e = this.entities ?? {};

    const solar = numById(hass, e.solar_power);
    const batt = numById(hass, e.battery_power);
    const load = numById(hass, e.load_power);
    const grid = numById(hass, e.grid_power);
    const pwLevel = numById(hass, e.powerwall_level);
    const wc = numById(hass, e.wc_power);

    const showSolar = !!e.solar_power;
    const showGrid = !!e.grid_power;
    const showPw = !!(e.battery_power || e.powerwall_level);
    const showCar = !!(e.wc_power || e.wc_connected);

    const solarOn = solar !== undefined && solar > THRESH;
    const gridOn = grid !== undefined && Math.abs(grid) > THRESH;
    const pwOn = batt !== undefined && Math.abs(batt) > THRESH;
    const homeOn = load !== undefined && load > THRESH;
    const carOn = wc !== undefined && wc > THRESH;

    // Connectors (drawn first so nodes sit on top).
    const edges: SVGTemplateResult[] = [];
    if (showSolar) edges.push(edge(N.solar, N.home, N.solar.color, solarOn));
    if (showGrid) {
      const imp = (grid ?? 0) >= 0; // + import (grid→home), − export (home→grid)
      edges.push(edge(imp ? N.grid : N.home, imp ? N.home : N.grid, N.grid.color, gridOn));
    }
    if (showPw) {
      const dis = (batt ?? 0) > 0; // + discharging (pw→home), − charging (home→pw)
      edges.push(
        edge(dis ? N.powerwall : N.home, dis ? N.home : N.powerwall, N.powerwall.color, pwOn)
      );
    }
    if (showCar) edges.push(edge(N.home, N.car, N.car.color, carOn));

    const nodes: SVGTemplateResult[] = [this._node(N.home, this._kw(load), homeOn)];
    if (showSolar) nodes.push(this._node(N.solar, this._kw(solar), solarOn));
    if (showGrid) nodes.push(this._node(N.grid, this._kw(grid), gridOn));
    if (showPw) nodes.push(this._node(N.powerwall, this._pct(pwLevel), pwOn));
    if (showCar) nodes.push(this._node(N.car, this._kw(wc), carOn));

    return html`
      <div class="wrap">
        <section class="surface flow-card">
          <div class="flow-head">
            <span class="ftitle">Power flow</span>
            ${this._gridChip()}
          </div>
          <svg class="flow" viewBox="0 0 100 102" role="img" aria-label="Energy power flow">
            ${edges} ${nodes}
          </svg>
        </section>
        ${this._tiles()}
      </div>
    `;
  }

  private _gridChip(): TemplateResult | typeof nothing {
    const status = stateById(this.hass, this.entities?.grid_status);
    if (!status || isUnavailable(status)) return nothing;
    const ok = status.toLowerCase().includes('on');
    return html`<span class="gchip ${ok ? 'ok' : 'warn'}">
      <span class="gdot"></span>${prettyText(status)}
    </span>`;
  }

  private _tiles(): TemplateResult | typeof nothing {
    const hass = this.hass;
    const e = this.entities ?? {};
    const tiles: TemplateResult[] = [];

    const reserve = numById(hass, e.backup_reserve);
    if (reserve !== undefined) {
      tiles.push(
        statTile({
          icon: mdiBatteryLock,
          label: 'Reserve',
          value: `${formatNumber(reserve)}%`,
          color: 'var(--tc-green, #34d399)',
        })
      );
    }

    const mode = stateById(hass, e.operation_mode);
    if (mode && !isUnavailable(mode)) {
      tiles.push(
        statTile({
          icon: mdiCogOutline,
          label: 'Mode',
          value: prettyText(mode),
          color: 'var(--tc-purple, #a78bfa)',
        })
      );
    }

    const session = numById(hass, e.wc_session);
    if (session !== undefined) {
      tiles.push(
        statTile({
          icon: mdiCounter,
          label: 'Session',
          value: `${formatNumber(session, 1)} kWh`,
          color: 'var(--tc-teal, #2dd4bf)',
        })
      );
    }

    const wcStatus = stateById(hass, e.wc_status);
    const wcConnected = stateById(hass, e.wc_connected);
    if (wcStatus && !isUnavailable(wcStatus)) {
      tiles.push(
        statTile({
          icon: mdiPowerPlug,
          label: 'Connector',
          value: prettyText(wcStatus),
          color: 'var(--tc-blue, #38bdf8)',
        })
      );
    } else if (wcConnected && !isUnavailable(wcConnected)) {
      tiles.push(
        statTile({
          icon: mdiPowerPlug,
          label: 'Connector',
          value: wcConnected === 'on' ? 'Connected' : 'Unplugged',
          color: wcConnected === 'on' ? 'var(--tc-blue, #38bdf8)' : 'var(--tc-text-dim, #9aa7b8)',
        })
      );
    }

    if (!tiles.length) return nothing;
    return html`<div class="grid g2">${tiles}</div>`;
  }

  static override styles = [
    sharedStyles,
    css`
      .wrap {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .flow-card {
        padding: 14px 16px 16px;
        border-radius: var(--tc-radius-lg, 22px);
      }
      .flow-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 4px;
      }
      .ftitle {
        font-family: var(--tc-font-display, var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
        font-size: var(--tc-fs-label, 11.5px);
        font-weight: var(--tc-fw-label, 700);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--tc-text-dim, #9aa7b8);
      }
      .gchip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: var(--tc-pill, 999px);
        background: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        border: 1px solid var(--tc-border, rgba(255, 255, 255, 0.09));
        font-size: 12px;
        font-weight: 650;
        color: var(--tc-text-dim, #9aa7b8);
        white-space: nowrap;
      }
      .gdot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--tc-text-mute, #64748b);
        box-shadow: 0 0 7px currentColor;
      }
      .gchip.ok .gdot {
        background: var(--tc-green, #34d399);
        color: var(--tc-green, #34d399);
      }
      .gchip.warn .gdot {
        background: var(--tc-amber, #fbbf24);
        color: var(--tc-amber, #fbbf24);
      }

      /* ── flow diagram ──────────────────────────────────────────────── */
      .flow {
        width: 100%;
        height: auto;
        display: block;
        overflow: visible;
      }
      .track {
        stroke: var(--tc-border-strong, rgba(255, 255, 255, 0.16));
        stroke-width: 1;
        stroke-linecap: round;
      }
      .flow {
        stroke-linecap: round;
      }
      line.flow {
        stroke-width: 1.9;
        stroke-linecap: round;
        stroke-dasharray: 2 2.4;
        animation: tc-flow 0.85s linear infinite;
      }
      .head {
        stroke: none;
      }
      @keyframes tc-flow {
        to {
          stroke-dashoffset: -8.8;
        }
      }

      .node .ring {
        fill: var(--tc-surface-2, rgba(255, 255, 255, 0.07));
        stroke: var(--tc-border, rgba(255, 255, 255, 0.09));
        stroke-width: 1;
        transition: stroke 0.3s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1)), fill 0.3s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .node.on .ring {
        stroke: var(--c);
        fill: color-mix(in srgb, var(--c) 16%, var(--tc-surface-2, rgba(255, 255, 255, 0.07)));
        filter: drop-shadow(0 0 2.5px color-mix(in srgb, var(--c) 55%, transparent));
      }
      .node .ico path {
        fill: var(--tc-text-mute, #64748b);
        transition: fill 0.3s var(--tc-ease, cubic-bezier(0.22, 1, 0.36, 1));
      }
      .node.on .ico path {
        fill: var(--c);
      }
      .node .val {
        fill: var(--tc-text, #f1f5f9);
        font-family: var(--tc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
        font-size: 7px;
        font-weight: 760;
        letter-spacing: -0.02em;
      }
      .node .val .u {
        fill: var(--tc-text-dim, #9aa7b8);
        font-size: 4.2px;
        font-weight: 650;
      }

      @media (prefers-reduced-motion: reduce) {
        line.flow {
          animation: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-panel-energy': TcPanelEnergy;
  }
}
