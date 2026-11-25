import { useMemo, useState } from 'react';
import { Field, FieldGroup, Segmented, ZoneName } from '@/components/Bits';
import { Chart, type ChartBand, type ChartMarker, type ChartSegment, type ChartSpan } from '@/components/Chart';
import { Ladder } from '@/components/Ladder';
import { clock, fromInput, hhmm, pts, toInput, zoneText } from '@/lib/format';
import { previousSessionLevels, rangeProfile, weeklyLevels, weeklyRange, type SessionLevels } from '@/lib/levels';
import { buildProfile, type Profile } from '@/lib/profile';
import { nextSessionKey, sessionLabel } from '@/lib/session';
import { loadSetting, saveSetting } from '@/lib/storage';
import { runStrategy } from '@/lib/strategy';
import type { Bar, Session } from '@/lib/types';

export type LevelMode = 'previous' | 'weekly' | 'custom';
export const PCT_OPTIONS = [{ value: 0.5, label: '50%' }, { value: 0.618, label: '61.8%' }, { value: 0.7, label: '70%' }];
const FUTURE = 46;

interface Props { bars: Bar[]; sessions: Session[]; asOf: number; theme: string }

/** Zones the session after the last finished one will trade against. */
function projectNext(bars: Bar[], sessions: Session[], mode: LevelMode, pct: number): { key: number; profile: Profile | null; sourceFrom: number | null; sourceTo: number | null } | null {
  const last = sessions[sessions.length - 1];
  if (!last?.complete || mode === 'custom') return null;
  const key = nextSessionKey(last.key);
  let source: Session[];
  if (mode === 'previous') source = [last];
  else { const range = weeklyRange(key); source = sessions.filter((session) => session.key >= range.from && session.key <= range.to); }
  const slice: Bar[] = [];
  for (const session of source) for (let i = session.from; i <= session.to; i += 1) slice.push(bars[i]);
  return { key, profile: buildProfile(slice, { pct, binSize: 50 }), sourceFrom: source[0]?.key ?? null, sourceTo: source[source.length - 1]?.key ?? null };
}

const sourceText = (from: number | null, to: number | null): string => (from == null || to == null ? '—' : from === to ? sessionLabel(from) : `${sessionLabel(from)} 到 ${sessionLabel(to)}`);
const bandsOf = (profile: Profile, from: number, to: number, labelled: boolean): ChartBand[] => [
  { from, to, low: profile.vahZone.low, high: profile.vahZone.high, kind: 'vah', label: labelled ? `VAH ${zoneText(profile.vahZone)}` : undefined },
  { from, to, low: profile.valZone.low, high: profile.valZone.high, kind: 'val', label: labelled ? `VAL ${zoneText(profile.valZone)}` : undefined },
  { from, to, low: profile.pocZone.low, high: profile.pocZone.high, kind: 'poc', label: labelled ? `POC ${zoneText(profile.pocZone)}` : undefined },
];

