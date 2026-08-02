import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CEXPermissionsContext,
  type CEXPermissionExchange,
  type CEXPolicy,
} from '../hooks/useCEXPermissions';
import { apiFetch } from '../api/client';

interface Props {
  children: ReactNode;
}

interface CEXPermissionsResponse {
  exchanges: CEXPermissionExchange[];
}

export function CEXPermissionsProvider({ children }: Props) {
  const [exchanges, setExchanges] = useState<CEXPermissionExchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [revision, setRevision] = useState(0);
  const [updating, setUpdating] = useState<string | null>(null);
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

  const updatePolicy = useCallback(async (exchange: string, policy: CEXPolicy) => {
    setUpdating(exchange);
    setError(null);
    try {
      const updated = await apiFetch<CEXPermissionExchange>(`/api/cex_permissions/${encodeURIComponent(exchange)}`, {
        method: 'PUT',
        body: JSON.stringify({
          spot_enabled: policy.spot_enabled,
          hedge_enabled: policy.hedge_enabled,
        }),
      });
      setExchanges(current => current.map(item => item.exchange === exchange ? updated : item));
      setRevision(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setUpdating(null);
    }
  }, []);

  const value = useMemo(() => ({
    exchanges,
    loading,
    ready: !loading && error == null,
    error,
    revision,
    updating,
    updatePolicy,
    reload,
  }), [exchanges, loading, error, revision, updating, updatePolicy, reload]);

  return <CEXPermissionsContext.Provider value={value}>{children}</CEXPermissionsContext.Provider>;
}
