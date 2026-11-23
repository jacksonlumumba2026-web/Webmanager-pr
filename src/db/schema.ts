import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  brandLogoUrl: text('brand_logo_url'),
  primaryColor: text('primary_color').default('#0F172A').notNull(),
  accentColor: text('accent_color').default('#1D4ED8').notNull(),
  supportEmail: text('support_email'),
  customDomain: text('custom_domain'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firebaseUid: text('firebase_uid').unique(),
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    avatarUrl: text('avatar_url'),
    phone: text('phone'),
    role: text('role').default('client').notNull(), // 'super_admin' | 'agency_admin' | 'staff' | 'client'
    passwordHash: text('password_hash'),
    status: text('status').default('active').notNull(), // 'active' | 'suspended' | 'invited'
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_profiles_email').on(table.email),
    index('idx_profiles_role').on(table.role),
  ]
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    profileId: uuid('profile_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').default('staff').notNull(), // 'super_admin' | 'agency_admin' | 'staff' | 'client'
    permissionsJson: jsonb('permissions_json').$type<Record<string, boolean>>().default({}).notNull(),
    status: text('status').default('active').notNull(), // 'active' | 'suspended'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_org_member').on(table.organizationId, table.profileId),
    index('idx_org_members_org').on(table.organizationId),
    index('idx_org_members_profile').on(table.profileId),
  ]
);

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    businessName: text('business_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    status: text('status').default('active').notNull(), // 'active' | 'suspended' | 'pending'
    notes: text('notes'),
    retainerPlan: text('retainer_plan').default('Standard Care').notNull(),
    monthlyHoursIncluded: integer('monthly_hours_included').default(4).notNull(),
    hoursUsedThisMonth: integer('hours_used_this_month').default(0).notNull(),
    monthlyFeeCents: integer('monthly_fee_cents').default(0).notNull(),
    currency: text('currency').default('USD').notNull(),
    renewalDate: timestamp('renewal_date'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_clients_org').on(table.organizationId),
    index('idx_clients_email').on(table.email),
    index('idx_clients_profile').on(table.profileId),
  ]
);

export const websites = pgTable(
  'websites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    domain: text('domain'),
    liveUrl: text('live_url'),
    repositoryUrl: text('repository_url'),
    hostingProvider: text('hosting_provider').default('managed_hosting').notNull(), // 'managed_hosting' | 'github_pages' | 'custom_domain' | 'vercel' | 'netlify' | 'other'
    status: text('status').default('pending').notNull(), // 'active' | 'pending' | 'attention' | 'archived'
    description: text('description'),
    clientCanEdit: boolean('client_can_edit').default(false).notNull(),
    clientCanInviteCollaborators: boolean('client_can_invite_collaborators').default(false).notNull(),
    lastPublishedAt: timestamp('last_published_at'),
    lastUptimeStatus: text('last_uptime_status'), // 'up' | 'down'
    lastResponseTimeMs: integer('last_response_time_ms'),
    sslExpiresAt: timestamp('ssl_expires_at'),
    lastCheckedAt: timestamp('last_checked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_websites_org').on(table.organizationId),
    index('idx_websites_client').on(table.clientId),
    index('idx_websites_status').on(table.status),
  ]
);

export const websiteMembers = pgTable(
  'website_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .references(() => websites.id, { onDelete: 'cascade' })
      .notNull(),
    profileId: uuid('profile_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    accessLevel: text('access_level').default('viewer').notNull(), // 'owner' | 'editor' | 'viewer'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_website_member').on(table.websiteId, table.profileId),
    index('idx_website_members_website').on(table.websiteId),
  ]
);

export const websiteRepositories = pgTable(
  'website_repositories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .references(() => websites.id, { onDelete: 'cascade' })
      .notNull(),
    ownershipMode: text('ownership_mode').default('agency_managed').notNull(), // 'agency_managed' | 'client_owned'
    provider: text('provider').default('github').notNull(),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    defaultBranch: text('default_branch').default('main').notNull(),
    lastCommitSha: text('last_commit_sha'),
    lastSyncedAt: timestamp('last_synced_at'),
    connectedByProfileId: uuid('connected_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_website_repo').on(table.websiteId),
    index('idx_website_repos_website').on(table.websiteId),
  ]
);

export const websiteFiles = pgTable(
  'website_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .references(() => websites.id, { onDelete: 'cascade' })
      .notNull(),
    path: text('path').notNull(),
    name: text('name').notNull(),
    isDirectory: boolean('is_directory').default(false).notNull(),
    mimeType: text('mime_type').default('text/plain').notNull(),
    content: text('content').default('').notNull(),
    sizeBytes: integer('size_bytes').default(0).notNull(),
    isPublished: boolean('is_published').default(false).notNull(),
    publishedContent: text('published_content'),
    updatedByProfileId: uuid('updated_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_website_file_path').on(table.websiteId, table.path),
    index('idx_website_files_website').on(table.websiteId),
  ]
);

