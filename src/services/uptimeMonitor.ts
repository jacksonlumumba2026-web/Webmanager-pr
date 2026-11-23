import tls from 'node:tls';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { organizations, uptimeChecks, websites } from '../db/schema.ts';
import { escapeHtml, sendTransactionalEmail } from './email.ts';
import { assertPublicFetchUrl } from './urlImporter.ts';

const PROBE_TIMEOUT_MS = 8_000;
const SSL_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MIN_RECHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface HealthProbeResult {
  targetUrl: string;
  isUp: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  sslValid: boolean | null;
  sslExpiresAt: Date | null;
  sslDaysRemaining: number | null;
  sslIssuer: string | null;
  errorMessage: string | null;
}

export function normalizeMonitorTarget(
  liveUrl?: string | null,
  domain?: string | null
): string | null {
  const candidate = (liveUrl || '').trim() || (domain ? `https://${domain.trim()}` : '');
  if (!candidate) return null;
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function inspectSslCertificate(parsedUrl: URL): Promise<{
  sslValid: boolean | null;
  sslExpiresAt: Date | null;
  sslDaysRemaining: number | null;
  sslIssuer: string | null;
}> {
  if (parsedUrl.protocol !== 'https:') {
    return {
      sslValid: null,
      sslExpiresAt: null,
      sslDaysRemaining: null,
      sslIssuer: null,
    };
  }

  // Re-verify public host right before opening TLS socket
  await assertPublicFetchUrl(parsedUrl.toString());

  const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : 443;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: {
      sslValid: boolean | null;
      sslExpiresAt: Date | null;
      sslDaysRemaining: number | null;
      sslIssuer: string | null;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = tls.connect(
      {
        host: parsedUrl.hostname,
        port: Number.isFinite(port) ? port : 443,
        servername: parsedUrl.hostname,
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          let sslExpiresAt: Date | null = null;
          let sslDaysRemaining: number | null = null;
          let sslIssuer: string | null = null;

          if (cert && cert.valid_to) {
            const parsedExp = new Date(cert.valid_to);
            if (!Number.isNaN(parsedExp.getTime())) {
              sslExpiresAt = parsedExp;
              sslDaysRemaining = Math.floor(
                (parsedExp.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );
            }
          }
          if (cert && cert.issuer) {
            const issuerObj = cert.issuer as unknown as Record<string, string | string[] | undefined>;
            const rawOrg = issuerObj.O ?? issuerObj.CN;
            if (Array.isArray(rawOrg)) {
              sslIssuer = rawOrg[0] || null;
            } else if (typeof rawOrg === 'string' && rawOrg.trim()) {
              sslIssuer = rawOrg.trim();
            }
          }

          const sslValid =
            Boolean(socket.authorized) &&
            (sslDaysRemaining === null ? true : sslDaysRemaining > 0);

          socket.destroy();
          finish({
            sslValid,
            sslExpiresAt,
            sslDaysRemaining,
            sslIssuer,
          });
        } catch {
          socket.destroy();
          finish({
            sslValid: false,
            sslExpiresAt: null,
            sslDaysRemaining: null,
            sslIssuer: null,
          });
        }
      }
    );

    socket.setTimeout(SSL_TIMEOUT_MS, () => {
      socket.destroy();
      finish({
        sslValid: false,
        sslExpiresAt: null,
        sslDaysRemaining: null,
        sslIssuer: null,
      });
    });

    socket.on('error', () => {
      socket.destroy();
      finish({
        sslValid: false,
        sslExpiresAt: null,
        sslDaysRemaining: null,
        sslIssuer: null,
      });
    });
  });
}

export async function checkWebsiteHealth(rawTarget: string): Promise<HealthProbeResult> {
  const normalized = normalizeMonitorTarget(rawTarget, null);
  if (!normalized) {
    throw new Error('Website must have a valid public domain or live URL to monitor.');
  }

  // Strictly enforce SSRF rules before making any network calls (throws on blocked targets)
  let currentUrl = (await assertPublicFetchUrl(normalized)).toString();

  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let isUp = false;
  let errorMessage: string | null = null;
  let finalParsed = new URL(currentUrl);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      finalParsed = await assertPublicFetchUrl(currentUrl);
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: {
          'User-Agent': 'WebManagerPro-UptimeMonitor/1.0',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location || hop === MAX_REDIRECTS) {
          httpStatus = res.status;
          isUp = true;
          break;
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      await res.body?.cancel();
      httpStatus = res.status;
      isUp = res.status >= 200 && res.status < 400;
      if (!isUp) {
        errorMessage = `HTTP ${res.status}`;
      }
      break;
    }
  } catch (err) {
    // Re-throw explicit SSRF / validation blocks cleanly if triggered on redirect or initial host
    const msg = err instanceof Error ? err.message : 'Request failed';
    if (
      msg.includes('Private or reserved IP') ||
      msg.includes('Local, internal') ||
      msg.includes('Blocked non-public IP') ||
      msg.includes('Credentials in URL') ||
      msg.includes('Unsupported URL protocol')
    ) {
      throw new Error(msg);
    }
    isUp = false;
    errorMessage = msg;
  }

  const responseTimeMs = Date.now() - startedAt;

  let sslInfo = {
    sslValid: null as boolean | null,
    sslExpiresAt: null as Date | null,
    sslDaysRemaining: null as number | null,
    sslIssuer: null as string | null,
  };
  if (finalParsed.protocol === 'https:') {
    try {
      sslInfo = await inspectSslCertificate(finalParsed);
    } catch {
      sslInfo = { sslValid: false, sslExpiresAt: null, sslDaysRemaining: null, sslIssuer: null };
    }
  }

  return {
    targetUrl: normalized,
    isUp,
    httpStatus,
    responseTimeMs,
    sslValid: sslInfo.sslValid,
    sslExpiresAt: sslInfo.sslExpiresAt,
    sslDaysRemaining: sslInfo.sslDaysRemaining,
    sslIssuer: sslInfo.sslIssuer,
    errorMessage,
  };
}

