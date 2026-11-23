import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import {
  inferMimeType,
  isAllowedWebFile,
  isKnownBinaryExtension,
  MAX_FILE_SIZE_BYTES,
  normalizeWebsitePath,
} from './fileValidation.ts';

const MAX_TOTAL_IMPORT_BYTES = 35 * 1024 * 1024; // 35 MB
const MAX_TOTAL_FILES = 140;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

const SKIPPED_TRACKER_HOSTS = new Set([
  'www.googletagmanager.com',
  'googletagmanager.com',
  'www.google-analytics.com',
  'google-analytics.com',
  'connect.facebook.net',
  'www.facebook.com',
  'static.hotjar.com',
  'www.clarity.ms',
  'doubleclick.net',
  'stats.g.doubleclick.net',
  'widget.intercom.io',
  'client.crisp.chat',
  'embed.tawk.to',
]);

export interface ImportedWebsiteFile {
  path: string;
  name: string;
  mimeType: string;
  content: string;
  sizeBytes: number;
  kind: 'page' | 'asset';
}

export interface UrlImportResult {
  entryUrl: string;
  finalEntryUrl: string;
  detectedStack: string[];
  pagesImported: number;
  assetsImported: number;
  files: ImportedWebsiteFile[];
  skipped: string[];
}

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isSameSiteHost(hostA: string, hostB: string): boolean {
  return stripWww(hostA) === stripWww(hostB);
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function isPrivateOrBlockedIp(rawIp: string): boolean {
  const ip = rawIp.split('%')[0].trim().toLowerCase();
  const version = net.isIP(ip);
  if (version === 4) {
    return isBlockedIpv4(ip);
  }
  if (version === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) {
      const mappedV4 = ip.slice('::ffff:'.length);
      if (net.isIP(mappedV4) === 4) {
        return isBlockedIpv4(mappedV4);
      }
      return true;
    }
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // fc00::/7 ULA
    if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
      return true; // fe80::/10 link-local
    }
    if (ip.startsWith('ff')) return true; // ff00::/8 multicast
    return false;
  }
  return true;
}

export function parsePublicEntryUrl(rawInput: string): URL {
  const cleaned = rawInput.trim().replace(/^(https?:)\s*\/+\s*/i, '$1//');
  if (!cleaned) {
    throw new Error('Please enter a website URL to import.');
  }
  const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Invalid website URL. Example: https://example.com');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// website URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded username/password credentials are not allowed.');
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || (!host.includes('.') && host !== 'localhost')) {
    throw new Error('Please provide a valid public domain name (e.g. https://example.com).');
  }
  return parsed;
}

export async function assertPublicFetchUrl(urlStr: string): Promise<URL> {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URL are not allowed.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Local, internal, and metadata addresses cannot be imported.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrBlockedIp(host)) {
      throw new Error('Private or reserved IP addresses cannot be imported.');
    }
    return parsed;
  }

  const records = await dns.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error(`Could not resolve DNS for ${host}.`);
  }
  for (const rec of records) {
    if (isPrivateOrBlockedIp(rec.address)) {
      throw new Error(`Blocked non-public IP address resolved for ${host}.`);
    }
  }
  return parsed;
}

async function readLimitedBytes(res: Response, maxBytes: number): Promise<Buffer> {
  const clHeader = res.headers.get('content-length');
  if (clHeader) {
    const expected = Number.parseInt(clHeader, 10);
    if (Number.isFinite(expected) && expected > maxBytes) {
      throw new Error('File exceeds the 5 MB per-file safety limit.');
    }
  }
  if (!res.body) {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new Error('File exceeds the 5 MB per-file safety limit.');
    }
    return Buffer.from(ab);
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error('File exceeds the 5 MB per-file safety limit.');
        }
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function safeFetchUrl(
  rawUrl: string,
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
): Promise<{ finalUrl: string; status: number; contentType: string; bytes: Buffer }> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicFetchUrl(currentUrl);
    const res = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 WebManagerPro/1.0',
        Accept: accept,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect (${res.status}) with no Location header.`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${res.statusText || 'Error'})`);
    }

    const bytes = await readLimitedBytes(res, MAX_FILE_SIZE_BYTES);
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return {
      finalUrl: currentUrl,
      status: res.status,
      contentType,
      bytes,
    };
  }
  throw new Error('Too many redirects while fetching URL.');
}

