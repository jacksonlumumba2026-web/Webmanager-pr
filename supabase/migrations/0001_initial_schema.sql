-- WebManager Pro: Multi-Tenant PostgreSQL + Row Level Security (RLS) Migration
-- Compatible with Supabase PostgreSQL 15+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  brand_logo_url text,
  primary_color text NOT NULL DEFAULT '#0F172A',
  accent_color text NOT NULL DEFAULT '#1D4ED8',
  support_email text,
  custom_domain text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text UNIQUE,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  avatar_url text,
  phone text,
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('super_admin', 'agency_admin', 'staff', 'client')),
  password_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'invited')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Organization Members
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('super_admin', 'agency_admin', 'staff', 'client')),
  permissions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, profile_id)
);

-- 4. Clients
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  business_name text NOT NULL,
  email text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Websites
CREATE TABLE IF NOT EXISTS public.websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  name text NOT NULL,
  domain text,
  live_url text,
  repository_url text,
  hosting_provider text NOT NULL DEFAULT 'github_pages',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'attention', 'archived')),
  description text,
  last_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Website Members
CREATE TABLE IF NOT EXISTS public.website_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'viewer' CHECK (access_level IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, profile_id)
);

-- 7. Website Repositories
CREATE TABLE IF NOT EXISTS public.website_repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL UNIQUE REFERENCES public.websites(id) ON DELETE CASCADE,
  ownership_mode text NOT NULL DEFAULT 'agency_managed' CHECK (ownership_mode IN ('agency_managed', 'client_owned')),
  provider text NOT NULL DEFAULT 'github',
  repo_owner text NOT NULL,
  repo_name text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  last_commit_sha text,
  last_synced_at timestamptz,
  connected_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Website Files
CREATE TABLE IF NOT EXISTS public.website_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  path text NOT NULL,
  name text NOT NULL,
  is_directory boolean NOT NULL DEFAULT false,
  mime_type text NOT NULL DEFAULT 'text/plain',
  content text NOT NULL DEFAULT '',
  size_bytes integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  published_content text,
  updated_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id, path)
);

-- 9. Deployment Configs
CREATE TABLE IF NOT EXISTS public.deployment_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL UNIQUE REFERENCES public.websites(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'github_pages',
  branch text NOT NULL DEFAULT 'gh-pages',
  build_command text NOT NULL DEFAULT '',
  output_dir text NOT NULL DEFAULT '/',
  custom_domain text,
  auto_deploy boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 10. Deployments
CREATE TABLE IF NOT EXISTS public.deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  triggered_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'github_pages',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'publishing', 'published', 'failed')),
  commit_sha text,
  live_url text,
  log_output text NOT NULL DEFAULT '',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- 11. Change Requests
CREATE TABLE IF NOT EXISTS public.change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  submitted_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'in_progress', 'resolved', 'closed')),
  admin_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Activity Logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  website_id uuid REFERENCES public.websites(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 13. Invitations
CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('agency_admin', 'staff', 'client')),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  invited_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security (RLS) Enablement
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Example RLS helper function (Supabase auth.uid() mapping)
CREATE OR REPLACE FUNCTION public.is_org_staff(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = org_id
      AND om.profile_id = auth.uid()
      AND om.status = 'active'
      AND om.role IN ('super_admin', 'agency_admin', 'staff')
  );
$$;

-- Clients policy: Agency staff see org clients; Clients see only their own row
CREATE POLICY "clients_select_policy" ON public.clients
FOR SELECT USING (
  public.is_org_staff(organization_id)
  OR profile_id = auth.uid()
);

-- Websites policy: Agency staff see org websites; Clients see only assigned websites
CREATE POLICY "websites_select_policy" ON public.websites
FOR SELECT USING (
  public.is_org_staff(organization_id)
  OR EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = websites.client_id AND c.profile_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.website_members wm
    WHERE wm.website_id = websites.id AND wm.profile_id = auth.uid()
  )
);
