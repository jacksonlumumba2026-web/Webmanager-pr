import type { NextFunction, Request, Response } from 'express';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  clients,
  invitations,
  organizationMembers,
  organizations,
  profiles,
  websiteMembers,
  websites,
} from '../db/schema.ts';
import { verifySessionToken } from '../lib/crypto.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { logActivity } from '../services/audit.ts';

export type UserRole = 'super_admin' | 'agency_admin' | 'staff' | 'client';

export interface AuthContext {
  profile: typeof profiles.$inferSelect;
  organization: typeof organizations.$inferSelect;
  membership: typeof organizationMembers.$inferSelect;
  clientRecord: typeof clients.$inferSelect | null;
}

export interface AuthRequest extends Request {
  auth?: AuthContext;
}

async function resolveDefaultOrInvitedMembership(
  profile: typeof profiles.$inferSelect
): Promise<{
  organization: typeof organizations.$inferSelect;
  membership: typeof organizationMembers.$inferSelect;
  updatedProfile: typeof profiles.$inferSelect;
}> {
  const existingMemberships = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.profileId, profile.id));

  if (existingMemberships.length > 0) {
    const membership = existingMemberships[0];
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, membership.organizationId));
    if (org) {
      return { organization: org, membership, updatedProfile: profile };
    }
  }

  // Check for a pending invitation matching this email
  const pendingInvites = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, profile.email.toLowerCase()), eq(invitations.status, 'pending')));

  if (pendingInvites.length > 0) {
    const invite = pendingInvites[0];
    if (invite.expiresAt > new Date()) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, invite.organizationId));

      if (org) {
        const [updatedProfile] = await db
          .update(profiles)
          .set({ role: invite.role, status: 'active', updatedAt: new Date() })
          .where(eq(profiles.id, profile.id))
          .returning();

        const [membership] = await db
          .insert(organizationMembers)
          .values({
            organizationId: org.id,
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
          })
          .returning();

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

        await db
          .update(invitations)
          .set({ status: 'accepted' })
          .where(eq(invitations.id, invite.id));

        await logActivity({
          organizationId: org.id,
          actorProfileId: profile.id,
          clientId: invite.clientId,
          action: 'invitation.accepted',
          entityType: 'invitation',
          entityId: invite.id,
          details: { email: profile.email, role: invite.role },
        });

        return { organization: org, membership, updatedProfile };
      }
    }
  }

  // Check if any organizations exist; if none exist, bootstrap the primary agency workspace with this user as super_admin
  const [{ value: orgCount }] = await db.select({ value: count() }).from(organizations);
  if (Number(orgCount) === 0) {
    const slug = `agency-${profile.id.slice(0, 8)}`;
    const [org] = await db
      .insert(organizations)
      .values({
        name: 'WebManager Pro Studio',
        slug,
        primaryColor: '#0F172A',
        accentColor: '#1D4ED8',
        supportEmail: profile.email,
      })
      .returning();

    const [updatedProfile] = await db
      .update(profiles)
      .set({ role: 'super_admin', status: 'active', updatedAt: new Date() })
      .where(eq(profiles.id, profile.id))
      .returning();

    const [membership] = await db
      .insert(organizationMembers)
      .values({
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
      })
      .returning();

    return { organization: org, membership, updatedProfile };
  }

  // Otherwise create a separate agency workspace for new self-registered Google users
  const slug = `workspace-${profile.id.slice(0, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: `${profile.fullName}'s Agency`,
      slug,
      primaryColor: '#0F172A',
      accentColor: '#1D4ED8',
      supportEmail: profile.email,
    })
    .returning();

  const [updatedProfile] = await db
    .update(profiles)
    .set({ role: 'agency_admin', status: 'active', updatedAt: new Date() })
    .where(eq(profiles.id, profile.id))
    .returning();

  const [membership] = await db
    .insert(organizationMembers)
    .values({
      organizationId: org.id,
      profileId: profile.id,
      role: 'agency_admin',
      permissionsJson: {
        manageClients: true,
        manageWebsites: true,
        manageStaff: true,
        publishWebsites: true,
      },
      status: 'active',
    })
    .returning();

  return { organization: org, membership, updatedProfile };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token is missing' });
  }

  try {
    let profile: typeof profiles.$inferSelect | undefined;

    const customPayload = verifySessionToken(token);
    if (customPayload) {
      const [found] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, customPayload.profileId));
      profile = found;
    } else {
      const decoded = await adminAuth.verifyIdToken(token);
      const email = (decoded.email || '').toLowerCase();
      if (!email) {
        return res.status(401).json({ error: 'Authenticated account must have an email address' });
      }

      const existingByUid = await db
        .select()
        .from(profiles)
        .where(eq(profiles.firebaseUid, decoded.uid));

      if (existingByUid.length > 0) {
        const [updated] = await db
          .update(profiles)
          .set({
            lastLoginAt: new Date(),
            avatarUrl: existingByUid[0].avatarUrl || decoded.picture || null,
            updatedAt: new Date(),
          })
          .where(eq(profiles.id, existingByUid[0].id))
          .returning();
        profile = updated;
      } else {
        const [{ value: totalProfiles }] = await db.select({ value: count() }).from(profiles);
        const defaultRole = Number(totalProfiles) === 0 ? 'super_admin' : 'agency_admin';

        const [upserted] = await db
          .insert(profiles)
          .values({
            firebaseUid: decoded.uid,
            email,
            fullName: decoded.name || email.split('@')[0],
            avatarUrl: decoded.picture || null,
            role: defaultRole,
            status: 'active',
            lastLoginAt: new Date(),
          })
          .onConflictDoUpdate({
            target: profiles.email,
            set: {
              firebaseUid: decoded.uid,
              lastLoginAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();
        profile = upserted;
      }
    }

    if (!profile) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (profile.status === 'suspended') {
      return res.status(403).json({ error: 'Account access is suspended. Contact your administrator.' });
    }

    const { organization, membership, updatedProfile } = await resolveDefaultOrInvitedMembership(profile);

    if (membership.status === 'suspended') {
      return res.status(403).json({ error: 'Workspace membership is suspended.' });
    }

    const clientRows = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.organizationId, organization.id),
          eq(clients.profileId, updatedProfile.id)
        )
      );

    req.auth = {
      profile: updatedProfile,
      organization,
      membership,
      clientRecord: clientRows[0] ?? null,
    };

    return next();
  } catch (error) {
    console.error('Authentication verification failed:', error);
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
};

