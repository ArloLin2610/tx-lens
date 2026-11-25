/** One 3-minute bar of the near-month TAIEX futures. `t` is the bar's start, in epoch seconds. */
export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export type SessionType = 'day' | 'night';

/** A trading session: the day session (08:45–13:45) or the night session (15:00–05:00 next morning). */
export interface Session {
  /** Sortable id: days since 1970-01-01 (Taipei) of the session's opening date, times 10, plus 1 for day or 2 for night. */
  key: number;
  type: SessionType;
  /** Calendar date (Taipei) the session opened on. A night session keeps this date after midnight. */
  date: string;
  /** Index range into the bar array, inclusive. */
  from: number;
  to: number;
  /** False while the session is still trading (or the data stops before its close). */
  complete: boolean;
}

/** Compact bar file published by the pipeline. */
export interface BarsPayload {
  meta: {
    generatedAt: string;
    /** Newest moment the data covers, epoch seconds. */
    asOf: number;
    symbol: string;
    /** Trading days in the file, oldest first, with where each came from. */
    days: Array<{ date: string; contract: string; source: 'taifex' | 'yahoo'; bars: number }>;
  };
  t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
}
