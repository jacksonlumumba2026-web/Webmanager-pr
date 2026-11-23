import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { githubConnections } from '../db/schema.ts';
import { decryptSecret, encryptSecret } from '../lib/crypto.ts';

const stateSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export function isGitHubConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function getGitHubCallbackUrl(req?: {
  protocol?: string;
  get?: (name: string) => string | undefined;
}): string {
  const explicitCallback = (process.env.GITHUB_CALLBACK_URL || '').trim();
  if (explicitCallback) {
    return explicitCallback.replace(/\/$/, '');
  }
  const reqHost = req?.get?.('host')?.trim();
  if (reqHost) {
    const proto = req?.protocol || 'https';
    return `${proto}://${reqHost}/api/github/callback`;
  }
  const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${baseUrl}/api/github/callback`;
}

export function sanitizeReturnToPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/dashboard';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[\r\n]/.test(trimmed)) {
    return '/dashboard';
  }
  return trimmed;
}

export function createGitHubOAuthState(payload: {
  organizationId: string;
  profileId: string;
  scope: 'agency' | 'client';
  callbackUrl?: string;
  returnTo?: string;
}): string {
  const data = Buffer.from(
    JSON.stringify({
      ...payload,
      returnTo: sanitizeReturnToPath(payload.returnTo),
      exp: Math.floor(Date.now() / 1000) + 600,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyGitHubOAuthState(
  state: string
): {
  organizationId: string;
  profileId: string;
  scope: 'agency' | 'client';
  callbackUrl?: string;
  returnTo?: string;
} | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', stateSecret).update(data).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class GitHubApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export async function clearGitHubConnection(organizationId: string, profileId: string): Promise<void> {
  await db
    .delete(githubConnections)
    .where(
      and(
        eq(githubConnections.organizationId, organizationId),
        eq(githubConnections.profileId, profileId)
      )
    );
}

export async function getDecryptedGitHubToken(
  organizationId: string,
  profileId: string
): Promise<{ token: string; login: string; scope: string } | null> {
  const rows = await db
    .select()
    .from(githubConnections)
    .where(
      and(
        eq(githubConnections.organizationId, organizationId),
        eq(githubConnections.profileId, profileId)
      )
    );
  if (rows.length === 0) return null;
  const conn = rows[0];
  try {
    return {
      token: decryptSecret(conn.encryptedAccessToken),
      login: conn.githubLogin,
      scope: conn.scope,
    };
  } catch {
    await clearGitHubConnection(organizationId, profileId);
    return null;
  }
}

export async function saveGitHubConnection(params: {
  organizationId: string;
  profileId: string;
  scope: 'agency' | 'client';
  githubUserId: string;
  githubLogin: string;
  accessToken: string;
  tokenScope?: string;
}) {
  const encryptedAccessToken = encryptSecret(params.accessToken);
  const [saved] = await db
    .insert(githubConnections)
    .values({
      organizationId: params.organizationId,
      profileId: params.profileId,
      scope: params.scope,
      githubUserId: params.githubUserId,
      githubLogin: params.githubLogin,
      encryptedAccessToken,
      tokenScope: params.tokenScope ?? null,
    })
    .onConflictDoUpdate({
      target: [githubConnections.organizationId, githubConnections.profileId],
      set: {
        scope: params.scope,
        githubUserId: params.githubUserId,
        githubLogin: params.githubLogin,
        encryptedAccessToken,
        tokenScope: params.tokenScope ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved;
}

export async function githubApiFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'WebManager-Pro',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new GitHubApiError(res.status, `GitHub API (${res.status}): ${errText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function encodeGitHubRepoPath(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export async function resolveGitHubTargetBranch(
  token: string,
  owner: string,
  repoName: string,
  requestedBranch: string
): Promise<{ branch: string | undefined; isEmptyRepo: boolean; defaultBranch: string }> {
  const repoInfo = await githubApiFetch<{ default_branch?: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`
  );
  const repoDefault = repoInfo.default_branch || 'main';
  const branches = await githubApiFetch<Array<{ name: string }>>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/branches?per_page=100`
  );

  if (branches.length === 0) {
    return { branch: undefined, isEmptyRepo: true, defaultBranch: repoDefault };
  }

  const trimmed = requestedBranch.trim();
  const exact = branches.find((b) => b.name === trimmed);
  if (exact) {
    return { branch: exact.name, isEmptyRepo: false, defaultBranch: repoDefault };
  }

  const caseInsensitive = branches.find((b) => b.name.toLowerCase() === trimmed.toLowerCase());
  if (caseInsensitive) {
    return { branch: caseInsensitive.name, isEmptyRepo: false, defaultBranch: repoDefault };
  }

  if (trimmed.toLowerCase() === 'main' || trimmed.toLowerCase() === 'master') {
    const fallback = branches.find((b) => b.name === repoDefault);
    if (fallback) {
      return { branch: fallback.name, isEmptyRepo: false, defaultBranch: repoDefault };
    }
  }

  throw new GitHubApiError(
    400,
    `Branch "${trimmed}" was not found in ${owner}/${repoName}. Available branches: ${branches.map((b) => b.name).join(', ')}.`
  );
}
