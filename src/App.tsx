import { useEffect, useMemo, useState } from 'react';
import { dataUrl, unpackBars, useJson } from './lib/data';
import { clock } from './lib/format';
import { splitSessions } from './lib/session';
import { loadTheme, saveTheme, type Theme } from './lib/storage';
import type { BarsPayload } from './lib/types';
import { Avwap } from './pages/Avwap';
import { Method } from './pages/Method';
import { Strategy } from './pages/Strategy';
import { ValueArea } from './pages/ValueArea';

const NAV = [
  { hash: '#/', label: '價值區' },
  { hash: '#/strategy', label: '多空策略' },
  { hash: '#/avwap', label: '個股 AVWAP' },
  { hash: '#/method', label: '說明' },
];

const useHash = (): string => {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => { setHash(window.location.hash || '#/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
};

export function App() {
  const hash = useHash();
  const tx = useJson<BarsPayload>(dataUrl('tx.json'));
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const darkNow = theme === 'dark' || (theme === 'auto' && systemDark);

  const bars = useMemo(() => (tx.data ? unpackBars(tx.data) : []), [tx.data]);
  const sessions = useMemo(() => (tx.data ? splitSessions(bars, tx.data.meta.asOf) : []), [bars, tx.data]);
  const path = hash.split('?')[0];
  const active = NAV.find((item) => item.hash === path)?.hash ?? '#/';
  const themeName = darkNow ? 'dark' : 'light';

  let page: React.ReactNode;
  if (path === '#/avwap') page = <Avwap theme={themeName} />;
  else if (tx.error) page = <div className="notice notice-error"><strong>資料載入失敗</strong><p>讀不到台指期的資料檔（{tx.error}）。請重新整理；若持續發生，代表資料更新沒有成功。</p></div>;
  else if (!tx.data || !bars.length || !sessions.length) page = <div className="notice">載入資料中…</div>;
  else if (path === '#/strategy') page = <Strategy bars={bars} sessions={sessions} tradingDays={tx.data.meta.days.length} />;
  else if (path === '#/method') page = <Method meta={tx.data.meta} />;
  else page = <ValueArea bars={bars} sessions={sessions} asOf={tx.data.meta.asOf} theme={themeName} />;

  return (
    <div className="app">
      <header className="masthead">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">TX Lens</span>
          <span className="brand-sub">台指期價值區透鏡</span>
        </a>
        <nav className="nav" aria-label="主要頁面">
          {NAV.map((item) => <a key={item.hash} href={item.hash} aria-current={active === item.hash ? 'page' : undefined}>{item.label}</a>)}
        </nav>
        <button type="button" className="ghost" onClick={() => setTheme(darkNow ? 'light' : 'dark')}>{darkNow ? '淺色' : '深色'}</button>
      </header>
      <main>{page}</main>
      <footer className="footer">
        <p>本站依固定規則計算，不是投資建議，也不是即時報價。{tx.data ? `台指期資料到 ${clock(tx.data.meta.asOf)}（台北時間），共 ${tx.data.meta.days.length} 個交易日。` : ''}</p>
        <p>資料來源：臺灣期貨交易所逐筆成交檔、Yahoo 奇摩股市（當盤暫代）、Formosa Lens（個股日線）。</p>
      </footer>
    </div>
  );
}
