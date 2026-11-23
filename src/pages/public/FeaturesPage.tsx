import { Link } from 'react-router-dom';
import { Activity, Code2, FolderGit2, Globe, Lock, Users } from 'lucide-react';
import { PublicLayout } from '../../components/layouts/PublicLayout.tsx';

const CAPABILITIES = [
  {
    icon: Users,
    title: '01. Client Lifecycle & Invitation Onboarding',
    description:
      'Create client records with business profiles, generate secure 7-day invitation links, assign websites, suspend compromised accounts, and review client-specific activity logs.',
    detail: 'Supports Google Sign-In and scrypt-hashed invitation credentials.',
  },
  {
    icon: Code2,
    title: '02. Browser File Explorer & Monaco Source Editor',
    description:
      'Manage folders and web files (HTML, CSS, JS, TS, JSON, Markdown, SVG, PHP) with multi-file tabs, syntax highlighting, upload/download, and explicit draft vs. published state.',
    detail: 'Strict path normalization and zero server-side code execution.',
  },
  {
    icon: FolderGit2,
    title: '03. Dual-Mode GitHub Repository Sync',
    description:
      'Link agency-managed repositories or let clients connect their own GitHub accounts via server-side OAuth. Pull repository trees and commit edited files directly from the editor.',
    detail: 'Access tokens encrypted with AES-256-GCM at rest on the server.',
  },
  {
    icon: Globe,
    title: '04. Verifiable Publishing & Deployment History',
    description:
      'Configure GitHub Pages or custom domain deployment targets, inspect full deployment logs, and track real Draft, Ready, Publishing, Published, and Failed outcomes.',
    detail: 'No simulated deploys—provider verification required before marking Published.',
  },
  {
    icon: Lock,
    title: '05. Role-Based Access Control (4 Tiers)',
    description:
      'Enforce Super Administrator, Agency Administrator, Staff Member (with granular toggles), and Client permissions across every API endpoint and database query.',
    detail: 'Clients only see their own assigned websites, requests, and activity.',
  },
  {
    icon: Activity,
    title: '06. Audit Trail & Automated CSV/JSON Reporting',
    description:
      'Every client update, file edit, permission change, and deployment is logged with actor identity and timestamp. Export portfolio reports in one click.',
    detail: 'Instant CSV & JSON exports for agency operations reviews.',
  },
];

export function FeaturesPage() {
  return (
    <PublicLayout>
      <section className="py-16 lg:py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 space-y-4">
          <p className="text-sm font-medium text-blue-700">Platform Capabilities</p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 max-w-3xl text-balance">
            Every tool required to operate client websites at agency scale
          </h1>
          <p className="text-base text-slate-600 max-w-2xl leading-relaxed">
            Designed around clean separation between agency engineering controls and simple, transparent client portals.
          </p>
        </div>
      </section>

      <section className="py-16 bg-slate-50/70">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.title}
                className="p-8 rounded-xl bg-white border border-slate-200 flex flex-col justify-between gap-6"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-900">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{cap.title}</h2>
                  <p className="text-sm text-slate-600 leading-relaxed">{cap.description}</p>
                </div>
                <p className="text-xs text-slate-500 pt-4 border-t border-slate-100">{cap.detail}</p>
              </div>
            );
          })}
        </div>

        <div className="max-w-7xl mx-auto px-6 mt-12 flex justify-center">
          <Link
            to="/register"
            className="px-6 py-3 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
          >
            Create Agency Workspace
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
