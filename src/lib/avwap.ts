// Anchored VWAP for single stocks on daily candles, with the anchor picked automatically.
// Two cost series are offered:
//   typical  (high + low + close) / 3, the textbook anchored VWAP
//   vah      the source strategy's per-day "VAH": with only one bar per day its volume profile collapses to the
//            bin that holds the close, so this is the top edge of that bin (close rounded up to a bin edge)
export interface Candle { date: string; o: number; h: number; l: number; c: number; v: number }
export type AnchorMode = 'high' | 'low' | 'volume' | 'manual';

/** Taiwan stock tick size by price, as coded in the source strategy. */
export const tickSize = (price: number): number => (price < 10 ? 0.01 : price < 50 ? 0.05 : price < 100 ? 0.1 : price < 500 ? 0.5 : price < 1000 ? 1 : 5);

/** The source strategy's daily VAH: the top of the price bin that contains the close. */
export function dailyVah(candle: Candle): number {
  const { h: high, l: low, c: close } = candle;
  if (!(high > low)) return close;
  let count = Math.ceil((high - low) / (tickSize(low) * 5)) + 1;
  if (count < 1) count = 1;
  if (count > 100) count = 100;
  const step = (high - low) / count;
  let bin = Math.floor((close - low) / step);
  if (bin > count - 1) bin = count - 1;
  if (bin < 0) bin = 0;
  return low + step * (bin + 1);
}

/** Index of the anchor candle as seen from the last candle. `lookback` counts candles including the last. */
export function findAnchor(candles: Candle[], mode: AnchorMode, lookback: number, manualDate?: string): number | null {
  if (!candles.length) return null;
  if (mode === 'manual') {
    if (!manualDate) return null;
    const index = candles.findIndex((candle) => candle.date >= manualDate);
    return index < 0 ? null : index;
  }
  const last = candles.length - 1, first = Math.max(0, last - Math.max(1, lookback) + 1);
  let anchor = last;
  // Scan from the newest candle back, so equal values keep the more recent one.
  for (let i = last - 1; i >= first; i -= 1) {
    if (mode === 'high' ? candles[i].h > candles[anchor].h : mode === 'low' ? candles[i].l < candles[anchor].l : candles[i].v > candles[anchor].v) anchor = i;
  }
  return anchor;
}

export interface AvwapPoint { date: string; typical: number | null; vah: number | null }

/** Both anchored VWAP series from the anchor candle on; null before it. */
export function anchoredVwap(candles: Candle[], anchor: number | null): AvwapPoint[] {
  let volume = 0, typicalSum = 0, vahSum = 0;
  return candles.map((candle, index) => {
    if (anchor == null || index < anchor) return { date: candle.date, typical: null, vah: null };
    if (candle.v > 0) {
      volume += candle.v;
      typicalSum += ((candle.h + candle.l + candle.c) / 3) * candle.v;
      vahSum += dailyVah(candle) * candle.v;
    }
    return { date: candle.date, typical: volume ? typicalSum / volume : null, vah: volume ? vahSum / volume : null };
  });
}
