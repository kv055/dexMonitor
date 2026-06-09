import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Offer, PastOrderStats, PastProfitableOrder, TakerOpportunityMode } from '../types';
import { usePreferences } from '../hooks/usePreferences';
import { useTimezone } from '../hooks/useTimezone';
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
import { LoadingSpinner } from './LoadingSpinner';

interface Props {
  stats: PastOrderStats | null;
  statsAll: PastOrderStats | null;
  statsNetCapped: PastOrderStats | null;
  statsAllNetCapped: PastOrderStats | null;
  orders: PastProfitableOrder[];
  loading: boolean;
  maxFiatLimit: number | null;
}

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
  if (mode === 'net_capped' && order.analysis.capped_volume && (order.analysis.capped_volume.profit.avg_btc ?? 0) > 0) {
    return order.analysis.capped_volume;
  }
  return order.analysis.full_volume;
}

function isProfitableInMode(order: PastProfitableOrder, mode: TakerOpportunityMode): boolean {
  return (pickScenario(order, mode).profit.avg_btc ?? 0) > 0;
}

function isPaymentMethodExcluded(method: string | null | undefined, excludedMethods: string[]): boolean {
  if (!method || excludedMethods.length === 0) return false;
  return excludedMethods.includes(method);
}

function orderDurationMinutes(order: PastProfitableOrder): number {
  if (order.status.duration) {
    return order.status.duration.hours * 60 + order.status.duration.minutes;
  }
  return durationMinutes(order.status.first_seen, order.status.last_seen);
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

type ProfitableOrderSortKey =
  | 'last_seen_desc'
  | 'last_seen_asc'
  | 'net_btc_desc'
  | 'net_btc_asc'
  | 'net_fiat_desc'
  | 'net_fiat_asc'
  | 'volume_btc_desc'
  | 'net_pct_desc'
  | 'duration_desc'
  | 'payment_method_asc'
  | 'exchange_asc';

const INSIGHTS_FILTERS_STORAGE_KEY = 'dex-insights-filters';

interface PersistedInsightsFilters {
  selectedTimeframe: string;
  directionFilter: DirectionFilter;
  disabledExchanges: string[];
  mode: TakerOpportunityMode;
  showAllMethods: boolean;
  sortBy: ProfitableOrderSortKey;
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
  showAllMethods: false,
  sortBy: 'last_seen_desc',
  durationMin: null,
  durationMax: null,
  profitFiatMin: null,
  profitFiatMax: null,
};

const VALID_TIMEFRAMES = new Set(['1h', '6h', '24h', '48h', '7d']);
const VALID_DIRECTIONS = new Set<DirectionFilter>(['both', 'buy', 'sell']);
const VALID_MODES = new Set<TakerOpportunityMode>(['net_full', 'net_capped']);
const VALID_SORT_KEYS = new Set<ProfitableOrderSortKey>([
  'last_seen_desc',
  'last_seen_asc',
  'net_btc_desc',
  'net_btc_asc',
  'net_fiat_desc',
  'net_fiat_asc',
  'volume_btc_desc',
  'net_pct_desc',
  'duration_desc',
  'payment_method_asc',
  'exchange_asc',
]);

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function readNullableNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function readPersistedInsightsFilters(): PersistedInsightsFilters {
  try {
    const raw = localStorage.getItem(INSIGHTS_FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_INSIGHTS_FILTERS;
    const parsed = JSON.parse(raw) as Partial<PersistedInsightsFilters>;
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
      showAllMethods: parsed.showAllMethods === true,
      sortBy: VALID_SORT_KEYS.has(parsed.sortBy as ProfitableOrderSortKey)
        ? parsed.sortBy as ProfitableOrderSortKey
        : DEFAULT_INSIGHTS_FILTERS.sortBy,
      durationMin: readNullableNumber(parsed.durationMin),
      durationMax: readNullableNumber(parsed.durationMax),
      profitFiatMin: readNullableNumber(parsed.profitFiatMin),
      profitFiatMax: readNullableNumber(parsed.profitFiatMax),
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

function orderNetProfitFiat(order: PastProfitableOrder, mode: TakerOpportunityMode): number {
  return pickScenario(order, mode).profit.avg_fiat ?? 0;
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
  orders: PastProfitableOrder[],
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
  orders: PastProfitableOrder[],
  sortKey: ProfitableOrderSortKey,
  mode: TakerOpportunityMode,
): PastProfitableOrder[] {
  const sorted = [...orders];
  sorted.sort((a, b) => {
    const scenarioA = pickScenario(a, mode);
    const scenarioB = pickScenario(b, mode);
    switch (sortKey) {
      case 'last_seen_desc': {
        const ta = parseUtcTimestamp(a.status.last_seen)?.getTime() ?? 0;
        const tb = parseUtcTimestamp(b.status.last_seen)?.getTime() ?? 0;
        return tb - ta;
      }
      case 'last_seen_asc': {
        const ta = parseUtcTimestamp(a.status.last_seen)?.getTime() ?? 0;
        const tb = parseUtcTimestamp(b.status.last_seen)?.getTime() ?? 0;
        return ta - tb;
      }
      case 'net_btc_desc':
        return (scenarioB.profit.avg_btc ?? 0) - (scenarioA.profit.avg_btc ?? 0);
      case 'net_btc_asc':
        return (scenarioA.profit.avg_btc ?? 0) - (scenarioB.profit.avg_btc ?? 0);
      case 'net_fiat_desc':
        return (scenarioB.profit.avg_fiat ?? 0) - (scenarioA.profit.avg_fiat ?? 0);
      case 'net_fiat_asc':
        return (scenarioA.profit.avg_fiat ?? 0) - (scenarioB.profit.avg_fiat ?? 0);
      case 'volume_btc_desc':
        return (scenarioB.trade_size_btc ?? 0) - (scenarioA.trade_size_btc ?? 0);
      case 'net_pct_desc':
        return (scenarioB.premium.avg_net_percent ?? 0) - (scenarioA.premium.avg_net_percent ?? 0);
      case 'duration_desc': {
        const durA = orderDurationMinutes(a);
        const durB = orderDurationMinutes(b);
        return durB - durA;
      }
      case 'payment_method_asc':
        return (a.payment_method ?? '').localeCompare(b.payment_method ?? '', 'de');
      case 'exchange_asc':
        return a.exchange.localeCompare(b.exchange, 'de');
      default:
        return 0;
    }
  });
  return sorted;
}

function profitableOrderSortOptions(fiat: string): { value: ProfitableOrderSortKey; label: string }[] {
  return [
    { value: 'last_seen_desc', label: 'Last seen (newest)' },
    { value: 'last_seen_asc', label: 'Last seen (oldest)' },
    { value: 'net_btc_desc', label: 'Net profit BTC (highest)' },
    { value: 'net_btc_asc', label: 'Net profit BTC (lowest)' },
    { value: 'net_fiat_desc', label: `Net profit ${fiat} (highest)` },
    { value: 'net_fiat_asc', label: `Net profit ${fiat} (lowest)` },
    { value: 'volume_btc_desc', label: 'Volume BTC (largest)' },
    { value: 'net_pct_desc', label: 'Net premium % (highest)' },
    { value: 'duration_desc', label: 'Duration (longest)' },
    { value: 'payment_method_asc', label: 'Payment method (A–Z)' },
    { value: 'exchange_asc', label: 'Exchange (A–Z)' },
  ];
}

interface FilteredSummary {
  premium_order_count: number;
  total_net_profit_btc: number;
  total_net_profit_fiat: number;
  average_order_size_btc: number;
  smallest_order_size_btc: number | null;
  biggest_order_size_btc: number | null;
}

function computeFilteredSummary(orders: PastProfitableOrder[], mode: TakerOpportunityMode): FilteredSummary {
  if (orders.length === 0) {
    return {
      premium_order_count: 0,
      total_net_profit_btc: 0,
      total_net_profit_fiat: 0,
      average_order_size_btc: 0,
      smallest_order_size_btc: null,
      biggest_order_size_btc: null,
    };
  }

  let totalProfitBtc = 0;
  let totalProfitFiat = 0;
  let totalSizeBtc = 0;
  let smallest = Infinity;
  let biggest = -Infinity;

  for (const order of orders) {
    const scenario = pickScenario(order, mode);
    const profitBtc = scenario.profit.avg_btc ?? 0;
    const profitFiat = scenario.profit.avg_fiat ?? 0;
    const sizeBtc = scenario.trade_size_btc ?? 0;
    totalProfitBtc += profitBtc;
    totalProfitFiat += profitFiat;
    totalSizeBtc += sizeBtc;
    if (sizeBtc < smallest) smallest = sizeBtc;
    if (sizeBtc > biggest) biggest = sizeBtc;
  }

  return {
    premium_order_count: orders.length,
    total_net_profit_btc: totalProfitBtc,
    total_net_profit_fiat: totalProfitFiat,
    average_order_size_btc: totalSizeBtc / orders.length,
    smallest_order_size_btc: smallest === Infinity ? null : smallest,
    biggest_order_size_btc: biggest === -Infinity ? null : biggest,
  };
}

interface PillGroupProps {
  label: string;
  description: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (v: string) => void;
}

function PillGroup({ label, description, options, selected, onChange }: PillGroupProps) {
  const base = 'rounded border px-2 py-0.5 text-[0.7rem] font-medium transition-colors';
  const active = 'border-accent/60 bg-accent/10 text-accent';
  const inactive = 'border-border bg-bg/40 text-muted hover:text-text';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            title={description}
            onClick={() => onChange(o.value)}
            className={`${base} ${selected === o.value ? active : inactive}`}
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

interface TradeRowMetricProps {
  label: string;
  value: string;
  valueClassName?: string;
}

function TradeRowMetric({ label, value, valueClassName = 'text-text' }: TradeRowMetricProps) {
  const full = `${label} ${value}`;
  return (
    <span className="block min-w-0 truncate text-right text-muted" title={full}>
      <span className="mr-1">{label}</span>
      <span className={`mono-nums tabular-nums ${valueClassName}`}>{value}</span>
    </span>
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
  const btcMin = getBtcMin(offer);
  const btcMax = getBtcMax(offer);
  const fiatMin = getFiatMin(offer);
  const fiatMax = getFiatMax(offer);
  const avgObservedBtc = offerNumber(raw, 'avg_btc_amount');

  const btcRange = formatRange(fmtBTC(btcMin), fmtBTC(btcMax));
  const fiatRange = formatRange(fmtFiat(fiatMin, fiat), fmtFiat(fiatMax, fiat));

  const hasPricing = offerPrice > 0 || refPrice != null;
  const hasVolume = btcRange != null || fiatRange != null || avgObservedBtc != null;

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
          {btcRange != null && (
            <PastOfferDetailRow label="BTC range" value={btcRange} />
          )}
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
  const costBreakdown = getDisplayCostBreakdown(offer, showCapped);

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
      {order.payment_method && (
        <div className="text-[0.68rem] text-muted">
          <span className="uppercase tracking-wide text-[0.6rem] mr-1">Payment</span>
          <span className="text-text">{order.payment_method}</span>
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
              showCapped={showCapped}
              onToggle={onToggleCapped}
              cappedBtc={getCappedTradeSizeBtc(offer)}
              refPrice={refPrice}
            />
          )}
          <CostBreakdownPanel
            bd={costBreakdown}
            abortCost={getDisplayAbortCost(offer, showCapped)}
            priceDiffPct={getRawPremiumPercent(offer)}
            netPremiumPct={getNetPremiumPercent(offer, showCapped)}
            refPrice={refPrice}
          />
        </div>
      ) : (
        <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
      )}
    </div>
  );
}

export function TakerOpportunities({ stats, statsAll, statsNetCapped, statsAllNetCapped, orders, loading, maxFiatLimit }: Props) {
  const { timezone } = useTimezone();
  const { excludedMethods } = usePreferences();
  const [initialFilters] = useState(readPersistedInsightsFilters);
  const [referenceNowMs] = useState(() => Date.now());
  const [selectedTimeframe, setSelectedTimeframe] = useState(initialFilters.selectedTimeframe);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>(initialFilters.directionFilter);
  const [disabledExchanges, setDisabledExchanges] = useState<string[]>(initialFilters.disabledExchanges);
  const [mode, setMode] = useState<TakerOpportunityMode>(initialFilters.mode);
  const [showAllMethods, setShowAllMethods] = useState(initialFilters.showAllMethods);
  const [sortBy, setSortBy] = useState<ProfitableOrderSortKey>(initialFilters.sortBy);
  const [durationRange, setDurationRange] = useState<[number, number] | null>(null);
  const [profitFiatRangeCents, setProfitFiatRangeCents] = useState<[number, number] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedShowCapped, setExpandedShowCapped] = useState(false);
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

  const hasExcluded = (stats?.excluded_payment_methods?.length ?? 0) > 0;
  const statsByMode = mode === 'net_capped'
    ? { filtered: statsNetCapped, all: statsAllNetCapped }
    : { filtered: stats, all: statsAll };
  const activeStats = showAllMethods && hasExcluded ? statsByMode.all : statsByMode.filtered;
  const activeOrders = useMemo(() => {
    let list = orders.filter(order => isProfitableInMode(order, mode));
    if (!showAllMethods && hasExcluded) {
      list = list.filter(order => !isPaymentMethodExcluded(order.payment_method, excludedMethods));
    }
    return list;
  }, [orders, mode, showAllMethods, hasExcluded, excludedMethods]);

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
    () => computeProfitFiatBounds(ordersAfterDurationFilter, mode),
    [ordersAfterDurationFilter, mode],
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
      showAllMethods,
      sortBy,
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
    showAllMethods,
    sortBy,
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
    () => sortProfitableOrders(filteredOrders, sortBy, mode),
    [filteredOrders, sortBy, mode],
  );

  const toggleExchangeFilter = useCallback((exchange: string) => {
    setDisabledExchanges(prev =>
      prev.includes(exchange) ? prev.filter(name => name !== exchange) : [...prev, exchange],
    );
  }, []);

  const resetFilters = useCallback(() => {
    setSelectedTimeframe(DEFAULT_INSIGHTS_FILTERS.selectedTimeframe);
    setDirectionFilter(DEFAULT_INSIGHTS_FILTERS.directionFilter);
    setDisabledExchanges([]);
    setShowAllMethods(DEFAULT_INSIGHTS_FILTERS.showAllMethods);
    setMode(DEFAULT_INSIGHTS_FILTERS.mode);
    setSortBy(DEFAULT_INSIGHTS_FILTERS.sortBy);
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

  if (loading && !stats) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <LoadingSpinner label="Loading taker opportunities" />
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
    { label: 'Orders', value: filteredSummary.premium_order_count.toLocaleString('de-DE'), className: 'text-text' },
    { label: 'Net BTC', value: fmtBTC(filteredSummary.total_net_profit_btc), className: 'text-green' },
    { label: `Net ${fiat}`, value: fmtFiat(filteredSummary.total_net_profit_fiat, fiat), className: 'text-text' },
    { label: 'Avg Size', value: fmtBTC(filteredSummary.average_order_size_btc), className: 'text-text' },
    { label: 'Smallest', value: fmtBTC(filteredSummary.smallest_order_size_btc), className: 'text-muted' },
    { label: 'Biggest', value: fmtBTC(filteredSummary.biggest_order_size_btc), className: 'text-muted' },
  ];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      {loading && <LoadingSpinner label="Loading taker opportunities" />}
      <div className="flex flex-1 min-h-0 flex-col gap-3 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-3 rounded-lg border border-border bg-bg/20 p-3 lg:w-72 xl:w-80 lg:overflow-y-auto">
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
            disabledMessage="No profit data in this window"
          />
          {hasExcluded && (
            <PillGroup
              label="Payment methods"
              description="Selected: only your enabled methods. All: every payment method regardless of settings."
              options={[
                { value: 'selected', label: 'Selected' },
                { value: 'all', label: 'All methods' },
              ]}
              selected={showAllMethods ? 'all' : 'selected'}
              onChange={v => setShowAllMethods(v === 'all')}
            />
          )}
          <PillGroup
            label="Premium mode"
            description="Net full uses full order size. Net capped applies your max fiat position limit where needed."
            options={[
              { value: 'net_full', label: 'Net Full' },
              { value: 'net_capped', label: maxFiatLimit != null && maxFiatLimit > 0 ? `Net Capped €${maxFiatLimit.toLocaleString('de-DE', { maximumFractionDigits: 0 })}` : 'Net Capped' },
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
            <div className="border-b border-border bg-surface/70 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
              Backtesting summary
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

        <div className="min-h-0 flex-1 rounded-lg border border-border overflow-hidden flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/70 px-3 py-2 text-[0.72rem]">
            <span className="text-text font-medium">Profitable trades</span>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <label className="flex items-center gap-1.5 text-muted">
                <span className="shrink-0 uppercase tracking-wide text-[0.65rem] font-semibold">Sort</span>
                <select
                  title="Sort the profitable trades list"
                  value={sortBy}
                  onChange={event => setSortBy(event.target.value as ProfitableOrderSortKey)}
                  className="max-w-[12rem] rounded border border-border bg-bg/60 px-2 py-1 text-[0.72rem] font-medium text-text outline-none transition-colors hover:border-accent/50 focus:border-accent"
                >
                  {profitableOrderSortOptions(fiat).map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-muted">{sortedOrders.length} in {labelForTimeframe(selected?.timeframe ?? selectedTimeframe).toLowerCase()}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {sortedOrders.length === 0 ? (
              <div className="px-3 py-4 text-[0.75rem] text-muted">No profitable closed trades in this window for the selected net mode.</div>
            ) : (
              sortedOrders.map(order => {
                const isOpen = expandedId === order.id;
                const activeScenario = pickScenario(order, mode);
                const seenLabel = formatDateTimeLabel(order.status.last_seen ?? '', timezone);
                const paymentMethod = order.payment_method || 'Unknown method';

                return (
                  <div key={order.id} className="border-b border-border last:border-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (isOpen) {
                          setExpandedId(null);
                          return;
                        }
                        setExpandedId(order.id);
                        setExpandedShowCapped(mode === 'net_capped' && !!order.analysis.capped_volume);
                      }}
                      className={`w-full min-w-0 bg-transparent border-none px-3 py-2 text-left transition-colors ${isOpen ? 'bg-bg/40' : 'hover:bg-white/5'}`}
                    >
                      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(0,0.65fr)_minmax(0,0.75fr)_minmax(0,0.85fr)_minmax(0,0.8fr)_1.25rem] items-center gap-2 sm:gap-3 text-[0.72rem]">
                        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden sm:gap-2">
                          <span className="shrink-0 rounded border border-border bg-bg/50 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase text-text">{order.exchange}</span>
                          <span className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase text-muted">{order.direction}</span>
                          <span className="min-w-0 truncate font-medium text-text" title={paymentMethod}>
                            {paymentMethod}
                          </span>
                        </div>
                        <TradeRowMetric label="Last seen" value={seenLabel} />
                        <TradeRowMetric label="Duration" value={order.status.duration?.display || '—'} />
                        <TradeRowMetric label="Size" value={fmtBTC(activeScenario.trade_size_btc)} />
                        <TradeRowMetric label="Net BTC" value={fmtBTC(activeScenario.profit.avg_btc)} valueClassName="text-green" />
                        <TradeRowMetric label={`Net ${fiat}`} value={fmtFiat(activeScenario.profit.avg_fiat, fiat)} />
                        <span className="shrink-0 text-right text-muted">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-border bg-bg/20 px-3 py-3">
                        <PastOrderBreakdown
                          order={order}
                          showCapped={expandedShowCapped}
                          onToggleCapped={setExpandedShowCapped}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
