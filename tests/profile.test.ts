import { describe, expect, test } from 'vitest';
import { buildProfile } from '@/lib/profile';
import type { Bar } from '@/lib/types';

const bar = (c: number, v: number, h = c, l = c): Bar => ({ t: 0, o: c, h, l, c, v });

/** The source XScript, transcribed with its own 1-based arrays, to check the port against. */
function original(bars: Bar[], pct: number) {
  let hPrice = -999999, lPrice = 999999;
  for (const b of bars) { if (b.h > hPrice) hPrice = b.h; if (b.l < lPrice) lPrice = b.l; }
  let dynamicPeriod = Math.ceil((hPrice - lPrice) / 50) + 1;
  if (dynamicPeriod < 1) dynamicPeriod = 1;
  const binVol = new Array<number>(dynamicPeriod + 1).fill(0);
  const priceStep = (hPrice - lPrice) / dynamicPeriod;
  for (const item of bars) {
    let b = priceStep > 0 ? Math.floor((item.c - lPrice) / priceStep) + 1 : 1;
    if (b > dynamicPeriod) b = dynamicPeriod;
    if (b < 1) b = 1;
    binVol[b] += item.v;
  }
  let maxVol = 0, maxIndex = 1, totalVol = 0;
  for (let i = 1; i <= dynamicPeriod; i += 1) { totalVol += binVol[i]; if (binVol[i] > maxVol) { maxVol = binVol[i]; maxIndex = i; } }
  const targetVol = totalVol * pct;
  let upperIdx = maxIndex, lowerIdx = maxIndex, accumVol = binVol[maxIndex];
  while (accumVol < targetVol && (upperIdx < dynamicPeriod || lowerIdx > 1)) {
    if (upperIdx < dynamicPeriod && lowerIdx > 1) {
      if (binVol[upperIdx + 1] >= binVol[lowerIdx - 1]) { upperIdx += 1; accumVol += binVol[upperIdx]; } else { lowerIdx -= 1; accumVol += binVol[lowerIdx]; }
    } else if (upperIdx < dynamicPeriod) { upperIdx += 1; accumVol += binVol[upperIdx]; } else if (lowerIdx > 1) { lowerIdx -= 1; accumVol += binVol[lowerIdx]; }
  }
  return { poc: lPrice + priceStep * (maxIndex - 0.5), vah: lPrice + priceStep * upperIdx, val: lPrice + priceStep * (lowerIdx - 1) };
}

describe('buildProfile', () => {
  test('a hand-worked profile', () => {
    // Range 20000–20200: ceil(200 / 50) + 1 = 5 bins of 40 points.
    const bars = [bar(20010, 10, 20200, 20000), bar(20050, 30), bar(20090, 50), bar(20100, 40), bar(20130, 20), bar(20190, 5)];
    const profile = buildProfile(bars, { pct: 0.5, binSize: 50 })!;
    expect(profile.bins).toEqual([10, 30, 90, 20, 5]); // 20090 and 20100 share the 20080–20120 bin
    expect(profile.step).toBe(40);
    expect(profile.pocIndex).toBe(2);
    expect(profile.poc).toBe(20100);
    // 90 of 155 already exceeds half the volume, so the value area is the POC bin alone.
    expect(profile.vah).toBe(20120);
    expect(profile.val).toBe(20080);
    expect(profile.pocZone).toEqual({ low: 20080, high: 20120 });
    expect(profile.vahZone).toEqual(profile.pocZone);
    const wide = buildProfile(bars, { pct: 0.8, binSize: 50 })!;
    // Needs 124: 90 → +30 (lower neighbour 30 beats upper 20) = 120 → +20 (upper 20 beats lower 10) = 140.
    expect([wide.lowerIndex, wide.upperIndex]).toEqual([1, 3]);
    expect(wide.valZone).toEqual({ low: 20040, high: 20080 });
    expect(wide.vahZone).toEqual({ low: 20120, high: 20160 });
    expect(wide.vah).toBe(20160);
    expect(wide.val).toBe(20040);
  });
  test('ties: the lowest bin wins the POC, the upper neighbour wins the expansion', () => {
    const bars = [bar(100, 10, 250, 100), bar(160, 10), bar(220, 10)]; // range 150 → 4 bins of 37.5; closes fall in bins 0, 1, 3
    const profile = buildProfile(bars, { pct: 0.6, binSize: 50 })!;
    expect(profile.bins).toEqual([10, 10, 0, 10]);
    expect(profile.pocIndex).toBe(0);
    expect([profile.lowerIndex, profile.upperIndex]).toEqual([0, 1]);
  });
  test('a close at the very top lands in the last bin, and a single price gives flat zones', () => {
    const top = buildProfile([bar(100, 1, 200, 100), bar(200, 9)], { pct: 0.5, binSize: 50 })!;
    expect(top.pocIndex).toBe(top.bins.length - 1);
    const flat = buildProfile([bar(500, 3), bar(500, 4)], { pct: 0.5, binSize: 50 })!;
    expect(flat.step).toBe(0);
    expect(flat.vahZone).toEqual({ low: 500, high: 500 });
    expect(flat.poc).toBe(500);
    expect(buildProfile([], { pct: 0.5, binSize: 50 })).toBeNull();
    expect(buildProfile([bar(500, 0)], { pct: 0.5, binSize: 50 })).toBeNull();
  });
  test('matches the source script on random sessions', () => {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let run = 0; run < 300; run += 1) {
      let price = 20000 + Math.floor(random() * 5000);
      const bars: Bar[] = Array.from({ length: 20 + Math.floor(random() * 280) }, () => {
        const open = price; price += Math.round((random() - 0.5) * 60);
        return { t: 0, o: open, h: Math.max(open, price) + Math.floor(random() * 15), l: Math.min(open, price) - Math.floor(random() * 15), c: price, v: 1 + Math.floor(random() * 900) };
      });
      const pct = [0.5, 0.618, 0.7][run % 3];
      const ours = buildProfile(bars, { pct, binSize: 50 })!, theirs = original(bars, pct);
      expect(ours.poc).toBeCloseTo(theirs.poc, 6);
      expect(ours.vah).toBeCloseTo(theirs.vah, 6);
      expect(ours.val).toBeCloseTo(theirs.val, 6);
      expect(ours.vahZone.high).toBeCloseTo(theirs.vah, 6);
      expect(ours.valZone.low).toBeCloseTo(theirs.val, 6);
      expect(ours.pocZone.low).toBeLessThan(ours.poc);
      expect(ours.pocZone.high).toBeGreaterThan(ours.poc);
    }
  });
});