function extFromContentType(contentType: string): string {
  if (contentType === 'text/html') return '.html';
  if (contentType === 'text/css') return '.css';
  if (contentType === 'application/javascript' || contentType === 'text/javascript') return '.js';
  if (contentType === 'application/json') return '.json';
  if (contentType === 'image/svg+xml') return '.svg';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/avif') return '.avif';
  if (contentType === 'image/x-icon' || contentType === 'image/vnd.microsoft.icon') return '.ico';
  if (contentType === 'font/woff2') return '.woff2';
  if (contentType === 'font/woff') return '.woff';
  if (contentType === 'font/ttf') return '.ttf';
  if (contentType === 'font/otf') return '.otf';
  if (contentType === 'application/pdf') return '.pdf';
  if (contentType === 'application/xml' || contentType === 'text/xml') return '.xml';
  return '';
}

function urlToPageWorkspacePath(pageUrl: URL, isEntrySinglePage: boolean): string {
  if (isEntrySinglePage) {
    return 'index.html';
  }
  let pathname = '/';
  try {
    pathname = decodeURIComponent(pageUrl.pathname || '/');
  } catch {
    pathname = pageUrl.pathname || '/';
  }
  const trimmed = pathname.replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.toLowerCase() === 'index.html' || trimmed.toLowerCase() === 'index.htm') {
    return 'index.html';
  }
  const hasHtmlExt = /\.(html?|php|asp|aspx|jsp)$/i.test(trimmed);
  let candidate = trimmed;
  if (/\.(php|asp|aspx|jsp)$/i.test(candidate)) {
    candidate = `${candidate.replace(/\.[^.]+$/, '')}.html`;
  } else if (!hasHtmlExt) {
    candidate = `${candidate}/index.html`;
  }
  if (pageUrl.search) {
    const hash = crypto.createHash('sha1').update(pageUrl.search).digest('hex').slice(0, 6);
    const extIdx = candidate.lastIndexOf('.');
    candidate =
      extIdx > 0
        ? `${candidate.slice(0, extIdx)}-${hash}${candidate.slice(extIdx)}`
        : `${candidate}-${hash}.html`;
  }
  return normalizeWebsitePath(candidate) || `page-${crypto.createHash('sha1').update(pageUrl.toString()).digest('hex').slice(0, 8)}.html`;
}

function urlToAssetWorkspacePath(
  assetUrl: URL,
  entryHost: string,
  contentType: string,
  usedPaths: Set<string>
): string {
  let pathname = '';
  try {
    pathname = decodeURIComponent(assetUrl.pathname || '');
  } catch {
    pathname = assetUrl.pathname || '';
  }
  let cleanPath = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleanPath) {
    cleanPath = 'asset';
  }

  const lastSegment = cleanPath.split('/').pop() || 'asset';
  const hasExtension = /\.[a-z0-9]{1,8}$/i.test(lastSegment);
  const inferredExt = extFromContentType(contentType);
  if (!hasExtension && inferredExt) {
    cleanPath = `${cleanPath}${inferredExt}`;
  } else if (assetUrl.search && (!hasExtension || cleanPath.includes('_next/image'))) {
    const hash = crypto.createHash('sha1').update(assetUrl.search).digest('hex').slice(0, 7);
    const dot = cleanPath.lastIndexOf('.');
    const ext = inferredExt || (dot > 0 ? cleanPath.slice(dot) : '.bin');
    const base = dot > 0 ? cleanPath.slice(0, dot) : cleanPath;
    cleanPath = `${base}-${hash}${ext}`;
  } else if (assetUrl.search) {
    // Same path with distinct version/variant query params -> append short hash only if colliding
    const probe = isSameSiteHost(assetUrl.hostname, entryHost)
      ? normalizeWebsitePath(cleanPath)
      : normalizeWebsitePath(`_external/${assetUrl.hostname.toLowerCase()}/${cleanPath}`);
    if (probe && usedPaths.has(probe)) {
      const hash = crypto.createHash('sha1').update(assetUrl.search).digest('hex').slice(0, 6);
      const dot = cleanPath.lastIndexOf('.');
      cleanPath = dot > 0 ? `${cleanPath.slice(0, dot)}-${hash}${cleanPath.slice(dot)}` : `${cleanPath}-${hash}`;
    }
  }

  const prefixed = isSameSiteHost(assetUrl.hostname, entryHost)
    ? cleanPath
    : `_external/${assetUrl.hostname.toLowerCase()}/${cleanPath}`;

  let normalized = normalizeWebsitePath(prefixed);
  if (!normalized || !isAllowedWebFile(normalized.split('/').pop() || '')) {
    const fallbackExt = inferredExt || '.bin';
    normalized = `_assets/file-${crypto.createHash('sha1').update(assetUrl.toString()).digest('hex').slice(0, 10)}${fallbackExt}`;
  }
  return normalized;
}

