import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { TradeCostConfig } from '../types';

const defaultConfig: TradeCostConfig = {
  cexes: [],
  fee_tiers: [{ value: '', label: 'Auto (congestion-based)' }],
};

export function useTradeCostConfig(): { config: TradeCostConfig; loading: boolean } {
  const [config, setConfig] = useState<TradeCostConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<TradeCostConfig>('/api/trade_cost_config')
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to load trade cost config:', err))
      .finally(() => setLoading(false));
  }, []);

  return { config, loading };
}
