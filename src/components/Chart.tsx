import { useEffect, useRef } from 'react';
import type { Bar } from '@/lib/types';

/** A horizontal price zone drawn across a run of bars. `to` may run past the last bar to project it forward. */
export interface ChartBand { from: number; to: number; low: number; high: number; kind: 'vah' | 'poc' | 'val'; label?: string }
export interface ChartLine { values: Array<number | null>; kind: 'primary' | 'secondary' | 'anchor'; label: string }
export interface ChartMarker { index: number; price: number; kind: 'long' | 'short' | 'anchor' }
/** A trade drawn from entry to exit. */
export interface ChartSegment { from: number; fromPrice: number; to: number; toPrice: number; win: boolean }
/** A labelled stretch of bars (a session); shaded ones get a tinted background. */
export interface ChartSpan { from: number; to: number; label: string; shade: boolean }

interface Props {
  bars: Bar[];
  spans?: ChartSpan[];
  bands?: ChartBand[];
  lines?: ChartLine[];
  markers?: ChartMarker[];
  segments?: ChartSegment[];
  /** Highlighted index range (the reader's own selection). */
  selection?: { from: number; to: number } | null;
  /** Empty room to the right of the last bar, in bars, for projected zones. */
  futureBars?: number;
  /** Bars visible when the chart (re)opens; changing `viewKey` reapplies it. */
  initialVisible: number;
  viewKey: string;
  digits?: number;
  formatTime: (t: number, short: boolean) => string;
  onPick?: (index: number) => void;
  /** Buttons that jump to "the last N bars". */
  ranges?: Array<{ label: string; bars: number }>;
  /** Re-read the colours when this changes (light / dark). */
  theme: string;
  height?: number;
  label: string;
}

const AXIS_W = 66, AXIS_H = 24, TOP = 22, MIN_VISIBLE = 24;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

const niceStep = (range: number, target: number): number => {
  const raw = range / Math.max(1, target), power = 10 ** Math.floor(Math.log10(raw)), unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
};

