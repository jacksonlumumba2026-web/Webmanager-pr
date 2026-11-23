import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, FileText, MailPlus, Plus, Receipt } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { MaintenanceReportModal } from '../../components/clients/MaintenanceReportModal.tsx';
import { InvoiceModal, formatInvoiceMoney } from '../../components/billing/InvoiceModal.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import type {
  ActivityLogRecord,
  ClientRecord,
  InvitationRecord,
  InvoiceRecord,
  MaintenanceReportResponse,
  WebsiteRecord,
} from '../../types/index.ts';

interface ClientDetailResponse {
  client: ClientRecord;
  websites: WebsiteRecord[];
  activities: ActivityLogRecord[];
  invitations: InvitationRecord[];
}

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { organization } = useAuth();
  const [data, setData] = useState<ClientDetailResponse | null>(null);
  const [clientInvoices, setClientInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailNote, setInviteEmailNote] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('active');
  const [notes, setNotes] = useState('');
  const [retainerPlan, setRetainerPlan] = useState('Standard Care');
  const [monthlyHoursIncluded, setMonthlyHoursIncluded] = useState('4');
  const [hoursUsedThisMonth, setHoursUsedThisMonth] = useState('0');
  const [monthlyFeeDollars, setMonthlyFeeDollars] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [renewalDate, setRenewalDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [reportData, setReportData] = useState<MaintenanceReportResponse | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [issuingInvoice, setIssuingInvoice] = useState(false);

  const loadClient = useCallback(async () => {
    if (!id) return;
    try {
      const [res, invs] = await Promise.all([
        apiRequest<ClientDetailResponse>(`/api/clients/${id}`),
        apiRequest<InvoiceRecord[]>(`/api/invoices?clientId=${id}`),
      ]);
      setData(res);
      setClientInvoices(invs);
      setFullName(res.client.fullName);
      setBusinessName(res.client.businessName);
      setEmail(res.client.email);
      setPhone(res.client.phone || '');
      setStatus(res.client.status);
      setNotes(res.client.notes || '');
      setRetainerPlan(res.client.retainerPlan || 'Standard Care');
      setMonthlyHoursIncluded(String(res.client.monthlyHoursIncluded ?? 4));
      setHoursUsedThisMonth(String(res.client.hoursUsedThisMonth ?? 0));
      setMonthlyFeeDollars(((res.client.monthlyFeeCents ?? 0) / 100).toFixed(2));
      setCurrency(res.client.currency || 'USD');
      setRenewalDate(res.client.renewalDate ? res.client.renewalDate.slice(0, 10) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load client.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadClient();
  }, [loadClient]);

  const handleIssueRetainerInvoice = async () => {
    if (!id || !data) return;
    setIssuingInvoice(true);
    setError(null);
    setSavedNotice(null);
    try {
      const feeCents = Math.round((Number.parseFloat(monthlyFeeDollars) || 0) * 100);
      if (feeCents <= 0) {
        setError('Set a Monthly Retainer Fee greater than 0 before issuing an invoice.');
        setIssuingInvoice(false);
        return;
      }
      const period = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const created = await apiRequest<InvoiceRecord>(`/api/clients/${id}/invoices`, {
        method: 'POST',
        body: JSON.stringify({
          billingPeriod: period,
          description: `${retainerPlan || 'Monthly Website Retainer'} (${period})`,
          amountCents: feeCents,
          currency,
          sendEmail: true,
        }),
      });
      setSavedNotice(`Invoice ${created.invoiceNumber} issued.`);
      await loadClient();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue invoice.');
    } finally {
      setIssuingInvoice(false);
    }
  };

  const handleMarkInvoicePaid = async (invoiceId: string) => {
    setError(null);
    try {
      await apiRequest(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paid', paymentMethod: 'Bank Transfer' }),
      });
      await loadClient();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update invoice.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const parsedHoursIncluded = Number.parseInt(monthlyHoursIncluded, 10);
      const parsedHoursUsed = Number.parseInt(hoursUsedThisMonth, 10);
      const parsedFeeCents = Math.round((Number.parseFloat(monthlyFeeDollars) || 0) * 100);

      await apiRequest(`/api/clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName,
          businessName,
          email,
          phone,
          status,
          notes,
          retainerPlan,
          monthlyHoursIncluded: Number.isFinite(parsedHoursIncluded) ? parsedHoursIncluded : 4,
          hoursUsedThisMonth: Number.isFinite(parsedHoursUsed) ? parsedHoursUsed : 0,
          monthlyFeeCents: Number.isFinite(parsedFeeCents) ? parsedFeeCents : 0,
          currency,
          renewalDate: renewalDate || null,
        }),
      });
      setSavedNotice('Client profile and retainer saved.');
      await loadClient();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update client.');
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await apiRequest<{
        invitePath: string;
        fullInviteUrl?: string;
        sharedAppLive?: boolean;
        emailSent?: boolean;
        emailNotice?: string;
      }>(`/api/clients/${id}/invite`, {
        method: 'POST',
      });
      setInviteLink(res.fullInviteUrl || `${window.location.origin}${res.invitePath}`);
      setInviteEmailNote(
        res.emailSent
          ? res.sharedAppLive === false
            ? res.emailNotice ||
              `Invitation email dispatched to ${email} using your Dev URL. Click Share in AI Studio so external clients can open public portal links.`
            : `Invitation email dispatched automatically to ${email}.`
          : res.emailNotice || 'Email delivery not configured; copy and share the link below.'
      );
      await loadClient();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invitation.');
    }
  };

  const handleOpenReport = async () => {
    if (!id) return;
    setLoadingReport(true);
    setError(null);
    try {
      const res = await apiRequest<MaintenanceReportResponse>(`/api/clients/${id}/maintenance-report`);
      setReportData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load maintenance report.');
    } finally {
      setLoadingReport(false);
    }
  };

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: 'Agency Console', to: '/dashboard' },
        { label: 'Clients', to: '/dashboard/clients' },
        { label: data?.client.businessName || 'Client Profile' },
      ]}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loadingReport}
            onClick={handleOpenReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white rounded-lg hover:bg-slate-50 whitespace-nowrap disabled:opacity-60"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{loadingReport ? 'Loading Report...' : 'Monthly Report'}</span>
          </button>
          <button
            type="button"
            onClick={handleInvite}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 sm:py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <MailPlus className="w-3.5 h-3.5" />
            <span>Generate Invite Link</span>
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-slate-500">Loading client profile...</p>
      ) : !data ? (
        <p className="text-sm text-red-700">{error || 'Client not found.'}</p>
      ) : (
        <div className="space-y-6">
          {error && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
          )}
          {savedNotice && (
            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
              {savedNotice}
            </div>
          )}
          {inviteLink && (
            <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-900">
                  Share this onboarding link with {data.client.fullName}:
                </p>
                <p className="text-xs font-mono text-blue-800 truncate">{inviteLink}</p>
                {inviteEmailNote && <p className="text-xs text-blue-700 mt-1">{inviteEmailNote}</p>}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-blue-300 text-blue-900 rounded-lg shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleSave}
              className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Client Profile</h2>
                <StatusText status={data.client.status} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Business Name</label>
                  <input
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Primary Contact</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Account Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Maintenance &amp; Retainer Plan</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Plan Name</label>
                    <input
                      type="text"
                      value={retainerPlan}
                      onChange={(e) => setRetainerPlan(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      placeholder="Standard Care"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Next Renewal Date</label>
                    <input
                      type="date"
                      value={renewalDate}
                      onChange={(e) => setRenewalDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Hours Used This Month
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={hoursUsedThisMonth}
                      onChange={(e) => setHoursUsedThisMonth(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Included Hours / Month
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={monthlyHoursIncluded}
                      onChange={(e) => setMonthlyHoursIncluded(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Monthly Retainer Fee</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={monthlyFeeDollars}
                      onChange={(e) => setMonthlyFeeDollars(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Currency</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-mono"
                    >
                      {['USD', 'EUR', 'GBP', 'KES', 'CAD', 'AUD'].map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>

            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Assigned Websites</h2>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {data.websites.length}
                  </span>
                </div>
                {data.websites.length === 0 ? (
                  <p className="p-5 text-xs text-slate-500">No websites assigned to this client yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {data.websites.map((w) => (
                      <div key={w.id} className="px-5 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={`/websites/${w.id}`}
                            className="text-sm font-semibold text-slate-900 hover:text-blue-700 truncate block"
                          >
                            {w.name}
                          </Link>
                          <p className="text-xs text-slate-500 truncate">{w.domain || 'No domain'}</p>
                        </div>
                        <StatusText status={w.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-slate-500" />
                    <h2 className="text-sm font-bold text-slate-900">Invoices &amp; Retainer</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={issuingInvoice}
                      onClick={handleIssueRetainerInvoice}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{issuingInvoice ? 'Issuing...' : 'Issue Invoice'}</span>
                    </button>
                    <Link
                      to="/dashboard/billing"
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      All
                    </Link>
                  </div>
                </div>
                {clientInvoices.length === 0 ? (
                  <p className="p-5 text-xs text-slate-500">
                    No invoices issued for this client yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {clientInvoices.slice(0, 5).map((inv) => (
                      <div
                        key={inv.id}
                        className="px-5 py-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {inv.invoiceNumber} · {formatInvoiceMoney(inv.amountCents, inv.currency)}
                          </p>
                          <p className="text-slate-500 truncate">{inv.billingPeriod}</p>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <StatusText status={inv.status} />
                          {inv.status !== 'paid' && inv.status !== 'void' && (
                            <button
                              type="button"
                              onClick={() => handleMarkInvoicePaid(inv.id)}
                              className="text-xs font-semibold text-emerald-700 hover:underline"
                            >
                              Mark Paid
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedInvoice(inv)}
                            className="text-xs font-semibold text-blue-700 hover:underline"
                          >
                            View
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">Client Activity</h2>
                </div>
                {data.activities.length === 0 ? (
                  <p className="p-5 text-xs text-slate-500">No recorded activity for this client.</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {data.activities.map((a) => (
                      <div key={a.id} className="px-5 py-2.5 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-slate-800">{a.action}</span>
                        <span className="font-mono tabular-nums text-slate-500">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
