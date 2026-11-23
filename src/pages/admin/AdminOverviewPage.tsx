import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  HelpCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { formatInvoiceMoney } from '../../components/billing/InvoiceModal.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import type {
  ActivityLogRecord,
  ClientRecord,
  DeploymentRecord,
  WebsiteRecord,
} from '../../types/index.ts';

interface OverviewResponse {
  metrics: {
    totalClients: number;
    totalWebsites: number;
    activeWebsites: number;
    pendingWebsites: number;
    attentionWebsites: number;
    openChangeRequests: number;
    sitesDownCount?: number;
    expiringSslCount?: number;
    outstandingInvoicesCount?: number;
    outstandingAmountCents?: number;
  };
  recentClients: ClientRecord[];
  recentWebsites: WebsiteRecord[];
  recentActivities: ActivityLogRecord[];
  recentDeployments: DeploymentRecord[];
}

export function AdminOverviewPage() {
  const { getAuthToken } = useAuth();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthNotice, setHealthNotice] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showGuide, setShowGuide] = useState(true);

  const loadOverview = useCallback(async () => {
    try {
      const res = await apiRequest<OverviewResponse>('/api/admin/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleCheckAllHealth = async () => {
    setCheckingHealth(true);
    setError(null);
    setHealthNotice(null);
    try {
      const res = await apiRequest<{
        totalEligible: number;
        checked: number;
        up: number;
        down: number;
      }>('/api/admin/uptime/check-all', { method: 'POST' });
      setHealthNotice(
        res.checked === 0
          ? 'No active websites with a public domain or live URL to check.'
          : `Checked ${res.checked} active website${res.checked === 1 ? '' : 's'}: ${res.up} online, ${res.down} offline.`
      );
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed.');
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleDownloadReport = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`/api/admin/reports/export?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Report export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webmanager-pro-report-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Agency Console' }, { label: 'Overview' }]}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={checkingHealth}
            onClick={handleCheckAllHealth}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
            <span>{checkingHealth ? 'Checking...' : 'Health Check'}</span>
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => handleDownloadReport('csv')}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <Link
            to="/dashboard/websites"
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 sm:py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Website</span>
          </Link>
        </div>
      }
    >
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Operations Overview</h1>
            <p className="text-sm text-slate-600 mt-1">
              Manage client websites, monitor live uptime &amp; SSL, track retainer billing, and publish in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowGuide((g) => !g)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 w-fit whitespace-nowrap"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{showGuide ? 'Hide Quick Guide' : 'Show Quick Guide'}</span>
          </button>
        </div>

        {healthNotice && (
          <div className="p-3.5 rounded-lg border border-blue-200 bg-blue-50 text-xs font-medium text-blue-900 flex items-center gap-2">
            <Activity className="w-4 h-4 shrink-0" />
            <span>{healthNotice}</span>
          </div>
        )}

        {showGuide && !loading && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">How WebManager Pro Works (4 Simple Steps)</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Follow these steps in order to launch a site and hand over portal access to your client.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                {
                  step: '1. Add a Client',
                  desc: 'Create a client account and email or copy their portal login link.',
                  done: (data?.metrics.totalClients ?? 0) > 0,
                  to: '/dashboard/clients',
                  cta: 'Go to Clients',
                },
                {
                  step: '2. Create Website',
                  desc: 'Add a website and assign it to the client (instant WebManager hosting included).',
                  done: (data?.metrics.totalWebsites ?? 0) > 0,
                  to: '/dashboard/websites',
                  cta: 'Go to Websites',
                },
                {
                  step: '3. Upload & Preview',
                  desc: 'Upload your .zip, import a live URL, or edit files and preview before publishing.',
                  done: (data?.metrics.totalWebsites ?? 0) > 0,
                  to: data?.recentWebsites[0] ? `/websites/${data.recentWebsites[0].id}` : '/dashboard/websites',
                  cta: 'Open Workspace',
                },
                {
                  step: '4. Publish Live',
                  desc: 'Click Publish Now in the Publishing tab and optionally notify the client by email.',
                  done: (data?.metrics.activeWebsites ?? 0) > 0,
                  to: data?.recentWebsites[0] ? `/websites/${data.recentWebsites[0].id}` : '/dashboard/websites',
                  cta: 'Publish Site',
                },
              ].map((item) => (
                <Link
                  key={item.step}
                  to={item.to}
                  className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-slate-300 transition-colors flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      {item.done ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span>{item.step}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{item.desc}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                    <span>{item.cta}</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {[
            { label: 'Clients', value: data?.metrics.totalClients ?? 0 },
            { label: 'Websites', value: data?.metrics.totalWebsites ?? 0 },
            { label: 'Active Sites', value: data?.metrics.activeWebsites ?? 0 },
            { label: 'Open Requests', value: data?.metrics.openChangeRequests ?? 0 },
            {
              label: 'Sites Down',
              value: data?.metrics.sitesDownCount ?? 0,
              alert: (data?.metrics.sitesDownCount ?? 0) > 0,
            },
            {
              label: 'SSL < 30d',
              value: data?.metrics.expiringSslCount ?? 0,
              alert: (data?.metrics.expiringSslCount ?? 0) > 0,
            },
            { label: 'Unpaid Invoices', value: data?.metrics.outstandingInvoicesCount ?? 0 },
            {
              label: 'Receivables',
              value: formatInvoiceMoney(data?.metrics.outstandingAmountCents ?? 0, 'USD'),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1"
            >
              <p className="text-[11px] font-medium text-slate-500 truncate">{stat.label}</p>
              {loading ? (
                <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" />
              ) : (
                <p
                  className={`text-lg font-bold font-mono tabular-nums truncate ${
                    stat.alert ? 'text-red-700' : 'text-slate-900'
                  }`}
                >
                  {stat.value}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Two Column Operational Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Websites */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Managed Websites &amp; Health</h2>
              <Link to="/dashboard/websites" className="text-xs font-medium text-blue-700 hover:underline">
                View all
              </Link>
            </div>
            {loading ? (
              <div className="p-6 text-sm text-slate-500">Loading websites...</div>
            ) : !data || data.recentWebsites.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-slate-600">No websites created in this workspace yet.</p>
                <Link
                  to="/dashboard/websites"
                  className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg"
                >
                  Create First Website
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentWebsites.map((site) => (
                  <div
                    key={site.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/70"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/websites/${site.id}`}
                        className="text-sm font-semibold text-slate-900 hover:text-blue-700 truncate block"
                      >
                        {site.name}
                      </Link>
                      <p className="text-xs text-slate-500 truncate">
                        {site.domain || 'No domain configured'} · {site.hostingProvider.replace('_', ' ')}
                        {site.lastUptimeStatus
                          ? ` · ${site.lastUptimeStatus === 'up' ? 'Online' : 'Offline'}${
                              site.lastResponseTimeMs ? ` (${site.lastResponseTimeMs}ms)` : ''
                            }`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusText status={site.lastUptimeStatus || site.status} />
                      {site.liveUrl && (
                        <a
                          href={site.liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${site.name}`}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Client Registrations */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Recent Client Registrations</h2>
              <Link to="/dashboard/clients" className="text-xs font-medium text-blue-700 hover:underline">
                Manage clients
              </Link>
            </div>
            {loading ? (
              <div className="p-6 text-sm text-slate-500">Loading clients...</div>
            ) : !data || data.recentClients.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-slate-600">No clients registered yet.</p>
                <Link
                  to="/dashboard/clients"
                  className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg"
                >
                  Add First Client
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentClients.map((client) => (
                  <div
                    key={client.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/70"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/dashboard/clients/${client.id}`}
                        className="text-sm font-semibold text-slate-900 hover:text-blue-700 truncate block"
                      >
                        {client.businessName}
                      </Link>
                      <p className="text-xs text-slate-500 truncate">
                        {client.fullName} · {client.email}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <StatusText status={client.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Publishing Activity & Recent Events */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">Publishing Activity</h2>
            </div>
            {loading ? (
              <div className="p-6 text-sm text-slate-500">Loading deployments...</div>
            ) : !data || data.recentDeployments.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No deployments triggered yet. Open a website workspace to configure publishing.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentDeployments.map((dep) => (
                  <div key={dep.id} className="px-5 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {dep.provider.replace('_', ' ')} {dep.commitSha ? `· ${dep.commitSha.slice(0, 7)}` : ''}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        {new Date(dep.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <StatusText status={dep.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Recent Audit Activity</h2>
              <Link to="/dashboard/activity" className="text-xs font-medium text-blue-700 hover:underline">
                Full log
              </Link>
            </div>
            {loading ? (
              <div className="p-6 text-sm text-slate-500">Loading activity...</div>
            ) : !data || data.recentActivities.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No recorded workspace events yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentActivities.slice(0, 8).map((act) => (
                  <div key={act.id} className="px-5 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{act.action}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {act.entityType} {act.entityId ? `· ${act.entityId.slice(0, 8)}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 font-mono tabular-nums shrink-0">
                      {new Date(act.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
