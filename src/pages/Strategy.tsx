import { useMemo, useState } from 'react';
import { Field, FieldGroup, Segmented } from '@/components/Bits';
import { clock, pct as fmtPct, pts, signed, tone } from '@/lib/format';
import { previousSessionLevels, weeklyLevels } from '@/lib/levels';
import { sessionLabel } from '@/lib/session';
import { loadSetting, saveSetting } from '@/lib/storage';
import { runStrategy, summarize, type Trade } from '@/lib/strategy';
import type { Bar, Session } from '@/lib/types';
import { PCT_OPTIONS } from './ValueArea';

interface Props { bars: Bar[]; sessions: Session[]; tradingDays: number }
const REASON = { stop: '停損', target: '停利', sessionEnd: '盤末平倉' } as const;

/** Running total of net points, one step per trade. */
function Equity({ trades }: { trades: Trade[] }) {
  const W = 760, H = 190, PAD = { l: 8, r: 64, t: 12, b: 20 };
  let total = 0;
  const points = [0, ...trades.map((trade) => (total += trade.net))];
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const x = (i: number) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (value: number) => PAD.t + ((max - value) / span) * (H - PAD.t - PAD.b);
  const path = points.map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join('');
  const final = points[points.length - 1];
  return (
    <svg className="equity" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`累計損益曲線，${trades.length} 筆交易後為 ${signed(final)} 點`}>
      <line className="equity-zero" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
      <text className="equity-label" x={W - PAD.r + 6} y={y(0)} dominantBaseline="middle">0</text>
      <path className="equity-line" d={path} />
      <circle className="equity-dot" cx={x(points.length - 1)} cy={y(final)} r="3.5" />
      <text className="equity-label equity-final" x={W - PAD.r + 6} y={y(final) + (Math.abs(y(final) - y(0)) < 12 ? (final >= 0 ? -12 : 12) : 0)} dominantBaseline="middle">{signed(final)}</text>
      <text className="equity-label" x={PAD.l} y={H - 4}>第 1 筆</text>
      <text className="equity-label" x={W - PAD.r} y={H - 4} textAnchor="end">第 {trades.length} 筆</text>
    </svg>
  );
}