export function ValueArea({ bars, sessions, asOf, theme }: Props) {
  const [mode, setModeState] = useState<LevelMode>(() => loadSetting<LevelMode>('mode', 'previous'));
  const [pct, setPctState] = useState<number>(() => loadSetting('pct', 0.5));
  const [showTrades, setShowTradesState] = useState<boolean>(() => loadSetting('showTrades', false));
  const setMode = (value: LevelMode) => { setModeState(value); saveSetting('mode', value); };
  const setPct = (value: number) => { setPctState(value); saveSetting('pct', value); };
  const setShowTrades = (value: boolean) => { setShowTradesState(value); saveSetting('showTrades', value); };

  const last = sessions[sessions.length - 1];
  const lastComplete = [...sessions].reverse().find((session) => session.complete) ?? last;
  // Own range: starts as the last finished session.
  const [range, setRange] = useState<{ from: number; to: number }>(() => ({ from: bars[lastComplete.from].t, to: bars[lastComplete.to].t }));
  const [picking, setPicking] = useState<'from' | 'to'>('from');

  const levels: SessionLevels[] = useMemo(() => (mode === 'weekly' ? weeklyLevels(bars, sessions, pct) : previousSessionLevels(bars, sessions, pct)), [bars, sessions, mode, pct]);
  const next = useMemo(() => projectNext(bars, sessions, mode, pct), [bars, sessions, mode, pct]);
  const custom = useMemo(() => (mode === 'custom' ? rangeProfile(bars, range.from, range.to, pct) : null), [bars, mode, range, pct]);
  const selection = useMemo(() => {
    if (mode !== 'custom') return null;
    const from = bars.findIndex((bar) => bar.t >= range.from);
    let to = -1;
    for (let i = bars.length - 1; i >= 0; i -= 1) if (bars[i].t <= range.to) { to = i; break; }
    return from >= 0 && to >= from ? { from, to } : null;
  }, [bars, mode, range]);

  const spans: ChartSpan[] = useMemo(() => sessions.map((session) => ({ from: session.from, to: session.to, label: sessionLabel(session.key), shade: session.type === 'night' })), [sessions]);
  const current = levels[levels.length - 1];
  const bands = useMemo(() => {
    const list: ChartBand[] = [];
    if (mode === 'custom') {
      if (custom && selection) list.push(...bandsOf(custom, selection.to + 1, bars.length - 1 + FUTURE, true));
      return list;
    }
    levels.forEach((item, index) => {
      if (!item.profile) return;
      const isCurrent = index === levels.length - 1;
      // The session in progress keeps its zones to the right edge; a finished one stops at its last bar.
      list.push(...bandsOf(item.profile, item.session.from, isCurrent && !next ? bars.length - 1 + FUTURE : item.session.to, isCurrent && !next));
    });
    if (next?.profile) list.push(...bandsOf(next.profile, bars.length, bars.length - 1 + FUTURE, true));
    return list;
  }, [mode, custom, selection, levels, next, bars.length]);

  const tradeMarks = useMemo(() => {
    if (!showTrades || mode === 'custom') return { markers: [] as ChartMarker[], segments: [] as ChartSegment[] };
    const trades = runStrategy(bars, levels, { targetRatio: loadSetting('ratio', 1), costPoints: loadSetting('cost', 4) });
    return {
      markers: trades.map((trade): ChartMarker => ({ index: trade.entryIndex, price: trade.side === 'long' ? bars[trade.entryIndex].l : bars[trade.entryIndex].h, kind: trade.side })),
      segments: trades.map((trade): ChartSegment => ({ from: trade.entryIndex, fromPrice: trade.entryPrice, to: trade.exitIndex, toPrice: trade.exitPrice, win: trade.net > 0 })),
    };
  }, [showTrades, mode, bars, levels]);

  // What the summary describes: the next session if the last one is over, otherwise the one being traded now.
  const focus: { title: string; profile: Profile | null; source: string; note: string } = mode === 'custom'
    ? { title: '自選區間算出的區域', profile: custom, source: `${clock(range.from)} 到 ${clock(range.to)}`, note: '區域從區間結束之後開始顯示。' }
    : next
      ? { title: `${sessionLabel(next.key)}要用的區域`, profile: next.profile, source: sourceText(next.sourceFrom, next.sourceTo), note: `${sessionLabel(last.key)}已收盤。下一盤的日期按一般交易日曆推算，遇到休市會往後順延。` }
      : { title: `${sessionLabel(last.key)}正在用的區域`, profile: current?.profile ?? null, source: sourceText(current?.sourceFrom ?? null, current?.sourceTo ?? null), note: `${sessionLabel(last.key)}還在進行，資料到 ${hhmm(bars[bars.length - 1].t + 180)}。這一盤收盤後才會算出下一盤的區域。` };
  const lastPrice = bars[bars.length - 1].c;

  const onPick = (index: number) => {
    const t = bars[index].t;
    if (picking === 'from') { setRange({ from: t, to: Math.max(t, range.to) }); setPicking('to'); }
    else { setRange(t >= range.from ? { from: range.from, to: t } : { from: t, to: range.from }); setPicking('from'); }
  };

  const rows = useMemo(() => [...levels].reverse().slice(0, 14), [levels]);
  const where = (close: number, profile: Profile) => (close > profile.vahZone.high ? { text: 'VAH 區之上', tone: 'up' } : close < profile.valZone.low ? { text: 'VAL 區之下', tone: 'down' } : { text: '價值區內', tone: '' });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>台指期價值區</h1>
          <p className="lede">把一段時間的成交量按價格堆起來：量最大的那一格是 POC，往上下擴到涵蓋 {(pct * 100).toFixed(pct === 0.618 ? 1 : 0)}% 成交量為止，上緣那一格是 VAH，下緣那一格是 VAL。三者都是一格價格區間，不是一條線。</p>
        </div>
        <div className="controls">
          <FieldGroup label="區域來源"><Segmented label="區域來源" value={mode} onChange={setMode} options={[{ value: 'previous', label: '上一盤' }, { value: 'weekly', label: '週累計' }, { value: 'custom', label: '自選區間' }]} /></FieldGroup>
          <FieldGroup label="價值區比例"><Segmented label="價值區比例" value={pct} onChange={setPct} options={PCT_OPTIONS} /></FieldGroup>
        </div>
      </div>

      <section className="focus">
        <div className="focus-text">
          <h2>{focus.title}</h2>
          <p className="focus-source">來源：{focus.source}</p>
          {focus.profile ? (
            <dl className="zones">
              {(['vah', 'poc', 'val'] as const).map((kind) => {
                const zone = kind === 'vah' ? focus.profile!.vahZone : kind === 'poc' ? focus.profile!.pocZone : focus.profile!.valZone;
                const side = lastPrice > zone.high ? `現價在上方 ${pts(lastPrice - zone.high)} 點` : lastPrice < zone.low ? `現價在下方 ${pts(zone.low - lastPrice)} 點` : '現價在區內';
                return (
                  <div key={kind} className={`zone-row zone-row-${kind}`}>
                    <dt><ZoneName kind={kind} /></dt>
                    <dd className="num">{zoneText(zone)}</dd>
                    <dd className="zone-side">{side}</dd>
                  </div>
                );
              })}
            </dl>
          ) : <p className="empty">{mode === 'weekly' ? '這一盤要用的那段期間不在資料範圍內（資料只有最近幾週）。' : mode === 'custom' ? '選的區間裡沒有 K 棒。請在圖上點兩下，或調整下面的時間。' : '還沒有可用來計算的上一盤。'}</p>}
          <p className="note">{focus.note}{focus.profile ? ` 每格寬 ${pts(focus.profile.step, 1)} 點，共 ${focus.profile.bins.length} 格，${pts(focus.profile.barCount)} 根 3 分 K。` : ''}</p>
          {mode === 'custom' ? (
            <div className="range-inputs">
              <Field label="開始"><input type="datetime-local" value={toInput(range.from)} min={toInput(bars[0].t)} max={toInput(bars[bars.length - 1].t)} onChange={(event) => { const t = fromInput(event.target.value); if (t != null) setRange({ from: t, to: Math.max(t, range.to) }); }} /></Field>
              <Field label="結束"><input type="datetime-local" value={toInput(range.to)} min={toInput(bars[0].t)} max={toInput(bars[bars.length - 1].t)} onChange={(event) => { const t = fromInput(event.target.value); if (t != null) setRange({ from: Math.min(t, range.from), to: t }); }} /></Field>
              <p className="note">也可以直接在圖上點：下一次點擊會設定{picking === 'from' ? '開始' : '結束'}時間。時間為台北時間。</p>
            </div>
          ) : null}
        </div>
        {focus.profile ? <div className="focus-ladder"><Ladder profile={focus.profile} lastPrice={lastPrice} /><p className="note">每一列是一格價格，長度是那一格的成交量。</p></div> : null}
      </section>

      <section className="panel chart-panel">
        <div className="panel-head">
          <h2>3 分 K 與各盤的區域</h2>
          {mode !== 'custom' ? <label className="check"><input type="checkbox" checked={showTrades} onChange={(event) => setShowTrades(event.target.checked)} />顯示多空策略的進出場</label> : null}
        </div>
        <Chart
          bars={bars} spans={spans} bands={bands} markers={tradeMarks.markers} segments={tradeMarks.segments} selection={selection}
          futureBars={FUTURE} initialVisible={(window.innerWidth < 700 ? 200 : 430) + FUTURE} viewKey="tx" theme={theme} onPick={mode === 'custom' ? onPick : undefined}
          formatTime={(t, short) => (short ? hhmm(t) : clock(t))} label="台指期近月 3 分 K 線圖，疊上各盤的 POC、VAH、VAL 區域"
          ranges={[{ label: '一盤', bars: 280 }, { label: '一天', bars: 380 }, { label: '三天', bars: 1140 }, { label: '兩週', bars: 3800 }]}
        />
        <ul className="legend">
          <li><i className="swatch swatch-zone" />VAH 區、VAL 區（價值區的上下緣）</li>
          <li><i className="swatch swatch-poc" />POC 區（成交量最大）</li>
          <li><i className="swatch swatch-night" />夜盤</li>
          {showTrades && mode !== 'custom' ? <li><i className="swatch swatch-trade" />三角形是進場，圓點是出場，虛線代表這筆賠錢</li> : null}
        </ul>
        <p className="note">資料到 {clock(asOf)}（台北時間）。這不是即時報價：每一盤收盤後更新一次。</p>
      </section>

      {mode !== 'custom' ? (
        <section className="panel">
          <h2>最近各盤：用了哪些區域，收在哪裡</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>盤別</th><th>區域來源</th><th className="r">VAH 區</th><th className="r">POC 區</th><th className="r">VAL 區</th><th className="r">開盤</th><th className="r">最高</th><th className="r">最低</th><th className="r">收盤</th><th>收盤位置</th></tr></thead>
              <tbody>
                {rows.map(({ session, profile, sourceFrom, sourceTo }) => {
                  let high = -Infinity, low = Infinity;
                  for (let i = session.from; i <= session.to; i += 1) { if (bars[i].h > high) high = bars[i].h; if (bars[i].l < low) low = bars[i].l; }
                  const close = bars[session.to].c, place = profile ? where(close, profile) : null;
                  return (
                    <tr key={session.key}>
                      <td>{sessionLabel(session.key)}{session.complete ? '' : <span className="flag">進行中</span>}</td>
                      <td className="muted">{sourceText(sourceFrom, sourceTo)}</td>
                      <td className="r num">{profile ? zoneText(profile.vahZone) : '—'}</td>
                      <td className="r num">{profile ? zoneText(profile.pocZone) : '—'}</td>
                      <td className="r num">{profile ? zoneText(profile.valZone) : '—'}</td>
                      <td className="r num">{pts(bars[session.from].o)}</td>
                      <td className="r num">{pts(high)}</td>
                      <td className="r num">{pts(low)}</td>
                      <td className="r num">{pts(close)}</td>
                      <td className={place?.tone}>{place?.text ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
