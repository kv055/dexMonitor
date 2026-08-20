import { useState, useRef, useEffect, useMemo } from 'react';
import { useFilters } from '../hooks/useFilters';
import { useTimezone } from '../hooks/useTimezone';
import type { Offer, PremiumFilterMode } from '../types';
import { formatTimeOnly } from '../utils/formatters';
import {
  getEstimatedProfitFiat,
  getPremiumMetricValue,
  hasCappedScenario,
  isOfferLive,
  profitScenarioForPremiumMode,
} from '../utils/offerAccess';

const PAYMENT_PALETTE = [
  '#f7931a', '#3fb950', '#bc8cff', '#58a6ff', '#f85149',
  '#d29922', '#39d353', '#db61a2', '#79c0ff', '#e3b341', '#4a4f58',
];

const PREMIUM_FILTER_OPTIONS: { value: PremiumFilterMode; label: string }[] = [
  { value: 'raw', label: 'Raw Premium' },
  { value: 'net_full', label: 'Net Premium Full' },
  { value: 'net_capped', label: 'Net Premium Capped' },
];

/** Dropdown order top→bottom. */
type PremiumCategory = { mode: PremiumFilterMode; premiumOnly: boolean; label: string };

const PREMIUM_CATEGORIES: PremiumCategory[] = [
  ...PREMIUM_FILTER_OPTIONS.map(opt => ({ mode: opt.value, premiumOnly: true, label: opt.label })),
  { mode: 'net_full', premiumOnly: false, label: 'Incl. non premium offers' },
];

function baseOffersForPremiumCategory(offers: Offer[], filters: {
  direction: string;
  exchange: string;
  excludedExchanges: string[];
}, scope: 'live' | 'past'): Offer[] {
  let f = offers.filter(o => (scope === 'live' ? isOfferLive(o) : !isOfferLive(o)));
  if (filters.direction) f = f.filter(o => o.direction === filters.direction);
  if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
  if (filters.excludedExchanges.length > 0) {
    const excluded = new Set(filters.excludedExchanges);
    f = f.filter(o => !excluded.has(o.exchange));
  }
  return f;
}

/** True when the premium category would show at least one offer. */
function premiumCategoryAvailable(offers: Offer[], mode: PremiumFilterMode, premiumOnly: boolean): boolean {
  if (offers.length === 0) return false;
  if (!premiumOnly) return true;
  if (mode === 'net_capped') {
    // Capped mode only applies when at least one offer exceeds the fiat cap.
    return offers.some(o => hasCappedScenario(o) && (getPremiumMetricValue(o, 'net_capped') ?? 0) > 0);
  }
  return offers.some(o => (getPremiumMetricValue(o, mode) ?? 0) > 0);
}

const FIAT_OPTIONS = ['EUR', 'USD', 'GBP', 'AUD', 'CHF', 'SEK', 'NOK', 'CAD'];
const SOURCE_OPTIONS = ['kraken', 'coinbase', 'bitstamp', 'binance'];

interface PaymentDropdownProps {
  value: string;
  onChange: (v: string) => void;
  inputCls: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function PaymentDropdown({ value, onChange, inputCls, containerRef }: PaymentDropdownProps) {
  const { offers, filters, groups } = useFilters();
  const [open, setOpen] = useState(false);
  const [menuMaxWidth, setMenuMaxWidth] = useState<number | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleToggle = () => {
    if (!open && ref.current && containerRef.current) {
      const buttonRect = ref.current.getBoundingClientRect();
      const panelRect = containerRef.current.getBoundingClientRect();
      setMenuMaxWidth(panelRect.right - buttonRect.left);
    }
    setOpen(o => !o);
  };

  // Count offers per individual method (excluding payment filter itself).
  const { methodCounts, total } = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (filters.excludedExchanges.length > 0) {
      const excluded = new Set(filters.excludedExchanges);
      f = f.filter(o => !excluded.has(o.exchange));
    }
    if (filters.status === 'open')   f = f.filter(o => isOfferLive(o));
    if (filters.status === 'closed') f = f.filter(o => !isOfferLive(o));
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
    const profitMin = parseFloat(filters.profitMin);
    const profitMax = parseFloat(filters.profitMax);
    const profitScenario = profitScenarioForPremiumMode(filters.premiumMode);
    if (!isNaN(profitMin)) f = f.filter(o => (getEstimatedProfitFiat(o, profitScenario) ?? 0) >= profitMin);
    if (!isNaN(profitMax)) f = f.filter(o => (getEstimatedProfitFiat(o, profitScenario) ?? 0) <= profitMax);
    if (filters.premiumOnly) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);

