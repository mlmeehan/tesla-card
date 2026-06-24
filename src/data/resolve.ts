import type { HomeAssistant, TeslaCardConfig } from '../types';
import { DEFAULT_ENTITIES, type EntityKey } from '../const';

/**
 * Entity resolution by stable function-name, not hard-coded IDs.
 *
 * The part of a Tesla entity_id that varies between installs is the
 * device-name prefix (`garage_model_y_` vs `model_y_` vs `tesla_`…). The
 * function portion — `battery_level`, `time_to_full_charge`, `odometer` — is
 * the language-independent slug of the entity's friendly name and stays the
 * same everywhere. So we derive that stable "canonical" form from the bundled
 * defaults, detect the vehicle's device, and match each key by canonical form
 * within that device. Explicit `config.entities` overrides always win, and we
 * fall back to the bundled default ID, so the worst case is today's behaviour.
 */

/** The device-name slug the bundled DEFAULT_ENTITIES were captured against. */
const REFERENCE_SLUG = 'garage_model_y';

/** Integration platforms whose entities identify a Tesla vehicle device. */
export const TESLA_PLATFORMS = new Set([
  'tesla_fleet',
  'teslemetry',
  'tessie',
  'tesla_custom',
  'tesla',
]);

interface KeySignature {
  /** entity domain, e.g. "sensor" */
  domain: string;
  /** stable, prefix-stripped object id, e.g. "battery_level" or "odometer" */
  suffix: string;
  /** `${domain}.${suffix}` — the prefix/language-independent identity */
  canonical: string;
}

function splitEntity(entityId: string): { domain: string; object: string } {
  const dot = entityId.indexOf('.');
  if (dot < 0) return { domain: '', object: entityId };
  return { domain: entityId.slice(0, dot), object: entityId.slice(dot + 1) };
}

/** Strip a leading `${slug}_` from an object id, if present. */
function stripSlug(object: string, slug: string): string {
  if (slug && object.startsWith(slug + '_')) {
    return object.slice(slug.length + 1);
  }
  return object;
}

/** A dependency-free slugify matching HA's entity-id slug rules closely.
 *  Coerces non-string input (`String(name ?? '')`) so a hand-written non-string
 *  `config.name`/`config.device` (e.g. a YAML number `name: 2024`) slugs harmlessly
 *  instead of throwing `…trim is not a function` — which crashed both the editor's
 *  discovery on open AND the card's entity resolution at runtime (FR-24 garbage
 *  tolerance; the call sites only guard truthiness, not type). */
