import express from 'express';
import compression from 'compression';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import JSZip from 'jszip';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import {
  activityLogs,
  changeRequests,
  clients,
  contactInquiries,
  deploymentConfigs,
  deployments,
  githubConnections,
  invitations,
  invoices,
  organizationMembers,
  organizations,
  profiles,
  uptimeChecks,
  websiteFiles,
  websiteMembers,
  websiteRepositories,
  websites,
} from './src/db/schema.ts';
import {
  generateInviteToken,
  hashPassword,
  signSessionToken,
  verifyPassword,
} from './src/lib/crypto.ts';
import {
  hasStaffPermission,
  requireAuth,
  requireOrgRole,
  verifyWebsiteAccess,
  type AuthRequest,
} from './src/middleware/auth.ts';
import { logActivity } from './src/services/audit.ts';
import {
  getStarterWebsiteFiles,
  inferMimeType,
  isAllowedWebFile,
  isBinaryImageFile,
  isDataUrlPayload,
  isKnownBinaryExtension,
  MAX_FILE_SIZE_BYTES,
  normalizeWebsitePath,
} from './src/services/fileValidation.ts';
import {
  clearGitHubConnection,
  createGitHubOAuthState,
  encodeGitHubRepoPath,
  getDecryptedGitHubToken,
  getGitHubCallbackUrl,
  GitHubApiError,
  githubApiFetch,
  isGitHubConfigured,
  resolveGitHubTargetBranch,
  sanitizeReturnToPath,
  saveGitHubConnection,
  verifyGitHubOAuthState,
} from './src/services/github.ts';
import {
  buildInviteEmailPayload,
  escapeHtml,
  getEmailServiceStatus,
  sendTransactionalEmail,
} from './src/services/email.ts';
import { importWebsiteFromUrl } from './src/services/urlImporter.ts';
import {
  normalizeMonitorTarget,
  runScheduledUptimeMonitor,
  runUptimeCheckForWebsite,
} from './src/services/uptimeMonitor.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '5mb' }));

// Global security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

function decodeBinaryAssetBuffer(storedContent: string): Buffer | null {
  const trimmed = storedContent.trim();
  const dataUrlMatch = /^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (dataUrlMatch) {
    return Buffer.from(dataUrlMatch[1].replace(/\s+/g, ''), 'base64');
  }
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 0) {
    return Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
  }
  return null;
}

function isBinaryBuffer(fileName: string, bytes: Buffer): boolean {
  if (isKnownBinaryExtension(fileName)) return true;
  if (bytes.includes(0)) return true;
  const decoded = bytes.toString('utf8');
  return !Buffer.from(decoded, 'utf8').equals(bytes);
}

function toGitHubBase64Content(fileName: string, storedContent: string): string {
  if (isDataUrlPayload(storedContent) || isBinaryImageFile(fileName) || isKnownBinaryExtension(fileName)) {
    const buf = decodeBinaryAssetBuffer(storedContent);
    if (buf) return buf.toString('base64');
  }
  return Buffer.from(storedContent, 'utf8').toString('base64');
}

function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^(https?:)\s*\/+\s*/i, '$1//').replace(/\s+/g, '');
  if (!cleaned) return null;
  try {
    const candidate = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getBaseUrl(req: express.Request): string {
  const rawBase = process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host')}`;
  return rawBase.replace(/\/+$/, '');
}

let cachedSharedHealthCheck: { url: string; live: boolean; checkedAt: number } | null = null;

async function getPublicPortalBaseUrl(req: express.Request): Promise<{ url: string; sharedLive: boolean }> {
  const explicitPublic = (process.env.SHARED_APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  const base = (explicitPublic || getBaseUrl(req)).replace(/\/+$/, '');
  try {
    const parsed = new URL(base);
    if (!parsed.hostname.startsWith('ais-dev-')) {
      return { url: base, sharedLive: true };
    }
    const sharedUrlObj = new URL(base);
    sharedUrlObj.hostname = parsed.hostname.replace(/^ais-dev-/, 'ais-pre-');
    const sharedBase = sharedUrlObj.toString().replace(/\/+$/, '');

    const now = Date.now();
    if (
      cachedSharedHealthCheck &&
      cachedSharedHealthCheck.url === sharedBase &&
      now - cachedSharedHealthCheck.checkedAt < 60_000
    ) {
      return cachedSharedHealthCheck.live
        ? { url: sharedBase, sharedLive: true }
        : { url: base, sharedLive: false };
    }

    let isLive = false;
    try {
      const probe = await fetch(`${sharedBase}/api/health`, {
        signal: AbortSignal.timeout(1800),
      });
      isLive = probe.ok;
    } catch {
      isLive = false;
    }
    cachedSharedHealthCheck = { url: sharedBase, live: isLive, checkedAt: now };
    return isLive ? { url: sharedBase, sharedLive: true } : { url: base, sharedLive: false };
  } catch {
    return { url: base, sharedLive: false };
  }
}

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

app.get('/api/public/brand', async (_req, res) => {
  try {
    const orgs = await db.select().from(organizations).limit(1);
    if (orgs.length === 0) {
      return res.json({
        name: 'WebManager Pro',
        primaryColor: '#0F172A',
        accentColor: '#1D4ED8',
        brandLogoUrl: null,
        supportEmail: null,
      });
    }
    const org = orgs[0];
    return res.json({
      name: org.name,
      primaryColor: org.primaryColor,
      accentColor: org.accentColor,
      brandLogoUrl: org.brandLogoUrl,
      supportEmail: org.supportEmail,
    });
  } catch (error) {
    console.error('Error fetching public brand:', error);
    return res.status(500).json({ error: 'Unable to load brand configuration' });
  }
});

app.post('/api/public/contact', async (req, res) => {
  try {
    const { fullName, email, company, subject, message } = req.body ?? {};
    if (
      typeof fullName !== 'string' ||
      !fullName.trim() ||
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof subject !== 'string' ||
      !subject.trim() ||
      typeof message !== 'string' ||
      message.trim().length < 10
    ) {
      return res.status(400).json({
        error: 'Please provide a valid name, email address, subject, and message (at least 10 characters).',
      });
    }

    const [created] = await db
      .insert(contactInquiries)
      .values({
        fullName: fullName.trim().slice(0, 120),
        email: email.trim().toLowerCase().slice(0, 180),
        company: typeof company === 'string' ? company.trim().slice(0, 140) : null,
        subject: subject.trim().slice(0, 200),
        message: message.trim().slice(0, 4000),
      })
      .returning();

    return res.status(201).json({ id: created.id, status: created.status });
  } catch (error) {
    console.error('Error submitting contact inquiry:', error);
    return res.status(500).json({ error: 'Failed to submit inquiry. Please try again.' });
  }
});

app.get('/api/invitations/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(404).json({ error: 'Invitation not found' });

    const rows = await db.select().from(invitations).where(eq(invitations.token, token));
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found or invalid' });
    }
    const invite = rows[0];
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, invite.organizationId));

    const isExpired = invite.expiresAt <= new Date() || invite.status === 'expired';
    return res.json({
      id: invite.id,
      email: invite.email,
      fullName: invite.fullName,
      role: invite.role,
      status: isExpired && invite.status === 'pending' ? 'expired' : invite.status,
      organizationName: org?.name || 'WebManager Pro',
      expiresAt: invite.expiresAt,
    });
  } catch (error) {
    console.error('Error reading invitation:', error);
    return res.status(500).json({ error: 'Failed to look up invitation' });
  }
});

