// Session bookkeeping for TAIEX futures, exactly as the source strategies define it:
//   day session    08:45–13:42 (bar start times; the last bar ends 13:45)
//   night session  15:00–04:57 next morning; bars after midnight belong to the night that opened the day before
import type { Bar, Session, SessionType } from './types';

const TAIPEI_OFFSET = 8 * 3600;
const DAY = 86_400;

/** Minutes after Taipei midnight, and the Taipei day number (days since 1970-01-01), of an epoch-seconds timestamp. */
export const taipeiClock = (t: number): { day: number; minute: number } => {
  const local = t + TAIPEI_OFFSET;
  const day = Math.floor(local / DAY);
  return { day, minute: Math.floor((local - day * DAY) / 60) };
};
export const dayToIso = (day: number): string => new Date(day * DAY * 1000).toISOString().slice(0, 10);
export const isoToDay = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000 / DAY);
/** Epoch seconds of a Taipei wall-clock time. */
export const taipeiEpoch = (iso: string, minute: number): number => isoToDay(iso) * DAY - TAIPEI_OFFSET + minute * 60;

export const DAY_OPEN = 8 * 60 + 45;
export const DAY_LAST_BAR = 13 * 60 + 42;
export const NIGHT_OPEN = 15 * 60;
export const NIGHT_LAST_BAR = 4 * 60 + 57;

/** Session a bar belongs to, or null for bars outside both sessions. */
export function sessionOf(t: number): { key: number; type: SessionType; day: number } | null {
  const { day, minute } = taipeiClock(t);
  if (minute >= DAY_OPEN && minute <= DAY_LAST_BAR) return { key: day * 10 + 1, type: 'day', day };
  if (minute >= NIGHT_OPEN) return { key: day * 10 + 2, type: 'night', day };
  if (minute <= NIGHT_LAST_BAR) return { key: (day - 1) * 10 + 2, type: 'night', day: day - 1 };
  return null;
}

/** Epoch seconds at which a session stops trading. */
export const sessionCloseTime = (key: number): number => {
  const day = Math.floor(key / 10);
  return key % 10 === 1 ? day * DAY - TAIPEI_OFFSET + (13 * 60 + 45) * 60 : (day + 1) * DAY - TAIPEI_OFFSET + 5 * 3600;
};
export const sessionOpenTime = (key: number): number => {
  const day = Math.floor(key / 10);
  return day * DAY - TAIPEI_OFFSET + (key % 10 === 1 ? DAY_OPEN : NIGHT_OPEN) * 60;
};

/** Split bars (ascending) into sessions. `asOf` decides whether the last session has finished. */
export function splitSessions(bars: Bar[], asOf: number): Session[] {
  const sessions: Session[] = [];
  bars.forEach((bar, index) => {
    const info = sessionOf(bar.t);
    if (!info) return;
    const last = sessions[sessions.length - 1];
    if (last && last.key === info.key) { last.to = index; return; }
    sessions.push({ key: info.key, type: info.type, date: dayToIso(info.day), from: index, to: index, complete: asOf >= sessionCloseTime(info.key) });
  });
  return sessions;
}

/** Day of week of a session's opening date: 0 = Sunday … 6 = Saturday. */
export const weekdayOfKey = (key: number): number => (Math.floor(key / 10) + 4) % 7; // 1970-01-01 was a Thursday

/** The session that follows `key` on the regular timetable (weekends skipped; holidays are not modelled). */
export function nextSessionKey(key: number): number {
  const day = Math.floor(key / 10);
  if (key % 10 === 1) return day * 10 + 2;
  let next = day + 1;
  while ([0, 6].includes((next + 4) % 7)) next += 1;
  return next * 10 + 1;
}

export const sessionLabel = (key: number): string => {
  const iso = dayToIso(Math.floor(key / 10));
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${key % 10 === 1 ? '日盤' : '夜盤'}`;
};
