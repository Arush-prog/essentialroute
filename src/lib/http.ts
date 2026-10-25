import { RATE_LIMIT_MS } from '../config';

/** Error with a user-facing message distinguishing network failure vs. service failure. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public kind: 'network' | 'http' | 'timeout' | 'aborted' | 'data',
    public status?: number,
  ) {
    super(message);
  }
}

const lastCall = new Map<string, number>();
const queues = new Map<string, Promise<void>>();

/** Serialises requests per host so we never exceed the provider's fair-use rate. */
function throttle(host: string): Promise<void> {
  const gap = RATE_LIMIT_MS[host] ?? 0;
  if (!gap) return Promise.resolve();
  const prev = queues.get(host) ?? Promise.resolve();
  const next = prev.then(async () => {
    const wait = (lastCall.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall.set(host, Date.now());
  });
  queues.set(host, next.catch(() => undefined));
  return next;
}

const memo = new Map<string, { at: number; data: unknown }>();

export interface FetchOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
  cacheMs?: number;
  init?: RequestInit;
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { signal, timeoutMs = 15_000, cacheMs = 0, init } = opts;
  const key = `${init?.method ?? 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`;
  if (cacheMs) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.data as T;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ServiceError('You appear to be offline.', 'network');
  }
  const host = new URL(url).host;
  await throttle(host);
  if (signal?.aborted) throw new ServiceError('Cancelled', 'aborted');

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
    if (!res.ok) {
      const msg =
        res.status === 429
          ? `${host} is rate-limiting requests. Please wait a moment and try again.`
          : `${host} returned an error (HTTP ${res.status}).`;
      throw new ServiceError(msg, 'http', res.status);
    }
    const data = (await res.json()) as T;
    if (cacheMs) memo.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    if (timedOut) throw new ServiceError(`${host} did not respond in time.`, 'timeout');
    if (signal?.aborted) throw new ServiceError('Cancelled', 'aborted');
    throw new ServiceError(`Could not reach ${host}. Check your connection.`, 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — non-critical */
  }
}