// ============================================================================
// AUTHENTICATION & PROFILE ROUTES
// ============================================================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const rows = await db.select().from(profiles).where(eq(profiles.email, normalizedEmail));
    const profile = rows[0];
    if (!profile || !profile.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password. If you use Google Sign-In, continue with Google.' });
    }
    if (profile.status === 'suspended') {
      return res.status(403).json({ error: 'Account access is suspended.' });
    }
    const valid = verifyPassword(password, profile.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    await db
      .update(profiles)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(profiles.id, profile.id));

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.profileId, profile.id));
    if (memberships.length > 0) {
      await logActivity({
        organizationId: memberships[0].organizationId,
        actorProfileId: profile.id,
        action: 'auth.login',
        entityType: 'profile',
        entityId: profile.id,
        details: { method: 'password' },
        ipAddress: req.ip ?? null,
      });
    }

    const token = signSessionToken(profile.id, profile.email);
    return res.json({ token });
  } catch (error) {
    console.error('Password login failed:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/auth/register-agency', async (req, res) => {
  try {
    const { fullName, email, password, organizationName } = req.body ?? {};
    if (
      typeof fullName !== 'string' ||
      !fullName.trim() ||
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      typeof organizationName !== 'string' ||
      !organizationName.trim()
    ) {
      return res.status(400).json({
        error: 'Provide full name, valid email, organization name, and a password of at least 8 characters.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.select().from(profiles).where(eq(profiles.email, normalizedEmail));
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    const passwordHash = hashPassword(password);
    const [profile] = await db
      .insert(profiles)
      .values({
        email: normalizedEmail,
        fullName: fullName.trim().slice(0, 120),
        role: 'super_admin',
        passwordHash,
        status: 'active',
        lastLoginAt: new Date(),
      })
      .returning();

    const slugBase = organizationName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'agency';
    const slug = `${slugBase}-${profile.id.slice(0, 6)}`;

    const [org] = await db
      .insert(organizations)
      .values({
        name: organizationName.trim().slice(0, 120),
        slug,
        supportEmail: normalizedEmail,
      })
      .returning();

    await db.insert(organizationMembers).values({
      organizationId: org.id,
      profileId: profile.id,
      role: 'super_admin',
      permissionsJson: {
        manageClients: true,
        manageWebsites: true,
        manageStaff: true,
        publishWebsites: true,
        manageBilling: true,
      },
      status: 'active',
    });

    await logActivity({
      organizationId: org.id,
      actorProfileId: profile.id,
      action: 'organization.created',
      entityType: 'organization',
      entityId: org.id,
      details: { organizationName: org.name },
      ipAddress: req.ip ?? null,
    });

    const token = signSessionToken(profile.id, profile.email);
    return res.status(201).json({ token });
  } catch (error) {
    console.error('Agency registration failed:', error);
    return res.status(500).json({ error: 'Failed to create agency workspace' });
  }
});

app.post('/api/auth/accept-invite', async (req, res) => {
  try {
    const { token: inviteToken, fullName, password } = req.body ?? {};
    if (typeof inviteToken !== 'string' || !inviteToken.trim()) {
      return res.status(400).json({ error: 'Invitation token is required.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const inviteRows = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, inviteToken.trim()));
    if (inviteRows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found.' });
    }
    const invite = inviteRows[0];
    if (invite.status !== 'pending' || invite.expiresAt <= new Date()) {
      return res.status(400).json({ error: 'This invitation has expired or was already used.' });
    }

    const passwordHash = hashPassword(password);
    const normalizedEmail = invite.email.toLowerCase();
    const resolvedName =
      typeof fullName === 'string' && fullName.trim() ? fullName.trim() : invite.fullName;

    const [profile] = await db
      .insert(profiles)
      .values({
        email: normalizedEmail,
        fullName: resolvedName,
        role: invite.role,
        passwordHash,
        status: 'active',
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: profiles.email,
        set: {
          fullName: resolvedName,
          role: invite.role,
          passwordHash,
          status: 'active',
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    await db
      .insert(organizationMembers)
      .values({
        organizationId: invite.organizationId,
        profileId: profile.id,
        role: invite.role,
        permissionsJson:
          invite.role === 'agency_admin'
            ? { manageClients: true, manageWebsites: true, manageStaff: true, publishWebsites: true }
            : invite.role === 'staff'
            ? { manageClients: true, manageWebsites: true, manageStaff: false, publishWebsites: true }
            : {},
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [organizationMembers.organizationId, organizationMembers.profileId],
        set: { role: invite.role, status: 'active', updatedAt: new Date() },
      });

    if (invite.clientId) {
      await db
        .update(clients)
        .set({ profileId: profile.id, status: 'active', updatedAt: new Date() })
        .where(eq(clients.id, invite.clientId));
    }

    if (invite.websiteId) {
      const level = ['owner', 'editor', 'viewer'].includes(invite.websiteAccessLevel || '')
        ? invite.websiteAccessLevel!
        : 'viewer';
      await db
        .insert(websiteMembers)
        .values({
          websiteId: invite.websiteId,
          profileId: profile.id,
          accessLevel: level,
        })
        .onConflictDoUpdate({
          target: [websiteMembers.websiteId, websiteMembers.profileId],
          set: { accessLevel: level },
        });
    }

    await db.update(invitations).set({ status: 'accepted' }).where(eq(invitations.id, invite.id));

    await logActivity({
      organizationId: invite.organizationId,
      actorProfileId: profile.id,
      clientId: invite.clientId,
      action: 'invitation.accepted',
      entityType: 'invitation',
      entityId: invite.id,
      details: { email: normalizedEmail, role: invite.role },
      ipAddress: req.ip ?? null,
    });

    const sessionToken = signSessionToken(profile.id, profile.email);
    return res.json({ token: sessionToken });
  } catch (error) {
    console.error('Accept invitation failed:', error);
    return res.status(500).json({ error: 'Unable to complete invitation onboarding.' });
  }
});

app.post('/api/auth/request-reset', async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  return res.json({
    message:
      'If an account exists for that email, password reset instructions have been queued. Google Sign-In users manage credentials through their Google account.',
  });
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  const { profile, organization, membership, clientRecord } = req.auth!;
  return res.json({
    profile: {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
      phone: profile.phone,
      role: membership.role,
      status: profile.status,
      hasPassword: Boolean(profile.passwordHash),
      lastLoginAt: profile.lastLoginAt,
      createdAt: profile.createdAt,
    },
    organization,
    membership: {
      id: membership.id,
      role: membership.role,
      permissions: membership.permissionsJson,
      status: membership.status,
    },
    clientRecord,
  });
});

app.patch('/api/auth/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { fullName, phone } = req.body ?? {};
    const { profile, organization } = req.auth!;
    if (typeof fullName !== 'string' || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name cannot be empty.' });
    }
    const [updated] = await db
      .update(profiles)
      .set({
        fullName: fullName.trim().slice(0, 120),
        phone: typeof phone === 'string' ? phone.trim().slice(0, 40) : profile.phone,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, profile.id))
      .returning();

    await logActivity({
      organizationId: organization.id,
      actorProfileId: profile.id,
      action: 'profile.updated',
      entityType: 'profile',
      entityId: profile.id,
    });

    return res.json({
      id: updated.id,
      fullName: updated.fullName,
      phone: updated.phone,
      email: updated.email,
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    const { profile, organization } = req.auth!;

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    if (profile.passwordHash) {
      if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, profile.passwordHash)) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
    }

    const passwordHash = hashPassword(newPassword);
    await db
      .update(profiles)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(profiles.id, profile.id));

    await logActivity({
      organizationId: organization.id,
      actorProfileId: profile.id,
      action: 'auth.password_changed',
      entityType: 'profile',
      entityId: profile.id,
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json({ error: 'Failed to update password' });
  }
});

// ============================================================================
// ORGANIZATION & WHITE-LABEL SETTINGS
// ============================================================================

app.patch(
  '/api/organization',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin']),
  async (req: AuthRequest, res) => {
    try {
      const { name, brandLogoUrl, primaryColor, accentColor, supportEmail, customDomain } =
        req.body ?? {};
      const { organization, profile } = req.auth!;

      const [updated] = await db
        .update(organizations)
        .set({
          name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : organization.name,
          brandLogoUrl:
            typeof brandLogoUrl === 'string' && /^https?:\/\//i.test(brandLogoUrl.trim())
              ? brandLogoUrl.trim()
              : brandLogoUrl === ''
              ? null
              : organization.brandLogoUrl,
          primaryColor:
            typeof primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(primaryColor.trim())
              ? primaryColor.trim()
              : organization.primaryColor,
          accentColor:
            typeof accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(accentColor.trim())
              ? accentColor.trim()
              : organization.accentColor,
          supportEmail:
            typeof supportEmail === 'string' ? supportEmail.trim().slice(0, 180) || null : organization.supportEmail,
          customDomain:
            typeof customDomain === 'string' ? customDomain.trim().slice(0, 180) || null : organization.customDomain,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organization.id))
        .returning();

      await logActivity({
        organizationId: organization.id,
        actorProfileId: profile.id,
        action: 'organization.updated',
        entityType: 'organization',
        entityId: organization.id,
        details: { name: updated.name },
      });

      return res.json(updated);
    } catch (error) {
      console.error('Error updating organization:', error);
      return res.status(500).json({ error: 'Failed to update white-label settings' });
    }
  }
);

// ============================================================================
// ADMIN OVERVIEW & AUTOMATED REPORTING
// ============================================================================

app.get(
  '/api/admin/overview',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.auth!.organization.id;

      const [orgClients, orgWebsites, orgActivities, orgRequests] = await Promise.all([
        db.select().from(clients).where(eq(clients.organizationId, orgId)).orderBy(desc(clients.createdAt)),
        db.select().from(websites).where(eq(websites.organizationId, orgId)).orderBy(desc(websites.updatedAt)),
        db
          .select()
          .from(activityLogs)
          .where(eq(activityLogs.organizationId, orgId))
          .orderBy(desc(activityLogs.createdAt))
          .limit(20),
        db
          .select()
          .from(changeRequests)
          .innerJoin(websites, eq(changeRequests.websiteId, websites.id))
          .where(eq(websites.organizationId, orgId))
          .orderBy(desc(changeRequests.createdAt))
          .limit(10),
      ]);

      const websiteIds = orgWebsites.map((w) => w.id);
      const recentDeployments =
        websiteIds.length > 0
          ? await db
              .select()
              .from(deployments)
              .where(inArray(deployments.websiteId, websiteIds))
              .orderBy(desc(deployments.createdAt))
              .limit(12)
          : [];

      const orgInvoices = await db
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, orgId));

      const activeWebsites = orgWebsites.filter((w) => w.status === 'active').length;
      const pendingWebsites = orgWebsites.filter((w) => w.status === 'pending').length;
      const attentionWebsites = orgWebsites.filter((w) => w.status === 'attention').length;
      const openChangeRequests = orgRequests.filter(
        (r) => r.change_requests.status === 'open' || r.change_requests.status === 'in_review'
      ).length;
      const sitesDownCount = orgWebsites.filter((w) => w.lastUptimeStatus === 'down').length;
      const thirtyDaysFromNow = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const expiringSslCount = orgWebsites.filter(
        (w) => w.sslExpiresAt && new Date(w.sslExpiresAt).getTime() <= thirtyDaysFromNow
      ).length;
      const outstandingInvoices = orgInvoices.filter(
        (inv) => inv.status === 'pending' || inv.status === 'overdue'
      );

      return res.json({
        metrics: {
          totalClients: orgClients.length,
          totalWebsites: orgWebsites.length,
          activeWebsites,
          pendingWebsites,
          attentionWebsites,
          openChangeRequests,
          sitesDownCount,
          expiringSslCount,
          outstandingInvoicesCount: outstandingInvoices.length,
          outstandingAmountCents: outstandingInvoices.reduce((acc, inv) => acc + inv.amountCents, 0),
        },
        recentClients: orgClients.slice(0, 6),
        recentWebsites: orgWebsites.slice(0, 6),
        recentActivities: orgActivities,
        recentDeployments,
      });
    } catch (error) {
      console.error('Error loading admin overview:', error);
      return res.status(500).json({ error: 'Failed to load dashboard overview' });
    }
  }
);

app.get(
  '/api/admin/reports/export',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.auth!.organization.id;
      const format = req.query.format === 'json' ? 'json' : 'csv';

      const [orgClients, orgWebsites, orgRequests] = await Promise.all([
        db.select().from(clients).where(eq(clients.organizationId, orgId)),
        db.select().from(websites).where(eq(websites.organizationId, orgId)),
        db
          .select()
          .from(changeRequests)
          .innerJoin(websites, eq(changeRequests.websiteId, websites.id))
          .where(eq(websites.organizationId, orgId)),
      ]);

      const clientMap = new Map(orgClients.map((c) => [c.id, c]));

      if (format === 'json') {
        return res.json({
          generatedAt: new Date().toISOString(),
          organization: req.auth!.organization.name,
          summary: {
            totalClients: orgClients.length,
            totalWebsites: orgWebsites.length,
            activeWebsites: orgWebsites.filter((w) => w.status === 'active').length,
            openChangeRequests: orgRequests.filter((r) => r.change_requests.status === 'open').length,
          },
          websites: orgWebsites.map((w) => ({
            id: w.id,
            name: w.name,
            domain: w.domain,
            liveUrl: w.liveUrl,
            clientBusiness: w.clientId ? clientMap.get(w.clientId)?.businessName || 'Unassigned' : 'Unassigned',
            hostingProvider: w.hostingProvider,
            status: w.status,
            lastPublishedAt: w.lastPublishedAt,
          })),
        });
      }

      const escapeCsv = (val: string | null | undefined) => {
        const s = String(val ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const header = [
        'Website Name',
        'Client Business',
        'Client Contact',
        'Domain',
        'Live URL',
        'Hosting Provider',
        'Status',
        'Last Published At',
      ].join(',');

      const lines = orgWebsites.map((w) => {
        const c = w.clientId ? clientMap.get(w.clientId) : undefined;
        return [
          escapeCsv(w.name),
          escapeCsv(c?.businessName || 'Unassigned'),
          escapeCsv(c?.email || ''),
          escapeCsv(w.domain || ''),
          escapeCsv(w.liveUrl || ''),
          escapeCsv(w.hostingProvider),
          escapeCsv(w.status),
          escapeCsv(w.lastPublishedAt ? w.lastPublishedAt.toISOString() : 'Never'),
        ].join(',');
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="webmanager-pro-report-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      return res.send([header, ...lines].join('\n'));
    } catch (error) {
      console.error('Error generating report:', error);
      return res.status(500).json({ error: 'Failed to generate report' });
    }
  }
);

// ============================================================================
// CLIENT MANAGEMENT ROUTES
// ============================================================================

app.get(
  '/api/clients',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.auth!.organization.id;
      const [orgClients, orgWebsites] = await Promise.all([
        db.select().from(clients).where(eq(clients.organizationId, orgId)).orderBy(desc(clients.createdAt)),
        db.select().from(websites).where(eq(websites.organizationId, orgId)),
      ]);

      const countByClient = new Map<string, number>();
      for (const site of orgWebsites) {
        if (site.clientId) {
          countByClient.set(site.clientId, (countByClient.get(site.clientId) || 0) + 1);
        }
      }

      return res.json(
        orgClients.map((c) => ({
          ...c,
          websiteCount: countByClient.get(c.id) || 0,
        }))
      );
    } catch (error) {
      console.error('Error fetching clients:', error);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }
  }
);

app.post(
  '/api/clients',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      if (!hasStaffPermission(req.auth!, 'manageClients')) {
        return res.status(403).json({ error: 'You do not have permission to add clients.' });
      }
      const {
        fullName,
        businessName,
        email,
        phone,
        notes,
        sendInvite,
        retainerPlan,
        monthlyHoursIncluded,
        monthlyFeeCents,
        currency,
        renewalDate,
        websiteName,
        websiteDomain,
        websiteLiveUrl,
      } = req.body ?? {};
      if (
        typeof fullName !== 'string' ||
        !fullName.trim() ||
        typeof businessName !== 'string' ||
        !businessName.trim() ||
        typeof email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ) {
        return res.status(400).json({ error: 'Full name, business name, and a valid email are required.' });
      }

      const orgId = req.auth!.organization.id;
      const normalizedEmail = email.trim().toLowerCase();

      const [created] = await db
        .insert(clients)
        .values({
          organizationId: orgId,
          fullName: fullName.trim().slice(0, 120),
          businessName: businessName.trim().slice(0, 160),
          email: normalizedEmail,
          phone: typeof phone === 'string' ? phone.trim().slice(0, 40) : null,
          notes: typeof notes === 'string' ? notes.trim().slice(0, 2000) : null,
          retainerPlan:
            typeof retainerPlan === 'string' && retainerPlan.trim()
              ? retainerPlan.trim().slice(0, 80)
              : 'Standard Care',
          monthlyHoursIncluded:
            typeof monthlyHoursIncluded === 'number' && Number.isFinite(monthlyHoursIncluded)
              ? Math.max(0, Math.round(monthlyHoursIncluded))
              : 4,
          monthlyFeeCents:
            typeof monthlyFeeCents === 'number' && Number.isFinite(monthlyFeeCents)
              ? Math.max(0, Math.round(monthlyFeeCents))
              : 0,
          currency:
            typeof currency === 'string' && /^[A-Z]{3}$/.test(currency.trim()) ? currency.trim() : 'USD',
          renewalDate:
            typeof renewalDate === 'string' && renewalDate.trim() && !Number.isNaN(Date.parse(renewalDate))
              ? new Date(renewalDate)
              : null,
          status: sendInvite ? 'pending' : 'active',
        })
        .returning();

      let createdWebsite: typeof websites.$inferSelect | null = null;
      const normalizedLiveUrl = normalizeHttpUrl(websiteLiveUrl);
      const trimmedDomain = typeof websiteDomain === 'string' ? websiteDomain.trim().slice(0, 180) : '';
      const trimmedSiteName = typeof websiteName === 'string' ? websiteName.trim().slice(0, 140) : '';
      if (trimmedSiteName || trimmedDomain || normalizedLiveUrl) {
        const siteTitle = trimmedSiteName || created.businessName;
        const [site] = await db
          .insert(websites)
          .values({
            organizationId: orgId,
            clientId: created.id,
            name: siteTitle,
            domain: trimmedDomain || null,
            liveUrl: normalizedLiveUrl,
            hostingProvider: normalizedLiveUrl ? 'custom_domain' : 'managed_hosting',
            status: normalizedLiveUrl ? 'active' : 'pending',
          })
          .returning();
        createdWebsite = site;

        await db.insert(deploymentConfigs).values({
          websiteId: site.id,
          provider: site.hostingProvider,
          branch: 'main',
          customDomain: site.domain,
        });

        const starter = getStarterWebsiteFiles(site.name, site.domain);
        await db.insert(websiteFiles).values(
          starter.map((f) => ({
            websiteId: site.id,
            path: f.path,
            name: f.name,
            isDirectory: false,
            mimeType: f.mimeType,
            content: f.content,
            sizeBytes: Buffer.byteLength(f.content, 'utf8'),
            isPublished: false,
            updatedByProfileId: req.auth!.profile.id,
          }))
        );
      }

      let inviteUrl: string | null = null;
      let fullInviteUrl: string | null = null;
      let sharedAppLive: boolean | undefined;
      let emailSent = false;
      let emailNotice: string | undefined;
      if (sendInvite) {
        const token = generateInviteToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.insert(invitations).values({
          organizationId: orgId,
          email: normalizedEmail,
          fullName: created.fullName,
          role: 'client',
          clientId: created.id,
          token,
          invitedByProfileId: req.auth!.profile.id,
          status: 'pending',
          expiresAt,
        });
        const portalTarget = await getPublicPortalBaseUrl(req);
        sharedAppLive = portalTarget.sharedLive;
        inviteUrl = `/invite/${token}`;
        fullInviteUrl = `${portalTarget.url}${inviteUrl}`;
        const emailResult = await sendTransactionalEmail({
          to: normalizedEmail,
          ...buildInviteEmailPayload({
            recipientName: created.fullName,
            organizationName: req.auth!.organization.name,
            roleLabel: 'Client Portal User',
            inviteUrl: fullInviteUrl,
            websiteName: createdWebsite?.name || null,
          }),
        });
        emailSent = emailResult.sent;
        emailNotice =
          emailResult.sent && !portalTarget.sharedLive
            ? 'Sent with your Dev URL (you can open it in your signed-in browser; click Share in Google AI Studio so external clients can open links).'
            : emailResult.reason;
      }

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        clientId: created.id,
        action: 'client.created',
        entityType: 'client',
        entityId: created.id,
        details: {
          businessName: created.businessName,
          email: created.email,
          websiteId: createdWebsite?.id || null,
        },
      });

      return res.status(201).json({
        client: created,
        website: createdWebsite,
        inviteUrl,
        fullInviteUrl,
        sharedAppLive,
        emailSent,
        emailNotice,
      });
    } catch (error) {
      console.error('Error creating client:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }
  }
);

app.post(
  '/api/clients/bulk-import',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      if (!hasStaffPermission(req.auth!, 'manageClients')) {
        return res.status(403).json({ error: 'Insufficient permissions to import clients.' });
      }
      const rawRows = Array.isArray(req.body?.clients) ? req.body.clients : [];
      const sendInvites = req.body?.sendInvites !== false;
      if (rawRows.length === 0) {
        return res.status(400).json({ error: 'Provide at least one client row to import.' });
      }
      if (rawRows.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 clients per bulk import.' });
      }

      const orgId = req.auth!.organization.id;
      const existingRows = await db
        .select({ email: clients.email })
        .from(clients)
        .where(eq(clients.organizationId, orgId));
      const seenEmails = new Set(existingRows.map((c) => c.email.toLowerCase()));

      const portalTarget = await getPublicPortalBaseUrl(req);
      const publicBase = portalTarget.url;
      let importedCount = 0;
      let skippedCount = 0;
      let emailedCount = 0;
      const results: Array<{
        fullName: string;
        businessName: string;
        email: string;
        status: 'created' | 'skipped';
        reason?: string;
        inviteUrl?: string | null;
        fullInviteUrl?: string | null;
        emailSent?: boolean;
        emailNotice?: string;
      }> = [];

      for (const row of rawRows) {
        const fullName = typeof row?.fullName === 'string' ? row.fullName.trim().slice(0, 120) : '';
        const businessName =
          typeof row?.businessName === 'string' && row.businessName.trim()
            ? row.businessName.trim().slice(0, 160)
            : fullName;
        const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
        const phone = typeof row?.phone === 'string' ? row.phone.trim().slice(0, 40) : null;
        const websiteName = typeof row?.websiteName === 'string' ? row.websiteName.trim().slice(0, 140) : '';
        const websiteDomain = typeof row?.websiteDomain === 'string' ? row.websiteDomain.trim().slice(0, 180) : '';
        const websiteLiveUrl = normalizeHttpUrl(row?.websiteLiveUrl);

        if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          skippedCount++;
          results.push({
            fullName: fullName || '(missing name)',
            businessName: businessName || '(missing business)',
            email: email || '(invalid email)',
            status: 'skipped',
            reason: 'Missing name or valid email',
          });
          continue;
        }

        if (seenEmails.has(email)) {
          skippedCount++;
          results.push({
            fullName,
            businessName,
            email,
            status: 'skipped',
            reason: 'Client email already exists',
          });
          continue;
        }
        seenEmails.add(email);

        const [created] = await db
          .insert(clients)
          .values({
            organizationId: orgId,
            fullName,
            businessName,
            email,
            phone: phone || null,
            status: sendInvites ? 'pending' : 'active',
          })
          .returning();

        let createdSiteName: string | null = null;
        if (websiteName || websiteDomain || websiteLiveUrl) {
          let derivedDomain = websiteDomain || null;
          if (!derivedDomain && websiteLiveUrl) {
            try {
              derivedDomain = new URL(websiteLiveUrl).hostname;
            } catch {
              derivedDomain = null;
            }
          }
          const siteTitle = websiteName || businessName;
          const [site] = await db
            .insert(websites)
            .values({
              organizationId: orgId,
              clientId: created.id,
              name: siteTitle,
              domain: derivedDomain,
              liveUrl: websiteLiveUrl,
              hostingProvider: websiteLiveUrl ? 'custom_domain' : 'managed_hosting',
              status: websiteLiveUrl ? 'active' : 'pending',
            })
            .returning();
          createdSiteName = site.name;

          await db.insert(deploymentConfigs).values({
            websiteId: site.id,
            provider: site.hostingProvider,
            branch: 'main',
            customDomain: site.domain,
          });
        }

        let inviteUrl: string | null = null;
        let fullInviteUrl: string | null = null;
        let emailSent = false;
        let emailNotice: string | undefined;

        if (sendInvites) {
          const token = generateInviteToken();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await db.insert(invitations).values({
            organizationId: orgId,
            email,
            fullName: created.fullName,
            role: 'client',
            clientId: created.id,
            token,
            invitedByProfileId: req.auth!.profile.id,
            status: 'pending',
            expiresAt,
          });
          inviteUrl = `/invite/${token}`;
          fullInviteUrl = `${publicBase}${inviteUrl}`;
          const emailRes = await sendTransactionalEmail({
            to: email,
            ...buildInviteEmailPayload({
              recipientName: created.fullName,
              organizationName: req.auth!.organization.name,
              roleLabel: 'Client Portal User',
              inviteUrl: fullInviteUrl,
              websiteName: createdSiteName,
            }),
          });
          emailSent = emailRes.sent;
          emailNotice =
            emailRes.sent && !portalTarget.sharedLive
              ? 'Sent with Dev URL (click Share in AI Studio for external client access).'
              : emailRes.reason;
          if (emailSent) emailedCount++;
        }

        importedCount++;
        results.push({
          fullName: created.fullName,
          businessName: created.businessName,
          email: created.email,
          status: 'created',
          inviteUrl,
          fullInviteUrl,
          emailSent,
          emailNotice,
        });
      }

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        action: 'clients.bulk_imported',
        entityType: 'client',
        details: { importedCount, skippedCount, emailedCount },
      });

      return res.status(201).json({
        importedCount,
        skippedCount,
        emailedCount,
        sharedAppLive: portalTarget.sharedLive,
        results,
      });
    } catch (error) {
      console.error('Error bulk importing clients:', error);
      return res.status(500).json({ error: 'Failed to bulk import clients' });
    }
  }
);

app.get(
  '/api/clients/:id',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const clientId = String(req.params.id);
      const orgId = req.auth!.organization.id;
      const rows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)));
      if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });

      const [clientWebsites, clientLogs, clientInvites] = await Promise.all([
        db.select().from(websites).where(and(eq(websites.clientId, clientId), eq(websites.organizationId, orgId))),
        db
          .select()
          .from(activityLogs)
          .where(and(eq(activityLogs.clientId, clientId), eq(activityLogs.organizationId, orgId)))
          .orderBy(desc(activityLogs.createdAt))
          .limit(25),
        db
          .select()
          .from(invitations)
          .where(and(eq(invitations.clientId, clientId), eq(invitations.organizationId, orgId)))
          .orderBy(desc(invitations.createdAt)),
      ]);

      return res.json({
        client: rows[0],
        websites: clientWebsites,
        activities: clientLogs,
        invitations: clientInvites,
      });
    } catch (error) {
      console.error('Error reading client:', error);
      return res.status(500).json({ error: 'Failed to fetch client profile' });
    }
  }
);

app.patch(
  '/api/clients/:id',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      if (!hasStaffPermission(req.auth!, 'manageClients')) {
        return res.status(403).json({ error: 'Insufficient permissions to edit clients.' });
      }
      const clientId = String(req.params.id);
      const orgId = req.auth!.organization.id;
      const existingRows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)));
      if (existingRows.length === 0) return res.status(404).json({ error: 'Client not found' });

      const existing = existingRows[0];
      const {
        fullName,
        businessName,
        email,
        phone,
        status,
        notes,
        retainerPlan,
        monthlyHoursIncluded,
        hoursUsedThisMonth,
        monthlyFeeCents,
        currency,
        renewalDate,
      } = req.body ?? {};
      const validStatuses = ['active', 'suspended', 'pending'];

      const [updated] = await db
        .update(clients)
        .set({
          fullName: typeof fullName === 'string' && fullName.trim() ? fullName.trim() : existing.fullName,
          businessName:
            typeof businessName === 'string' && businessName.trim() ? businessName.trim() : existing.businessName,
          email:
            typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
              ? email.trim().toLowerCase()
              : existing.email,
          phone: typeof phone === 'string' ? phone.trim() || null : existing.phone,
          status: typeof status === 'string' && validStatuses.includes(status) ? status : existing.status,
          notes: typeof notes === 'string' ? notes.trim() : existing.notes,
          retainerPlan:
            typeof retainerPlan === 'string' && retainerPlan.trim()
              ? retainerPlan.trim().slice(0, 80)
              : existing.retainerPlan,
          monthlyHoursIncluded:
            typeof monthlyHoursIncluded === 'number' && Number.isFinite(monthlyHoursIncluded)
              ? Math.max(0, Math.round(monthlyHoursIncluded))
              : existing.monthlyHoursIncluded,
          hoursUsedThisMonth:
            typeof hoursUsedThisMonth === 'number' && Number.isFinite(hoursUsedThisMonth)
              ? Math.max(0, Math.round(hoursUsedThisMonth))
              : existing.hoursUsedThisMonth,
          monthlyFeeCents:
            typeof monthlyFeeCents === 'number' && Number.isFinite(monthlyFeeCents)
              ? Math.max(0, Math.round(monthlyFeeCents))
              : existing.monthlyFeeCents,
          currency:
            typeof currency === 'string' && /^[A-Z]{3}$/.test(currency.trim())
              ? currency.trim()
              : existing.currency,
          renewalDate:
            renewalDate === null || renewalDate === ''
              ? null
              : typeof renewalDate === 'string' && !Number.isNaN(Date.parse(renewalDate))
              ? new Date(renewalDate)
              : existing.renewalDate,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId))
        .returning();

      if (updated.profileId && typeof status === 'string' && validStatuses.includes(status)) {
        await db
          .update(profiles)
          .set({ status: status === 'suspended' ? 'suspended' : 'active', updatedAt: new Date() })
          .where(eq(profiles.id, updated.profileId));
      }

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        clientId: updated.id,
        action: status !== existing.status ? `client.status_${updated.status}` : 'client.updated',
        entityType: 'client',
        entityId: updated.id,
        details: { businessName: updated.businessName, status: updated.status },
      });

      return res.json(updated);
    } catch (error) {
      console.error('Error updating client:', error);
      return res.status(500).json({ error: 'Failed to update client' });
    }
  }
);

