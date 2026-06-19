import type { HomeAssistant, HassEntity, TeslaCardConfig } from './types';
import { DEFAULT_ENTITIES, type EntityKey } from './const';

export const UNAVAILABLE_STATES = ['unavailable', 'unknown', 'none', ''];

export function entityId(config: TeslaCardConfig, key: EntityKey): string {
  return config.entities?.[key] ?? DEFAULT_ENTITIES[key];
}

export function stateObj(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey
): HassEntity | undefined {
  if (!hass) return undefined;
  return hass.states[entityId(config, key)];
}

export function rawState(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey
): string | undefined {
  return stateObj(hass, config, key)?.state;
}

export function isUnavailable(state: string | undefined): boolean {
  return state === undefined || UNAVAILABLE_STATES.includes(state);
}

export function num(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey
): number | undefined {
  const s = rawState(hass, config, key);
  if (isUnavailable(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function attr(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey,
  name: string
): any {
  return stateObj(hass, config, key)?.attributes?.[name];
}

export function unit(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey
): string {
  return attr(hass, config, key, 'unit_of_measurement') ?? '';
}

export function isOn(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey,
  onStates: string[] = ['on']
): boolean {
  const s = rawState(hass, config, key);
  return s !== undefined && onStates.includes(s);
}

/** Vehicle asleep/offline → render a graceful state, not a wall of "unknown". */
export function isAsleep(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): boolean {
  if (!hass) return true;
  const status = rawState(hass, config, 'status');
  if (status !== undefined && !isUnavailable(status)) {
    return status === 'off';
  }
  // Fallback: if battery level is unavailable, treat as asleep.
  return isUnavailable(rawState(hass, config, 'battery_level'));
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function prettyText(state: string): string {
  const text = state.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Fractional hours → "2h 30m" / "45m" / "3h". */
export function formatHoursToHM(hours: number): string {
  const totalMin = Math.round(hours * 60);
  if (totalMin <= 0) return '0m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Minutes → "2h 30m" / "45m". */
export function formatMinutesToHM(minutes: number): string {
  return formatHoursToHM(minutes / 60);
}

/**
 * Elapsed age (ms) → a COARSE relative magnitude for the "updated Nm ago" hint:
 * `''` (< 1 min — caller renders "Just now"), `"Nm"` (< 1 h), `"Nh"` (< 1 d),
 * else `"Nd"`. NaN/negative age also maps to `''` — a stamp at-or-after our
 * server reference is the freshest possible, never old (mirrors `classifyAge`'s
 * lean-fresh guard in data/freshness; UX-DR18 — never overstate staleness from
 * an indeterminate age). `floor` so a partial unit never rounds the magnitude UP
 * (47m stays "47m", never "1h").
 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** Pretty "value unit", or em-dash when unavailable. */
export function display(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  key: EntityKey,
  opts: { decimals?: number; withUnit?: boolean } = {}
): string {
  const s = rawState(hass, config, key);
  if (isUnavailable(s)) return '—';
  const str = s as string;
  const n = Number(str);
  let text: string;
  if (Number.isFinite(n) && str.trim() !== '') {
    text = formatNumber(n, opts.decimals ?? 0);
  } else {
    return prettyText(str);
  }
  if (opts.withUnit !== false) {
    const u = unit(hass, config, key);
    if (u) text += ` ${u}`;
  }
  return text;
}

export function fireEvent<T>(node: HTMLElement, type: string, detail?: T): void {
  node.dispatchEvent(
    new CustomEvent(type, { detail, bubbles: true, composed: true })
  );
}

export function moreInfo(node: HTMLElement, entity: string): void {
  fireEvent(node, 'hass-more-info', { entityId: entity });
}

export function domainOf(entity: string): string {
  return entity.split('.')[0];
}

/** Toggle a switch/lock/cover/climate/button entity the sensible way. */
export function toggleEntity(hass: HomeAssistant, entity: string): Promise<unknown> {
  const domain = domainOf(entity);
  const st = hass.states[entity]?.state;
  switch (domain) {
    case 'lock':
      return hass.callService('lock', st === 'locked' ? 'unlock' : 'lock', {
        entity_id: entity,
      });
    case 'cover':
      return hass.callService(
        'cover',
        st === 'open' ? 'close_cover' : 'open_cover',
        { entity_id: entity }
      );
    case 'switch':
    case 'light':
    case 'fan':
    case 'input_boolean':
      return hass.callService(domain, 'toggle', { entity_id: entity });
    case 'climate':
      return hass.callService('climate', st === 'off' ? 'turn_on' : 'turn_off', {
        entity_id: entity,
      });
    case 'button':
      return hass.callService('button', 'press', { entity_id: entity });
    default:
      return hass.callService('homeassistant', 'toggle', { entity_id: entity });
  }
}

export function pressButton(hass: HomeAssistant, entity: string): Promise<unknown> {
  return hass.callService('button', 'press', { entity_id: entity });
}

export function setNumber(
  hass: HomeAssistant,
  entity: string,
  value: number
): Promise<unknown> {
  return hass.callService('number', 'set_value', { entity_id: entity, value });
}

export function selectOption(
  hass: HomeAssistant,
  entity: string,
  option: string
): Promise<unknown> {
  return hass.callService('select', 'select_option', {
    entity_id: entity,
    option,
  });
}

/** Clamp helper. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * State-bearing screen-reader label (UX-DR21 a11y floor / NFR-6).
 *
 * Composes an icon-only control's name with its CURRENT, settled state into one
 * SR string: `srState('Lock', 'locked')` → `"Lock, locked"`,
 * `srState('Charge port', 'open')` → `"Charge port, open"`. For availability
 * phrasing pass the whole state (`srState('Wake', 'available in 2m')`).
 *
 * This is the single discoverable home for the convention; it does NOT force
 * churn on controls already carrying correct `aria-label`s (hero battery row,
 * quick-actions, media, climate, closures). It is adopted going forward and
 * applied per-epic via the Definition of Done.
 *
 * CRITICAL for optimistic toggles (quick-actions): announce the SETTLED state
 * (the reconciled `hass` value), never the in-flight optimistic guess — the
 * label must match reality, not the request.
 */
export function srState(label: string, state: string): string {
  return `${label}, ${state}`;
}
