import { useEffect, useState } from 'react';
import type { Bar, BarsPayload } from './types';

/** URL of a file under the site's data folder; relative, so the site works from any path (GitHub Pages serves it under /tx-lens/). */
export const dataUrl = (name: string): string => `${import.meta.env.BASE_URL}data/${name}`;
/** Daily stock data published by the sister site (same GitHub Pages account). */
export const STOCK_DATA = 'https://arlolin2610.github.io/formosa-lens/data';

export interface Loaded<T> { data: T | null; error: string | null }

/** Fetch a static JSON file once per URL. */
export function useJson<T>(url: string | null): Loaded<T> {
  const [state, setState] = useState<Loaded<T> & { url: string | null }>({ data: null, error: null, url });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState({ data: null, error: null, url });
    fetch(url, { cache: 'no-cache' })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<T>; })
      .then((data) => { if (alive) setState({ data, error: null, url }); })
      .catch((error: unknown) => { if (alive) setState({ data: null, error: error instanceof Error ? error.message : String(error), url }); });
    return () => { alive = false; };
  }, [url]);
  return state.url === url ? state : { data: null, error: null };
}

export const unpackBars = (payload: BarsPayload): Bar[] => payload.t.map((t, i) => ({ t, o: payload.o[i], h: payload.h[i], l: payload.l[i], c: payload.c[i], v: payload.v[i] }));
