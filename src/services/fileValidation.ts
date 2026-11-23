const BINARY_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.avif',
  '.bmp',
]);

const KNOWN_BINARY_EXTENSIONS = new Set([
  ...BINARY_IMAGE_EXTENSIONS,
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mkv',
  '.zip',
  '.gz',
  '.tar',
  '.tgz',
  '.rar',
  '.7z',
  '.bz2',
  '.xz',
  '.whl',
  '.jar',
  '.war',
  '.wasm',
  '.pyc',
  '.pyo',
  '.pyd',
  '.so',
  '.dll',
  '.exe',
  '.bin',
  '.dat',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.class',
  '.o',
  '.a',
]);

const IGNORED_SYSTEM_FILENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function getFileExtension(filename: string): string {
  const lower = filename.toLowerCase().trim();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx <= 0 && lower.startsWith('.')) {
    return lower; // dotfiles like .gitignore, .env
  }
  if (dotIdx === -1) return '';
  return lower.slice(dotIdx);
}

export function isBinaryImageFile(filename: string): boolean {
  return BINARY_IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

export function isKnownBinaryExtension(filename: string): boolean {
  return KNOWN_BINARY_EXTENSIONS.has(getFileExtension(filename));
}

export function isDataUrlPayload(content: string): boolean {
  return /^data:[^;]+;base64,[A-Za-z0-9+/=\s]+$/i.test(content.trim());
}

export function normalizeWebsitePath(rawPath: string): string | null {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed || trimmed.length > 300) return null;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;

  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  for (const rawSeg of segments) {
    const seg = rawSeg.trim();
    if (!seg || seg === '.' || seg === '..') return null;
    if (/[<>:"\\|?*]/.test(seg)) return null;
  }
  return segments.map((s) => s.trim()).join('/');
}

export function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase().trim();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) return 'text/css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.jsx')) {
    return 'application/javascript';
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'application/typescript';
  if (lower.endsWith('.json') || lower.endsWith('.ipynb')) return 'application/json';
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'text/markdown';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.otf')) return 'font/otf';
  if (lower.endsWith('.eot')) return 'application/vnd.ms-fontobject';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.wasm')) return 'application/wasm';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.xml')) return 'application/xml';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.py') || lower.endsWith('.pyw') || lower.endsWith('.pyi')) return 'text/x-python';
  if (lower.endsWith('.php')) return 'application/x-httpd-php';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'application/x-sh';
  if (lower.endsWith('.sql')) return 'application/sql';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'text/yaml';
  if (lower.endsWith('.toml')) return 'application/toml';
  if (isKnownBinaryExtension(lower)) return 'application/octet-stream';
  return 'text/plain';
}

export function isAllowedWebFile(filename: string): boolean {
  const lower = filename.toLowerCase().trim();
  if (!lower || IGNORED_SYSTEM_FILENAMES.has(lower)) {
    return false;
  }
  return true;
}

export function getStarterWebsiteFiles(siteName: string, domain: string | null) {
  const safeTitle = siteName.replace(/[<>"]/g, '');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="container">
      <header class="site-header">
        <h1>${safeTitle}</h1>
        <p>${domain ? `Configured domain: ${domain}` : 'Managed through WebManager Pro'}</p>
      </header>
      <section class="content">
        <h2>Site Ready for Customization</h2>
        <p>Edit this HTML, CSS, or JavaScript directly in the source editor and publish when ready.</p>
      </section>
    </main>
    <script src="./main.js"></script>
  </body>
</html>
`;

  const css = `:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

body {
  margin: 0;
  padding: 3rem 1.5rem;
  background: #f8fafc;
  color: #0f172a;
}

.container {
  max-width: 780px;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 2.5rem;
}

.site-header {
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 1.5rem;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0 0 0.5rem 0;
  font-size: 2rem;
}
`;

  const js = `document.addEventListener('DOMContentLoaded', () => {
  console.info('${safeTitle} initialized.');
});
`;

  const readme = `# ${safeTitle}\n\nManaged source repository inside WebManager Pro.\n`;

  return [
    { path: 'index.html', name: 'index.html', mimeType: 'text/html', content: html },
    { path: 'styles.css', name: 'styles.css', mimeType: 'text/css', content: css },
    { path: 'main.js', name: 'main.js', mimeType: 'application/javascript', content: js },
    { path: 'README.md', name: 'README.md', mimeType: 'text/markdown', content: readme },
  ];
}
