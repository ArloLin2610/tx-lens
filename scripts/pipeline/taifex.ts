// Official trade-by-trade files from the Taiwan Futures Exchange (the last 30 trading days are public).
// One zip per trading day; it holds the night session that opened the previous afternoon and the day session.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bar } from '../../src/lib/types';
import { BarBuilder } from './bars';

const LIST_URL = 'https://www.taifex.com.tw/cht/3/dlFutPrevious30DaysSalesData';
const FILE_URL = (date: string) => `https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_${date.replaceAll('-', '_')}.zip`;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', referer: LIST_URL };

async function fetchRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
  throw lastError;
}

/** Trading days (ISO dates, ascending) that currently have a downloadable file. */
export async function listTaifexDays(): Promise<string[]> {
  const html = await (await fetchRetry(LIST_URL)).text();
  const days = new Set<string>();
  for (const match of html.matchAll(/Daily_(\d{4})_(\d{2})_(\d{2})\.zip/g)) days.add(`${match[1]}-${match[2]}-${match[3]}`);
  return [...days].sort();
}

export interface TaifexDay { date: string; contract: string; bars: Bar[]; trades: number }

/**
 * Download one trading day and build 3-minute bars for the most traded monthly TX contract
 * (the near month, except in the hours around settlement).
 * Volume in the file counts both sides of every trade, so it is halved.
 */
export async function fetchTaifexDay(date: string): Promise<TaifexDay> {
  const folder = await mkdtemp(join(tmpdir(), 'tx-lens-'));
  const zipPath = join(folder, 'day.zip');
  try {
    const archive = Buffer.from(await (await fetchRetry(FILE_URL(date))).arrayBuffer());
    // A date with no file answers with an HTML page, not an error status.
    if (archive.length < 1000 || archive.subarray(0, 2).toString('latin1') !== 'PK') throw new Error(`No exchange file for ${date}`);
    await writeFile(zipPath, archive);
    const builders = new Map<string, { builder: BarBuilder; volume: number; trades: number }>();
    const child = spawn('unzip', ['-p', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    // The header row is Big5; every row we keep is plain ASCII, so latin1 decoding is enough.
    const lines = createInterface({ input: child.stdout.setEncoding('latin1'), crlfDelay: Infinity });
    for await (const line of lines) {
      // 成交日期,商品代號,到期月份(週別),成交時間,成交價格,成交數量(B+S),近月價格,遠月價格,開盤集合競價
      if (line.charCodeAt(0) < 48 || line.charCodeAt(0) > 57) continue;
      const cells = line.split(',');
      if (cells[1].trim() !== 'TX') continue;
      const contract = cells[2].trim();
      if (!/^\d{6}$/.test(contract)) continue; // skips calendar spreads (202612/202701) and weekly contracts (202611W4)
      const day = cells[0].trim(), time = cells[3].trim().padStart(6, '0');
      const price = Number(cells[4]), volume = Number(cells[5]) / 2;
      if (!(price > 0) || !(volume > 0)) continue;
      const epoch = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+08:00`) / 1000;
      let entry = builders.get(contract);
      if (!entry) { entry = { builder: new BarBuilder(), volume: 0, trades: 0 }; builders.set(contract, entry); }
      entry.builder.add(epoch, price, price, price, price, volume);
      entry.volume += volume;
      entry.trades += 1;
    }
    const exitCode: number = await new Promise((resolve) => { if (child.exitCode != null) resolve(child.exitCode); else child.on('close', (code) => resolve(code ?? 1)); });
    if (exitCode !== 0) throw new Error(`unzip failed for ${date}: ${stderr.trim().slice(0, 200)}`);
    const [contract, best] = [...builders.entries()].sort((a, b) => b[1].volume - a[1].volume)[0] ?? [];
    if (!contract || !best) throw new Error(`No TX trades in the ${date} file`);
    return { date, contract, bars: best.builder.bars(), trades: best.trades };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
