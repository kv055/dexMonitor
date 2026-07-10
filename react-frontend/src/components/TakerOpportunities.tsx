import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Offer, PastOrderStats, PastProfitableOrder, PastProfitableOrderCompact, TakerOpportunityMode } from '../types';
import { usePreferences } from '../hooks/usePreferences';
import { useFilters } from '../hooks/useFilters';
import { useTimezone } from '../hooks/useTimezone';
import { buildStableOfferKey } from '../utils/offerIdentity';
import { durationMinutes, formatDateTimeLabel, parseUtcTimestamp } from '../utils/formatters';
import {
  getBtcMax,
  getBtcMin,
  getCappedTradeSizeBtc,
  getDisplayAbortCost,
  getDisplayCostBreakdown,
  getFiatMax,
  getFiatMin,
  getFirstSeen,
  getLastSeen,
  getNetPremiumPercent,
  getOfferPrice,
  getPriceType,
  getRawPremiumPercent,
  getRefPrice,
  hasCappedScenario,
  isOfferLive,
  pastProfitableOrderAsOffer,
} from '../utils/offerAccess';
import { CostBreakdownPanel, OfferTimeMeta, SizeToggle } from './OfferBreakdownPanel';
import { ExchangeTag } from './ExchangeTag';
import { LoadingSpinner } from './LoadingSpinner';