app.post(
  '/api/clients/:id/invite',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const clientId = String(req.params.id);
      const orgId = req.auth!.organization.id;
      const rows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)));
      if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });

      const client = rows[0];
      const token = generateInviteToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const [invite] = await db
        .insert(invitations)
        .values({
          organizationId: orgId,
          email: client.email.toLowerCase(),
          fullName: client.fullName,
          role: 'client',
          clientId: client.id,
          token,
          invitedByProfileId: req.auth!.profile.id,
          status: 'pending',
          expiresAt,
        })
        .returning();

      const portalTarget = await getPublicPortalBaseUrl(req);
      const invitePath = `/invite/${token}`;
      const fullInviteUrl = `${portalTarget.url}${invitePath}`;
      const emailResult = await sendTransactionalEmail({
        to: client.email.toLowerCase(),
        ...buildInviteEmailPayload({
          recipientName: client.fullName,
          organizationName: req.auth!.organization.name,
          roleLabel: 'Client Portal User',
          inviteUrl: fullInviteUrl,
        }),
      });

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        clientId: client.id,
        action: 'client.invited',
        entityType: 'invitation',
        entityId: invite.id,
        details: { email: client.email, emailSent: emailResult.sent },
      });

      return res.status(201).json({
        invitation: invite,
        invitePath,
        fullInviteUrl,
        sharedAppLive: portalTarget.sharedLive,
        emailSent: emailResult.sent,
        emailNotice:
          emailResult.sent && !portalTarget.sharedLive
            ? 'Sent with your Dev URL (you can open it in your signed-in browser; click Share in Google AI Studio so external clients can open links).'
            : emailResult.reason,
      });
    } catch (error) {
      console.error('Error inviting client:', error);
      return res.status(500).json({ error: 'Failed to create client invitation' });
    }
  }
);

app.get('/api/clients/:id/maintenance-report', requireAuth, async (req: AuthRequest, res) => {
  try {
    const clientId = String(req.params.id);
    const { organization, membership, clientRecord } = req.auth!;
    const isAdminOrStaff = ['super_admin', 'agency_admin', 'staff'].includes(membership.role);

    if (!isAdminOrStaff && (!clientRecord || clientRecord.id !== clientId)) {
      return res.status(403).json({ error: 'Access denied to this maintenance report.' });
    }

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organization.id)));
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const clientWebsites = await db
      .select()
      .from(websites)
      .where(and(eq(websites.clientId, client.id), eq(websites.organizationId, organization.id)));

    const siteIds = clientWebsites.map((w) => w.id);
    const [siteDeployments, clientRequests, recentLogs] = await Promise.all([
      siteIds.length > 0
        ? db
            .select()
            .from(deployments)
            .where(inArray(deployments.websiteId, siteIds))
            .orderBy(desc(deployments.createdAt))
        : Promise.resolve([]),
      db
        .select()
        .from(changeRequests)
        .where(eq(changeRequests.clientId, client.id))
        .orderBy(desc(changeRequests.createdAt)),
      db
        .select()
        .from(activityLogs)
        .where(and(eq(activityLogs.clientId, client.id), eq(activityLogs.organizationId, organization.id)))
        .orderBy(desc(activityLogs.createdAt))
        .limit(40),
    ]);

    const monthlyDeployments = siteDeployments.filter((d) => d.createdAt >= monthStart);
    const monthlyResolved = clientRequests.filter(
      (r) => (r.status === 'resolved' || r.status === 'closed') && r.updatedAt >= monthStart
    );
    const openRequests = clientRequests.filter((r) => !['resolved', 'closed'].includes(r.status));

    return res.json({
      generatedAt: now.toISOString(),
      monthLabel,
      agencyName: organization.name,
      client,
      summary: {
        totalWebsites: clientWebsites.length,
        activeWebsites: clientWebsites.filter((w) => w.status === 'active').length,
        deploymentsThisMonth: monthlyDeployments.filter((d) => d.status === 'published').length,
        resolvedRequestsThisMonth: monthlyResolved.length,
        openRequestsCount: openRequests.length,
      },
      websites: clientWebsites.map((w) => ({
        id: w.id,
        name: w.name,
        domain: w.domain,
        liveUrl: w.liveUrl,
        status: w.status,
        lastPublishedAt: w.lastPublishedAt,
      })),
      recentDeployments: siteDeployments.slice(0, 10).map((d) => ({
        id: d.id,
        websiteId: d.websiteId,
        provider: d.provider,
        status: d.status,
        liveUrl: d.liveUrl,
        createdAt: d.createdAt,
      })),
      recentRequests: clientRequests.slice(0, 10),
      recentActivities: recentLogs.slice(0, 15),
    });
  } catch (error) {
    console.error('Error building maintenance report:', error);
    return res.status(500).json({ error: 'Failed to generate maintenance report' });
  }
});

// ============================================================================
// WEBSITE MANAGEMENT ROUTES (Admin + Scoped Client Access)
// ============================================================================

app.get('/api/websites', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { organization, membership, clientRecord, profile } = req.auth!;
    const orgClients = await db
      .select()
      .from(clients)
      .where(eq(clients.organizationId, organization.id));
    const clientMap = new Map(orgClients.map((c) => [c.id, c]));

    let rows: (typeof websites.$inferSelect)[] = [];
    if (['super_admin', 'agency_admin', 'staff'].includes(membership.role)) {
      rows = await db
        .select()
        .from(websites)
        .where(eq(websites.organizationId, organization.id))
        .orderBy(desc(websites.updatedAt));
    } else {
      const memberSiteIds = (
        await db
          .select({ websiteId: websiteMembers.websiteId })
          .from(websiteMembers)
          .where(eq(websiteMembers.profileId, profile.id))
      ).map((m) => m.websiteId);

      const conditions = [];
      if (clientRecord) conditions.push(eq(websites.clientId, clientRecord.id));
      if (memberSiteIds.length > 0) conditions.push(inArray(websites.id, memberSiteIds));

      if (conditions.length > 0) {
        rows = await db
          .select()
          .from(websites)
          .where(and(eq(websites.organizationId, organization.id), or(...conditions)))
          .orderBy(desc(websites.updatedAt));
      }
    }

    return res.json(
      rows.map((w) => ({
        ...w,
        liveUrl: w.liveUrl ? normalizeHttpUrl(w.liveUrl) || w.liveUrl : null,
        clientName: w.clientId ? clientMap.get(w.clientId)?.businessName || null : null,
      }))
    );
  } catch (error) {
    console.error('Error fetching websites:', error);
    return res.status(500).json({ error: 'Failed to fetch websites' });
  }
});

app.post(
  '/api/websites',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      if (!hasStaffPermission(req.auth!, 'manageWebsites')) {
        return res.status(403).json({ error: 'Insufficient permissions to create websites.' });
      }
      const { name, clientId, domain, liveUrl, repositoryUrl, hostingProvider, description, scaffoldStarter } =
        req.body ?? {};
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Website name is required.' });
      }

      const orgId = req.auth!.organization.id;
      let validClientId: string | null = null;
      if (typeof clientId === 'string' && clientId.trim()) {
        const foundClient = await db
          .select()
          .from(clients)
          .where(and(eq(clients.id, clientId.trim()), eq(clients.organizationId, orgId)));
        if (foundClient.length === 0) {
          return res.status(400).json({ error: 'Selected client does not belong to this organization.' });
        }
        validClientId = foundClient[0].id;
      }

      const safeProvider =
        typeof hostingProvider === 'string' &&
        ['managed_hosting', 'github_pages', 'custom_domain', 'vercel', 'netlify', 'other'].includes(hostingProvider)
          ? hostingProvider
          : 'managed_hosting';

      const [site] = await db
        .insert(websites)
        .values({
          organizationId: orgId,
          clientId: validClientId,
          name: name.trim().slice(0, 140),
          domain: typeof domain === 'string' ? domain.trim().slice(0, 180) || null : null,
          liveUrl: normalizeHttpUrl(liveUrl),
          repositoryUrl: normalizeHttpUrl(repositoryUrl),
          hostingProvider: safeProvider,
          status: 'pending',
          description: typeof description === 'string' ? description.trim().slice(0, 1000) || null : null,
        })
        .returning();

      await db.insert(deploymentConfigs).values({
        websiteId: site.id,
        provider: safeProvider,
        branch: safeProvider === 'managed_hosting' ? 'main' : 'gh-pages',
        customDomain: site.domain,
      });

      if (scaffoldStarter !== false) {
        const starter = getStarterWebsiteFiles(site.name, site.domain);
        await db.insert(websiteFiles).values(
          starter.map((f) => ({
            websiteId: site.id,
            path: f.path,
            name: f.name,
            isDirectory: false,
            mimeType: f.mimeType,
            content: f.content,
            sizeBytes: Buffer.byteLength(f.content, 'utf8'),
            isPublished: false,
            updatedByProfileId: req.auth!.profile.id,
          }))
        );
      }

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        clientId: validClientId,
        websiteId: site.id,
        action: 'website.created',
        entityType: 'website',
        entityId: site.id,
        details: { name: site.name, hostingProvider: site.hostingProvider },
      });

      return res.status(201).json(site);
    } catch (error) {
      console.error('Error creating website:', error);
      return res.status(500).json({ error: 'Failed to create website' });
    }
  }
);

app.get('/api/websites/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found or access denied' });

    const { website, canEditFiles, canInviteCollaborators, accessLevel } = access;
    const [clientRows, repoRows, configRows, deploymentRows, collaboratorRows, collaboratorInvites] =
      await Promise.all([
        website.clientId
          ? db.select().from(clients).where(eq(clients.id, website.clientId))
          : Promise.resolve([]),
        db.select().from(websiteRepositories).where(eq(websiteRepositories.websiteId, website.id)),
        db.select().from(deploymentConfigs).where(eq(deploymentConfigs.websiteId, website.id)),
        db
          .select({
            id: deployments.id,
            websiteId: deployments.websiteId,
            triggeredByProfileId: deployments.triggeredByProfileId,
            provider: deployments.provider,
            status: deployments.status,
            commitSha: deployments.commitSha,
            liveUrl: deployments.liveUrl,
            logOutput: deployments.logOutput,
            errorMessage: deployments.errorMessage,
            createdAt: deployments.createdAt,
            completedAt: deployments.completedAt,
            snapshotFileCount: sql<number>`coalesce(jsonb_array_length(${deployments.snapshotFilesJson}), 0)`,
          })
          .from(deployments)
          .where(eq(deployments.websiteId, website.id))
          .orderBy(desc(deployments.createdAt))
          .limit(15),
        db
          .select({
            id: websiteMembers.id,
            profileId: websiteMembers.profileId,
            accessLevel: websiteMembers.accessLevel,
            createdAt: websiteMembers.createdAt,
            fullName: profiles.fullName,
            email: profiles.email,
            role: profiles.role,
          })
          .from(websiteMembers)
          .innerJoin(profiles, eq(websiteMembers.profileId, profiles.id))
          .where(eq(websiteMembers.websiteId, website.id))
          .orderBy(desc(websiteMembers.createdAt)),
        db
          .select()
          .from(invitations)
          .where(and(eq(invitations.websiteId, website.id), eq(invitations.status, 'pending')))
          .orderBy(desc(invitations.createdAt)),
      ]);

    return res.json({
      website: {
        ...website,
        liveUrl: website.liveUrl ? normalizeHttpUrl(website.liveUrl) || website.liveUrl : null,
      },
      canEditFiles,
      canInviteCollaborators,
      accessLevel,
      client: clientRows[0] ?? null,
      repository: repoRows[0] ?? null,
      deploymentConfig: configRows[0] ?? null,
      deployments: deploymentRows.map((row) => ({
        ...row,
        hasSnapshot: Number(row.snapshotFileCount || 0) > 0,
        snapshotFileCount: Number(row.snapshotFileCount || 0),
      })),
      collaborators: collaboratorRows,
      collaboratorInvites,
    });
  } catch (error) {
    console.error('Error reading website detail:', error);
    return res.status(500).json({ error: 'Failed to load website details' });
  }
});

app.patch(
  '/api/websites/:id',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
      if (!access || !access.canEditFiles) {
        return res.status(403).json({ error: 'Insufficient permissions to modify this website' });
      }
      const existing = access.website;
      const {
        name,
        clientId,
        domain,
        liveUrl,
        repositoryUrl,
        hostingProvider,
        status,
        description,
        clientCanEdit,
        clientCanInviteCollaborators,
      } = req.body ?? {};

      const validStatuses = ['active', 'pending', 'attention', 'archived'];
      const validProviders = ['managed_hosting', 'github_pages', 'custom_domain', 'vercel', 'netlify', 'other'];

      let nextClientId = existing.clientId;
      if (clientId !== undefined) {
        if (clientId === null || clientId === '') {
          nextClientId = null;
        } else {
          const found = await db
            .select()
            .from(clients)
            .where(and(eq(clients.id, String(clientId)), eq(clients.organizationId, req.auth!.organization.id)));
          if (found.length === 0) return res.status(400).json({ error: 'Invalid client assignment' });
          nextClientId = found[0].id;
        }
      }

      const [updated] = await db
        .update(websites)
        .set({
          name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 140) : existing.name,
          clientId: nextClientId,
          domain: typeof domain === 'string' ? domain.trim() || null : existing.domain,
          liveUrl:
            typeof liveUrl === 'string'
              ? liveUrl.trim() === ''
                ? null
                : normalizeHttpUrl(liveUrl) || existing.liveUrl
              : existing.liveUrl,
          repositoryUrl:
            typeof repositoryUrl === 'string'
              ? repositoryUrl.trim() === ''
                ? null
                : normalizeHttpUrl(repositoryUrl) || existing.repositoryUrl
              : existing.repositoryUrl,
          hostingProvider:
            typeof hostingProvider === 'string' && validProviders.includes(hostingProvider)
              ? hostingProvider
              : existing.hostingProvider,
          status:
            typeof status === 'string' && validStatuses.includes(status) ? status : existing.status,
          description: typeof description === 'string' ? description.trim() : existing.description,
          clientCanEdit:
            typeof clientCanEdit === 'boolean' ? clientCanEdit : existing.clientCanEdit,
          clientCanInviteCollaborators:
            typeof clientCanInviteCollaborators === 'boolean'
              ? clientCanInviteCollaborators
              : existing.clientCanInviteCollaborators,
          updatedAt: new Date(),
        })
        .where(eq(websites.id, existing.id))
        .returning();

      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        clientId: updated.clientId,
        websiteId: updated.id,
        action: 'website.updated',
        entityType: 'website',
        entityId: updated.id,
        details: {
          name: updated.name,
          status: updated.status,
          clientCanEdit: updated.clientCanEdit,
          clientCanInviteCollaborators: updated.clientCanInviteCollaborators,
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error('Error updating website:', error);
      return res.status(500).json({ error: 'Failed to update website' });
    }
  }
);

app.post('/api/websites/:id/collaborators', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });
    if (!access.canInviteCollaborators) {
      return res.status(403).json({ error: 'You do not have permission to invite collaborators to this website.' });
    }

    const { email, fullName, accessLevel } = req.body ?? {};
    if (
      typeof fullName !== 'string' ||
      !fullName.trim() ||
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return res.status(400).json({ error: 'Collaborator name and valid email address are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const isAgencyActor = ['super_admin', 'agency_admin', 'staff'].includes(req.auth!.membership.role);
    let safeLevel: 'viewer' | 'editor' | 'owner' = 'viewer';
    if (accessLevel === 'editor' && (isAgencyActor || access.website.clientCanEdit)) {
      safeLevel = 'editor';
    } else if (accessLevel === 'owner' && isAgencyActor) {
      safeLevel = 'owner';
    }

    // Check if an existing user in this organization already matches this email
    const [existingProfile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, normalizedEmail));

    if (existingProfile) {
      const [orgMembership] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, req.auth!.organization.id),
            eq(organizationMembers.profileId, existingProfile.id)
          )
        );
      if (orgMembership) {
        await db
          .insert(websiteMembers)
          .values({
            websiteId: access.website.id,
            profileId: existingProfile.id,
            accessLevel: safeLevel,
          })
          .onConflictDoUpdate({
            target: [websiteMembers.websiteId, websiteMembers.profileId],
            set: { accessLevel: safeLevel },
          });

        await logActivity({
          organizationId: req.auth!.organization.id,
          actorProfileId: req.auth!.profile.id,
          clientId: access.website.clientId,
          websiteId: access.website.id,
          action: 'website.collaborator_added',
          entityType: 'website',
          entityId: access.website.id,
          details: { email: normalizedEmail, accessLevel: safeLevel },
        });

        return res.status(201).json({
          mode: 'added',
          invitePath: null,
          emailSent: false,
        });
      }
    }

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [invite] = await db
      .insert(invitations)
      .values({
        organizationId: req.auth!.organization.id,
        email: normalizedEmail,
        fullName: fullName.trim().slice(0, 120),
        role: 'client',
        clientId: access.website.clientId,
        websiteId: access.website.id,
        websiteAccessLevel: safeLevel,
        token,
        invitedByProfileId: req.auth!.profile.id,
        status: 'pending',
        expiresAt,
      })
      .returning();

    const portalTarget = await getPublicPortalBaseUrl(req);
    const invitePath = `/invite/${token}`;
    const fullInviteUrl = `${portalTarget.url}${invitePath}`;
    const emailResult = await sendTransactionalEmail({
      to: normalizedEmail,
      ...buildInviteEmailPayload({
        recipientName: invite.fullName,
        organizationName: req.auth!.organization.name,
        roleLabel: `Website ${safeLevel === 'viewer' ? 'Viewer' : 'Editor'}`,
        inviteUrl: fullInviteUrl,
        websiteName: access.website.name,
      }),
    });

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      clientId: access.website.clientId,
      websiteId: access.website.id,
      action: 'website.collaborator_invited',
      entityType: 'invitation',
      entityId: invite.id,
      details: { email: normalizedEmail, accessLevel: safeLevel, emailSent: emailResult.sent },
    });

    return res.status(201).json({
      mode: 'invited',
      invitation: invite,
      invitePath,
      fullInviteUrl,
      sharedAppLive: portalTarget.sharedLive,
      emailSent: emailResult.sent,
      emailNotice:
        emailResult.sent && !portalTarget.sharedLive
          ? 'Sent with your Dev URL (click Share in Google AI Studio so external collaborators can open links).'
          : emailResult.reason,
    });
  } catch (error) {
    console.error('Error inviting website collaborator:', error);
    return res.status(500).json({ error: 'Failed to invite collaborator' });
  }
});

