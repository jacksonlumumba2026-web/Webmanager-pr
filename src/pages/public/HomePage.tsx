import { Link } from 'react-router-dom';
import { ArrowRight, Code2, FolderGit2, Globe, Shield } from 'lucide-react';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

export function HomePage() {
  const { authenticated, isAdminOrStaff } = useAuth();

  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="text-sm font-medium text-blue-700">
              White-Label Agency Operations Platform
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.1] text-balance">
              Manage every client website, source file, and deployment from one system.
            </h1>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
              WebManager Pro gives web development agencies a unified operations console with isolated client portals, browser-based Monaco source editing, GitHub synchronization, and verifiable publishing pipelines.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                to={authenticated ? (isAdminOrStaff ? '/dashboard' : '/portal') : '/register'}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <span>{authenticated ? 'Open Workspace' : 'Get Started'}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/features"
                className="inline-flex items-center px-5 py-3 text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                Explore Features
              </Link>
              <Link
                to="/contact"
                className="text-sm font-medium text-slate-600 hover:text-slate-900 px-2 py-2 whitespace-nowrap"
              >
                Contact Us
              </Link>
            </div>
          </div>

          <div className="lg:col-span-6 flex">
            <div className="relative w-full min-h-[300px] lg:h-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
              <img
                src="/src/assets/images/hero_agency_workspace_1795276092653.jpg"
                alt="WebManager Pro agency engineering workspace"
                referrerPolicy="no-referrer"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Full-Width Proof Strip Directly Below Hero Split */}
        <div className="border-t border-slate-200 bg-slate-50/70">
          <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 lg:grid-cols-4 gap-8">
            <div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">100%</p>
              <p className="text-sm text-slate-600 mt-1">Server-enforced client data isolation</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">4 Roles</p>
              <p className="text-sm text-slate-600 mt-1">Super Admin, Agency Admin, Staff, and Client</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">2 Modes</p>
              <p className="text-sm text-slate-600 mt-1">Agency-managed and client-owned GitHub repos</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">&lt; 5 min</p>
              <p className="text-sm text-slate-600 mt-1">Invite-to-onboarding turnaround for new clients</p>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Asymmetric Bento Grid */}
      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 space-y-12">
          <div className="max-w-2xl space-y-3">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 text-balance">
              Built for agencies running multi-client production portfolios
            </h2>
            <p className="text-base text-slate-600 leading-relaxed">
              Replace scattered spreadsheets, ad-hoc FTP credentials, and email threads with structured client records, auditable file edits, and controlled publishing.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-slate-50/50 p-8 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                  <Code2 className="w-4 h-4" />
                  <span>01. Integrated Source Editing</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900">
                  Edit HTML, CSS, TypeScript, JSON, and Markdown directly in Monaco Editor
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
                  Navigate project folders, create or rename assets, download backups, and track saved draft edits separately from published production snapshots.
                </p>
              </div>
              <div className="rounded-lg overflow-hidden border border-slate-200 bg-white aspect-[16/9] max-h-64">
                <img
                  src="/src/assets/images/feature_code_deployment_1795276090763.jpg"
                  alt="Engineering workstation for source management and deployment"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-8 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                  <Shield className="w-4 h-4" />
                  <span>02. Client Portals</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900">
                  Dedicated non-technical portals per client
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Business owners sign in via secure invitation links to inspect live site status, review deployment history, and submit prioritized change requests without ever seeing another client&apos;s workspace.
                </p>
              </div>
              <div className="pt-4 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
                <span>Role isolation</span>
                <span className="font-mono tabular-nums text-slate-700">Organization + Client ID</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-8 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                <FolderGit2 className="w-4 h-4" />
                <span>03. GitHub Workflows</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900">
                Agency-managed or client-owned repositories
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Authenticate via server-side GitHub OAuth with AES-256-GCM encrypted token storage. Pull source trees, commit verified file edits, and track commit hashes.
              </p>
            </div>

            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="space-y-3 max-w-xl">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                  <Globe className="w-4 h-4" />
                  <span>04. Verifiable Publishing &amp; White-Label Branding</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900">
                  Honest deployment state and agency customization
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Configure GitHub Pages or custom domain targets, inspect real deployment logs from Draft through Published or Failed, and customize the console logo, accent color, and agency name.
                </p>
              </div>
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <span>View Plans</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Conversion Band */}
      <section className="py-16 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="space-y-2 max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">
              Launch your agency workspace in minutes
            </h2>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Create your white-label organization, add your first client, and manage live websites from a single audited database.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 shrink-0">
            <Link
              to="/register"
              className="px-5 py-3 text-sm font-semibold text-slate-900 bg-white rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              Get Started
            </Link>
            <Link
              to="/login"
              className="px-5 py-3 text-sm font-semibold text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Client Login
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
