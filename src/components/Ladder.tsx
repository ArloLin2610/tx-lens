import type { Profile } from '@/lib/profile';
import { pts } from '@/lib/format';

/**
 * The volume profile on its side: one row per price bin, highest price on top, bar length = volume.
 * The three zones are the coloured rows; the rows between VAL and VAH are the value area.
 */
export function Ladder({ profile, lastPrice, digits = 0 }: { profile: Profile; lastPrice: number | null; digits?: number }) {
  const W = 280, H = 330, LEFT = 74, TOP = 14, BOTTOM = 14;
  const count = profile.bins.length, rowH = (H - TOP - BOTTOM) / count;
  const maxVolume = Math.max(...profile.bins);
  const yOfIndex = (index: number) => TOP + (count - 1 - index) * rowH; // top of the row for bin `index`
  const yOfPrice = (price: number) => (profile.step > 0 ? TOP + ((profile.high - price) / (profile.high - profile.low)) * (H - TOP - BOTTOM) : TOP + rowH / 2);
  const kindOf = (index: number) => (index === profile.pocIndex ? 'poc' : index === profile.upperIndex ? 'vah' : index === profile.lowerIndex ? 'val' : index > profile.lowerIndex && index < profile.upperIndex ? 'inside' : 'outside');

  // Price labels: the range ends and the outer edge of each zone, dropping any that would overlap one already placed.
  const wanted: Array<{ price: number; kind: string }> = [
    { price: profile.vahZone.high, kind: 'vah' }, { price: profile.valZone.low, kind: 'val' }, { price: profile.poc, kind: 'poc' },
    { price: profile.high, kind: 'edge' }, { price: profile.low, kind: 'edge' },
  ];
  const labels: Array<{ price: number; kind: string; y: number }> = [];
  for (const item of wanted) { const y = yOfPrice(item.price); if (labels.every((placed) => Math.abs(placed.y - y) >= 15)) labels.push({ ...item, y }); }

  const inRange = lastPrice != null && lastPrice <= profile.high && lastPrice >= profile.low;
  const lastY = lastPrice == null ? null : inRange ? yOfPrice(lastPrice) : lastPrice > profile.high ? TOP - 6 : H - BOTTOM + 6;

  return (
    <svg className="ladder" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`成交量分布：最高 ${pts(profile.high, digits)}，最低 ${pts(profile.low, digits)}，共 ${count} 格`}>
      {profile.bins.map((volume, index) => {
        const kind = kindOf(index), width = maxVolume ? Math.max(volume > 0 ? 1.5 : 0, (volume / maxVolume) * (W - LEFT - 8)) : 0;
        return <rect key={index} className={`ladder-bar ladder-${kind}`} x={LEFT} y={yOfIndex(index) + (rowH > 3 ? 0.5 : 0)} width={width} height={Math.max(0.6, rowH - (rowH > 3 ? 1 : 0))} />;
      })}
      <line className="ladder-axis" x1={LEFT - 0.5} x2={LEFT - 0.5} y1={TOP} y2={H - BOTTOM} />
      {labels.map((item) => (
        <g key={`${item.kind}-${item.price}`}>
          <line className="ladder-tick" x1={LEFT - 5} x2={LEFT} y1={item.y} y2={item.y} />
          <text className={`ladder-label ladder-label-${item.kind}`} x={LEFT - 8} y={item.y} textAnchor="end" dominantBaseline="middle">{pts(item.price, digits)}</text>
        </g>
      ))}
      {lastY != null && lastPrice != null ? (
        <g className="ladder-last">
          {inRange ? <line x1={LEFT} x2={W - 4} y1={lastY} y2={lastY} /> : null}
          <path d={`M${W - 4},${lastY} l-9,-5.5 v11 z`} />
          <text x={W - 16} y={lastY + (inRange ? -6 : lastPrice > profile.high ? 4 : -3)} textAnchor="end" dominantBaseline={inRange ? 'auto' : 'middle'}>現價 {pts(lastPrice, digits)}{inRange ? '' : lastPrice > profile.high ? '（在範圍之上）' : '（在範圍之下）'}</text>
        </g>
      ) : null}
    </svg>
  );
}
