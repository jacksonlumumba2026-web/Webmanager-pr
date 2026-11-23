import { AlertTriangle, CheckCircle2, Clock, Archive, XCircle, Loader2 } from 'lucide-react';

interface StatusTextProps {
  status: string;
}

const STATUS_MAP: Record<
  string,
  { label: string; colorClass: string; icon: 'check' | 'clock' | 'warn' | 'archive' | 'error' | 'spin' }
> = {
  active: { label: 'Active', colorClass: 'text-emerald-700', icon: 'check' },
  up: { label: 'Online', colorClass: 'text-emerald-700', icon: 'check' },
  paid: { label: 'Paid', colorClass: 'text-emerald-700', icon: 'check' },
  published: { label: 'Published', colorClass: 'text-emerald-700', icon: 'check' },
  resolved: { label: 'Resolved', colorClass: 'text-emerald-700', icon: 'check' },
  accepted: { label: 'Accepted', colorClass: 'text-emerald-700', icon: 'check' },
  pending: { label: 'Pending', colorClass: 'text-amber-700', icon: 'clock' },
  ready: { label: 'Ready to publish', colorClass: 'text-blue-700', icon: 'clock' },
  draft: { label: 'Draft', colorClass: 'text-slate-600', icon: 'clock' },
  open: { label: 'Open', colorClass: 'text-amber-700', icon: 'clock' },
  in_review: { label: 'In review', colorClass: 'text-blue-700', icon: 'clock' },
  in_progress: { label: 'In progress', colorClass: 'text-blue-700', icon: 'spin' },
  publishing: { label: 'Publishing', colorClass: 'text-blue-700', icon: 'spin' },
  attention: { label: 'Needs attention', colorClass: 'text-red-700', icon: 'warn' },
  overdue: { label: 'Overdue', colorClass: 'text-red-700', icon: 'warn' },
  down: { label: 'Offline', colorClass: 'text-red-700', icon: 'error' },
  failed: { label: 'Failed', colorClass: 'text-red-700', icon: 'error' },
  suspended: { label: 'Suspended', colorClass: 'text-red-700', icon: 'error' },
  revoked: { label: 'Revoked', colorClass: 'text-slate-500', icon: 'error' },
  expired: { label: 'Expired', colorClass: 'text-slate-500', icon: 'error' },
  archived: { label: 'Archived', colorClass: 'text-slate-500', icon: 'archive' },
  void: { label: 'Void', colorClass: 'text-slate-500', icon: 'archive' },
  closed: { label: 'Closed', colorClass: 'text-slate-500', icon: 'archive' },
};

export function StatusText({ status }: StatusTextProps) {
  const key = status.toLowerCase();
  const cfg = STATUS_MAP[key] || { label: status, colorClass: 'text-slate-700', icon: 'clock' };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${cfg.colorClass}`}>
      {cfg.icon === 'check' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
      {cfg.icon === 'clock' && <Clock className="w-3.5 h-3.5 shrink-0" />}
      {cfg.icon === 'warn' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
      {cfg.icon === 'archive' && <Archive className="w-3.5 h-3.5 shrink-0" />}
      {cfg.icon === 'error' && <XCircle className="w-3.5 h-3.5 shrink-0" />}
      {cfg.icon === 'spin' && <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />}
      <span>{cfg.label}</span>
    </span>
  );
}
