import { db } from '../db/index.ts';
import { activityLogs } from '../db/schema.ts';

export interface LogActivityParams {
  organizationId: string;
  actorProfileId?: string | null;
  clientId?: string | null;
  websiteId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      organizationId: params.organizationId,
      actorProfileId: params.actorProfileId ?? null,
      clientId: params.clientId ?? null,
      websiteId: params.websiteId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      detailsJson: params.details ?? {},
      ipAddress: params.ipAddress ?? null,
    });
  } catch (error) {
    console.error('Failed to persist activity log:', error);
  }
}
