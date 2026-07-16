import type { HomeAssistant, TeslaCardConfig } from '../types';
import { DEFAULT_ENTITIES, type EntityKey } from '../const';
import { TESLA_PLATFORMS } from './platforms';
import {
  detectDialect,
  DIALECT_ENTITY_ALIASES,
  DIALECT_ABSENT,
  type Integration,
} from './dialect';

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

/**
 * The {domain, suffix, canonical} the resolver matches `key` by. Without a
 * per-dialect alias it is the fleet signature (`KEY_SIGNATURES[key]`). With an
 * alias (a slug-free `"domain.suffix"` string from `DIALECT_ENTITY_ALIASES`) the
 * alias IS the canonical (research strings carry no device slug), and its domain
 * and suffix may both differ from fleet. [Story 14.1 AC1]
 */
function signatureFor(key: EntityKey, alias: string | undefined): KeySignature {
  if (!alias) return KEY_SIGNATURES[key];
  const { domain, object } = splitEntity(alias);
  return { domain, suffix: object, canonical: alias };
}

/**
 * Distinctive vehicle signatures (`{domain, suffix}`) for the "vehicle-shaped device"
 * score (Story 14.2 AC3a). A car scores many hits (odometer, tpms, doors, seats,
 * charge_*…); a Powerwall/solar device scores 0. Two hardening properties (code
 * review 2026-07-04):
 *   1. PREFIX-AGNOSTIC. A device's entity_ids are frozen at creation, so a device
 *      *rename* (`name_by_user`) stops matching the entity-id slug — stripping a
 *      display-name-derived prefix would silently score a renamed car ≈0 and lose it
 *      to a co-resident energy device. Instead we match the entity-id SUFFIX
 *      (`object === suffix` or `object.endsWith('_' + suffix)`), which needs no
 *      knowledge of the prefix, so a renamed car still scores.
 *   2. GENERIC suffixes a non-vehicle Tesla device commonly shares are EXCLUDED
 *      (`sensor.power` on a Powerwall/solar/wall-connector; `sensor.speed`), so the
 *      "energy device scores 0" property is guaranteed, not incidental to fixture
 *      naming. Distinctive keys (odometer, tpms, doors, seats, charge_*, …) remain.
 * This is the *fleet* signature set, but a car on an aliased dialect diverges on only
 * a few keys — the many SHARED vehicle suffixes still score, so the discriminator
 * holds without first knowing the dialect (no chicken-and-egg with `detectDialect`).
 */
const GENERIC_CANONICAL_SUFFIXES: ReadonlySet<string> = new Set(['power', 'speed']);
const VEHICLE_SIGNATURES: ReadonlyArray<{ domain: string; suffix: string }> =
  Object.values(KEY_SIGNATURES)
    .filter((s) => !GENERIC_CANONICAL_SUFFIXES.has(s.suffix))
    .map((s) => ({ domain: s.domain, suffix: s.suffix }));

interface VehicleContext {
  /** device-name slug used as the entity-id prefix, e.g. "model_y" */
  slug: string;
  /** entity ids registered to the detected vehicle device (may be empty) */
  entityIds: string[];
}