    const counts: Record<string, number> = {};
    f.forEach(o => {
      for (const pm of (o.payment_methods ?? ['Unknown'])) {
        counts[pm] = (counts[pm] || 0) + 1;
      }
    });
    return { methodCounts: counts, total: f.length };
  }, [offers, filters]);

  // Build group-level counts and sort groups by total count descending.
  const groupRows = useMemo(() => {
    return groups
      .map((g, i) => ({
        group: g,
        color: PAYMENT_PALETTE[i % PAYMENT_PALETTE.length],
        count: g.methods.reduce((s, m) => s + (methodCounts[m] ?? 0), 0),
        methods: g.methods
          .map(m => ({ name: m, count: methodCounts[m] ?? 0 }))
          .filter(m => m.count > 0)
          .sort((a, b) => b.count - a.count),
      }))
      .filter(g => g.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [groups, methodCounts]);

  // Methods that don't belong to any group.
  const ungroupedMethods = useMemo(() => {
    const grouped = new Set(groups.flatMap(g => g.methods));
    return Object.entries(methodCounts)
      .filter(([m]) => !grouped.has(m))
      .sort((a, b) => b[1] - a[1]);
  }, [groups, methodCounts]);

  const maxCount = Math.max(
    ...groupRows.map(g => g.count),
    ...ungroupedMethods.map(([, c]) => c),
    1
  );

  // Resolve the display label for the trigger button.
  const { triggerLabel, triggerColor } = useMemo(() => {
    if (!value) return { triggerLabel: '', triggerColor: null };
    const grp = groupRows.find(g => g.group.name === value);
    if (grp) return { triggerLabel: grp.group.display_name, triggerColor: grp.color };
    // Individual method — find its group color.
    const parentGroup = groupRows.find(g => g.methods.some(m => m.name === value));
    const color = parentGroup?.color ?? PAYMENT_PALETTE[ungroupedMethods.findIndex(([m]) => m === value) % PAYMENT_PALETTE.length] ?? PAYMENT_PALETTE[0];
    return { triggerLabel: value, triggerColor: color };
  }, [value, groupRows, ungroupedMethods]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className={`${inputCls} flex items-center gap-1.5 w-full`}
      >
        {value && triggerColor ? (
          <>
            <span className="w-1.75 h-1.75 rounded-full shrink-0" style={{ backgroundColor: triggerColor }} />
            <span className="text-[0.8rem] truncate">{triggerLabel}</span>
          </>
        ) : (
          <span className="text-[0.8rem]">All Payments</span>
        )}
        <span className="ml-auto text-muted text-[0.65rem]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md overflow-hidden shadow-lg min-w-52" style={{ maxWidth: menuMaxWidth }}>
          {/* All Payments row */}
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors flex items-center justify-between ${!value ? 'text-accent' : 'text-text'}`}
          >
            <span className="text-[0.8rem]">All Payments</span>
            <span className="text-muted text-[0.75rem]">{total}</span>
          </button>

          <div className="max-h-72 overflow-y-auto">
            {/* Grouped rows */}
            {groupRows.map(({ group, color, count, methods }) => {
              const pct = (count / maxCount) * 100;
              const isGroupSelected = value === group.name;
              return (
                <div key={group.name}>
                  {/* Group header row */}
                  <button
                    onClick={() => { onChange(group.name); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.25 flex items-center gap-2 relative overflow-hidden transition-colors border-t border-border/40 ${isGroupSelected ? 'bg-bg' : 'hover:bg-bg'}`}
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 pointer-events-none"
                      style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.35 }}
                    />
                    <span className="relative w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="relative text-[0.8rem] font-semibold text-text flex-1 truncate">{group.display_name}</span>
                    <span className="relative text-[0.72rem] text-muted">{count}</span>
                  </button>
                  {/* Individual method rows within group */}
                  {methods.map(({ name: method, count: mCount }) => {
                    const mPct = (mCount / maxCount) * 100;
                    const isSelected = value === method;
                    return (
                      <button
                        key={method}
                        onClick={() => { onChange(method); setOpen(false); }}
                        className={`w-full text-left pl-7 pr-3 py-1 flex items-center gap-2 relative overflow-hidden transition-colors ${isSelected ? 'bg-bg' : 'hover:bg-bg'}`}
                      >
                        <div
                          className="absolute left-0 top-0 bottom-0 pointer-events-none"
                          style={{ width: `${mPct}%`, backgroundColor: color, opacity: 0.2 }}
                        />
                        <span className="relative text-[0.75rem] text-muted flex-1 truncate">{method}</span>
                        <span className="relative text-[0.7rem] text-muted">{mCount}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* Ungrouped methods */}
            {ungroupedMethods.length > 0 && (
              <div>
                <div className="px-3 py-1 border-t border-border/40">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted">Other</span>
                </div>
                {ungroupedMethods.map(([method, count], i) => {
                  const pct = (count / maxCount) * 100;
                  const color = PAYMENT_PALETTE[(groupRows.length + i) % PAYMENT_PALETTE.length];
                  const isSelected = value === method;
                  return (
                    <button
                      key={method}
                      onClick={() => { onChange(method); setOpen(false); }}
                      className={`w-full text-left px-3 py-1.25 flex items-center gap-2 relative overflow-hidden transition-colors ${isSelected ? 'bg-bg' : 'hover:bg-bg'}`}
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 pointer-events-none"
                        style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.2 }}
                      />
                      <span className="relative w-1.75 h-1.75 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="relative text-[0.78rem] text-text flex-1 truncate">{method}</span>
                      <span className="relative text-[0.72rem] text-muted">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface PremiumModeDropdownProps {
  value: PremiumFilterMode;
  premiumOnly: boolean;
  onChange: (v: PremiumFilterMode, premiumOnly?: boolean) => void;
  inputCls: string;
  scope: 'live' | 'past';
}

function PremiumModeDropdown({ value, premiumOnly, onChange, inputCls, scope }: PremiumModeDropdownProps) {
  const { offers, filters } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const categoryOffers = useMemo(
    () => baseOffersForPremiumCategory(offers, filters, scope),
    [offers, filters, scope],
  );

  const availability = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const cat of PREMIUM_CATEGORIES) {
      const key = cat.premiumOnly ? `${cat.mode}:only` : 'incl:all';
      map.set(key, premiumCategoryAvailable(categoryOffers, cat.mode, cat.premiumOnly));
    }
    return map;
  }, [categoryOffers]);

  const isAvailable = (mode: PremiumFilterMode, only: boolean) =>
    availability.get(only ? `${mode}:only` : 'incl:all') === true;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = premiumOnly
    ? PREMIUM_FILTER_OPTIONS.find(opt => opt.value === value) ?? PREMIUM_FILTER_OPTIONS[0]
    : { value, label: 'Incl. non premium offers' };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`${inputCls} flex items-center gap-1.5 w-full`}
      >
        <span className="text-[0.8rem]">{selected.label}</span>
        <span className="ml-auto text-muted text-[0.65rem]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md overflow-hidden min-w-full shadow-lg">
          {PREMIUM_FILTER_OPTIONS.map(opt => {
            const enabled = isAvailable(opt.value, true);
            const active = premiumOnly && value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={!enabled}
                title={enabled
                  ? undefined
                  : opt.value === 'net_capped'
                    ? 'No offers exceed the max fiat position (capped volume unused)'
                    : `No ${opt.label.toLowerCase()} offers in the current list`}
                onClick={() => {
                  if (!enabled) return;
                  onChange(opt.value, true);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 transition-colors ${
                  !enabled
                    ? 'text-muted/45 cursor-not-allowed'
                    : active
                      ? 'text-accent bg-bg hover:bg-bg'
                      : 'text-text hover:bg-bg'
                }`}
              >
                <span className="text-[0.8rem]">{opt.label}</span>
              </button>
            );
          })}
          {(() => {
            const inclEnabled = isAvailable(value, false);
            const active = !premiumOnly;
            return (
              <button
                type="button"
                disabled={!inclEnabled}
                title={inclEnabled ? undefined : 'No offers in the current list'}
                onClick={() => {
                  if (!inclEnabled) return;
                  onChange(value, false);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 transition-colors border-t border-border/60 ${
                  !inclEnabled
                    ? 'text-muted/45 cursor-not-allowed'
                    : active
                      ? 'text-accent bg-bg hover:bg-bg'
                      : 'text-text hover:bg-bg'
                }`}
              >
                <span className="text-[0.8rem]">Incl. non premium offers</span>
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const labelCls = "text-[0.65rem] font-semibold uppercase tracking-wide text-muted";
const controlCls = "w-full rounded border border-border bg-bg/60 px-2 py-1.5 text-[0.75rem] font-medium text-text outline-none transition-colors hover:border-accent/50 focus:border-accent";

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

export function DualRangeFilter({
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
        <span className={labelCls}>{label}</span>
        <span className="text-[0.7rem] text-muted">{disabledMessage}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" title={description}>
      <span className={labelCls}>{label}</span>
      <div className="flex justify-between gap-2 text-[0.65rem] text-muted mono-nums tabular-nums">
        <span>{formatValue(lo)}</span>
        <span>{formatValue(hi)}</span>
      </div>
      <div className="relative mx-0.5 h-6">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded bg-border" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-accent/60" style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }} />
        <input aria-label={`${label} minimum`} type="range" min={min} max={max} step={step} value={lo} onChange={event => onChange([Math.min(Number(event.target.value), hi), hi])} className={rangeInputClass} style={{ zIndex: lo > max - step * 10 ? 5 : 3 }} />
        <input aria-label={`${label} maximum`} type="range" min={min} max={max} step={step} value={hi} onChange={event => onChange([lo, Math.max(Number(event.target.value), lo)])} className={rangeInputClass} style={{ zIndex: 4 }} />
      </div>
    </div>
  );
}

function PastPremiumRange() {
  const { filters, setFilters, offersForPremiumRange } = useFilters();
  const bounds = useMemo(() => {
    const premiums = offersForPremiumRange
      .filter(offer => !isOfferLive(offer))
      .map(offer => getPremiumMetricValue(offer, filters.premiumMode))
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (premiums.length === 0) return null;
    return {
      min: Math.floor(Math.min(...premiums) * 100),
      max: Math.ceil(Math.max(...premiums) * 100),
    };
  }, [offersForPremiumRange, filters.premiumMode]);

  useEffect(() => {
    if (bounds == null) return;
    if (filters.premiumMin === '' || filters.premiumMax === '') {
      setFilters({
        premiumMin: (bounds.min / 100).toFixed(2),
        premiumMax: (bounds.max / 100).toFixed(2),
      });
    }
  }, [bounds, filters.premiumMin, filters.premiumMax, setFilters]);

  if (bounds == null) {
    return null;
  }

  const min = bounds.min;
  const max = Math.max(bounds.max, min + 1);
  const parsedMin = parseFloat(filters.premiumMin);
  const parsedMax = parseFloat(filters.premiumMax);
  const currentMin = Math.max(min, Math.min(Math.round((Number.isNaN(parsedMin) ? min / 100 : parsedMin) * 100), max));
  const currentMax = Math.max(currentMin, Math.min(Math.round((Number.isNaN(parsedMax) ? max / 100 : parsedMax) * 100), max));

  return (
    <DualRangeFilter
      label="Premium range"
      description="Filter past offers by premium percentage"
      min={min}
      max={max}
      value={[currentMin, currentMax]}
      onChange={([nextMin, nextMax]) => setFilters({ premiumMin: (nextMin / 100).toFixed(2), premiumMax: (nextMax / 100).toFixed(2) })}
      formatValue={cents => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`}
    />
  );
}

function LiveNetProfitRange() {
  const { filters, setFilters, offersForProfitRange, offersForPremiumRange } = useFilters();
  const [metric, setMetric] = useState<'profit' | 'premium'>('profit');
  const profitScenario = profitScenarioForPremiumMode(filters.premiumMode);
  const categoryKey = `${filters.premiumMode}:${filters.premiumOnly ? 'only' : 'all'}`;
  const prevCategoryRef = useRef(categoryKey);

  const boundOffers = metric === 'profit' ? offersForProfitRange : offersForPremiumRange;
  const bounds = useMemo(() => {
    const values = boundOffers
      .filter(isOfferLive)
      .map(offer => metric === 'profit'
        ? getEstimatedProfitFiat(offer, profitScenario)
        : getPremiumMetricValue(offer, filters.premiumMode))
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length === 0) return null;
    return {
      min: Math.floor(Math.min(...values) * 100),
      max: Math.ceil(Math.max(...values) * 100),
    };
  }, [boundOffers, metric, filters.premiumMode, profitScenario]);

  useEffect(() => {
    if (bounds == null) return;
    const minKey = metric === 'profit' ? 'profitMin' : 'premiumMin';
    const maxKey = metric === 'profit' ? 'profitMax' : 'premiumMax';
    const categoryChanged = prevCategoryRef.current !== categoryKey;
    prevCategoryRef.current = categoryKey;
    // Reset the active range whenever the premium category changes so min/max
    // match the offers in that category (e.g. Net Premium Full vs all offers).
    if (categoryChanged) {
      setFilters({
        [minKey]: (bounds.min / 100).toFixed(2),
        [maxKey]: (bounds.max / 100).toFixed(2),
      });
      return;
    }
    if (filters[minKey] === '' || filters[maxKey] === '') {
      setFilters({ [minKey]: (bounds.min / 100).toFixed(2), [maxKey]: (bounds.max / 100).toFixed(2) });
    }
  }, [bounds, categoryKey, filters, metric, setFilters]);

  const fiatToggleLabel = filters.fiat.length <= 4 ? filters.fiat : filters.fiat.slice(0, 3);
  const metricToggle = (
    <div className="flex items-center justify-between gap-2">
      <span className={labelCls}>Range</span>
      <div className="flex rounded border border-border bg-bg/60 p-0.5 text-[0.62rem] font-semibold">
        <button type="button" onClick={() => setMetric('profit')} aria-pressed={metric === 'profit'} className={metric === 'profit' ? 'rounded bg-accent px-1.5 py-0.5 text-black' : 'rounded px-1.5 py-0.5 text-muted'}>{fiatToggleLabel}</button>
        <button type="button" onClick={() => setMetric('premium')} aria-pressed={metric === 'premium'} className={metric === 'premium' ? 'rounded bg-accent px-1.5 py-0.5 text-black' : 'rounded px-1.5 py-0.5 text-muted'}>%</button>
      </div>
    </div>
  );

  if (bounds == null) {
    return (
      <div className="flex flex-col gap-1">
        {metricToggle}
        <span className={labelCls}>{metric === 'profit' ? `Net profit ${filters.fiat}` : 'Premium %'}</span>
        <span className="text-[0.7rem] text-muted">No {metric === 'profit' ? 'profit' : 'premium'} data in this premium category</span>
      </div>
    );
  }

  const min = bounds.min;
  const max = Math.max(bounds.max, min + 1);
  const minKey = metric === 'profit' ? 'profitMin' : 'premiumMin';
  const maxKey = metric === 'profit' ? 'profitMax' : 'premiumMax';
  const parsedMin = parseFloat(filters[minKey]);
  const parsedMax = parseFloat(filters[maxKey]);
  const currentMin = Math.max(min, Math.min(Math.round((Number.isNaN(parsedMin) ? min / 100 : parsedMin) * 100), max));
  const currentMax = Math.max(currentMin, Math.min(Math.round((Number.isNaN(parsedMax) ? max / 100 : parsedMax) * 100), max));
  return (
    <div className="flex flex-col gap-1.5">
      {metricToggle}
      <DualRangeFilter
        label={metric === 'profit' ? `Net profit ${filters.fiat}` : 'Premium %'}
        description={metric === 'profit'
          ? `Filter offers in the selected premium category by net profit (${filters.premiumMode === 'net_capped' ? 'capped size' : 'full size'})`
          : 'Filter offers in the selected premium category by premium percentage'}
        min={min}
        max={max}
        value={[currentMin, currentMax]}
        onChange={([nextMin, nextMax]) => setFilters({ [minKey]: (nextMin / 100).toFixed(2), [maxKey]: (nextMax / 100).toFixed(2) })}
        formatValue={cents => metric === 'profit'
          ? (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: filters.fiat })
          : `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`}
      />
    </div>
  );
}

interface LiveOfferFiltersProps {
  onRefresh: () => void;
  lastUpdatedAt: string;
}

/**
 * Filters shared by Live and Past Insights views. Kept in a fixed order so
 * switching Live ↔ Past does not jump Fiat / Premium / Range around.
 */
export function SharedOfferFilters({ scope }: { scope: 'live' | 'past' }) {
  const { filters, setFilters } = useFilters();

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Fiat</span>
        <select
          value={filters.fiat}
          onChange={event => setFilters({ fiat: event.target.value })}
          className={controlCls}
          title="Show live and past offers quoted in this currency"
        >
          {FIAT_OPTIONS.map(currency => <option key={currency} value={currency}>{currency}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className={labelCls}>Premium</span>
        <PremiumModeDropdown
          value={filters.premiumMode}
          premiumOnly={filters.premiumOnly}
          onChange={(v, premiumOnly) => setFilters({ premiumMode: v, ...(premiumOnly == null ? {} : { premiumOnly }) })}
          inputCls={controlCls}
          scope={scope}
        />
      </div>

      {scope === 'live' ? <LiveNetProfitRange /> : <PastPremiumRange />}
    </div>
  );
}

/**
 * Live-only filter controls (reference CEX, payment method, refresh). Shared
 * Fiat / Premium / Range live in SharedOfferFilters above this block.
 */
export function LiveOfferFilters({ onRefresh, lastUpdatedAt }: LiveOfferFiltersProps) {
  const { filters, setFilters } = useFilters();
  const { timezone } = useTimezone();
  const panelRef = useRef<HTMLDivElement>(null);

  const lastUpdated = lastUpdatedAt ? `Updated ${formatTimeOnly(lastUpdatedAt, timezone)}` : '';

  return (
    <div ref={panelRef} className="relative flex flex-col gap-3 min-w-0">
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Reference source</span>
        <select
          value={filters.cex}
          onChange={event => setFilters({ cex: event.target.value })}
          className={controlCls}
          title="CEX reference-price source used while displaying offers"
        >
          {SOURCE_OPTIONS.map(source => <option key={source} value={source}>{source[0].toUpperCase() + source.slice(1)}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className={labelCls}>Payment</span>
        <PaymentDropdown value={filters.payment} onChange={v => setFilters({ payment: v })} inputCls={controlCls} containerRef={panelRef} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2">
        <span className="text-[0.68rem] text-muted truncate">{lastUpdated}</span>
        <button
          onClick={onRefresh}
          className="shrink-0 rounded border border-accent bg-accent px-2.5 py-1 text-[0.72rem] font-semibold text-black transition-opacity hover:opacity-85"
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}

/**
 * Past-only payment-scope control. Fiat / Premium / Range live in
 * SharedOfferFilters; timeframe / duration / profit / size mode stay in the
 * Insights sidebar below this block.
 */
export function PastOfferFilters({ paymentFilter, onPaymentFilterChange }: {
  paymentFilter: 'settings' | 'all';
  onPaymentFilterChange: (filter: 'settings' | 'all') => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>Payments</span>
      <select
        value={paymentFilter}
        onChange={event => onPaymentFilterChange(event.target.value as 'settings' | 'all')}
        className={controlCls}
        title="Choose whether past offers use every payment method or only methods enabled in Settings"
      >
        <option value="settings">Selected in Settings</option>
        <option value="all">All payment methods</option>
      </select>
    </label>
  );
}
