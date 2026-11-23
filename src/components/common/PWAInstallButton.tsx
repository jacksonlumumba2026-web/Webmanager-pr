import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 transition-colors font-medium whitespace-nowrap ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-xs'
        }`}
        title="Install WebManager Pro for faster low-network and offline loading"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium whitespace-nowrap ${
            compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-xs'
          }`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>Install App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-6 shadow-xl space-y-4">
              <h3 className="text-base font-bold text-slate-900">Install on iPhone / iPad</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                1. Tap the <strong>Share</strong> button in your Safari toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong> so the app opens faster even on slow networks.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
