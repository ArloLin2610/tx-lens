// Volume profile and value area, ported line for line from the source strategies:
// - price bins: count = ceil(range / binPoints) + 1, width = range / count
// - each bar's whole volume goes into the bin that holds its close
// - POC is the fullest bin (the lowest one on a tie)
// - the value area grows from the POC one bin at a time, taking the fuller neighbour
//   (the upper one on a tie), until it holds `pct` of the volume
// POC, VAH and VAL are bins, so each is reported as a zone with a top and a bottom.
import type { Bar } from './types';

export interface Zone { low: number; high: number }
export interface Profile {
  low: number;
  high: number;
  /** Bin width in points (0 when every bar closed at one price). */
  step: number;
  /** Volume per bin, lowest price first. */
  bins: number[];
  pocIndex: number;
  upperIndex: number;
  lowerIndex: number;
  /** The three lines of the original indicator: POC mid-bin, VAH top of the value area, VAL its bottom. */
  poc: number;
  vah: number;
  val: number;
  /** The same three levels as zones: one bin each. */
  vahZone: Zone;
  pocZone: Zone;
  valZone: Zone;
  totalVolume: number;
  barCount: number;
}

export interface ProfileOptions {
  /** Share of volume inside the value area, 0–1. */
  pct: number;
  /** Target bin height in price units (50 points for the futures strategies). */
  binSize: number;
  /** Upper limit on the number of bins (the stock version caps it at 100). */
  maxBins?: number;
}

export function buildProfile(bars: Bar[], { pct, binSize, maxBins }: ProfileOptions): Profile | null {
  if (!bars.length) return null;
  let high = -Infinity, low = Infinity;
  for (const bar of bars) { if (bar.h > high) high = bar.h; if (bar.l < low) low = bar.l; }
  let count = 1, step = 0;
  if (high > low) {
    count = Math.max(1, Math.ceil((high - low) / binSize) + 1);
    if (maxBins && count > maxBins) count = maxBins;
    step = (high - low) / count;
  }
  const bins = new Array<number>(count).fill(0);
  for (const bar of bars) {
    let b = step > 0 ? Math.floor((bar.c - low) / step) : 0;
    if (b > count - 1) b = count - 1;
    if (b < 0) b = 0;
    bins[b] += bar.v;
  }
  let pocIndex = 0, maxVolume = 0, totalVolume = 0;
  bins.forEach((volume, index) => { totalVolume += volume; if (volume > maxVolume) { maxVolume = volume; pocIndex = index; } });
  if (!(totalVolume > 0)) return null;

  const target = totalVolume * pct;
  let upperIndex = pocIndex, lowerIndex = pocIndex, accumulated = bins[pocIndex];
  while (accumulated < target && (upperIndex < count - 1 || lowerIndex > 0)) {
    if (upperIndex < count - 1 && lowerIndex > 0) {
      if (bins[upperIndex + 1] >= bins[lowerIndex - 1]) { upperIndex += 1; accumulated += bins[upperIndex]; }
      else { lowerIndex -= 1; accumulated += bins[lowerIndex]; }
    } else if (upperIndex < count - 1) { upperIndex += 1; accumulated += bins[upperIndex]; }
    else { lowerIndex -= 1; accumulated += bins[lowerIndex]; }
  }
  const edge = (index: number) => low + step * index; // bottom edge of bin `index`
  const zone = (index: number): Zone => ({ low: edge(index), high: edge(index + 1) });
  return {
    low, high, step, bins, pocIndex, upperIndex, lowerIndex,
    poc: low + step * (pocIndex + 0.5), vah: edge(upperIndex + 1), val: edge(lowerIndex),
    vahZone: zone(upperIndex), pocZone: zone(pocIndex), valZone: zone(lowerIndex),
    totalVolume, barCount: bars.length,
  };
}
