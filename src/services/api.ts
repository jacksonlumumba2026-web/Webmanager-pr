type TokenProvider = () => Promise<string | null>;

let activeTokenProvider: TokenProvider = async () => null;
let activeCacheScope = 'anon';

const CACHE_PREFIX = 'wmp_api_cache_v1:';
const MAX_CACHE_VALUE_CHARS = 180_000;
const MAX_CACHE_ENTRIES = 35;

export function setApiTokenProvider(provider: TokenProvider) {
  activeTokenProvider = provider;
}

export function setApiCacheScope(scope: string | null) {
  activeCacheScope = scope && scope.trim() ? scope.trim() : 'anon';
}

export function clearApiCache() {
  if (typeof window === 'undefined') return;
  try {
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) {
        keysToDelete.push(k);
      }
    }
    for (const k of keysToDelete) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage access errors
  }
}

export class ApiError extends Error {
  status: number;
  payload: unknown;
  isNetworkFailure: boolean;

  constructor(message: string, status: number, payload?: unknown, isNetworkFailure = false) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.isNetworkFailure = isNetworkFailure;
  }
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.isNetworkFailure || err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504;
  }
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return false;
}

function dispatchCacheFallback(usingCache: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('wmp:cache-fallback', { detail: { usingCache } }));
}

function isCacheableGetPath(path: string): boolean {
  if (!path.startsWith('/api/')) return false;
  if (path.startsWith('/api/health')) return false;
  if (path.startsWith('/api/github/auth-url')) return false;
  return true;
}

function getCacheKey(path: string): string {
  return `${CACHE_PREFIX}${activeCacheScope}:${path}`;
}

function readCachedResponse<T>(path: string): T | null {
  if (typeof window === 'undefined' || !isCacheableGetPath(path)) return null;
  try {
    const raw = window.localStorage.getItem(getCacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; savedAt: number };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function writeCachedResponse<T>(path: string, data: T): void {
  if (typeof window === 'undefined' || !isCacheableGetPath(path)) return;
  try {
    const serialized = JSON.stringify({ data, savedAt: Date.now() });
    if (serialized.length > MAX_CACHE_VALUE_CHARS) return;

    const existingKeys: Array<{ key: string; savedAt: number }> = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) {
        try {
          const parsed = JSON.parse(window.localStorage.getItem(k) || '{}') as { savedAt?: number };
          existingKeys.push({ key: k, savedAt: Number(parsed.savedAt || 0) });
        } catch {
          existingKeys.push({ key: k, savedAt: 0 });
        }
      }
    }

    if (existingKeys.length >= MAX_CACHE_ENTRIES) {
      existingKeys.sort((a, b) => a.savedAt - b.savedAt);
      const pruneCount = existingKeys.length - MAX_CACHE_ENTRIES + 1;
      for (let i = 0; i < pruneCount; i += 1) {
        window.localStorage.removeItem(existingKeys[i].key);
      }
    }

    window.localStorage.setItem(getCacheKey(path), serialized);
  } catch {
    // Ignore storage quota errors
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  skipCacheFallback?: boolean;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { timeoutMs = 20_000, skipCacheFallback = false, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';

  const token = await activeTokenProvider();
  const headers = new Headers(fetchOptions.headers || {});
  if (!headers.has('Content-Type') && fetchOptions.body && typeof fetchOptions.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // If offline and this is a cacheable GET request, return cached data immediately
  if (
    isIdempotent &&
    !skipCacheFallback &&
    typeof navigator !== 'undefined' &&
    !navigator.onLine
  ) {
    const cached = readCachedResponse<T>(path);
    if (cached !== null) {
      dispatchCacheFallback(true);
      return cached;
    }
  }

  const maxAttempts = isIdempotent ? 3 : 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = fetchOptions.signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetch(path, {
        ...fetchOptions,
        headers,
        signal: fetchOptions.signal || controller?.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();

      if (!res.ok) {
        const message =
          typeof data === 'object' && data && 'error' in data
            ? String((data as { error: unknown }).error)
            : `Request failed with status ${res.status}`;
        const retryableStatus = res.status === 502 || res.status === 503 || res.status === 504;
        const apiErr = new ApiError(message, res.status, data, retryableStatus);

        if (isIdempotent && retryableStatus && attempt < maxAttempts - 1) {
          lastError = apiErr;
          await sleep(450 * (attempt + 1));
          continue;
        }
        throw apiErr;
      }

      if (isIdempotent) {
        writeCachedResponse(path, data);
        dispatchCacheFallback(false);
      }
      return data as T;
    } catch (err) {
      if (err instanceof ApiError && !err.isNetworkFailure) {
        throw err;
      }
      lastError = err;
      if (isIdempotent && attempt < maxAttempts - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Final fallback for idempotent GET requests on network failure / timeout
  if (isIdempotent && !skipCacheFallback) {
    const cached = readCachedResponse<T>(path);
    if (cached !== null) {
      dispatchCacheFallback(true);
      return cached;
    }
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  const networkMsg =
    lastError instanceof DOMException && lastError.name === 'AbortError'
      ? 'Request timed out on a slow network. Please try again.'
      : 'Unable to reach server. Check your internet connection and try again.';
  throw new ApiError(networkMsg, 0, lastError, true);
}

