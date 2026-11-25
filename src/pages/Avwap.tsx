import { useMemo, useState } from 'react';
import { Field, FieldGroup, Segmented } from '@/components/Bits';
import { Chart, type ChartLine, type ChartMarker } from '@/components/Chart';
import { anchoredVwap, findAnchor, type AnchorMode, type Candle } from '@/lib/avwap';
import { STOCK_DATA, useJson } from '@/lib/data';
import { pts, signed } from '@/lib/format';
import { loadSetting, saveSetting } from '@/lib/storage';
import type { Bar } from '@/lib/types';

interface StockRow { ticker: string; market: string; nameZh: string }
interface HistoryFile { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

const MODES: Array<{ value: AnchorMode; label: string }> = [{ value: 'high', label: '區間最高點' }, { value: 'low', label: '區間最低點' }, { value: 'volume', label: '區間最大量' }, { value: 'manual', label: '自選日期' }];
const MODE_NOTE: Record<AnchorMode, string> = {
  high: '從這段期間的最高點那天起算。整理期間高點不變，線就固定；股價重新站上這條線，代表高點以來買進的人平均已經解套。',
  low: '從這段期間的最低點那天起算，看低點以來買進的人的平均成本，常被當成支撐。',
  volume: '從成交量最大的那天起算，那天通常是大量換手的起點。',
  manual: '從你指定的日期起算（若當天沒有交易，用之後第一個交易日）。',
};

export function Avwap({ theme }: { theme: string }) {
  const market = useJson<{ stocks: StockRow[] }>(`${STOCK_DATA}/market.json`);
  const [ticker, setTickerState] = useState<string>(() => loadSetting('avwapTicker', '2330'));
  const [query, setQuery] = useState('');
  const [mode, setModeState] = useState<AnchorMode>(() => loadSetting<AnchorMode>('avwapMode', 'high'));
  const [lookback, setLookbackState] = useState<number>(() => loadSetting('avwapLookback', 120));
  const [manualDate, setManualDate] = useState<string>('');
  const setTicker = (value: string) => { setTickerState(value); saveSetting('avwapTicker', value); setQuery(''); };
  const setMode = (value: AnchorMode) => { setModeState(value); saveSetting('avwapMode', value); };
  const setLookback = (value: number) => { setLookbackState(value); saveSetting('avwapLookback', value); };

  const history = useJson<HistoryFile>(`${STOCK_DATA}/h/${ticker}.json`);
  const candles: Candle[] = useMemo(() => (history.data ? history.data.d.map((date, i) => ({ date, o: history.data!.o[i], h: history.data!.h[i], l: history.data!.l[i], c: history.data!.c[i], v: history.data!.v[i] })) : []), [history.data]);
  const bars: Bar[] = useMemo(() => candles.map((candle) => ({ t: Date.parse(`${candle.date}T00:00:00Z`) / 1000, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v })), [candles]);
  const anchor = useMemo(() => findAnchor(candles, mode, lookback, manualDate || undefined), [candles, mode, lookback, manualDate]);
  const line = useMemo(() => anchoredVwap(candles, anchor), [candles, anchor]);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q || !market.data) return [];
    const rows = market.data.stocks;
    return [...rows.filter((row) => row.ticker.startsWith(q)), ...rows.filter((row) => !row.ticker.startsWith(q) && row.nameZh.toUpperCase().includes(q))].slice(0, 8);
  }, [query, market.data]);
  const name = market.data?.stocks.find((row) => row.ticker === ticker)?.nameZh ?? '';

  const last = candles[candles.length - 1], lastLine = line[line.length - 1];
  const digits = last ? (last.c < 50 ? 2 : last.c < 500 ? 1 : 0) : 0;
  const lines: ChartLine[] = [
    { values: line.map((point) => point.vah), kind: 'primary', label: 'VAH-AVWAP' },
    { values: line.map((point) => point.typical), kind: 'secondary', label: '一般 AVWAP' },
  ];
  const anchorCandle = anchor != null ? candles[anchor] : null;
  const anchorPrice = anchorCandle ? (mode === 'low' ? anchorCandle.l : mode === 'high' ? anchorCandle.h : anchorCandle.c) : null;
  const markers: ChartMarker[] = anchor != null && anchorPrice != null ? [{ index: anchor, price: anchorPrice, kind: 'anchor' }] : [];
  const gap = last && lastLine?.vah ? ((last.c - lastLine.vah) / lastLine.vah) * 100 : null;
  const daysSince = anchor != null ? candles.length - 1 - anchor : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>個股 AVWAP</h1>
          <p className="lede">AVWAP 是從某一天（錨點）起算、用成交量加權的平均成本。錨點由程式依你選的方式自動找，不用自己看圖輸入日期。</p>
        </div>
      </div>

      <section className="panel">
        <div className="filters">
          <FieldGroup label="股票">
            <div className="search">
              <input type="search" value={query} placeholder={`${ticker} ${name}`} aria-label="搜尋股票代號或名稱" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && matches[0]) setTicker(matches[0].ticker); if (event.key === 'Escape') setQuery(''); }} />
              {matches.length ? <ul className="search-list">{matches.map((row) => <li key={row.ticker}><button type="button" onClick={() => setTicker(row.ticker)}><b>{row.ticker}</b><span>{row.nameZh}</span></button></li>)}</ul> : null}
            </div>
          </FieldGroup>
          <FieldGroup label="錨點怎麼選"><Segmented label="錨點怎麼選" value={mode} onChange={setMode} options={MODES} /></FieldGroup>
          {mode === 'manual'
            ? <Field label="錨定日期"><input type="date" value={manualDate} min={candles[0]?.date} max={last?.date} onChange={(event) => setManualDate(event.target.value)} /></Field>
            : <FieldGroup label="往回看幾個交易日"><Segmented label="往回看幾個交易日" value={lookback} onChange={setLookback} options={[{ value: 60, label: '60' }, { value: 120, label: '120' }, { value: 240, label: '240' }]} /></FieldGroup>}
        </div>

        {history.error ? <p className="empty">讀不到 {ticker} 的日線資料（{history.error}）。這檔可能不在台股網站的資料範圍內。</p>
          : !candles.length ? <p className="empty">載入 {ticker} 的日線中…</p>
            : (
              <>
                <h2>{ticker} {name}</h2>
                {anchorCandle && lastLine?.vah != null && gap != null ? (
                  <p className="verdict">
                    錨點是 <b className="num">{anchorCandle.date}</b>（{daysSince} 個交易日前，{mode === 'low' ? '最低' : mode === 'high' ? '最高' : '收盤'} {pts(anchorPrice, digits)}）。
                    最新收盤 <b className="num">{pts(last.c, digits)}</b>，在 VAH-AVWAP <b className="num">{pts(lastLine.vah, digits)}</b> {gap >= 0 ? '之上' : '之下'} <b className={`num ${gap >= 0 ? 'up' : 'down'}`}>{signed(gap, 1)}%</b>：
                    從錨點起買進的人，平均{gap >= 0 ? '是賺的' : '是賠的'}。
                  </p>
                ) : <p className="empty">{mode === 'manual' ? '請選一個錨定日期。' : '找不到錨點。'}</p>}
                <Chart
                  bars={bars} lines={lines} markers={markers} initialVisible={Math.min(candles.length, Math.max(90, (daysSince ?? 60) + 40))} viewKey={`${ticker}-${mode}-${lookback}-${manualDate}`}
                  digits={digits} theme={theme} height={420}
                  formatTime={(t, short) => { const iso = new Date(t * 1000).toISOString(); return short ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : iso.slice(0, 10); }}
                  label={`${ticker} ${name} 日線圖與錨定成交量加權平均價`}
                  ranges={[{ label: '三個月', bars: 63 }, { label: '半年', bars: 126 }, { label: '一年', bars: 252 }]}
                />
                <ul className="legend">
                  <li><i className="swatch swatch-line" />VAH-AVWAP（文件的算法）</li>
                  <li><i className="swatch swatch-line2" />一般 AVWAP（用最高、最低、收盤的平均）</li>
                  <li><i className="swatch swatch-anchor" />錨點</li>
                </ul>
                <p className="note">{MODE_NOTE[mode]}</p>
                <p className="note">兩條線的差別：一般 AVWAP 把每天的成本當成（最高＋最低＋收盤）÷ 3；文件的做法是改用當天的 VAH。但日線每天只有一根 K 棒，當天的成交量分布算不出來，文件的公式實際得到的是「收盤價所在那一格的上緣」，所以這條線只比收盤價的 AVWAP 略高。要得到真正的每日 VAH 需要個股的分鐘資料，本站沒有。日線來源與台股網站相同，約一年。</p>
              </>
            )}
      </section>
    </>
  );
}
