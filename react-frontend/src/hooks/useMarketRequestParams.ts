import { useMemo } from 'react';
import { useCEXPermissions } from './useCEXPermissions';
import { useFilters } from './useFilters';
import { usePreferences } from './usePreferences';
import type { MarketRequestParams } from '../shared/marketParams';

export function useMarketRequestParams(): { params: MarketRequestParams; ready: boolean } {
  const { filters } = useFilters();
  const {
    excludedMethods,
    feeTier,
    coupledHedge,
    maxFiatLimit,
  } = usePreferences();
  const { revision: capabilityRevision } = useCEXPermissions();

  const params = useMemo<MarketRequestParams>(() => ({
    hours: filters.hours,
    cex: filters.cex,
    fiat: filters.fiat,
    capabilityRevision,
    excludedPaymentMethods: excludedMethods,
    feeTier,
    coupledHedge,
    maxFiatLimit,
  }), [
    filters.hours,
    filters.cex,
    filters.fiat,
    capabilityRevision,
    excludedMethods,
    feeTier,
    coupledHedge,
    maxFiatLimit,
  ]);

  return { params, ready: true };
}
