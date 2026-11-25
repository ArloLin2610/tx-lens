// Browser-local settings. No account, nothing leaves the device.
const read = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep in memory only */ } };

export type Theme = 'light' | 'dark' | 'auto';
export const loadTheme = (): Theme => read<Theme>('tx.theme', 'auto');
export const saveTheme = (theme: Theme) => write('tx.theme', theme);
export const loadSetting = <T,>(name: string, fallback: T): T => read<T>(`tx.${name}`, fallback);
export const saveSetting = (name: string, value: unknown) => write(`tx.${name}`, value);