export function slugify(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Per-key {domain, suffix, canonical}, derived once from DEFAULT_ENTITIES. */
const KEY_SIGNATURES: Record<EntityKey, KeySignature> = (() => {
  const out = {} as Record<EntityKey, KeySignature>;
  for (const key of Object.keys(DEFAULT_ENTITIES) as EntityKey[]) {
    const { domain, object } = splitEntity(DEFAULT_ENTITIES[key]);
    const suffix = stripSlug(object, REFERENCE_SLUG);
    out[key] = { domain, suffix, canonical: `${domain}.${suffix}` };
  }
  return out;
})();

interface VehicleContext {
  /** device-name slug used as the entity-id prefix, e.g. "model_y" */
  slug: string;
  /** entity ids registered to the detected vehicle device (may be empty) */
  entityIds: string[];
}

/**
 * Find the vehicle's device and its entity-id prefix slug.
 * Precedence: config.device (id or name) → name match → most Tesla entities.
 * `config.prefix` overrides the derived slug. Falls back gracefully when the
 * entity/device registry is unavailable (older HA, the demo harness).
 */
function detectVehicle(
  hass: HomeAssistant,
  config: TeslaCardConfig
): VehicleContext {
  const entities: Record<string, any> | undefined = hass.entities;
  const devices: Record<string, any> | undefined = hass.devices;

  if (entities && devices) {
    const byDevice = new Map<string, string[]>();
    const add = (deviceId: string, entityId: string): void => {
      const list = byDevice.get(deviceId) ?? [];
      list.push(entityId);
      byDevice.set(deviceId, list);
    };

    // Primary signal: entities owned by a Tesla integration platform.
    for (const ent of Object.values(entities)) {
      if (ent?.device_id && TESLA_PLATFORMS.has(ent.platform)) {
        add(ent.device_id, ent.entity_id);
      }
    }
    // Fallback signal: any device whose manufacturer is Tesla.
    if (!byDevice.size) {
      for (const ent of Object.values(entities)) {
        const dev = ent?.device_id ? devices[ent.device_id] : undefined;
        if (dev && /tesla/i.test(dev.manufacturer ?? '')) {
          add(ent.device_id, ent.entity_id);
        }
      }
    }

    const deviceName = (id: string): string =>
      devices[id]?.name_by_user || devices[id]?.name || '';

    let deviceId: string | undefined;

    if (config.device) {
      if (devices[config.device]) {
        deviceId = config.device; // matched by device id
      } else {
        const want = slugify(config.device);
        deviceId = Object.keys(devices).find(
          (id) => slugify(deviceName(id)) === want
        );
      }
    }

    if (!deviceId && byDevice.size) {
      const ids = [...byDevice.keys()];
      const want = config.name ? slugify(config.name) : '';
      deviceId =
        (want && ids.find((id) => slugify(deviceName(id)) === want)) ||
        ids.sort(
          (a, b) => (byDevice.get(b)?.length ?? 0) - (byDevice.get(a)?.length ?? 0)
        )[0];
    }

    if (deviceId) {
      const slug = config.prefix ?? slugify(deviceName(deviceId));
      const entityIds =
        byDevice.get(deviceId) ??
        Object.values(entities)
          .filter((e: any) => e?.device_id === deviceId)
          .map((e: any) => e.entity_id);
      return { slug, entityIds };
    }
  }

  // No registry / nothing detected: best-effort slug from prefix or name.
  const slug =
    config.prefix ?? (config.name ? slugify(config.name) : REFERENCE_SLUG);
  return { slug, entityIds: [] };
}

/**
 * Build a complete entity map for every key, resolving each by stable
 * function-name where possible. Always returns a value for every key.
 */
export function resolveEntities(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): Record<EntityKey, string> {
  const resolved = {} as Record<EntityKey, string>;

  // Without hass we can only honour explicit overrides + bundled defaults.
  if (!hass) {
    for (const key of Object.keys(DEFAULT_ENTITIES) as EntityKey[]) {
      resolved[key] = config.entities?.[key] ?? DEFAULT_ENTITIES[key];
    }
    return resolved;
  }

  const { slug, entityIds } = detectVehicle(hass, config);

  // Index the vehicle's registered entities by their canonical identity.
  const byCanonical = new Map<string, string>();
  for (const id of entityIds) {
    const { domain, object } = splitEntity(id);
    const canonical = `${domain}.${stripSlug(object, slug)}`;
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, id);
  }

  const states = hass.states ?? {};

  for (const key of Object.keys(KEY_SIGNATURES) as EntityKey[]) {
    const sig = KEY_SIGNATURES[key];

    // 1) Explicit override always wins.
    const override = config.entities?.[key];
    if (override) {
      resolved[key] = override;
      continue;
    }

    // 2) Registry match within the vehicle device (handles any prefix).
    const fromRegistry = byCanonical.get(sig.canonical);
    if (fromRegistry) {
      resolved[key] = fromRegistry;
      continue;
    }

    // 3) Direct guess against live states: `${domain}.${slug}_${suffix}`.
    const guess = `${sig.domain}.${slug}_${sig.suffix}`;
    if (states[guess]) {
      resolved[key] = guess;
      continue;
    }

    // 4) Bare global entity (e.g. sensor.odometer) if it exists.
    if (states[sig.canonical]) {
      resolved[key] = sig.canonical;
      continue;
    }

    // 5) Graceful fallback: bundled default (worst case = today's behaviour).
    resolved[key] = DEFAULT_ENTITIES[key];
  }

  return resolved;
}
