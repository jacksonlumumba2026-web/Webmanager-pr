import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, MailPlus, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { apiRequest } from '../../services/api.ts';
import type { ClientRecord } from '../../types/index.ts';

interface BulkClientRow {
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  websiteName: string;
  websiteLiveUrl: string;
}

interface BulkImportResultItem {
  fullName: string;
  businessName: string;
  email: string;
  status: 'created' | 'skipped';
  reason?: string;
  inviteUrl?: string | null;
  fullInviteUrl?: string | null;
  emailSent?: boolean;
  emailNotice?: string;
}

const emptyBulkRow = (): BulkClientRow => ({
  fullName: '',
  businessName: '',
  email: '',
  phone: '',
  websiteName: '',
  websiteLiveUrl: '',
});

export function ClientsPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingClientId, setSendingClientId] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [createdInviteLabel, setCreatedInviteLabel] = useState<string | null>(null);
  const [createdInviteEmailNote, setCreatedInviteEmailNote] = useState<string | null>(null);

  // Single add client state
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [websiteName, setWebsiteName] = useState('');
  const [websiteDomain, setWebsiteDomain] = useState('');
  const [websiteLiveUrl, setWebsiteLiveUrl] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [saving, setSaving] = useState(false);

  // Bulk import state
  const [bulkRows, setBulkRows] = useState<BulkClientRow[]>([emptyBulkRow(), emptyBulkRow()]);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [bulkSendInvites, setBulkSendInvites] = useState(true);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{
    importedCount: number;
    skippedCount: number;
    emailedCount: number;
    sharedAppLive?: boolean;
    results: BulkImportResultItem[];
  } | null>(null);

  const loadClients = useCallback(async () => {
    try {
      const data = await apiRequest<ClientRecord[]>('/api/clients');
      setClients(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{
        client: ClientRecord;
        inviteUrl: string | null;
        fullInviteUrl?: string | null;
        sharedAppLive?: boolean;
        emailSent?: boolean;
        emailNotice?: string;
      }>('/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          businessName,
          email,
          phone,
          notes,
          websiteName: websiteName.trim() || undefined,
          websiteDomain: websiteDomain.trim() || undefined,
          websiteLiveUrl: websiteLiveUrl.trim() || undefined,
          sendInvite,
        }),
      });
      if (res.inviteUrl || res.fullInviteUrl) {
        setCreatedInviteUrl(res.fullInviteUrl || `${window.location.origin}${res.inviteUrl}`);
        setCreatedInviteLabel(`${businessName} (${email})`);
        setCreatedInviteEmailNote(
          res.emailSent
            ? res.sharedAppLive === false
              ? res.emailNotice ||
                `Login link emailed to ${email} using your Dev URL. Click Share in AI Studio so external clients can open public portal links.`
              : `Login invitation emailed automatically to ${email}.`
            : res.emailNotice || 'Email delivery not configured; copy and share the link below.'
        );
      }
      setShowCreate(false);
      setFullName('');
      setBusinessName('');
      setEmail('');
      setPhone('');
      setNotes('');
      setWebsiteName('');
      setWebsiteDomain('');
      setWebsiteLiveUrl('');
      await loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendLoginInvite = async (client: ClientRecord) => {
    setSendingClientId(client.id);
    setError(null);
    try {
      const res = await apiRequest<{
        invitePath: string;
        fullInviteUrl?: string;
        sharedAppLive?: boolean;
        emailSent?: boolean;
        emailNotice?: string;
      }>(`/api/clients/${client.id}/invite`, { method: 'POST' });

      setCreatedInviteUrl(res.fullInviteUrl || `${window.location.origin}${res.invitePath}`);
      setCreatedInviteLabel(`${client.businessName} (${client.email})`);
      setCreatedInviteEmailNote(
        res.emailSent
          ? res.sharedAppLive === false
            ? res.emailNotice ||
              `Portal login link emailed to ${client.email} using your Dev URL. Click Share in AI Studio so external clients can open public portal links.`
            : `Portal login link emailed automatically to ${client.email}.`
          : res.emailNotice || 'Email delivery not configured; copy and share the link below.'
      );
      await loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send login link.');
    } finally {
      setSendingClientId(null);
    }
  };

  const handleParseBulkLines = () => {
    const lines = bulkPasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const parsed: BulkClientRow[] = lines.map((line) => {
      const parts = line.split(/[,;\t]+/).map((p) => p.trim());
      return {
        fullName: parts[0] || '',
        businessName: parts[1] || parts[0] || '',
        email: parts[2] || '',
        phone: parts[3] || '',
        websiteName: parts[4] || '',
        websiteLiveUrl: parts[5] || '',
      };
    });
    setBulkRows(parsed);
    setBulkPasteText('');
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validRows = bulkRows.filter((r) => r.fullName.trim() || r.email.trim());
    if (validRows.length === 0) {
      setError('Add at least one client row before importing.');
      return;
    }
    setBulkImporting(true);
    setError(null);
    try {
      const res = await apiRequest<{
        importedCount: number;
        skippedCount: number;
        emailedCount: number;
        sharedAppLive?: boolean;
        results: BulkImportResultItem[];
      }>('/api/clients/bulk-import', {
        method: 'POST',
        body: JSON.stringify({
          clients: validRows,
          sendInvites: bulkSendInvites,
        }),
      });
      setBulkSummary(res);
      await loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk import failed.');
    } finally {
      setBulkImporting(false);
    }
  };

  const handleToggleStatus = async (client: ClientRecord) => {
    const nextStatus = client.status === 'suspended' ? 'active' : 'suspended';
    try {
      await apiRequest(`/api/clients/${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update client status.');
    }
  };

  const filtered = clients.filter((c) => {
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      c.businessName.toLowerCase().includes(q) ||
      c.fullName.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Agency Console', to: '/dashboard' }, { label: 'Clients' }]}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBulkSummary(null);
              setShowBulkImport(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Multiple Clients</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Client</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
            <p className="text-sm text-slate-600 mt-1">
              Add past or new clients, attach their websites, and email portal login links directly from here.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
            {error}
          </div>
        )}

        {createdInviteUrl && (
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-900">
                Portal login link ready{createdInviteLabel ? ` — ${createdInviteLabel}` : ''}
              </p>
              <p className="text-xs font-mono text-emerald-800 truncate">{createdInviteUrl}</p>
              {createdInviteEmailNote && (
                <p className="text-xs text-emerald-700 mt-1">{createdInviteEmailNote}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(createdInviteUrl)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-emerald-300 text-emerald-900 rounded-lg hover:bg-emerald-100"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Link</span>
              </button>
              <button
                type="button"
                aria-label="Dismiss invite banner"
                onClick={() => setCreatedInviteUrl(null)}
                className="p-1.5 text-emerald-700 hover:text-emerald-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search business, contact, or email..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            {['all', 'active', 'pending', 'suspended'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Clients Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {loading ? (
            <div className="p-8 text-sm text-slate-500">Loading client directory...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-600">
                {clients.length === 0
                  ? 'No clients added yet. Create your first client or bulk-import your previous clients.'
                  : 'No clients match your search or status filter.'}
              </p>
              {clients.length === 0 && (
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkSummary(null);
                      setShowBulkImport(true);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg"
                  >
                    Import Multiple Clients
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg"
                  >
                    Add First Client
                  </button>
                </div>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Business &amp; Contact</th>
                  <th className="py-3 px-4">Email &amp; Phone</th>
                  <th className="py-3 px-4 text-right">Websites</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <Link
                        to={`/dashboard/clients/${c.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-700 block"
                      >
                        {c.businessName}
                      </Link>
                      <span className="text-xs text-slate-500">{c.fullName}</span>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-slate-700">{c.email}</p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">{c.phone || '—'}</p>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {c.websiteCount ?? 0}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={c.status} />
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right space-x-3 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={sendingClientId === c.id}
                        onClick={() => handleSendLoginInvite(c)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                      >
                        <MailPlus className="w-3.5 h-3.5" />
                        <span>{sendingClientId === c.id ? 'Sending...' : 'Send Login'}</span>
                      </button>
                      <Link
                        to={`/dashboard/clients/${c.id}`}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Profile
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(c)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900"
                      >
                        {c.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Client Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Add Client</h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowCreate(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="Claire Bennett"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Business Name</label>
                  <input
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="Bennett Architecture Ltd"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="claire@bennettarch.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="+254 720 000 000"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <p className="text-xs font-semibold text-slate-800">
                  Attach Existing Website (Optional — creates &amp; links it right away)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Website Name</label>
                    <input
                      type="text"
                      value={websiteName}
                      onChange={(e) => setWebsiteName(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      placeholder="Defaults to business name"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Domain</label>
                    <input
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={websiteDomain}
                      onChange={(e) => setWebsiteDomain(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                      placeholder="clientdomain.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Existing Live URL</label>
                  <input
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={websiteLiveUrl}
                    onChange={(e) => setWebsiteLiveUrl(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    placeholder="https://clientdomain.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Internal Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Account retainer details or technical preferences..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Email portal login link immediately &amp; generate invite URL</span>
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Previous Clients Modal */}
      {showBulkImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 overflow-y-auto">
          <div className="w-full max-w-4xl bg-white rounded-xl border border-slate-200 p-6 space-y-5 my-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Import Previous Clients &amp; Send Logins</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Add multiple past clients and their existing websites in one batch, then email their portal logins automatically.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowBulkImport(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {bulkSummary ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
                  Imported <strong>{bulkSummary.importedCount}</strong> client(s), emailed{' '}
                  <strong>{bulkSummary.emailedCount}</strong> login link(s), skipped{' '}
                  <strong>{bulkSummary.skippedCount}</strong>.
                </div>
                {bulkSummary.sharedAppLive === false && (
                  <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                    Note: These links currently use your <strong>Dev URL</strong> because the Shared App URL has not been published yet. Click the <strong>Share</strong> icon in Google AI Studio to deploy the public app URL before external clients open their emails.
                  </div>
                )}
                <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {bulkSummary.results.map((item, idx) => (
                    <div key={`${item.email}-${idx}`} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {item.businessName} · <span className="font-normal text-slate-600">{item.fullName}</span>
                        </p>
                        <p className="font-mono text-slate-600 truncate">{item.email}</p>
                        {item.status === 'skipped' ? (
                          <p className="text-amber-700 mt-0.5">Skipped: {item.reason}</p>
                        ) : (
                          <p className="text-emerald-700 mt-0.5">
                            {item.emailSent
                              ? 'Login email dispatched automatically'
                              : item.emailNotice || 'Invite link ready to share'}
                          </p>
                        )}
                      </div>
                      {item.fullInviteUrl && (
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(item.fullInviteUrl!)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 shrink-0"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Link</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowBulkImport(false)}
                    className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleBulkSubmit} className="space-y-4">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-800">
                      Quick Paste (Optional — 1 client per line: Name, Business, Email, Phone, Website Name, Live URL)
                    </label>
                    <button
                      type="button"
                      onClick={handleParseBulkLines}
                      className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                    >
                      Fill Rows Below
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={bulkPasteText}
                    onChange={(e) => setBulkPasteText(e.target.value)}
                    placeholder="John Doe, Acme Supplies, john@acme.com, +254700111222, Acme Site, https://acme.com"
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {bulkRows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2.5 border border-slate-200 rounded-lg bg-white">
                      <input
                        type="text"
                        placeholder="Full Name *"
                        value={row.fullName}
                        onChange={(e) =>
                          setBulkRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, fullName: e.target.value } : r))
                          )
                        }
                        className="sm:col-span-2 px-2 py-1.5 text-xs border border-slate-300 rounded"
                      />
                      <input
                        type="text"
                        placeholder="Business Name"
                        value={row.businessName}
                        onChange={(e) =>
                          setBulkRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, businessName: e.target.value } : r))
                          )
                        }
                        className="sm:col-span-2 px-2 py-1.5 text-xs border border-slate-300 rounded"
                      />
                      <input
                        type="email"
                        placeholder="Email *"
                        value={row.email}
                        onChange={(e) =>
                          setBulkRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, email: e.target.value } : r))
                          )
                        }
                        className="sm:col-span-3 px-2 py-1.5 text-xs border border-slate-300 rounded"
                      />
                      <input
                        type="tel"
                        placeholder="Phone"
                        value={row.phone}
                        onChange={(e) =>
                          setBulkRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, phone: e.target.value } : r))
                          )
                        }
                        className="sm:col-span-2 px-2 py-1.5 text-xs border border-slate-300 rounded"
                      />
                      <input
                        type="text"
                        autoCapitalize="none"
                        placeholder="Website URL (optional)"
                        value={row.websiteLiveUrl}
                        onChange={(e) =>
                          setBulkRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, websiteLiveUrl: e.target.value } : r))
                          )
                        }
                        className="sm:col-span-2 px-2 py-1.5 text-xs font-mono border border-slate-300 rounded"
                      />
                      <button
                        type="button"
                        aria-label="Remove row"
                        onClick={() =>
                          setBulkRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev))
                        }
                        className="sm:col-span-1 flex justify-center p-1.5 text-slate-400 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkRows((prev) => [...prev, emptyBulkRow()])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Another Client Row</span>
                  </button>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={bulkSendInvites}
                      onChange={(e) => setBulkSendInvites(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Send portal login emails automatically to all imported clients</span>
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowBulkImport(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={bulkImporting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                  >
                    <MailPlus className="w-4 h-4" />
                    <span>
                      {bulkImporting
                        ? 'Importing...'
                        : bulkSendInvites
                        ? 'Import Clients & Send Logins'
                        : 'Import Clients'}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
