import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { DashboardLayout } from '../../components/layouts/DashboardLayout.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import type { ActivityLogRecord } from '../../types/index.ts';

export function ActivityLogsPage() {
  const { isAdminOrStaff } = useAuth();
  const [logs, setLogs] = useState<ActivityLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');

  useEffect(() => {
    async function load() {
      try {
        const data = await apiRequest<ActivityLogRecord[]>('/api/activity');
        setLogs(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load activity logs.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = logs.filter((l) => {
    const matchesEntity = entityFilter === 'all' || l.entityType === entityFilter;
    const q = search.trim().toLowerCase();
    const matchesQuery =
      !q ||
      l.action.toLowerCase().includes(q) ||
      (l.actorName || '').toLowerCase().includes(q) ||
      JSON.stringify(l.detailsJson).toLowerCase().includes(q);
    return matchesEntity && matchesQuery;
  });

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: isAdminOrStaff ? 'Agency Console' : 'Client Portal', to: isAdminOrStaff ? '/dashboard' : '/portal' },
        { label: 'Activity Logs' },
      ]}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Activity &amp; Audit Logs</h1>
          <p className="text-sm text-slate-600 mt-1">
            Chronological record of client, website, file, deployment, and permission events.
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
              placeholder="Filter by action, actor, or detail..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {['all', 'client', 'website', 'website_file', 'deployment', 'change_request'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setEntityFilter(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap ${
                  entityFilter === t
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          {loading ? (
            <div className="p-8 text-sm text-slate-500">Loading activity logs...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-sm text-slate-500">No matching activity events recorded.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">{log.actorName || 'System'}</td>
                    <td className="py-3 px-4 font-mono text-slate-800">{log.action}</td>
                    <td className="py-3 px-4 text-slate-600 capitalize">{log.entityType.replace('_', ' ')}</td>
                    <td className="py-3 px-4 font-mono text-slate-600 max-w-md truncate">
                      {Object.keys(log.detailsJson || {}).length > 0
                        ? JSON.stringify(log.detailsJson)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
