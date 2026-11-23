export type UserRole = 'super_admin' | 'agency_admin' | 'staff' | 'client';

export interface PublicBrand {
  name: string;
  primaryColor: string;
  accentColor: string;
  brandLogoUrl: string | null;
  supportEmail: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  brandLogoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  supportEmail: string | null;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  role: UserRole;
  status: string;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface OrganizationMembership {
  id: string;
  role: UserRole;
  permissions: Record<string, boolean>;
  status: string;
}

export interface ClientRecord {
  id: string;
  organizationId: string;
  profileId: string | null;
  fullName: string;
  businessName: string;
  email: string;
  phone: string | null;
  status: 'active' | 'suspended' | 'pending';
  notes: string | null;
  retainerPlan?: string;
  monthlyHoursIncluded?: number;
  hoursUsedThisMonth?: number;
  monthlyFeeCents?: number;
  currency?: string;
  renewalDate?: string | null;
  websiteCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebsiteRecord {
  id: string;
  organizationId: string;
  clientId: string | null;
  clientName?: string | null;
  name: string;
  domain: string | null;
  liveUrl: string | null;
  repositoryUrl: string | null;
  hostingProvider: 'managed_hosting' | 'github_pages' | 'custom_domain' | 'vercel' | 'netlify' | 'other';
  status: 'active' | 'pending' | 'attention' | 'archived';
  description: string | null;
  clientCanEdit?: boolean;
  clientCanInviteCollaborators?: boolean;
  lastPublishedAt: string | null;
  lastUptimeStatus?: 'up' | 'down' | null;
  lastResponseTimeMs?: number | null;
  sslExpiresAt?: string | null;
  lastCheckedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UptimeCheckRecord {
  id: string;
  organizationId: string;
  websiteId: string;
  targetUrl: string;
  isUp: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  sslValid: boolean | null;
  sslExpiresAt: string | null;
  sslDaysRemaining: number | null;
  sslIssuer: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

export interface InvoiceRecord {
  id: string;
  organizationId: string;
  clientId: string;
  clientBusinessName?: string;
  clientFullName?: string;
  clientEmail?: string;
  invoiceNumber: string;
  billingPeriod: string;
  description: string;
  amountCents: number;
  currency: string;
  status: 'pending' | 'paid' | 'overdue' | 'void';
  dueDate: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebsiteFileRecord {
  id: string;
  websiteId: string;
  path: string;
  name: string;
  isDirectory: boolean;
  mimeType: string;
  content: string;
  sizeBytes: number;
  isPublished: boolean;
  publishedContent: string | null;
  hasUnpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebsiteRepositoryRecord {
  id: string;
  websiteId: string;
  ownershipMode: 'agency_managed' | 'client_owned';
  provider: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  lastCommitSha: string | null;
  lastSyncedAt: string | null;
}

export interface DeploymentConfigRecord {
  id: string;
  websiteId: string;
  provider: 'managed_hosting' | 'github_pages' | 'custom_domain' | 'other';
  branch: string;
  buildCommand: string;
  outputDir: string;
  customDomain: string | null;
  autoDeploy: boolean;
  domainVerified?: boolean;
  domainVerificationResult?: string | null;
  domainCheckedAt?: string | null;
}

export interface DeploymentRecord {
  id: string;
  websiteId: string;
  provider: string;
  status: 'draft' | 'ready' | 'publishing' | 'published' | 'failed';
  commitSha: string | null;
  liveUrl: string | null;
  logOutput: string;
  errorMessage: string | null;
  hasSnapshot?: boolean;
  snapshotFileCount?: number;
  createdAt: string;
  completedAt: string | null;
}

export interface WebsiteCollaboratorRecord {
  id: string;
  profileId: string;
  accessLevel: 'owner' | 'editor' | 'viewer';
  fullName: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface EmailServiceStatus {
  configured: boolean;
  provider: 'resend' | 'smtp' | 'none';
  fromAddress: string | null;
  resendConfigured?: boolean;
  smtpConfigured?: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  configWarning?: string | null;
}

export interface MaintenanceReportResponse {
  generatedAt: string;
  monthLabel: string;
  agencyName: string;
  client: ClientRecord;
  summary: {
    totalWebsites: number;
    activeWebsites: number;
    deploymentsThisMonth: number;
    resolvedRequestsThisMonth: number;
    openRequestsCount: number;
  };
  websites: Array<{
    id: string;
    name: string;
    domain: string | null;
    liveUrl: string | null;
    status: string;
    lastPublishedAt: string | null;
  }>;
  recentDeployments: Array<{
    id: string;
    websiteId: string;
    provider: string;
    status: string;
    liveUrl: string | null;
    createdAt: string;
  }>;
  recentRequests: ChangeRequestRecord[];
  recentActivities: ActivityLogRecord[];
}

export interface ChangeRequestAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isImage?: boolean;
}

export interface ChangeRequestRecord {
  id: string;
  websiteId: string;
  clientId: string;
  websiteName?: string;
  clientBusiness?: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_review' | 'in_progress' | 'resolved' | 'closed';
  adminResponse: string | null;
  attachments?: ChangeRequestAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLogRecord {
  id: string;
  organizationId: string;
  actorProfileId: string | null;
  actorName?: string;
  actorEmail?: string | null;
  clientId: string | null;
  websiteId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  detailsJson: Record<string, unknown>;
  createdAt: string;
}

export interface StaffMemberRecord {
  memberId: string;
  profileId: string;
  fullName: string;
  email: string;
  role: UserRole;
  permissions: Record<string, boolean>;
  status: 'active' | 'suspended';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InvitationRecord {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  websiteId?: string | null;
  websiteAccessLevel?: string | null;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface GitHubStatus {
  configured: boolean;
  connected: boolean;
  connection: {
    id: string;
    githubLogin: string;
    scope: string;
    updatedAt: string;
  } | null;
  callbackUrl: string;
}

export interface GitHubRepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  isPrivate: boolean;
  htmlUrl: string;
  defaultBranch: string;
}
