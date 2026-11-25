import { describe, expect, test } from 'vitest';
import type { SessionLevels } from '@/lib/levels';
import type { Profile } from '@/lib/profile';
import { splitSessions, taipeiEpoch } from '@/lib/session';
import { isSessionWindDown, runStrategy, summarize } from '@/lib/strategy';
import type { Bar } from '@/lib/types';

// Zones: VAL 100–110, POC 140–150, VAH 190–200. Value-area height 100, so targets are 300 and 0 at ratio 1.
const profile = { vahZone: { low: 190, high: 200 }, pocZone: { low: 140, high: 150 }, valZone: { low: 100, high: 110 } } as Profile;
const open0 = taipeiEpoch('2026-11-25', 8 * 60 + 45);
/** A day session whose bars open where the previous one closed. `closes[0]` is the first bar of the session. */
const run = (closes: number[], startMinute = 0, params = { targetRatio: 1, costPoints: 4 }) => {
  const bars: Bar[] = closes.map((c, i) => ({ t: open0 + (startMinute + i * 3) * 60, o: i ? closes[i - 1] : c, h: c, l: c, c, v: 1 }));
  const sessions = splitSessions(bars, bars[bars.length - 1].t + 86_400);
  const levels: SessionLevels[] = sessions.map((session) => ({ session, profile, sourceFrom: 1, sourceTo: 1 }));
  return { bars, trades: runStrategy(bars, levels, params) };
};

describe('value-area breakout', () => {
  test('long on a close above the VAH zone, filled at the next open, out at the target', () => {
    const { trades } = run([195, 198, 205, 240, 301, 290]);
    expect(trades).toHaveLength(1);
    // 205 closes above 200 (bar 2) → buy at bar 3's open, 205. 301 reaches the 300 target (bar 4) → sell at bar 5's open, 301.
    expect(trades[0]).toMatchObject({ side: 'long', entryIndex: 3, entryPrice: 205, exitIndex: 5, exitPrice: 301, reason: 'target', gross: 96, net: 92 });
  });
  test('the stop is a close back under the bottom of the zone, not merely inside it', () => {
    const { trades } = run([195, 205, 196, 193, 189, 180]);
    // In at 205. 196 and 193 are inside the 190–200 zone: hold. 189 is below it → out at the next open, 189.
    expect(trades[0]).toMatchObject({ side: 'long', entryPrice: 205, exitPrice: 189, reason: 'stop', gross: -16, net: -20 });
  });
  test('short mirrors it', () => {
    const { trades } = run([105, 99, 60, -5, 10]);
    expect(trades[0]).toMatchObject({ side: 'short', entryPrice: 99, exitPrice: -5, reason: 'target', gross: 104 });
    const stopped = run([105, 99, 108, 111, 120]).trades;
    expect(stopped[0]).toMatchObject({ side: 'short', entryPrice: 99, exitPrice: 111, reason: 'stop', gross: -12 });
  });
  test('no entry without a fresh cross, none on the first bar, and re-entry needs a new cross', () => {
    expect(run([205, 210, 215, 220]).trades).toHaveLength(0); // already above when the session opens: bar 0 → bar 1 is not a cross from below
    const { trades } = run([195, 205, 189, 185, 195, 206, 210, 215]);
    // Stopped out once, then 195 → 206 crosses again.
    expect(trades.map((trade) => trade.entryPrice)).toEqual([205, 206]);
  });
  test('a close that is already past the target is not chased', () => {
    expect(run([195, 320, 330, 340]).trades).toHaveLength(0); // jumps from 195 straight over the 300 target
    expect(run([105, -20, -30, -40]).trades).toHaveLength(0);
    expect(run([195, 299, 305, 310]).trades).toHaveLength(1); // just short of it: taken
  });
  test('positions are closed in the last three bars and nothing new opens there', () => {
    expect(isSessionWindDown(taipeiEpoch('2026-11-25', 13 * 60 + 33))).toBe(false);
    expect(isSessionWindDown(taipeiEpoch('2026-11-25', 13 * 60 + 36))).toBe(true);
    expect(isSessionWindDown(taipeiEpoch('2026-11-26', 4 * 60 + 51))).toBe(true);
    // Session bars from 13:24: 13:24, 13:27, 13:30, 13:33, 13:36, 13:39, 13:42.
    const held = run([195, 205, 220, 230, 235, 240, 245], 279);
    expect(held.trades[0]).toMatchObject({ entryPrice: 205, exitPrice: 230, reason: 'sessionEnd' }); // out at the 13:36 open
    const late = run([195, 195, 195, 195, 205, 210, 215], 279);
    expect(late.trades).toHaveLength(0); // the cross happens at 13:36, inside the wind-down
  });
  test('summary: win rate, profit factor and drawdown after costs', () => {
    const { trades } = run([195, 205, 189, 185, 195, 206, 250, 305, 300]);
    const stats = summarize(trades);
    expect(trades.map((trade) => trade.net)).toEqual([-20, 95]);
    expect(stats).toMatchObject({ trades: 2, wins: 1, winRate: 50, net: 75, averageWin: 95, averageLoss: -20, maxDrawdown: 20 });
    expect(stats.profitFactor).toBeCloseTo(4.75, 6);
    expect(summarize([])).toMatchObject({ trades: 0, winRate: null, net: 0, maxDrawdown: 0 });
  });
});
