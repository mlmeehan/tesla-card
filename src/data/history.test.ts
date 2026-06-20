// Unit gate for the Story 8.3 recorder/history data path (data/history.ts) — THE
// one genuinely new data path in the suite. Pins its honesty as regressions:
//   • parse is NaN-safe — non-numeric / `unavailable` / unstamped samples are
//     DROPPED, never coerced to 0 (a fabricated zero would draw a fake curve);
//   • a rejected / empty / un-callWS-able fetch resolves to [] (never throws to
//     the render path → the chart degrades to its calm empty state, AC2/AC5);
//   • per-day bucketing computes the cumulative-counter daily delta correctly;
//   • the module NEVER reads `hass.states` (AR-1 boundary intact — history is
//     not hass.states).
import { describe, expect, test, vi } from 'vitest';
import {
  parseSeries,
  fetchHistory,
  bucketDailyDelta,
  fetchCardHistory,
  type HistorySeries,
} from './history';
import type { HomeAssistant } from '../types';

/** A WS sample (`s` state, `lu` last_updated epoch SECONDS). */
const S = (s: string, luSec: number) => ({ s, lu: luSec });

/** A hass whose `states` access THROWS — proves history never touches hass.states. */
function hassNoStates(callWS: HomeAssistant['callWS']): HomeAssistant {
  return {
    get states(): Record<string, never> {
      throw new Error('history must not read hass.states');
    },
    callWS,
  } as unknown as HomeAssistant;
}

describe('parseSeries — NaN-safe parse (drop, never coerce to 0)', () => {
  test('parses numeric samples to { t: lu*1000, v }', () => {
    const out = parseSeries([S('6.0', 1000), S('5.5', 1060)]);
    expect(out).toEqual([
      { t: 1_000_000, v: 6.0 },
      { t: 1_060_000, v: 5.5 },
    ]);
  });

  test('drops non-numeric / unavailable / unknown samples (never a 0 spike)', () => {
    const out = parseSeries([
      S('6.0', 1000),
      S('unavailable', 1010),
      S('unknown', 1020),
      S('not-a-number', 1030),
      S('', 1040),
      S('3.2', 1050),
    ]);
    expect(out.map((p) => p.v)).toEqual([6.0, 3.2]); // bad samples gone, NOT 0
  });

  test('drops samples without a usable timestamp', () => {
    expect(parseSeries([{ s: '6.0' }, { s: '5.0', lu: NaN }])).toEqual([]);
  });

  test('falls back to lc when lu is absent', () => {
    expect(parseSeries([{ s: '4.0', lc: 2000 }])).toEqual([{ t: 2_000_000, v: 4.0 }]);
  });

  test('empty / non-array input → []', () => {
    expect(parseSeries(undefined)).toEqual([]);
    expect(parseSeries([])).toEqual([]);
  });
});

describe('fetchHistory — one-shot callWS, calm-not-crash on failure', () => {
  const WIN = { start: 0, end: 60_000 };

  test('resolves a representative history/history_during_period payload (NaN-safe)', async () => {
    const callWS = vi.fn().mockResolvedValue({
      'sensor.x': [S('6.0', 1000), S('unavailable', 1010), S('5.0', 1020)],
    });
    const out = await fetchHistory(hassNoStates(callWS), 'sensor.x', WIN);
    expect(out).toEqual([
      { t: 1_000_000, v: 6.0 },
      { t: 1_020_000, v: 5.0 },
    ]);
    // Correct WS command + minimal/no-attributes flags.
    const msg = callWS.mock.calls[0][0];
    expect(msg.type).toBe('history/history_during_period');
    expect(msg.entity_ids).toEqual(['sensor.x']);
    expect(msg.minimal_response).toBe(true);
    expect(msg.no_attributes).toBe(true);
  });

  test('a rejected callWS → [] (no throw to the render path)', async () => {
    const callWS = vi.fn().mockRejectedValue(new Error('recorder down'));
    await expect(fetchHistory(hassNoStates(callWS), 'sensor.x', WIN)).resolves.toEqual([]);
  });

  test('an empty result → []', async () => {
    const callWS = vi.fn().mockResolvedValue({});
    await expect(fetchHistory(hassNoStates(callWS), 'sensor.x', WIN)).resolves.toEqual([]);
  });

  test('absent hass / missing id / no callWS → [] (never throws)', async () => {
    await expect(fetchHistory(undefined, 'sensor.x', WIN)).resolves.toEqual([]);
    await expect(fetchHistory(hassNoStates(vi.fn()), undefined, WIN)).resolves.toEqual([]);
    await expect(
      fetchHistory({ } as unknown as HomeAssistant, 'sensor.x', WIN)
    ).resolves.toEqual([]);
  });

  test('never reads hass.states (the states getter throws but fetch succeeds)', async () => {
    const callWS = vi.fn().mockResolvedValue({ 'sensor.x': [S('1.0', 1)] });
    await expect(fetchHistory(hassNoStates(callWS), 'sensor.x', WIN)).resolves.toEqual([
      { t: 1000, v: 1.0 },
    ]);
  });
});