app.patch('/api/websites/:id/collaborators/:memberId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access || !access.canInviteCollaborators) {
      return res.status(403).json({ error: 'Insufficient permissions to manage collaborators.' });
    }
    const isAgencyActor = ['super_admin', 'agency_admin', 'staff'].includes(req.auth!.membership.role);
    const requestedLevel = req.body?.accessLevel;
    if (!['viewer', 'editor', 'owner'].includes(requestedLevel)) {
      return res.status(400).json({ error: 'Invalid access level.' });
    }
    if (requestedLevel === 'owner' && !isAgencyActor) {
      return res.status(403).json({ error: 'Only agency administrators can assign owner level.' });
    }
    if (requestedLevel === 'editor' && !isAgencyActor && !access.website.clientCanEdit) {
      return res.status(403).json({ error: 'Direct editing is disabled for client collaborators on this website.' });
    }

    const [updated] = await db
      .update(websiteMembers)
      .set({ accessLevel: requestedLevel })
      .where(
        and(
          eq(websiteMembers.id, String(req.params.memberId)),
          eq(websiteMembers.websiteId, access.website.id)
        )
      )
      .returning();

    if (!updated) return res.status(404).json({ error: 'Collaborator not found' });
    return res.json(updated);
  } catch (error) {
    console.error('Error updating collaborator:', error);
    return res.status(500).json({ error: 'Failed to update collaborator' });
  }
});

app.delete('/api/websites/:id/collaborators/:memberId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access || !access.canInviteCollaborators) {
      return res.status(403).json({ error: 'Insufficient permissions to remove collaborators.' });
    }
    await db
      .delete(websiteMembers)
      .where(
        and(
          eq(websiteMembers.id, String(req.params.memberId)),
          eq(websiteMembers.websiteId, access.website.id)
        )
      );
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error removing collaborator:', error);
    return res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

app.delete(
  '/api/websites/:id',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin']),
  async (req: AuthRequest, res) => {
    try {
      const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
      if (!access) return res.status(404).json({ error: 'Website not found' });

      await db.delete(websites).where(eq(websites.id, access.website.id));
      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        action: 'website.deleted',
        entityType: 'website',
        entityId: access.website.id,
        details: { name: access.website.name },
      });
      return res.json({ ok: true });
    } catch (error) {
      console.error('Error deleting website:', error);
      return res.status(500).json({ error: 'Failed to delete website' });
    }
  }
);

// ============================================================================
// SOURCE CODE & FILE MANAGER ROUTES
// ============================================================================

app.get('/api/websites/:id/files', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found or access denied' });

    const files = await db
      .select()
      .from(websiteFiles)
      .where(eq(websiteFiles.websiteId, access.website.id))
      .orderBy(websiteFiles.path);

    return res.json({
      canEditFiles: access.canEditFiles,
      files: files.map(({ publishedContent, ...rest }) => ({
        ...rest,
        hasUnpublishedChanges: !rest.isDirectory && (!rest.isPublished || rest.content !== (publishedContent ?? '')),
      })),
    });
  } catch (error) {
    console.error('Error listing website files:', error);
    return res.status(500).json({ error: 'Failed to list website files' });
  }
});

app.post(
  '/api/websites/:id/files',
  express.json({ limit: '15mb' }),
  requireAuth,
  async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });
    if (!access.canEditFiles) {
      return res.status(403).json({ error: 'Read-only access: cannot create files.' });
    }

    const { path: rawPath, isDirectory, content, overwrite } = req.body ?? {};
    const safePath = normalizeWebsitePath(rawPath);
    if (!safePath) {
      return res.status(400).json({ error: 'Invalid file or folder path.' });
    }
    const name = safePath.split('/').pop()!;
    const dirFlag = Boolean(isDirectory);

    if (!dirFlag && !isAllowedWebFile(name)) {
      return res.status(400).json({
        error: 'System metadata files like .DS_Store and Thumbs.db cannot be uploaded.',
      });
    }

    const fileContent = dirFlag ? '' : typeof content === 'string' ? content : '';
    const isBinary = !dirFlag && (isDataUrlPayload(fileContent) || (fileContent.length > 0 && isKnownBinaryExtension(name)));
    const decodedBinary = isBinary ? decodeBinaryAssetBuffer(fileContent) : null;
    if (isBinary && !decodedBinary) {
      return res.status(400).json({ error: 'Binary upload must be a valid base64 payload.' });
    }
    const sizeBytes = isBinary && decodedBinary ? decodedBinary.length : Buffer.byteLength(fileContent, 'utf8');
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'File exceeds the 5 MB upload size limit.' });
    }

    const existing = await db
      .select()
      .from(websiteFiles)
      .where(and(eq(websiteFiles.websiteId, access.website.id), eq(websiteFiles.path, safePath)));
    if (existing.length > 0) {
      if (overwrite && !dirFlag && !existing[0].isDirectory) {
        const [replaced] = await db
          .update(websiteFiles)
          .set({
            content: fileContent,
            mimeType: inferMimeType(name),
            sizeBytes,
            isPublished: false,
            updatedByProfileId: req.auth!.profile.id,
            updatedAt: new Date(),
          })
          .where(eq(websiteFiles.id, existing[0].id))
          .returning();

        await logActivity({
          organizationId: req.auth!.organization.id,
          actorProfileId: req.auth!.profile.id,
          websiteId: access.website.id,
          action: 'file.replaced',
          entityType: 'website_file',
          entityId: replaced.id,
          details: { path: safePath, sizeBytes },
        });

        return res.status(200).json({
          ...replaced,
          hasUnpublishedChanges: true,
        });
      }
      return res.status(409).json({ error: 'A file or folder already exists at that path.' });
    }

    const [created] = await db
      .insert(websiteFiles)
      .values({
        websiteId: access.website.id,
        path: safePath,
        name,
        isDirectory: dirFlag,
        mimeType: dirFlag ? 'inode/directory' : inferMimeType(name),
        content: fileContent,
        sizeBytes,
        isPublished: false,
        updatedByProfileId: req.auth!.profile.id,
      })
      .returning();

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      websiteId: access.website.id,
      action: dirFlag ? 'file.folder_created' : 'file.created',
      entityType: 'website_file',
      entityId: created.id,
      details: { path: safePath },
    });

    return res.status(201).json({
      ...created,
      hasUnpublishedChanges: !created.isDirectory,
    });
  } catch (error) {
    console.error('Error creating file:', error);
    return res.status(500).json({ error: 'Failed to create file' });
  }
});

app.put(
  '/api/websites/:id/files/:fileId',
  express.json({ limit: '15mb' }),
  requireAuth,
  async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });
    if (!access.canEditFiles) {
      return res.status(403).json({ error: 'Read-only access: cannot save source changes.' });
    }

    const fileId = String(req.params.fileId);
    const { content } = req.body ?? {};
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'File content must be a string.' });
    }
    const decodedBinary = isDataUrlPayload(content) ? decodeBinaryAssetBuffer(content) : null;
    const sizeBytes = decodedBinary ? decodedBinary.length : Buffer.byteLength(content, 'utf8');
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'File exceeds the 5 MB limit.' });
    }

    const [updated] = await db
      .update(websiteFiles)
      .set({
        content,
        sizeBytes,
        isPublished: false,
        updatedByProfileId: req.auth!.profile.id,
        updatedAt: new Date(),
      })
      .where(and(eq(websiteFiles.id, fileId), eq(websiteFiles.websiteId, access.website.id)))
      .returning();

    if (!updated) return res.status(404).json({ error: 'File not found' });

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      websiteId: access.website.id,
      action: 'file.saved',
      entityType: 'website_file',
      entityId: updated.id,
      details: { path: updated.path, sizeBytes },
    });

    return res.json({
      ...updated,
      hasUnpublishedChanges: updated.content !== (updated.publishedContent ?? ''),
    });
  } catch (error) {
    console.error('Error saving file:', error);
    return res.status(500).json({ error: 'Failed to save file' });
  }
});

app.patch('/api/websites/:id/files/:fileId/rename', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access || !access.canEditFiles) {
      return res.status(403).json({ error: 'Insufficient permissions to rename files.' });
    }

    const fileId = String(req.params.fileId);
    const safeNewPath = normalizeWebsitePath(req.body?.newPath);
    if (!safeNewPath) return res.status(400).json({ error: 'Invalid target path.' });

    const rows = await db
      .select()
      .from(websiteFiles)
      .where(and(eq(websiteFiles.id, fileId), eq(websiteFiles.websiteId, access.website.id)));
    if (rows.length === 0) return res.status(404).json({ error: 'File not found' });

    const target = rows[0];
    const newName = safeNewPath.split('/').pop()!;
    if (!target.isDirectory && !isAllowedWebFile(newName)) {
      return res.status(400).json({ error: 'System metadata filenames like .DS_Store and Thumbs.db are not allowed.' });
    }

    const [updated] = await db
      .update(websiteFiles)
      .set({
        path: safeNewPath,
        name: newName,
        mimeType: target.isDirectory ? 'inode/directory' : inferMimeType(newName),
        isPublished: false,
        updatedAt: new Date(),
      })
      .where(eq(websiteFiles.id, target.id))
      .returning();

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      websiteId: access.website.id,
      action: 'file.renamed',
      entityType: 'website_file',
      entityId: target.id,
      details: { from: target.path, to: safeNewPath },
    });

    return res.json(updated);
  } catch (error) {
    console.error('Error renaming file:', error);
    return res.status(500).json({ error: 'Failed to rename file (path may already exist)' });
  }
});

app.delete('/api/websites/:id/files/:fileId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access || !access.canEditFiles) {
      return res.status(403).json({ error: 'Insufficient permissions to delete files.' });
    }

    const fileId = String(req.params.fileId);
    const rows = await db
      .select()
      .from(websiteFiles)
      .where(and(eq(websiteFiles.id, fileId), eq(websiteFiles.websiteId, access.website.id)));
    if (rows.length === 0) return res.status(404).json({ error: 'File not found' });

    const target = rows[0];
    if (target.isDirectory) {
      await db
        .delete(websiteFiles)
        .where(
          and(
            eq(websiteFiles.websiteId, access.website.id),
            or(eq(websiteFiles.id, target.id), like(websiteFiles.path, `${target.path}/%`))
          )
        );
    } else {
      await db.delete(websiteFiles).where(eq(websiteFiles.id, target.id));
    }

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      websiteId: access.website.id,
      action: 'file.deleted',
      entityType: 'website_file',
      entityId: target.id,
      details: { path: target.path },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

app.get('/api/websites/:id/files/:fileId/download', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });

    const fileId = String(req.params.fileId);
    const rows = await db
      .select()
      .from(websiteFiles)
      .where(and(eq(websiteFiles.id, fileId), eq(websiteFiles.websiteId, access.website.id)));
    if (rows.length === 0 || rows[0].isDirectory) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = rows[0];
    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const binaryBuffer =
      isDataUrlPayload(file.content) || isKnownBinaryExtension(file.name)
        ? decodeBinaryAssetBuffer(file.content)
        : null;
    res.setHeader(
      'Content-Type',
      binaryBuffer ? file.mimeType || inferMimeType(file.name) : 'application/octet-stream'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return res.send(binaryBuffer ?? file.content);
  } catch (error) {
    console.error('Error downloading file:', error);
    return res.status(500).json({ error: 'Failed to download file' });
  }
});

app.get('/api/websites/:id/files/export-zip', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });

    const files = await db
      .select()
      .from(websiteFiles)
      .where(and(eq(websiteFiles.websiteId, access.website.id), eq(websiteFiles.isDirectory, false)))
      .orderBy(websiteFiles.path);

    const zip = new JSZip();
    for (const file of files) {
      if (isDataUrlPayload(file.content) || isKnownBinaryExtension(file.name)) {
        const binaryBuf = decodeBinaryAssetBuffer(file.content);
        if (binaryBuf) {
          zip.file(file.path, binaryBuf);
          continue;
        }
      }
      zip.file(file.path, file.content);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const slug = access.website.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'website';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-source.zip"`);
    return res.status(200).send(zipBuffer);
  } catch (error) {
    console.error('Error exporting website ZIP:', error);
    return res.status(500).json({ error: 'Failed to export website ZIP archive.' });
  }
});

app.post(
  '/api/websites/:id/files/import-zip',
  express.json({ limit: '30mb' }),
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
      if (!access) return res.status(404).json({ error: 'Website not found' });
      if (!access.canEditFiles) {
        return res.status(403).json({ error: 'Read-only access: cannot import files.' });
      }

      const { base64 } = req.body ?? {};
      if (typeof base64 !== 'string' || !base64.trim()) {
        return res.status(400).json({ error: 'ZIP archive payload is required.' });
      }

      const rawBase64 = base64.includes(',') ? base64.split(',').pop()! : base64;
      const zipBuffer = Buffer.from(rawBase64, 'base64');
      if (zipBuffer.length === 0 || zipBuffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({ error: 'ZIP archive must be between 1 byte and 20 MB.' });
      }

      const archive = await JSZip.loadAsync(zipBuffer);
      const rawEntries = Object.values(archive.files).filter((entry) => {
        if (entry.dir) return false;
        const lower = entry.name.toLowerCase();
        if (
          lower.startsWith('__macosx/') ||
          lower.endsWith('/.ds_store') ||
          lower === '.ds_store' ||
          lower.endsWith('/thumbs.db')
        ) {
          return false;
        }
        return true;
      });

      if (rawEntries.length === 0) {
        return res.status(400).json({ error: 'No files were found inside the ZIP archive.' });
      }
      if (rawEntries.length > 200) {
        return res.status(400).json({ error: 'ZIP archive exceeds the 200-file import limit.' });
      }

      // Detect if every entry shares a single wrapper root directory (e.g., dist/index.html)
      const splitPaths = rawEntries.map((e) => e.name.replace(/\\/g, '/').replace(/^\/+/, '').split('/'));
      const firstSegment = splitPaths[0]?.[0];
      const stripWrapper =
        Boolean(firstSegment) &&
        splitPaths.every((parts) => parts.length > 1 && parts[0] === firstSegment);

      let totalUncompressedBytes = 0;
      let importedCount = 0;
      const skipped: string[] = [];

      for (const entry of rawEntries) {
        const cleanRaw = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
        const candidateRaw = stripWrapper ? cleanRaw.slice(firstSegment.length + 1) : cleanRaw;
        const safePath = normalizeWebsitePath(candidateRaw);
        if (!safePath) {
          skipped.push(`${cleanRaw} (invalid path)`);
          continue;
        }
        const fileName = safePath.split('/').pop()!;
        if (!isAllowedWebFile(fileName)) {
          skipped.push(`${safePath} (system metadata ignored)`);
          continue;
        }

        const fileBytes = await entry.async('nodebuffer');
        totalUncompressedBytes += fileBytes.length;
        if (totalUncompressedBytes > 40 * 1024 * 1024) {
          return res.status(400).json({ error: 'Uncompressed ZIP content exceeds 40 MB safety limit.' });
        }
        if (fileBytes.length > MAX_FILE_SIZE_BYTES) {
          skipped.push(`${safePath} (exceeds 5 MB per file)`);
          continue;
        }

        const binaryPayload = isBinaryBuffer(fileName, fileBytes);
        const mimeType = inferMimeType(fileName);
        const content = binaryPayload
          ? `data:${mimeType};base64,${fileBytes.toString('base64')}`
          : fileBytes.toString('utf8');
        await db
          .insert(websiteFiles)
          .values({
            websiteId: access.website.id,
            path: safePath,
            name: fileName,
            isDirectory: false,
            mimeType,
            content,
            sizeBytes: fileBytes.length,
            isPublished: false,
            updatedByProfileId: req.auth!.profile.id,
          })
          .onConflictDoUpdate({
            target: [websiteFiles.websiteId, websiteFiles.path],
            set: {
              content,
              mimeType: inferMimeType(fileName),
              sizeBytes: fileBytes.length,
              isPublished: false,
              updatedByProfileId: req.auth!.profile.id,
              updatedAt: new Date(),
            },
          });

        importedCount++;
      }

      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        clientId: access.website.clientId,
        websiteId: access.website.id,
        action: 'file.zip_imported',
        entityType: 'website',
        entityId: access.website.id,
        details: { importedCount, skippedCount: skipped.length },
      });

      return res.json({ importedCount, skipped });
    } catch (error) {
      console.error('Error importing ZIP archive:', error);
      return res.status(400).json({ error: 'Invalid or corrupted ZIP archive.' });
    }
  }
);

app.post('/api/websites/:id/files/import-url', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });
    if (!access.canEditFiles) {
      return res.status(403).json({ error: 'Read-only access: cannot import files.' });
    }

    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const maxPages = Number(req.body?.maxPages) || 10;
    const includeExternalAssets = req.body?.includeExternalAssets !== false;

    const result = await importWebsiteFromUrl({
      rawUrl,
      maxPages,
      includeExternalAssets,
    });

    if (result.files.length === 0) {
      return res.status(400).json({ error: 'No importable pages or assets were found at that URL.' });
    }

    for (const file of result.files) {
      await db
        .insert(websiteFiles)
        .values({
          websiteId: access.website.id,
          path: file.path,
          name: file.name,
          isDirectory: false,
          mimeType: file.mimeType,
          content: file.content,
          sizeBytes: file.sizeBytes,
          isPublished: false,
          updatedByProfileId: req.auth!.profile.id,
        })
        .onConflictDoUpdate({
          target: [websiteFiles.websiteId, websiteFiles.path],
          set: {
            content: file.content,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            isPublished: false,
            updatedByProfileId: req.auth!.profile.id,
            updatedAt: new Date(),
          },
        });
    }

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      clientId: access.website.clientId,
      websiteId: access.website.id,
      action: 'file.url_imported',
      entityType: 'website',
      entityId: access.website.id,
      details: {
        entryUrl: result.finalEntryUrl,
        pagesImported: result.pagesImported,
        assetsImported: result.assetsImported,
        detectedStack: result.detectedStack,
        skippedCount: result.skipped.length,
      },
    });

    return res.json({
      importedCount: result.files.length,
      pagesImported: result.pagesImported,
      assetsImported: result.assetsImported,
      detectedStack: result.detectedStack,
      finalEntryUrl: result.finalEntryUrl,
      skipped: result.skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import website from URL.';
    return res.status(400).json({ error: message });
  }
});

// ============================================================================
// GITHUB INTEGRATION ROUTES (Server-Side OAuth + Encrypted Token Storage)
// ============================================================================

async function handleGitHubRouteError(
  req: AuthRequest,
  res: express.Response,
  error: unknown,
  fallbackMessage: string
) {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) {
      await clearGitHubConnection(req.auth!.organization.id, req.auth!.profile.id);
      return res.status(401).json({
        error: 'GitHub authorization expired or was revoked. Please click "Connect GitHub Account" to sign in again.',
        reconnectRequired: true,
      });
    }
    if (error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: error instanceof Error ? error.message : fallbackMessage });
}

