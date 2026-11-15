import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStatistics } from '../hooks/useStatistics';
import { useMarketRequestParams } from '../hooks/useMarketRequestParams';
import { useFilters } from '../hooks/useFilters';
import { useTimezone } from '../hooks/useTimezone';
import { isOfferLive } from '../utils/offerAccess';
import { parseFilterNumber, type StatisticsOfferFilters } from '../shared/marketParams';
import type { OfferLifecyclePremiumPoint, PremiumFilterMode } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { OfferPremiumScatterChart, type PremiumScatterDimension } from './OfferLifecyclePremiumChart';
import {
  ExchangesCard,
  LifetimeCard,
  PastPremiumsCard,
  PaymentMethodsCard,
  PremiumsCard,
} from './GeneralStats';
import { CustomDateRangeFilter, DualRangeFilter, FilterSelect, PremiumSelect } from './ControlPanel';
import { premiumModeLabel } from '../utils/premiumModes';
import { OfferFilterRail, type DirectionFilter, type OfferFilterRailScope } from './OfferFilterRail';

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 shrink-0">
      <h2 className="text-[0.7rem] uppercase tracking-widest font-semibold text-muted">{title}</h2>
      {subtitle && <span className="text-[0.65rem] text-muted">{subtitle}</span>}
    </div>
  );
}

function premiumCardMode(mode: PremiumFilterMode): 'raw' | 'net_full' | 'net_capped' {
  if (mode === 'raw' || mode === 'net_capped') return mode;
  return 'net_full';
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type StatisticsMode = 'live' | 'past' | 'shared';

const CUSTOM_TIMEFRAME = 'custom';
const STATS_TIMEFRAMES = ['6h', '24h', '48h', '7d'] as const;

function labelForTimeframe(timeframe: string): string {
  switch (timeframe) {
    case '6h': return 'Past 6h';
    case '24h': return 'Past 24h';
    case '48h': return 'Past 48h';
    case '7d': return 'Past 7d';
    default: return timeframe;
  }
}

function timeframeHours(timeframe: string): number {
  switch (timeframe) {
    case '6h': return 6;
    case '24h': return 24;
    case '48h': return 48;
    case '7d': return 168;
    default: return 24;
  }
}

function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes < 1) return '0m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function isDateInputValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function exchangeFilterFromPoints(
  points: OfferLifecyclePremiumPoint[],
  directionFilter: DirectionFilter,
) {
  const counts: Record<string, number> = {};
  for (const point of points) {
    if (directionFilter !== 'both' && point.direction !== directionFilter) continue;
    counts[point.exchange] = (counts[point.exchange] ?? 0) + 1;
  }
  return {
    counts,
    exchanges: Object.keys(counts).sort((a, b) => a.localeCompare(b, 'de')),
  };
}

function durationBoundsFromPoints(points: OfferLifecyclePremiumPoint[]) {
  const minutes = points
    .map(point => Math.round(Math.abs(point.lifecycle_hours) * 60))
    .filter(value => Number.isFinite(value) && value >= 0);
  if (minutes.length === 0) {
    return { min: 0, max: 1, hasData: false };
  }
  return { min: Math.min(...minutes), max: Math.max(...minutes), hasData: true };
}

