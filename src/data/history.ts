import type { HomeAssistant } from '../types';
import { UNAVAILABLE_STATES } from '../helpers';
import { log } from '../log';

/**
 * D? — On-demand recorder/history reads (Story 8.3, FR-36 / UX-DR25).
 *
 * THE one genuinely new data path in the whole suite: a one-shot fetch of HA
 * recorder history over `hass.callWS` (`history/history_during_period`). It is
 * deliberately isolated in `data/` because that is the data-access layer — the
 * card's inline charts (`components/chart.ts`) are the only consumers, so the
 * direction stays `data/ ← flow/ ← components/` (acyclic; `no-cycle`).
 *
 * Why `callWS` is allowed (and `hass.states` is NOT what this reads):
 *   • `hass.callWS` rides HA's OWN authenticated WebSocket (card → HA →
 *     recorder); the card opens no socket of its own → `no-network-egress`
 *     SANCTIONS it (never flagged).
 *   • History is NOT `hass.states` — so the AR-1 freshness boundary is intact and
 *     `no-bare-hass.states` is unaffected (this module never touches
 *     `hass.states`).
 *
 * Honesty discipline (AC2/AC5 — the chart analogue of "never a false closed"):
 * every numeric read is NaN-safe and a non-numeric / `unavailable` sample is
 * DROPPED, never coerced to `0` (a fabricated zero would draw a fake curve). A
 * rejected or empty fetch resolves to an EMPTY series — never a throw to the
 * render path — so the chart degrades to its calm empty state. This module logs
 * at most one `log.warn` on failure and imports nothing upward (`lit`/`flow/`/
 * `components/`): leaf `data/` module (imports `types`, `helpers`, `log` only).
 *
 * One-shot, not polling (UX-DR23): callers fetch once per resolved charted
 * entity-id and cache the result; this module spawns no interval/subscription.
 */

/** A single parsed history sample: epoch-ms timestamp + finite numeric value. */
export interface HistorySample {
  /** Epoch milliseconds (from the sample's `last_updated`). */
  t: number;
  /** Finite numeric value (non-numeric/`unavailable` samples are dropped, never `0`). */
  v: number;
}

/** A parsed, NaN-safe numeric history series, oldest → newest. */
export type HistorySeries = HistorySample[];

/** A per-local-day aggregate bucket (multi-day bars). `day` = local-midnight epoch ms. */
export interface DayBucket {
  day: number;
  value: number;
}

/** Time window for a history fetch (epoch ms). */
export interface HistoryWindow {
  start: number;
  end: number;
}