app.get('/api/github/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const configured = isGitHubConfigured();
    const callbackUrl = getGitHubCallbackUrl(req);
    const decrypted = await getDecryptedGitHubToken(req.auth!.organization.id, req.auth!.profile.id);
    if (!decrypted) {
      return res.json({
        configured,
        connected: false,
        connection: null,
        callbackUrl,
      });
    }

    if (String(req.query.verify || '') === '1') {
      try {
        await githubApiFetch<{ id: number; login: string }>(decrypted.token, '/user', {
          signal: AbortSignal.timeout(2000),
        });
      } catch (verifyErr) {
        if (verifyErr instanceof GitHubApiError && verifyErr.status === 401) {
          await clearGitHubConnection(req.auth!.organization.id, req.auth!.profile.id);
          return res.json({
            configured,
            connected: false,
            connection: null,
            callbackUrl,
          });
        }
      }
    }

    const connRows = await db
      .select({
        id: githubConnections.id,
        githubLogin: githubConnections.githubLogin,
        scope: githubConnections.scope,
        updatedAt: githubConnections.updatedAt,
      })
      .from(githubConnections)
      .where(
        and(
          eq(githubConnections.organizationId, req.auth!.organization.id),
          eq(githubConnections.profileId, req.auth!.profile.id)
        )
      );

    return res.json({
      configured,
      connected: connRows.length > 0,
      connection: connRows[0] ?? null,
      callbackUrl,
    });
  } catch (error) {
    console.error('Error checking GitHub status:', error);
    return res.status(500).json({ error: 'Failed to check GitHub integration status' });
  }
});

app.get('/api/github/auth-url', requireAuth, async (req: AuthRequest, res) => {
  const callbackUrl = getGitHubCallbackUrl(req);
  if (!isGitHubConfigured()) {
    return res.status(400).json({
      error:
        'GitHub OAuth is not configured on this server. You can connect immediately below using a GitHub Personal Access Token, or add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
      callbackUrl,
    });
  }
  const scopeMode = req.auth!.membership.role === 'client' ? 'client' : 'agency';
  const returnTo = sanitizeReturnToPath(req.query.returnTo);
  const state = createGitHubOAuthState({
    organizationId: req.auth!.organization.id,
    profileId: req.auth!.profile.id,
    scope: scopeMode,
    callbackUrl,
    returnTo,
  });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: callbackUrl,
    scope: 'repo read:user',
    state,
  });

  return res.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    callbackUrl,
  });
});

app.post('/api/github/connect-token', requireAuth, async (req: AuthRequest, res) => {
  try {
    const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!rawToken || rawToken.length < 10 || rawToken.length > 300 || /\s/.test(rawToken)) {
      return res.status(400).json({
        error: 'Enter a valid GitHub Personal Access Token (ghp_... or github_pat_...).',
      });
    }

    const ghRes = await fetch('https://api.github.com/user', {
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${rawToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'WebManager-Pro',
      },
    });

    if (!ghRes.ok) {
      return res.status(400).json({
        error:
          ghRes.status === 401
            ? 'GitHub rejected that token (invalid or expired). Generate a fresh token with "repo" access.'
            : `GitHub token verification failed (HTTP ${ghRes.status}).`,
      });
    }

    const ghUser = (await ghRes.json()) as { id?: number; login?: string };
    if (!ghUser?.id || !ghUser?.login) {
      return res.status(400).json({ error: 'Could not read GitHub user profile for that token.' });
    }

    const tokenScope = ghRes.headers.get('x-oauth-scopes') || 'pat';
    const scopeMode = req.auth!.membership.role === 'client' ? 'client' : 'agency';

    await saveGitHubConnection({
      organizationId: req.auth!.organization.id,
      profileId: req.auth!.profile.id,
      scope: scopeMode,
      githubUserId: String(ghUser.id),
      githubLogin: ghUser.login,
      accessToken: rawToken,
      tokenScope,
    });

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      action: 'github.connected',
      entityType: 'github_connection',
      details: { githubLogin: ghUser.login, scope: scopeMode, method: 'personal_access_token' },
    });

    return res.json({
      connected: true,
      githubLogin: ghUser.login,
      scope: scopeMode,
    });
  } catch (error) {
    console.error('Error connecting GitHub via token:', error);
    return res.status(500).json({ error: 'Failed to verify and store GitHub token.' });
  }
});

const handleGitHubCallback = async (req: express.Request, res: express.Response) => {
  try {
    const ghError = typeof req.query.error === 'string' ? req.query.error : '';
    const ghErrorDesc = typeof req.query.error_description === 'string' ? req.query.error_description : '';
    if (ghError) {
      return res.status(400).send(
        `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:2rem;color:#0f172a;max-width:540px;margin:0 auto">` +
          `<h2>GitHub Authorization Error</h2>` +
          `<p>${escapeHtml(ghErrorDesc || ghError)}</p>` +
          `<p style="color:#475569;font-size:14px">Tip: If this mentions a redirect_uri mismatch, make sure the GitHub OAuth App callback URL matches this site URL, or connect using a GitHub Personal Access Token inside WebManager Pro Settings.</p>` +
          `<p><a href="/dashboard/settings">Return to Settings</a></p></body></html>`
      );
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const parsedState = verifyGitHubOAuthState(state);

    if (!code || !parsedState || !isGitHubConfigured()) {
      return res
        .status(400)
        .send(
          '<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:2rem;color:#0f172a"><h2>GitHub Authorization Expired</h2><p>Invalid or expired GitHub authorization request. Close this tab and try again, or connect with a Personal Access Token.</p></body></html>'
        );
    }

    const callbackUrl = parsedState.callbackUrl || getGitHubCallbackUrl(req);
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      return res
        .status(400)
        .send(
          `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:2rem;color:#0f172a"><h2>GitHub Connection Failed</h2><p>${escapeHtml(
            tokenData.error_description || tokenData.error || 'No token returned from GitHub.'
          )}</p><p><a href="${escapeHtml(sanitizeReturnToPath(parsedState.returnTo))}">Return to WebManager Pro</a></p></body></html>`
        );
    }

    const ghUser = await githubApiFetch<{ id: number; login: string }>(tokenData.access_token, '/user');

    await saveGitHubConnection({
      organizationId: parsedState.organizationId,
      profileId: parsedState.profileId,
      scope: parsedState.scope,
      githubUserId: String(ghUser.id),
      githubLogin: ghUser.login,
      accessToken: tokenData.access_token,
      tokenScope: tokenData.scope,
    });

    await logActivity({
      organizationId: parsedState.organizationId,
      actorProfileId: parsedState.profileId,
      action: 'github.connected',
      entityType: 'github_connection',
      details: { githubLogin: ghUser.login, scope: parsedState.scope, method: 'oauth' },
    });

    const safeReturnTo = sanitizeReturnToPath(parsedState.returnTo);
    const sep = safeReturnTo.includes('?') ? '&' : '?';
    const redirectUrl = `${safeReturnTo}${sep}github=connected`;

    return res.send(`<!doctype html>
<html>
  <body style="font-family: system-ui, sans-serif; padding: 2rem; color: #0f172a;">
    <p>GitHub account <strong>@${escapeHtml(ghUser.login)}</strong> connected successfully. Redirecting...</p>
    <script>
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage({ type: 'GITHUB_OAUTH_SUCCESS', login: ${JSON.stringify(ghUser.login)} }, '*');
        } catch (e) {}
        window.close();
      } else {
        window.location.href = ${JSON.stringify(redirectUrl)};
      }
    </script>
  </body>
</html>`);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    return res
      .status(500)
      .send('<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:2rem;color:#0f172a"><p>GitHub connection failed. Please try connecting with a Personal Access Token.</p></body></html>');
  }
};

app.get(['/api/github/callback', '/api/github/callback/'], handleGitHubCallback);

app.delete('/api/github/disconnect', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .delete(githubConnections)
      .where(
        and(
          eq(githubConnections.organizationId, req.auth!.organization.id),
          eq(githubConnections.profileId, req.auth!.profile.id)
        )
      );
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error disconnecting GitHub:', error);
    return res.status(500).json({ error: 'Failed to disconnect GitHub' });
  }
});

app.get('/api/github/repos', requireAuth, async (req: AuthRequest, res) => {
  try {
    const conn = await getDecryptedGitHubToken(req.auth!.organization.id, req.auth!.profile.id);
    if (!conn) {
      return res.status(400).json({ error: 'Connect your GitHub account first to browse repositories.' });
    }
    const repos = await githubApiFetch<
      Array<{
        id: number;
        name: string;
        full_name: string;
        private: boolean;
        html_url: string;
        default_branch: string;
        owner: { login: string };
      }>
    >(conn.token, '/user/repos?sort=updated&per_page=50');

    return res.json(
      repos.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner.login,
        isPrivate: r.private,
        htmlUrl: r.html_url,
        defaultBranch: r.default_branch,
      }))
    );
  } catch (error) {
    return handleGitHubRouteError(req, res, error, 'Failed to list GitHub repositories');
  }
});

app.post('/api/websites/:id/repository', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });

    const isAgencyStaff = ['super_admin', 'agency_admin', 'staff'].includes(req.auth!.membership.role);
    const { ownershipMode, repoOwner, repoName, defaultBranch, createNewRepo } = req.body ?? {};
    const mode = ownershipMode === 'client_owned' ? 'client_owned' : 'agency_managed';

    if (!isAgencyStaff && mode !== 'client_owned') {
      return res.status(403).json({ error: 'Clients can only connect client-owned repositories.' });
    }

    let finalOwner = typeof repoOwner === 'string' ? repoOwner.trim() : '';
    let finalName = typeof repoName === 'string' ? repoName.trim() : '';
    let finalBranch = typeof defaultBranch === 'string' && defaultBranch.trim() ? defaultBranch.trim() : 'main';

    if (createNewRepo) {
      const conn = await getDecryptedGitHubToken(req.auth!.organization.id, req.auth!.profile.id);
      if (!conn) {
        return res.status(400).json({ error: 'Connect GitHub before creating a new repository.' });
      }
      if (!finalName) return res.status(400).json({ error: 'Repository name is required.' });
      const createdRepo = await githubApiFetch<{
        name: string;
        html_url: string;
        default_branch: string;
        owner: { login: string };
      }>(conn.token, '/user/repos', {
        method: 'POST',
        body: JSON.stringify({
          name: finalName,
          description: `Managed via WebManager Pro for ${access.website.name}`,
          private: false,
          auto_init: true,
        }),
      });
      finalOwner = createdRepo.owner.login;
      finalName = createdRepo.name;
      finalBranch = createdRepo.default_branch || 'main';
    }

    if (!finalOwner || !finalName) {
      return res.status(400).json({ error: 'Repository owner and name are required.' });
    }

    const [repo] = await db
      .insert(websiteRepositories)
      .values({
        websiteId: access.website.id,
        ownershipMode: mode,
        provider: 'github',
        repoOwner: finalOwner,
        repoName: finalName,
        defaultBranch: finalBranch,
        connectedByProfileId: req.auth!.profile.id,
      })
      .onConflictDoUpdate({
        target: websiteRepositories.websiteId,
        set: {
          ownershipMode: mode,
          repoOwner: finalOwner,
          repoName: finalName,
          defaultBranch: finalBranch,
          connectedByProfileId: req.auth!.profile.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    await db
      .update(websites)
      .set({
        repositoryUrl: `https://github.com/${finalOwner}/${finalName}`,
        updatedAt: new Date(),
      })
      .where(eq(websites.id, access.website.id));

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      websiteId: access.website.id,
      action: 'repository.linked',
      entityType: 'website_repository',
      entityId: repo.id,
      details: { repo: `${finalOwner}/${finalName}`, ownershipMode: mode },
    });

    return res.json(repo);
  } catch (error) {
    return handleGitHubRouteError(req, res, error, 'Failed to link repository');
  }
});

app.post('/api/websites/:id/repository/pull', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access || !access.canEditFiles) {
      return res.status(403).json({ error: 'Insufficient permissions to pull repository files.' });
    }

    const [repo] = await db
      .select()
      .from(websiteRepositories)
      .where(eq(websiteRepositories.websiteId, access.website.id));
    if (!repo) return res.status(400).json({ error: 'No GitHub repository is linked to this website.' });

    const conn = await getDecryptedGitHubToken(req.auth!.organization.id, req.auth!.profile.id);
    if (!conn) return res.status(400).json({ error: 'Connect your GitHub account to pull repository files.' });

    let branchData: { commit: { sha: string } };
    try {
      branchData = await githubApiFetch<{ commit: { sha: string } }>(
        conn.token,
        `/repos/${repo.repoOwner}/${repo.repoName}/branches/${encodeURIComponent(repo.defaultBranch)}`
      );
    } catch (branchErr) {
      const msg = branchErr instanceof Error ? branchErr.message : '';
      if (msg.includes('(404)')) {
        return res.status(404).json({
          error: `Repository "${repo.repoOwner}/${repo.repoName}" or branch "${repo.defaultBranch}" was not found on GitHub. If the repo does not exist yet, click "Create New Repo on GitHub". If it is an empty repo with no commits yet, commit your starter files first using "Commit Source Files to GitHub" (or check if the branch is "master" instead of "main").`,
        });
      }
      throw branchErr;
    }
    const treeData = await githubApiFetch<{
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
    }>(conn.token, `/repos/${repo.repoOwner}/${repo.repoName}/git/trees/${branchData.commit.sha}?recursive=1`);

    const blobItems = treeData.tree.filter((item) => item.type === 'blob').slice(0, 200);
    let importedCount = 0;
    for (const item of blobItems) {
      if ((item.size || 0) > MAX_FILE_SIZE_BYTES) continue;
      const safePath = normalizeWebsitePath(item.path);
      if (!safePath) continue;
      const name = safePath.split('/').pop()!;
      if (!isAllowedWebFile(name)) continue;

      const fileJson = await githubApiFetch<{ content?: string; encoding?: string }>(
        conn.token,
        `/repos/${repo.repoOwner}/${repo.repoName}/git/blobs/${item.sha}`
      );
      if (!fileJson.content || fileJson.encoding !== 'base64') continue;
      const mimeType = inferMimeType(name);
      const rawBase64 = fileJson.content.replace(/\s+/g, '');
      const decodedBytes = Buffer.from(rawBase64, 'base64');
      const binaryPayload = isBinaryBuffer(name, decodedBytes);
      const decoded = binaryPayload
        ? `data:${mimeType};base64,${rawBase64}`
        : decodedBytes.toString('utf8');

      await db
        .insert(websiteFiles)
        .values({
          websiteId: access.website.id,
          path: safePath,
          name,
          isDirectory: false,
          mimeType,
          content: decoded,
          sizeBytes: decodedBytes.length,
          isPublished: true,
          publishedContent: decoded,
          updatedByProfileId: req.auth!.profile.id,
        })
        .onConflictDoUpdate({
          target: [websiteFiles.websiteId, websiteFiles.path],
          set: {
            content: decoded,
            mimeType,
            sizeBytes: decodedBytes.length,
            updatedByProfileId: req.auth!.profile.id,
            updatedAt: new Date(),
          },
        });
      importedCount += 1;
    }

    await db
      .update(websiteRepositories)
      .set({
        lastCommitSha: branchData.commit.sha,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(websiteRepositories.id, repo.id));

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      websiteId: access.website.id,
      action: 'repository.pulled',
      entityType: 'website_repository',
      entityId: repo.id,
      details: { importedCount, commitSha: branchData.commit.sha },
    });

    return res.json({ importedCount, commitSha: branchData.commit.sha });
  } catch (error) {
    return handleGitHubRouteError(req, res, error, 'Failed to pull files from GitHub');
  }
});