export function StatisticsView({ lastUpdatedAt = '' }: { lastUpdatedAt?: string }) {
  const { params, ready } = useMarketRequestParams();
  const {
    filters,
    setFilters,
    resetFilters,
    offers,
    linkedPaymentMethods,
    linkedPaymentMethodOptions,
  } = useFilters();
  const { data, loading, error, builtAt, load } = useStatistics();
  const [mode, setMode] = useState<StatisticsMode>('shared');
  const [scatterDimension, setScatterDimension] = useState<PremiumScatterDimension>('lifecycle');
  const { timezone } = useTimezone();
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [durationSelection, setDurationSelection] = useState<{
    key: string;
    range: [number, number];
  } | null>(null);
  const [referenceNow] = useState(() => new Date());
  const railScope: OfferFilterRailScope = mode === 'shared' ? 'all' : mode;
  const applyPastWindow = mode !== 'live';

  const directionFilter: DirectionFilter = filters.direction === 'bid' || filters.direction === 'ask'
    ? filters.direction
    : 'both';

  const liveExchangeFilter = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const offer of offers) {
      if (!isOfferLive(offer)) continue;
      if (directionFilter !== 'both' && offer.direction !== directionFilter) continue;
      counts[offer.exchange] = (counts[offer.exchange] ?? 0) + 1;
    }
    return {
      counts,
      exchanges: Object.keys(counts).sort((a, b) => a.localeCompare(b, 'de')),
    };
  }, [offers, directionFilter]);

  const pastExchangeFilter = useMemo(
    () => exchangeFilterFromPoints(data?.past.offer_lifecycle_points ?? [], directionFilter),
    [data?.past.offer_lifecycle_points, directionFilter],
  );

  const railExchangeFilter = useMemo(() => {
    if (mode === 'live') return liveExchangeFilter;
    if (mode === 'past') return pastExchangeFilter;
    const counts = { ...liveExchangeFilter.counts };
    for (const [exchange, count] of Object.entries(pastExchangeFilter.counts)) {
      counts[exchange] = (counts[exchange] ?? 0) + count;
    }
    return {
      counts,
      exchanges: Object.keys(counts).sort((a, b) => a.localeCompare(b, 'de')),
    };
  }, [mode, liveExchangeFilter, pastExchangeFilter]);

  const durationSourcePoints = useMemo<OfferLifecyclePremiumPoint[]>(() => {
    if (!data) return [];
    if (mode === 'live') return data.live.offer_lifecycle_points ?? [];
    if (mode === 'past') return data.past.offer_lifecycle_points ?? [];
    return [...(data.live.offer_lifecycle_points ?? []), ...(data.past.offer_lifecycle_points ?? [])];
  }, [data, mode]);

  const durationBounds = useMemo(() => durationBoundsFromPoints(durationSourcePoints), [durationSourcePoints]);
  const durationBoundsKey = durationBounds.hasData
    ? `${durationBounds.min}:${durationBounds.max}`
    : 'none';
  const durationRange = useMemo<[number, number] | null>(() => {
    if (!durationBounds.hasData) return null;
    if (durationSelection?.key === durationBoundsKey) {
      const [lo, hi] = durationSelection.range;
      const clampedLo = Math.max(durationBounds.min, Math.min(lo, durationBounds.max));
      const clampedHi = Math.max(clampedLo, Math.min(hi, durationBounds.max));
      return [clampedLo, clampedHi];
    }
    return [durationBounds.min, durationBounds.max];
  }, [durationBounds, durationBoundsKey, durationSelection]);

  const customDateMax = dateInputValue(referenceNow);
  const changeTimeframe = useCallback((timeframe: string) => {
    setSelectedTimeframe(timeframe);
    if (timeframe !== CUSTOM_TIMEFRAME) return;
    setCustomEndDate(current => (isDateInputValue(current) ? current : customDateMax));
    setCustomStartDate(current => {
      if (isDateInputValue(current)) return current;
      const defaultStart = new Date(referenceNow);
      defaultStart.setDate(defaultStart.getDate() - 6);
      return dateInputValue(defaultStart);
    });
  }, [customDateMax, referenceNow]);

  const includePaymentMethods = useMemo(() => {
    if (filters.paymentScope !== 'linked') return undefined;
    if (linkedPaymentMethods == null) return undefined;
    if (filters.selectedLinkedPaymentMethods.length === 0) {
      return [...linkedPaymentMethods];
    }
    return (linkedPaymentMethodOptions ?? [])
      .filter(method => filters.selectedLinkedPaymentMethods.includes(method.name))
      .flatMap(method => [method.name, ...method.aliases]);
  }, [filters.paymentScope, filters.selectedLinkedPaymentMethods, linkedPaymentMethods, linkedPaymentMethodOptions]);

  const statsParams = useMemo(() => {
    if (!applyPastWindow || selectedTimeframe === CUSTOM_TIMEFRAME) return params;
    return { ...params, hours: String(timeframeHours(selectedTimeframe)) };
  }, [applyPastWindow, params, selectedTimeframe]);

  const offerFilters = useMemo<StatisticsOfferFilters>(() => ({
    direction: filters.direction || undefined,
    excludedExchanges: filters.excludedExchanges,
    includePaymentMethods,
    paymentScope: filters.paymentScope === 'linked' && linkedPaymentMethods != null ? 'linked' : undefined,
    premiumMode: filters.premiumMode,
    premiumOnly: filters.premiumOnly,
    rangeMetric: filters.rangeMetric,
    profitMin: parseFilterNumber(filters.profitMin),
    profitMax: parseFilterNumber(filters.profitMax),
    premiumMin: parseFilterNumber(filters.premiumMin),
    premiumMax: parseFilterNumber(filters.premiumMax),
    pastRange: applyPastWindow
      && selectedTimeframe === CUSTOM_TIMEFRAME
      && isDateInputValue(customStartDate)
      && isDateInputValue(customEndDate)
      ? { startDate: customStartDate, endDate: customEndDate, timezone }
      : undefined,
  }), [
    filters.direction,
    filters.excludedExchanges,
    filters.paymentScope,
    filters.premiumMode,
    filters.premiumOnly,
    filters.rangeMetric,
    filters.profitMin,
    filters.profitMax,
    filters.premiumMin,
    filters.premiumMax,
    includePaymentMethods,
    linkedPaymentMethods,
    applyPastWindow,
    selectedTimeframe,
    customStartDate,
    customEndDate,
    timezone,
  ]);
  const debouncedOfferFilters = useDebouncedValue(offerFilters, 200);

  useEffect(() => {
    if (!ready) return;
    load(statsParams, debouncedOfferFilters);
  }, [statsParams, debouncedOfferFilters, load, ready]);

  const handleRefresh = useCallback(() => {
    void load(statsParams, { ...offerFilters, refresh: true });
  }, [load, statsParams, offerFilters]);

  const changeDirectionFilter = useCallback((value: DirectionFilter) => {
    setFilters({ direction: value === 'both' ? '' : value });
  }, [setFilters]);

  const applyDisabledExchanges = useCallback((next: string[]) => {
    setFilters({ excludedExchanges: next });
  }, [setFilters]);

  const toggleExchangeFilter = useCallback((exchange: string) => {
    const next = filters.excludedExchanges.includes(exchange)
      ? filters.excludedExchanges.filter(name => name !== exchange)
      : [...filters.excludedExchanges, exchange];
    applyDisabledExchanges(next);
  }, [filters.excludedExchanges, applyDisabledExchanges]);

  const lockedMode = premiumCardMode(filters.premiumMode);
  const statsUpdatedAt = builtAt || lastUpdatedAt;

  const content = (() => {
    if (loading && !data) {
      return (
        <div className="relative flex-1 min-h-0 flex items-center justify-center">
          <LoadingSpinner size={88} label="Loading statistics" />
        </div>
      );
    }

    if (error && !data) {
      return (
        <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      );
    }

    if (!data) {
      return (
        <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted">
          No statistics available.
        </div>
      );
    }

    const { live, past, shared } = data;
    const modeOptions: { value: StatisticsMode; label: string }[] = [
      { value: 'live', label: 'Live Offers' },
      { value: 'past', label: 'Past Offers' },
      { value: 'shared', label: 'All Offers' },
    ];
    const lifecyclePoints = (() => {
      const source = mode === 'live'
        ? (live.offer_lifecycle_points ?? [])
        : mode === 'past'
          ? (past.offer_lifecycle_points ?? [])
          : [...(live.offer_lifecycle_points ?? []), ...(past.offer_lifecycle_points ?? [])];
      if (mode === 'live' || durationRange == null || !durationBounds.hasData) return source;
      const [min, max] = durationRange;
      if (min === durationBounds.min && max === durationBounds.max) return source;
      return source.filter(point => {
        const minutes = Math.round(Math.abs(point.lifecycle_hours) * 60);
        return minutes >= min && minutes <= max;
      });
    })();

    let title = 'Live Offers';
    let subtitle = `${live.active_offers} active · ${live.exchanges_live} exchanges`;
    let cards: ReactNode;

    if (mode === 'past') {
      title = 'Past Offers';
      subtitle = `${past.total_offers} closed summary in window`;
      cards = (
        <>
          <PastPremiumsCard frames={past.past_premiums} lockedMode={lockedMode} />
          <LifetimeCard lifetimes={past.premium_lifetimes} lockedMode={lockedMode} />
          <PaymentMethodsCard counts={past.payment_method_counts} />
        </>
      );
    } else if (mode === 'shared') {
      title = 'All Offers';
      subtitle = `${shared.total_offers} in last ${shared.hours}h (live + past)`;
      cards = (
        <>
          <ExchangesCard exchangesLive={shared.exchanges_live} offersByExchange={shared.offers_by_exchange} />
          <PaymentMethodsCard counts={shared.payment_method_counts} />
          <div className="relative bg-bg border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1.5 overflow-hidden min-w-0">
            <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-border" />
            <span className="text-[0.65rem] uppercase tracking-widest text-muted font-semibold leading-none">
              Window
            </span>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
                {shared.total_offers}
              </span>
              <span className="text-[0.68rem] text-muted">offers</span>
              <span className="text-[0.68rem] tabular-nums mono-nums text-muted">
                · {shared.active_offers} active · {shared.exchanges_live} exchanges
              </span>
            </div>
          </div>
        </>
      );
    } else {
      cards = (
        <>
          <ExchangesCard exchangesLive={live.exchanges_live} offersByExchange={live.offers_by_exchange} />
          <PremiumsCard premium={live.premium_summary} lockedMode={lockedMode} />
          <PaymentMethodsCard counts={live.payment_method_counts} />
        </>
      );
    }

    return (
      <div className="min-h-0 min-w-0 flex-1 flex flex-col gap-3 overflow-y-auto pr-0.5">
        {error && (
          <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
            {error}
          </div>
        )}

        <section className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 lg:flex-1 lg:min-h-0">
          <div className="flex items-center justify-between gap-3 shrink-0">
            <SectionHeader title={title} subtitle={subtitle} />
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {modeOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  className={mode === option.value
                    ? 'rounded-md border border-accent bg-accent px-2 py-0.5 text-[0.68rem] font-medium text-black transition-colors'
                    : 'rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[0.68rem] font-medium text-muted transition-colors hover:text-text'}
                  aria-pressed={mode === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <OfferPremiumScatterChart
            key={`${mode}-${scatterDimension}-${filters.premiumOnly ? 'only' : 'all'}`}
            points={lifecyclePoints}
            dimension={scatterDimension}
            onDimensionChange={setScatterDimension}
            includeNonPremium={!filters.premiumOnly}
          />
          <div className="grid min-h-0 grid-cols-1 auto-rows-fr gap-1.5 md:grid-cols-2 xl:grid-cols-3 lg:flex-1">
            {cards}
          </div>
        </section>
      </div>
    );
  })();

  return (
    <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      <div className="lg:flex-1 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
        <div className="flex flex-1 min-h-0 flex-col gap-3 lg:flex-row">
          <OfferFilterRail
            scope={railScope}
            ariaLabel="Statistics filters"
            showReferenceSource={false}
            directionFilter={directionFilter}
            onDirectionChange={changeDirectionFilter}
            exchanges={railExchangeFilter.exchanges}
            exchangeCounts={railExchangeFilter.counts}
            disabledExchanges={filters.excludedExchanges}
            onToggleExchange={toggleExchangeFilter}
            onEnableAllExchanges={() => applyDisabledExchanges([])}
            onDisableAllExchanges={() => applyDisabledExchanges([...railExchangeFilter.exchanges])}
            onRefresh={handleRefresh}
            lastUpdatedAt={statsUpdatedAt}
            premium={mode === 'past' ? (
              <PremiumSelect
                options={(['raw', 'net_full', 'net_capped'] as const).map(value => ({ value, label: premiumModeLabel(value) }))}
                selected={filters.premiumMode}
                onChange={value => setFilters({ premiumMode: value as PremiumFilterMode })}
              />
            ) : undefined}
            extra={applyPastWindow ? (
              <>
                <FilterSelect
                  label="Timeframe"
                  description="Show offers closed within a preset window or a custom date range"
                  options={[
                    ...STATS_TIMEFRAMES.map(timeframe => ({ value: timeframe, label: labelForTimeframe(timeframe) })),
                    { value: CUSTOM_TIMEFRAME, label: 'Custom date range' },
                  ]}
                  selected={selectedTimeframe}
                  onChange={changeTimeframe}
                />
                {selectedTimeframe === CUSTOM_TIMEFRAME && (
                  <CustomDateRangeFilter
                    startDate={customStartDate}
                    endDate={customEndDate}
                    maxDate={customDateMax}
                    loading={loading}
                    onStartDateChange={value => {
                      setCustomStartDate(value);
                      if (customEndDate && value > customEndDate) setCustomEndDate(value);
                    }}
                    onEndDateChange={setCustomEndDate}
                  />
                )}
                <DualRangeFilter
                  label="Duration"
                  description="Filter offers by how long they were live"
                  min={durationBounds.min}
                  max={durationBounds.max}
                  value={durationRange ?? [durationBounds.min, durationBounds.max]}
                  onChange={range => setDurationSelection({ key: durationBoundsKey, range })}
                  formatValue={formatDurationMinutes}
                  disabled={!durationBounds.hasData || durationRange == null}
                  disabledMessage="No duration data in this window"
                />
              </>
            ) : undefined}
            onReset={() => {
              resetFilters();
              setSelectedTimeframe('24h');
              setCustomStartDate('');
              setCustomEndDate('');
              setDurationSelection(null);
              try {
                const raw = localStorage.getItem('dex-insights-filters');
                if (!raw) return;
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                localStorage.setItem('dex-insights-filters', JSON.stringify({
                  ...parsed,
                  directionFilter: 'both',
                  disabledExchanges: [],
                }));
              } catch {
                // Ignore quota / parse errors; FiltersContext is already reset.
              }
            }}
          />
          {content}
        </div>
      </div>
    </div>
  );
}