describe('bucketDailyDelta — cumulative-counter daily delta', () => {
  // Use a fixed local-day anchor; compute via the same Date the module uses so the
  // test is TZ-agnostic.
  const dayStart = (offsetDays: number, nowMs: number): number => {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    return d.getTime() + offsetDays * 24 * 60 * 60_000;
  };

  test('daily value = last − first within each local day; omits empty days', () => {
    const now = new Date(2026, 5, 20, 12, 0, 0).getTime(); // local noon, deterministic
    const today0 = dayStart(0, now);
    const yest0 = dayStart(-1, now);
    const series: HistorySeries = [
      { t: yest0 + 3_600_000, v: 100 }, // yesterday 01:00 → 100
      { t: yest0 + 7_200_000, v: 112 }, // yesterday 02:00 → 112 (delta 12)
      { t: today0 + 3_600_000, v: 200 }, // today 01:00 → 200
      { t: today0 + 7_200_000, v: 205 }, // today 02:00 → 205 (delta 5)
    ];
    const buckets = bucketDailyDelta(series, 7, now);
    expect(buckets).toEqual([
      { day: yest0, value: 12 },
      { day: today0, value: 5 },
    ]);
  });

  test('a mid-day counter reset (negative delta) clamps to 0, never a negative bar', () => {
    const now = new Date(2026, 5, 20, 12, 0, 0).getTime();
    const today0 = dayStart(0, now);
    const buckets = bucketDailyDelta(
      [
        { t: today0 + 1000, v: 500 },
        { t: today0 + 2000, v: 3 }, // reset → last−first = −497 → clamp 0
      ],
      7,
      now
    );
    expect(buckets).toEqual([{ day: today0, value: 0 }]);
  });

  test('empty series / non-positive days → []', () => {
    expect(bucketDailyDelta([], 7, Date.now())).toEqual([]);
    expect(bucketDailyDelta([{ t: 1, v: 1 }], 0, Date.now())).toEqual([]);
  });
});

describe('fetchCardHistory — orchestrates today + multi-day in one call', () => {
  test('returns the today series + bucketed days for the two ids', async () => {
    const now = new Date(2026, 5, 20, 12, 0, 0).getTime();
    const today0 = new Date(now);
    today0.setHours(0, 0, 0, 0);
    const t0 = today0.getTime();
    const callWS = vi.fn().mockImplementation((msg: { entity_ids: string[] }) => {
      if (msg.entity_ids[0] === 'sensor.power') {
        return Promise.resolve({ 'sensor.power': [S('1.0', 1000), S('2.0', 1060)] });
      }
      return Promise.resolve({
        'sensor.energy': [S('10', (t0 + 1000) / 1000), S('15', (t0 + 2000) / 1000)],
      });
    });
    const res = await fetchCardHistory(
      hassNoStates(callWS),
      { today: 'sensor.power', cumulative: 'sensor.energy' },
      now
    );
    expect(res.today).toEqual([
      { t: 1_000_000, v: 1.0 },
      { t: 1_060_000, v: 2.0 },
    ]);
    expect(res.days).toEqual([{ day: t0, value: 5 }]);
    expect(callWS).toHaveBeenCalledTimes(2);
  });

  test('an absent cumulative id → empty days (today still resolves)', async () => {
    const callWS = vi.fn().mockResolvedValue({ 'sensor.power': [S('1.0', 1000)] });
    const res = await fetchCardHistory(hassNoStates(callWS), { today: 'sensor.power' }, 1_000_000);
    expect(res.days).toEqual([]);
    expect(callWS).toHaveBeenCalledTimes(1); // only the today fetch ran
  });
});