app.post('/api/websites/:id/repository/commit', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access || !access.canEditFiles) {
      return res.status(403).json({ error: 'Insufficient permissions to commit changes.' });
    }
    const commitMessage =
      typeof req.body?.message === 'string' && req.body.message.trim()
        ? req.body.message.trim().slice(0, 200)
        : `Update ${access.website.name} source files via WebManager Pro`;

    const [repo] = await db
      .select()
      .from(websiteRepositories)
      .where(eq(websiteRepositories.websiteId, access.website.id));
    if (!repo) return res.status(400).json({ error: 'No GitHub repository linked.' });

    const conn = await getDecryptedGitHubToken(req.auth!.organization.id, req.auth!.profile.id);
    if (!conn) return res.status(400).json({ error: 'Connect your GitHub account to commit source changes.' });

    const files = await db
      .select()
      .from(websiteFiles)
      .where(and(eq(websiteFiles.websiteId, access.website.id), eq(websiteFiles.isDirectory, false)));

    if (files.length === 0) {
      return res.status(400).json({ error: 'No source files to commit.' });
    }

    const resolvedBranch = await resolveGitHubTargetBranch(
      conn.token,
      repo.repoOwner,
      repo.repoName,
      repo.defaultBranch || 'main'
    );
    let activeBranch = resolvedBranch.branch;
    let lastSha = repo.lastCommitSha || '';

    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      const encodedPath = encodeGitHubRepoPath(file.path);
      let existingSha: string | undefined;
      if (activeBranch) {
        try {
          const existing = await githubApiFetch<{ sha: string }>(
            conn.token,
            `/repos/${repo.repoOwner}/${repo.repoName}/contents/${encodedPath}?ref=${encodeURIComponent(activeBranch)}`
          );
          existingSha = existing.sha;
        } catch {
          existingSha = undefined;
        }
      }

      const result = await githubApiFetch<{ commit: { sha: string } }>(
        conn.token,
        `/repos/${repo.repoOwner}/${repo.repoName}/contents/${encodedPath}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            message: commitMessage,
            content: toGitHubBase64Content(file.name, file.content),
            ...(activeBranch ? { branch: activeBranch } : {}),
            ...(existingSha ? { sha: existingSha } : {}),
          }),
        }
      );
      lastSha = result.commit.sha;
      if (!activeBranch) {
        activeBranch = resolvedBranch.defaultBranch;
      }
    }

    await db
      .update(websiteRepositories)
      .set({
        defaultBranch: activeBranch || repo.defaultBranch,
        lastCommitSha: lastSha,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(websiteRepositories.id, repo.id));

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      websiteId: access.website.id,
      action: 'repository.committed',
      entityType: 'website_repository',
      entityId: repo.id,
      details: { message: commitMessage, commitSha: lastSha, fileCount: files.length },
    });

    return res.json({ commitSha: lastSha, committedFiles: files.length });
  } catch (error) {
    return handleGitHubRouteError(req, res, error, 'Failed to commit changes to GitHub');
  }
});

// ============================================================================
// PUBLISHING & DEPLOYMENT ROUTES (No Fake Deployments)
// ============================================================================

app.get('/api/websites/:id/deployments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });

    const [configRows, historyRows] = await Promise.all([
      db.select().from(deploymentConfigs).where(eq(deploymentConfigs.websiteId, access.website.id)),
      db
        .select()
        .from(deployments)
        .where(eq(deployments.websiteId, access.website.id))
        .orderBy(desc(deployments.createdAt))
        .limit(25),
    ]);

    return res.json({
      config: configRows[0] ?? null,
      deployments: historyRows,
    });
  } catch (error) {
    console.error('Error reading deployments:', error);
    return res.status(500).json({ error: 'Failed to load deployment history' });
  }
});

app.put(
  '/api/websites/:id/deployment-config',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
      if (!access) return res.status(404).json({ error: 'Website not found' });

      const { provider, branch, buildCommand, outputDir, customDomain, autoDeploy } = req.body ?? {};
      const validProvider = ['managed_hosting', 'github_pages', 'custom_domain', 'other'].includes(provider)
        ? provider
        : 'managed_hosting';
      const defaultBranch = validProvider === 'managed_hosting' ? 'main' : 'gh-pages';

      const [config] = await db
        .insert(deploymentConfigs)
        .values({
          websiteId: access.website.id,
          provider: validProvider,
          branch: typeof branch === 'string' && branch.trim() ? branch.trim() : defaultBranch,
          buildCommand: typeof buildCommand === 'string' ? buildCommand.trim() : '',
          outputDir: typeof outputDir === 'string' && outputDir.trim() ? outputDir.trim() : '/',
          customDomain: typeof customDomain === 'string' ? customDomain.trim() || null : null,
          autoDeploy: Boolean(autoDeploy),
        })
        .onConflictDoUpdate({
          target: deploymentConfigs.websiteId,
          set: {
            provider: validProvider,
            branch: typeof branch === 'string' && branch.trim() ? branch.trim() : defaultBranch,
            buildCommand: typeof buildCommand === 'string' ? buildCommand.trim() : '',
            outputDir: typeof outputDir === 'string' && outputDir.trim() ? outputDir.trim() : '/',
            customDomain: typeof customDomain === 'string' ? customDomain.trim() || null : null,
            autoDeploy: Boolean(autoDeploy),
            updatedAt: new Date(),
          },
        })
        .returning();

      await db
        .update(websites)
        .set({ hostingProvider: validProvider, updatedAt: new Date() })
        .where(eq(websites.id, access.website.id));

      return res.json(config);
    } catch (error) {
      console.error('Error saving deployment config:', error);
      return res.status(500).json({ error: 'Failed to save deployment settings' });
    }
  }
);

app.post(
  '/api/websites/:id/publish',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
    if (!access) return res.status(404).json({ error: 'Website not found' });
    if (!hasStaffPermission(req.auth!, 'publishWebsites')) {
      return res.status(403).json({ error: 'Insufficient permissions to publish websites.' });
    }

    const website = access.website;
    const requestedProvider =
      typeof req.body?.provider === 'string' &&
      ['managed_hosting', 'github_pages', 'custom_domain', 'other'].includes(req.body.provider)
        ? req.body.provider
        : null;

    if (requestedProvider) {
      const requestedBranch =
        typeof req.body?.branch === 'string' && req.body.branch.trim()
          ? req.body.branch.trim()
          : requestedProvider === 'managed_hosting'
          ? 'main'
          : 'gh-pages';
      const requestedDomain =
        typeof req.body?.customDomain === 'string' ? req.body.customDomain.trim() || null : undefined;

      await db
        .insert(deploymentConfigs)
        .values({
          websiteId: website.id,
          provider: requestedProvider,
          branch: requestedBranch,
          customDomain: requestedDomain ?? website.domain,
          autoDeploy: Boolean(req.body?.autoDeploy),
        })
        .onConflictDoUpdate({
          target: deploymentConfigs.websiteId,
          set: {
            provider: requestedProvider,
            branch: requestedBranch,
            ...(requestedDomain !== undefined ? { customDomain: requestedDomain } : {}),
            ...(req.body?.autoDeploy !== undefined ? { autoDeploy: Boolean(req.body.autoDeploy) } : {}),
            updatedAt: new Date(),
          },
        });

      await db
        .update(websites)
        .set({ hostingProvider: requestedProvider, updatedAt: new Date() })
        .where(eq(websites.id, website.id));
    }

    const [config] = await db
      .select()
      .from(deploymentConfigs)
      .where(eq(deploymentConfigs.websiteId, website.id));
    const provider = requestedProvider || config?.provider || website.hostingProvider || 'managed_hosting';

    // Create initial 'publishing' record
    const [deployment] = await db
      .insert(deployments)
      .values({
        websiteId: website.id,
        triggeredByProfileId: req.auth!.profile.id,
        provider,
        status: 'publishing',
        logOutput: `Starting ${provider} deployment for ${website.name}...\n`,
      })
      .returning();

    try {
      if (provider === 'managed_hosting') {
        const files = await db
          .select()
          .from(websiteFiles)
          .where(and(eq(websiteFiles.websiteId, website.id), eq(websiteFiles.isDirectory, false)));

        if (files.length === 0) {
          const message = 'Add at least an index.html file in Source & Files before publishing.';
          const [failed] = await db
            .update(deployments)
            .set({
              status: 'failed',
              errorMessage: message,
              logOutput: deployment.logOutput + `Blocked: ${message}\n`,
              completedAt: new Date(),
            })
            .where(eq(deployments.id, deployment.id))
            .returning();

          return res.status(400).json({ error: message, deployment: failed });
        }

        const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
        const hasher = crypto.createHash('sha256');
        for (const f of sortedFiles) {
          hasher.update(`${f.path}\0${f.content}\0`);
        }
        const snapshotSha = hasher.digest('hex');

        for (const file of sortedFiles) {
          await db
            .update(websiteFiles)
            .set({ isPublished: true, publishedContent: file.content, updatedAt: new Date() })
            .where(eq(websiteFiles.id, file.id));
        }

        const rawBase = process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host')}`;
        const appBaseUrl = rawBase.replace(/\/+$/, '');
        const hostedUrl = `${appBaseUrl}/sites/${website.id}/`;

        const previewList = sortedFiles
          .slice(0, 12)
          .map((f) => `  - ${f.path} (${f.sizeBytes} bytes)`)
          .join('\n');
        const extraLine =
          sortedFiles.length > 12 ? `\n  ...and ${sortedFiles.length - 12} more file(s)` : '';

        const logText =
          deployment.logOutput +
          `Snapshotted ${sortedFiles.length} file(s) from database workspace (snapshot ${snapshotSha.slice(0, 7)}):\n` +
          previewList +
          extraLine +
          `\nPublished live on WebManager Pro Hosting at ${hostedUrl}\n`;

        const snapshotPayload = sortedFiles.map((f) => ({
          path: f.path,
          name: f.name,
          mimeType: f.mimeType,
          content: f.content,
          sizeBytes: f.sizeBytes,
        }));

        const [completed] = await db
          .update(deployments)
          .set({
            status: 'published',
            commitSha: snapshotSha,
            liveUrl: hostedUrl,
            logOutput: logText,
            snapshotFilesJson: snapshotPayload,
            completedAt: new Date(),
          })
          .where(eq(deployments.id, deployment.id))
          .returning();

        await db
          .update(websites)
          .set({
            status: 'active',
            hostingProvider: 'managed_hosting',
            liveUrl: hostedUrl,
            lastPublishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(websites.id, website.id));

        if (req.body?.notifyClient === true && website.clientId) {
          const [client] = await db.select().from(clients).where(eq(clients.id, website.clientId));
          if (client) {
            await sendTransactionalEmail({
              to: client.email,
              subject: `${website.name} has been published`,
              text: `Hello ${client.fullName},\n\nYour website ${website.name} has been updated and published.\nLive URL: ${hostedUrl}\n`,
              html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a"><h2>Website Published</h2><p>Hello ${escapeHtml(client.fullName)},</p><p><strong>${escapeHtml(website.name)}</strong> is now live at <a href="${escapeHtml(hostedUrl)}">${escapeHtml(hostedUrl)}</a>.</p></div>`,
            });
          }
        }

        await logActivity({
          organizationId: req.auth!.organization.id,
          actorProfileId: req.auth!.profile.id,
          clientId: website.clientId,
          websiteId: website.id,
          action: 'website.published',
          entityType: 'deployment',
          entityId: completed.id,
          details: {
            provider: 'managed_hosting',
            liveUrl: hostedUrl,
            snapshotSha,
            fileCount: sortedFiles.length,
          },
        });

        return res.json({
          deployment: {
            ...completed,
            snapshotFilesJson: undefined,
            hasSnapshot: snapshotPayload.length > 0,
            snapshotFileCount: snapshotPayload.length,
          },
        });
      }

      if (provider !== 'github_pages') {
        const message = `Hosting provider "${provider}" has no external deployment credentials configured. Switch to WebManager Hosted (Instant Live URL) for one-click publishing, or configure GitHub Pages.`;
        const [failed] = await db
          .update(deployments)
          .set({
            status: 'failed',
            errorMessage: message,
            logOutput: deployment.logOutput + `Error: ${message}\n`,
            completedAt: new Date(),
          })
          .where(eq(deployments.id, deployment.id))
          .returning();

        return res.status(400).json({ error: message, deployment: failed });
      }

      const [repo] = await db
        .select()
        .from(websiteRepositories)
        .where(eq(websiteRepositories.websiteId, website.id));
      const conn = await getDecryptedGitHubToken(req.auth!.organization.id, req.auth!.profile.id);

      if (!isGitHubConfigured() || !conn || !repo) {
        const missingReason = !isGitHubConfigured()
          ? 'Server GitHub OAuth credentials (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET) are not configured.'
          : !conn
          ? 'Connect your GitHub account in GitHub Integration before publishing to GitHub Pages.'
          : 'Link a GitHub repository to this website before publishing to GitHub Pages.';

        const [failed] = await db
          .update(deployments)
          .set({
            status: 'failed',
            errorMessage: missingReason,
            logOutput: deployment.logOutput + `Blocked: ${missingReason}\n`,
            completedAt: new Date(),
          })
          .where(eq(deployments.id, deployment.id))
          .returning();

        await logActivity({
          organizationId: req.auth!.organization.id,
          actorProfileId: req.auth!.profile.id,
          websiteId: website.id,
          action: 'deployment.failed',
          entityType: 'deployment',
          entityId: deployment.id,
          details: { reason: missingReason },
        });

        return res.status(400).json({ error: missingReason, deployment: failed });
      }

      const files = await db
        .select()
        .from(websiteFiles)
        .where(and(eq(websiteFiles.websiteId, website.id), eq(websiteFiles.isDirectory, false)));

      const requestedBranch = (config?.branch || repo.defaultBranch || 'main').trim();
      const resolvedBranch = await resolveGitHubTargetBranch(
        conn.token,
        repo.repoOwner,
        repo.repoName,
        requestedBranch
      );
      let activeBranch = resolvedBranch.branch;
      const effectiveBranch = activeBranch || resolvedBranch.defaultBranch;

      let lastSha = repo.lastCommitSha || '';
      let logText =
        deployment.logOutput +
        `Pushing ${files.length} files to ${repo.repoOwner}/${repo.repoName}@${effectiveBranch}...\n`;

      for (const file of files) {
        const encodedPath = encodeGitHubRepoPath(file.path);
        let existingSha: string | undefined;
        if (activeBranch) {
          try {
            const existing = await githubApiFetch<{ sha: string }>(
              conn.token,
              `/repos/${repo.repoOwner}/${repo.repoName}/contents/${encodedPath}?ref=${encodeURIComponent(activeBranch)}`
            );
            existingSha = existing.sha;
          } catch {
            existingSha = undefined;
          }
        }

        const commitRes = await githubApiFetch<{ commit: { sha: string } }>(
          conn.token,
          `/repos/${repo.repoOwner}/${repo.repoName}/contents/${encodedPath}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              message: `Publish ${file.path} via WebManager Pro`,
              content: toGitHubBase64Content(file.name, file.content),
              ...(activeBranch ? { branch: activeBranch } : {}),
              ...(existingSha ? { sha: existingSha } : {}),
            }),
          }
        );
        lastSha = commitRes.commit.sha;
        if (!activeBranch) {
          activeBranch = resolvedBranch.defaultBranch;
        }
      }

      if (config && config.branch !== effectiveBranch) {
        await db
          .update(deploymentConfigs)
          .set({ branch: effectiveBranch, updatedAt: new Date() })
          .where(eq(deploymentConfigs.id, config.id));
      }

      // Enable or verify GitHub Pages
      let pagesUrl = `https://${repo.repoOwner}.github.io/${repo.repoName}/`;
      try {
        const pagesInfo = await githubApiFetch<{ html_url?: string }>(
          conn.token,
          `/repos/${repo.repoOwner}/${repo.repoName}/pages`
        );
        if (pagesInfo.html_url) pagesUrl = pagesInfo.html_url;
      } catch {
        try {
          const createdPages = await githubApiFetch<{ html_url?: string }>(
            conn.token,
            `/repos/${repo.repoOwner}/${repo.repoName}/pages`,
            {
              method: 'POST',
              body: JSON.stringify({ source: { branch: effectiveBranch, path: '/' } }),
            }
          );
          if (createdPages.html_url) pagesUrl = createdPages.html_url;
        } catch (pagesErr) {
          if (pagesErr instanceof GitHubApiError && (pagesErr.status === 422 || pagesErr.status === 403)) {
            throw new GitHubApiError(
              400,
              `Files were pushed to ${repo.repoOwner}/${repo.repoName}@${effectiveBranch}, but GitHub Pages could not be enabled (private repos require a paid GitHub plan). Make the repo Public on GitHub or switch Hosting Provider to "WebManager Hosted (Instant Live URL)".`
            );
          }
          throw pagesErr;
        }
      }

      logText += `GitHub Pages active at ${pagesUrl} (commit ${lastSha.slice(0, 7)})\n`;

      // Mark all files published with snapshot
      for (const file of files) {
        await db
          .update(websiteFiles)
          .set({ isPublished: true, publishedContent: file.content, updatedAt: new Date() })
          .where(eq(websiteFiles.id, file.id));
      }

      const snapshotPayload = files.map((f) => ({
        path: f.path,
        name: f.name,
        mimeType: f.mimeType,
        content: f.content,
        sizeBytes: f.sizeBytes,
      }));

      const [completed] = await db
        .update(deployments)
        .set({
          status: 'published',
          commitSha: lastSha,
          liveUrl: pagesUrl,
          logOutput: logText,
          snapshotFilesJson: snapshotPayload,
          completedAt: new Date(),
        })
        .where(eq(deployments.id, deployment.id))
        .returning();

      await db
        .update(websites)
        .set({
          status: 'active',
          liveUrl: pagesUrl,
          lastPublishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(websites.id, website.id));

      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        clientId: website.clientId,
        websiteId: website.id,
        action: 'website.published',
        entityType: 'deployment',
        entityId: completed.id,
        details: { liveUrl: pagesUrl, commitSha: lastSha },
      });

      return res.json({
        deployment: {
          ...completed,
          snapshotFilesJson: undefined,
          hasSnapshot: snapshotPayload.length > 0,
          snapshotFileCount: snapshotPayload.length,
        },
      });
    } catch (error) {
      const isGhAuthError = error instanceof GitHubApiError && error.status === 401;
      if (isGhAuthError) {
        await clearGitHubConnection(req.auth!.organization.id, req.auth!.profile.id);
      }
      const msg = isGhAuthError
        ? 'GitHub authorization expired or was revoked. Please reconnect your GitHub account and publish again.'
        : error instanceof Error
        ? error.message
        : 'Deployment failed';
      const [failed] = await db
        .update(deployments)
        .set({
          status: 'failed',
          errorMessage: msg,
          logOutput: deployment.logOutput + `Error: ${msg}\n`,
          completedAt: new Date(),
        })
        .where(eq(deployments.id, deployment.id))
        .returning();
      const statusCode =
        isGhAuthError
          ? 401
          : error instanceof GitHubApiError && error.status >= 400 && error.status < 500
          ? error.status
          : 500;
      return res.status(statusCode).json({
        error: msg,
        deployment: failed,
        ...(isGhAuthError ? { reconnectRequired: true } : {}),
      });
    }
  }
);

app.post(
  '/api/websites/:id/deployments/:deploymentId/rollback',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
      if (!access) return res.status(404).json({ error: 'Website not found' });
      if (!hasStaffPermission(req.auth!, 'publishWebsites')) {
        return res.status(403).json({ error: 'Insufficient permissions to rollback deployments.' });
      }

      const targetId = String(req.params.deploymentId);
      const [targetDep] = await db
        .select()
        .from(deployments)
        .where(and(eq(deployments.id, targetId), eq(deployments.websiteId, access.website.id)));

      if (!targetDep) return res.status(404).json({ error: 'Deployment snapshot not found.' });
      const snapshot = targetDep.snapshotFilesJson || [];
      if (snapshot.length === 0) {
        return res.status(400).json({ error: 'This deployment does not contain a restorable file snapshot.' });
      }

      // Remove existing non-directory files and restore snapshot cleanly
      await db
        .delete(websiteFiles)
        .where(and(eq(websiteFiles.websiteId, access.website.id), eq(websiteFiles.isDirectory, false)));

      for (const file of snapshot) {
        await db.insert(websiteFiles).values({
          websiteId: access.website.id,
          path: file.path,
          name: file.name,
          isDirectory: false,
          mimeType: file.mimeType,
          content: file.content,
          publishedContent: file.content,
          isPublished: true,
          sizeBytes: file.sizeBytes,
          updatedByProfileId: req.auth!.profile.id,
        });
      }

      const hostedUrl = `${getBaseUrl(req)}/sites/${access.website.id}/`;
      const shortSha = (targetDep.commitSha || targetDep.id).slice(0, 7);
      const [rollbackDep] = await db
        .insert(deployments)
        .values({
          websiteId: access.website.id,
          triggeredByProfileId: req.auth!.profile.id,
          provider: 'managed_hosting',
          status: 'published',
          commitSha: targetDep.commitSha,
          liveUrl: hostedUrl,
          logOutput: `Rolled back ${snapshot.length} file(s) to snapshot ${shortSha}.\nRestored live snapshot at ${hostedUrl}\n`,
          snapshotFilesJson: snapshot,
          completedAt: new Date(),
        })
        .returning();

      await db
        .update(websites)
        .set({
          status: 'active',
          liveUrl: hostedUrl,
          lastPublishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(websites.id, access.website.id));

      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        clientId: access.website.clientId,
        websiteId: access.website.id,
        action: 'deployment.rollback',
        entityType: 'deployment',
        entityId: rollbackDep.id,
        details: { restoredFromDeploymentId: targetDep.id, fileCount: snapshot.length },
      });

      return res.json({
        deployment: {
          ...rollbackDep,
          snapshotFilesJson: undefined,
          hasSnapshot: true,
          snapshotFileCount: snapshot.length,
        },
      });
    } catch (error) {
      console.error('Error rolling back deployment:', error);
      return res.status(500).json({ error: 'Failed to rollback deployment snapshot' });
    }
  }
);

