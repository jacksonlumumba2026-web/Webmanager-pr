import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileCode2, FileText, MessageSquarePlus, Receipt } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { MaintenanceReportModal } from '../../components/clients/MaintenanceReportModal.tsx';
import { InvoiceModal, formatInvoiceMoney } from '../../components/billing/InvoiceModal.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import type {
  ActivityLogRecord,
  ChangeRequestRecord,
  InvoiceRecord,
  MaintenanceReportResponse,
  WebsiteRecord,
} from '../../types/index.ts';

export function ClientPortalPage() {
  const { clientRecord, profile, organization } = useAuth();
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [requests, setRequests] = useState<ChangeRequestRecord[]>([]);
  const [activities, setActivities] = useState<ActivityLogRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<MaintenanceReportResponse | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);

  const loadPortal = async () => {
    setError(null);
    try {
      const [sitesRes, reqRes, actRes, invRes] = await Promise.allSettled([
        apiRequest<WebsiteRecord[]>('/api/websites'),
        apiRequest<ChangeRequestRecord[]>('/api/change-requests'),
        apiRequest<ActivityLogRecord[]>('/api/activity'),
        apiRequest<InvoiceRecord[]>('/api/invoices'),
      ]);
      if (sitesRes.status === 'fulfilled') setWebsites(sitesRes.value);
      if (reqRes.status === 'fulfilled') setRequests(reqRes.value);
      if (actRes.status === 'fulfilled') setActivities(actRes.value);
      if (invRes.status === 'fulfilled') setInvoices(invRes.value);

      if (
        sitesRes.status === 'rejected' &&
        reqRes.status === 'rejected' &&
        actRes.status === 'rejected' &&
        invRes.status === 'rejected'
      ) {
        const reason = sitesRes.reason;
        setError(reason instanceof Error ? reason.message : 'Unable to load your client portal.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortal();
  }, []);

  const handleOpenReport = async () => {
    if (!clientRecord) return;
    setLoadingReport(true);
    setError(null);
    try {
      const res = await apiRequest<MaintenanceReportResponse>(
        `/api/clients/${clientRecord.id}/maintenance-report`
      );
      setReportData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load maintenance report.');
    } finally {
      setLoadingReport(false);
    }
  };

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Client Portal' }, { label: 'My Websites' }]}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {clientRecord && (
            <button
              type="button"
              disabled={loadingReport}
              onClick={handleOpenReport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white rounded-lg hover:bg-slate-50 whitespace-nowrap disabled:opacity-60"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{loadingReport ? 'Loading...' : 'Monthly Report'}</span>
            </button>
          )}
          <Link
            to="/portal/requests"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 sm:py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Request Change</span>
          </Link>
        </div>
      }
    >
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome, {clientRecord?.businessName || profile?.fullName}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Review your live websites, inspect uptime &amp; SSL status, view invoices, or submit update requests.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                loadPortal();
              }}
              className="px-3 py-1 text-xs font-semibold text-red-800 bg-white border border-red-200 rounded-md hover:bg-red-100 shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Assigned Websites</p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {websites.length}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Active Sites</p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {websites.filter((w) => w.status === 'active').length}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Open Change Requests</p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {requests.filter((r) => r.status === 'open' || r.status === 'in_review').length}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200">
            <p className="text-xs font-medium text-slate-500">
              {clientRecord?.retainerPlan || 'Maintenance Plan'}
            </p>
            <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
              {clientRecord?.hoursUsedThisMonth ?? 0} / {clientRecord?.monthlyHoursIncluded ?? 4} hrs
            </p>
            {clientRecord?.renewalDate && (
              <p className="text-xs text-slate-500 font-mono tabular-nums mt-1">
                Renews {new Date(clientRecord.renewalDate).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {/* Assigned Websites List */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900">Your Websites</h2>
          </div>
          {loading ? (
            <p className="p-6 text-sm text-slate-500">Loading your websites...</p>
          ) : websites.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm text-slate-600">
                No websites have been assigned to your account yet.
              </p>
              <Link to="/portal/account" className="text-xs font-semibold text-blue-700 hover:underline">
                Contact your agency administrator
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {websites.map((site) => {
                const sslDays = site.sslExpiresAt
                  ? Math.floor((new Date(site.sslExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null;
                return (
                  <div
                    key={site.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Link
                          to={`/websites/${site.id}`}
                          className="text-base font-bold text-slate-900 hover:text-blue-700"
                        >
                          {site.name}
                        </Link>
                        <StatusText status={site.status} />
                        {site.lastUptimeStatus && <StatusText status={site.lastUptimeStatus} />}
                      </div>
                      <p className="text-xs text-slate-500">
                        {site.domain || 'Domain pending'} · {site.hostingProvider.replace('_', ' ')} ·{' '}
                        <span className="font-mono tabular-nums">
                          {site.lastPublishedAt
                            ? `Published ${new Date(site.lastPublishedAt).toLocaleDateString()}`
                            : 'Not yet published'}
                        </span>
                        {site.lastResponseTimeMs ? ` · ${site.lastResponseTimeMs}ms` : ''}
                        {sslDays !== null ? ` · SSL ${sslDays > 0 ? `${sslDays}d left` : 'expired'}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Link
                        to={`/websites/${site.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-white"
                      >
                        <FileCode2 className="w-3.5 h-3.5" />
                        <span>Details &amp; Files</span>
                      </Link>
                      {site.liveUrl && (
                        <a
                          href={site.liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                        >
                          <span>Visit Live Site</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Invoices */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-900">Recent Invoices &amp; Receipts</h2>
              </div>
              <Link to="/portal/billing" className="text-xs font-medium text-blue-700 hover:underline">
                View all
              </Link>
            </div>
            {invoices.length === 0 ? (
              <p className="p-6 text-xs text-slate-500">No invoices issued yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {invoices.slice(0, 5).map((inv) => (
                  <div key={inv.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">
                        {inv.invoiceNumber} · {formatInvoiceMoney(inv.amountCents, inv.currency)}
                      </p>
                      <p className="text-slate-500 truncate">{inv.billingPeriod}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusText status={inv.status} />
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="font-semibold text-blue-700 hover:underline"
                      >
                        {inv.status === 'paid' ? 'Receipt' : 'View'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Updates */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Recent Updates</h2>
              <Link to="/portal/activity" className="text-xs font-medium text-blue-700 hover:underline">
                View history
              </Link>
            </div>
            {activities.length === 0 ? (
              <p className="p-6 text-xs text-slate-500">No recent updates recorded.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {activities.slice(0, 6).map((act) => (
                  <div key={act.id} className="px-5 py-3 flex items-center justify-between gap-4 text-xs">
                    <span className="font-medium text-slate-800">{act.action}</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {new Date(act.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {reportData && (
        <MaintenanceReportModal report={reportData} onClose={() => setReportData(null)} />
      )}
      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          agencyName={organization?.name || 'WebManager Pro'}
          agencyEmail={organization?.supportEmail}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </DashboardLayout>
  );
}