function detectSiteStack(html: string): string[] {
  const detected: string[] = [];
  if (/wp-content|wp-includes|name=["']generator["'][^>]*WordPress/i.test(html)) {
    detected.push('WordPress');
  }
  if (/__NEXT_DATA__|\/_next\/static\//i.test(html)) {
    detected.push('Next.js');
  }
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) {
    detected.push('Shopify');
  }
  if (/website-files\.com|data-wf-site/i.test(html)) {
    detected.push('Webflow');
  }
  if (/wixstatic\.com|wix\.com/i.test(html)) {
    detected.push('Wix');
  }
  if (/id=["'](root|app)["'][^>]*><\/div>|<script[^>]+type=["']module["']/i.test(html)) {
    detected.push('React / SPA');
  }
  if (detected.length === 0) {
    detected.push('HTML / Web Frontend');
  }
  return detected;
}

function extractHtmlReferences(html: string, baseUrl: string): {
  assetUrls: string[];
  pageUrls: string[];
} {
  const assets = new Set<string>();
  const pages = new Set<string>();

  const resolveUrl = (rawRef: string): string | null => {
    const clean = rawRef.trim().replace(/&amp;/g, '&');
    if (
      !clean ||
      clean.startsWith('#') ||
      /^(data:|blob:|javascript:|mailto:|tel:|sms:|about:)/i.test(clean)
    ) {
      return null;
    }
    try {
      const u = new URL(clean, baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      u.hash = '';
      return u.toString();
    } catch {
      return null;
    }
  };

  // <link ... href="...">
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    const tag = m[0];
    const href = m[1] ?? m[2] ?? m[3] ?? '';
    if (/\brel\s*=\s*(?:"(?:canonical|alternate|dns-prefetch|preconnect|pingback|shortlink)"|'(?:canonical|alternate|dns-prefetch|preconnect|pingback|shortlink)')/i.test(tag)) {
      continue;
    }
    const resolved = resolveUrl(href);
    if (resolved) assets.add(resolved);
  }

  // <script ... src="...">, <img ... src="...">, <source ... src="...">, <video ... src="...">, <audio ... src="...">
  for (const m of html.matchAll(
    /<(?:script|img|source|video|audio)\b[^>]*\b(?:src|data-src|data-lazy-src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  )) {
    const val = m[1] ?? m[2] ?? m[3] ?? '';
    const resolved = resolveUrl(val);
    if (resolved) assets.add(resolved);
  }

  // Additional lazy/poster attributes on tags that already have src
  for (const m of html.matchAll(/\b(?:data-src|data-lazy-src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const val = m[1] ?? m[2] ?? '';
    const resolved = resolveUrl(val);
    if (resolved) assets.add(resolved);
  }

  // srcset="..."
  for (const m of html.matchAll(/\b(?:srcset|data-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const rawSet = m[1] ?? m[2] ?? '';
    for (const part of rawSet.split(',')) {
      const urlToken = part.trim().split(/\s+/)[0];
      if (urlToken) {
        const resolved = resolveUrl(urlToken);
        if (resolved) assets.add(resolved);
      }
    }
  }

  // Inline css url(...)
  for (const m of html.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)) {
    const resolved = resolveUrl(m[2]);
    if (resolved) assets.add(resolved);
  }

  // Internal <a href="..."> pages
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = m[1] ?? m[2] ?? m[3] ?? '';
    const resolved = resolveUrl(href);
    if (resolved) pages.add(resolved);
  }

  return {
    assetUrls: Array.from(assets),
    pageUrls: Array.from(pages),
  };
}

function extractCssReferences(css: string, baseUrl: string): string[] {
  const refs = new Set<string>();
  const resolveRef = (rawRef: string) => {
    const clean = rawRef.trim();
    if (!clean || /^(data:|blob:|#)/i.test(clean)) return;
    try {
      const u = new URL(clean, baseUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        u.hash = '';
        refs.add(u.toString());
      }
    } catch {
      // ignore malformed URL
    }
  };

  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) {
    resolveRef(m[2]);
  }
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi)) {
    resolveRef(m[2]);
  }
  return Array.from(refs);
}

function computeRelativePath(fromFilePath: string, toFilePath: string): string {
  const fromDir = path.posix.dirname(fromFilePath);
  const rel = path.posix.relative(fromDir === '.' ? '' : fromDir, toFilePath);
  return rel || path.posix.basename(toFilePath);
}

function rewriteDocumentUrls(
  content: string,
  currentWorkspacePath: string,
  pageBaseUrl: string,
  urlToWorkspacePath: Map<string, string>,
  isCss: boolean
): string {
  const mapUrl = (rawRef: string): string | null => {
    const clean = rawRef.trim().replace(/&amp;/g, '&');
    if (
      !clean ||
      clean.startsWith('#') ||
      /^(data:|blob:|javascript:|mailto:|tel:|sms:|about:)/i.test(clean)
    ) {
      return null;
    }
    try {
      const resolved = new URL(clean, pageBaseUrl);
      const hash = resolved.hash || '';
      resolved.hash = '';
      const targetWorkspacePath = urlToWorkspacePath.get(resolved.toString());
      if (!targetWorkspacePath) return null;
      return `${computeRelativePath(currentWorkspacePath, targetWorkspacePath)}${hash}`;
    } catch {
      return null;
    }
  };

  if (isCss) {
    let updated = content.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q, ref) => {
      const mapped = mapUrl(ref);
      return mapped ? `url(${q || ''}${mapped}${q || ''})` : full;
    });
    updated = updated.replace(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi, (full, q, ref) => {
      const mapped = mapUrl(ref);
      if (!mapped) return full;
      return full.toLowerCase().includes('url(')
        ? `@import url(${q}${mapped}${q})`
        : `@import ${q}${mapped}${q}`;
    });
    return updated;
  }

  // Remove remote <base href="..."> so relative workspace paths resolve locally in preview/hosting
  let updated = content.replace(/<base\b[^>]*>/gi, '');

  // Rewrite HTML attributes href / src / data-src / data-lazy-src / poster
  updated = updated.replace(
    /\b(href|src|data-src|data-lazy-src|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (full, attr, _quoted, dqVal, sqVal) => {
      const rawVal = dqVal ?? sqVal ?? '';
      const quote = dqVal !== undefined ? '"' : "'";
      const mapped = mapUrl(rawVal);
      if (!mapped) return full;
      return `${attr}=${quote}${mapped}${quote}`;
    }
  );

  // Rewrite srcset attributes
  updated = updated.replace(
    /\b(srcset|data-srcset)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_full: string, attr: string, _quoted: string, dqVal?: string, sqVal?: string) => {
      const rawSet = String(dqVal ?? sqVal ?? '');
      const quote = dqVal !== undefined ? '"' : "'";
      const rewrittenParts = rawSet.split(',').map((part: string) => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const [urlToken, ...descriptors] = trimmed.split(/\s+/);
        const mapped = mapUrl(urlToken);
        return mapped ? [mapped, ...descriptors].join(' ') : part;
      });
      return `${attr}=${quote}${rewrittenParts.join(', ')}${quote}`;
    }
  );

  // Rewrite inline CSS url(...)
  updated = updated.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q, ref) => {
    const mapped = mapUrl(ref);
    return mapped ? `url(${q || ''}${mapped}${q || ''})` : full;
  });

  return updated;
}