/** Combined per-card history payload: a today series + multi-day buckets. */
export interface CardHistory {
  today: HistorySeries;
  days: DayBucket[];
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * The HA `history/history_during_period` compressed sample shape. With
 * `minimal_response: true` + `no_attributes: true`, each sample carries `s`
 * (state string) and `lu` (last_updated, epoch SECONDS as a float); `lc`
 * (last_changed) appears when it differs. We read `lu ?? lc`.
 */
interface WsSample {
  s?: string;
  lu?: number;
  lc?: number;
}

/**
 * Fetch + parse a single entity's recorder history over `hass.callWS`. Returns a
 * NaN-safe {@link HistorySeries} (oldest→newest), dropping non-numeric /
 * `unavailable` samples. NEVER throws: an absent `hass`, a missing id, a rejected
 * call, or an empty result all resolve to `[]` (the chart's calm empty state).
 */
export async function fetchHistory(
  hass: HomeAssistant | undefined,
  entityId: string | undefined,
  win: HistoryWindow
): Promise<HistorySeries> {
  if (!hass || !entityId || typeof hass.callWS !== 'function') return [];
  try {
    const res = await hass.callWS<Record<string, WsSample[]>>({
      type: 'history/history_during_period',
      start_time: new Date(win.start).toISOString(),
      end_time: new Date(win.end).toISOString(),
      entity_ids: [entityId],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    return parseSeries(res?.[entityId]);
  } catch {
    // Calm, not a crash (AC2/AC5): a failed fetch is "no data", never a fake
    // curve. One quiet warning, routed through log.ts (never `console.*`).
    log.warn('history fetch failed for', entityId);
    return [];
  }
}

/**
 * Parse a raw WS sample array into a NaN-safe {@link HistorySeries}. Non-numeric
 * states, `unavailable`/`unknown`/`none`/`''`, and samples without a usable
 * timestamp are dropped (never coerced to `0`). Exported for direct unit testing.
 */
export function parseSeries(raw: WsSample[] | undefined): HistorySeries {
  if (!Array.isArray(raw)) return [];
  const out: HistorySeries = [];
  for (const sample of raw) {
    const s = sample?.s;
    if (typeof s !== 'string' || UNAVAILABLE_STATES.includes(s)) continue;
    const v = Number(s);
    if (!Number.isFinite(v)) continue; // drop, never render a bad sample as a spike-to-zero
    const luSec = sample.lu ?? sample.lc;
    if (typeof luSec !== 'number' || !Number.isFinite(luSec)) continue;
    out.push({ t: luSec * 1000, v });
  }
  return out;
}

/** Local-midnight epoch ms for the day containing `ms`. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bucket a series into per-LOCAL-day aggregates over the last `days` days ending
 * at `nowMs`. For a cumulative counter (the kWh energy totals), the daily value
 * is `last − first` within the day (the day's delta); a single-sample day yields
 * `0`. Days with no samples are OMITTED (honest gap, never a fabricated zero bar)
 * — so the returned set may be shorter than `days` when history is sparse; an
 * absent day is dropped, not back-filled with a fake zero (AC2). Returns
 * oldest→newest. Pure + unit-testable.
 */
export function bucketDailyDelta(series: HistorySeries, days: number, nowMs: number): DayBucket[] {
  if (!series.length || days <= 0) return [];
  const firstDay = startOfLocalDay(nowMs - (days - 1) * DAY_MS);
  // Group samples by their local-day key.
  const byDay = new Map<number, number[]>();
  for (const s of series) {
    const key = startOfLocalDay(s.t);
    if (key < firstDay) continue;
    const arr = byDay.get(key);
    if (arr) arr.push(s.v);
    else byDay.set(key, [s.v]);
  }
  const out: DayBucket[] = [];
  for (let i = 0; i < days; i++) {
    const day = firstDay + i * DAY_MS;
    const vals = byDay.get(day);
    if (!vals || !vals.length) continue; // omit empty days (no fabricated zero)
    // Cumulative counter → daily delta. Clamp negatives (a counter reset mid-day
    // would yield a spurious negative) to 0 — an honest "no measured gain".
    const delta = vals[vals.length - 1] - vals[0];
    out.push({ day, value: delta > 0 ? delta : 0 });
  }
  return out;
}

/**
 * Orchestrate a card's two chart fetches in one call: the `today` instantaneous
 * series (last ~24h) and the `cumulative` counter bucketed into `dayCount`
 * per-day deltas. Either id may be absent (that chart resolves empty). `nowMs`
 * MUST come from `referenceNow(hass)` (HA's own time base), never `Date.now()` —
 * the phantom-staleness rule extends to the chart's "today" window.
 */
export async function fetchCardHistory(
  hass: HomeAssistant | undefined,
  ids: { today?: string; cumulative?: string },
  nowMs: number,
  dayCount = 7
): Promise<CardHistory> {
  const todayWin: HistoryWindow = { start: nowMs - DAY_MS, end: nowMs };
  const daysWin: HistoryWindow = {
    start: startOfLocalDay(nowMs - (dayCount - 1) * DAY_MS),
    end: nowMs,
  };
  const [today, cumulative] = await Promise.all([
    fetchHistory(hass, ids.today, todayWin),
    fetchHistory(hass, ids.cumulative, daysWin),
  ]);
  return { today, days: bucketDailyDelta(cumulative, dayCount, nowMs) };
}
