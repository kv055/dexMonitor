import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ManualRouteOptions, Offer, PastOrderStats, PastProfitableOrder, PastProfitableOrderCompact, TakerOpportunityMode, TradeMode } from '../types';
import { useFilters } from '../hooks/useFilters';
import { useTimezone } from '../hooks/useTimezone';
import { useTemporaryChartVisibility } from '../hooks/useTemporaryChartVisibility';
import { buildOfferKeys, buildStableOfferKey } from '../utils/offerIdentity';
import { durationMinutes, formatDateTimeLabel, formatDuration, formatTime, parseUtcTimestamp, premiumClass } from '../utils/formatters';
import {
  getBtcMax,
  getBtcMin,
  getCappedTradeSizeBtc,
  getDisplayAbortCost,
  getDisplayCostBreakdown,
  getEstimatedProfitBtc,
  getEstimatedProfitFiat,
  getFiatMax,
  getFiatMin,
  getOfferVolume,
  getVolumeUnit,
  volumeUnitOf,
  type VolumeUnit,
  getFirstSeen,
  getLastSeen,
  getMinTradeSizeBtc,
  getNetPremiumPercent,
  getOfferPrice,
  getPriceType,
  getRawPremiumPercent,
  getRefPrice,
  getCounterpartyStakePct,
  getTradeSizeBtc,
  hasCappedScenario,
  hasMinScenario,
  isOfferLive,
  pastProfitableOrderAsOffer,
} from '../utils/offerAccess';
import {
  DEFAULT_MANUAL_ROUTE_SELECTION,
  resolveTradeBreakdown,
  type ManualRouteSelection,
} from '../utils/manualRoute';
import {
  explainMissingTradeRoute,
  hasEffectiveHedgeVenue,
  shouldExplainMissingRoute,
} from '../utils/routeAvailability';
import { useCEXPermissions } from '../hooks/useCEXPermissions';
import { CostBreakdownPanel, DetailFact, DetailFacts, SizeToggle, type SizeMode } from './OfferBreakdownPanel';
import { CopyOfferIdButton } from './CopyOfferIdButton';
import { copyableOfferId } from '../features/trading/providerRegistry';
import { getDexOfferLink } from '../utils/dexOfferLinks';
import { ExchangeTag } from './ExchangeTag';
import { LoadingSpinner } from './LoadingSpinner';
import {
  CustomDateRangeFilter,
  DualRangeFilter,
  FilterSelect,
  PremiumSelect,
  ProfitRangeFilter,
  SegmentedToggle,
  type ProfitRangeUnit,
} from './ControlPanel';
import { premiumModeLabel } from '../utils/premiumModes';
import { OfferFilterRail, type DirectionFilter } from './OfferFilterRail';
import { DepthChart } from './DepthChart';
import { formatFiat } from '../utils/currency';
import { isPriceInLevel } from '../utils/priceLevels';
import { CounterpartyStakeBadge, SellerRatingBadge } from './SellerRatingBadge';

const TradeTracingPanel = lazy(() => import('./TradeTracingPanel').then(module => ({ default: module.TradeTracingPanel })));

interface Props {
  stats: PastOrderStats | null;
  statsAll: PastOrderStats | null;
  statsNetCapped: PastOrderStats | null;
  statsAllNetCapped: PastOrderStats | null;
  statsNetMin: PastOrderStats | null;
  statsAllNetMin: PastOrderStats | null;
  fastOrders: PastProfitableOrderCompact[];
  detailedOrders: PastProfitableOrder[];
  statsLoading: boolean;
  ordersLoading: boolean;
  cappedLoading: boolean;
  maxFiatLimit: number | null;
  /** Refreshes the live offers/core dataset (Live mode refresh button). */
  onRefreshLive: () => void;
  lastUpdatedAt: string;
  customRangeLoading?: boolean;
  onCustomRangeChange?: (range: { startDate: string; endDate: string } | null) => void;
  /**
   * Renders the OHLC chart panel; receives the filtered orders as chart
   * overlays plus whether the live (FiltersContext) offers should be plotted —
   * true in Live mode, false in Past mode so past orders aren't obscured.
   */
  chart?: (extraOffers: Offer[], includeLiveOffers: boolean) => ReactNode;
}

type DisplayOrder = PastProfitableOrder | PastProfitableOrderCompact;

function fmtBTC(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 8 })} BTC`;
}

function fmtFiat(value: number | null | undefined, currency: string): string {
  if (value == null) return '—';
  return value.toLocaleString('de-DE', { style: 'currency', currency, maximumFractionDigits: 2 });
}

/**
 * Formats a volume in the selected unit. A volume shown in the unit the maker
 * did not fix is a price conversion, so it is marked "≈" with a tooltip.
 */
function fmtVolume(value: number | null | undefined, unit: VolumeUnit, exactUnit: VolumeUnit | null, fiat: string): { text: string; title: string } {
  const text = unit === 'btc' ? fmtBTC(value) : fmtFiat(value, fiat);
  if (value == null || exactUnit == null || exactUnit === unit) return { text, title: text };
  return {
    text: `≈ ${text}`,
    title: `${text}, converted at the offer's price. This volume is fixed in ${exactUnit === 'btc' ? 'BTC' : fiat}.`,
  };
}

/** Marks a volume range shown in the unit the maker did not fix as a conversion. */
function markConvertedRange(range: string | null, unit: VolumeUnit, exactUnit: VolumeUnit | null): string | null {
  if (range == null || exactUnit == null || exactUnit === unit) return range;
  return `≈ ${range}`;
}

function labelForTimeframe(timeframe: string): string {
  switch (timeframe) {
    case '1h': return 'Past 1h';
    case '6h': return 'Past 6h';
    case '24h': return 'Past 24h';
    case '48h': return 'Past 48h';
    case '7d': return 'Past 7d';
    default: return timeframe;
  }
}

function timeframeHours(timeframe: string): number {
  switch (timeframe) {
    case '1h': return 1;
    case '6h': return 6;
    case '24h': return 24;
    case '48h': return 48;
    case '7d': return 168;
    default: return 24;
  }
}


function pickScenario(order: PastProfitableOrder, mode: TakerOpportunityMode) {
  // In capped mode, always use the server-computed capped scenario when present.
  // (Orders below the cap have capped_volume == null and keep their full value.)
  // Orders that turn net-negative once capped are dropped by isProfitableInMode,
  // rather than misleadingly falling back to their full-size profit here.
  if (mode === 'net_capped' && order.analysis.capped_volume) {
    return order.analysis.capped_volume;
  }
  if (mode === 'net_min' && order.analysis.min_volume) {
    return order.analysis.min_volume;
  }
  return order.analysis.full_volume;
}

function isProfitableInMode(order: PastProfitableOrder, mode: TakerOpportunityMode): boolean {
	if (mode === 'net_capped' && order.analysis.capped_volume_executable === false) return false;
  return (pickScenario(order, mode).profit.avg_btc ?? 0) > 0;
}

function isDetailedOrder(order: DisplayOrder): order is PastProfitableOrder {
  return 'analysis' in order && 'offer' in order;
}

// Chart-visibility identity for a trades-list order. Uses the same key builder
// as the OHLC chart applies to the converted offer, so ticking a row's checkbox
// toggles exactly the overlay that pastProfitableOrderAsOffer produces.
function orderStableChartKey(order: DisplayOrder): string {
  return buildStableOfferKey({
    id: order.id,
    exchange: order.exchange,
    direction: order.direction,
    offer_id: order.offer_id ?? null,
  });
}

function orderDurationMinutes(order: DisplayOrder): number {
  if (order.status.duration) {
    return order.status.duration.hours * 60 + order.status.duration.minutes;
  }
  return durationMinutes(order.status.first_seen, order.status.last_seen);
}

function orderPremiumPercent(order: DisplayOrder): number | null {
  return order.pricing.avg_premium_percent ?? order.pricing.raw_premium_percent ?? null;
}

function orderScenarioSummary(order: DisplayOrder, mode: TakerOpportunityMode) {
  if (isDetailedOrder(order)) {
    const scenario = pickScenario(order, mode);
    return {
      tradeSizeBTC: scenario.trade_size_btc,
      tradeSizeFiat: scenario.trade_size_fiat,
      volumeUnit: volumeUnitOf(scenario.volume_denomination),
      profitBTC: scenario.profit.avg_btc ?? 0,
      profitFiat: scenario.profit.avg_fiat ?? 0,
      netPercent: scenario.premium.avg_net_percent ?? 0,
    };
  }
  return {
    tradeSizeBTC: order.summary.trade_size_btc,
    tradeSizeFiat: order.summary.trade_size_fiat,
    volumeUnit: volumeUnitOf(order.summary.volume_denomination),
    profitBTC: order.summary.net_profit_btc,
    profitFiat: order.summary.net_profit_fiat,
    netPercent: order.summary.net_percent,
  };
}

