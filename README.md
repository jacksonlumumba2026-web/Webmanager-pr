# WebManager Pro

White-label website management, source editing, GitHub synchronization, and client portal platform built with React, TypeScript, Vite, Tailwind CSS, Express, Drizzle ORM, PostgreSQL (Cloud SQL), Firebase Authentication, and Monaco Editor.

## Architecture Overview

- **Public Website**: `/`, `/features`, `/pricing`, `/about`, `/contact` (backed by PostgreSQL `contact_inquiries`).
- **Authentication & Onboarding**: `/login`, `/register`, `/invite/:token` supporting Firebase Google Sign-In (`firebase-admin` server verification) and scrypt-hashed invitation/workspace credentials with HMAC-SHA256 Bearer tokens held in React memory.
- **Role-Based Access Control (4 Roles)**:
  - `super_admin` & `agency_admin`: Full organization management, white-label branding, staff permissions, client lifecycle, websites, source editor, GitHub integration, and publishing.
  - `staff`: Organization access scoped by per-member `permissionsJson` toggles (`manageClients`, `manageWebsites`, `publishWebsites`).
  - `client`: Isolated access to assigned websites, live links, deployment history, read-only source files, change requests, and client-scoped activity logs.
- **Database**: Multi-tenant PostgreSQL schema in `src/db/schema.ts` (15 tables with UUID primary keys, foreign keys, and indexes) plus Supabase RLS reference SQL in `supabase/migrations/0001_initial_schema.sql`.
- **Source Code & Publishing**:
  - File explorer with path confinement, folder creation, upload, download, rename, delete, and Monaco Editor syntax highlighting.
  - Explicit Draft vs. Published state (`isPublished` / `publishedContent`).
  - Server-side GitHub OAuth with AES-256-GCM encrypted token storage and GitHub Pages publishing.

## Required Environment Variables

Configure these secrets in your deployment environment:

1. **Managed PostgreSQL & Auth**: Automatically provisioned by AI Studio Cloud SQL (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`) and `firebase-applet-config.json`.
2. **GitHub OAuth Integration** (required to connect GitHub accounts, pull/commit repositories, and publish to GitHub Pages):
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `GITHUB_TOKEN_ENCRYPTION_KEY` (optional 32+ char secret for AES-256-GCM token encryption)
   - Register the exact callback URL in your GitHub OAuth App settings (`https://<your-app-url>/api/github/callback`).

## Development & Verification

```bash
npm run lint     # TypeScript type-checking
npm run build    # Production Vite bundle
npm run dev      # Express + Vite middleware server on port 3000
npm start        # Production Express server on port 3000
```
