// Turns per-minute (or per-trade) prints into the 3-minute bars the strategies use.
import type { Bar } from '../../src/lib/types';
import { sessionOf, taipeiClock } from '../../src/lib/session';

const TAIPEI_OFFSET = 8 * 3600;

/**
 * Start of the 3-minute bar a print belongs to, or null outside both sessions.
 * The closing prints at exactly 13:45:00 and 05:00:00 belong to the last bar of
 * their session (13:42 and 04:57), as on a charting package.
 */
export function barStart(epochSeconds: number): number | null {
  const { day, minute } = taipeiClock(epochSeconds);
  const second = epochSeconds - (day * 86_400 - TAIPEI_OFFSET) - minute * 60;
  let slot = minute;
  if (second === 0 && (minute === 13 * 60 + 45 || minute === 5 * 60)) slot = minute - 1;
  slot = Math.floor(slot / 3) * 3;
  const start = day * 86_400 - TAIPEI_OFFSET + slot * 60;
  return sessionOf(start) ? start : null;
}

export class BarBuilder {
  private readonly map = new Map<number, Bar>();
  /** Add a print (a trade, or a finer bar given as open/high/low/close). Prints must arrive in time order. */
  add(epochSeconds: number, open: number, high: number, low: number, close: number, volume: number): void {
    const start = barStart(epochSeconds);
    if (start == null) return;
    const bar = this.map.get(start);
    if (!bar) { this.map.set(start, { t: start, o: open, h: high, l: low, c: close, v: volume }); return; }
    if (high > bar.h) bar.h = high;
    if (low < bar.l) bar.l = low;
    bar.c = close;
    bar.v += volume;
  }
  bars(): Bar[] { return [...this.map.values()].sort((a, b) => a.t - b.t); }
}
