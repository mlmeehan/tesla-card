/**
 * Integration platforms whose entities identify a Tesla vehicle device.
 *
 * This is the single source of truth for the Tesla-platform set, consumed by
 * `resolve.ts` (`detectVehicle`) and `dialect.ts` (`detectDialect`/`isIntegration`).
 * It lives in its own leaf module — importing nothing internal — so that
 * `resolve.ts → dialect.ts` and `dialect.ts → platforms.ts` can both hold without
 * forming an import cycle (Story 14.1: the resolver now consults the dialect alias
 * tables, so `resolve.ts` value-imports `dialect.ts`; keeping this constant here
 * removes the old `dialect.ts → resolve.ts` value edge that would otherwise cycle).
 */
export const TESLA_PLATFORMS = new Set([
  'tesla_fleet',
  'teslemetry',
  'tessie',
  'tesla_custom',
  'tesla',
]);