function isLikelyHtmlPageLink(candidate: URL, entryHost: string): boolean {
  if (!isSameSiteHost(candidate.hostname, entryHost)) return false;
  const lowerPath = candidate.pathname.toLowerCase();
  if (
    lowerPath.startsWith('/wp-admin') ||
    lowerPath.startsWith('/wp-login') ||
    lowerPath.startsWith('/wp-json') ||
    lowerPath.startsWith('/cdn-cgi') ||
    lowerPath.includes('/feed/')
  ) {
    return false;
  }
  if (
    /\.(css|js|mjs|json|xml|svg|png|jpe?g|webp|gif|ico|avif|woff2?|ttf|otf|eot|pdf|zip|mp4|mp3|webm)$/i.test(
      lowerPath
    )
  ) {
    return false;
  }
  return true;
}

export async function importWebsiteFromUrl(options: {
  rawUrl: string;
  maxPages?: number;
  includeExternalAssets?: boolean;
}): Promise<UrlImportResult> {
  const parsedEntry = parsePublicEntryUrl(options.rawUrl);
  const maxPages = Math.max(1, Math.min(20, Number(options.maxPages) || 10));
  const includeExternalAssets = options.includeExternalAssets !== false;

  const pageQueue: string[] = [parsedEntry.toString()];
  const queuedPages = new Set<string>(pageQueue);
  const visitedPages = new Set<string>();

  const assetQueue: Array<{ url: string; depth: number }> = [];
  const queuedAssets = new Set<string>();

  const urlToWorkspacePath = new Map<string, string>();
  const usedPaths = new Set<string>();
  const rawEntries: Array<{
    sourceUrl: string;
    workspacePath: string;
    kind: 'page' | 'asset';
    contentType: string;
    bytes: Buffer;
  }> = [];
  const skipped: string[] = [];
  const stackSet = new Set<string>();
  let totalBytes = 0;
  let finalEntryUrl = parsedEntry.toString();
  let entryHost = parsedEntry.hostname;

  // 1. Crawl HTML pages (BFS up to maxPages)
  while (pageQueue.length > 0 && visitedPages.size < maxPages && rawEntries.length < MAX_TOTAL_FILES) {
    const nextPageUrl = pageQueue.shift()!;
    if (visitedPages.has(nextPageUrl)) continue;
    visitedPages.add(nextPageUrl);

    try {
      const fetched = await safeFetchUrl(nextPageUrl);
      if (visitedPages.size === 1) {
        finalEntryUrl = fetched.finalUrl;
        entryHost = new URL(fetched.finalUrl).hostname;
      }

      if (
        fetched.contentType &&
        !fetched.contentType.includes('html') &&
        !fetched.contentType.includes('xhtml') &&
        !fetched.contentType.includes('xml') &&
        !fetched.contentType.includes('text/plain')
      ) {
        // Entry or link turned out to be a direct non-HTML resource (e.g. CSS/JSON/image)
        if (visitedPages.size === 1) {
          throw new Error(`URL returned "${fetched.contentType}" instead of a web page.`);
        }
        continue;
      }

      totalBytes += fetched.bytes.length;
      if (totalBytes > MAX_TOTAL_IMPORT_BYTES) {
        skipped.push(`${nextPageUrl} (35 MB total import limit reached)`);
        break;
      }

      const htmlText = fetched.bytes.toString('utf8');
      for (const s of detectSiteStack(htmlText)) {
        stackSet.add(s);
      }

      const finalUrlObj = new URL(fetched.finalUrl);
      const workspacePath = urlToPageWorkspacePath(finalUrlObj, maxPages === 1 && visitedPages.size === 1);
      if (usedPaths.has(workspacePath)) {
        urlToWorkspacePath.set(nextPageUrl, workspacePath);
        urlToWorkspacePath.set(fetched.finalUrl, workspacePath);
        continue;
      }
      usedPaths.add(workspacePath);
      urlToWorkspacePath.set(nextPageUrl, workspacePath);
      urlToWorkspacePath.set(fetched.finalUrl, workspacePath);

      rawEntries.push({
        sourceUrl: fetched.finalUrl,
        workspacePath,
        kind: 'page',
        contentType: 'text/html',
        bytes: fetched.bytes,
      });

      const refs = extractHtmlReferences(htmlText, fetched.finalUrl);
      for (const assetUrl of refs.assetUrls) {
        if (!queuedAssets.has(assetUrl)) {
          try {
            const parsedAsset = new URL(assetUrl);
            if (SKIPPED_TRACKER_HOSTS.has(parsedAsset.hostname.toLowerCase())) continue;
            if (!includeExternalAssets && !isSameSiteHost(parsedAsset.hostname, entryHost)) continue;
            queuedAssets.add(assetUrl);
            assetQueue.push({ url: assetUrl, depth: 0 });
          } catch {
            // ignore malformed asset URL
          }
        }
      }

      if (visitedPages.size < maxPages) {
        for (const linkUrl of refs.pageUrls) {
          if (queuedPages.size >= maxPages * 3) break;
          try {
            const parsedLink = new URL(linkUrl);
            if (!isLikelyHtmlPageLink(parsedLink, entryHost)) continue;
            const canonical = parsedLink.toString();
            if (!queuedPages.has(canonical)) {
              queuedPages.add(canonical);
              pageQueue.push(canonical);
            }
          } catch {
            // ignore malformed page URL
          }
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Failed to fetch page';
      if (visitedPages.size === 1) {
        throw new Error(`Could not fetch ${nextPageUrl}: ${reason}`);
      }
      skipped.push(`${nextPageUrl} (${reason})`);
    }
  }

  // 2. Download referenced stylesheets, scripts, images, fonts (+ CSS sub-assets)
  while (assetQueue.length > 0 && rawEntries.length < MAX_TOTAL_FILES) {
    const item = assetQueue.shift()!;
    if (urlToWorkspacePath.has(item.url)) continue;

    try {
      const fetched = await safeFetchUrl(item.url, '*/*');
      if (totalBytes + fetched.bytes.length > MAX_TOTAL_IMPORT_BYTES) {
        skipped.push(`${item.url} (35 MB total import limit reached)`);
        break;
      }
      totalBytes += fetched.bytes.length;

      const finalUrlObj = new URL(fetched.finalUrl);
      const workspacePath = urlToAssetWorkspacePath(finalUrlObj, entryHost, fetched.contentType, usedPaths);
      if (usedPaths.has(workspacePath)) {
        urlToWorkspacePath.set(item.url, workspacePath);
        urlToWorkspacePath.set(fetched.finalUrl, workspacePath);
        continue;
      }
      usedPaths.add(workspacePath);
      urlToWorkspacePath.set(item.url, workspacePath);
      urlToWorkspacePath.set(fetched.finalUrl, workspacePath);

      rawEntries.push({
        sourceUrl: fetched.finalUrl,
        workspacePath,
        kind: 'asset',
        contentType: fetched.contentType || inferMimeType(workspacePath),
        bytes: fetched.bytes,
      });

      // Follow CSS @import and url(...) resources (depth <= 2)
      const isCss =
        fetched.contentType === 'text/css' || workspacePath.toLowerCase().endsWith('.css');
      if (isCss && item.depth < 2) {
        const cssText = fetched.bytes.toString('utf8');
        const subRefs = extractCssReferences(cssText, fetched.finalUrl);
        for (const subUrl of subRefs) {
          if (!queuedAssets.has(subUrl)) {
            try {
              const parsedSub = new URL(subUrl);
              if (SKIPPED_TRACKER_HOSTS.has(parsedSub.hostname.toLowerCase())) continue;
              if (!includeExternalAssets && !isSameSiteHost(parsedSub.hostname, entryHost)) continue;
              queuedAssets.add(subUrl);
              assetQueue.push({ url: subUrl, depth: item.depth + 1 });
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Failed to fetch asset';
      skipped.push(`${item.url} (${reason})`);
    }
  }

  if (assetQueue.length > 0 && rawEntries.length >= MAX_TOTAL_FILES) {
    skipped.push(`${assetQueue.length} additional asset(s) omitted (reached ${MAX_TOTAL_FILES}-file limit)`);
  }

  // 3. Serialize & rewrite HTML/CSS references so local preview & hosting work cleanly
  const files: ImportedWebsiteFile[] = rawEntries.map((entry) => {
    const fileName = entry.workspacePath.split('/').pop() || 'file';
    const isBinary =
      isKnownBinaryExtension(fileName) ||
      entry.bytes.includes(0) ||
      !Buffer.from(entry.bytes.toString('utf8'), 'utf8').equals(entry.bytes);

    if (isBinary) {
      const mimeType = entry.contentType || inferMimeType(fileName);
      return {
        path: entry.workspacePath,
        name: fileName,
        mimeType,
        content: `data:${mimeType};base64,${entry.bytes.toString('base64')}`,
        sizeBytes: entry.bytes.length,
        kind: entry.kind,
      };
    }

    let text = entry.bytes.toString('utf8');
    const isHtml =
      entry.kind === 'page' ||
      entry.contentType.includes('html') ||
      fileName.toLowerCase().endsWith('.html') ||
      fileName.toLowerCase().endsWith('.htm');
    const isCss =
      entry.contentType === 'text/css' || fileName.toLowerCase().endsWith('.css');

    if (isHtml || isCss) {
      text = rewriteDocumentUrls(
        text,
        entry.workspacePath,
        entry.sourceUrl,
        urlToWorkspacePath,
        isCss
      );
    }

    return {
      path: entry.workspacePath,
      name: fileName,
      mimeType: entry.contentType || inferMimeType(fileName),
      content: text,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      kind: entry.kind,
    };
  });

  const pagesImported = files.filter((f) => f.kind === 'page').length;
  const assetsImported = files.filter((f) => f.kind === 'asset').length;

  return {
    entryUrl: parsedEntry.toString(),
    finalEntryUrl,
    detectedStack: Array.from(stackSet),
    pagesImported,
    assetsImported,
    files,
    skipped,
  };
}
