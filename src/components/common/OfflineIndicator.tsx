import React from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.ts';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, isLowNetwork, usingCachedData } = useOnlineStatus();

  if (isOnline && !usingCachedData && !isLowNetwork) {
    return null;
  }

  if (!isOnline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white shadow-lg border border-amber-500"
      >
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        <span>Offline Mode — Showing saved data</span>
      </div>
    );
  }

  if (usingCachedData) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg border border-slate-700"
      >
        <Wifi className="w-3.5 h-3.5 shrink-0 text-amber-400" />
        <span>Weak Network — Loaded saved snapshot</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-lg bg-slate-800/95 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-md border border-slate-700"
    >
      <Wifi className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
      <span>Low-data mode active</span>
    </div>
  );
};
