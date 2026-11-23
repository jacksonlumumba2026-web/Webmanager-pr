import { Download, Printer, X } from 'lucide-react';
import { StatusText } from '../common/StatusText.tsx';
import type { MaintenanceReportResponse } from '../../types/index.ts';

interface MaintenanceReportModalProps {
  report: MaintenanceReportResponse;
  onClose: () => void;
}

function formatMoney(cents: number | undefined, currency: string | undefined): string {
  const amount = (cents ?? 0) / 100;
  const code = currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export function MaintenanceReportModal({ report, onClose }: MaintenanceReportModalProps) {
  const { client, summary } = report;
  const includedHours = client.monthlyHoursIncluded ?? 4;
  const usedHours = client.hoursUsedThisMonth ?? 0;

  const handleDownloadMarkdown = () => {
    const lines: string[] = [
      `# ${report.agencyName} — Monthly Maintenance Report (${report.monthLabel})`,
      '',
      `**Client:** ${client.businessName} (${client.fullName})`,
      `**Generated:** ${new Date(report.generatedAt).toLocaleString()}`,
      `**Retainer Plan:** ${client.retainerPlan || 'Standard Care'}`,
      `**Monthly Fee:** ${formatMoney(client.monthlyFeeCents, client.currency)}`,
      `**Maintenance Hours Used:** ${usedHours} / ${includedHours} hrs`,
      client.renewalDate
        ? `**Next Renewal:** ${new Date(client.renewalDate).toLocaleDateString()}`
        : '',
      '',
      '## Monthly Summary',
      `- Active Websites: ${summary.activeWebsites} / ${summary.totalWebsites}`,
      `- Published Deployments This Month: ${summary.deploymentsThisMonth}`,
      `- Resolved Requests This Month: ${summary.resolvedRequestsThisMonth}`,
      `- Open Requests: ${summary.openRequestsCount}`,
      '',
      '## Websites',
      ...(report.websites.length > 0
        ? report.websites.map(
            (w) =>
              `- **${w.name}** (${w.status}) — ${w.domain || 'Managed URL'}${w.liveUrl ? ` · ${w.liveUrl}` : ''}`
          )
        : ['- No websites assigned.']),
      '',
      '## Recent Change Requests',
      ...(report.recentRequests.length > 0
        ? report.recentRequests.map(
            (r) => `- [${r.status}] **${r.title}** (${new Date(r.updatedAt).toLocaleDateString()})`
          )
        : ['- No change requests recorded.']),
      '',
      '## Recent Deployments',
      ...(report.recentDeployments.length > 0
        ? report.recentDeployments.map(
            (d) =>
              `- ${new Date(d.createdAt).toLocaleDateString()} · ${d.provider} · ${d.status}${
                d.liveUrl ? ` (${d.liveUrl})` : ''
              }`
          )
        : ['- No deployments recorded.']),
    ].filter((line) => line !== undefined);

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = client.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    link.download = `maintenance-report-${safeName}-${report.monthLabel.toLowerCase().replace(/\s+/g, '-')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div className="w-full max-w-3xl max-h-[90vh] bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 print:hidden">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Monthly Maintenance Report · {report.monthLabel}
            </h2>
            <p className="text-xs text-slate-500">
              {report.agencyName} · {client.businessName}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .md</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              aria-label="Close maintenance report"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{report.agencyName}</p>
              <h3 className="text-xl font-bold text-slate-900">{client.businessName}</h3>
              <p className="text-xs text-slate-600">
                {client.fullName} · {client.email}
              </p>
            </div>
            <div className="text-left sm:text-right text-xs text-slate-600 space-y-0.5">
              <p className="font-semibold text-slate-900">{client.retainerPlan || 'Standard Care'}</p>
              <p className="font-mono tabular-nums">
                {formatMoney(client.monthlyFeeCents, client.currency)} / month
              </p>
              <p className="font-mono tabular-nums">
                Hours: {usedHours} / {includedHours} hrs used
              </p>
              {client.renewalDate && (
                <p className="font-mono tabular-nums">
                  Renews {new Date(client.renewalDate).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500">Active Sites</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {summary.activeWebsites} / {summary.totalWebsites}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500">Deploys (Month)</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {summary.deploymentsThisMonth}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500">Resolved Requests</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {summary.resolvedRequestsThisMonth}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500">Open Requests</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {summary.openRequestsCount}
              </p>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Managed Websites</h4>
            {report.websites.length === 0 ? (
              <p className="text-xs text-slate-500">No websites assigned.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {report.websites.map((w) => (
                  <div key={w.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{w.name}</p>
                      <p className="text-slate-500 truncate">{w.domain || w.liveUrl || 'Pending URL'}</p>
                    </div>
                    <StatusText status={w.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Recent Deployments &amp; Updates
            </h4>
            {report.recentDeployments.length === 0 ? (
              <p className="text-xs text-slate-500">No deployments recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {report.recentDeployments.slice(0, 6).map((d) => (
                  <div key={d.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-slate-800">{d.provider.replace('_', ' ')}</span>
                    <div className="flex items-center gap-3">
                      <StatusText status={d.status} />
                      <span className="font-mono tabular-nums text-slate-500">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Change Requests
            </h4>
            {report.recentRequests.length === 0 ? (
              <p className="text-xs text-slate-500">No change requests recorded.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {report.recentRequests.slice(0, 6).map((r) => (
                  <div key={r.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-slate-800 truncate">{r.title}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusText status={r.status} />
                      <span className="font-mono tabular-nums text-slate-500">
                        {new Date(r.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
