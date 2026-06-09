import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { TradeCostConfig } from '../types';

const defaultConfig: TradeCostConfig = {
  cexes: [],
  fee_tiers: [{ value: '', label: 'Auto (congestion-based)' }],
};

export function useTradeCostConfig(enabled = true): { config: TradeCostConfig; loading: boolean } {
  const [config, setConfig] = useState<TradeCostConfig>(defaultConfig);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<TradeCostConfig>('/api/trade_cost_config')
      .then(data => {
        if (!cancelled) setConfig(data);
      })
      .catch(err => console.error('Failed to load trade cost config:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { config, loading };
}
