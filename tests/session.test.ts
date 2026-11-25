import { describe, expect, test } from 'vitest';
import { weeklyRange, previousSessionLevels, weeklyLevels } from '@/lib/levels';
import { isoToDay, nextSessionKey, sessionCloseTime, sessionOf, splitSessions, taipeiEpoch, weekdayOfKey } from '@/lib/session';
import type { Bar } from '@/lib/types';
import { barStart } from '../scripts/pipeline/bars';

const at = (iso: string, hhmm: string) => taipeiEpoch(iso, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
const key = (iso: string, type: 1 | 2) => isoToDay(iso) * 10 + type;
const bar = (t: number, c = 100, v = 10): Bar => ({ t, o: c, h: c + 5, l: c - 5, c, v });

describe('sessions', () => {
  test('day, night and the hours between', () => {
    expect(sessionOf(at('2026-11-25', '08:45'))).toMatchObject({ type: 'day', key: key('2026-11-25', 1) });
    expect(sessionOf(at('2026-11-25', '13:42'))).toMatchObject({ type: 'day' });
    expect(sessionOf(at('2026-11-25', '13:45'))).toBeNull();
    expect(sessionOf(at('2026-11-25', '08:42'))).toBeNull();
    expect(sessionOf(at('2026-11-25', '15:00'))).toMatchObject({ type: 'night', key: key('2026-11-25', 2) });
    // After midnight the bar still belongs to the night that opened the day before.
    expect(sessionOf(at('2026-11-26', '04:57'))).toMatchObject({ type: 'night', key: key('2026-11-25', 2) });
    expect(sessionOf(at('2026-11-26', '05:00'))).toBeNull();
  });
  test('close times and the next session, skipping the weekend', () => {
    expect(sessionCloseTime(key('2026-11-25', 1))).toBe(at('2026-11-25', '13:45'));
    expect(sessionCloseTime(key('2026-11-25', 2))).toBe(at('2026-11-26', '05:00'));
    expect(nextSessionKey(key('2026-11-25', 1))).toBe(key('2026-11-25', 2));
    expect(nextSessionKey(key('2026-11-25', 2))).toBe(key('2026-11-26', 1));
    expect(weekdayOfKey(key('2026-11-27', 2))).toBe(5); // Friday
    expect(nextSessionKey(key('2026-11-27', 2))).toBe(key('2026-11-30', 1)); // Friday night → Monday day
  });
  test('splitting bars, and whether the last session has finished', () => {
    const bars = [bar(at('2026-11-24', '15:00')), bar(at('2026-11-25', '04:57')), bar(at('2026-11-25', '08:45')), bar(at('2026-11-25', '13:42')), bar(at('2026-11-25', '15:00'))];
    const sessions = splitSessions(bars, at('2026-11-25', '16:00'));
    expect(sessions.map((s) => [s.type, s.date, s.from, s.to, s.complete])).toEqual([['night', '2026-11-24', 0, 1, true], ['day', '2026-11-25', 2, 3, true], ['night', '2026-11-25', 4, 4, false]]);
  });
  test('3-minute bar starts, with the closing print folded into the last bar', () => {
    expect(barStart(at('2026-11-25', '08:45'))).toBe(at('2026-11-25', '08:45'));
    expect(barStart(at('2026-11-25', '08:47') + 59)).toBe(at('2026-11-25', '08:45'));
    expect(barStart(at('2026-11-25', '08:48'))).toBe(at('2026-11-25', '08:48'));
    expect(barStart(at('2026-11-25', '13:44') + 59)).toBe(at('2026-11-25', '13:42'));
    expect(barStart(at('2026-11-25', '13:45'))).toBe(at('2026-11-25', '13:42'));
    expect(barStart(at('2026-11-26', '05:00'))).toBe(at('2026-11-26', '04:57'));
    expect(barStart(at('2026-11-25', '13:45') + 1)).toBeNull();
    expect(barStart(at('2026-11-25', '14:10'))).toBeNull();
  });
});

describe('which sessions feed the zones', () => {
  test('weekly rule: Monday and Tuesday use last week, Wednesday on uses this week so far', () => {
    // Week of Monday 2026-11-23; the week before starts Monday 2026-11-16.
    const lastWeek = { from: key('2026-11-16', 1), to: key('2026-11-20', 2) };
    expect(weeklyRange(key('2026-11-23', 1))).toEqual(lastWeek);
    expect(weeklyRange(key('2026-11-24', 2))).toEqual(lastWeek);
    expect(weeklyRange(key('2026-11-25', 1))).toEqual({ from: key('2026-11-23', 1), to: key('2026-11-25', 1) - 1 });
    expect(weeklyRange(key('2026-11-25', 2))).toEqual({ from: key('2026-11-23', 1), to: key('2026-11-25', 1) });
    expect(weeklyRange(key('2026-11-27', 2))).toEqual({ from: key('2026-11-23', 1), to: key('2026-11-27', 1) });
  });
  test('previous-session and weekly profiles pick the right bars', () => {
    const bars: Bar[] = [];
    const add = (iso: string, hhmm: string, close: number, volume: number) => bars.push(bar(at(iso, hhmm), close, volume));
    add('2026-11-23', '09:00', 100, 10);   // Monday day
    add('2026-11-23', '16:00', 200, 20);   // Monday night
    add('2026-11-24', '09:00', 300, 30);   // Tuesday day
    add('2026-11-24', '16:00', 400, 40);   // Tuesday night
    add('2026-11-25', '09:00', 500, 50);   // Wednesday day
    add('2026-11-25', '16:00', 600, 60);   // Wednesday night
    const sessions = splitSessions(bars, at('2026-11-26', '06:00'));
    const previous = previousSessionLevels(bars, sessions, 0.5);
    expect(previous[0].profile).toBeNull();
    expect(previous.slice(1).map((item) => item.profile?.totalVolume)).toEqual([10, 20, 30, 40, 50]);
    const weekly = weeklyLevels(bars, sessions, 0.5);
    // Monday and Tuesday look at last week, which is not in the data.
    expect(weekly.slice(0, 4).map((item) => item.profile)).toEqual([null, null, null, null]);
    expect(weekly[4].profile?.totalVolume).toBe(10 + 20 + 30 + 40); // Wednesday day: Monday day … Tuesday night
    expect(weekly[5].profile?.totalVolume).toBe(10 + 20 + 30 + 40 + 50);
    expect([weekly[5].sourceFrom, weekly[5].sourceTo]).toEqual([key('2026-11-23', 1), key('2026-11-25', 1)]);
  });
});