export async function runUptimeCheckForWebsite(websiteId: string) {
  const [site] = await db.select().from(websites).where(eq(websites.id, websiteId));
  if (!site) {
    throw new Error('Website not found.');
  }

  const target = normalizeMonitorTarget(site.liveUrl, site.domain);
  if (!target) {
    throw new Error('Configure a live URL or public domain before running an uptime check.');
  }

  const previousStatus = site.lastUptimeStatus;
  const probe = await checkWebsiteHealth(target);
  const now = new Date();

  const [savedCheck] = await db
    .insert(uptimeChecks)
    .values({
      organizationId: site.organizationId,
      websiteId: site.id,
      targetUrl: probe.targetUrl,
      isUp: probe.isUp,
      httpStatus: probe.httpStatus,
      responseTimeMs: probe.responseTimeMs,
      sslValid: probe.sslValid,
      sslExpiresAt: probe.sslExpiresAt,
      sslDaysRemaining: probe.sslDaysRemaining,
      sslIssuer: probe.sslIssuer,
      errorMessage: probe.errorMessage,
      checkedAt: now,
    })
    .returning();

  const nextStatus = probe.isUp ? 'up' : 'down';
  const [updatedSite] = await db
    .update(websites)
    .set({
      lastUptimeStatus: nextStatus,
      lastResponseTimeMs: probe.responseTimeMs,
      sslExpiresAt: probe.sslExpiresAt,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(websites.id, site.id))
    .returning();

  // Notify agency support email on up -> down transition
  if (previousStatus === 'up' && nextStatus === 'down') {
    try {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, site.organizationId));
      if (org?.supportEmail) {
        await sendTransactionalEmail({
          to: org.supportEmail,
          subject: `[Alert] ${site.name} appears offline`,
          text: `${site.name} (${probe.targetUrl}) failed an uptime check (${probe.errorMessage || `HTTP ${probe.httpStatus ?? 'error'}`}).`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a"><h2>Website Downtime Alert</h2><p><strong>${escapeHtml(site.name)}</strong> (<a href="${escapeHtml(probe.targetUrl)}">${escapeHtml(probe.targetUrl)}</a>) failed an automated health check.</p><p>Status: <strong>${escapeHtml(probe.errorMessage || `HTTP ${probe.httpStatus ?? 'Unavailable'}`)}</strong></p></div>`,
        });
      }
    } catch (emailErr) {
      console.warn('Downtime email alert failed:', emailErr);
    }
  }

  return { check: savedCheck, website: updatedSite };
}

let scheduledRunActive = false;

export async function runScheduledUptimeMonitor(): Promise<{ checked: number; up: number; down: number }> {
  if (scheduledRunActive) {
    return { checked: 0, up: 0, down: 0 };
  }
  scheduledRunActive = true;
  let checked = 0;
  let up = 0;
  let down = 0;

  try {
    const activeSites = await db
      .select()
      .from(websites)
      .where(and(eq(websites.status, 'active')))
      .orderBy(desc(websites.updatedAt))
      .limit(25);

    const cutoff = Date.now() - MIN_RECHECK_INTERVAL_MS;
    const eligible = activeSites.filter((site) => {
      if (!normalizeMonitorTarget(site.liveUrl, site.domain)) return false;
      if (site.lastCheckedAt && new Date(site.lastCheckedAt).getTime() > cutoff) return false;
      return true;
    });

    const concurrency = 3;
    for (let i = 0; i < eligible.length; i += concurrency) {
      const batch = eligible.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((site) => runUptimeCheckForWebsite(site.id))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          checked++;
          if (r.value.check.isUp) up++;
          else down++;
        }
      }
    }
  } catch (err) {
    console.warn('Scheduled uptime monitor run error:', err);
  } finally {
    scheduledRunActive = false;
  }

  return { checked, up, down };
}