function displayOrderProfitable(order: DisplayOrder, mode: TakerOpportunityMode): boolean {
  if (isDetailedOrder(order)) {
    return isProfitableInMode(order, mode);
  }
  return mode === 'net_full' && order.summary.net_profit_btc > 0;
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

type SortColumn =
  | 'exchange'
  | 'direction'
  | 'premium'
  | 'payment_method'
  | 'first_seen'
  | 'last_seen'
  | 'duration'
  | 'size'
  | 'net_profit';

type SortDir = 'asc' | 'desc';

interface ActiveSortState {
  column: SortColumn;
  dir: SortDir;
}

// `null` means no header sorter is selected and preserves the API's default
// order for the filtered results.
type SortState = ActiveSortState | null;

// Direction a column starts with on first click: text columns A–Z, metrics newest/largest first.
const DEFAULT_SORT_DIR: Record<SortColumn, SortDir> = {
  exchange: 'asc',
  direction: 'asc',
  premium: 'desc',
  payment_method: 'asc',
  first_seen: 'desc',
  last_seen: 'desc',
  duration: 'desc',
  size: 'desc',
  net_profit: 'desc',
};

type NetProfitUnit = 'btc' | 'fiat';
type SizeUnit = 'btc' | 'fiat';

const INSIGHTS_FILTERS_STORAGE_KEY = 'dex-insights-filters';
const CUSTOM_TIMEFRAME = 'custom';

type InsightsViewMode = 'live' | 'past';

interface PersistedInsightsFilters {
  viewMode: InsightsViewMode;
  selectedTimeframe: string;
  customStartDate: string;
  customEndDate: string;
  directionFilter: DirectionFilter;
  disabledExchanges: string[];
  mode: TakerOpportunityMode;
  sortColumn: SortColumn | null;
  sortDir: SortDir | null;
  netProfitUnit: NetProfitUnit;
  sizeUnit: SizeUnit;
  summaryUnit: SizeUnit;
  durationMin: number | null;
  durationMax: number | null;
  profitRangeUnit: ProfitRangeUnit;
  profitFiatMin: number | null;
  profitFiatMax: number | null;
  profitPctMin: number | null;
  profitPctMax: number | null;
}

const DEFAULT_INSIGHTS_FILTERS: PersistedInsightsFilters = {
  viewMode: 'live',
  selectedTimeframe: '24h',
  customStartDate: '',
  customEndDate: '',
  directionFilter: 'both',
  disabledExchanges: [],
  mode: 'net_full',
  sortColumn: null,
  sortDir: null,
  netProfitUnit: 'fiat',
  sizeUnit: 'btc',
  summaryUnit: 'btc',
  durationMin: null,
  durationMax: null,
  profitRangeUnit: 'fiat',
  profitFiatMin: null,
  profitFiatMax: null,
  profitPctMin: null,
  profitPctMax: null,
};

const VALID_VIEW_MODES = new Set<InsightsViewMode>(['live', 'past']);
const VALID_TIMEFRAMES = new Set(['1h', '6h', '24h', '48h', '7d', CUSTOM_TIMEFRAME]);
const VALID_DIRECTIONS = new Set<DirectionFilter>(['both', 'bid', 'ask']);
const VALID_MODES = new Set<TakerOpportunityMode>(['net_full', 'net_capped', 'net_min']);
const VALID_NET_PROFIT_UNITS = new Set<NetProfitUnit>(['btc', 'fiat']);
const VALID_SIZE_UNITS = new Set<SizeUnit>(['btc', 'fiat']);
const VALID_PROFIT_RANGE_UNITS = new Set<ProfitRangeUnit>(['fiat', 'pct']);
const VALID_SORT_COLUMNS = new Set<SortColumn>([
  'exchange',
  'direction',
  'premium',
  'payment_method',
  'first_seen',
  'last_seen',
  'duration',
  'size',
  'net_profit',
]);
const VALID_SORT_DIRS = new Set<SortDir>(['asc', 'desc']);

// Migration for the retired sidebar sort dropdown persisted as `sortBy` before
// the column-header sorters landed. `net_pct_desc` has no table column and
// falls back to the unsorted default view.
const LEGACY_SORT_KEY_MAP: Record<string, ActiveSortState> = {
  last_seen_desc: { column: 'last_seen', dir: 'desc' },
  last_seen_asc: { column: 'last_seen', dir: 'asc' },
  net_profit_desc: { column: 'net_profit', dir: 'desc' },
  net_profit_asc: { column: 'net_profit', dir: 'asc' },
  volume_btc_desc: { column: 'size', dir: 'desc' },
  duration_desc: { column: 'duration', dir: 'desc' },
  payment_method_asc: { column: 'payment_method', dir: 'asc' },
  exchange_asc: { column: 'exchange', dir: 'asc' },
};

function readPersistedSort(parsed: Partial<PersistedInsightsFilters> & { sortBy?: string }): SortState {
  if (
    VALID_SORT_COLUMNS.has(parsed.sortColumn as SortColumn)
    && VALID_SORT_DIRS.has(parsed.sortDir as SortDir)
  ) {
    return { column: parsed.sortColumn as SortColumn, dir: parsed.sortDir as SortDir };
  }
  if (parsed.sortBy != null && LEGACY_SORT_KEY_MAP[parsed.sortBy]) {
    return LEGACY_SORT_KEY_MAP[parsed.sortBy];
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// Persisted bounds are clamped so corrupt/hand-edited localStorage values
// can't wedge the range sliders or the filter logic.
const PERSISTED_DURATION_BOUNDS = { min: 0, max: 1_000_000_000 };
const PERSISTED_PROFIT_BOUNDS = { min: -1_000_000_000, max: 1_000_000_000 };

function readNullableNumber(value: unknown, bounds: { min: number; max: number }): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function isDateInputValue(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
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

function readPersistedInsightsFilters(): PersistedInsightsFilters {
  try {
    const raw = localStorage.getItem(INSIGHTS_FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_INSIGHTS_FILTERS;
    const parsed = JSON.parse(raw) as Partial<PersistedInsightsFilters> & { sortBy?: string };
    const sort = readPersistedSort(parsed);
    return {
      viewMode: VALID_VIEW_MODES.has(parsed.viewMode as InsightsViewMode)
        ? parsed.viewMode as InsightsViewMode
        : DEFAULT_INSIGHTS_FILTERS.viewMode,
      selectedTimeframe: VALID_TIMEFRAMES.has(parsed.selectedTimeframe ?? '')
        ? parsed.selectedTimeframe!
        : DEFAULT_INSIGHTS_FILTERS.selectedTimeframe,
      customStartDate: isDateInputValue(parsed.customStartDate) ? parsed.customStartDate : '',
      customEndDate: isDateInputValue(parsed.customEndDate) ? parsed.customEndDate : '',
      directionFilter: VALID_DIRECTIONS.has(parsed.directionFilter as DirectionFilter)
        ? parsed.directionFilter as DirectionFilter
        : DEFAULT_INSIGHTS_FILTERS.directionFilter,
      disabledExchanges: readStringArray(parsed.disabledExchanges),
      mode: VALID_MODES.has(parsed.mode as TakerOpportunityMode)
        ? parsed.mode as TakerOpportunityMode
        : DEFAULT_INSIGHTS_FILTERS.mode,
      sortColumn: sort?.column ?? null,
      sortDir: sort?.dir ?? null,
      netProfitUnit: VALID_NET_PROFIT_UNITS.has(parsed.netProfitUnit as NetProfitUnit)
        ? parsed.netProfitUnit as NetProfitUnit
        : DEFAULT_INSIGHTS_FILTERS.netProfitUnit,
      sizeUnit: VALID_SIZE_UNITS.has(parsed.sizeUnit as SizeUnit)
        ? parsed.sizeUnit as SizeUnit
        : DEFAULT_INSIGHTS_FILTERS.sizeUnit,
      summaryUnit: VALID_SIZE_UNITS.has(parsed.summaryUnit as SizeUnit)
        ? parsed.summaryUnit as SizeUnit
        : DEFAULT_INSIGHTS_FILTERS.summaryUnit,
      durationMin: readNullableNumber(parsed.durationMin, PERSISTED_DURATION_BOUNDS),
      durationMax: readNullableNumber(parsed.durationMax, PERSISTED_DURATION_BOUNDS),
      profitRangeUnit: VALID_PROFIT_RANGE_UNITS.has(parsed.profitRangeUnit as ProfitRangeUnit)
        ? parsed.profitRangeUnit as ProfitRangeUnit
        : DEFAULT_INSIGHTS_FILTERS.profitRangeUnit,
      profitFiatMin: readNullableNumber(parsed.profitFiatMin, PERSISTED_PROFIT_BOUNDS),
      profitFiatMax: readNullableNumber(parsed.profitFiatMax, PERSISTED_PROFIT_BOUNDS),
      profitPctMin: readNullableNumber(parsed.profitPctMin, PERSISTED_PROFIT_BOUNDS),
      profitPctMax: readNullableNumber(parsed.profitPctMax, PERSISTED_PROFIT_BOUNDS),
    };
  } catch {
    return DEFAULT_INSIGHTS_FILTERS;
  }
}

function clampNumericRange(
  range: [number, number],
  bounds: { min: number; max: number },
): [number, number] {
  const lo = Math.max(bounds.min, Math.min(range[0], bounds.max));
  const hi = Math.max(bounds.min, Math.min(range[1], bounds.max));
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

function orderNetProfitFiat(order: DisplayOrder, mode: TakerOpportunityMode): number {
  return orderScenarioSummary(order, mode).profitFiat;
}

function orderNetPremiumPct(order: DisplayOrder, mode: TakerOpportunityMode): number {
  return orderScenarioSummary(order, mode).netPercent;
}

function profitFiatToCents(profit: number): number {
  return Math.round(profit * 100);
}

function profitFiatFromCents(cents: number): number {
  return cents / 100;
}

function profitPctToHundredths(pct: number): number {
  return Math.round(pct * 100);
}

function profitPctFromHundredths(hundredths: number): number {
  return hundredths / 100;
}

// Both profit metrics share one bounds shape: fiat amounts scaled to cents and
// net premium percentages scaled to hundredths of a percent.
interface ProfitMetricBounds {
  minScaled: number;
  maxScaled: number;
  sliderMaxScaled: number;
  hasData: boolean;
}

const NO_PROFIT_METRIC_BOUNDS: ProfitMetricBounds = {
  minScaled: 0,
  maxScaled: 0,
  sliderMaxScaled: 0,
  hasData: false,
};

function computeProfitMetricBounds(
  orders: DisplayOrder[],
  metricValue: (order: DisplayOrder) => number,
): ProfitMetricBounds {
  let min = Infinity;
  let max = -Infinity;
  for (const order of orders) {
    const value = metricValue(order);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return NO_PROFIT_METRIC_BOUNDS;
  }
  const minScaled = Math.floor(min * 100);
  const maxScaled = Math.ceil(max * 100);
  return {
    minScaled,
    maxScaled,
    sliderMaxScaled: minScaled === maxScaled ? maxScaled + 1 : maxScaled,
    hasData: true,
  };
}

function sortProfitableOrders(
  orders: DisplayOrder[],
  sort: SortState,
  mode: TakerOpportunityMode,
  netProfitUnit: NetProfitUnit,
  sizeUnit: SizeUnit,
): DisplayOrder[] {
  if (sort == null) return [...orders];
  // Each comparator sorts ascending; the sign flip below applies the direction.
  const compare = (a: DisplayOrder, b: DisplayOrder): number => {
    switch (sort.column) {
      case 'exchange':
        return a.exchange.localeCompare(b.exchange, 'de');
      case 'direction':
        return a.direction.localeCompare(b.direction, 'de');
      case 'premium':
        return (orderPremiumPercent(a) ?? 0) - (orderPremiumPercent(b) ?? 0);
      case 'payment_method':
        return (a.payment_methods?.join(', ') ?? '').localeCompare(b.payment_methods?.join(', ') ?? '', 'de');
      case 'first_seen': {
        const ta = parseUtcTimestamp(a.status.first_seen)?.getTime() ?? 0;
        const tb = parseUtcTimestamp(b.status.first_seen)?.getTime() ?? 0;
        return ta - tb;
      }
      case 'last_seen': {
        const ta = parseUtcTimestamp(a.status.last_seen)?.getTime() ?? 0;
        const tb = parseUtcTimestamp(b.status.last_seen)?.getTime() ?? 0;
        return ta - tb;
      }
      case 'duration':
        return orderDurationMinutes(a) - orderDurationMinutes(b);
      case 'size': {
        const scenarioA = orderScenarioSummary(a, mode);
        const scenarioB = orderScenarioSummary(b, mode);
        const va = sizeUnit === 'btc' ? scenarioA.tradeSizeBTC : scenarioA.tradeSizeFiat;
        const vb = sizeUnit === 'btc' ? scenarioB.tradeSizeBTC : scenarioB.tradeSizeFiat;
        return (va ?? 0) - (vb ?? 0);
      }
      case 'net_profit': {
        const scenarioA = orderScenarioSummary(a, mode);
        const scenarioB = orderScenarioSummary(b, mode);
        const va = netProfitUnit === 'btc' ? scenarioA.profitBTC : scenarioA.profitFiat;
        const vb = netProfitUnit === 'btc' ? scenarioB.profitBTC : scenarioB.profitFiat;
        return (va ?? 0) - (vb ?? 0);
      }
      default:
        return 0;
    }
  };
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...orders].sort((a, b) => sign * compare(a, b));
}

interface FilteredSummary {
  premium_order_count: number;
  total_net_profit_btc: number;
  total_net_profit_fiat: number;
  average_order_size_btc: number;
  average_order_size_fiat: number;
  smallest_order_size_btc: number | null;
  smallest_order_size_fiat: number | null;
  biggest_order_size_btc: number | null;
  biggest_order_size_fiat: number | null;
}

function computeFilteredSummary(orders: DisplayOrder[], mode: TakerOpportunityMode): FilteredSummary {
  if (orders.length === 0) {
    return {
      premium_order_count: 0,
      total_net_profit_btc: 0,
      total_net_profit_fiat: 0,
      average_order_size_btc: 0,
      average_order_size_fiat: 0,
      smallest_order_size_btc: null,
      smallest_order_size_fiat: null,
      biggest_order_size_btc: null,
      biggest_order_size_fiat: null,
    };
  }

  let totalProfitBtc = 0;
  let totalProfitFiat = 0;
  let totalSizeBtc = 0;
  let totalSizeFiat = 0;
  let smallestBtc = Infinity;
  let smallestFiat = 0;
  let biggestBtc = -Infinity;
  let biggestFiat = 0;

  for (const order of orders) {
    const scenario = orderScenarioSummary(order, mode);
    const profitBtc = scenario.profitBTC;
    const profitFiat = scenario.profitFiat;
    const sizeBtc = scenario.tradeSizeBTC;
    const sizeFiat = scenario.tradeSizeFiat;
    totalProfitBtc += profitBtc;
    totalProfitFiat += profitFiat;
    totalSizeBtc += sizeBtc;
    totalSizeFiat += sizeFiat;
    if (sizeBtc < smallestBtc) {
      smallestBtc = sizeBtc;
      smallestFiat = sizeFiat;
    }
    if (sizeBtc > biggestBtc) {
      biggestBtc = sizeBtc;
      biggestFiat = sizeFiat;
    }
  }

  return {
    premium_order_count: orders.length,
    total_net_profit_btc: totalProfitBtc,
    total_net_profit_fiat: totalProfitFiat,
    average_order_size_btc: totalSizeBtc / orders.length,
    average_order_size_fiat: totalSizeFiat / orders.length,
    smallest_order_size_btc: smallestBtc === Infinity ? null : smallestBtc,
    smallest_order_size_fiat: smallestBtc === Infinity ? null : smallestFiat,
    biggest_order_size_btc: biggestBtc === -Infinity ? null : biggestBtc,
    biggest_order_size_fiat: biggestBtc === -Infinity ? null : biggestFiat,
  };
}

const PROFITABLE_TRADES_GRID_COLS =
  'grid min-w-[40rem] grid-cols-[minmax(7rem,0.85fr)_minmax(2.75rem,0.3fr)_minmax(4rem,0.45fr)_minmax(8rem,1fr)_minmax(5.5rem,0.75fr)_minmax(6.75rem,0.95fr)_1.25rem_1.25rem] items-center gap-2 sm:min-w-[48rem] sm:grid-cols-[minmax(7rem,0.75fr)_minmax(2.75rem,0.3fr)_minmax(4rem,0.4fr)_minmax(8rem,1fr)_minmax(5.25rem,0.6fr)_minmax(5.75rem,0.75fr)_minmax(6.5rem,0.85fr)_1.25rem_1.25rem] lg:min-w-0 lg:w-full lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.28fr)_minmax(0,0.42fr)_minmax(0,0.85fr)_minmax(0,0.65fr)_minmax(0,0.65fr)_minmax(0,0.55fr)_minmax(0,0.95fr)_minmax(0,1.15fr)_1.25rem_1.25rem] sm:gap-3';

interface TradeRowMetricProps {
  value: string;
  valueClassName?: string;
  className?: string;
  title?: string;
}

function TradeRowMetric({ value, valueClassName = 'text-text', className = '', title }: TradeRowMetricProps) {
  return (
    <span className={`block min-w-0 truncate text-left mono-nums tabular-nums ${valueClassName} ${className}`} title={title ?? value}>
      {value}
    </span>
  );
}

function UnitToggle({ fiat, unit, onChange }: { fiat: string; unit: SizeUnit; onChange: (unit: SizeUnit) => void }) {
  return (
    <SegmentedToggle
      options={[{ value: 'btc', label: 'BTC' }, { value: 'fiat', label: fiat }]}
      value={unit}
      onChange={onChange}
    />
  );
}

function SortHeaderButton<T extends string>({ label, column, sort, onSort, align = 'left', fitContent = false }: {
  label: string;
  column: T;
  sort: { column: T; dir: SortDir } | null;
  onSort: (column: T) => void;
  align?: 'left' | 'right';
  fitContent?: boolean;
}) {
  const active = sort?.column === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`flex min-w-0 items-center gap-1 border-none bg-transparent p-0 text-[0.65rem] font-semibold uppercase tracking-wide transition-colors ${fitContent ? 'w-fit shrink-0' : 'w-full'} ${align === 'right' ? 'justify-end text-right' : 'justify-start text-left'} ${active ? 'text-accent' : 'text-muted hover:text-text'}`}
    >
	  {align === 'right' && (
		<span className={`shrink-0 text-[0.55rem] leading-none ${active ? '' : 'opacity-50'}`} aria-hidden>
		  {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
		</span>
	  )}
      <span className="truncate">{label}</span>
	  {align === 'left' && (
		<span className={`shrink-0 text-[0.55rem] leading-none ${active ? '' : 'opacity-50'}`} aria-hidden>
		  {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
		</span>
	  )}
    </button>
  );
}

function ProfitableTradesHeader({ fiat, sizeUnit, onSizeUnitChange, netProfitUnit, onNetProfitUnitChange, sort, onSort, showChartColumn, allChartVisible, someChartVisible, onToggleAllChartVisible }: {
  fiat: string;
  sizeUnit: SizeUnit;
  onSizeUnitChange: (unit: SizeUnit) => void;
  netProfitUnit: NetProfitUnit;
  onNetProfitUnitChange: (unit: NetProfitUnit) => void;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  showChartColumn: boolean;
  allChartVisible: boolean;
  someChartVisible: boolean;
  onToggleAllChartVisible: (visible: boolean) => void;
}) {
  const th = 'truncate text-[0.65rem] font-semibold uppercase tracking-wide text-muted';
  return (
    <div data-testid="past-offers-header" className={`${PROFITABLE_TRADES_GRID_COLS} sticky top-0 z-20 shrink-0 border-b border-border bg-surface/95 px-3 py-1.5`}>
      <SortHeaderButton label="Offer" column="exchange" sort={sort} onSort={onSort} align="left" />
      <SortHeaderButton label="Dir" column="direction" sort={sort} onSort={onSort} align="left" />
      <SortHeaderButton label="Premium" column="premium" sort={sort} onSort={onSort} align="left" />
      <SortHeaderButton label="Payment method" column="payment_method" sort={sort} onSort={onSort} align="left" />
      <span className="hidden lg:flex">
		<SortHeaderButton label="First seen" column="first_seen" sort={sort} onSort={onSort} />
      </span>
      <span className="hidden lg:flex">
		<SortHeaderButton label="Last seen" column="last_seen" sort={sort} onSort={onSort} />
      </span>
      <span className="hidden sm:flex lg:hidden">
        <SortHeaderButton label="Duration" column="duration" sort={sort} onSort={onSort} />
      </span>
      <span className="hidden lg:flex">
        <SortHeaderButton label="Duration" column="duration" sort={sort} onSort={onSort} />
      </span>
      <span className={`${th} hidden items-center justify-start gap-1 sm:flex lg:hidden`}>
		<SortHeaderButton label="Volume" column="size" sort={sort} onSort={onSort} fitContent />
		<UnitToggle fiat={fiat} unit={sizeUnit} onChange={onSizeUnitChange} />
      </span>
      <span className={`${th} hidden items-center justify-start gap-1 sm:flex lg:hidden`}>
		<SortHeaderButton label="Net profit" column="net_profit" sort={sort} onSort={onSort} fitContent />
		<UnitToggle fiat={fiat} unit={netProfitUnit} onChange={onNetProfitUnitChange} />
      </span>
      <span className={`${th} flex items-center justify-start gap-1 sm:hidden`}>
        <SortHeaderButton label="Volume" column="size" sort={sort} onSort={onSort} />
      </span>
      <span className={`${th} flex items-center justify-start gap-1 sm:hidden`}>
        <SortHeaderButton label="Profit" column="net_profit" sort={sort} onSort={onSort} />
      </span>
      <span className={`${th} hidden items-center justify-start gap-1 lg:flex`}>
		<SortHeaderButton label="Volume" column="size" sort={sort} onSort={onSort} fitContent />
		<UnitToggle fiat={fiat} unit={sizeUnit} onChange={onSizeUnitChange} />
      </span>
      <span className={`${th} hidden items-center justify-start gap-1 lg:flex`}>
		<SortHeaderButton label="Net profit" column="net_profit" sort={sort} onSort={onSort} fitContent />
		<UnitToggle fiat={fiat} unit={netProfitUnit} onChange={onNetProfitUnitChange} />
      </span>
      <span className="flex shrink-0 items-center justify-center">
        {showChartColumn && (
          <input
            type="checkbox"
            checked={allChartVisible}
            ref={el => { if (el) el.indeterminate = someChartVisible; }}
            onChange={e => onToggleAllChartVisible(e.target.checked)}
            title="Show/hide all orders on the OHLC chart"
          />
        )}
      </span>
      <span className="shrink-0" aria-hidden />
    </div>
  );
}

function offerNumber(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatRange(minLabel: string, maxLabel: string): string | null {
  if (minLabel === '—' && maxLabel === '—') return null;
  if (minLabel !== '—' && maxLabel !== '—') {
    return minLabel === maxLabel ? minLabel : `${minLabel} – ${maxLabel}`;
  }
  if (minLabel !== '—') return `from ${minLabel}`;
  return `up to ${maxLabel}`;
}

function offerPriceDetail(refPrice: number | null, premiumPct: number | null, fiat: string): string | undefined {
  if (refPrice == null) return undefined;
  const premium = premiumPct != null && Number.isFinite(premiumPct)
    ? ` · ${premiumPct > 0 ? '+' : ''}${premiumPct.toFixed(2)}% vs ref`
    : '';
  return `ref ${fmtFiat(refPrice, fiat)}${premium}`;
}

function PastOfferOverview({ order, offer, fiat, timezone, amountUnit }: {
  order: PastProfitableOrder;
  offer: Offer;
  fiat: string;
  timezone: string;
  amountUnit: SizeUnit;
}) {
  const raw = order.offer;
  const offerPrice = getOfferPrice(offer);
  const refPrice = getRefPrice(offer)
    ?? order.pricing.avg_ref_price
    ?? offerNumber(raw, 'avg_ref_price');
  const fiatMin = getFiatMin(offer);
  const fiatMax = getFiatMax(offer);
  const avgObservedBtc = offerNumber(raw, 'avg_btc_amount');
  const fiatRange = formatRange(fmtFiat(fiatMin, fiat), fmtFiat(fiatMax, fiat));
  const btcRange = formatRange(fmtBTC(getBtcMin(offer)), fmtBTC(getBtcMax(offer)));
  const firstSeen = getFirstSeen(offer);
  const lastSeen = getLastSeen(offer);
  const exactUnit = getVolumeUnit(offer);
  const volumeRange = markConvertedRange(amountUnit === 'btc' ? btcRange : fiatRange, amountUnit, exactUnit);
  // A fixed volume has no lifetime average worth showing; only the converted
  // side moved with the price.
  const showAverage = exactUnit == null || exactUnit !== amountUnit;
  const averageVolume = avgObservedBtc == null || !showAverage
    ? null
    : amountUnit === 'btc'
      ? fmtBTC(avgObservedBtc)
      : fmtFiat(refPrice == null ? null : avgObservedBtc * refPrice, fiat);

  return (
      <DetailFacts>
        <DetailFact label="Payment" value={order.payment_methods?.join(', ') || '—'} mono={false} />
        <DetailFact
          label="Observed"
          value={`${formatTime(firstSeen, timezone)} – ${formatTime(lastSeen, timezone)}`}
          detail={`${formatDuration(firstSeen, lastSeen)}${getPriceType(offer) ? ` · ${getPriceType(offer)} price` : ''}`}
        />
        {(offerPrice > 0 || refPrice != null) && (
          <DetailFact
            label="Offer price"
            value={offerPrice > 0 ? fmtFiat(offerPrice, fiat) : '—'}
            detail={offerPriceDetail(refPrice, getRawPremiumPercent(offer), fiat)}
          />
        )}
        {volumeRange != null && (
          <DetailFact
            label="Volume"
            value={volumeRange}
            detail={averageVolume != null ? `${averageVolume} average` : undefined}
            hint={exactUnit == null || exactUnit === amountUnit
              ? 'Offered range and lifecycle average while the offer was live'
              : `Converted at the offer's average price; the maker fixed this volume in ${exactUnit === 'btc' ? 'BTC' : fiat}`}
          />
        )}
      </DetailFacts>
  );
}

function PastOrderBreakdown({ order, scenarioMode, onScenarioModeChange }: {
  order: PastProfitableOrder;
  scenarioMode: SizeMode;
  onScenarioModeChange: (value: SizeMode) => void;
}) {
  const { timezone } = useTimezone();
  const [amountUnit, setAmountUnit] = useState<SizeUnit>('fiat');
  const offer = pastProfitableOrderAsOffer(order);
  const refPrice = getRefPrice(offer);
  // The control-panel mode can request the capped view for an offer that has no
  // capped scenario (e.g. it sits below the cap); fall back to the full breakdown.
  const effectiveMode: SizeMode = scenarioMode === 'capped' && !hasCappedScenario(offer)
    ? 'full'
    : scenarioMode === 'min' && !hasMinScenario(offer)
      ? 'full'
      : scenarioMode;
  const costBreakdown = getDisplayCostBreakdown(offer, effectiveMode);
  const offerPrice = getOfferPrice(offer);
  const scenario = effectiveMode === 'capped'
    ? order.analysis.capped_volume
    : effectiveMode === 'min'
      ? order.analysis.min_volume
      : order.analysis.full_volume;
  const snapshotBasis = order.observation_count != null && order.observation_count > 0
    ? ` Based on ${order.observation_count.toLocaleString('de-DE')} snapshots from the observed lifecycle.`
    : '';
  const snapshotLabel = order.observation_count != null && order.observation_count > 0
    ? ` · ${order.observation_count.toLocaleString('de-DE')} snapshots`
    : '';
  const estimateContext = scenario?.cost_policy === 'historical_route_fixed_transfer_recomputed_size_proportional'
    ? { label: `Capped-size estimate${snapshotLabel}`, detail: `Uses the historical route and recalculates size-dependent costs.${snapshotBasis}` }
    : scenario?.cost_policy === 'historical_min_volume'
      ? { label: `Minimum-size estimate${snapshotLabel}`, detail: `Uses the offer’s minimum executable volume and historical route.${snapshotBasis}` }
      : scenario?.cost_policy === 'historical_persisted'
        ? { label: `Historical average${snapshotLabel}`, detail: `Pricing, costs, and profit use the offer’s observed lifecycle snapshots.${snapshotBasis}` }
        : { label: `Historical offer${snapshotLabel}`, detail: snapshotBasis.trim() || null };

  return (
    <div data-testid="past-offer-detail" className="flex flex-col gap-3">
      {costBreakdown ? (
        <div className="flex flex-col gap-3">
          <CostBreakdownPanel
            bd={costBreakdown}
            abortCost={getDisplayAbortCost(offer, effectiveMode)}
            priceDiffPct={getRawPremiumPercent(offer)}
            netPremiumPct={getNetPremiumPercent(offer, effectiveMode)}
            refPrice={refPrice}
            offerPrice={offerPrice}
            toolbar={(hasCappedScenario(offer) || hasMinScenario(offer)) ? (
              <SizeToggle
                mode={effectiveMode}
                onModeChange={onScenarioModeChange}
                fullBtc={getDisplayCostBreakdown(offer, 'full')?.btc_amount ?? getBtcMax(offer)}
                cappedBtc={getCappedTradeSizeBtc(offer)}
                minBtc={getMinTradeSizeBtc(offer)}
                refPrice={refPrice}
              />
            ) : undefined}
            overview={<PastOfferOverview
              order={order}
              offer={offer}
              fiat={order.pricing.fiat_currency || 'EUR'}
              timezone={timezone}
              amountUnit={amountUnit}
            />}
            contextLabel={estimateContext.label}
            contextDetail={estimateContext.detail}
            contextId={order.id}
            amountUnit={amountUnit}
            onAmountUnitChange={setAmountUnit}
            offer={offer}
          />
        </div>
      ) : (
        <>
          <section aria-label="Offer information" className="@container flex flex-col gap-3">
            <div className="border-b border-border/70 pb-2 text-[0.63rem] font-medium text-text">
              Historical offer <span className="text-muted">· ID {order.id}</span>
            </div>
            <PastOfferOverview
              order={order}
              offer={offer}
              fiat={order.pricing.fiat_currency || 'EUR'}
              timezone={timezone}
              amountUnit={amountUnit}
            />
          </section>
          <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
        </>
      )}
    </div>
  );
}

const LIVE_OFFERS_GRID_COLS =
  'grid min-w-[50rem] grid-cols-[minmax(7rem,0.85fr)_minmax(2.75rem,0.3fr)_minmax(4rem,0.45fr)_minmax(8rem,1fr)_minmax(5.25rem,0.6fr)_minmax(4rem,0.45fr)_minmax(4.25rem,0.5fr)_minmax(5.75rem,0.75fr)_minmax(5.75rem,0.75fr)_minmax(6.5rem,0.85fr)_1.25rem_1.25rem] items-center gap-2 sm:min-w-[64rem] sm:grid-cols-[minmax(7rem,0.75fr)_minmax(2.75rem,0.3fr)_minmax(4rem,0.4fr)_minmax(8rem,1fr)_minmax(5.25rem,0.6fr)_minmax(4rem,0.45fr)_minmax(4.25rem,0.5fr)_minmax(5.75rem,0.75fr)_minmax(5.75rem,0.75fr)_minmax(6.5rem,0.85fr)_1.25rem_1.25rem] lg:min-w-0 lg:w-full lg:grid-cols-[minmax(0,0.5fr)_minmax(0,0.26fr)_minmax(0,0.38fr)_minmax(0,0.75fr)_minmax(0,0.62fr)_minmax(0,0.42fr)_minmax(0,0.42fr)_minmax(0,0.5fr)_minmax(0,0.72fr)_minmax(0,0.9fr)_1.25rem_1.25rem] sm:gap-3';

type LiveSortColumn = 'exchange' | 'direction' | 'premium' | 'payment_method' | 'first_seen' | 'age' | 'size' | 'net_profit';

const LIVE_SORT_DEFAULTS: Record<LiveSortColumn, SortDir> = {
  exchange: 'asc', direction: 'asc', premium: 'desc', payment_method: 'asc',
  first_seen: 'desc', age: 'desc', size: 'desc', net_profit: 'desc',
};

function LiveOfferOverview({ offer, fiat, amountUnit }: {
  offer: Offer;
  fiat: string;
  amountUnit: SizeUnit;
}) {
  const offerPrice = getOfferPrice(offer);
  const refPrice = getRefPrice(offer);
  const fiatRange = formatRange(fmtFiat(getFiatMin(offer), fiat), fmtFiat(getFiatMax(offer), fiat));
  const btcRange = formatRange(fmtBTC(getBtcMin(offer)), fmtBTC(getBtcMax(offer)));
  const liveExactUnit = getVolumeUnit(offer);
  const liveVolumeRange = markConvertedRange(amountUnit === 'btc' ? btcRange : fiatRange, amountUnit, liveExactUnit);

  return (
      <DetailFacts>
        <DetailFact label="Payment" value={offer.payment_methods?.join(', ') || '—'} mono={false} />
        {(offerPrice > 0 || refPrice != null) && (
          <DetailFact
            label="Offer price"
            value={offerPrice > 0 ? fmtFiat(offerPrice, fiat) : '—'}
            detail={offerPriceDetail(refPrice, getRawPremiumPercent(offer), fiat)}
          />
        )}
        {liveVolumeRange != null && (
          <DetailFact
            label="Volume"
            value={liveVolumeRange}
            hint={liveExactUnit == null || liveExactUnit === amountUnit
              ? 'Offer volume limits'
              : `Converted at the current price; the maker fixed this volume in ${liveExactUnit === 'btc' ? 'BTC' : fiat}`}
          />
        )}
      </DetailFacts>
  );
}

function TradeModeToggle({ mode, onChange, hasHedgeless, hedgefullAvailable = true }: {
  mode: TradeMode;
  onChange: (mode: TradeMode) => void;
  hasHedgeless: boolean;
  /** When false, hedgefull stays visible but disabled so operators see why Hedgeless is selected. */
  hedgefullAvailable?: boolean;
}) {
  if (!hasHedgeless) return null;
  const btn = (value: TradeMode, label: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={mode === value}
      disabled={disabled}
      title={disabled ? 'No hedge (futures) venue is available' : undefined}
      onClick={() => onChange(value)}
      className={`whitespace-nowrap rounded px-2 py-0.5 text-[0.66rem] transition-colors ${
        disabled
          ? 'cursor-not-allowed text-muted/50'
          : mode === value
            ? 'bg-accent/15 text-accent font-semibold'
            : 'font-medium text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[0.66rem] font-medium text-muted">Mode</span>
      <span role="group" aria-label="Trade mode" className="inline-flex items-center rounded-md border border-border bg-bg p-0.5">
        {btn('hedgefull_single_collateral', 'Hedgefull', !hedgefullAvailable)}
        {btn('hedgeless_double_collateral', 'Hedgeless')}
      </span>
    </div>
  );
}

function ManualRouteControls({ options, selection, onChange, isAsk, hideHedge = false }: {
  options: ManualRouteOptions;
  selection: ManualRouteSelection;
  onChange: (selection: ManualRouteSelection) => void;
  isAsk: boolean;
  hideHedge?: boolean;
}) {
  const selectClass = 'min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.68rem] leading-snug text-muted">
        Overrides apply to this estimate and the pre-trade checks; live ranking keeps the automatic route.
      </p>
      <div className="grid gap-3 @2xl:grid-cols-2">
        <label className="grid gap-1 text-[0.66rem] font-medium text-muted">Spot CEX{isAsk ? '' : ' + withdrawal'}
          <select className={selectClass} value={selection.spot} onChange={event => onChange({ ...selection, spot: event.target.value })}>
            <option value="auto">Auto (cheapest)</option>
            {(options.spot_taker_fees ?? []).map(option => {
              const withdrawal = (options.withdrawal_fees ?? []).find(item => item.exchange === option.exchange);
              const detail = !isAsk && withdrawal ? ` · withdraw ${withdrawal.fee_btc.toFixed(8)} BTC` : '';
              return <option key={option.exchange} value={option.exchange} disabled={option.disabled}>{option.exchange} · taker {option.fee_pct.toFixed(4)}%{detail}{option.disabled ? ' (excluded)' : ''}</option>;
            })}
          </select>
        </label>
        {!hideHedge && (
          <label className="grid gap-1 text-[0.66rem] font-medium text-muted">Hedge
            <select className={selectClass} value={selection.hedge} onChange={event => onChange({ ...selection, hedge: event.target.value })}>
              <option value="auto">Auto (cheapest)</option>
              {(options.hedge_costs ?? []).map(option => <option key={option.hedge.venue} value={option.hedge.venue} disabled={option.disabled}>{option.hedge.venue} · {option.hedge.fee_sum_pct.toFixed(4)}%{option.disabled ? ' (excluded)' : ''}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function LiveOfferBreakdown({ offer, fiat, scenarioMode, onScenarioModeChange, tradeMode, onTradeModeChange, manualSelection, onManualSelectionChange }: {
  offer: Offer;
  fiat: string;
  scenarioMode: SizeMode;
  onScenarioModeChange: (value: SizeMode) => void;
  tradeMode: TradeMode;
  onTradeModeChange: (mode: TradeMode) => void;
  manualSelection: ManualRouteSelection;
  onManualSelectionChange: (selection: ManualRouteSelection) => void;
}) {
  const [amountUnit, setAmountUnit] = useState<SizeUnit>('fiat');
  const { exchanges } = useCEXPermissions();
  const hedgeAvailable = hasEffectiveHedgeVenue(exchanges);
  const { breakdown: displayedBreakdown, abortCost: displayedAbortCost, effectiveMode } = resolveTradeBreakdown(
    offer,
    scenarioMode,
    tradeMode,
    manualSelection,
  );
  const scenario = effectiveMode === 'capped' ? offer.analysis?.capped_volume : effectiveMode === 'min' ? offer.analysis?.min_volume : offer.analysis?.full_volume;
  const hedgelessVariant = scenario?.hedgeless_double_collateral ?? null;
  const options = scenario?.manual_route_options;
  const rawPremium = getRawPremiumPercent(offer);
  const displayedNetPremium: number | null = displayedBreakdown
    ? displayedBreakdown.estimated_profit_pct
    : getNetPremiumPercent(offer, effectiveMode);
  const routeUnavailable = shouldExplainMissingRoute(rawPremium, displayedBreakdown)
    ? explainMissingTradeRoute(exchanges, offer.metadata?.route_resolution)
    : null;
  const showTradeModeToggle = !!hedgelessVariant || !hedgeAvailable;
  const dexLink = getDexOfferLink(offer);
  // Bisq 1 / Bisq 2 are local GUI apps with no web offer pages, so instead
  // of a deep link the user gets the offer id to find it in the local app.
  const bisqOfferId = copyableOfferId(offer.exchange, offer.offer_id);
  const offerActions = (dexLink || bisqOfferId) ? (
    <>
      {dexLink && (
        <a
          href={dexLink.url}
          target="_blank"
          rel="noopener noreferrer"
          title={dexLink.title}
          data-testid="view-on-dex"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[0.66rem] font-semibold text-accent transition-colors hover:bg-accent/10 hover:underline"
        >
          {dexLink.label} <span aria-hidden="true">↗</span>
        </a>
      )}
      {bisqOfferId && <CopyOfferIdButton offerId={bisqOfferId} />}
    </>
  ) : undefined;

  return (
    <div data-testid="live-offer-detail" className="flex flex-col gap-3">
      {displayedBreakdown ? (
        <div className="flex flex-col gap-3">
          <CostBreakdownPanel
            bd={displayedBreakdown}
            abortCost={displayedAbortCost}
            priceDiffPct={rawPremium}
            netPremiumPct={displayedNetPremium}
            refPrice={getRefPrice(offer)}
            offerPrice={getOfferPrice(offer)}
            costsUnavailable={!!routeUnavailable}
            showCapitalAndAbort={!routeUnavailable}
            toolbar={(hasCappedScenario(offer) || hasMinScenario(offer)) ? (
              <SizeToggle
                mode={effectiveMode}
                onModeChange={onScenarioModeChange}
                fullBtc={getDisplayCostBreakdown(offer, 'full')?.btc_amount ?? getBtcMax(offer)}
                cappedBtc={getCappedTradeSizeBtc(offer)}
                minBtc={getMinTradeSizeBtc(offer)}
                refPrice={getRefPrice(offer)}
              />
            ) : undefined}
            tradeModeToggle={
              <TradeModeToggle
                mode={tradeMode}
                onChange={onTradeModeChange}
                hasHedgeless={showTradeModeToggle}
                hedgefullAvailable={hedgeAvailable}
              />
            }
            overview={<LiveOfferOverview offer={offer} fiat={fiat} amountUnit={amountUnit} />}
            contextLabel="Live offer"
            contextId={offer.offer_id || offer.id}
            offerActions={offerActions}
            routeControls={options ? (
              <ManualRouteControls
                options={options}
                selection={manualSelection}
                onChange={onManualSelectionChange}
                isAsk={displayedBreakdown.trade_direction === 'ask'}
                hideHedge={tradeMode === 'hedgeless_double_collateral'}
              />
            ) : undefined}
            routeNotice={routeUnavailable ? (
              <div
                role="status"
                data-testid="route-unavailable-notice"
                className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2"
              >
                <p className="text-[0.7rem] font-semibold text-amber-600">{routeUnavailable.title}</p>
                <p className="mt-0.5 text-[0.65rem] leading-snug text-muted">{routeUnavailable.detail}</p>
              </div>
            ) : undefined}
            amountUnit={amountUnit}
            onAmountUnitChange={setAmountUnit}
            offer={offer}
          />
        </div>
      ) : (
        <>
          <section aria-label="Offer information" className="@container flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-2 text-[0.63rem] font-medium text-text">
              <span>Live offer <span className="text-muted">· ID {offer.offer_id || offer.id}</span></span>
              {offerActions}
            </div>
            <LiveOfferOverview offer={offer} fiat={fiat} amountUnit={amountUnit} />
          </section>
          <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
        </>
      )}
    </div>
  );
}

function LiveOffersList({ offers, observedLiveCount, fiat, timezone, loading, chartEnabled, isChartOfferVisible, toggleChartOfferKey, setChartOfferKeysVisible, onSelectOffer, onCloseOffer, tradeMode, onTradeModeChange, scenarioMode, onScenarioModeChange, manualSelection, onManualSelectionChange }: {
  offers: Offer[];
  observedLiveCount: number;
  fiat: string;
  timezone: string;
  loading: boolean;
  chartEnabled: boolean;
  isChartOfferVisible: (key: string) => boolean;
  toggleChartOfferKey: (key: string) => void;
  setChartOfferKeysVisible: (keys: string[], visible: boolean) => void;
  onSelectOffer: (offer: Offer) => void;
  onCloseOffer: () => void;
  tradeMode: TradeMode;
  onTradeModeChange: (mode: TradeMode) => void;
  scenarioMode: SizeMode;
  onScenarioModeChange: (mode: SizeMode) => void;
  manualSelection: ManualRouteSelection;
  onManualSelectionChange: (selection: ManualRouteSelection) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>('btc');
  const [netProfitUnit, setNetProfitUnit] = useState<NetProfitUnit>('fiat');
  const [sort, setSort] = useState<{ column: LiveSortColumn; dir: SortDir } | null>(null);
  const [sortReferenceNow] = useState(() => Date.now());
  const sortedOffers = useMemo(() => {
    if (sort == null) return offers;
    const age = (offer: Offer) => sortReferenceNow - (parseUtcTimestamp(getFirstSeen(offer))?.getTime() ?? sortReferenceNow);
    const value = (offer: Offer): string | number => {
      switch (sort.column) {
        case 'exchange': return offer.exchange;
        case 'direction': return offer.direction;
        case 'premium': return getRawPremiumPercent(offer) ?? 0;
        case 'payment_method': return offer.payment_methods?.join(', ') ?? '';
        case 'first_seen': return parseUtcTimestamp(getFirstSeen(offer))?.getTime() ?? 0;
        case 'age': return age(offer);
        case 'size': return getTradeSizeBtc(offer, scenarioMode) ?? 0;
        case 'net_profit': {
          const priced = resolveTradeBreakdown(offer, scenarioMode, tradeMode, manualSelection).breakdown;
          if (priced) {
            return netProfitUnit === 'btc'
              ? priced.estimated_profit_btc
              : (getRefPrice(offer) != null ? priced.estimated_profit_btc * (getRefPrice(offer) as number) : 0);
          }
          return netProfitUnit === 'btc' ? getEstimatedProfitBtc(offer, scenarioMode) ?? 0 : getEstimatedProfitFiat(offer, scenarioMode) ?? 0;
        }
      }
    };
    const sign = sort.dir === 'desc' ? -1 : 1;
    return [...offers].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      return typeof av === 'string' && typeof bv === 'string' ? sign * av.localeCompare(bv, 'de') : sign * (Number(av) - Number(bv));
    });
  }, [offers, sort, scenarioMode, tradeMode, manualSelection, netProfitUnit, sortReferenceNow]);
  const stableKeys = useMemo(() => sortedOffers.map(buildStableOfferKey), [sortedOffers]);
  const expandedIndex = expandedKey == null ? -1 : stableKeys.indexOf(expandedKey);
  const expandedOffer = expandedIndex >= 0 ? sortedOffers[expandedIndex] : null;
  const visibleCount = stableKeys.filter(isChartOfferVisible).length;
  const allChartVisible = sortedOffers.length > 0 && visibleCount === sortedOffers.length;
  const someChartVisible = visibleCount > 0 && visibleCount < sortedOffers.length;

  const handleSort = (column: LiveSortColumn) => {
    setSort(previous => {
      if (previous?.column !== column) return { column, dir: LIVE_SORT_DEFAULTS[column] };
      if (previous.dir === LIVE_SORT_DEFAULTS[column]) return { column, dir: previous.dir === 'asc' ? 'desc' : 'asc' };
      return null;
    });
  };

  useEffect(() => {
    // The selected row can disappear when live filters change; clear the stale
    // local key so it cannot reopen if that offer later re-enters the list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (expandedKey != null && expandedOffer == null) setExpandedKey(null);
  }, [expandedKey, expandedOffer]);

  if (expandedOffer != null) {
    return (
      <div className="relative min-h-0 flex-1 overflow-y-auto bg-surface">
        <button
          type="button"
          aria-label="Close live offer details"
          onClick={() => { setExpandedKey(null); onCloseOffer(); }}
          className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded border-none bg-transparent text-xl leading-none text-red transition-colors hover:bg-red/10 hover:text-red/70"
          title="Close"
        >
          ×
        </button>
        <div className="px-3 py-2.5">
          <LiveOfferBreakdown
            offer={expandedOffer}
            fiat={fiat}
            scenarioMode={scenarioMode}
            onScenarioModeChange={onScenarioModeChange}
            tradeMode={tradeMode}
            onTradeModeChange={onTradeModeChange}
            manualSelection={manualSelection}
            onManualSelectionChange={onManualSelectionChange}
          />
        </div>
      </div>
    );
  }

  const headerClass = 'truncate text-[0.65rem] font-semibold uppercase tracking-wide text-muted';
  const captureLabel = observedLiveCount === offers.length
    ? `${observedLiveCount} live on DEX`
    : `${observedLiveCount} live on DEX · ${offers.length} after filters`;
  return (
    <div data-testid="live-offers-list" className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
      <div className="sticky top-0 z-20 border-b border-border bg-surface/95">
        <div className="px-3 py-1 text-[0.7rem] text-muted" title="Hub count versus the table after opportunity filters">
          {captureLabel}
        </div>
        <div className={`${LIVE_OFFERS_GRID_COLS} px-3 py-1.5`}>
        <SortHeaderButton label="Offer" column="exchange" sort={sort} onSort={handleSort} />
        <SortHeaderButton label="Dir" column="direction" sort={sort} onSort={handleSort} />
        <SortHeaderButton label="Premium" column="premium" sort={sort} onSort={handleSort} />
        <SortHeaderButton label="Payment method" column="payment_method" sort={sort} onSort={handleSort} />
        <SortHeaderButton label="First seen" column="first_seen" sort={sort} onSort={handleSort} />
        <span className={headerClass} title="Maker reputation score">Reputation</span>
        <span className={headerClass} title="Counterparty security deposit / bond">Stake</span>
        <SortHeaderButton label="Age" column="age" sort={sort} onSort={handleSort} />
        <span className={`${headerClass} flex items-center gap-1`}><SortHeaderButton label="Volume" column="size" sort={sort} onSort={handleSort} fitContent /><UnitToggle fiat={fiat} unit={sizeUnit} onChange={setSizeUnit} /></span>
        <span className={`${headerClass} flex items-center gap-1`}><SortHeaderButton label="Net profit" column="net_profit" sort={sort} onSort={handleSort} fitContent /><UnitToggle fiat={fiat} unit={netProfitUnit} onChange={setNetProfitUnit} /></span>
        <span className="flex items-center justify-center">
          {chartEnabled && (
            <input
              type="checkbox"
              checked={allChartVisible}
              ref={element => { if (element) element.indeterminate = someChartVisible; }}
              onChange={event => setChartOfferKeysVisible(stableKeys, event.target.checked)}
              title="Show/hide all offers on the OHLC chart"
            />
          )}
        </span>
        <span aria-hidden />
        </div>
      </div>
      {loading && offers.length === 0 ? (
        <div className="relative min-h-64"><LoadingSpinner size={112} label="Loading offers" /></div>
      ) : sortedOffers.length === 0 ? (
        <div className="px-3 py-4 text-[0.75rem] text-muted">No live offers for the selected filters.</div>
      ) : sortedOffers.map((offer, index) => {
        const stableKey = stableKeys[index];
        const premium = getRawPremiumPercent(offer);
        const volumeAmount = getOfferVolume(offer, scenarioMode, sizeUnit);
        const volume = fmtVolume(volumeAmount.value, sizeUnit, volumeAmount.exactUnit, fiat);
        const priced = resolveTradeBreakdown(offer, scenarioMode, tradeMode, manualSelection).breakdown;
        const netProfitBtc = priced?.estimated_profit_btc ?? getEstimatedProfitBtc(offer, scenarioMode);
        const refPrice = getRefPrice(offer);
        const netProfitFiat = priced != null && refPrice != null
          ? priced.estimated_profit_btc * refPrice
          : getEstimatedProfitFiat(offer, scenarioMode);
        return (
          <div key={stableKey} className="border-b border-border last:border-0">
            <div
              role="button"
              tabIndex={0}
              data-testid="live-offers-row"
              onClick={() => { onScenarioModeChange('full'); setExpandedKey(stableKey); onSelectOffer(offer); }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onScenarioModeChange('full');
                  setExpandedKey(stableKey);
                  onSelectOffer(offer);
                }
              }}
              className="w-full min-w-0 cursor-pointer px-3 py-2 text-left transition-colors hover:bg-white/5"
            >
              <span className={`${LIVE_OFFERS_GRID_COLS} text-[0.72rem]`}>
                <span className="min-w-0 overflow-hidden"><ExchangeTag exchange={offer.exchange} /></span>
                <span className={`truncate text-[0.65rem] font-semibold uppercase ${offer.direction === 'bid' ? 'text-green' : 'text-red'}`}>{offer.direction === 'bid' ? 'Bid' : 'Ask'}</span>
                <TradeRowMetric value={premium == null ? '—' : `${premium.toFixed(1)}%`} valueClassName={premiumClass(premium)} />
                <span className="min-w-0 truncate font-medium text-text" title={offer.payment_methods?.join(', ') || 'Unknown method'}>{offer.payment_methods?.join(', ') || 'Unknown method'}</span>
                <TradeRowMetric value={formatDateTimeLabel(getFirstSeen(offer) ?? '', timezone)} />
                <span className="min-w-0 truncate"><SellerRatingBadge score={offer.seller_rating_score} confidence={offer.seller_rating_confidence} raw={offer.seller_rating_raw} compact /></span>
                <span className="min-w-0 truncate"><CounterpartyStakeBadge pct={getCounterpartyStakePct(offer)} /></span>
                <TradeRowMetric value={formatDuration(getFirstSeen(offer), new Date().toISOString())} />
                <TradeRowMetric value={volume.text} title={volume.title} />
                <TradeRowMetric value={netProfitUnit === 'btc' ? fmtBTC(netProfitBtc) : fmtFiat(netProfitFiat, fiat)} valueClassName="text-green" />
                <span className="flex shrink-0 items-center justify-center" onClick={event => event.stopPropagation()}>
                  {chartEnabled && <input type="checkbox" checked={isChartOfferVisible(stableKey)} onChange={() => toggleChartOfferKey(stableKey)} title="Show on OHLC chart" />}
                </span>
                <span className="shrink-0 text-right text-muted">▼</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TakerOpportunities({ stats, statsNetCapped, statsNetMin, fastOrders, detailedOrders, ordersLoading, cappedLoading, maxFiatLimit, onRefreshLive, lastUpdatedAt, customRangeLoading = false, onCustomRangeChange, chart }: Props) {
  const displayedOrders = detailedOrders.length > 0 ? detailedOrders : fastOrders;
  const deferredOrders = useDeferredValue(displayedOrders);
  const ordersPending = deferredOrders !== displayedOrders;
  const { timezone } = useTimezone();
  const {
    offers: contextOffers,
    filteredOffers,
    selectedOfferKey,
    setSelectedOfferKey,
    loading,
    filters: liveFilters,
    setFilters,
    resetFilters: resetLiveFilters,
    isChartOfferVisible: isChartOfferVisibleInScope,
    toggleChartOfferKey: toggleChartOfferKeyInScope,
    setChartOfferKeysVisible: setChartOfferKeysVisibleInScope,
    hideAllChartOffers,
    linkedPaymentMethods,
    linkedPaymentMethodOptions,
    selectedPriceLevel,
    setSelectedPriceLevel,
  } = useFilters();
  // All chart-visibility interactions here belong to the Insights scope,
  // where offers are hidden by default and render only when ticked.
  const isChartOfferVisible = useCallback(
    (key: string) => isChartOfferVisibleInScope('insights', key),
    [isChartOfferVisibleInScope],
  );
  const toggleChartOfferKey = (key: string) => toggleChartOfferKeyInScope('insights', key);
  const setChartOfferKeysVisible = (keys: string[], visible: boolean) => setChartOfferKeysVisibleInScope('insights', keys, visible);
  const [initialFilters] = useState(readPersistedInsightsFilters);
  const initialCapAvailable = maxFiatLimit != null && maxFiatLimit > 0;
  const initialCappedModePending = initialFilters.mode === 'net_capped' && cappedLoading && detailedOrders.length === 0;
  const [referenceNowMs] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<InsightsViewMode>(initialFilters.viewMode);
  const [selectedTimeframe, setSelectedTimeframe] = useState(initialFilters.selectedTimeframe);
  const [customStartDate, setCustomStartDate] = useState(initialFilters.customStartDate);
  const [customEndDate, setCustomEndDate] = useState(initialFilters.customEndDate);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>(initialFilters.directionFilter);
  const [disabledExchanges, setDisabledExchanges] = useState<string[]>(initialFilters.disabledExchanges);
  const [mode, setMode] = useState<TakerOpportunityMode>(
    initialFilters.mode === 'net_capped' && (!initialCapAvailable || initialCappedModePending)
      ? 'net_full'
      : initialFilters.mode,
  );
  const [sort, setSort] = useState<SortState>(() => readPersistedSort(initialFilters));
  const [netProfitUnit, setNetProfitUnit] = useState<NetProfitUnit>(initialFilters.netProfitUnit);
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>(initialFilters.sizeUnit);
  const [summaryUnit, setSummaryUnit] = useState<SizeUnit>(initialFilters.summaryUnit);
  const [durationRange, setDurationRange] = useState<[number, number] | null>(null);
  const [profitFiatRangeCents, setProfitFiatRangeCents] = useState<[number, number] | null>(null);
  const [profitPctRangeScaled, setProfitPctRangeScaled] = useState<[number, number] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedScenarioMode, setExpandedScenarioMode] = useState<SizeMode>('full');
  const { exchanges: cexExchanges } = useCEXPermissions();
  const hedgeVenueAvailable = hasEffectiveHedgeVenue(cexExchanges);
  const defaultLiveTradeMode: TradeMode = hedgeVenueAvailable
    ? 'hedgefull_single_collateral'
    : 'hedgeless_double_collateral';
  const [liveTradeMode, setLiveTradeMode] = useState<TradeMode>(defaultLiveTradeMode);
  const [liveScenarioMode, setLiveScenarioMode] = useState<SizeMode>('full');
  const [manualRouteSelection, setManualRouteSelection] = useState<ManualRouteSelection>(DEFAULT_MANUAL_ROUTE_SELECTION);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [depthCollapsed, setDepthCollapsed] = useState(false);

  useEffect(() => {
    if (selectedTimeframe !== CUSTOM_TIMEFRAME || !isDateInputValue(customStartDate) || !isDateInputValue(customEndDate)) {
      onCustomRangeChange?.(null);
      return;
    }
    onCustomRangeChange?.({ startDate: customStartDate, endDate: customEndDate });
  }, [selectedTimeframe, customStartDate, customEndDate, onCustomRangeChange]);
  const persistedDurationRef = useRef({
    min: initialFilters.durationMin,
    max: initialFilters.durationMax,
  });
  const persistedProfitFiatRef = useRef({
    minCents: initialFilters.profitFiatMin != null ? profitFiatToCents(initialFilters.profitFiatMin) : null,
    maxCents: initialFilters.profitFiatMax != null ? profitFiatToCents(initialFilters.profitFiatMax) : null,
  });
  const persistedProfitPctRef = useRef({
    minHundredths: initialFilters.profitPctMin != null ? profitPctToHundredths(initialFilters.profitPctMin) : null,
    maxHundredths: initialFilters.profitPctMax != null ? profitPctToHundredths(initialFilters.profitPctMax) : null,
  });
  const durationBoundsInitializedRef = useRef(false);
  const profitFiatBoundsInitializedRef = useRef(false);
  const profitPctBoundsInitializedRef = useRef(false);
  const lastProfitFiatBoundsRef = useRef<{ minScaled: number; maxScaled: number } | null>(null);
  const lastProfitPctBoundsRef = useRef<{ minScaled: number; maxScaled: number } | null>(null);
  const profitFiatModeRef = useRef(mode);
  const profitPctModeRef = useRef(mode);
  const tradesListRef = useRef<HTMLDivElement>(null);
  const offersLayoutRef = useRef<HTMLDivElement>(null);
  const offersListPanelRef = useRef<HTMLDivElement>(null);
  const offersListDefaultHeightRef = useRef<number | null>(null);
  const offersResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number; minHeight: number } | null>(null);
  const [offersListHeight, setOffersListHeight] = useState<number | null>(null);
  const detailedOrdersByID = useMemo(() => new Map(detailedOrders.map(order => [order.id, order])), [detailedOrders]);

  useLayoutEffect(() => {
    if (offersListDefaultHeightRef.current != null) return;
    const list = offersListPanelRef.current;
    if (list != null) offersListDefaultHeightRef.current = list.getBoundingClientRect().height;
  });

  const handleOffersResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const list = offersListPanelRef.current;
    if (list == null) return;
    const currentHeight = list.getBoundingClientRect().height;
    const minHeight = offersListDefaultHeightRef.current ?? currentHeight;
    offersResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: currentHeight,
      minHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const handleOffersResizeMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const resize = offersResizeRef.current;
    const layout = offersLayoutRef.current;
    if (resize == null || layout == null || event.pointerId !== resize.pointerId) return;
    const availableHeight = layout.getBoundingClientRect().height;
    const maxHeight = Math.max(resize.minHeight, availableHeight - 8);
    const nextHeight = Math.max(resize.minHeight, Math.min(maxHeight, resize.startHeight + resize.startY - event.clientY));
    const remainingChartHeight = availableHeight - nextHeight - 8;
    if (remainingChartHeight <= 256) {
      offersResizeRef.current = null;
      setOffersListHeight(null);
      setChartCollapsed(true);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    setOffersListHeight(nextHeight);
    event.preventDefault();
  }, []);

  const handleOffersResizeEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (offersResizeRef.current?.pointerId !== event.pointerId) return;
    offersResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  // Selecting a live offer swaps the depth panel for the Trade Tracing
  // workflow, using the same key scheme as the live-offers list.
  const selectedLiveOffer = useMemo(() => {
    if (selectedOfferKey == null || viewMode !== 'live') return null;
    const keys = buildOfferKeys(filteredOffers);
    const idx = keys.indexOf(selectedOfferKey);
    if (idx < 0) return null;
    const offer = filteredOffers[idx];
    return offer && isOfferLive(offer) ? offer : null;
  }, [selectedOfferKey, filteredOffers, viewMode]);

  useEffect(() => {
    if (!hedgeVenueAvailable && liveTradeMode !== 'hedgeless_double_collateral') {
      setLiveTradeMode('hedgeless_double_collateral');
    }
  }, [hedgeVenueAvailable, liveTradeMode]);

  useEffect(() => {
    setLiveTradeMode(hedgeVenueAvailable ? 'hedgefull_single_collateral' : 'hedgeless_double_collateral');
    setLiveScenarioMode('full');
    setManualRouteSelection(DEFAULT_MANUAL_ROUTE_SELECTION);
  }, [selectedOfferKey, hedgeVenueAvailable]);

  // Direction/Exchanges live in FiltersContext so Stats and Insights share them.
  // Hydrate context from this page's persisted sidebar once, but do not clobber
  // values the Statistics rail already applied in this session.
  const sharedFiltersSyncedRef = useRef(false);
  useEffect(() => {
    if (sharedFiltersSyncedRef.current) return;
    sharedFiltersSyncedRef.current = true;
    if (liveFilters.direction || liveFilters.excludedExchanges.length > 0) {
      setDirectionFilter(liveFilters.direction === 'bid' || liveFilters.direction === 'ask' ? liveFilters.direction : 'both');
      setDisabledExchanges(liveFilters.excludedExchanges);
      return;
    }
    setFilters({
      direction: directionFilter === 'both' ? '' : directionFilter,
      excludedExchanges: disabledExchanges,
    });
  }, [setFilters, directionFilter, disabledExchanges, liveFilters.direction, liveFilters.excludedExchanges]);

  // The range unit (fiat / %) is shared with Live mode via FiltersContext, so
  // switching modes keeps the selected unit. Apply the persisted unit once.
  const profitRangeUnit: ProfitRangeUnit = liveFilters.rangeMetric === 'premium' ? 'pct' : 'fiat';
  const setProfitRangeUnit = useCallback(
    (unit: ProfitRangeUnit) => setFilters({ rangeMetric: unit === 'pct' ? 'premium' : 'profit' }),
    [setFilters],
  );
  useEffect(() => {
    setProfitRangeUnit(initialFilters.profitRangeUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const sharedDirectionKey = `${liveFilters.direction}|${liveFilters.excludedExchanges.join(',')}`;
  const previousSharedDirectionKeyRef = useRef(sharedDirectionKey);
  useEffect(() => {
    if (previousSharedDirectionKeyRef.current === sharedDirectionKey) return;
    previousSharedDirectionKeyRef.current = sharedDirectionKey;
    setDirectionFilter(liveFilters.direction === 'bid' || liveFilters.direction === 'ask' ? liveFilters.direction : 'both');
    setDisabledExchanges(liveFilters.excludedExchanges);
  }, [sharedDirectionKey, liveFilters.direction, liveFilters.excludedExchanges]);

  const cappedOffersPending = cappedLoading && detailedOrders.length === 0;
  const scenarioDataPending = mode !== 'net_full' && cappedOffersPending;
  const activeStats = mode === 'net_capped'
    ? (statsNetCapped ?? stats)
    : mode === 'net_min'
      ? (statsNetMin ?? stats)
      : stats;
  const activeOrders = useMemo(() => {
    if (scenarioDataPending) {
      return [] as DisplayOrder[];
    }
    let list = deferredOrders.filter(order => displayOrderProfitable(order, mode));
    if (liveFilters.paymentScope === 'linked' && linkedPaymentMethods != null) {
      const allowed = liveFilters.selectedLinkedPaymentMethods.length === 0
        ? linkedPaymentMethods
        : new Set(
          (linkedPaymentMethodOptions ?? [])
            .filter(method => liveFilters.selectedLinkedPaymentMethods.includes(method.name))
            .flatMap(method => [method.name, ...method.aliases]),
        );
      list = list.filter(order => order.payment_methods?.some(method => allowed.has(method)) ?? false);
    }
    return list;
  }, [scenarioDataPending, deferredOrders, mode, liveFilters.paymentScope, liveFilters.selectedLinkedPaymentMethods, linkedPaymentMethods, linkedPaymentMethodOptions]);

  // Capped mode is only meaningful when the global Max Position Size is set.
  const capAvailable = maxFiatLimit != null && maxFiatLimit > 0;
  const cappedModeAvailable = capAvailable && !cappedOffersPending;
  // If capped mode is unavailable, fall back to full mode so the toggle is never
  // greyed-out-but-active.
  useEffect(() => {
    if (!cappedModeAvailable && mode === 'net_capped') {
      setMode('net_full');
    }
  }, [cappedModeAvailable, mode]);

  // Keep an expanded row's breakdown in sync with the control-panel mode, so
  // switching Net Full/Capped updates an already-open calculation in place.
  useEffect(() => {
    setExpandedScenarioMode(mode === 'net_capped' ? 'capped' : mode === 'net_min' ? 'min' : 'full');
  }, [mode]);

  const fiat = activeStats?.fiat_currency || liveFilters.fiat;
  const selected = selectedTimeframe === CUSTOM_TIMEFRAME || !activeStats
    ? null
    : activeStats.timeframes.find(row => row.timeframe === selectedTimeframe)
      ?? activeStats.timeframes.find(row => row.timeframe === '24h')
      ?? activeStats.timeframes[0]
      ?? null;
  const activeTimeframe = selected?.timeframe ?? selectedTimeframe;
  const cutoffMs = selectedTimeframe === CUSTOM_TIMEFRAME
    ? null
    : referenceNowMs - timeframeHours(activeTimeframe) * 60 * 60 * 1000;
  // Custom ranges are already bounded server-side; preset windows remain
  // client-filtered against their existing relative cutoff.
  const endMs: number | null = null;

  const disabledExchangeSet = useMemo(() => new Set(disabledExchanges), [disabledExchanges]);

  const exchangeFilterBase = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const order of activeOrders) {
      const lastSeen = parseUtcTimestamp(order.status.last_seen);
      if (lastSeen == null || (cutoffMs != null && lastSeen.getTime() < cutoffMs) || (endMs != null && lastSeen.getTime() >= endMs)) continue;
      if (directionFilter !== 'both' && order.direction !== directionFilter) continue;
      counts[order.exchange] = (counts[order.exchange] ?? 0) + 1;
    }
    const exchanges = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'de'));
    return { counts, exchanges };
  }, [activeOrders, cutoffMs, endMs, directionFilter]);

  // Live mode counts exchanges over the live offer feed instead of closed orders.
  const liveExchangeFilterBase = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const offer of contextOffers) {
      if (!isOfferLive(offer)) continue;
      if (directionFilter !== 'both' && offer.direction !== directionFilter) continue;
      counts[offer.exchange] = (counts[offer.exchange] ?? 0) + 1;
    }
    const exchanges = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'de'));
    return { counts, exchanges };
  }, [contextOffers, directionFilter]);

  const activeExchangeFilter = viewMode === 'live' ? liveExchangeFilterBase : exchangeFilterBase;

  const ordersBeforeDurationFilter = useMemo(() => {
    return activeOrders.filter(order => {
      const lastSeen = parseUtcTimestamp(order.status.last_seen);
      if (lastSeen == null || (cutoffMs != null && lastSeen.getTime() < cutoffMs) || (endMs != null && lastSeen.getTime() >= endMs)) return false;
      if (directionFilter !== 'both' && order.direction !== directionFilter) return false;
      if (disabledExchangeSet.has(order.exchange)) return false;
      return true;
    });
  }, [activeOrders, cutoffMs, endMs, directionFilter, disabledExchangeSet]);

  const durationBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const order of ordersBeforeDurationFilter) {
      const mins = orderDurationMinutes(order);
      if (mins < min) min = mins;
      if (mins > max) max = mins;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 0, hasData: false };
    }
    return { min, max, hasData: true };
  }, [ordersBeforeDurationFilter]);

  useEffect(() => {
    if (!durationBounds.hasData) return;
    setDurationRange(prev => {
      if (!durationBoundsInitializedRef.current) {
        durationBoundsInitializedRef.current = true;
        const { min, max } = persistedDurationRef.current;
        if (min != null && max != null) {
          return clampNumericRange([min, max], durationBounds);
        }
        return [durationBounds.min, durationBounds.max];
      }
      return clampNumericRange(
        prev ?? [durationBounds.min, durationBounds.max],
        durationBounds,
      );
    });
  }, [durationBounds]);

  const ordersAfterDurationFilter = useMemo(() => {
    if (durationRange == null) return ordersBeforeDurationFilter;
    const [lo, hi] = durationRange;
    return ordersBeforeDurationFilter.filter(order => {
      const mins = orderDurationMinutes(order);
      return mins >= lo && mins <= hi;
    });
  }, [ordersBeforeDurationFilter, durationRange]);

  const profitFiatBounds = useMemo(
    () => scenarioDataPending
      ? NO_PROFIT_METRIC_BOUNDS
      : computeProfitMetricBounds(ordersAfterDurationFilter, order => orderNetProfitFiat(order, mode)),
    [scenarioDataPending, ordersAfterDurationFilter, mode],
  );

  const profitPctBounds = useMemo(
    () => scenarioDataPending
      ? NO_PROFIT_METRIC_BOUNDS
      : computeProfitMetricBounds(ordersAfterDurationFilter, order => orderNetPremiumPct(order, mode)),
    [scenarioDataPending, ordersAfterDurationFilter, mode],
  );

  useEffect(() => {
    if (!profitFiatBounds.hasData) return;

    const modeChanged = profitFiatModeRef.current !== mode;
    if (modeChanged) {
      profitFiatModeRef.current = mode;
      profitFiatBoundsInitializedRef.current = false;
    }

    const bounds = { min: profitFiatBounds.minScaled, max: profitFiatBounds.maxScaled };
    const lastBounds = lastProfitFiatBoundsRef.current;
    const boundsChanged = lastBounds != null
      && (lastBounds.minScaled !== bounds.min || lastBounds.maxScaled !== bounds.max);

    setProfitFiatRangeCents(prev => {
      if (modeChanged || !profitFiatBoundsInitializedRef.current) {
        profitFiatBoundsInitializedRef.current = true;
        const { minCents, maxCents } = persistedProfitFiatRef.current;
        if (minCents != null && maxCents != null) {
          return clampNumericRange([minCents, maxCents], bounds);
        }
        return [bounds.min, bounds.max];
      }
      if (prev == null) {
        return [bounds.min, bounds.max];
      }
      if (boundsChanged && prev[0] === lastBounds!.minScaled && prev[1] === lastBounds!.maxScaled) {
        return [bounds.min, bounds.max];
      }
      return clampNumericRange(prev, bounds);
    });

    lastProfitFiatBoundsRef.current = {
      minScaled: profitFiatBounds.minScaled,
      maxScaled: profitFiatBounds.maxScaled,
    };
  }, [mode, profitFiatBounds, durationRange]);

  useEffect(() => {
    if (!profitPctBounds.hasData) return;

    const modeChanged = profitPctModeRef.current !== mode;
    if (modeChanged) {
      profitPctModeRef.current = mode;
      profitPctBoundsInitializedRef.current = false;
    }

    const bounds = { min: profitPctBounds.minScaled, max: profitPctBounds.maxScaled };
    const lastBounds = lastProfitPctBoundsRef.current;
    const boundsChanged = lastBounds != null
      && (lastBounds.minScaled !== bounds.min || lastBounds.maxScaled !== bounds.max);

    setProfitPctRangeScaled(prev => {
      if (modeChanged || !profitPctBoundsInitializedRef.current) {
        profitPctBoundsInitializedRef.current = true;
        const { minHundredths, maxHundredths } = persistedProfitPctRef.current;
        if (minHundredths != null && maxHundredths != null) {
          return clampNumericRange([minHundredths, maxHundredths], bounds);
        }
        return [bounds.min, bounds.max];
      }
      if (prev == null) {
        return [bounds.min, bounds.max];
      }
      if (boundsChanged && prev[0] === lastBounds!.minScaled && prev[1] === lastBounds!.maxScaled) {
        return [bounds.min, bounds.max];
      }
      return clampNumericRange(prev, bounds);
    });

    lastProfitPctBoundsRef.current = {
      minScaled: profitPctBounds.minScaled,
      maxScaled: profitPctBounds.maxScaled,
    };
  }, [mode, profitPctBounds, durationRange]);

  useLayoutEffect(() => {
    const atFullDurationRange = durationBounds.hasData
      && durationRange != null
      && durationRange[0] === durationBounds.min
      && durationRange[1] === durationBounds.max;
    const atFullProfitRange = profitFiatBounds.hasData
      && profitFiatRangeCents != null
      && profitFiatRangeCents[0] === profitFiatBounds.minScaled
      && profitFiatRangeCents[1] === profitFiatBounds.maxScaled;
    const atFullProfitPctRange = profitPctBounds.hasData
      && profitPctRangeScaled != null
      && profitPctRangeScaled[0] === profitPctBounds.minScaled
      && profitPctRangeScaled[1] === profitPctBounds.maxScaled;
    const payload: PersistedInsightsFilters = {
      viewMode,
      selectedTimeframe,
      customStartDate,
      customEndDate,
      directionFilter,
      disabledExchanges,
      mode,
      sortColumn: sort?.column ?? null,
      sortDir: sort?.dir ?? null,
      netProfitUnit,
      sizeUnit,
      summaryUnit,
      durationMin: !durationBounds.hasData || atFullDurationRange || durationRange == null
        ? null
        : durationRange[0],
      durationMax: !durationBounds.hasData || atFullDurationRange || durationRange == null
        ? null
        : durationRange[1],
      profitRangeUnit,
      profitFiatMin: !profitFiatBounds.hasData || atFullProfitRange || profitFiatRangeCents == null
        ? null
        : profitFiatFromCents(profitFiatRangeCents[0]),
      profitFiatMax: !profitFiatBounds.hasData || atFullProfitRange || profitFiatRangeCents == null
        ? null
        : profitFiatFromCents(profitFiatRangeCents[1]),
      profitPctMin: !profitPctBounds.hasData || atFullProfitPctRange || profitPctRangeScaled == null
        ? null
        : profitPctFromHundredths(profitPctRangeScaled[0]),
      profitPctMax: !profitPctBounds.hasData || atFullProfitPctRange || profitPctRangeScaled == null
        ? null
        : profitPctFromHundredths(profitPctRangeScaled[1]),
    };
    localStorage.setItem(INSIGHTS_FILTERS_STORAGE_KEY, JSON.stringify(payload));
  }, [
    viewMode,
    selectedTimeframe,
    customStartDate,
    customEndDate,
    directionFilter,
    disabledExchanges,
    mode,
    sort,
    netProfitUnit,
    sizeUnit,
    summaryUnit,
    durationRange,
    durationBounds.min,
    durationBounds.max,
    durationBounds.hasData,
    profitRangeUnit,
    profitFiatRangeCents,
    profitFiatBounds.minScaled,
    profitFiatBounds.maxScaled,
    profitFiatBounds.hasData,
    profitPctRangeScaled,
    profitPctBounds.minScaled,
    profitPctBounds.maxScaled,
    profitPctBounds.hasData,
  ]);

  const ordersAfterProfitFilter = useMemo(() => {
    if (profitRangeUnit === 'pct') {
      if (profitPctRangeScaled == null) {
        return ordersAfterDurationFilter;
      }
      const [lo, hi] = profitPctRangeScaled;
      return ordersAfterDurationFilter.filter(order => {
        const scaled = profitPctToHundredths(orderNetPremiumPct(order, mode));
        return scaled >= lo && scaled <= hi;
      });
    }
    if (profitFiatRangeCents == null) {
      return ordersAfterDurationFilter;
    }
    const [lo, hi] = profitFiatRangeCents;
    return ordersAfterDurationFilter.filter(order => {
      const cents = profitFiatToCents(orderNetProfitFiat(order, mode));
      return cents >= lo && cents <= hi;
    });
  }, [ordersAfterDurationFilter, profitRangeUnit, profitPctRangeScaled, profitFiatRangeCents, mode]);

  // Narrow to the price level selected on the depth chart (if any).
  const filteredOrders = useMemo(() => {
    if (selectedPriceLevel == null) return ordersAfterProfitFilter;
    return ordersAfterProfitFilter.filter(order => {
      const price = order.pricing?.offer_price ?? order.pricing?.avg_offer_price;
      return price != null && isPriceInLevel(price, selectedPriceLevel);
    });
  }, [ordersAfterProfitFilter, selectedPriceLevel]);

  // Live offers shown in the list, narrowed to the depth chart's selected
  // price level. The context's filteredOffers stays unfiltered so offer keys
  // (and the selected offer) resolve the same way with or without a level.
  const listedLiveOffers = useMemo(() => {
    const live = filteredOffers.filter(isOfferLive);
    if (selectedPriceLevel == null) return live;
    return live.filter(offer => isPriceInLevel(getOfferPrice(offer), selectedPriceLevel));
  }, [filteredOffers, selectedPriceLevel]);

  const filteredSummary = useMemo(
    () => computeFilteredSummary(filteredOrders, mode),
    [filteredOrders, mode],
  );

  const sortedOrders = useMemo(
    () => sortProfitableOrders(filteredOrders, sort, mode, netProfitUnit, sizeUnit),
    [filteredOrders, sort, mode, netProfitUnit, sizeUnit],
  );
  const expandedOrder = expandedId == null
    ? null
    : sortedOrders.find(order => order.id === expandedId) ?? null;
  const expandedDetailedOrder = expandedOrder == null
    ? undefined
    : isDetailedOrder(expandedOrder) ? expandedOrder : detailedOrdersByID.get(expandedOrder.id);
  const selectedLiveChartKey = selectedLiveOffer == null ? null : buildStableOfferKey(selectedLiveOffer);
  const selectedPastChartKey = expandedOrder == null ? null : orderStableChartKey(expandedOrder);

  useTemporaryChartVisibility(
    viewMode === 'live' ? selectedOfferKey : null,
    viewMode === 'live' ? selectedLiveChartKey : null,
    isChartOfferVisible,
    setChartOfferKeysVisible,
  );
  useTemporaryChartVisibility(
    viewMode === 'past' ? expandedId : null,
    viewMode === 'past' ? selectedPastChartKey : null,
    isChartOfferVisible,
    setChartOfferKeysVisible,
  );

  // A changed filter can remove the open order from the list. Return to the
  // list rather than leaving a detail view without a matching result.
  useEffect(() => {
    if (expandedId != null && expandedOrder == null) setExpandedId(null);
  }, [expandedId, expandedOrder]);

  // The filtered orders double as chart overlays. Only detailed orders carry
  // the pricing/analysis payload the chart needs; compact rows join once the
  // detailed pass lands. Per-offer visibility is applied by the chart itself
  // via the insights chart-visibility scope.
  const plottedChartOffers = useMemo(() => {
    const offers: Offer[] = [];
    for (const order of filteredOrders) {
      const detailed = isDetailedOrder(order) ? order : detailedOrdersByID.get(order.id);
      if (detailed) offers.push(pastProfitableOrderAsOffer(detailed));
    }
    return offers;
  }, [filteredOrders, detailedOrdersByID]);

  const sortedStableKeys = useMemo(() => sortedOrders.map(orderStableChartKey), [sortedOrders]);
  const chartVisibleCount = useMemo(
    () => sortedStableKeys.filter(isChartOfferVisible).length,
    [sortedStableKeys, isChartOfferVisible],
  );
  const allChartVisible = sortedOrders.length > 0 && chartVisibleCount === sortedOrders.length;
  const someChartVisible = chartVisibleCount > 0 && chartVisibleCount < sortedOrders.length;

  const handleSort = useCallback((column: SortColumn) => {
    setSort(prev => {
      if (prev?.column !== column) return { column, dir: DEFAULT_SORT_DIR[column] };
      if (prev.dir === DEFAULT_SORT_DIR[column]) {
        return { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      // A third click clears all column sorters and restores the API's default
      // order for the current filters.
      return null;
    });
  }, []);

  const toggleExpanded = useCallback((order: DisplayOrder, isOpen: boolean, detailedOrder: PastProfitableOrder | undefined) => {
    if (isOpen) {
      setExpandedId(null);
      return;
    }
    setExpandedId(order.id);
    setExpandedScenarioMode(
      mode === 'net_capped' && detailedOrder?.analysis.capped_volume
        ? 'capped'
        : mode === 'net_min' && detailedOrder?.analysis.min_volume
          ? 'min'
          : 'full',
    );
  }, [mode]);

  // TanStack Virtual returns refs that React Compiler cannot memoize; usage here is localized.
  // eslint-disable-next-line react-hooks/incompatible-library -- scroll virtualization only
  const rowVirtualizer = useVirtualizer({
    count: sortedOrders.length,
    getScrollElement: () => tradesListRef.current,
    estimateSize: index => (expandedId === sortedOrders[index]?.id ? 720 : 44),
    overscan: 12,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [expandedId, sortedOrders.length, rowVirtualizer]);

  // Direction and Exchanges are shared filters: they drive both the past-orders
  // list (local state) and the live offers view (global FiltersContext).
  const changeDirectionFilter = useCallback((v: DirectionFilter) => {
    setDirectionFilter(v);
    setFilters({ direction: v === 'both' ? '' : v });
  }, [setFilters]);

  const applyDisabledExchanges = useCallback((next: string[]) => {
    setDisabledExchanges(next);
    setFilters({ excludedExchanges: next });
  }, [setFilters]);

  const toggleExchangeFilter = useCallback((exchange: string) => {
    const next = disabledExchanges.includes(exchange)
      ? disabledExchanges.filter(name => name !== exchange)
      : [...disabledExchanges, exchange];
    applyDisabledExchanges(next);
  }, [disabledExchanges, applyDisabledExchanges]);

  const customDateMax = dateInputValue(new Date(referenceNowMs));
  const changeTimeframe = useCallback((timeframe: string) => {
    setSelectedTimeframe(timeframe);
    if (timeframe !== CUSTOM_TIMEFRAME) return;
    if (!isDateInputValue(customEndDate)) setCustomEndDate(customDateMax);
    if (!isDateInputValue(customStartDate)) {
      const defaultStart = new Date(referenceNowMs);
      defaultStart.setDate(defaultStart.getDate() - 6);
      setCustomStartDate(dateInputValue(defaultStart));
    }
  }, [customDateMax, customEndDate, customStartDate, referenceNowMs]);

  const changeCustomStartDate = useCallback((value: string) => {
    setCustomStartDate(value);
    if (customEndDate && value > customEndDate) setCustomEndDate(value);
  }, [customEndDate]);

  const resetFilters = useCallback(() => {
    // Also resets the shared live filters (direction, excluded exchanges,
    // payment, premium metric and range) in the global FiltersContext.
    resetLiveFilters();
    setSelectedTimeframe(DEFAULT_INSIGHTS_FILTERS.selectedTimeframe);
    setCustomStartDate(DEFAULT_INSIGHTS_FILTERS.customStartDate);
    setCustomEndDate(DEFAULT_INSIGHTS_FILTERS.customEndDate);
    setDirectionFilter(DEFAULT_INSIGHTS_FILTERS.directionFilter);
    setDisabledExchanges([]);
    setMode(DEFAULT_INSIGHTS_FILTERS.mode);
    setSort(null);
    setNetProfitUnit(DEFAULT_INSIGHTS_FILTERS.netProfitUnit);
    setSizeUnit(DEFAULT_INSIGHTS_FILTERS.sizeUnit);
    setSummaryUnit(DEFAULT_INSIGHTS_FILTERS.summaryUnit);
    setExpandedId(null);
    setExpandedScenarioMode('full');
    persistedDurationRef.current = { min: null, max: null };
    persistedProfitFiatRef.current = { minCents: null, maxCents: null };
    persistedProfitPctRef.current = { minHundredths: null, maxHundredths: null };
    profitFiatBoundsInitializedRef.current = false;
    profitPctBoundsInitializedRef.current = false;
    lastProfitFiatBoundsRef.current = null;
    lastProfitPctBoundsRef.current = null;
    // resetLiveFilters() already restores the shared range unit (fiat).
    if (durationBounds.hasData) {
      setDurationRange([durationBounds.min, durationBounds.max]);
    }
    if (profitFiatBounds.hasData) {
      setProfitFiatRangeCents([profitFiatBounds.minScaled, profitFiatBounds.maxScaled]);
      profitFiatBoundsInitializedRef.current = true;
    } else {
      setProfitFiatRangeCents(null);
    }
    if (profitPctBounds.hasData) {
      setProfitPctRangeScaled([profitPctBounds.minScaled, profitPctBounds.maxScaled]);
      profitPctBoundsInitializedRef.current = true;
    } else {
      setProfitPctRangeScaled(null);
    }
  }, [
    resetLiveFilters,
    durationBounds.hasData,
    durationBounds.min,
    durationBounds.max,
    profitFiatBounds.hasData,
    profitFiatBounds.minScaled,
    profitFiatBounds.maxScaled,
    profitPctBounds.hasData,
    profitPctBounds.minScaled,
    profitPctBounds.maxScaled,
  ]);

  const initialAnalyticsPending = !stats
    && fastOrders.length === 0
    && detailedOrders.length === 0;

  if (viewMode === 'past' && initialAnalyticsPending) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <LoadingSpinner size={112} label="Loading taker opportunities" />
      </div>
    );
  }

  if (viewMode === 'past' && !stats) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center px-3 text-[0.8rem] text-muted">
          No taker opportunity statistics available yet.
        </div>
      </div>
    );
  }

  const summaryRows = [
    { label: 'Orders', value: scenarioDataPending ? 'Calculating…' : filteredSummary.premium_order_count.toLocaleString('de-DE'), className: 'text-text' },
    {
      label: 'Net profit',
      value: scenarioDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.total_net_profit_btc) : fmtFiat(filteredSummary.total_net_profit_fiat, fiat),
      className: 'text-green',
    },
    {
      label: 'Avg Volume',
      value: scenarioDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.average_order_size_btc) : fmtFiat(filteredSummary.average_order_size_fiat, fiat),
      className: 'text-text',
    },
    {
      label: 'Smallest',
      value: scenarioDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.smallest_order_size_btc) : fmtFiat(filteredSummary.smallest_order_size_fiat, fiat),
      className: 'text-muted',
    },
    {
      label: 'Biggest',
      value: scenarioDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.biggest_order_size_btc) : fmtFiat(filteredSummary.biggest_order_size_fiat, fiat),
      className: 'text-muted',
    },
  ];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      {viewMode === 'past' && (ordersPending || scenarioDataPending) && displayedOrders.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-border bg-surface/80 px-3 py-1 text-[0.68rem] text-muted">
          {scenarioDataPending ? 'Calculating selected-volume profits…' : 'Updating profitable trades…'}
        </div>
      )}
      <div className="mb-3 flex items-center justify-between gap-3 shrink-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">
            {viewMode === 'live' ? 'Live Offers' : 'Past Offers'}
          </h3>
          {selectedPriceLevel != null && (
            <span
              data-testid="price-level-filter"
              className="inline-flex items-center gap-1 rounded-md border border-accent/60 bg-accent/10 px-1.5 py-0.5 text-[0.65rem] tabular-nums text-text"
            >
              Price level{' '}
              {formatFiat(selectedPriceLevel.low, liveFilters.fiat, { maximumFractionDigits: 0 })}
              {' – '}
              {formatFiat(selectedPriceLevel.high, liveFilters.fiat, { maximumFractionDigits: 0 })}
              <button
                type="button"
                aria-label="Clear price level filter"
                title="Show all offers"
                onClick={() => setSelectedPriceLevel(null)}
                className="ml-0.5 leading-none text-muted transition-colors hover:text-text"
              >
                ✕
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Offer view mode">
          {(['live', 'past'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => {
                if (option !== viewMode) hideAllChartOffers();
                setViewMode(option);
              }}
              aria-pressed={viewMode === option}
              className={viewMode === option
                ? 'rounded-md border border-accent bg-accent px-2 py-0.5 text-[0.68rem] font-medium text-black transition-colors'
                : 'rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[0.68rem] font-medium text-muted transition-colors hover:text-text'}
            >
              {option === 'live' ? 'Live Offers' : 'Past Offers'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-1 min-h-0 flex-col gap-3 lg:flex-row">
        <OfferFilterRail
          scope={viewMode}
          directionFilter={directionFilter}
          onDirectionChange={changeDirectionFilter}
          exchanges={activeExchangeFilter.exchanges}
          exchangeCounts={activeExchangeFilter.counts}
          disabledExchanges={disabledExchanges}
          onToggleExchange={toggleExchangeFilter}
          onEnableAllExchanges={() => applyDisabledExchanges([])}
          onDisableAllExchanges={() => applyDisabledExchanges([...activeExchangeFilter.exchanges])}
          onRefresh={onRefreshLive}
          lastUpdatedAt={lastUpdatedAt}
          onReset={resetFilters}
          maxFiatLimit={maxFiatLimit}
          premium={viewMode === 'past' ? (
            <PremiumSelect
              options={[
                { value: 'net_full', label: premiumModeLabel('net_full') },
                {
                  value: 'net_capped',
                  label: premiumModeLabel('net_capped', fiat, maxFiatLimit),
                  disabled: !cappedModeAvailable,
                  title: !capAvailable
                    ? 'Set a Max Position Size (Fiat) in Settings to enable capped mode'
                    : cappedOffersPending
                      ? 'Capped offers are still loading'
                      : undefined,
                },
                {
                  value: 'net_min',
                  label: premiumModeLabel('net_min'),
                  title: 'Use each offer’s minimum executable volume',
                },
              ]}
              selected={mode}
              onChange={v => setMode(v as TakerOpportunityMode)}
            />
          ) : undefined}
          range={viewMode === 'past' ? (
            profitRangeUnit === 'pct' ? (
              <ProfitRangeFilter
                fiat={fiat}
                unit="pct"
                onUnitChange={setProfitRangeUnit}
                min={profitPctBounds.minScaled}
                max={profitPctBounds.sliderMaxScaled}
                value={profitPctBounds.hasData ? profitPctRangeScaled : null}
                onChange={setProfitPctRangeScaled}
                hasData={profitPctBounds.hasData}
                description="Filter profitable trades by net premium percentage per order"
                emptyMessage={scenarioDataPending ? 'Selected-volume profit is still being calculated' : 'No premium data for the current filters'}
              />
            ) : (
              <ProfitRangeFilter
                fiat={fiat}
                unit="fiat"
                onUnitChange={setProfitRangeUnit}
                min={profitFiatBounds.minScaled}
                max={profitFiatBounds.sliderMaxScaled}
                value={profitFiatBounds.hasData ? profitFiatRangeCents : null}
                onChange={setProfitFiatRangeCents}
                hasData={profitFiatBounds.hasData}
                description="Filter profitable trades by net profit per order in fiat"
                emptyMessage={scenarioDataPending ? 'Selected-volume profit is still being calculated' : 'No profit data for the current filters'}
              />
            )
          ) : undefined}
          extra={viewMode === 'past' ? (
            <>
              <FilterSelect
                label="Timeframe"
                description="Show offers closed within a preset window or a custom date range"
                options={[
                  ...((activeStats ?? stats)?.timeframes ?? []).map(r => ({ value: r.timeframe, label: labelForTimeframe(r.timeframe) })),
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
                  loading={customRangeLoading}
                  onStartDateChange={changeCustomStartDate}
                  onEndDateChange={setCustomEndDate}
                />
              )}
              <DualRangeFilter
                label="Duration"
                description="Filter profitable trades by how long the offer was live"
                min={durationBounds.min}
                max={durationBounds.max}
                value={durationRange ?? [durationBounds.min, durationBounds.max]}
                onChange={setDurationRange}
                formatValue={formatDurationMinutes}
                disabled={!durationBounds.hasData || durationRange == null}
                disabledMessage="No duration data in this window"
              />
            </>
          ) : undefined}
          footer={viewMode === 'past' ? (
            <div className="shrink-0 overflow-hidden rounded-lg border border-border bg-bg/20">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-surface/70 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
                <span>Backtesting summary</span>
                <UnitToggle fiat={fiat} unit={summaryUnit} onChange={setSummaryUnit} />
              </div>
              <div className="divide-y divide-border/70 text-[0.75rem]">
                {summaryRows.map(row => (
                  <div key={row.label} className="grid grid-cols-[minmax(5rem,0.85fr)_minmax(0,1.15fr)] gap-2 px-3 py-2">
                    <span className="text-muted">{row.label}</span>
                    <span className={`min-w-0 break-words text-right tabular-nums mono-nums ${row.className}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        />

        <div ref={offersLayoutRef} className="min-h-0 min-w-0 flex-1 flex flex-col gap-1">
          {chart != null && (
            // When the OHLC chart is collapsed and no live offer is selected,
            // the whole row reduces to a single horizontal expand bar — the
            // depth chart can only be toggled while the OHLC chart is expanded.
            chartCollapsed && selectedLiveOffer == null ? (
              <button
                type="button"
                aria-label="Show premium chart"
                aria-expanded={false}
                onClick={() => setChartCollapsed(false)}
                className="shrink-0 rounded-lg border border-border bg-bg/20 px-3 py-2 text-left text-[0.68rem] font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface hover:text-text"
              >
                DEX Premium Offer Overlay ▾
              </button>
            ) : (
            <div className="flex flex-col gap-3 lg:flex-row lg:min-h-0 lg:min-w-0 lg:flex-3">
              {chartCollapsed ? (
                <button
                  type="button"
                  aria-label="Show premium chart"
                  aria-expanded={false}
                  onClick={() => setChartCollapsed(false)}
                  className="shrink-0 rounded-lg border border-border bg-bg/20 px-3 py-2 text-left text-[0.68rem] font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface hover:text-text lg:w-9 lg:px-2 lg:py-3 lg:[writing-mode:vertical-rl] lg:rotate-180"
                >
                  DEX Premium Offer Overlay ▾
                </button>
              ) : (
                <div className="h-80 lg:h-auto lg:min-h-0 lg:min-w-0 overflow-hidden lg:flex-1 rounded-lg border border-border bg-surface flex flex-col">
                  <div className="flex-1 min-h-0 relative">
                    <button
                      type="button"
                      aria-label="Hide premium chart"
                      aria-expanded={true}
                      onClick={() => setChartCollapsed(true)}
                      className="absolute right-1 top-1 z-10 rounded border border-border bg-surface px-1.5 py-0.5 text-[0.75rem] leading-none text-muted transition-colors hover:text-text"
                      title="Hide chart"
                    >
                      ▴
                    </button>
                    {chart(viewMode === 'past' ? plottedChartOffers : [], viewMode === 'live')}
                  </div>
                </div>
              )}

              {selectedLiveOffer ? (
                // A selected live offer turns the depth slot into the Trade
                // Tracing workflow (as on the Monitor tab), even while the
                // depth chart is collapsed; deselecting restores it.
                <section
                  aria-label="Trade tracing"
                  className={`relative min-h-56 lg:min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col ${
                    chartCollapsed
                      ? 'lg:min-w-0 lg:flex-1'
                      : 'shrink-0 lg:w-80 xl:w-96'
                  }`}
                >
                  <Suspense fallback={<div className="relative min-h-40"><LoadingSpinner label="Loading trade execution" /></div>}>
                  <TradeTracingPanel
                    offer={selectedLiveOffer}
                    tradeMode={liveTradeMode}
                    manualSelection={manualRouteSelection}
                    sizeMode={liveScenarioMode}
                    onSizeModeChange={setLiveScenarioMode}
                  />
                  </Suspense>
                </section>
              ) : depthCollapsed ? (
                <button
                  type="button"
                  aria-label="Show orderbook depth chart"
                  aria-expanded={false}
                  onClick={() => setDepthCollapsed(false)}
                  className="shrink-0 rounded-lg border border-border bg-bg/20 px-3 py-2 text-left text-[0.68rem] font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface hover:text-text lg:w-9 lg:px-2 lg:py-3 lg:[writing-mode:vertical-rl]"
                >
                  ◂ Orderbook Depth
                </button>
              ) : (
                <div className="relative h-72 lg:h-auto lg:min-h-0 lg:w-80 xl:w-96 shrink-0 overflow-hidden rounded-lg border border-border bg-surface flex flex-col">
                  <button
                    type="button"
                    aria-label="Hide orderbook depth chart"
                    aria-expanded={true}
                    onClick={() => {
                      // A hidden depth chart can't show or clear its selection.
                      setSelectedPriceLevel(null);
                      setDepthCollapsed(true);
                    }}
                    className="absolute right-1 top-1 z-10 rounded border border-border bg-surface px-1.5 py-0.5 text-[0.75rem] leading-none text-muted transition-colors hover:text-text"
                    title="Hide depth chart"
                  >
                    ▸
                  </button>
                  <div className="flex-1 min-h-0">
                    <DepthChart />
                  </div>
                </div>
              )}
            </div>
            )
          )}

          {chart != null && !chartCollapsed && selectedLiveOffer == null ? (
            <div
              role="separator"
              aria-label="Resize offers list"
              aria-orientation="horizontal"
              onPointerDown={handleOffersResizeStart}
              onPointerMove={handleOffersResizeMove}
              onPointerUp={handleOffersResizeEnd}
              onPointerCancel={handleOffersResizeEnd}
              className="group hidden h-1 shrink-0 cursor-ns-resize items-center justify-center lg:flex"
            >
              <span className="h-1 w-16 rounded-full bg-border transition-colors group-hover:bg-accent" />
            </div>
          ) : null}

          <div
            ref={offersListPanelRef}
            style={chart != null && !chartCollapsed && offersListHeight != null ? { flex: '0 0 auto', height: `${offersListHeight}px` } : undefined}
            className={`min-h-0 rounded-lg border border-border overflow-hidden flex flex-col ${chart != null && (!chartCollapsed || selectedLiveOffer != null) ? `min-h-56 lg:min-h-0 ${offersListHeight == null ? 'lg:flex-2' : ''}` : 'flex-1'}`}
          >
          {viewMode === 'live' ? (
            <LiveOffersList
              offers={listedLiveOffers}
              observedLiveCount={contextOffers.filter(isOfferLive).length}
              fiat={liveFilters.fiat}
              timezone={timezone}
              // A background core-data request must not replace a deliberately
              // empty filtered result with an unrelated loading spinner.
              loading={loading && !contextOffers.some(isOfferLive)}
              chartEnabled={chart != null}
              isChartOfferVisible={isChartOfferVisible}
              toggleChartOfferKey={toggleChartOfferKey}
              setChartOfferKeysVisible={setChartOfferKeysVisible}
              onSelectOffer={offer => {
                const offerIndex = filteredOffers.indexOf(offer);
                setSelectedOfferKey(offerIndex >= 0 ? buildOfferKeys(filteredOffers)[offerIndex] : null);
              }}
              onCloseOffer={() => setSelectedOfferKey(null)}
              tradeMode={liveTradeMode}
              onTradeModeChange={setLiveTradeMode}
              scenarioMode={liveScenarioMode}
              onScenarioModeChange={setLiveScenarioMode}
              manualSelection={manualRouteSelection}
              onManualSelectionChange={setManualRouteSelection}
            />
          ) : (
          <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
            {expandedOrder != null ? (
              <div className="relative min-h-0 flex-1 overflow-y-auto bg-surface">
                <button
                  type="button"
                  aria-label="Close past offer details"
                  onClick={() => setExpandedId(null)}
                  className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded border-none bg-transparent text-xl leading-none text-red transition-colors hover:bg-red/10 hover:text-red/70"
                  title="Close"
                >
                  ×
                </button>
                <div className="px-3 py-2.5">
                  {scenarioDataPending ? (
                    <div className="flex items-center gap-3 px-1 py-2 text-[0.78rem] text-muted">
                      <LoadingSpinner size={28} />
                      <span>Selected-volume breakdown is still being calculated.</span>
                    </div>
                  ) : !expandedDetailedOrder ? (
                    <div className="flex items-center gap-3 px-1 py-2 text-[0.78rem] text-muted">
                      <LoadingSpinner size={28} />
                      <span>Detailed row analysis is still loading.</span>
                    </div>
                  ) : (
                    <PastOrderBreakdown
                      order={expandedDetailedOrder}
                      scenarioMode={expandedScenarioMode}
                      onScenarioModeChange={setExpandedScenarioMode}
                    />
                  )}
                </div>
              </div>
            ) : (
            <div ref={tradesListRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
              {sortedOrders.length > 0 && (
                <ProfitableTradesHeader
                  fiat={fiat}
                  sizeUnit={sizeUnit}
                  onSizeUnitChange={setSizeUnit}
                  netProfitUnit={netProfitUnit}
                  onNetProfitUnitChange={setNetProfitUnit}
                  sort={sort}
                  onSort={handleSort}
                  showChartColumn={chart != null}
                  allChartVisible={allChartVisible}
                  someChartVisible={someChartVisible}
                  onToggleAllChartVisible={visible => setChartOfferKeysVisible(sortedStableKeys, visible)}
                />
              )}
              {ordersLoading && fastOrders.length === 0 ? (
                <div className="relative min-h-64">
                  <LoadingSpinner size={112} label="Loading profitable trades" />
                </div>
              ) : sortedOrders.length === 0 ? (
                <div className="px-3 py-4 text-[0.75rem] text-muted">
                  {selectedPriceLevel != null
                    ? 'No profitable closed trades in the selected price level.'
                    : 'No profitable closed trades in this window for the selected net mode.'}
                </div>
              ) : (
                <div
                  className="relative min-w-[40rem] sm:min-w-[48rem] lg:min-w-0 lg:w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const order = sortedOrders[virtualRow.index];
                  const stableKey = sortedStableKeys[virtualRow.index];
                  const activeScenario = orderScenarioSummary(order, mode);
                  const detailedOrder = isDetailedOrder(order) ? order : detailedOrdersByID.get(order.id);
                  const detailReady = !!detailedOrder;
                  const firstSeenLabel = formatDateTimeLabel(order.status.first_seen ?? '', timezone);
                  const seenLabel = formatDateTimeLabel(order.status.last_seen ?? '', timezone);
                  const paymentMethod = order.payment_methods?.join(', ') || 'Unknown method';

                  return (
                    <div
                      key={order.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className="border-b border-border last:border-0"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpanded(order, false, detailedOrder)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleExpanded(order, false, detailedOrder);
                          }
                        }}
                        className="w-full min-w-0 cursor-pointer px-3 py-2 text-left transition-colors hover:bg-white/5"
                      >
                        <div data-testid="past-offers-row" className={`${PROFITABLE_TRADES_GRID_COLS} text-[0.72rem]`}>
                          <div className="min-w-0 overflow-hidden">
                            <ExchangeTag exchange={order.exchange} />
                          </div>
                          <span className={`truncate text-[0.65rem] font-semibold uppercase ${order.direction === 'bid' ? 'text-green' : 'text-red'}`}>
							{order.direction === 'bid' ? 'Bid' : 'Ask'}
                          </span>
                          <TradeRowMetric
                            value={orderPremiumPercent(order) != null ? `${orderPremiumPercent(order)!.toFixed(1)}%` : '—'}
                            valueClassName={premiumClass(orderPremiumPercent(order))}
                          />
                          <span className="min-w-0 truncate font-medium text-text" title={paymentMethod}>
                            {paymentMethod}
                          </span>
                          <TradeRowMetric value={firstSeenLabel} className="hidden lg:block" />
                          <TradeRowMetric value={seenLabel} className="hidden lg:block" />
                          <TradeRowMetric value={order.status.duration?.display || '—'} className="hidden sm:block" />
                          {(() => {
                            if (scenarioDataPending) return <TradeRowMetric value="Calculating…" />;
                            const volume = fmtVolume(
                              sizeUnit === 'btc' ? activeScenario.tradeSizeBTC : activeScenario.tradeSizeFiat,
                              sizeUnit,
                              activeScenario.volumeUnit,
                              fiat,
                            );
                            return <TradeRowMetric value={volume.text} title={volume.title} />;
                          })()}
                          <TradeRowMetric
                            value={scenarioDataPending ? 'Calculating…' : netProfitUnit === 'btc' ? fmtBTC(activeScenario.profitBTC) : fmtFiat(activeScenario.profitFiat, fiat)}
                            valueClassName="text-green"
                          />
                          <span className="flex shrink-0 items-center justify-center" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                            {chart != null && (
                              <input
                                type="checkbox"
                                checked={isChartOfferVisible(stableKey)}
                                onChange={() => toggleChartOfferKey(stableKey)}
                                title="Show on OHLC chart"
                              />
                            )}
                          </span>
                          <span className="shrink-0 text-right text-muted">{detailReady ? '▼' : '…'}</span>
                        </div>
                      </div>

                    </div>
                  );
                })}
                </div>
              )}
            </div>
            )}
          </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
