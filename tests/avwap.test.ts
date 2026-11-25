import { describe, expect, test } from 'vitest';
import { anchoredVwap, dailyVah, findAnchor, tickSize, type Candle } from '@/lib/avwap';

const candle = (date: string, h: number, l: number, c: number, v: number): Candle => ({ date, o: c, h, l, c, v });
const candles = [candle('2026-01-05', 100, 96, 98, 1000), candle('2026-01-06', 110, 99, 109, 3000), candle('2026-01-07', 108, 101, 102, 2000), candle('2026-01-08', 105, 95, 104, 500), candle('2026-01-09', 110, 103, 106, 1500)];

describe('anchored VWAP', () => {
  test('tick sizes and the per-day VAH of the source strategy', () => {
    expect([9, 20, 60, 200, 800, 2000].map(tickSize)).toEqual([0.01, 0.05, 0.1, 0.5, 1, 5]);
    // High 110, low 99: tick 0.1 → bins of 0.5 → ceil(11 / 0.5) + 1 = 23 bins of 11/23. The close 109 sits in bin 20 (0-based), whose top is 99 + 21 × 11/23.
    expect(dailyVah(candles[1])).toBeCloseTo(99 + (21 * 11) / 23, 9);
    expect(dailyVah(candle('x', 50, 50, 50, 10))).toBe(50); // a locked limit day has no range
    expect(dailyVah(candles[1])).toBeGreaterThanOrEqual(candles[1].c);
  });
  test('automatic anchors look back a set number of candles and prefer the more recent on a tie', () => {
    expect(findAnchor(candles, 'high', 120)).toBe(4); // 110 twice (01-06 and 01-09): the newer one
    expect(findAnchor(candles, 'high', 4)).toBe(4);
    expect(findAnchor(candles.slice(0, 4), 'high', 120)).toBe(1);
    expect(findAnchor(candles, 'low', 120)).toBe(3);
    expect(findAnchor(candles, 'low', 1)).toBe(4); // only the last candle is in range
    expect(findAnchor(candles, 'volume', 120)).toBe(1);
    expect(findAnchor(candles, 'manual', 120, '2026-01-07')).toBe(2);
    expect(findAnchor(candles, 'manual', 120, '2026-01-10')).toBeNull();
    expect(findAnchor([], 'high', 120)).toBeNull();
  });
  test('volume-weighted from the anchor on, nothing before it', () => {
    const line = anchoredVwap(candles, 2);
    expect(line.slice(0, 2).every((point) => point.typical === null && point.vah === null)).toBe(true);
    const tp = (c: Candle) => (c.h + c.l + c.c) / 3;
    expect(line[2].typical).toBeCloseTo(tp(candles[2]), 9);
    expect(line[4].typical).toBeCloseTo((tp(candles[2]) * 2000 + tp(candles[3]) * 500 + tp(candles[4]) * 1500) / 4000, 9);
    expect(line[4].vah).toBeCloseTo((dailyVah(candles[2]) * 2000 + dailyVah(candles[3]) * 500 + dailyVah(candles[4]) * 1500) / 4000, 9);
    expect(anchoredVwap(candles, null).every((point) => point.typical === null)).toBe(true);
  });
});
