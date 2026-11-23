import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Plus, Search, X } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { StatusText } from '../../components/common/StatusText.tsx';
import { apiRequest } from '../../services/api.ts';
import type { ClientRecord, WebsiteRecord } from '../../types/index.ts';

export function WebsitesPage() {
  const navigate = useNavigate();
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [domain, setDomain] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [hostingProvider, setHostingProvider] = useState('managed_hosting');
  const [description, setDescription] = useState('');
  const [scaffoldStarter, setScaffoldStarter] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [sitesData, clientsData] = await Promise.all([
        apiRequest<WebsiteRecord[]>('/api/websites'),
        apiRequest<ClientRecord[]>('/api/clients'),
      ]);
      setWebsites(sitesData);
      setClients(clientsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load websites.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await apiRequest<WebsiteRecord>('/api/websites', {
        method: 'POST',
        body: JSON.stringify({
          name,
          clientId: clientId || null,
          domain,
          liveUrl,
          hostingProvider,
          description,
          scaffoldStarter,
        }),
      });
      setShowCreate(false);
      setName('');
      setClientId('');
      setDomain('');
      setLiveUrl('');
      setHostingProvider('managed_hosting');
      setDescription('');
      navigate(`/websites/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create website.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (site: WebsiteRecord) => {
    try {
      await apiRequest(`/api/websites/${site.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: site.status === 'archived' ? 'pending' : 'archived' }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update website.');
    }
  };

  const filtered = websites.filter((w) => {
    const matchesStatus = statusFilter === 'all' || w.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      w.name.toLowerCase().includes(q) ||
      (w.domain || '').toLowerCase().includes(q) ||
      (w.clientName || '').toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Agency Console', to: '/dashboard' }, { label: 'Websites' }]}
      action={
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Website</span>
        </button>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Websites</h1>
          <p className="text-sm text-slate-600 mt-1">
            Assign websites to clients, edit source code in Monaco Editor, and manage publishing pipelines.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search site name, domain, or client..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit overflow-x-auto">
            {['all', 'active', 'pending', 'attention', 'archived'].map((st) => (
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

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {loading ? (
            <div className="p-8 text-sm text-slate-500">Loading websites...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-600">
                {websites.length === 0
                  ? 'No websites added yet. Create your first managed website.'
                  : 'No websites match your current filter.'}
              </p>
              {websites.length === 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg"
                >
                  Create First Website
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Website</th>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Domain</th>
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Updated</th>
                  <th className="py-3 px-4 text-right">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((site) => (
                  <tr key={site.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <Link
                        to={`/websites/${site.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-700 block"
                      >
                        {site.name}
                      </Link>
                      {site.liveUrl && (
                        <a
                          href={site.liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-blue-700"
                        >
                          <span className="truncate max-w-[200px]">{site.liveUrl}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{site.clientName || 'Unassigned'}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{site.domain || '—'}</td>
                    <td className="py-3 px-4 text-xs text-slate-600 capitalize">
                      {site.hostingProvider === 'managed_hosting'
                        ? 'WebManager Hosted'
                        : site.hostingProvider.replace('_', ' ')}
                    </td>
                    <td className="py-3 px-4">
                      <div className="space-y-0.5">
                        <StatusText status={site.status} />
                        {site.lastUptimeStatus && (
                          <p className="text-[11px] font-mono tabular-nums text-slate-500">
                            {site.lastUptimeStatus === 'up' ? 'Online' : 'Offline'}
                            {site.lastResponseTimeMs != null ? ` · ${site.lastResponseTimeMs}ms` : ''}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                      {new Date(site.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right space-x-3 whitespace-nowrap">
                      <Link
                        to={`/websites/${site.id}`}
                        className="text-xs font-semibold text-blue-700 hover:underline"
                      >
                        Open Workspace
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleArchive(site)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900"
                      >
                        {site.status === 'archived' ? 'Restore' : 'Archive'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Create Website</h2>
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
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Website Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Bennett Architecture Portfolio"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Assign Client</label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Unassigned (Agency Internal)</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.businessName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Hosting Provider</label>
                  <select
                    value={hostingProvider}
                    onChange={(e) => setHostingProvider(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="managed_hosting">WebManager Hosted (Instant Live URL)</option>
                    <option value="github_pages">GitHub Pages</option>
                    <option value="custom_domain">Custom Domain</option>
                    <option value="other">Other Provider (Future Adapter)</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Recommended: WebManager Hosted gives a live URL immediately without GitHub.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Custom Domain (optional)
                  </label>
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="Leave blank if no domain yet"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">External URL (optional)</label>
                  <input
                    type="url"
                    value={liveUrl}
                    onChange={(e) => setLiveUrl(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="Auto-filled on publish"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Marketing brochure website & case studies..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={scaffoldStarter}
                  onChange={(e) => setScaffoldStarter(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Scaffold starter HTML, CSS, JS, and README files</span>
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
                  {saving ? 'Creating...' : 'Create Website'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