/**
 * Find the vehicle's device and its entity-id prefix slug.
 * Precedence: config.device (id or name) → config.name match → the four-tier
 * untargeted fallback (vehicle-shaped → override-platform → vehicle-signature
 * score → most entities; see the ordering comment at the sort).
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
    // Story 14.2: track which Tesla platform(s) each device owns, so an explicit
    // `config.integration` can steer the anonymous fallback onto a device of that
    // platform. Only the primary (platform-tagged) branch records a platform; a
    // manufacturer-fallback device has no `platform`, so its set stays empty
    // (override-steering correctly no-ops there — it cannot name a dialect).
    const byDevicePlatforms = new Map<string, Set<string>>();
    const add = (deviceId: string, entityId: string, platform?: string): void => {
      const list = byDevice.get(deviceId) ?? [];
      list.push(entityId);
      byDevice.set(deviceId, list);
      if (platform) {
        const set = byDevicePlatforms.get(deviceId) ?? new Set<string>();
        set.add(platform);
        byDevicePlatforms.set(deviceId, set);
      }
    };

    // Primary signal: entities owned by a Tesla integration platform.
    for (const ent of Object.values(entities)) {
      if (ent?.device_id && TESLA_PLATFORMS.has(ent.platform)) {
        add(ent.device_id, ent.entity_id, ent.platform);
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

    // (3a) Score how vehicle-shaped a candidate device is: the count of its
    // entities whose id matches a distinctive vehicle SIGNATURE by suffix. The
    // match is prefix-agnostic (`object === suffix` or ends with `_<suffix>`), so a
    // renamed device still scores; generic suffixes (`power`/`speed`) are excluded.
    // A car scores many; a Powerwall/solar device scores 0. See VEHICLE_SIGNATURES.
    const vehicleScore = (id: string): number => {
      let score = 0;
      for (const eid of byDevice.get(id) ?? []) {
        const { domain, object } = splitEntity(eid);
        if (
          VEHICLE_SIGNATURES.some(
            (sig) =>
              sig.domain === domain &&
              (object === sig.suffix || object.endsWith(`_${sig.suffix}`))
          )
        )
          score++;
      }
      return score;
    };

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
      const byName = want ? ids.find((id) => slugify(deviceName(id)) === want) : undefined;
      if (byName) {
        deviceId = byName;
      } else {
        // Untargeted fallback ordering [D-DSM-1 2026-07-15; completes the 14.2
        // override↔device AC]: (1) vehicle-shaped (score>0) DESC → (2)
        // override-platform ownership DESC → (3) vehicle-signature score DESC →
        // (4) raw most-entities (the former sole key, now the last tie-break).
        // Vehicle-shaped is the OUTER tier so a score-0 device (a Powerwall)
        // owning the override's platform never beats a car — the override steers
        // among CARS (which one the card resolves against on a mixed-platform
        // multi-car install), never onto energy hardware (the retained 14.2
        // car-beats-Powerwall guard). Without an override tier (2) is inert, and
        // a shaped disagreement is decided identically by score DESC — so
        // no-override / all-score-0 orderings are byte-identical to the 14.2
        // sort. `config.integration` naming a platform no candidate owns (3c)
        // simply no-ops the override key → the vehicle-shaped pick still wins and
        // the override's dialect still applies downstream (documented mis-config;
        // escape hatch = `config.device` + `config.entities[key]`).
        const override =
          config.integration && TESLA_PLATFORMS.has(config.integration)
            ? config.integration
            : undefined;
        const score = new Map(ids.map((id) => [id, vehicleScore(id)]));
        deviceId = ids.sort((a, b) => {
          const sa = score.get(a) ?? 0;
          const sb = score.get(b) ?? 0;
          const shaped = (sb > 0 ? 1 : 0) - (sa > 0 ? 1 : 0);
          if (shaped !== 0) return shaped;
          if (override) {
            const oa = byDevicePlatforms.get(a)?.has(override) ? 1 : 0;
            const ob = byDevicePlatforms.get(b)?.has(override) ? 1 : 0;
            if (ob !== oa) return ob - oa;
          }
          if (sb !== sa) return sb - sa;
          return (byDevice.get(b)?.length ?? 0) - (byDevice.get(a)?.length ?? 0);
        })[0];
      }
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
 * The resolver's EFFECTIVE vehicle dialect (Story 15.1 / D-DGT-2): the Story-14.2
 * vehicle-device-scoped `detectDialect` WITH the ambiguity-guard collapse applied —
 * exactly the dialect {@link resolveEntities} aliases by. Exported so the parent
 * (`tesla-card.ts` `_resolve()`) can stamp it onto the resolved config as
 * `integration:`, making every child's `adapterFor` short-circuit on the override
 * branch and consume the SAME dialect the resolver used (a naive unscoped,
 * uncollapsed `detectDialect` re-run in the parent could stamp a DIFFERENT dialect
 * than the resolver aliased by — the exact resolver-vs-component mismatch D-DGT-2
 * closes).
 *
 * Returns the collapsed `Integration`, deliberately NOT a `DialectReport`:
 * everywhere else `report.integration` means the UNcollapsed tie-break pick (with
 * `ambiguous` flagging it) — silently pre-collapsing that field would invite a
 * future consumer to misread `ambiguous: true` beside an already-collapsed value.
 *
 * `!hass` (Lovelace sets config before hass, so the parent stamp path DOES run
 * here) returns WITHOUT touching `detectVehicle` — which dereferences
 * `hass.entities` unguarded — via the empty-scope path: a valid
 * `config.integration` override still wins through `detectDialect`'s override
 * branch, and otherwise the probe finds nothing ⇒ the same effective
 * `tesla_fleet` default the resolver's `!hass` early-return implies. Both the
 * `!hass` and registry-less stamps self-correct on the next resolve once the
 * registry arrives (the parent's `_resolveCache` keys on `hass.entities` /
 * `hass.devices` reference identity). [Story 15.1 AC3a/AC3e]
 */
export function detectVehicleDialect(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig
): Integration {
  const entityIds = hass ? detectVehicle(hass, config).entityIds : [];
  return effectiveDialect(hass, config, entityIds);
}

/**
 * The ONE ambiguity-guard collapse over the scoped probe — single-sourced so the
 * parent stamp ({@link detectVehicleDialect}) and the resolver
 * ({@link resolveEntities}) can never drift [Story 15.1 AC3b]. Preserves the
 * Story-14.2 empty-vs-OMIT scope rule exactly: empty `entityIds` ⇒ the scope is
 * OMITTED (registry-wide probe), never an empty `Set` (which would force a
 * zero-count `source:'default'` on registry-less installs — the regression 14.2
 * explicitly guarded against).
 */