interface Props {
  stats: PastOrderStats | null;
  statsAll: PastOrderStats | null;
  statsNetCapped: PastOrderStats | null;
  statsAllNetCapped: PastOrderStats | null;
  fastOrders: PastProfitableOrderCompact[];
  detailedOrders: PastProfitableOrder[];
  statsLoading: boolean;
  ordersLoading: boolean;
  cappedLoading: boolean;
  maxFiatLimit: number | null;
  /** Renders the OHLC chart panel; receives the filtered orders as chart overlays. */
  chart?: (extraOffers: Offer[]) => ReactNode;
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

type DirectionFilter = 'both' | 'buy' | 'sell';

function pickScenario(order: PastProfitableOrder, mode: TakerOpportunityMode) {
  // In capped mode, always use the server-computed capped scenario when present.
  // (Orders below the cap have capped_volume == null and keep their full value.)
  // Orders that turn net-negative once capped are dropped by isProfitableInMode,
  // rather than misleadingly falling back to their full-size profit here.
  if (mode === 'net_capped' && order.analysis.capped_volume) {
    return order.analysis.capped_volume;
  }
  return order.analysis.full_volume;
}

function isProfitableInMode(order: PastProfitableOrder, mode: TakerOpportunityMode): boolean {
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

function orderScenarioSummary(order: DisplayOrder, mode: TakerOpportunityMode) {
  if (isDetailedOrder(order)) {
    const scenario = pickScenario(order, mode);
    return {
      tradeSizeBTC: scenario.trade_size_btc,
      tradeSizeFiat: scenario.trade_size_fiat,
      profitBTC: scenario.profit.avg_btc ?? 0,
      profitFiat: scenario.profit.avg_fiat ?? 0,
      netPercent: scenario.premium.avg_net_percent ?? 0,
    };
  }
  return {
    tradeSizeBTC: order.summary.trade_size_btc,
    tradeSizeFiat: order.summary.trade_size_fiat,
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
  | 'payment_method'
  | 'first_seen'
  | 'last_seen'
  | 'duration'
  | 'size'
  | 'net_profit';

type SortDir = 'asc' | 'desc';

interface SortState {
  column: SortColumn;
  dir: SortDir;
}

// Direction a column starts with on first click: text columns A–Z, metrics newest/largest first.
const DEFAULT_SORT_DIR: Record<SortColumn, SortDir> = {
  exchange: 'asc',
  direction: 'asc',
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

interface PersistedInsightsFilters {
  selectedTimeframe: string;
  directionFilter: DirectionFilter;
  disabledExchanges: string[];
  mode: TakerOpportunityMode;
  sortColumn: SortColumn;
  sortDir: SortDir;
  netProfitUnit: NetProfitUnit;
  sizeUnit: SizeUnit;
  summaryUnit: SizeUnit;
  durationMin: number | null;
  durationMax: number | null;
  profitFiatMin: number | null;
  profitFiatMax: number | null;
}

const DEFAULT_INSIGHTS_FILTERS: PersistedInsightsFilters = {
  selectedTimeframe: '24h',
  directionFilter: 'both',
  disabledExchanges: [],
  mode: 'net_full',
  sortColumn: 'last_seen',
  sortDir: 'desc',
  netProfitUnit: 'fiat',
  sizeUnit: 'btc',
  summaryUnit: 'btc',
  durationMin: null,
  durationMax: null,
  profitFiatMin: null,
  profitFiatMax: null,
};

const VALID_TIMEFRAMES = new Set(['1h', '6h', '24h', '48h', '7d']);
const VALID_DIRECTIONS = new Set<DirectionFilter>(['both', 'buy', 'sell']);
const VALID_MODES = new Set<TakerOpportunityMode>(['net_full', 'net_capped']);
const VALID_NET_PROFIT_UNITS = new Set<NetProfitUnit>(['btc', 'fiat']);
const VALID_SIZE_UNITS = new Set<SizeUnit>(['btc', 'fiat']);
const VALID_SORT_COLUMNS = new Set<SortColumn>([
  'exchange',
  'direction',
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
// falls back to the default sort.
const LEGACY_SORT_KEY_MAP: Record<string, SortState> = {
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
  return { column: DEFAULT_INSIGHTS_FILTERS.sortColumn, dir: DEFAULT_INSIGHTS_FILTERS.sortDir };
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

function readPersistedInsightsFilters(): PersistedInsightsFilters {
  try {
    const raw = localStorage.getItem(INSIGHTS_FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_INSIGHTS_FILTERS;
    const parsed = JSON.parse(raw) as Partial<PersistedInsightsFilters> & { sortBy?: string };
    const sort = readPersistedSort(parsed);
    return {
      selectedTimeframe: VALID_TIMEFRAMES.has(parsed.selectedTimeframe ?? '')
        ? parsed.selectedTimeframe!
        : DEFAULT_INSIGHTS_FILTERS.selectedTimeframe,
      directionFilter: VALID_DIRECTIONS.has(parsed.directionFilter as DirectionFilter)
        ? parsed.directionFilter as DirectionFilter
        : DEFAULT_INSIGHTS_FILTERS.directionFilter,
      disabledExchanges: readStringArray(parsed.disabledExchanges),
      mode: VALID_MODES.has(parsed.mode as TakerOpportunityMode)
        ? parsed.mode as TakerOpportunityMode
        : DEFAULT_INSIGHTS_FILTERS.mode,
      sortColumn: sort.column,
      sortDir: sort.dir,
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
      profitFiatMin: readNullableNumber(parsed.profitFiatMin, PERSISTED_PROFIT_BOUNDS),
      profitFiatMax: readNullableNumber(parsed.profitFiatMax, PERSISTED_PROFIT_BOUNDS),
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

function profitFiatToCents(profit: number): number {
  return Math.round(profit * 100);
}

function profitFiatFromCents(cents: number): number {
  return cents / 100;
}

interface ProfitFiatBounds {
  minCents: number;
  maxCents: number;
  sliderMaxCents: number;
  hasData: boolean;
}

function computeProfitFiatBounds(
  orders: DisplayOrder[],
  mode: TakerOpportunityMode,
): ProfitFiatBounds {
  let min = Infinity;
  let max = -Infinity;
  for (const order of orders) {
    const profit = orderNetProfitFiat(order, mode);
    if (profit < min) min = profit;
    if (profit > max) max = profit;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { minCents: 0, maxCents: 0, sliderMaxCents: 0, hasData: false };
  }
  const minCents = Math.floor(min * 100);
  const maxCents = Math.ceil(max * 100);
  return {
    minCents,
    maxCents,
    sliderMaxCents: minCents === maxCents ? maxCents + 1 : maxCents,
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
  // Each comparator sorts ascending; the sign flip below applies the direction.
  const compare = (a: DisplayOrder, b: DisplayOrder): number => {
    switch (sort.column) {
      case 'exchange':
        return a.exchange.localeCompare(b.exchange, 'de');
      case 'direction':
        return a.direction.localeCompare(b.direction, 'de');
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

interface PillGroupProps {
  label: string;
  description: string;
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
  selected: string;
  onChange: (v: string) => void;
}

function PillGroup({ label, description, options, selected, onChange }: PillGroupProps) {
  const base = 'rounded border px-2 py-0.5 text-[0.7rem] font-medium transition-colors';
  const active = 'border-accent/60 bg-accent/10 text-accent';
  const inactive = 'border-border bg-bg/40 text-muted hover:text-text';
  const disabledCls = 'border-border bg-bg/40 text-muted opacity-40 cursor-not-allowed';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            title={o.title ?? description}
            disabled={o.disabled}
            onClick={() => { if (!o.disabled) onChange(o.value); }}
            className={`${base} ${o.disabled ? disabledCls : selected === o.value ? active : inactive}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function exchangeFilterLabel(name: string): string {
  if (name === 'bisq') return 'Bisq v1';
  if (name === 'bisq2') return 'Bisq v2';
  if (name === 'hodlhodl') return 'HodlHodl';
  if (name === 'robosats') return 'RoboSats';
  if (name === 'peachbitcoin') return 'Peach';
  return name;
}

interface ExchangeFilterGroupProps {
  label: string;
  description: string;
  exchanges: string[];
  counts: Record<string, number>;
  disabled: Set<string>;
  onToggle: (exchange: string) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}

function ExchangeFilterGroup({
  label,
  description,
  exchanges,
  counts,
  disabled,
  onToggle,
  onEnableAll,
  onDisableAll,
}: ExchangeFilterGroupProps) {
  const base = 'rounded border px-2 py-0.5 text-[0.7rem] font-medium transition-colors';
  const enabledCls = 'border-accent/60 bg-accent/10 text-accent';
  const disabledCls = 'border-border bg-bg/40 text-muted line-through opacity-60 hover:opacity-80';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
        {exchanges.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onEnableAll} className="text-[0.6rem] font-medium text-muted hover:text-accent">
              All
            </button>
            <button type="button" onClick={onDisableAll} className="text-[0.6rem] font-medium text-muted hover:text-accent">
              None
            </button>
          </div>
        )}
      </div>
      {exchanges.length === 0 ? (
        <span className="text-[0.7rem] text-muted">No exchanges in this window</span>
      ) : (
        <div className="flex flex-wrap items-center gap-1" title={description}>
          {exchanges.map(exchange => {
            const isEnabled = !disabled.has(exchange);
            return (
              <button
                key={exchange}
                type="button"
                onClick={() => onToggle(exchange)}
                className={`${base} ${isEnabled ? enabledCls : disabledCls}`}
              >
                {exchangeFilterLabel(exchange)}
                <span className="ml-1 text-[0.65rem] opacity-70">{counts[exchange] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SelectGroupProps {
  label: string;
  description: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (v: string) => void;
}

function SelectGroup({ label, description, options, selected, onChange }: SelectGroupProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <select
        title={description}
        value={selected}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded border border-border bg-bg/60 px-2 py-1.5 text-[0.75rem] font-medium text-text outline-none transition-colors hover:border-accent/50 focus:border-accent"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface DualRangeFilterProps {
  label: string;
  description: string;
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  formatValue: (value: number) => string;
  disabled?: boolean;
  disabledMessage?: string;
  step?: number;
}

function DualRangeFilter({
  label,
  description,
  min,
  max,
  value,
  onChange,
  formatValue,
  disabled,
  disabledMessage = 'No data in this window',
  step = 1,
}: DualRangeFilterProps) {
  const [lo, hi] = value;
  const span = Math.max(max - min, step);
  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;
  const rangeInputClass =
    'pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent [&::-moz-range-thumb]:bg-bg [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-bg [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent';

  if (disabled) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
        <span className="text-[0.7rem] text-muted">{disabledMessage}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" title={description}>
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex justify-between gap-2 text-[0.65rem] text-muted mono-nums tabular-nums">
        <span>{formatValue(lo)}</span>
        <span>{formatValue(hi)}</span>
      </div>
      <div className="relative mx-0.5 h-6">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded bg-border" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-accent/60"
          style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={event => onChange([Math.min(Number(event.target.value), hi), hi])}
          className={rangeInputClass}
          style={{ zIndex: lo > max - step * 10 ? 5 : 3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={event => onChange([lo, Math.max(Number(event.target.value), lo)])}
          className={rangeInputClass}
          style={{ zIndex: 4 }}
        />
      </div>
    </div>
  );
}

const PROFITABLE_TRADES_GRID_COLS =
  'grid min-w-[40rem] grid-cols-[minmax(7rem,0.85fr)_minmax(2.75rem,0.3fr)_minmax(8rem,1fr)_minmax(5.5rem,0.75fr)_minmax(6.75rem,0.95fr)_1.25rem_1.25rem] items-center gap-2 sm:min-w-[48rem] sm:grid-cols-[minmax(7rem,0.75fr)_minmax(2.75rem,0.3fr)_minmax(8rem,1fr)_minmax(5.25rem,0.6fr)_minmax(5.75rem,0.75fr)_minmax(6.5rem,0.85fr)_1.25rem_1.25rem] lg:min-w-0 lg:w-full lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.28fr)_minmax(0,0.85fr)_minmax(0,0.65fr)_minmax(0,0.65fr)_minmax(0,0.55fr)_minmax(0,0.95fr)_minmax(0,1.15fr)_1.25rem_1.25rem] sm:gap-3';

interface TradeRowMetricProps {
  value: string;
  valueClassName?: string;
  className?: string;
}

function TradeRowMetric({ value, valueClassName = 'text-text', className = '' }: TradeRowMetricProps) {
  return (
    <span className={`block min-w-0 truncate text-right mono-nums tabular-nums ${valueClassName} ${className}`} title={value}>
      {value}
    </span>
  );
}

function unitToggleButtonClass(active: boolean): string {
  return `rounded px-1 normal-case transition-colors ${active ? 'text-accent font-semibold' : 'text-muted hover:text-text'}`;
}

function UnitToggle({ fiat, unit, onChange }: { fiat: string; unit: SizeUnit; onChange: (unit: SizeUnit) => void }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <button type="button" onClick={() => onChange('btc')} className={unitToggleButtonClass(unit === 'btc')}>BTC</button>
      <span className="text-border">|</span>
      <button type="button" onClick={() => onChange('fiat')} className={unitToggleButtonClass(unit === 'fiat')}>{fiat}</button>
    </span>
  );
}

function SortHeaderButton({ label, column, sort, onSort, align = 'right' }: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.column === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`flex min-w-0 items-center gap-1 border-none bg-transparent p-0 text-[0.65rem] font-semibold uppercase tracking-wide transition-colors ${align === 'right' ? 'justify-end text-right' : 'justify-start text-left'} ${active ? 'text-accent' : 'text-muted hover:text-text'}`}
    >
      <span className="truncate">{label}</span>
      <span className={`shrink-0 text-[0.55rem] leading-none ${active ? '' : 'opacity-50'}`} aria-hidden>
        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
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
    <div className={`${PROFITABLE_TRADES_GRID_COLS} shrink-0 border-b border-border bg-surface/70 px-3 py-1.5`}>
      <SortHeaderButton label="Offer" column="exchange" sort={sort} onSort={onSort} align="left" />
      <SortHeaderButton label="Dir" column="direction" sort={sort} onSort={onSort} align="left" />
      <SortHeaderButton label="Payment method" column="payment_method" sort={sort} onSort={onSort} align="left" />
      <span className="hidden lg:flex">
        <SortHeaderButton label="First seen" column="first_seen" sort={sort} onSort={onSort} align="right" />
      </span>
      <span className="hidden lg:flex">
        <SortHeaderButton label="Last seen" column="last_seen" sort={sort} onSort={onSort} align="right" />
      </span>
      <span className="hidden sm:flex lg:hidden">
        <SortHeaderButton label="Duration" column="duration" sort={sort} onSort={onSort} />
      </span>
      <span className="hidden lg:flex">
        <SortHeaderButton label="Duration" column="duration" sort={sort} onSort={onSort} />
      </span>
      <span className={`${th} hidden items-center justify-end gap-1 sm:flex lg:hidden`}>
        <SortHeaderButton label="Size" column="size" sort={sort} onSort={onSort} />
        <UnitToggle fiat={fiat} unit={sizeUnit} onChange={onSizeUnitChange} />
      </span>
      <span className={`${th} hidden items-center justify-end gap-1 sm:flex lg:hidden`}>
        <SortHeaderButton label="Net profit" column="net_profit" sort={sort} onSort={onSort} />
        <UnitToggle fiat={fiat} unit={netProfitUnit} onChange={onNetProfitUnitChange} />
      </span>
      <span className={`${th} flex items-center justify-end gap-1 sm:hidden`}>
        <SortHeaderButton label="Size" column="size" sort={sort} onSort={onSort} />
      </span>
      <span className={`${th} flex items-center justify-end gap-1 sm:hidden`}>
        <SortHeaderButton label="Profit" column="net_profit" sort={sort} onSort={onSort} />
      </span>
      <span className={`${th} hidden items-center justify-end gap-1 lg:flex`}>
        <SortHeaderButton label="Size" column="size" sort={sort} onSort={onSort} />
        <UnitToggle fiat={fiat} unit={sizeUnit} onChange={onSizeUnitChange} />
      </span>
      <span className={`${th} hidden items-center justify-end gap-1 lg:flex`}>
        <SortHeaderButton label="Net profit" column="net_profit" sort={sort} onSort={onSort} />
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

function offerNumber(raw: Record<string, string | number | boolean | null>, key: string): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatRange(minLabel: string, maxLabel: string): string | null {
  if (minLabel === '—' && maxLabel === '—') return null;
  if (minLabel !== '—' && maxLabel !== '—') return `${minLabel} – ${maxLabel}`;
  if (minLabel !== '—') return `from ${minLabel}`;
  return `up to ${maxLabel}`;
}

function PastOfferDetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-bg px-2.5 py-2 text-[0.68rem]">
      <div className="mb-1.5 text-[0.62rem] font-semibold uppercase tracking-widest text-muted">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function PastOfferDetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted shrink-0">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-text mono-nums tabular-nums" title={hint ?? value}>
        {value}
      </span>
    </div>
  );
}

function PastOfferSupplementalDetails({ order, offer, fiat }: {
  order: PastProfitableOrder;
  offer: Offer;
  fiat: string;
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

  const hasPricing = offerPrice > 0 || refPrice != null;
  const hasVolume = fiatRange != null || avgObservedBtc != null;

  if (!hasPricing && !hasVolume) return null;

  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {hasPricing && (
        <PastOfferDetailSection title="Pricing">
          {offerPrice > 0 && (
            <PastOfferDetailRow label="DEX offer price" value={fmtFiat(offerPrice, fiat)} />
          )}
          {refPrice != null && (
            <PastOfferDetailRow label="CEX reference price" value={fmtFiat(refPrice, fiat)} />
          )}
        </PastOfferDetailSection>
      )}

      {hasVolume && (
        <PastOfferDetailSection title="Volume limits">
          {fiatRange != null && (
            <PastOfferDetailRow label={`${fiat} range`} value={fiatRange} />
          )}
          {avgObservedBtc != null && (
            <PastOfferDetailRow
              label="Avg observed size"
              value={fmtBTC(avgObservedBtc)}
              hint="Lifecycle average while the offer was live"
            />
          )}
        </PastOfferDetailSection>
      )}
    </div>
  );
}

function PastOrderBreakdown({ order, showCapped, onToggleCapped }: {
  order: PastProfitableOrder;
  showCapped: boolean;
  onToggleCapped: (value: boolean) => void;
}) {
  const { timezone } = useTimezone();
  const offer = pastProfitableOrderAsOffer(order);
  const refPrice = getRefPrice(offer);
  // The control-panel mode can request the capped view for an offer that has no
  // capped scenario (e.g. it sits below the cap); fall back to the full breakdown.
  const showCappedEffective = showCapped && hasCappedScenario(offer);
  const costBreakdown = getDisplayCostBreakdown(offer, showCappedEffective);
  const offerPrice = getOfferPrice(offer);
  const btcVolumeRange = formatRange(fmtBTC(getBtcMin(offer)), fmtBTC(getBtcMax(offer)));

  return (
    <div className="flex flex-col gap-3">
      <OfferTimeMeta
        firstSeen={getFirstSeen(offer)}
        lastSeen={getLastSeen(offer)}
        isLive={isOfferLive(offer)}
        timezone={timezone}
        priceType={getPriceType(offer)}
      />
      <div className="text-[0.68rem] text-muted" title="Internal offer ID">
        <span className="uppercase tracking-wide text-[0.6rem] mr-1">ID</span>
        <span className="text-text">{order.offer_id ?? order.id}</span>
      </div>
      {order.payment_methods?.length ? (
        <div className="text-[0.68rem] text-muted">
          <span className="uppercase tracking-wide text-[0.6rem] mr-1">Payment</span>
          <span className="text-text">{order.payment_methods.join(', ')}</span>
        </div>
      ) : null}
      {btcVolumeRange && (
        <div className="text-[0.68rem] text-muted">
          <span className="uppercase tracking-wide text-[0.6rem] mr-1">Volume</span>
          <span className="text-text">{btcVolumeRange}</span>
        </div>
      )}
      <PastOfferSupplementalDetails
        order={order}
        offer={offer}
        fiat={order.pricing.fiat_currency || 'EUR'}
      />
      {costBreakdown ? (
        <div className="flex flex-col gap-3">
          {hasCappedScenario(offer) && (
            <SizeToggle
              mode={showCappedEffective ? 'capped' : 'full'}
              onModeChange={mode => onToggleCapped(mode === 'capped')}
              fullBtc={getDisplayCostBreakdown(offer, 'full')?.btc_amount ?? getBtcMax(offer)}
              cappedBtc={getCappedTradeSizeBtc(offer)}
              refPrice={refPrice}
            />
          )}
          <CostBreakdownPanel
            bd={costBreakdown}
            abortCost={getDisplayAbortCost(offer, showCappedEffective)}
            priceDiffPct={getRawPremiumPercent(offer)}
            netPremiumPct={getNetPremiumPercent(offer, showCappedEffective)}
            refPrice={refPrice}
            offerPrice={offerPrice}
          />
        </div>
      ) : (
        <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
      )}
    </div>
  );
}

export function TakerOpportunities({ stats, statsNetCapped, fastOrders, detailedOrders, ordersLoading, cappedLoading, maxFiatLimit, chart }: Props) {
  const displayedOrders = detailedOrders.length > 0 ? detailedOrders : fastOrders;
  const deferredOrders = useDeferredValue(displayedOrders);
  const ordersPending = deferredOrders !== displayedOrders;
  const { timezone } = useTimezone();
  const { excludedMethods } = usePreferences();
  const { hiddenChartOfferKeys, toggleChartOfferKey, setChartOfferKeysVisible } = useFilters();
  const [initialFilters] = useState(readPersistedInsightsFilters);
  const initialCapAvailable = maxFiatLimit != null && maxFiatLimit > 0;
  const initialCappedModePending = initialFilters.mode === 'net_capped' && cappedLoading && detailedOrders.length === 0;
  const [referenceNowMs] = useState(() => Date.now());
  const [selectedTimeframe, setSelectedTimeframe] = useState(initialFilters.selectedTimeframe);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>(initialFilters.directionFilter);
  const [disabledExchanges, setDisabledExchanges] = useState<string[]>(initialFilters.disabledExchanges);
  const [mode, setMode] = useState<TakerOpportunityMode>(
    initialFilters.mode === 'net_capped' && (!initialCapAvailable || initialCappedModePending)
      ? 'net_full'
      : initialFilters.mode,
  );
  const [sort, setSort] = useState<SortState>({ column: initialFilters.sortColumn, dir: initialFilters.sortDir });
  const [netProfitUnit, setNetProfitUnit] = useState<NetProfitUnit>(initialFilters.netProfitUnit);
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>(initialFilters.sizeUnit);
  const [summaryUnit, setSummaryUnit] = useState<SizeUnit>(initialFilters.summaryUnit);
  const [durationRange, setDurationRange] = useState<[number, number] | null>(null);
  const [profitFiatRangeCents, setProfitFiatRangeCents] = useState<[number, number] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedShowCapped, setExpandedShowCapped] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const persistedDurationRef = useRef({
    min: initialFilters.durationMin,
    max: initialFilters.durationMax,
  });
  const persistedProfitFiatRef = useRef({
    minCents: initialFilters.profitFiatMin != null ? profitFiatToCents(initialFilters.profitFiatMin) : null,
    maxCents: initialFilters.profitFiatMax != null ? profitFiatToCents(initialFilters.profitFiatMax) : null,
  });
  const durationBoundsInitializedRef = useRef(false);
  const profitFiatBoundsInitializedRef = useRef(false);
  const lastProfitFiatBoundsRef = useRef<{ minCents: number; maxCents: number } | null>(null);
  const profitFiatModeRef = useRef(mode);
  const tradesListRef = useRef<HTMLDivElement>(null);
  const detailedOrdersByID = useMemo(() => new Map(detailedOrders.map(order => [order.id, order])), [detailedOrders]);

  const hasExcluded = (stats?.excluded_payment_methods?.length ?? 0) > 0;
  const cappedOffersPending = cappedLoading && detailedOrders.length === 0;
  const cappedDataPending = mode === 'net_capped' && cappedOffersPending;
  const activeStats = mode === 'net_capped' ? (statsNetCapped ?? stats) : stats;
  const activeOrders = useMemo(() => {
    if (cappedDataPending) {
      return [] as DisplayOrder[];
    }
    let list = deferredOrders.filter(order => displayOrderProfitable(order, mode));
    if (hasExcluded) {
      list = list.filter(order => !order.payment_methods?.some(m => excludedMethods.includes(m)));
    }
    return list;
  }, [cappedDataPending, deferredOrders, mode, hasExcluded, excludedMethods]);

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
    setExpandedShowCapped(mode === 'net_capped');
  }, [mode]);

  const fiat = activeStats?.fiat_currency || 'EUR';
  const selected = !activeStats
    ? null
    : activeStats.timeframes.find(row => row.timeframe === selectedTimeframe)
      ?? activeStats.timeframes.find(row => row.timeframe === '24h')
      ?? activeStats.timeframes[0]
      ?? null;
  const activeTimeframe = selected?.timeframe ?? selectedTimeframe;
  const cutoffMs = referenceNowMs - timeframeHours(activeTimeframe) * 60 * 60 * 1000;

  const disabledExchangeSet = useMemo(() => new Set(disabledExchanges), [disabledExchanges]);

  const exchangeFilterBase = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const order of activeOrders) {
      const lastSeen = parseUtcTimestamp(order.status.last_seen);
      if (lastSeen == null || lastSeen.getTime() < cutoffMs) continue;
      if (directionFilter !== 'both' && order.direction !== directionFilter) continue;
      counts[order.exchange] = (counts[order.exchange] ?? 0) + 1;
    }
    const exchanges = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'de'));
    return { counts, exchanges };
  }, [activeOrders, cutoffMs, directionFilter]);

  const ordersBeforeDurationFilter = useMemo(() => {
    return activeOrders.filter(order => {
      const lastSeen = parseUtcTimestamp(order.status.last_seen);
      if (lastSeen == null || lastSeen.getTime() < cutoffMs) return false;
      if (directionFilter !== 'both' && order.direction !== directionFilter) return false;
      if (disabledExchangeSet.has(order.exchange)) return false;
      return true;
    });
  }, [activeOrders, cutoffMs, directionFilter, disabledExchangeSet]);

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
    () => cappedDataPending
      ? { minCents: 0, maxCents: 0, sliderMaxCents: 0, hasData: false }
      : computeProfitFiatBounds(ordersAfterDurationFilter, mode),
    [cappedDataPending, ordersAfterDurationFilter, mode],
  );

  useEffect(() => {
    if (!profitFiatBounds.hasData) return;

    const modeChanged = profitFiatModeRef.current !== mode;
    if (modeChanged) {
      profitFiatModeRef.current = mode;
      profitFiatBoundsInitializedRef.current = false;
    }

    const bounds = { min: profitFiatBounds.minCents, max: profitFiatBounds.maxCents };
    const lastBounds = lastProfitFiatBoundsRef.current;
    const boundsChanged = lastBounds != null
      && (lastBounds.minCents !== bounds.min || lastBounds.maxCents !== bounds.max);

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
      if (boundsChanged && prev[0] === lastBounds!.minCents && prev[1] === lastBounds!.maxCents) {
        return [bounds.min, bounds.max];
      }
      return clampNumericRange(prev, bounds);
    });

    lastProfitFiatBoundsRef.current = {
      minCents: profitFiatBounds.minCents,
      maxCents: profitFiatBounds.maxCents,
    };
  }, [mode, profitFiatBounds, durationRange]);

  useLayoutEffect(() => {
    const atFullDurationRange = durationBounds.hasData
      && durationRange != null
      && durationRange[0] === durationBounds.min
      && durationRange[1] === durationBounds.max;
    const atFullProfitRange = profitFiatBounds.hasData
      && profitFiatRangeCents != null
      && profitFiatRangeCents[0] === profitFiatBounds.minCents
      && profitFiatRangeCents[1] === profitFiatBounds.maxCents;
    const payload: PersistedInsightsFilters = {
      selectedTimeframe,
      directionFilter,
      disabledExchanges,
      mode,
      sortColumn: sort.column,
      sortDir: sort.dir,
      netProfitUnit,
      sizeUnit,
      summaryUnit,
      durationMin: !durationBounds.hasData || atFullDurationRange || durationRange == null
        ? null
        : durationRange[0],
      durationMax: !durationBounds.hasData || atFullDurationRange || durationRange == null
        ? null
        : durationRange[1],
      profitFiatMin: !profitFiatBounds.hasData || atFullProfitRange || profitFiatRangeCents == null
        ? null
        : profitFiatFromCents(profitFiatRangeCents[0]),
      profitFiatMax: !profitFiatBounds.hasData || atFullProfitRange || profitFiatRangeCents == null
        ? null
        : profitFiatFromCents(profitFiatRangeCents[1]),
    };
    localStorage.setItem(INSIGHTS_FILTERS_STORAGE_KEY, JSON.stringify(payload));
  }, [
    selectedTimeframe,
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
    profitFiatRangeCents,
    profitFiatBounds.minCents,
    profitFiatBounds.maxCents,
    profitFiatBounds.hasData,
  ]);

  const filteredOrders = useMemo(() => {
    if (profitFiatRangeCents == null) {
      return ordersAfterDurationFilter;
    }
    const [lo, hi] = profitFiatRangeCents;
    return ordersAfterDurationFilter.filter(order => {
      const cents = profitFiatToCents(orderNetProfitFiat(order, mode));
      return cents >= lo && cents <= hi;
    });
  }, [ordersAfterDurationFilter, profitFiatRangeCents, mode]);

  const filteredSummary = useMemo(
    () => computeFilteredSummary(filteredOrders, mode),
    [filteredOrders, mode],
  );

  const sortedOrders = useMemo(
    () => sortProfitableOrders(filteredOrders, sort, mode, netProfitUnit, sizeUnit),
    [filteredOrders, sort, mode, netProfitUnit, sizeUnit],
  );

  // The filtered orders double as chart overlays. Only detailed orders carry
  // the pricing/analysis payload the chart needs; compact rows join once the
  // detailed pass lands. Per-offer visibility is applied by the chart itself
  // via hiddenChartOfferKeys.
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
    () => sortedStableKeys.filter(k => !hiddenChartOfferKeys.has(k)).length,
    [sortedStableKeys, hiddenChartOfferKeys],
  );
  const allChartVisible = sortedOrders.length > 0 && chartVisibleCount === sortedOrders.length;
  const someChartVisible = chartVisibleCount > 0 && chartVisibleCount < sortedOrders.length;

  const handleSort = useCallback((column: SortColumn) => {
    setSort(prev => prev.column === column
      ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { column, dir: DEFAULT_SORT_DIR[column] });
  }, []);

  const toggleExpanded = useCallback((order: DisplayOrder, isOpen: boolean, detailedOrder: PastProfitableOrder | undefined) => {
    if (isOpen) {
      setExpandedId(null);
      return;
    }
    setExpandedId(order.id);
    setExpandedShowCapped(mode === 'net_capped' && !!detailedOrder?.analysis.capped_volume);
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

  const toggleExchangeFilter = useCallback((exchange: string) => {
    setDisabledExchanges(prev =>
      prev.includes(exchange) ? prev.filter(name => name !== exchange) : [...prev, exchange],
    );
  }, []);

  const resetFilters = useCallback(() => {
    setSelectedTimeframe(DEFAULT_INSIGHTS_FILTERS.selectedTimeframe);
    setDirectionFilter(DEFAULT_INSIGHTS_FILTERS.directionFilter);
    setDisabledExchanges([]);
    setMode(DEFAULT_INSIGHTS_FILTERS.mode);
    setSort({ column: DEFAULT_INSIGHTS_FILTERS.sortColumn, dir: DEFAULT_INSIGHTS_FILTERS.sortDir });
    setNetProfitUnit(DEFAULT_INSIGHTS_FILTERS.netProfitUnit);
    setSizeUnit(DEFAULT_INSIGHTS_FILTERS.sizeUnit);
    setSummaryUnit(DEFAULT_INSIGHTS_FILTERS.summaryUnit);
    setExpandedId(null);
    setExpandedShowCapped(false);
    persistedDurationRef.current = { min: null, max: null };
    persistedProfitFiatRef.current = { minCents: null, maxCents: null };
    profitFiatBoundsInitializedRef.current = false;
    lastProfitFiatBoundsRef.current = null;
    if (durationBounds.hasData) {
      setDurationRange([durationBounds.min, durationBounds.max]);
    }
    if (profitFiatBounds.hasData) {
      setProfitFiatRangeCents([profitFiatBounds.minCents, profitFiatBounds.maxCents]);
      profitFiatBoundsInitializedRef.current = true;
    } else {
      setProfitFiatRangeCents(null);
    }
  }, [
    durationBounds.hasData,
    durationBounds.min,
    durationBounds.max,
    profitFiatBounds.hasData,
    profitFiatBounds.minCents,
    profitFiatBounds.maxCents,
  ]);

  const initialAnalyticsPending = !stats
    && fastOrders.length === 0
    && detailedOrders.length === 0;

  if (initialAnalyticsPending) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <LoadingSpinner size={112} label="Loading taker opportunities" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center px-3 text-[0.8rem] text-muted">
          No taker opportunity statistics available yet.
        </div>
      </div>
    );
  }

  const summaryRows = [
    { label: 'Orders', value: cappedDataPending ? 'Calculating…' : filteredSummary.premium_order_count.toLocaleString('de-DE'), className: 'text-text' },
    {
      label: 'Net profit',
      value: cappedDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.total_net_profit_btc) : fmtFiat(filteredSummary.total_net_profit_fiat, fiat),
      className: 'text-green',
    },
    {
      label: 'Avg Size',
      value: cappedDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.average_order_size_btc) : fmtFiat(filteredSummary.average_order_size_fiat, fiat),
      className: 'text-text',
    },
    {
      label: 'Smallest',
      value: cappedDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.smallest_order_size_btc) : fmtFiat(filteredSummary.smallest_order_size_fiat, fiat),
      className: 'text-muted',
    },
    {
      label: 'Biggest',
      value: cappedDataPending ? 'Calculating…' : summaryUnit === 'btc' ? fmtBTC(filteredSummary.biggest_order_size_btc) : fmtFiat(filteredSummary.biggest_order_size_fiat, fiat),
      className: 'text-muted',
    },
  ];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      {(ordersPending || cappedDataPending) && displayedOrders.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-border bg-surface/80 px-3 py-1 text-[0.68rem] text-muted">
          {cappedDataPending ? 'Calculating capped-volume profits…' : 'Updating profitable trades…'}
        </div>
      )}
      <div className="flex flex-1 min-h-0 flex-col gap-3 lg:flex-row">
        {filtersCollapsed ? (
          <button
            type="button"
            aria-label="Show Insights filters"
            aria-expanded={false}
            onClick={() => setFiltersCollapsed(false)}
            className="shrink-0 rounded-lg border border-border bg-bg/20 px-2 py-3 text-[0.68rem] font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface hover:text-text lg:w-9 lg:[writing-mode:vertical-rl] lg:rotate-180"
          >
            Filters ▸
          </button>
        ) : (
        <aside aria-label="Insights filters" className="flex shrink-0 flex-col gap-3 rounded-lg border border-border bg-bg/20 p-3 lg:w-72 xl:w-80 lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Filters</span>
            <button
              type="button"
              aria-label="Hide Insights filters"
              aria-expanded={true}
              onClick={() => setFiltersCollapsed(true)}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-[0.75rem] leading-none text-muted transition-colors hover:text-text"
              title="Hide filters"
            >
              ◂
            </button>
          </div>
          <SelectGroup
            label="Timeframe"
            description="Show stats for orders closed within this window"
            options={(activeStats ?? stats).timeframes.map(r => ({ value: r.timeframe, label: labelForTimeframe(r.timeframe) }))}
            selected={selected?.timeframe ?? selectedTimeframe}
            onChange={setSelectedTimeframe}
          />
          <PillGroup
            label="Direction"
            description="Filter the profitable trades list by offer side"
            options={[
              { value: 'both', label: 'Both' },
              { value: 'buy', label: 'Buy' },
              { value: 'sell', label: 'Sell' },
            ]}
            selected={directionFilter}
            onChange={v => setDirectionFilter(v as DirectionFilter)}
          />
          <ExchangeFilterGroup
            label="Exchanges"
            description="Click to include or exclude DEX exchanges from the profitable trades list"
            exchanges={exchangeFilterBase.exchanges}
            counts={exchangeFilterBase.counts}
            disabled={disabledExchangeSet}
            onToggle={toggleExchangeFilter}
            onEnableAll={() => setDisabledExchanges([])}
            onDisableAll={() => setDisabledExchanges([...exchangeFilterBase.exchanges])}
          />
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
          <DualRangeFilter
            label={`Net profit ${fiat}`}
            description="Filter profitable trades by net profit per order in fiat"
            min={profitFiatBounds.minCents}
            max={profitFiatBounds.sliderMaxCents}
            value={profitFiatRangeCents ?? [profitFiatBounds.minCents, profitFiatBounds.maxCents]}
            onChange={setProfitFiatRangeCents}
            formatValue={value => fmtFiat(profitFiatFromCents(value), fiat)}
            disabled={!profitFiatBounds.hasData || profitFiatRangeCents == null}
            disabledMessage={cappedDataPending ? 'Capped profit is still being calculated' : 'No profit data in this window'}
          />
          <PillGroup
            label="Premium mode"
            description="Net full uses full order size. Net capped applies your max fiat position limit where needed."
            options={[
              { value: 'net_full', label: 'Net Full' },
              {
                value: 'net_capped',
                label: maxFiatLimit != null && maxFiatLimit > 0 ? `Net Capped €${maxFiatLimit.toLocaleString('de-DE', { maximumFractionDigits: 0 })}` : 'Net Capped',
                disabled: !cappedModeAvailable,
                title: !capAvailable
                  ? 'Set a Max Position Size (Fiat) in Settings to enable capped mode'
                  : cappedOffersPending
                    ? 'Capped offers are still loading'
                    : undefined,
              },
            ]}
            selected={mode}
            onChange={v => setMode(v as TakerOpportunityMode)}
          />

          <button
            type="button"
            onClick={resetFilters}
            className="w-full rounded-md border-none bg-red px-2.5 py-1.5 text-[0.72rem] font-semibold text-black transition-opacity hover:opacity-85"
          >
            ↺ Reset filters
          </button>

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
        </aside>
        )}

        <div className="min-h-0 flex-1 flex flex-col gap-3">
          {chart != null && (chartCollapsed ? (
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
            <div className="min-h-72 lg:min-h-0 lg:flex-3 rounded-lg border border-border bg-surface p-3 flex flex-col">
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
                {chart(plottedChartOffers)}
              </div>
            </div>
          ))}

          <div className={`min-h-0 rounded-lg border border-border overflow-hidden flex flex-col ${chart != null && !chartCollapsed ? 'min-h-56 lg:min-h-0 lg:flex-2' : 'flex-1'}`}>
          <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
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
            <div ref={tradesListRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
              {ordersLoading && fastOrders.length === 0 ? (
                <div className="relative min-h-64">
                  <LoadingSpinner size={112} label="Loading profitable trades" />
                </div>
              ) : sortedOrders.length === 0 ? (
                <div className="px-3 py-4 text-[0.75rem] text-muted">No profitable closed trades in this window for the selected net mode.</div>
              ) : (
                <div
                  className="relative min-w-[40rem] sm:min-w-[48rem] lg:min-w-0 lg:w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const order = sortedOrders[virtualRow.index];
                  const stableKey = sortedStableKeys[virtualRow.index];
                  const isOpen = expandedId === order.id;
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
                        onClick={() => toggleExpanded(order, isOpen, detailedOrder)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleExpanded(order, isOpen, detailedOrder);
                          }
                        }}
                        className={`w-full min-w-0 cursor-pointer px-3 py-2 text-left transition-colors ${isOpen ? 'bg-bg/40' : 'hover:bg-white/5'}`}
                      >
                        <div className={`${PROFITABLE_TRADES_GRID_COLS} text-[0.72rem]`}>
                          <div className="min-w-0 overflow-hidden">
                            <ExchangeTag exchange={order.exchange} />
                          </div>
                          <span className={`truncate text-[0.65rem] font-semibold uppercase ${order.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                            {order.direction === 'buy' ? 'Bid' : 'Ask'}
                          </span>
                          <span className="min-w-0 truncate font-medium text-text" title={paymentMethod}>
                            {paymentMethod}
                          </span>
                          <TradeRowMetric value={firstSeenLabel} className="hidden lg:block" />
                          <TradeRowMetric value={seenLabel} className="hidden lg:block" />
                          <TradeRowMetric value={order.status.duration?.display || '—'} className="hidden sm:block" />
                          <TradeRowMetric
                            value={cappedDataPending ? 'Calculating…' : sizeUnit === 'btc' ? fmtBTC(activeScenario.tradeSizeBTC) : fmtFiat(activeScenario.tradeSizeFiat, fiat)}
                          />
                          <TradeRowMetric
                            value={cappedDataPending ? 'Calculating…' : netProfitUnit === 'btc' ? fmtBTC(activeScenario.profitBTC) : fmtFiat(activeScenario.profitFiat, fiat)}
                            valueClassName="text-green"
                          />
                          <span className="flex shrink-0 items-center justify-center" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                            {chart != null && (
                              <input
                                type="checkbox"
                                checked={!hiddenChartOfferKeys.has(stableKey)}
                                onChange={() => toggleChartOfferKey(stableKey)}
                                title="Show on OHLC chart"
                              />
                            )}
                          </span>
                          <span className="shrink-0 text-right text-muted">{isOpen ? '▲' : detailReady ? '▼' : '…'}</span>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="border-t border-border bg-bg/20 px-3 py-3">
                          {cappedDataPending ? (
                            <div className="flex items-center gap-3 px-1 py-2 text-[0.78rem] text-muted">
                              <LoadingSpinner size={28} />
                              <span>Capped-volume breakdown is still being calculated.</span>
                            </div>
                          ) : !detailedOrder ? (
                            <div className="flex items-center gap-3 px-1 py-2 text-[0.78rem] text-muted">
                              <LoadingSpinner size={28} />
                              <span>Detailed row analysis is still loading.</span>
                            </div>
                          ) : (
                            <PastOrderBreakdown
                              order={detailedOrder}
                              showCapped={expandedShowCapped}
                              onToggleCapped={setExpandedShowCapped}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
