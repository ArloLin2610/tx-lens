// Value-area breakout, long and short, on 3-minute bars.
//
// Each session trades against the zones built for it (see levels.ts):
//   long   a bar closes above the top of the VAH zone, the bar before closed at or below it
//   short  a bar closes below the bottom of the VAL zone, the bar before closed at or above it
//   stop   long: a close back under the bottom of the VAH zone; short: a close back over the top of the VAL zone
//   target long: VAH zone top + value-area height × ratio; short: VAL zone bottom − the same distance
//          (no entry if the signal bar has already closed beyond the target)
// A signal is read on a finished bar and filled at the next bar's open. Nothing is carried across
// sessions: from the third-last bar of a session on, positions are closed and no new ones opened.
import type { SessionLevels } from './levels';
import { taipeiClock } from './session';
import type { Bar } from './types';

export interface StrategyParams {
  /** Profit target as a multiple of the value-area height. */
  targetRatio: number;
  /** Round-trip cost in index points (commission, tax and slippage). */
  costPoints: number;
}

export type ExitReason = 'stop' | 'target' | 'sessionEnd';
export interface Trade {
  side: 'long' | 'short';
  sessionKey: number;
  entryIndex: number; entryTime: number; entryPrice: number;
  exitIndex: number; exitTime: number; exitPrice: number;
  reason: ExitReason;
  /** Points gained before costs. */
  gross: number;
  /** Points gained after costs. */
  net: number;
}

export interface TradeStats {
  trades: number; wins: number; winRate: number | null;
  net: number; gross: number; averageWin: number | null; averageLoss: number | null;
  profitFactor: number | null; maxDrawdown: number; best: number | null; worst: number | null;
}

/** True from the third-last bar of a session on (13:36 in the day session, 04:51 at night). */
export const isSessionWindDown = (t: number): boolean => {
  const { minute } = taipeiClock(t);
  return (minute >= 13 * 60 + 36 && minute <= 13 * 60 + 45) || (minute >= 4 * 60 + 51 && minute <= 5 * 60);
};

interface OpenPosition { side: 'long' | 'short'; index: number; price: number }

export function runStrategy(bars: Bar[], levels: SessionLevels[], params: StrategyParams): Trade[] {
  const trades: Trade[] = [];
  for (const { session, profile } of levels) {
    if (!profile || !(profile.vahZone.high > profile.valZone.low)) continue;
    const vahTop = profile.vahZone.high, vahBottom = profile.vahZone.low, valTop = profile.valZone.high, valBottom = profile.valZone.low;
    const height = vahTop - valBottom;
    const longTarget = vahTop + height * params.targetRatio, shortTarget = valBottom - height * params.targetRatio;
    let open: OpenPosition | null = null;
    const closeAt = (position: OpenPosition, index: number, price: number, reason: ExitReason): null => {
      const gross = position.side === 'long' ? price - position.price : position.price - price;
      trades.push({ side: position.side, sessionKey: session.key, entryIndex: position.index, entryTime: bars[position.index].t, entryPrice: position.price, exitIndex: index, exitTime: bars[index].t, exitPrice: price, reason, gross, net: gross - params.costPoints });
      return null;
    };
    // The first bar of a session only observes. From the second bar on, act on the bar that just closed.
    for (let i = session.from + 1; i <= session.to; i += 1) {
      const bar = bars[i], signal = bars[i - 1].c, before = bars[i - 2]?.c;
      if (isSessionWindDown(bar.t)) { if (open) open = closeAt(open, i, bar.o, 'sessionEnd'); continue; }
      if (open) {
        if (open.side === 'long') {
          if (signal < vahBottom) open = closeAt(open, i, bar.o, 'stop'); else if (signal >= longTarget) open = closeAt(open, i, bar.o, 'target');
        } else if (signal > valTop) open = closeAt(open, i, bar.o, 'stop'); else if (signal <= shortTarget) open = closeAt(open, i, bar.o, 'target');
        continue;
      }
      if (before == null) continue;
      // A close that has already run past the target (a gap, or zones squeezed flat by a locked limit) is not chased.
      if (signal > vahTop && before <= vahTop && signal < longTarget) open = { side: 'long', index: i, price: bar.o };
      else if (signal < valBottom && before >= valBottom && signal > shortTarget) open = { side: 'short', index: i, price: bar.o };
    }
    // The session closed early (or has no wind-down bars) with a position still open: mark it at the last close.
    if (open && session.complete) open = closeAt(open, session.to, bars[session.to].c, 'sessionEnd');
  }
  return trades;
}

export function summarize(trades: Trade[]): TradeStats {
  const wins = trades.filter((trade) => trade.net > 0), losses = trades.filter((trade) => trade.net <= 0);
  const sum = (list: Trade[], pick: (trade: Trade) => number) => list.reduce((total, trade) => total + pick(trade), 0);
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const trade of trades) { equity += trade.net; if (equity > peak) peak = equity; if (peak - equity > maxDrawdown) maxDrawdown = peak - equity; }
  const winTotal = sum(wins, (trade) => trade.net), lossTotal = -sum(losses, (trade) => trade.net);
  return {
    trades: trades.length, wins: wins.length, winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    net: sum(trades, (trade) => trade.net), gross: sum(trades, (trade) => trade.gross),
    averageWin: wins.length ? winTotal / wins.length : null, averageLoss: losses.length ? -lossTotal / losses.length : null,
    profitFactor: lossTotal > 0 ? winTotal / lossTotal : null, maxDrawdown,
    best: trades.length ? Math.max(...trades.map((trade) => trade.net)) : null, worst: trades.length ? Math.min(...trades.map((trade) => trade.net)) : null,
  };
}
