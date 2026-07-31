import { useReducer, useState, useMemo, type ReactNode } from 'react';
import type { Filters, Offer, PaymentMethodGroup } from '../types';
import { FiltersContext, type ChartScope } from '../hooks/useFilters';

interface ChartScopeVisibility {
  defaultVisible: boolean;
  exceptions: Set<string>;
}
import { INITIAL_FILTERS, filtersReducer } from './filtersState';
import { getEstimatedProfitFiat, getPremiumMetricValue, getRefPrice, hasZeroTrustScore, isOfferLive, profitScenarioForPremiumMode } from '../utils/offerAccess';

function countOffersByPaymentMethod(offers: Offer[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of offers) {
    for (const method of o.payment_methods ?? []) {
      counts[method] = (counts[method] ?? 0) + 1;
    }
  }
  return counts;
}

function applyMonitorFilters(
  offers: Offer[],
  filters: Filters,
  paymentFilterFn: ((o: Offer) => boolean) | null,
  options?: { skipPayment?: boolean; skipProfitRange?: boolean; skipPremiumRange?: boolean },
): Offer[] {
  let f = offers;
  if (filters.direction) f = f.filter(o => o.direction === filters.direction);
  if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
  if (filters.excludedExchanges.length > 0) {
    const excluded = new Set(filters.excludedExchanges);
    f = f.filter(o => !excluded.has(o.exchange));
  }
  if (!options?.skipPayment && paymentFilterFn) f = f.filter(paymentFilterFn);
  if (filters.status === 'open') f = f.filter(o => isOfferLive(o));
  if (filters.status === 'closed') f = f.filter(o => !isOfferLive(o));
  if (!options?.skipPremiumRange) {
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
  }
  if (!options?.skipProfitRange) {
    const profitMin = parseFloat(filters.profitMin);
    const profitMax = parseFloat(filters.profitMax);
    const profitScenario = profitScenarioForPremiumMode(filters.premiumMode);
    if (!isNaN(profitMin)) f = f.filter(o => (getEstimatedProfitFiat(o, profitScenario) ?? 0) >= profitMin);
    if (!isNaN(profitMax)) f = f.filter(o => (getEstimatedProfitFiat(o, profitScenario) ?? 0) <= profitMax);
  }
  if (filters.premiumOnly) {
    f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);
  }
  return f.sort(
    (a, b) => (getPremiumMetricValue(a, filters.premiumMode) || 0) - (getPremiumMetricValue(b, filters.premiumMode) || 0),
  );
}

// ── Provider ───────────────────────────────────────────────────────────────

interface Props {
  offers: Offer[];
  loading: boolean;
  groups: PaymentMethodGroup[];
  excludedMethods: string[];
  hideZeroTrustScore: boolean;
  children: ReactNode;
}

