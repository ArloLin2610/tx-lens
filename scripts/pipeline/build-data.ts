// Data pipeline, run by GitHub Actions (or locally with `npm run data:build`).
//   history/tx/<trading day>.json  one file per trading day, kept in the repository for good
//                                   (the exchange only keeps 30 days, so this is how history accumulates)
//   public/data/tx.json            every stored bar in one compact file for the site
//   public/data/manifest.json      what the data covers
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Bar, BarsPayload } from '../../src/lib/types';
import { sessionCloseTime, sessionOf } from '../../src/lib/session';
import { fetchTaifexDay, listTaifexDays } from './taifex';
import { fetchYahooDay } from './yahoo';

interface DayFile { date: string; contract: string; source: 'taifex' | 'yahoo'; fetchedAt: string; asOf: number; bars: Array<[number, number, number, number, number, number]> }

const historyDir = resolve(process.cwd(), 'history/tx');
const outDir = resolve(process.cwd(), 'public/data');
const started = Date.now();
const log = (message: string) => console.log(`[data] ${message} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
const pack = (bars: Bar[]): DayFile['bars'] => bars.map((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c, bar.v]);
const save = async (file: DayFile) => writeFile(resolve(historyDir, `${file.date}.json`), `${JSON.stringify(file)}\n`);

await mkdir(historyDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const stored = new Map<string, DayFile>();
for (const name of (await readdir(historyDir)).filter((entry) => /^\d{4}-\d{2}-\d{2}\.json$/.test(entry)).sort()) {
  const file = JSON.parse(await readFile(resolve(historyDir, name), 'utf8')) as DayFile;
  stored.set(file.date, file);
}

// 1. Official files: every listed day we do not have yet, or only have provisionally.
let official: string[] = [];
try { official = await listTaifexDays(); } catch (error) { console.warn(`[data] exchange file list unavailable: ${error instanceof Error ? error.message : error}`); }
const wanted = official.filter((date) => stored.get(date)?.source !== 'taifex');
let failures = 0;
for (const date of wanted) {
  try {
    const day = await fetchTaifexDay(date);
    if (day.bars.length < 50) throw new Error(`only ${day.bars.length} bars`);
    const lastBar = day.bars[day.bars.length - 1];
    const file: DayFile = { date, contract: day.contract, source: 'taifex', fetchedAt: new Date().toISOString(), asOf: sessionCloseTime(sessionOf(lastBar.t)!.key), bars: pack(day.bars) };
    stored.set(date, file);
    await save(file);
    log(`${date}: ${day.bars.length} bars from the exchange file (${day.contract}, ${day.trades} trades)`);
  } catch (error) {
    failures += 1;
    console.warn(`[data] ${date}: exchange file failed: ${error instanceof Error ? error.message : error}`);
  }
}

// 2. Yahoo for the trading day in progress, until its official file exists.
try {
  const live = await fetchYahooDay();
  const existing = stored.get(live.date);
  if (existing?.source === 'taifex') log(`${live.date}: official file already stored, Yahoo not needed`);
  else if (live.bars.length && (!existing || live.bars.length >= existing.bars.length)) {
    const file: DayFile = { date: live.date, contract: 'near month', source: 'yahoo', fetchedAt: new Date().toISOString(), asOf: Math.floor(Date.now() / 1000), bars: pack(live.bars) };
    stored.set(live.date, file);
    await save(file);
    log(`${live.date}: ${live.bars.length} bars from Yahoo (provisional)`);
  }
} catch (error) {
  console.warn(`[data] Yahoo minute data unavailable: ${error instanceof Error ? error.message : error}`);
}

if (!stored.size) throw new Error('No bars at all: neither the exchange files nor Yahoo could be read');
if (wanted.length && failures === wanted.length && !official.some((date) => stored.get(date)?.source === 'taifex')) throw new Error('Every exchange download failed');

// 3. One compact file for the site.
const days = [...stored.values()].sort((a, b) => a.date.localeCompare(b.date));
const payload: BarsPayload = { meta: { generatedAt: new Date().toISOString(), asOf: 0, symbol: '臺股期貨近月（TX）', days: [] }, t: [], o: [], h: [], l: [], c: [], v: [] };
let lastT = 0;
for (const day of days) {
  let kept = 0;
  for (const [t, o, h, l, c, v] of day.bars) {
    if (t <= lastT) continue; // a provisional day can overlap the next official one; keep the first copy
    payload.t.push(t); payload.o.push(o); payload.h.push(h); payload.l.push(l); payload.c.push(c); payload.v.push(Math.round(v));
    lastT = t; kept += 1;
  }
  payload.meta.days.push({ date: day.date, contract: day.contract, source: day.source, bars: kept });
  payload.meta.asOf = Math.max(payload.meta.asOf, day.asOf);
}
await writeFile(resolve(outDir, 'tx.json'), JSON.stringify(payload));
await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify({ generatedAt: payload.meta.generatedAt, asOf: new Date(payload.meta.asOf * 1000).toISOString(), tradingDays: days.length, bars: payload.t.length, firstDay: days[0].date, lastDay: days[days.length - 1].date, provisionalDays: days.filter((day) => day.source === 'yahoo').map((day) => day.date) }, null, 2));
log(`tx.json: ${payload.t.length} bars over ${days.length} trading days (${days[0].date} to ${days[days.length - 1].date})`);
