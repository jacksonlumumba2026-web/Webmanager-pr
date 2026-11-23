import { useEffect, useState } from 'react';

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export interface ConnectivityState {
  isOnline: boolean;
  isLowNetwork: boolean;
  usingCachedData: boolean;
}

function readIsLowNetwork(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!conn) return false;
  return Boolean(conn.saveData || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g');
}

export function useOnlineStatus(): ConnectivityState {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isLowNetwork, setIsLowNetwork] = useState<boolean>(readIsLowNetwork);
  const [usingCachedData, setUsingCachedData] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setUsingCachedData(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleCacheFallback = (event: Event) => {
      const custom = event as CustomEvent<{ usingCache?: boolean }>;
      if (custom.detail?.usingCache) {
        setUsingCachedData(true);
      } else {
        setUsingCachedData(false);
      }
    };
    const handleConnectionChange = () => {
      setIsLowNetwork(readIsLowNetwork());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('wmp:cache-fallback', handleCacheFallback);

    const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    conn?.addEventListener?.('change', handleConnectionChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('wmp:cache-fallback', handleCacheFallback);
      conn?.removeEventListener?.('change', handleConnectionChange);
    };
  }, []);

  return { isOnline, isLowNetwork, usingCachedData };
}