export function Chart({ bars, spans = [], bands = [], lines = [], markers = [], segments = [], selection = null, futureBars = 0, initialVisible, viewKey, digits = 0, formatTime, onPick, ranges = [], theme, height = 460, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useRef({ start: 0, count: 100 });
  const hover = useRef<{ x: number; y: number } | null>(null);
  const size = useRef({ w: 0, h: height });
  const draw = useRef<() => void>(() => undefined);
  const total = bars.length + futureBars;

  // Latest props for the draw routine and the pointer handlers, without re-binding listeners on every render.
  const props = useRef({ bars, spans, bands, lines, markers, segments, selection, digits, formatTime, onPick, total });
  props.current = { bars, spans, bands, lines, markers, segments, selection, digits, formatTime, onPick, total };

  useEffect(() => {
    const count = clamp(initialVisible, MIN_VISIBLE, Math.max(MIN_VISIBLE, total));
    view.current = { start: Math.max(0, total - count), count };
    draw.current();
    // Reset the window only when the caller says the subject changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    draw.current = () => {
      const p = props.current, { w, h } = size.current;
      if (!w || !p.bars.length) return;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const css = getComputedStyle(canvas);
      const color = (name: string) => css.getPropertyValue(name).trim();
      const C = { panel: color('--panel'), ink: color('--ink'), ink3: color('--ink-3'), rule: color('--rule'), soft: color('--rule-soft'), up: color('--up'), down: color('--down'), zone: color('--zone'), poc: color('--poc'), night: color('--night'), accent: color('--accent') };
      const font = (weight: number, px: number) => `${weight} ${px}px ${css.getPropertyValue('--font-num').trim() || 'sans-serif'}`;
      const fmt = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: p.digits, maximumFractionDigits: p.digits });

      const plotW = w - AXIS_W, plotH = h - AXIS_H - TOP;
      view.current.count = clamp(view.current.count, MIN_VISIBLE, Math.max(MIN_VISIBLE, p.total));
      view.current.start = clamp(view.current.start, 0, Math.max(0, p.total - view.current.count));
      const { start, count } = view.current;
      const barW = plotW / count;
      const x = (index: number) => (index - start + 0.5) * barW;
      const first = Math.max(0, Math.floor(start)), last = Math.min(p.bars.length - 1, Math.ceil(start + count) - 1);

      // Price range: the visible bars and lines, plus zones that sit close enough not to squash the candles.
      let low = Infinity, high = -Infinity;
      for (let i = first; i <= last; i += 1) { if (p.bars[i].l < low) low = p.bars[i].l; if (p.bars[i].h > high) high = p.bars[i].h; }
      for (const line of p.lines) for (let i = first; i <= last; i += 1) { const value = line.values[i]; if (value != null) { if (value < low) low = value; if (value > high) high = value; } }
      if (!Number.isFinite(low)) { low = 0; high = 1; }
      const reach = Math.max(high - low, high * 0.002) * 0.7;
      const visibleBands = p.bands.filter((band) => band.to >= start && band.from <= start + count);
      for (const band of visibleBands) { if (band.high > high && band.high - high <= reach) high = band.high; if (band.low < low && low - band.low <= reach) low = band.low; }
      const pad = (high - low || 1) * 0.07;
      low -= pad; high += pad;
      const volumeH = plotH * 0.16;
      const y = (price: number) => TOP + (high - price) / (high - low) * (plotH - volumeH - 6);

      context.clearRect(0, 0, w, h);
      context.fillStyle = C.panel;
      context.fillRect(0, 0, w, h);
      context.save();
      context.beginPath(); context.rect(0, TOP - 2, plotW, plotH + 2); context.clip();

      // Session backgrounds.
      for (const span of p.spans) {
        if (span.to < start || span.from > start + count || !span.shade) continue;
        context.fillStyle = C.night;
        context.fillRect(x(span.from) - barW / 2, TOP, (span.to - span.from + 1) * barW, plotH);
      }
      if (p.selection) {
        context.fillStyle = C.accent; context.globalAlpha = 0.1;
        context.fillRect(x(p.selection.from) - barW / 2, TOP, (p.selection.to - p.selection.from + 1) * barW, plotH);
        context.globalAlpha = 1;
      }

      // Horizontal grid.
      const step = niceStep(high - low, plotH / 56);
      context.strokeStyle = C.soft; context.lineWidth = 1;
      for (let price = Math.ceil(low / step) * step; price < high; price += step) { const py = Math.round(y(price)) + 0.5; if (py < TOP + 4 || py > TOP + plotH - volumeH) continue; context.beginPath(); context.moveTo(0, py); context.lineTo(plotW, py); context.stroke(); }

      // Zones.
      for (const band of visibleBands) {
        const tone = band.kind === 'poc' ? C.poc : C.zone;
        const left = x(band.from) - barW / 2, right = x(band.to) + barW / 2;
        const top = y(band.high), bottom = y(band.low);
        context.fillStyle = tone; context.globalAlpha = band.kind === 'poc' ? 0.26 : 0.2;
        context.fillRect(left, top, right - left, Math.max(1.5, bottom - top));
        context.globalAlpha = 0.9; context.fillRect(left, top, right - left, 1); context.fillRect(left, Math.max(top + 1, bottom - 1), right - left, 1);
        context.globalAlpha = 1;
      }

      // Volume.
      let maxVolume = 0;
      for (let i = first; i <= last; i += 1) if (p.bars[i].v > maxVolume) maxVolume = p.bars[i].v;
      const bodyW = Math.max(1, Math.min(14, barW * 0.68));
      context.globalAlpha = 0.35;
      for (let i = first; i <= last; i += 1) {
        const bar = p.bars[i];
        if (!maxVolume) break;
        const barH = (bar.v / maxVolume) * volumeH;
        context.fillStyle = bar.c >= bar.o ? C.up : C.down;
        context.fillRect(x(i) - bodyW / 2, TOP + plotH - barH, bodyW, barH);
      }
      context.globalAlpha = 1;

      // Candles.
      for (let i = first; i <= last; i += 1) {
        const bar = p.bars[i], cx = x(i);
        const tone = bar.c >= bar.o ? C.up : C.down;
        context.fillStyle = tone;
        context.fillRect(Math.round(cx) - 0.5, y(bar.h), 1, Math.max(1, y(bar.l) - y(bar.h)));
        if (bodyW >= 2) { const top = y(Math.max(bar.o, bar.c)), bottom = y(Math.min(bar.o, bar.c)); context.fillRect(cx - bodyW / 2, top, bodyW, Math.max(1, bottom - top)); }
      }

      // Lines (anchored VWAP and the like).
      for (const line of p.lines) {
        context.strokeStyle = line.kind === 'primary' ? C.accent : line.kind === 'secondary' ? C.ink3 : C.poc;
        context.lineWidth = line.kind === 'primary' ? 2 : 1.25;
        context.setLineDash(line.kind === 'anchor' ? [5, 4] : []);
        context.beginPath();
        let pen = false;
        for (let i = first; i <= last; i += 1) { const value = line.values[i]; if (value == null) { pen = false; continue; } if (pen) context.lineTo(x(i), y(value)); else { context.moveTo(x(i), y(value)); pen = true; } }
        context.stroke();
        context.setLineDash([]);
      }

      // Trades: a line from entry to exit, and an arrow at the entry.
      for (const segment of p.segments) {
        if (segment.to < start || segment.from > start + count) continue;
        context.strokeStyle = C.ink; context.globalAlpha = 0.7; context.lineWidth = 1.25; context.setLineDash(segment.win ? [] : [3, 3]);
        context.beginPath(); context.moveTo(x(segment.from), y(segment.fromPrice)); context.lineTo(x(segment.to), y(segment.toPrice)); context.stroke();
        context.setLineDash([]);
        context.fillStyle = C.panel; context.strokeStyle = C.ink; context.globalAlpha = 1;
        context.beginPath(); context.arc(x(segment.to), y(segment.toPrice), 3.2, 0, Math.PI * 2); context.fill(); context.stroke();
      }
      for (const marker of p.markers) {
        if (marker.index < start - 1 || marker.index > start + count) continue;
        const cx = x(marker.index), cy = y(marker.price);
        if (marker.kind === 'anchor') { context.fillStyle = C.accent; context.beginPath(); context.arc(cx, cy, 5, 0, Math.PI * 2); context.fill(); context.strokeStyle = C.panel; context.lineWidth = 2; context.stroke(); continue; }
        const up = marker.kind === 'long', s = 6;
        context.fillStyle = C.ink; context.strokeStyle = C.panel; context.lineWidth = 1.5;
        context.beginPath();
        if (up) { context.moveTo(cx, cy + 4); context.lineTo(cx - s, cy + 4 + s * 1.5); context.lineTo(cx + s, cy + 4 + s * 1.5); }
        else { context.moveTo(cx, cy - 4); context.lineTo(cx - s, cy - 4 - s * 1.5); context.lineTo(cx + s, cy - 4 - s * 1.5); }
        context.closePath(); context.fill(); context.stroke();
      }

      // Session boundaries and names.
      context.font = font(600, 11.5); context.textBaseline = 'top';
      for (const span of p.spans) {
        if (span.to < start || span.from > start + count) continue;
        const left = x(span.from) - barW / 2;
        context.fillStyle = C.rule; context.fillRect(Math.round(left), TOP, 1, plotH);
        const width = (span.to - span.from + 1) * barW;
        if (width > context.measureText(span.label).width + 12) { context.fillStyle = C.ink3; context.fillText(span.label, Math.max(left, 0) + 6, TOP + 5); }
      }
      context.restore();

      // Zone tags on the right edge of the plot.
      context.font = font(600, 11.5); context.textBaseline = 'middle';
      const tags = visibleBands.filter((band) => band.label).map((band) => ({ band, py: y((band.high + band.low) / 2) })).filter((tag) => tag.py > TOP && tag.py < TOP + plotH - volumeH).sort((a, b) => a.py - b.py);
      let lastTagY = -Infinity;
      for (const tag of tags) {
        const py = Math.max(tag.py, lastTagY + 16); lastTagY = py;
        const text = tag.band.label as string, width = context.measureText(text).width + 12;
        const right = Math.min(plotW - 4, x(tag.band.to) + barW / 2 - 4);
        context.fillStyle = tag.band.kind === 'poc' ? C.poc : C.zone;
        context.fillRect(right - width, py - 8, width, 16);
        context.fillStyle = '#fff'; context.fillText(text, right - width + 6, py + 0.5);
      }

      // Price axis.
      context.fillStyle = C.panel; context.fillRect(plotW, 0, AXIS_W, h);
      context.fillStyle = C.rule; context.fillRect(plotW, TOP, 1, plotH);
      context.font = font(500, 12); context.fillStyle = C.ink3; context.textBaseline = 'middle';
      for (let price = Math.ceil(low / step) * step; price < high; price += step) { const py = y(price); if (py < TOP + 6 || py > TOP + plotH - volumeH) continue; context.fillText(fmt(price), plotW + 7, py); }
      const lastBar = p.bars[p.bars.length - 1];
      if (lastBar && lastBar.c > low && lastBar.c < high) {
        const py = y(lastBar.c);
        context.fillStyle = C.ink; context.fillRect(plotW + 1, py - 9, AXIS_W - 1, 18);
        context.fillStyle = C.panel; context.font = font(600, 12); context.fillText(fmt(lastBar.c), plotW + 7, py + 0.5);
      }

      // Time axis.
      context.fillStyle = C.rule; context.fillRect(0, TOP + plotH, plotW, 1);
      context.font = font(500, 11.5); context.fillStyle = C.ink3; context.textBaseline = 'top';
      const every = Math.max(1, Math.round(count / Math.max(2, Math.floor(plotW / 110))));
      for (let i = Math.ceil(first / every) * every; i <= last; i += every) { const cx = x(i); if (cx < 24 || cx > plotW - 30) continue; const text = p.formatTime(p.bars[i].t, true); context.fillText(text, cx - context.measureText(text).width / 2, TOP + plotH + 6); }

      // Crosshair and read-out.
      const pointer = hover.current;
      let readout = lastBar ? lastBar : null, readoutIndex = p.bars.length - 1;
      if (pointer && pointer.x < plotW && pointer.y > TOP && pointer.y < TOP + plotH) {
        const index = clamp(Math.floor(pointer.x / barW + start), 0, p.bars.length - 1);
        if (index >= first && index <= last) { readout = p.bars[index]; readoutIndex = index; }
        const cx = Math.round(Math.min(x(index), plotW)) + 0.5, cy = Math.round(pointer.y) + 0.5;
        context.strokeStyle = C.ink3; context.lineWidth = 1; context.setLineDash([3, 3]);
        context.beginPath(); context.moveTo(cx, TOP); context.lineTo(cx, TOP + plotH); context.moveTo(0, cy); context.lineTo(plotW, cy); context.stroke();
        context.setLineDash([]);
        const price = high - (pointer.y - TOP) / (plotH - volumeH - 6) * (high - low);
        if (pointer.y < TOP + plotH - volumeH) { context.fillStyle = C.accent; context.fillRect(plotW + 1, cy - 9, AXIS_W - 1, 18); context.fillStyle = '#fff'; context.font = font(600, 12); context.textBaseline = 'middle'; context.fillText(fmt(price), plotW + 7, cy); }
      }
      if (readout) {
        context.font = font(500, 12.5); context.textBaseline = 'top';
        const tone = readout.c >= readout.o ? C.up : C.down;
        const parts: Array<[string, string]> = [[p.formatTime(readout.t, false), C.ink], [`開 ${fmt(readout.o)}`, tone], [`高 ${fmt(readout.h)}`, tone], [`低 ${fmt(readout.l)}`, tone], [`收 ${fmt(readout.c)}`, tone], [`量 ${Math.round(readout.v).toLocaleString('en-US')}`, C.ink3]];
        for (const line of p.lines) { const value = line.values[readoutIndex]; if (value != null && line.kind !== 'anchor') parts.push([`${line.label} ${fmt(value)}`, line.kind === 'primary' ? C.accent : C.ink3]); }
        let cx = 2;
        context.fillStyle = C.panel; context.fillRect(0, 0, w, TOP - 3);
        for (const [text, tint] of parts) { const width = context.measureText(text).width; if (cx + width > w - 4) break; context.fillStyle = tint; context.fillText(text, cx, 3); cx += width + 14; }
      }
    };

    const resize = () => { const rect = canvas.getBoundingClientRect(); size.current = { w: rect.width, h: rect.height }; draw.current(); };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // Pointer handling: drag to pan, wheel or pinch to zoom, click to pick a bar.
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; start: number; moved: boolean } | null = null;
    let pinch: { distance: number; count: number; centre: number } | null = null;
    const local = (event: PointerEvent | WheelEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const zoomAt = (px: number, factor: number) => {
      const plotW = size.current.w - AXIS_W, v = view.current, total = props.current.total;
      const anchor = v.start + (px / plotW) * v.count;
      const count = clamp(v.count * factor, MIN_VISIBLE, Math.max(MIN_VISIBLE, total));
      view.current = { count, start: clamp(anchor - (px / plotW) * count, 0, Math.max(0, total - count)) };
    };
    const onDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, local(event));
      if (pointers.size === 1) dragStart = { x: event.clientX, start: view.current.start, moved: false };
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, count: view.current.count, centre: (a.x + b.x) / 2 }; dragStart = null; }
    };
    const onMove = (event: PointerEvent) => {
      const point = local(event);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const factor = pinch.distance / (Math.hypot(a.x - b.x, a.y - b.y) || 1);
        const target = clamp(pinch.count * factor, MIN_VISIBLE, Math.max(MIN_VISIBLE, props.current.total));
        zoomAt(pinch.centre, target / view.current.count);
      } else if (dragStart) {
        const dx = event.clientX - dragStart.x;
        if (Math.abs(dx) > 3) dragStart.moved = true;
        const plotW = size.current.w - AXIS_W;
        view.current.start = clamp(dragStart.start - (dx / plotW) * view.current.count, 0, Math.max(0, props.current.total - view.current.count));
      }
      hover.current = event.pointerType === 'touch' && pointers.size !== 1 ? null : point;
      draw.current();
    };
    const onUp = (event: PointerEvent) => {
      const wasClick = dragStart && !dragStart.moved && pointers.size === 1;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasClick && props.current.onPick) {
        const point = local(event), plotW = size.current.w - AXIS_W;
        if (point.x < plotW) props.current.onPick(clamp(Math.floor(point.x / (plotW / view.current.count) + view.current.start), 0, props.current.bars.length - 1));
      }
      if (!pointers.size) dragStart = null;
    };
    const onLeave = () => { hover.current = null; draw.current(); };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = local(event);
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) view.current.start = clamp(view.current.start + (event.deltaX / (size.current.w - AXIS_W)) * view.current.count, 0, Math.max(0, props.current.total - view.current.count));
      else zoomAt(point.x, Math.exp(event.deltaY * 0.0016));
      draw.current();
    };
    const onKey = (event: KeyboardEvent) => {
      const v = view.current, total = props.current.total;
      if (event.key === 'ArrowLeft') v.start = clamp(v.start - v.count * 0.2, 0, Math.max(0, total - v.count));
      else if (event.key === 'ArrowRight') v.start = clamp(v.start + v.count * 0.2, 0, Math.max(0, total - v.count));
      else if (event.key === '+' || event.key === '=') zoomAt((size.current.w - AXIS_W) / 2, 0.8);
      else if (event.key === '-') zoomAt((size.current.w - AXIS_W) / 2, 1.25);
      else return;
      event.preventDefault();
      draw.current();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
  }, []);

  // Any change in what is shown redraws.
  useEffect(() => { draw.current(); });

  /** Show the last `count` bars (used by the range buttons). */
  const show = (count: number) => { const next = clamp(count, MIN_VISIBLE, Math.max(MIN_VISIBLE, total)); view.current = { count: next, start: Math.max(0, total - next) }; draw.current(); };

  return (
    <div className="chart" data-theme-tick={theme}>
      <canvas ref={canvasRef} className={onPick ? 'pickable' : undefined} style={{ height }} tabIndex={0} role="img" aria-label={label} />
      <div className="chart-ranges" role="group" aria-label="顯示範圍">
        {ranges.map((option) => <button key={option.label} type="button" onClick={() => show(option.bars + futureBars)}>{option.label}</button>)}
        <span className="chart-hint">拖曳平移，滾輪或雙指縮放{onPick ? '，點一下 K 棒選取' : ''}</span>
      </div>
    </div>
  );
}