app.post(
  '/api/websites/:id/verify-domain',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const access = await verifyWebsiteAccess(req.auth!, String(req.params.id));
      if (!access) return res.status(404).json({ error: 'Website not found' });

      const [config] = await db
        .select()
        .from(deploymentConfigs)
        .where(eq(deploymentConfigs.websiteId, access.website.id));

      const rawDomain = String(
        req.body?.domain || config?.customDomain || access.website.domain || ''
      )
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0];

      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(rawDomain)) {
        return res.status(400).json({ error: 'Enter a valid domain name (for example, pestokil.co.ke).' });
      }

      const targetHost = new URL(getBaseUrl(req)).hostname;
      let cnameRecords: string[] = [];
      let aRecords: string[] = [];
      try {
        cnameRecords = await dns.resolveCname(rawDomain);
      } catch {
        cnameRecords = [];
      }
      try {
        aRecords = await dns.resolve4(rawDomain);
      } catch {
        aRecords = [];
      }

      const pointsToTarget = cnameRecords.some((c) => c.toLowerCase().includes(targetHost.toLowerCase()));
      const hasAnyDns = cnameRecords.length > 0 || aRecords.length > 0;
      const statusSummary = pointsToTarget
        ? `Verified: CNAME points to ${targetHost}`
        : hasAnyDns
        ? `DNS found (A: ${aRecords.join(', ') || 'none'}; CNAME: ${cnameRecords.join(', ') || 'none'}). Update CNAME to ${targetHost} when routing through WebManager Pro.`
        : `No public A or CNAME records found yet for ${rawDomain}.`;

      await db
        .insert(deploymentConfigs)
        .values({
          websiteId: access.website.id,
          provider: config?.provider || access.website.hostingProvider || 'managed_hosting',
          branch: config?.branch || 'main',
          customDomain: rawDomain,
          domainVerified: pointsToTarget,
          domainVerificationResult: statusSummary,
          domainCheckedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: deploymentConfigs.websiteId,
          set: {
            customDomain: rawDomain,
            domainVerified: pointsToTarget,
            domainVerificationResult: statusSummary,
            domainCheckedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      return res.json({
        verified: pointsToTarget,
        hasDnsRecords: hasAnyDns,
        hostname: rawDomain,
        targetHost,
        cnameRecords,
        aRecords,
        message: statusSummary,
      });
    } catch (error) {
      console.error('Domain DNS verification failed:', error);
      return res.status(500).json({ error: 'DNS lookup failed' });
    }
  }
);

// ============================================================================
// STAFF MANAGEMENT & INVITATIONS
// ============================================================================

app.get(
  '/api/staff',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.auth!.organization.id;
      const [members, orgInvites] = await Promise.all([
        db
          .select({
            memberId: organizationMembers.id,
            role: organizationMembers.role,
            permissions: organizationMembers.permissionsJson,
            status: organizationMembers.status,
            createdAt: organizationMembers.createdAt,
            profileId: profiles.id,
            fullName: profiles.fullName,
            email: profiles.email,
            lastLoginAt: profiles.lastLoginAt,
          })
          .from(organizationMembers)
          .innerJoin(profiles, eq(organizationMembers.profileId, profiles.id))
          .where(eq(organizationMembers.organizationId, orgId))
          .orderBy(desc(organizationMembers.createdAt)),
        db
          .select()
          .from(invitations)
          .where(eq(invitations.organizationId, orgId))
          .orderBy(desc(invitations.createdAt)),
      ]);

      return res.json({
        members: members.filter((m) => m.role !== 'client'),
        invitations: orgInvites,
      });
    } catch (error) {
      console.error('Error fetching staff:', error);
      return res.status(500).json({ error: 'Failed to load staff roster' });
    }
  }
);

app.post(
  '/api/staff/invite',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin']),
  async (req: AuthRequest, res) => {
    try {
      const { email, fullName, role } = req.body ?? {};
      if (
        typeof fullName !== 'string' ||
        !fullName.trim() ||
        typeof email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        !['agency_admin', 'staff'].includes(role)
      ) {
        return res.status(400).json({ error: 'Valid name, email, and staff role are required.' });
      }

      const token = generateInviteToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [invite] = await db
        .insert(invitations)
        .values({
          organizationId: req.auth!.organization.id,
          email: email.trim().toLowerCase(),
          fullName: fullName.trim().slice(0, 120),
          role,
          token,
          invitedByProfileId: req.auth!.profile.id,
          status: 'pending',
          expiresAt,
        })
        .returning();

      const portalTarget = await getPublicPortalBaseUrl(req);
      const invitePath = `/invite/${token}`;
      const fullInviteUrl = `${portalTarget.url}${invitePath}`;
      const emailResult = await sendTransactionalEmail({
        to: invite.email,
        ...buildInviteEmailPayload({
          recipientName: invite.fullName,
          organizationName: req.auth!.organization.name,
          roleLabel: invite.role === 'agency_admin' ? 'Agency Administrator' : 'Staff Member',
          inviteUrl: fullInviteUrl,
        }),
      });

      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        action: 'staff.invited',
        entityType: 'invitation',
        entityId: invite.id,
        details: { email: invite.email, role: invite.role, emailSent: emailResult.sent },
      });

      return res.status(201).json({
        invitation: invite,
        invitePath,
        fullInviteUrl,
        sharedAppLive: portalTarget.sharedLive,
        emailSent: emailResult.sent,
        emailNotice:
          emailResult.sent && !portalTarget.sharedLive
            ? 'Sent with your Dev URL (click Share in Google AI Studio so staff members can open links).'
            : emailResult.reason,
      });
    } catch (error) {
      console.error('Error inviting staff:', error);
      return res.status(500).json({ error: 'Failed to invite staff member' });
    }
  }
);

app.patch(
  '/api/staff/:memberId',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin']),
  async (req: AuthRequest, res) => {
    try {
      const memberId = String(req.params.memberId);
      const orgId = req.auth!.organization.id;
      const rows = await db
        .select()
        .from(organizationMembers)
        .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, orgId)));
      if (rows.length === 0) return res.status(404).json({ error: 'Member not found' });

      const target = rows[0];
      if (target.role === 'super_admin' && req.auth!.membership.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only a Super Administrator can modify another Super Administrator.' });
      }
      if (target.profileId === req.auth!.profile.id && req.body?.status === 'suspended') {
        return res.status(400).json({ error: 'You cannot suspend your own account.' });
      }

      const { role, status, permissions } = req.body ?? {};
      const nextRole =
        typeof role === 'string' && ['agency_admin', 'staff'].includes(role) ? role : target.role;
      const nextStatus =
        typeof status === 'string' && ['active', 'suspended'].includes(status) ? status : target.status;

      const [updated] = await db
        .update(organizationMembers)
        .set({
          role: nextRole,
          status: nextStatus,
          permissionsJson:
            permissions && typeof permissions === 'object' ? permissions : target.permissionsJson,
          updatedAt: new Date(),
        })
        .where(eq(organizationMembers.id, memberId))
        .returning();

      await db
        .update(profiles)
        .set({ role: nextRole, updatedAt: new Date() })
        .where(eq(profiles.id, target.profileId));

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        action: 'staff.permissions_updated',
        entityType: 'organization_member',
        entityId: updated.id,
        details: { role: nextRole, status: nextStatus },
      });

      return res.json(updated);
    } catch (error) {
      console.error('Error updating staff member:', error);
      return res.status(500).json({ error: 'Failed to update staff member' });
    }
  }
);

app.delete(
  '/api/invitations/:id',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin']),
  async (req: AuthRequest, res) => {
    try {
      await db
        .update(invitations)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(invitations.id, String(req.params.id)),
            eq(invitations.organizationId, req.auth!.organization.id)
          )
        );
      return res.json({ ok: true });
    } catch (error) {
      console.error('Error revoking invitation:', error);
      return res.status(500).json({ error: 'Failed to revoke invitation' });
    }
  }
);

// ============================================================================
// CHANGE REQUESTS (WITH FILE/IMAGE ATTACHMENTS), UPTIME & SSL, AND INVOICING
// ============================================================================

const MAX_ATTACHMENTS_PER_REQUEST = 5;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 MB per attachment
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

type StoredAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
};

function sanitizeAttachmentsInput(raw: unknown): StoredAttachment[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_ATTACHMENTS_PER_REQUEST) {
    throw new Error(`Maximum ${MAX_ATTACHMENTS_PER_REQUEST} attachments allowed per request.`);
  }
  const parsed: StoredAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
    const dataUrl = typeof obj.dataUrl === 'string' ? obj.dataUrl.trim() : '';
    if (!rawName || !dataUrl) continue;

    const cleanName = path.basename(rawName).replace(/[^\w.\-() ]+/g, '_').slice(0, 120) || 'attachment';
    const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
    if (!match) {
      throw new Error(`Attachment "${cleanName}" must be a valid base64 data URL.`);
    }
    const mimeType = match[1].toLowerCase();
    if (!ALLOWED_ATTACHMENT_MIMES.has(mimeType)) {
      throw new Error(
        `Unsupported file type for "${cleanName}". Allowed: PNG, JPG, WEBP, GIF, PDF, TXT, CSV, DOC/DOCX, ZIP.`
      );
    }
    const decoded = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (decoded.byteLength === 0 || decoded.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment "${cleanName}" exceeds the 3 MB per-file limit.`);
    }
    parsed.push({
      id: crypto.randomUUID(),
      name: cleanName,
      mimeType,
      sizeBytes: decoded.byteLength,
      dataUrl: `data:${mimeType};base64,${decoded.toString('base64')}`,
    });
  }
  return parsed;
}

function formatChangeRequestForClient<T extends { attachmentsJson?: StoredAttachment[] | null }>(row: T) {
  const { attachmentsJson, ...rest } = row;
  const list = Array.isArray(attachmentsJson) ? attachmentsJson : [];
  return {
    ...rest,
    attachments: list.map((att) => ({
      id: att.id,
      name: att.name,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
      isImage: att.mimeType.startsWith('image/'),
    })),
  };
}

app.get('/api/change-requests', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { organization, membership, clientRecord } = req.auth!;
    if (['super_admin', 'agency_admin', 'staff'].includes(membership.role)) {
      const rows = await db
        .select({
          request: changeRequests,
          websiteName: websites.name,
          clientBusiness: clients.businessName,
        })
        .from(changeRequests)
        .innerJoin(websites, eq(changeRequests.websiteId, websites.id))
        .innerJoin(clients, eq(changeRequests.clientId, clients.id))
        .where(eq(websites.organizationId, organization.id))
        .orderBy(desc(changeRequests.createdAt));

      return res.json(
        rows.map((r) => ({
          ...formatChangeRequestForClient(r.request),
          websiteName: r.websiteName,
          clientBusiness: r.clientBusiness,
        }))
      );
    }

    const memberRows = await db
      .select({ websiteId: websiteMembers.websiteId })
      .from(websiteMembers)
      .where(eq(websiteMembers.profileId, req.auth!.profile.id));
    const memberSiteIds = memberRows.map((m) => m.websiteId);

    if (!clientRecord && memberSiteIds.length === 0) return res.json([]);
    const conditions = [];
    if (clientRecord) conditions.push(eq(changeRequests.clientId, clientRecord.id));
    if (memberSiteIds.length > 0) conditions.push(inArray(changeRequests.websiteId, memberSiteIds));

    const rows = await db
      .select({
        request: changeRequests,
        websiteName: websites.name,
      })
      .from(changeRequests)
      .innerJoin(websites, eq(changeRequests.websiteId, websites.id))
      .where(or(...conditions))
      .orderBy(desc(changeRequests.createdAt));

    return res.json(
      rows.map((r) => ({
        ...formatChangeRequestForClient(r.request),
        websiteName: r.websiteName,
      }))
    );
  } catch (error) {
    console.error('Error loading change requests:', error);
    return res.status(500).json({ error: 'Failed to load change requests' });
  }
});

app.post(
  '/api/change-requests',
  express.json({ limit: '22mb' }),
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { websiteId, title, description, priority, attachments } = req.body ?? {};
      if (
        typeof websiteId !== 'string' ||
        typeof title !== 'string' ||
        !title.trim() ||
        typeof description !== 'string' ||
        !description.trim()
      ) {
        return res.status(400).json({ error: 'Website, title, and description are required.' });
      }

      const access = await verifyWebsiteAccess(req.auth!, websiteId);
      if (!access) return res.status(403).json({ error: 'Website access denied.' });

      const resolvedClientId = req.auth!.clientRecord?.id || access.website.clientId;
      if (!resolvedClientId) {
        return res.status(400).json({
          error: 'This website must be assigned to a client before submitting change requests.',
        });
      }

      let safeAttachments: StoredAttachment[] = [];
      try {
        safeAttachments = sanitizeAttachmentsInput(attachments);
      } catch (attErr) {
        return res.status(400).json({
          error: attErr instanceof Error ? attErr.message : 'Invalid attachment.',
        });
      }

      const safePriority = ['low', 'normal', 'high', 'urgent'].includes(priority)
        ? priority
        : 'normal';
      const [created] = await db
        .insert(changeRequests)
        .values({
          websiteId: access.website.id,
          clientId: resolvedClientId,
          submittedByProfileId: req.auth!.profile.id,
          title: title.trim().slice(0, 180),
          description: description.trim().slice(0, 4000),
          priority: safePriority,
          status: 'open',
          attachmentsJson: safeAttachments,
        })
        .returning();

      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        clientId: resolvedClientId,
        websiteId: access.website.id,
        action: 'change_request.created',
        entityType: 'change_request',
        entityId: created.id,
        details: {
          title: created.title,
          priority: created.priority,
          attachmentCount: safeAttachments.length,
        },
      });

      return res.status(201).json(formatChangeRequestForClient(created));
    } catch (error) {
      console.error('Error submitting change request:', error);
      return res.status(500).json({ error: 'Failed to submit change request' });
    }
  }
);

app.get(
  '/api/change-requests/:id/attachments/:attachmentId',
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const requestId = String(req.params.id);
      const attachmentId = String(req.params.attachmentId);

      const rows = await db
        .select({ request: changeRequests, orgId: websites.organizationId })
        .from(changeRequests)
        .innerJoin(websites, eq(changeRequests.websiteId, websites.id))
        .where(eq(changeRequests.id, requestId));

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Change request not found' });
      }

      const access = await verifyWebsiteAccess(req.auth!, rows[0].request.websiteId);
      const isOwnClient =
        Boolean(req.auth!.clientRecord) &&
        req.auth!.clientRecord!.id === rows[0].request.clientId;
      if (!access && !isOwnClient) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const attachments = Array.isArray(rows[0].request.attachmentsJson)
        ? rows[0].request.attachmentsJson
        : [];
      const found = attachments.find((a) => a.id === attachmentId);
      if (!found) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const match = /^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(found.dataUrl);
      if (!match) {
        return res.status(400).json({ error: 'Corrupt attachment data' });
      }
      const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
      const safeDownloadName = found.name.replace(/"/g, '_');

      res.setHeader('Content-Type', found.mimeType || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `${req.query.inline === '1' && found.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${safeDownloadName}"`
      );
      return res.send(buffer);
    } catch (error) {
      console.error('Error serving attachment:', error);
      return res.status(500).json({ error: 'Failed to load attachment' });
    }
  }
);

app.patch(
  '/api/change-requests/:id',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const requestId = String(req.params.id);
      const rows = await db
        .select({ request: changeRequests, orgId: websites.organizationId, websiteName: websites.name })
        .from(changeRequests)
        .innerJoin(websites, eq(changeRequests.websiteId, websites.id))
        .where(and(eq(changeRequests.id, requestId), eq(websites.organizationId, req.auth!.organization.id)));

      if (rows.length === 0) return res.status(404).json({ error: 'Change request not found' });

      const { status, adminResponse } = req.body ?? {};
      const validStatuses = ['open', 'in_review', 'in_progress', 'resolved', 'closed'];
      const [updated] = await db
        .update(changeRequests)
        .set({
          status: validStatuses.includes(status) ? status : rows[0].request.status,
          adminResponse:
            typeof adminResponse === 'string' ? adminResponse.trim() : rows[0].request.adminResponse,
          updatedAt: new Date(),
        })
        .where(eq(changeRequests.id, requestId))
        .returning();

      const [clientRow] = await db.select().from(clients).where(eq(clients.id, updated.clientId));
      if (clientRow && (status || adminResponse)) {
        await sendTransactionalEmail({
          to: clientRow.email,
          subject: `Update on your change request: ${updated.title}`,
          text: `Hello ${clientRow.fullName},\n\nYour request "${updated.title}" for ${rows[0].websiteName} is now "${updated.status}".\n${updated.adminResponse ? `\nAgency Note: ${updated.adminResponse}\n` : ''}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a"><h2>Change Request Updated</h2><p>Hello ${escapeHtml(clientRow.fullName)},</p><p>Your request <strong>${escapeHtml(updated.title)}</strong> for ${escapeHtml(rows[0].websiteName)} is now <strong>${escapeHtml(updated.status.replace('_', ' '))}</strong>.</p>${updated.adminResponse ? `<p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">${escapeHtml(updated.adminResponse)}</p>` : ''}</div>`,
        });
      }

      await logActivity({
        organizationId: req.auth!.organization.id,
        actorProfileId: req.auth!.profile.id,
        clientId: updated.clientId,
        websiteId: updated.websiteId,
        action: 'change_request.updated',
        entityType: 'change_request',
        entityId: updated.id,
        details: { status: updated.status },
      });

      return res.json(formatChangeRequestForClient(updated));
    } catch (error) {
      console.error('Error updating change request:', error);
      return res.status(500).json({ error: 'Failed to update change request' });
    }
  }
);

// ============================================================================
// WEBSITE UPTIME & SSL CERTIFICATE MONITORING
// ============================================================================

app.get('/api/websites/:id/uptime', requireAuth, async (req: AuthRequest, res) => {
  try {
    const websiteId = String(req.params.id);
    const access = await verifyWebsiteAccess(req.auth!, websiteId);
    if (!access) return res.status(403).json({ error: 'Website access denied.' });

    const checks = await db
      .select()
      .from(uptimeChecks)
      .where(eq(uptimeChecks.websiteId, websiteId))
      .orderBy(desc(uptimeChecks.checkedAt))
      .limit(25);

    const targetUrl = normalizeMonitorTarget(access.website.liveUrl, access.website.domain);
    return res.json({
      targetUrl,
      latest: checks[0] || null,
      checks,
    });
  } catch (error) {
    console.error('Error loading uptime history:', error);
    return res.status(500).json({ error: 'Failed to load uptime history.' });
  }
});

app.post('/api/websites/:id/uptime/check', requireAuth, async (req: AuthRequest, res) => {
  try {
    const websiteId = String(req.params.id);
    const access = await verifyWebsiteAccess(req.auth!, websiteId);
    if (!access) return res.status(403).json({ error: 'Website access denied.' });

    const result = await runUptimeCheckForWebsite(websiteId);

    await logActivity({
      organizationId: req.auth!.organization.id,
      actorProfileId: req.auth!.profile.id,
      clientId: access.website.clientId,
      websiteId,
      action: 'website.uptime_checked',
      entityType: 'website',
      entityId: websiteId,
      details: {
        isUp: result.check.isUp,
        httpStatus: result.check.httpStatus,
        responseTimeMs: result.check.responseTimeMs,
        sslDaysRemaining: result.check.sslDaysRemaining,
      },
    });

    return res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Uptime check failed.';
    return res.status(400).json({ error: msg });
  }
});

