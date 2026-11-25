// Which bars feed the zones each session trades against. Three ways, matching the three source strategies:
//   previous  the most recent session of the other kind (day uses the night before, night uses that day's day session)
//   weekly    Monday and Tuesday use all of last week; from Wednesday on, this week so far, up to the session before
//   custom    any time range the reader picks
import { buildProfile, type Profile } from './profile';
import { weekdayOfKey } from './session';
import type { Bar, Session } from './types';

export const FUTURES_BIN = 50;

export interface SessionLevels {
  session: Session;
  /** Null when there is nothing to build the zones from (the first session in the data, or a gap). */
  profile: Profile | null;
  /** Sessions the profile was built from, by key (first and last). */
  sourceFrom: number | null;
  sourceTo: number | null;
}

const profileOf = (bars: Bar[], sessions: Session[], pct: number): Profile | null => {
  const slice: Bar[] = [];
  for (const session of sessions) for (let i = session.from; i <= session.to; i += 1) slice.push(bars[i]);
  return buildProfile(slice, { pct, binSize: FUTURES_BIN });
};

/** Strategy 2: zones from the latest finished session of the opposite kind. */
export function previousSessionLevels(bars: Bar[], sessions: Session[], pct: number): SessionLevels[] {
  return sessions.map((session, index) => {
    let source: Session | null = null;
    for (let back = index - 1; back >= 0; back -= 1) { if (sessions[back].type !== session.type) { source = sessions[back]; break; } }
    return { session, profile: source ? profileOf(bars, [source], pct) : null, sourceFrom: source?.key ?? null, sourceTo: source?.key ?? null };
  });
}

/** Session keys [from, to] that the weekly rule accumulates for the session `key`. */
export function weeklyRange(key: number): { from: number; to: number } {
  const day = Math.floor(key / 10);
  const weekday = weekdayOfKey(key); // 0 = Sunday
  const monday = weekday === 0 ? day - 6 : day - (weekday - 1);
  if (weekday === 1 || weekday === 2) return { from: (monday - 7) * 10 + 1, to: (monday - 3) * 10 + 2 }; // last Monday's day session to last Friday's night session
  return { from: monday * 10 + 1, to: key - 1 }; // this Monday's day session up to the session before this one
}

/** Strategy 3: weekly accumulation. */
export function weeklyLevels(bars: Bar[], sessions: Session[], pct: number): SessionLevels[] {
  return sessions.map((session) => {
    const range = weeklyRange(session.key);
    const source = sessions.filter((item) => item.key >= range.from && item.key <= range.to);
    return { session, profile: source.length ? profileOf(bars, source, pct) : null, sourceFrom: source[0]?.key ?? null, sourceTo: source[source.length - 1]?.key ?? null };
  });
}

/** Strategy 1: zones from the bars whose start time falls in [from, to] (epoch seconds, inclusive). */
export function rangeProfile(bars: Bar[], from: number, to: number, pct: number): Profile | null {
  return buildProfile(bars.filter((bar) => bar.t >= from && bar.t <= to), { pct, binSize: FUTURES_BIN });
}
