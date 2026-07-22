import { useState, useRef, useEffect, useMemo } from 'react';
import { useFilters } from '../hooks/useFilters';
import { useTimezone } from '../hooks/useTimezone';
import type { PremiumFilterMode } from '../types';
import { formatTimeOnly } from '../utils/formatters';
import { getPremiumMetricValue, isOfferLive } from '../utils/offerAccess';

const PAYMENT_PALETTE = [
  '#f7931a', '#3fb950', '#bc8cff', '#58a6ff', '#f85149',
  '#d29922', '#39d353', '#db61a2', '#79c0ff', '#e3b341', '#4a4f58',
];

const PREMIUM_FILTER_OPTIONS: { value: PremiumFilterMode; label: string }[] = [
  { value: 'raw', label: 'Raw Premium' },
  { value: 'net_full', label: 'Net Premium Full' },
  { value: 'net_capped', label: 'Net Premium Capped' },
];

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
}

function PremiumModeDropdown({ value, premiumOnly, onChange, inputCls }: PremiumModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
          {PREMIUM_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value, true); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors ${premiumOnly && value === opt.value ? 'text-accent bg-bg' : 'text-text'}`}
            >
              <span className="text-[0.8rem]">{opt.label}</span>
            </button>
          ))}
          <button
            onClick={() => { onChange(value, false); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors border-t border-border/60 ${!premiumOnly ? 'text-accent bg-bg' : 'text-text'}`}
          >
            <span className="text-[0.8rem]">Incl. non premium offers</span>
          </button>
        </div>
      )}
    </div>
  );
}

const labelCls = "text-[0.65rem] font-semibold uppercase tracking-wide text-muted";
const controlCls = "w-full rounded border border-border bg-bg/60 px-2 py-1.5 text-[0.75rem] font-medium text-text outline-none transition-colors hover:border-accent/50 focus:border-accent";

interface LiveOfferFiltersProps {
  onRefresh: () => void;
  lastUpdatedAt: string;
}

/**
 * Live-offer-specific filter controls (payment method, premium metric, premium
 * range) wired to the shared FiltersContext, plus the refresh action. Shared
 * Direction/Exchange controls are rendered by the Insights sidebar itself.
 */
export function LiveOfferFilters({ onRefresh, lastUpdatedAt }: LiveOfferFiltersProps) {
  const { filters, setFilters } = useFilters();
  const { timezone } = useTimezone();
  const panelRef = useRef<HTMLDivElement>(null);

  const lastUpdated = lastUpdatedAt ? `Updated ${formatTimeOnly(lastUpdatedAt, timezone)}` : '';

  return (
    <div ref={panelRef} className="relative flex flex-col gap-3 min-w-0">
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

      <div className="flex flex-col gap-1">
        <span className={labelCls}>Premium</span>
        <PremiumModeDropdown
          value={filters.premiumMode}
          premiumOnly={filters.premiumOnly}
          onChange={(v, premiumOnly) => setFilters({ premiumMode: v, ...(premiumOnly == null ? {} : { premiumOnly }) })}
          inputCls={controlCls}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className={labelCls}>Premium range</span>
        <div className="grid grid-cols-2 gap-2 min-w-0">
          <input
            type="number"
            className={`${controlCls} min-w-0`}
            placeholder="Min"
            step="0.1"
            value={filters.premiumMin}
            onChange={e => setFilters({ premiumMin: e.target.value })}
          />
          <input
            type="number"
            className={`${controlCls} min-w-0`}
            placeholder="Max"
            step="0.1"
            value={filters.premiumMax}
            onChange={e => setFilters({ premiumMax: e.target.value })}
          />
        </div>
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

// Past offers use the same frontend-only fiat selection as the live feed, but
// their controls are shown in a separate panel. Keeping the selector here
// makes the active historical dataset explicit while the Past Offers view is
// open.
export function PastOfferFilters({ paymentFilter, onPaymentFilterChange }: {
  paymentFilter: 'settings' | 'all';
  onPaymentFilterChange: (filter: 'settings' | 'all') => void;
}) {
  const { filters, setFilters } = useFilters();

  return (<>
    <label className="flex flex-col gap-1">
      <span className={labelCls}>Fiat</span>
      <select
        value={filters.fiat}
        onChange={event => setFilters({ fiat: event.target.value })}
        className={controlCls}
        title="Show past offers quoted in this currency"
      >
        {FIAT_OPTIONS.map(currency => <option key={currency} value={currency}>{currency}</option>)}
      </select>
    </label>
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
  </>);
}