function effectiveDialect(
  hass: HomeAssistant | undefined,
  config: TeslaCardConfig,
  entityIds: readonly string[]
): Integration {
  const report = detectDialect(
    hass,
    config,
    entityIds.length ? new Set(entityIds) : undefined
  );
  return report.ambiguous ? 'tesla_fleet' : report.integration;
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

  // Which integration dialect this install speaks — consulted once per call for
  // the per-dialect alias/ABSENT tables. Note: this runs a `hass.entities` scan,
  // acceptable because the sole hot caller memoizes (`tesla-card.ts` `_resolveCache`
  // skips resolveEntities unless entities/devices/config change by reference). A
  // `tesla_fleet` (or bare `tesla`, or registry-less) install has no table entry,
  // so both lookups are `undefined` and every key takes the unchanged fleet path
  // → byte-identical fleet resolution (AC6). [Story 14.1 AC2]
  //
  // Story 14.2: scope the dialect probe to the RESOLVED vehicle device's entities,
  // so device and dialect agree by construction. `detectVehicle` now prefers the
  // vehicle-shaped device (a car over a higher-count Powerwall), and feeding its
  // `entityIds` as the scope means a split-platform household (a `tesla_custom` car
  // + a `tesla_fleet` Powerwall) probes to the car's single dialect — no false
  // ambiguity, the aliases apply. When `entityIds` is empty (registry-less / demo
  // harness), the scope is OMITTED so the unchanged registry-wide default path runs
  // (passing an empty Set would force a zero-count `source:'default'` on installs
  // that today probe registry-wide — AC5).
  //
  // AMBIGUITY GUARD (retained, defense-in-depth): the guard fires only when the ONE
  // resolved vehicle device carries ≥2 Tesla platforms simultaneously — after
  // scoping, a split-*device* household no longer trips it. In real Home Assistant a
  // `device_id` is owned by a single config entry, so a same-device two-platform
  // install is essentially production-unreachable; the guard is kept as cheap
  // insurance (and is the only thing the AC4 fixture exercises), not active
  // protection. When it does fire we fall to the un-aliased `tesla_fleet` path rather
  // than alias with a maybe-wrong dialect. An explicit `config.integration` still
  // short-circuits to `source:'override'`, so a user can force a dialect regardless.
  // [Story 14.2 AC1/AC4; supersedes the Story 14.1 registry-wide guard]
  //
  // Story 15.1: the scoped probe + collapse live in `effectiveDialect` (single-
  // sourced) so the parent's `detectVehicleDialect` stamp can never disagree with
  // the dialect this loop aliases by.
  const integration = effectiveDialect(hass, config, entityIds);
  const aliases = DIALECT_ENTITY_ALIASES[integration];
  const absent = DIALECT_ABSENT[integration];

  // Index the vehicle's registered entities by their canonical identity.
  const byCanonical = new Map<string, string>();
  for (const id of entityIds) {
    const { domain, object } = splitEntity(id);
    const canonical = `${domain}.${stripSlug(object, slug)}`;
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, id);
  }

  const states = hass.states ?? {};

  for (const key of Object.keys(KEY_SIGNATURES) as EntityKey[]) {
    // 1) Explicit override always wins (over aliases AND ABSENT).
    const override = config.entities?.[key];
    if (override) {
      resolved[key] = override;
      continue;
    }

    // 2) Honest degrade: a key this dialect does not expose resolves to the
    //    empty-string sentinel — never a fleet-default ghost. `''` survives the
    //    `?? DEFAULT` in helpers (empty string is not nullish) and reads as
    //    unavailable (`hass.states['']` is undefined). [Story 14.1 AC4]
    if (absent?.has(key)) {
      resolved[key] = '';
      continue;
    }

    // Effective signature: the per-dialect alias when present, else the fleet
    // canonical. An aliased key matches by the alias's own domain.suffix.
    const alias = aliases?.[key];
    const sig = signatureFor(key, alias);
    const guess = `${sig.domain}.${slug}_${sig.suffix}`;

    // 3) Registry match within the vehicle device (handles any prefix).
    const fromRegistry = byCanonical.get(sig.canonical);
    if (fromRegistry) {
      resolved[key] = fromRegistry;
      continue;
    }

    // 4) Direct guess against live states: `${domain}.${slug}_${suffix}`.
    if (states[guess]) {
      resolved[key] = guess;
      continue;
    }

    // 5) Bare global entity (e.g. sensor.odometer) if it exists — FLEET keys only.
    //    Skipped for an aliased key: a bare `sensor.battery` could bind an
    //    unrelated global device (a phone/Zigbee battery), a live-wrong resolve
    //    worse than an unavailable ghost — the mis-resolve AC4 forbids. Dialect
    //    entities are always device-scoped/slug-prefixed anyway.
    if (!alias && states[sig.canonical]) {
      resolved[key] = sig.canonical;
      continue;
    }

    // 6) Graceful fallback: an aliased key falls to its dialect-correct
    //    slug-prefixed guess (an unverified best-guess, exactly as the fleet
    //    default is); a fleet key falls to the bundled default (= today's behaviour).
    resolved[key] = alias ? guess : DEFAULT_ENTITIES[key];
  }

  return resolved;
}
