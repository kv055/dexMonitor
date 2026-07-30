import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CEXPermissionsContext,
  type CEXPermissionExchange,
} from '../hooks/useCEXPermissions';
import { apiFetch } from '../utils/api';

interface Props {
  children: ReactNode;
}

interface CEXPermissionsResponse {
  exchanges: CEXPermissionExchange[];
}

// Includes every venue the cost engine can route through. A configured account
// that is not permission-integrated (currently Bitstamp) remains hidden in the
// panel and hard-locked in requests.
const OPTIMIZER_CEXES = ['binance', 'kraken', 'coinbase', 'bitstamp'];

export function CEXPermissionsProvider({ children }: Props) {
  const [exchanges, setExchanges] = useState<CEXPermissionExchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey(value => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CEXPermissionsResponse>('/api/cex_permissions')
      .then(response => {
        if (cancelled) return;
        setExchanges(response.exchanges ?? []);
        setError(null);
      })
      .catch(reason => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const value = useMemo(() => ({
    exchanges,
    loading,
    ready: !loading && error == null,
    error,
    lockedSpotCEXes: OPTIMIZER_CEXES.filter(name => !exchanges.some(exchange => exchange.optimizer_supported && exchange.exchange === name && exchange.spot.available)),
    lockedHedgeCEXes: OPTIMIZER_CEXES.filter(name => !exchanges.some(exchange => exchange.optimizer_supported && exchange.exchange === name && exchange.hedge.available)),
    reload,
  }), [exchanges, loading, error, reload]);

  return <CEXPermissionsContext.Provider value={value}>{children}</CEXPermissionsContext.Provider>;
}