export function Strategy({ bars, sessions, tradingDays }: Props) {
  const [source, setSourceState] = useState<'previous' | 'weekly'>(() => loadSetting<'previous' | 'weekly'>('strategySource', 'previous'));
  const [pct, setPctState] = useState<number>(() => loadSetting('pct', 0.5));
  const [ratio, setRatioState] = useState<number>(() => loadSetting('ratio', 1));
  const [cost, setCostState] = useState<number>(() => loadSetting('cost', 4));
  const [showAll, setShowAll] = useState(false);
  const setSource = (value: 'previous' | 'weekly') => { setSourceState(value); saveSetting('strategySource', value); };
  const setPct = (value: number) => { setPctState(value); saveSetting('pct', value); };
  const setRatio = (value: number) => { setRatioState(value); saveSetting('ratio', value); };
  const setCost = (value: number) => { setCostState(value); saveSetting('cost', value); };

  const trades = useMemo(() => {
    const levels = source === 'weekly' ? weeklyLevels(bars, sessions, pct) : previousSessionLevels(bars, sessions, pct);
    return runStrategy(bars, levels, { targetRatio: ratio, costPoints: cost });
  }, [bars, sessions, source, pct, ratio, cost]);
  const isDay = (trade: Trade) => trade.sessionKey % 10 === 1;
  const groups = useMemo(() => [
    { name: '全部', list: trades },
    { name: '做多', list: trades.filter((trade) => trade.side === 'long') },
    { name: '做空', list: trades.filter((trade) => trade.side === 'short') },
    { name: '日盤', list: trades.filter(isDay) },
    { name: '夜盤', list: trades.filter((trade) => !isDay(trade)) },
  ].map((group) => ({ ...group, stats: summarize(group.list) })), [trades]);
  const all = groups[0].stats;
  const newestFirst = useMemo(() => [...trades].reverse(), [trades]);
  const shown = showAll ? newestFirst : newestFirst.slice(0, 30);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>價值區突破多空策略</h1>
          <p className="lede">用每一盤的 VAH 區和 VAL 區當門檻：整個穿出去才進場，整個跌回來才認賠。下面是這套規則套在現有 {tradingDays} 個交易日 3 分 K 上的結果。</p>
        </div>
      </div>

      <section className="panel rules">
        <h2>規則</h2>
        <div className="rule-grid">
          <div><h3>做多</h3><p>3 分 K 收盤由下往上站上 VAH 區上緣，下一根開盤買進。</p><p>收盤跌回 VAH 區下緣之下就出場。收盤漲到「VAH 區上緣＋價值區高度 × 停利倍數」也出場。</p></div>
          <div><h3>做空</h3><p>3 分 K 收盤由上往下跌破 VAL 區下緣，下一根開盤放空。</p><p>收盤漲回 VAL 區上緣之上就出場。收盤跌到「VAL 區下緣－價值區高度 × 停利倍數」也出場。</p></div>
          <div><h3>共同</h3><p>價值區高度是 VAH 區上緣到 VAL 區下緣的距離。訊號只看收完的 K 棒，一律在下一根開盤成交。</p><p>不留倉：日盤 13:36、夜盤 04:51 起平倉且不再進場。出場後要再出現一次新的穿越才會再進場。穿越當下收盤已經超過停利價（例如跳空）就不追。</p></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>回測</h2>
          <div className="controls">
            <FieldGroup label="區域來源"><Segmented label="區域來源" value={source} onChange={setSource} options={[{ value: 'previous', label: '上一盤' }, { value: 'weekly', label: '週累計' }]} /></FieldGroup>
            <FieldGroup label="價值區比例"><Segmented label="價值區比例" value={pct} onChange={setPct} options={PCT_OPTIONS} /></FieldGroup>
            <FieldGroup label="停利倍數"><Segmented label="停利倍數" value={ratio} onChange={setRatio} options={[{ value: 0.5, label: '0.5' }, { value: 1, label: '1' }, { value: 2, label: '2' }]} /></FieldGroup>
            <Field label="每筆來回成本（點）"><input className="short" type="number" min={0} max={50} step={1} value={cost} onChange={(event) => setCost(Math.max(0, Math.min(50, Number(event.target.value) || 0)))} /></Field>
          </div>
        </div>

        <div className="notice notice-warn">
          <strong>樣本只有 {tradingDays} 個交易日</strong>
          <p>這段期間只代表一種行情。換一組參數結果就差很多，代表數字裡運氣的成分很大，不能當成這套規則「有效」或「無效」的證據。資料每天累積，樣本會慢慢變多。</p>
        </div>

        {trades.length ? (
          <>
            <p className="verdict">
              {all.trades} 筆交易，扣掉成本後合計 <b className={`num ${tone(all.net)}`}>{signed(all.net)}</b> 點，
              勝率 <b className="num">{fmtPct(all.winRate)}</b>，過程中最大回落 <b className="num">{pts(all.maxDrawdown)}</b> 點。
            </p>
            <Equity trades={trades} />
            <div className="table-wrap">
              <table>
                <thead><tr><th>分類</th><th className="r">筆數</th><th className="r">勝率</th><th className="r">淨損益（點）</th><th className="r">平均賺</th><th className="r">平均賠</th><th className="r">獲利因子</th><th className="r">最大回落</th><th className="r">最好</th><th className="r">最差</th></tr></thead>
                <tbody>
                  {groups.map(({ name, stats }) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="r num">{stats.trades}</td>
                      <td className="r num">{fmtPct(stats.winRate)}</td>
                      <td className={`r num ${tone(stats.net)}`}>{signed(stats.net)}</td>
                      <td className="r num">{signed(stats.averageWin)}</td>
                      <td className="r num">{signed(stats.averageLoss)}</td>
                      <td className="r num">{stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}</td>
                      <td className="r num">{pts(stats.maxDrawdown)}</td>
                      <td className="r num">{signed(stats.best)}</td>
                      <td className="r num">{signed(stats.worst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">損益單位是指數點，大台一點 200 元新台幣、小台一點 50 元。獲利因子＝賺的總和 ÷ 賠的總和，大於 1 才是正的。成本包含手續費、期交稅與滑價，預設每筆來回 4 點。</p>

            <h3>逐筆交易</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>盤別</th><th>方向</th><th>進場</th><th className="r">價位</th><th>出場</th><th className="r">價位</th><th>原因</th><th className="r">淨損益（點）</th></tr></thead>
                <tbody>
                  {shown.map((trade) => (
                    <tr key={`${trade.entryTime}-${trade.side}`}>
                      <td>{sessionLabel(trade.sessionKey)}</td>
                      <td>{trade.side === 'long' ? '做多' : '做空'}</td>
                      <td className="num">{clock(trade.entryTime)}</td>
                      <td className="r num">{pts(trade.entryPrice)}</td>
                      <td className="num">{clock(trade.exitTime)}</td>
                      <td className="r num">{pts(trade.exitPrice)}</td>
                      <td>{REASON[trade.reason]}</td>
                      <td className={`r num ${tone(trade.net)}`}>{signed(trade.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {newestFirst.length > 30 ? <p className="more"><button type="button" className="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? '只看最近 30 筆' : `顯示全部 ${newestFirst.length} 筆`}</button></p> : null}
          </>
        ) : <p className="empty">這組設定在現有資料裡沒有任何進場。</p>}
      </section>
    </>
  );
}
