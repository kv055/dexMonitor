import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { TradeCostConfig } from '../types';

const defaultConfig: TradeCostConfig = {
  cexes: [],
  dex_routing_profiles: [],
  fee_tiers: [{ value: '', label: 'Auto (congestion-based)' }],
};

export function useTradeCostConfig(enabled = true): { config: TradeCostConfig } {
  const [config, setConfig] = useState<TradeCostConfig>(defaultConfig);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<TradeCostConfig>('/api/trade_cost_config')
      .then(data => {
        if (!cancelled) setConfig(data);
      })
      .catch(err => console.error('Failed to load trade cost config:', err));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { config };
}