export function requireOrgRole(allowedRoles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const role = req.auth.membership.role as UserRole;
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this operation' });
    }
    return next();
  };
}

export function hasStaffPermission(auth: AuthContext, permissionKey: string): boolean {
  if (auth.membership.role === 'super_admin' || auth.membership.role === 'agency_admin') {
    return true;
  }
  if (auth.membership.role !== 'staff') {
    return false;
  }
  const perms = auth.membership.permissionsJson || {};
  return perms[permissionKey] !== false;
}

export async function verifyWebsiteAccess(
  auth: AuthContext,
  websiteId: string
): Promise<{
  website: typeof websites.$inferSelect;
  canEditFiles: boolean;
  canInviteCollaborators: boolean;
  accessLevel: 'agency' | 'owner' | 'editor' | 'viewer';
} | null> {
  const [website] = await db
    .select()
    .from(websites)
    .where(and(eq(websites.id, websiteId), eq(websites.organizationId, auth.organization.id)));

  if (!website) return null;

  const role = auth.membership.role as UserRole;
  if (role === 'super_admin' || role === 'agency_admin') {
    return { website, canEditFiles: true, canInviteCollaborators: true, accessLevel: 'agency' };
  }
  if (role === 'staff') {
    const canManage = hasStaffPermission(auth, 'manageWebsites');
    return { website, canEditFiles: canManage, canInviteCollaborators: canManage, accessLevel: 'agency' };
  }

  const memberRows = await db
    .select()
    .from(websiteMembers)
    .where(and(eq(websiteMembers.websiteId, websiteId), eq(websiteMembers.profileId, auth.profile.id)));

  const explicitLevel = memberRows[0]?.accessLevel as 'owner' | 'editor' | 'viewer' | undefined;

  // Primary client access verification via clientRecord
  if (auth.clientRecord && website.clientId === auth.clientRecord.id) {
    if (auth.clientRecord.status === 'suspended') return null;
    const canEdit = Boolean(website.clientCanEdit) || explicitLevel === 'editor' || explicitLevel === 'owner';
    return {
      website,
      canEditFiles: canEdit,
      canInviteCollaborators: Boolean(website.clientCanInviteCollaborators),
      accessLevel: explicitLevel || (canEdit ? 'editor' : 'viewer'),
    };
  }

  if (memberRows.length > 0) {
    const level = explicitLevel || 'viewer';
    return {
      website,
      canEditFiles: level !== 'viewer',
      canInviteCollaborators: level === 'owner' && Boolean(website.clientCanInviteCollaborators),
      accessLevel: level,
    };
  }

  return null;
}