export function FiltersProvider({ offers, loading, groups, excludedMethods, hideZeroTrustScore, children }: Props) {
  const [filters, dispatch] = useReducer(filtersReducer, INITIAL_FILTERS);
  const [selectedOfferKey, setSelectedOfferKey] = useState<string | null>(null);
  const [hoveredOhlcTime, setHoveredOhlcTime] = useState<number | null>(null);
  // Chart-overlay visibility per scope: a default plus per-offer exceptions.
  // Monitor is visible-by-default (exceptions = unticked offers); Insights is
  // hidden-by-default (exceptions = explicitly ticked offers), so offers
  // arriving later stay hidden there too.
  const [chartVisibility, setChartVisibility] = useState<Record<ChartScope, ChartScopeVisibility>>(() => ({
    monitor: { defaultVisible: true, exceptions: new Set() },
    insights: { defaultVisible: false, exceptions: new Set() },
  }));

  const isChartOfferVisible = (scope: ChartScope, key: string) => {
    const { defaultVisible, exceptions } = chartVisibility[scope];
    return defaultVisible ? !exceptions.has(key) : exceptions.has(key);
  };

  const toggleChartOfferKey = (scope: ChartScope, key: string) => {
    setChartVisibility(prev => {
      const next = new Set(prev[scope].exceptions);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [scope]: { ...prev[scope], exceptions: next } };
    });
  };

  const setChartOfferKeysVisible = (scope: ChartScope, keys: string[], visible: boolean) => {
    setChartVisibility(prev => {
      const next = new Set(prev[scope].exceptions);
      const makeException = visible !== prev[scope].defaultVisible;
      keys.forEach(k => {
        if (makeException) next.add(k);
        else next.delete(k);
      });
      return { ...prev, [scope]: { ...prev[scope], exceptions: next } };
    });
  };

  const hideAllChartOffers = () => {
    setChartVisibility(prev => ({ ...prev, insights: { defaultVisible: false, exceptions: new Set() } }));
  };

  const setFilters = (partial: Partial<Filters>) => dispatch({ type: 'SET', payload: partial });
  const resetFilters = () => dispatch({ type: 'RESET' });

  const refPrice = useMemo(() => {
    const liveOffer = offers.find(o => isOfferLive(o) && getRefPrice(o) != null);
    return liveOffer ? getRefPrice(liveOffer) : null;
  }, [offers]);

  // Payment-method exclusions only — zero-trust hiding is applied after monitor filters for counting.
  const baseOffers = useMemo(() => {
    if (excludedMethods.length === 0) return offers;
    const excluded = new Set(excludedMethods);
    return offers.filter(o => !o.payment_methods?.some(m => excluded.has(m)));
  }, [offers, excludedMethods]);

  const paymentMethods = useMemo(
    () => [...new Set(baseOffers.flatMap(o => o.payment_methods ?? []))].sort((a, b) => a.localeCompare(b)),
    [baseOffers],
  );

  // Resolve payment filter: group name → set of methods, or exact string match.
  const paymentFilterFn = useMemo(() => {
    if (!filters.payment) return null;
    const group = groups.find(g => g.name === filters.payment);
    if (group) {
      const set = new Set(group.methods);
      return (o: Offer) => o.payment_methods?.some(m => set.has(m)) ?? false;
    }
    return (o: Offer) => o.payment_methods?.includes(filters.payment) ?? false;
  }, [filters.payment, groups]);

  // Score-0 offers in the current monitor view (premium, direction, etc.) — not the raw feed.
  const zeroTrustHiddenCount = useMemo(() => {
    const monitorFiltered = applyMonitorFilters(baseOffers, filters, paymentFilterFn);
    return monitorFiltered.filter(hasZeroTrustScore).length;
  }, [baseOffers, filters, paymentFilterFn]);

  // Per-method offer counts for the current monitor view (excludes payment filter so all methods stay visible).
  const paymentMethodCounts = useMemo(() => {
    const forCounting = applyMonitorFilters(baseOffers, filters, paymentFilterFn, { skipPayment: true });
    return countOffersByPaymentMethod(forCounting);
  }, [baseOffers, filters, paymentFilterFn]);

  const activeOffers = useMemo(() => {
    if (!hideZeroTrustScore) return baseOffers;
    return baseOffers.filter(o => !hasZeroTrustScore(o));
  }, [baseOffers, hideZeroTrustScore]);

  const filteredOffers = useMemo(
    () => applyMonitorFilters(activeOffers, filters, paymentFilterFn),
    [activeOffers, filters, paymentFilterFn],
  );

  // Universe for range sliders: same category/view filters as the table, but
  // without the range being edited (so bounds can expand to the full category).
  const offersForProfitRange = useMemo(
    () => applyMonitorFilters(activeOffers, filters, paymentFilterFn, { skipProfitRange: true }),
    [activeOffers, filters, paymentFilterFn],
  );
  const offersForPremiumRange = useMemo(
    () => applyMonitorFilters(activeOffers, filters, paymentFilterFn, { skipPremiumRange: true }),
    [activeOffers, filters, paymentFilterFn],
  );

  // The depth chart represents the market book, so only market-selection
  // filters apply. Opportunity-only filters (direction, status and premium)
  // must not make the current book disappear when the offers table switches
  // between Live/Past or narrows to profitable rows.
  const depthOffers = useMemo(() => {
    let f = activeOffers;
    if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
    if (filters.excludedExchanges.length > 0) {
      const excluded = new Set(filters.excludedExchanges);
      f = f.filter(o => !excluded.has(o.exchange));
    }
    if (paymentFilterFn) f = f.filter(paymentFilterFn);
    return f;
  }, [activeOffers, filters, paymentFilterFn]);

  return (
    <FiltersContext.Provider value={{ filters, setFilters, resetFilters, offers, filteredOffers, offersForProfitRange, offersForPremiumRange, depthOffers, paymentMethods, paymentMethodCounts, groups, selectedOfferKey, setSelectedOfferKey, hoveredOhlcTime, setHoveredOhlcTime, loading, refPrice, zeroTrustHiddenCount, isChartOfferVisible, toggleChartOfferKey, setChartOfferKeysVisible, hideAllChartOffers }}>
      {children}
    </FiltersContext.Provider>
  );
}