app.post(
  '/api/admin/uptime/check-all',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.auth!.organization.id;
      const orgSites = await db
        .select()
        .from(websites)
        .where(and(eq(websites.organizationId, orgId), eq(websites.status, 'active')))
        .orderBy(desc(websites.updatedAt))
        .limit(25);

      const monitorable = orgSites.filter((s) => normalizeMonitorTarget(s.liveUrl, s.domain));
      let checked = 0;
      let up = 0;
      let down = 0;
      const errors: Array<{ websiteId: string; name: string; error: string }> = [];

      const concurrency = 3;
      for (let i = 0; i < monitorable.length; i += concurrency) {
        const batch = monitorable.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          batch.map((site) => runUptimeCheckForWebsite(site.id))
        );
        results.forEach((r, idx) => {
          const site = batch[idx];
          if (r.status === 'fulfilled') {
            checked++;
            if (r.value.check.isUp) up++;
            else down++;
          } else {
            errors.push({
              websiteId: site.id,
              name: site.name,
              error: r.reason instanceof Error ? r.reason.message : 'Check failed',
            });
          }
        });
      }

      return res.json({
        totalEligible: monitorable.length,
        checked,
        up,
        down,
        errors,
      });
    } catch (error) {
      console.error('Error checking all websites:', error);
      return res.status(500).json({ error: 'Failed to run workspace health checks.' });
    }
  }
);

// ============================================================================
// INVOICING & RETAINER PAYMENT TRACKING
// ============================================================================

function formatMoneyText(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toFixed(2);
  return `${currency.toUpperCase()} ${amount}`;
}

app.get('/api/invoices', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { organization, membership, clientRecord } = req.auth!;
    const filterClientId = typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '';

    if (['super_admin', 'agency_admin', 'staff'].includes(membership.role)) {
      const condition = filterClientId
        ? and(eq(invoices.organizationId, organization.id), eq(invoices.clientId, filterClientId))
        : eq(invoices.organizationId, organization.id);

      const rows = await db
        .select({
          invoice: invoices,
          clientBusinessName: clients.businessName,
          clientFullName: clients.fullName,
          clientEmail: clients.email,
        })
        .from(invoices)
        .innerJoin(clients, eq(invoices.clientId, clients.id))
        .where(condition)
        .orderBy(desc(invoices.createdAt));

      return res.json(
        rows.map((r) => ({
          ...r.invoice,
          clientBusinessName: r.clientBusinessName,
          clientFullName: r.clientFullName,
          clientEmail: r.clientEmail,
        }))
      );
    }

    if (!clientRecord) {
      return res.json([]);
    }

    const rows = await db
      .select({
        invoice: invoices,
        clientBusinessName: clients.businessName,
        clientFullName: clients.fullName,
        clientEmail: clients.email,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(
        and(
          eq(invoices.organizationId, organization.id),
          eq(invoices.clientId, clientRecord.id)
        )
      )
      .orderBy(desc(invoices.createdAt));

    return res.json(
      rows.map((r) => ({
        ...r.invoice,
        clientBusinessName: r.clientBusinessName,
        clientFullName: r.clientFullName,
        clientEmail: r.clientEmail,
      }))
    );
  } catch (error) {
    console.error('Error loading invoices:', error);
    return res.status(500).json({ error: 'Failed to load invoices.' });
  }
});

app.post(
  '/api/clients/:id/invoices',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const clientId = String(req.params.id);
      const orgId = req.auth!.organization.id;

      const [clientRow] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)));
      if (!clientRow) {
        return res.status(404).json({ error: 'Client not found.' });
      }

      const {
        billingPeriod,
        description,
        amountCents,
        currency,
        dueDate,
        notes,
        sendEmail,
      } = req.body ?? {};

      const parsedAmount = Number(amountCents);
      if (!Number.isFinite(parsedAmount) || Math.round(parsedAmount) <= 0) {
        return res.status(400).json({ error: 'Invoice amount must be greater than zero.' });
      }

      const safePeriod =
        typeof billingPeriod === 'string' && billingPeriod.trim()
          ? billingPeriod.trim().slice(0, 80)
          : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const safeDescription =
        typeof description === 'string' && description.trim()
          ? description.trim().slice(0, 400)
          : `${clientRow.retainerPlan || 'Monthly Website Retainer'} (${safePeriod})`;
      const safeCurrency =
        typeof currency === 'string' && /^[A-Z]{3}$/i.test(currency.trim())
          ? currency.trim().toUpperCase()
          : (clientRow.currency || 'USD').toUpperCase();

      let parsedDueDate: Date | null = null;
      if (typeof dueDate === 'string' && dueDate.trim()) {
        const dt = new Date(dueDate.trim());
        if (!Number.isNaN(dt.getTime())) parsedDueDate = dt;
      }

      const existingCountRows = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.organizationId, orgId));
      const seq = String(existingCountRows.length + 1).padStart(3, '0');
      const ym = new Date().toISOString().slice(0, 7).replace('-', '');
      const invoiceNumber = `INV-${ym}-${seq}`;

      const [created] = await db
        .insert(invoices)
        .values({
          organizationId: orgId,
          clientId: clientRow.id,
          invoiceNumber,
          billingPeriod: safePeriod,
          description: safeDescription,
          amountCents: Math.round(parsedAmount),
          currency: safeCurrency,
          status: 'pending',
          dueDate: parsedDueDate,
          notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 1000) : null,
          createdByProfileId: req.auth!.profile.id,
        })
        .returning();

      let emailSent = false;
      if (sendEmail) {
        const emailResult = await sendTransactionalEmail({
          to: clientRow.email,
          subject: `${req.auth!.organization.name}: Invoice ${created.invoiceNumber} (${safePeriod})`,
          text: `Hello ${clientRow.fullName},\n\nA new retainer invoice ${created.invoiceNumber} has been issued for ${clientRow.businessName}.\nAmount: ${formatMoneyText(created.amountCents, created.currency)}\nDescription: ${created.description}${created.dueDate ? `\nDue Date: ${new Date(created.dueDate).toLocaleDateString()}` : ''}\n\nSign in to your client portal to view and print your invoice.`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a"><h2>New Retainer Invoice</h2><p>Hello ${escapeHtml(clientRow.fullName)},</p><p>Invoice <strong>${escapeHtml(created.invoiceNumber)}</strong> has been issued for <strong>${escapeHtml(clientRow.businessName)}</strong>.</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:16px 0"><p style="margin:0 0 6px"><strong>Period:</strong> ${escapeHtml(created.billingPeriod)}</p><p style="margin:0 0 6px"><strong>Amount:</strong> ${escapeHtml(formatMoneyText(created.amountCents, created.currency))}</p><p style="margin:0"><strong>Description:</strong> ${escapeHtml(created.description)}</p>${created.dueDate ? `<p style="margin:6px 0 0"><strong>Due Date:</strong> ${escapeHtml(new Date(created.dueDate).toLocaleDateString())}</p>` : ''}</div><p style="font-size:13px;color:#475569">Sign in to your WebManager Pro client portal to download or print your invoice.</p></div>`,
        });
        emailSent = emailResult.sent;
      }

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        clientId: clientRow.id,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: created.id,
        details: {
          invoiceNumber: created.invoiceNumber,
          amountCents: created.amountCents,
          currency: created.currency,
          emailSent,
        },
      });

      return res.status(201).json({
        ...created,
        clientBusinessName: clientRow.businessName,
        clientFullName: clientRow.fullName,
        clientEmail: clientRow.email,
        emailSent,
      });
    } catch (error) {
      console.error('Error creating invoice:', error);
      return res.status(500).json({ error: 'Failed to create invoice.' });
    }
  }
);

app.patch(
  '/api/invoices/:invoiceId',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const invoiceId = String(req.params.invoiceId);
      const orgId = req.auth!.organization.id;

      const [existing] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, orgId)));
      if (!existing) {
        return res.status(404).json({ error: 'Invoice not found.' });
      }

      const { status, paymentMethod, notes } = req.body ?? {};
      const validStatuses = ['pending', 'paid', 'overdue', 'void'];
      const nextStatus = validStatuses.includes(status) ? status : existing.status;

      let nextPaidAt = existing.paidAt;
      if (nextStatus === 'paid' && !nextPaidAt) {
        nextPaidAt = new Date();
      } else if (nextStatus !== 'paid') {
        nextPaidAt = null;
      }

      const [updated] = await db
        .update(invoices)
        .set({
          status: nextStatus,
          paidAt: nextPaidAt,
          paymentMethod:
            typeof paymentMethod === 'string'
              ? paymentMethod.trim().slice(0, 80) || null
              : existing.paymentMethod,
          notes:
            typeof notes === 'string' ? notes.trim().slice(0, 1000) || null : existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId))
        .returning();

      await logActivity({
        organizationId: orgId,
        actorProfileId: req.auth!.profile.id,
        clientId: updated.clientId,
        action: nextStatus === 'paid' ? 'invoice.paid' : 'invoice.updated',
        entityType: 'invoice',
        entityId: updated.id,
        details: {
          invoiceNumber: updated.invoiceNumber,
          status: updated.status,
          paymentMethod: updated.paymentMethod,
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error('Error updating invoice:', error);
      return res.status(500).json({ error: 'Failed to update invoice.' });
    }
  }
);

app.post(
  '/api/invoices/:invoiceId/send',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  async (req: AuthRequest, res) => {
    try {
      const invoiceId = String(req.params.invoiceId);
      const orgId = req.auth!.organization.id;

      const rows = await db
        .select({ invoice: invoices, client: clients })
        .from(invoices)
        .innerJoin(clients, eq(invoices.clientId, clients.id))
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, orgId)));

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Invoice not found.' });
      }

      const { invoice: inv, client } = rows[0];
      const emailResult = await sendTransactionalEmail({
        to: client.email,
        subject: `${req.auth!.organization.name}: Invoice ${inv.invoiceNumber} (${inv.status === 'paid' ? 'Receipt' : inv.billingPeriod})`,
        text: `Hello ${client.fullName},\n\nInvoice ${inv.invoiceNumber} for ${client.businessName} (${inv.status.toUpperCase()}).\nAmount: ${formatMoneyText(inv.amountCents, inv.currency)}\nDescription: ${inv.description}${inv.dueDate ? `\nDue Date: ${new Date(inv.dueDate).toLocaleDateString()}` : ''}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a"><h2>${inv.status === 'paid' ? 'Payment Receipt' : 'Retainer Invoice'} · ${escapeHtml(inv.invoiceNumber)}</h2><p>Hello ${escapeHtml(client.fullName)},</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:16px 0"><p style="margin:0 0 6px"><strong>Client:</strong> ${escapeHtml(client.businessName)}</p><p style="margin:0 0 6px"><strong>Period:</strong> ${escapeHtml(inv.billingPeriod)}</p><p style="margin:0 0 6px"><strong>Amount:</strong> ${escapeHtml(formatMoneyText(inv.amountCents, inv.currency))}</p><p style="margin:0 0 6px"><strong>Status:</strong> ${escapeHtml(inv.status.toUpperCase())}</p><p style="margin:0"><strong>Description:</strong> ${escapeHtml(inv.description)}</p></div></div>`,
      });

      if (!emailResult.sent) {
        return res.status(400).json({ error: emailResult.reason || 'Email delivery failed.' });
      }

      return res.json({ sent: true, recipient: client.email });
    } catch (error) {
      console.error('Error emailing invoice:', error);
      return res.status(500).json({ error: 'Failed to send invoice email.' });
    }
  }
);

app.get(
  '/api/email/status',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin', 'staff']),
  (_req, res) => {
    return res.json(getEmailServiceStatus());
  }
);

app.post(
  '/api/email/test',
  requireAuth,
  requireOrgRole(['super_admin', 'agency_admin']),
  async (req: AuthRequest, res) => {
    const requestedTo = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    const recipient = requestedTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedTo)
      ? requestedTo
      : req.auth!.profile.email;

    const result = await sendTransactionalEmail({
      to: recipient,
      subject: `${req.auth!.organization.name}: Test Email Configuration`,
      text: 'Your WebManager Pro transactional email delivery is active.',
      html: `<div style="font-family:system-ui,sans-serif;padding:20px;color:#0f172a"><h3>Email Delivery Verified</h3><p>Your ${escapeHtml(req.auth!.organization.name)} workspace is ready to deliver client invites, change request replies, and publish alerts.</p></div>`,
    });
    if (!result.sent) {
      return res.status(400).json({ error: result.reason || 'Email delivery failed.' });
    }
    return res.json({ ...result, recipient });
  }
);

app.get('/api/activity', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { organization, membership, clientRecord } = req.auth!;
    if (['super_admin', 'agency_admin', 'staff'].includes(membership.role)) {
      const logs = await db
        .select({
          log: activityLogs,
          actorName: profiles.fullName,
          actorEmail: profiles.email,
        })
        .from(activityLogs)
        .leftJoin(profiles, eq(activityLogs.actorProfileId, profiles.id))
        .where(eq(activityLogs.organizationId, organization.id))
        .orderBy(desc(activityLogs.createdAt))
        .limit(100);

      return res.json(
        logs.map((r) => ({
          ...r.log,
          actorName: r.actorName || 'System',
          actorEmail: r.actorEmail || null,
        }))
      );
    }

    if (!clientRecord) return res.json([]);
    const logs = await db
      .select({
        log: activityLogs,
        actorName: profiles.fullName,
      })
      .from(activityLogs)
      .leftJoin(profiles, eq(activityLogs.actorProfileId, profiles.id))
      .where(
        and(
          eq(activityLogs.organizationId, organization.id),
          eq(activityLogs.clientId, clientRecord.id)
        )
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(50);

    return res.json(
      logs.map((r) => ({
        ...r.log,
        actorName: r.actorName || 'Agency',
      }))
    );
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return res.status(500).json({ error: 'Failed to load activity logs' });
  }
});

// ============================================================================
// PUBLIC SANDBOXED HOSTED SITES (/sites/:websiteId/*)
// Registered before Vite middleware / SPA fallback so published snapshots resolve directly.
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function applyHostedSiteSecurityHeaders(res: express.Response) {
  // Strict sandbox without allow-same-origin isolates third-party client HTML/JS
  // into an opaque origin so it cannot access WebManager Pro auth state or APIs.
  res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
}

function sendHostedNotFound(res: express.Response, message: string) {
  applyHostedSiteSecurityHeaders(res);
  return res
    .status(404)
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Site Not Found</title>` +
        `<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}` +
        `.card{max-width:460px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px}` +
        `h1{font-size:20px;margin:0 0 8px}p{font-size:14px;color:#475569;margin:0;line-height:1.5}</style></head>` +
        `<body><div class="card"><h1>Site Unavailable</h1><p>${message}</p></div></body></html>`
    );
}

async function handleServeHostedSite(
  res: express.Response,
  websiteId: string,
  rawWildcard: string
) {
  try {
    if (!UUID_REGEX.test(websiteId)) {
      return sendHostedNotFound(res, 'This hosted website address is invalid.');
    }

    const [site] = await db
      .select({ id: websites.id, status: websites.status })
      .from(websites)
      .where(eq(websites.id, websiteId));

    if (!site) {
      return sendHostedNotFound(res, 'No website was found at this address.');
    }
    if (site.status === 'archived') {
      return sendHostedNotFound(res, 'This website is currently archived and offline.');
    }

    const trimmed = decodeURIComponent(rawWildcard || '').trim();
    let candidatePaths: string[] = [];
    if (!trimmed || trimmed === '/') {
      candidatePaths = ['index.html'];
    } else {
      const normalized = normalizeWebsitePath(trimmed);
      if (!normalized) {
        return sendHostedNotFound(res, 'The requested file path is invalid.');
      }
      candidatePaths = [normalized, `${normalized}/index.html`];
    }

    const matches = await db
      .select({
        path: websiteFiles.path,
        mimeType: websiteFiles.mimeType,
        publishedContent: websiteFiles.publishedContent,
      })
      .from(websiteFiles)
      .where(
        and(
          eq(websiteFiles.websiteId, websiteId),
          eq(websiteFiles.isDirectory, false),
          eq(websiteFiles.isPublished, true),
          inArray(websiteFiles.path, candidatePaths)
        )
      );

    const matched =
      matches.find((m) => m.path === candidatePaths[0]) ||
      (candidatePaths[1] ? matches.find((m) => m.path === candidatePaths[1]) : undefined);

    if (!matched || matched.publishedContent === null) {
      return sendHostedNotFound(
        res,
        'This page has not been published yet, or the requested file does not exist in the latest snapshot.'
      );
    }

    applyHostedSiteSecurityHeaders(res);

    // Never execute server-side scripts (.php, .py, .sh, .rb, etc.); serve safely as plain text.
    const lowerPath = matched.path.toLowerCase();
    const isScriptSource = /\.(php|py|pyw|pyi|sh|bash|zsh|rb|pl|cgi|asp|aspx|jsp)$/i.test(lowerPath);
    let contentType = isScriptSource ? 'text/plain' : matched.mimeType || inferMimeType(matched.path);
    if (isDataUrlPayload(matched.publishedContent) || isKnownBinaryExtension(matched.path)) {
      const binaryBuf = decodeBinaryAssetBuffer(matched.publishedContent);
      if (binaryBuf) {
        res.setHeader('Content-Type', contentType);
        return res.status(200).send(binaryBuf);
      }
    }
    if (
      contentType.startsWith('text/') ||
      contentType === 'application/javascript' ||
      contentType === 'application/json' ||
      contentType === 'application/xml' ||
      contentType === 'image/svg+xml'
    ) {
      contentType = `${contentType}; charset=utf-8`;
    }

    return res.status(200).type(contentType).send(matched.publishedContent);
  } catch (error) {
    console.error('Error serving hosted site asset:', error);
    return sendHostedNotFound(res, 'Unable to load the published snapshot.');
  }
}

app.get('/sites/:websiteId', (req, res) => {
  const websiteId = String(req.params.websiteId || '');
  if (!UUID_REGEX.test(websiteId)) {
    return sendHostedNotFound(res, 'This hosted website address is invalid.');
  }
  if (!req.path.endsWith('/')) {
    const queryIdx = req.originalUrl.indexOf('?');
    const suffix = queryIdx >= 0 ? req.originalUrl.slice(queryIdx) : '';
    return res.redirect(302, `/sites/${websiteId}/${suffix}`);
  }
  return handleServeHostedSite(res, websiteId, '');
});

app.get('/sites/:websiteId/*', (req, res) => {
  const websiteId = String(req.params.websiteId || '');
  const rawWildcard = String((req.params as Record<string, string>)[0] || '');
  return handleServeHostedSite(res, websiteId, rawWildcard);
});

// ============================================================================
// VITE DEV MIDDLEWARE & PRODUCTION STATIC SERVING
// ============================================================================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('registerSW.js')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`WebManager Pro server listening on http://0.0.0.0:${port}`);

    // Background uptime & SSL monitor every 15 minutes (non-blocking)
    const monitorTimer = setInterval(() => {
      runScheduledUptimeMonitor().catch((err) => {
        console.warn('Background uptime monitor tick failed:', err);
      });
    }, 15 * 60 * 1000);
    monitorTimer.unref();
  });
}

startServer().catch((err) => {
  console.error('Failed to start WebManager Pro server:', err);
  process.exit(1);
});
