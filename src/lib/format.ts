const pad = (value: number) => String(value).padStart(2, '0');
const taipei = (t: number) => new Date((t + 8 * 3600) * 1000);

/** Points, no decimals, thousands separators. */
export const pts = (value: number | null | undefined, digits = 0): string => (value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
/** Signed points, with a real minus sign. */
export const signed = (value: number | null | undefined, digits = 0): string => (value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${pts(Math.abs(value), digits)}`);
export const pct = (value: number | null | undefined, digits = 0): string => (value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`);
export const tone = (value: number | null | undefined): string => (value == null || value === 0 ? '' : value > 0 ? 'up' : 'down');

/** "11/25 10:27" in Taipei time. */
export const clock = (t: number): string => { const d = taipei(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
export const hhmm = (t: number): string => { const d = taipei(t); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
/** Value for an <input type="datetime-local">, Taipei time. */
export const toInput = (t: number): string => taipei(t).toISOString().slice(0, 16);
export const fromInput = (value: string): number | null => { const ms = Date.parse(`${value}:00+08:00`); return Number.isFinite(ms) ? ms / 1000 : null; };
/** "38,353–38,402" */
export const zoneText = (zone: { low: number; high: number }, digits = 0): string => `${pts(zone.low, digits)}–${pts(zone.high, digits)}`;
export const monthDay = (iso: string): string => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
