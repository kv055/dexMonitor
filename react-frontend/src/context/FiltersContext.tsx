import { useCallback, useEffect, useReducer, useState, useMemo, type ReactNode } from 'react';
import type { Filters, Offer, PaymentMethodGroup } from '../types';
import { FiltersContext, type ChartScope, type LinkedPaymentMethodOption } from '../hooks/useFilters';

interface ChartScopeVisibility {
  defaultVisible: boolean;
  exceptions: Set<string>;
}
import { INITIAL_FILTERS, filtersReducer } from './filtersState';
import { getRefPrice, hasZeroTrustScore, isOfferLive } from '../utils/offerAccess';
import { applyOfferFilters, countOffersByPaymentMethod } from '../features/insights/filterOffers';
import { fetchPaymentMethods } from '../utils/api';
import type { PriceLevel } from '../utils/priceLevels';

// ── Provider ───────────────────────────────────────────────────────────────

interface Props {
  offers: Offer[];
  loading: boolean;
  groups: PaymentMethodGroup[];
  hideZeroTrustScore: boolean;
  children: ReactNode;
}

export function FiltersProvider({ offers, loading, groups, hideZeroTrustScore, children }: Props) {
  const [filters, dispatch] = useReducer(filtersReducer, INITIAL_FILTERS);
  const [selectedOfferKey, setSelectedOfferKey] = useState<string | null>(null);
  const [hoveredOhlcTime, setHoveredOhlcTime] = useState<number | null>(null);
  const [selectedPriceLevel, setSelectedPriceLevel] = useState<PriceLevel | null>(null);
  const [linkedPaymentMethods, setLinkedPaymentMethods] = useState<Set<string> | null>(null);
  const [linkedPaymentMethodOptions, setLinkedPaymentMethodOptions] = useState<LinkedPaymentMethodOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPaymentMethods()
      .then(({ payment_methods }) => {
        if (!cancelled) {
          const linked = payment_methods
            .filter(method => method.is_linked)
            .map(method => ({ name: method.name, aliases: method.alias_list, category: method.category }));
          setLinkedPaymentMethodOptions(linked);
          setLinkedPaymentMethods(new Set(linked.flatMap(method => [method.name, ...method.aliases])));
        }
      })
      .catch(() => {
        // Keep all methods visible if the catalog cannot be loaded.
        if (!cancelled) {
          setLinkedPaymentMethods(null);
          setLinkedPaymentMethodOptions(null);
        }
      });
    return () => { cancelled = true; };
  }, []);
  // Chart-overlay visibility per scope: a default plus per-offer exceptions.
  // Monitor is visible-by-default (exceptions = unticked offers); Insights is
  // hidden-by-default (exceptions = explicitly ticked offers), so offers
  // arriving later stay hidden there too.
  const [chartVisibility, setChartVisibility] = useState<Record<ChartScope, ChartScopeVisibility>>(() => ({
    monitor: { defaultVisible: true, exceptions: new Set() },
    insights: { defaultVisible: false, exceptions: new Set() },
  }));

  const isChartOfferVisible = useCallback((scope: ChartScope, key: string) => {
    const { defaultVisible, exceptions } = chartVisibility[scope];
    return defaultVisible ? !exceptions.has(key) : exceptions.has(key);
  }, [chartVisibility]);

  const toggleChartOfferKey = useCallback((scope: ChartScope, key: string) => {
    setChartVisibility(prev => {
      const next = new Set(prev[scope].exceptions);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [scope]: { ...prev[scope], exceptions: next } };
    });
  }, []);

  const setChartOfferKeysVisible = useCallback((scope: ChartScope, keys: string[], visible: boolean) => {
    setChartVisibility(prev => {
      const next = new Set(prev[scope].exceptions);
      const makeException = visible !== prev[scope].defaultVisible;
      keys.forEach(k => {
        if (makeException) next.add(k);
        else next.delete(k);
      });
      return { ...prev, [scope]: { ...prev[scope], exceptions: next } };
    });
  }, []);

  const hideAllChartOffers = useCallback(() => {
    setChartVisibility(prev => ({ ...prev, insights: { defaultVisible: false, exceptions: new Set() } }));
  }, []);

  const setFilters = useCallback((partial: Partial<Filters>) => dispatch({ type: 'SET', payload: partial }), []);
  const resetFilters = useCallback(() => dispatch({ type: 'RESET' }), []);

  const refPrice = useMemo(() => {
    const liveOffer = offers.find(o => isOfferLive(o) && getRefPrice(o) != null);
    return liveOffer ? getRefPrice(liveOffer) : null;
  }, [offers]);

  // A linked-method filter is driven by the catalog's DB-backed is_linked state.
  const baseOffers = useMemo(() => {
    if (filters.paymentScope !== 'linked' || linkedPaymentMethods == null) return offers;
    const allowed = filters.selectedLinkedPaymentMethods.length === 0
      ? linkedPaymentMethods
      : new Set(
        (linkedPaymentMethodOptions ?? [])
          .filter(method => filters.selectedLinkedPaymentMethods.includes(method.name))
          .flatMap(method => [method.name, ...method.aliases]),
      );
    return offers.filter(o => o.payment_methods?.some(method => allowed.has(method)) ?? false);
  }, [offers, filters.paymentScope, filters.selectedLinkedPaymentMethods, linkedPaymentMethods, linkedPaymentMethodOptions]);

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

  // Confirmed-bad (score-0 feedback / banned) offers in the current monitor view.
  const zeroTrustHiddenCount = useMemo(() => {
    const monitorFiltered = applyOfferFilters(baseOffers, filters, paymentFilterFn);
    return monitorFiltered.filter(hasZeroTrustScore).length;
  }, [baseOffers, filters, paymentFilterFn]);

  // Per-method offer counts for the current monitor view (excludes payment filter so all methods stay visible).
  const paymentMethodCounts = useMemo(() => {
    const forCounting = applyOfferFilters(baseOffers, filters, paymentFilterFn, { skipPayment: true });
    return countOffersByPaymentMethod(forCounting);
  }, [baseOffers, filters, paymentFilterFn]);

  const activeOffers = useMemo(() => {
    if (!hideZeroTrustScore) return baseOffers;
    return baseOffers.filter(o => !hasZeroTrustScore(o));
  }, [baseOffers, hideZeroTrustScore]);

  const filteredOffers = useMemo(
    () => applyOfferFilters(activeOffers, filters, paymentFilterFn),
    [activeOffers, filters, paymentFilterFn],
  );

  // Universe for range sliders: same category/view filters as the table, but
  // without the range being edited (so bounds can expand to the full category).
  const offersForProfitRange = useMemo(
    () => applyOfferFilters(activeOffers, filters, paymentFilterFn, { skipProfitRange: true }),
    [activeOffers, filters, paymentFilterFn],
  );
  const offersForPremiumRange = useMemo(
    () => applyOfferFilters(activeOffers, filters, paymentFilterFn, { skipPremiumRange: true }),
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

  const contextValue = useMemo(() => ({
    filters,
    setFilters,
    resetFilters,
    offers,
    filteredOffers,
    offersForProfitRange,
    offersForPremiumRange,
    depthOffers,
    paymentMethods,
    linkedPaymentMethods,
    linkedPaymentMethodOptions,
    paymentMethodCounts,
    groups,
    selectedOfferKey,
    setSelectedOfferKey,
    hoveredOhlcTime,
    setHoveredOhlcTime,
    selectedPriceLevel,
    setSelectedPriceLevel,
    loading,
    refPrice,
    zeroTrustHiddenCount,
    isChartOfferVisible,
    toggleChartOfferKey,
    setChartOfferKeysVisible,
    hideAllChartOffers,
  }), [
    filters,
    setFilters,
    resetFilters,
    offers,
    filteredOffers,
    offersForProfitRange,
    offersForPremiumRange,
    depthOffers,
    paymentMethods,
    linkedPaymentMethods,
    linkedPaymentMethodOptions,
    paymentMethodCounts,
    groups,
    selectedOfferKey,
    hoveredOhlcTime,
    selectedPriceLevel,
    loading,
    refPrice,
    zeroTrustHiddenCount,
    isChartOfferVisible,
    toggleChartOfferKey,
    setChartOfferKeysVisible,
    hideAllChartOffers,
  ]);

  return (
    <FiltersContext.Provider value={contextValue}>
      {children}
    </FiltersContext.Provider>
  );
}
