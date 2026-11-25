// Same-day minute data for the near-month TAIEX futures from Yahoo Taiwan.
// The exchange publishes its own file only late in the afternoon, so this fills the
// gap for the session that has just finished. It is replaced by the official file later.
import type { Bar } from '../../src/lib/types';
import { dayToIso, taipeiClock } from '../../src/lib/session';
import { BarBuilder } from './bars';

const URL = 'https://tw.stock.yahoo.com/_td-stock/api/resource/FinanceChartService.ApacLibraCharts;symbols=%5B%22WTX%26%22%5D;type=tick?intl=tw&lang=zh-Hant-TW&region=TW&site=finance&tz=Asia%2FTaipei&returnMeta=true';

interface YahooChart {
  meta: { currentTradingPeriod?: { regular?: { start: number; end: number } } };
  timestamp?: number[];
  indicators: { quote: Array<{ open: Array<number | null>; high: Array<number | null>; low: Array<number | null>; close: Array<number | null>; volume: Array<number | null> }> };
}

export interface YahooDay { date: string; bars: Bar[]; lastPrint: number }

/** The trading day Yahoo is currently showing (previous afternoon's night session plus today's day session). */
export async function fetchYahooDay(): Promise<YahooDay> {
  const response = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Yahoo Taiwan answered HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ chart?: YahooChart }> };
  const chart = payload.data?.[0]?.chart;
  const end = chart?.meta.currentTradingPeriod?.regular?.end;
  if (!chart?.timestamp?.length || !end) throw new Error('Yahoo Taiwan returned no minute data');
  const quote = chart.indicators.quote[0];
  const builder = new BarBuilder();
  let lastPrint = 0;
  chart.timestamp.forEach((t, index) => {
    const close = quote.close[index], volume = quote.volume[index];
    if (close == null || !volume) return;
    builder.add(t, quote.open[index] ?? close, quote.high[index] ?? close, quote.low[index] ?? close, close, volume);
    lastPrint = t + 60;
  });
  return { date: dayToIso(taipeiClock(end).day), bars: builder.bars(), lastPrint };
}