export const deploymentConfigs = pgTable(
  'deployment_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .references(() => websites.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').default('github_pages').notNull(), // 'github_pages' | 'custom_domain' | 'other'
    branch: text('branch').default('gh-pages').notNull(),
    buildCommand: text('build_command').default('').notNull(),
    outputDir: text('output_dir').default('/').notNull(),
    customDomain: text('custom_domain'),
    autoDeploy: boolean('auto_deploy').default(false).notNull(),
    domainVerified: boolean('domain_verified').default(false).notNull(),
    domainVerificationResult: text('domain_verification_result'),
    domainCheckedAt: timestamp('domain_checked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_deployment_config_website').on(table.websiteId)]
);

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .references(() => websites.id, { onDelete: 'cascade' })
      .notNull(),
    triggeredByProfileId: uuid('triggered_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').default('github_pages').notNull(),
    status: text('status').default('draft').notNull(), // 'draft' | 'ready' | 'publishing' | 'published' | 'failed'
    commitSha: text('commit_sha'),
    liveUrl: text('live_url'),
    logOutput: text('log_output').default('').notNull(),
    errorMessage: text('error_message'),
    snapshotFilesJson: jsonb('snapshot_files_json')
      .$type<Array<{ path: string; name: string; mimeType: string; content: string; sizeBytes: number }>>()
      .default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    index('idx_deployments_website').on(table.websiteId),
    index('idx_deployments_status').on(table.status),
  ]
);

export const changeRequests = pgTable(
  'change_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    websiteId: uuid('website_id')
      .references(() => websites.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    submittedByProfileId: uuid('submitted_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    priority: text('priority').default('normal').notNull(), // 'low' | 'normal' | 'high' | 'urgent'
    status: text('status').default('open').notNull(), // 'open' | 'in_review' | 'in_progress' | 'resolved' | 'closed'
    adminResponse: text('admin_response'),
    attachmentsJson: jsonb('attachments_json')
      .$type<Array<{ id: string; name: string; mimeType: string; sizeBytes: number; dataUrl: string }>>()
      .default([])
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_change_requests_website').on(table.websiteId),
    index('idx_change_requests_client').on(table.clientId),
    index('idx_change_requests_status').on(table.status),
  ]
);

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    actorProfileId: uuid('actor_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    websiteId: uuid('website_id').references(() => websites.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    detailsJson: jsonb('details_json').$type<Record<string, unknown>>().default({}).notNull(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_activity_logs_org').on(table.organizationId),
    index('idx_activity_logs_client').on(table.clientId),
    index('idx_activity_logs_website').on(table.websiteId),
    index('idx_activity_logs_created').on(table.createdAt),
  ]
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role').default('client').notNull(), // 'agency_admin' | 'staff' | 'client'
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    websiteId: uuid('website_id').references(() => websites.id, { onDelete: 'cascade' }),
    websiteAccessLevel: text('website_access_level'), // 'owner' | 'editor' | 'viewer'
    token: text('token').notNull().unique(),
    invitedByProfileId: uuid('invited_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'revoked' | 'expired'
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_invitations_org').on(table.organizationId),
    index('idx_invitations_email').on(table.email),
    index('idx_invitations_token').on(table.token),
  ]
);

export const contactInquiries = pgTable('contact_inquiries', {
  id: uuid('id').defaultRandom().primaryKey(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  company: text('company'),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  status: text('status').default('new').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const githubConnections = pgTable(
  'github_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    profileId: uuid('profile_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    scope: text('scope').default('agency').notNull(), // 'agency' | 'client'
    githubUserId: text('github_user_id').notNull(),
    githubLogin: text('github_login').notNull(),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    tokenScope: text('token_scope'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_github_conn_org_profile').on(table.organizationId, table.profileId),
  ]
);

export const uptimeChecks = pgTable(
  'uptime_checks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    websiteId: uuid('website_id')
      .references(() => websites.id, { onDelete: 'cascade' })
      .notNull(),
    targetUrl: text('target_url').notNull(),
    isUp: boolean('is_up').notNull(),
    httpStatus: integer('http_status'),
    responseTimeMs: integer('response_time_ms'),
    sslValid: boolean('ssl_valid'),
    sslExpiresAt: timestamp('ssl_expires_at'),
    sslDaysRemaining: integer('ssl_days_remaining'),
    sslIssuer: text('ssl_issuer'),
    errorMessage: text('error_message'),
    checkedAt: timestamp('checked_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_uptime_checks_website').on(table.websiteId),
    index('idx_uptime_checks_org').on(table.organizationId),
    index('idx_uptime_checks_checked').on(table.checkedAt),
  ]
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => clients.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    billingPeriod: text('billing_period').notNull(),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').default('USD').notNull(),
    status: text('status').default('pending').notNull(), // 'pending' | 'paid' | 'overdue' | 'void'
    dueDate: timestamp('due_date'),
    paidAt: timestamp('paid_at'),
    paymentMethod: text('payment_method'),
    notes: text('notes'),
    createdByProfileId: uuid('created_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_invoices_org').on(table.organizationId),
    index('idx_invoices_client').on(table.clientId),
    index('idx_invoices_status').on(table.status),
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  clients: many(clients),
  websites: many(websites),
  invitations: many(invitations),
  activityLogs: many(activityLogs),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  memberships: many(organizationMembers),
  clientProfiles: many(clients),
  activityLogs: many(activityLogs),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.organizationId],
    references: [organizations.id],
  }),
  profile: one(profiles, {
    fields: [clients.profileId],
    references: [profiles.id],
  }),
  websites: many(websites),
  changeRequests: many(changeRequests),
}));

export const websitesRelations = relations(websites, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [websites.organizationId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [websites.clientId],
    references: [clients.id],
  }),
  files: many(websiteFiles),
  deployments: many(deployments),
  changeRequests: many(changeRequests),
}));
