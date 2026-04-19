import { useState, useRef, useEffect, useMemo } from 'react';
import { useFilters } from '../context/FiltersContext';
import { useTimezone } from '../context/TimezoneContext';
import type { PremiumFilterMode, Stats } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { formatTimeOnly } from '../utils/formatters';
import { getLastSeen, getPremiumMetricValue, isOfferLive } from '../utils/offerAccess';

const PAYMENT_PALETTE = [
  '#f7931a', '#3fb950', '#bc8cff', '#58a6ff', '#f85149',
  '#d29922', '#39d353', '#db61a2', '#79c0ff', '#e3b341', '#4a4f58',
];

const PREMIUM_FILTER_OPTIONS: { value: PremiumFilterMode; label: string }[] = [
  { value: 'raw', label: 'Raw Premium' },
  { value: 'net_full', label: 'Net Premium Full' },
  { value: 'net_capped', label: 'Net Premium Capped' },
];

interface Props {
  onRefresh: () => void;
  lastUpdatedAt: string;
  stats: Stats | null;
}

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
    if (filters.status === 'open')   f = f.filter(o => isOfferLive(o));
    if (filters.status === 'closed') f = f.filter(o => !isOfferLive(o));
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
    f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);

    const counts: Record<string, number> = {};
    f.forEach(o => {
      const pm = o.payment_method || 'Unknown';
      counts[pm] = (counts[pm] || 0) + 1;
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
  onChange: (v: PremiumFilterMode) => void;
  inputCls: string;
}

function PremiumModeDropdown({ value, onChange, inputCls }: PremiumModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = PREMIUM_FILTER_OPTIONS.find(opt => opt.value === value) ?? PREMIUM_FILTER_OPTIONS[0];

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
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors ${value === opt.value ? 'text-accent bg-bg' : 'text-text'}`}
            >
              <span className="text-[0.8rem]">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface DirectionDropdownProps {
  value: string;
  onChange: (v: string) => void;
  inputCls: string;
}

function DirectionDropdown({ value, onChange, inputCls }: DirectionDropdownProps) {
  const { offers, filters } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const counts = useMemo(() => {
    let f = offers;
    if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment)  f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open')   f = f.filter(o => isOfferLive(o));
    if (filters.status === 'closed') f = f.filter(o => !isOfferLive(o));
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
    f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);

    return {
      all:  f.length,
      sell: f.filter(o => o.direction === 'sell').length,
      buy:  f.filter(o => o.direction === 'buy').length,
    };
  }, [offers, filters]);

  const OPTIONS = [
    { value: '',     label: 'All',        count: counts.all },
    { value: 'sell', label: 'Asks (Sell)', count: counts.sell },
    { value: 'buy',  label: 'Bids (Buy)',  count: counts.buy },
  ];
  const selected = OPTIONS.find(o => o.value === value) ?? OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`${inputCls} flex items-center gap-1.5 w-full`}
      >
        <span className="text-[0.8rem]">{selected.label}</span>
        <span className="text-muted text-[0.75rem]">{selected.count}</span>
        <span className="ml-auto text-muted text-[0.65rem]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md overflow-hidden min-w-full shadow-lg">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors flex items-center justify-between gap-3 ${value === opt.value ? 'text-accent' : 'text-text'}`}
            >
              <span className="text-[0.8rem]">{opt.label}</span>
              <span className="text-muted text-[0.75rem]">{opt.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface StatusDropdownProps {
  value: string;
  onChange: (v: string) => void;
  inputCls: string;
}

function StatusDropdown({ value, onChange, inputCls }: StatusDropdownProps) {
  const { offers, filters } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const counts = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment)   f = f.filter(o => o.payment_method === filters.payment);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
    f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);

    return {
      all:    f.length,
      open:   f.filter(o => isOfferLive(o)).length,
      closed: f.filter(o => !isOfferLive(o)).length,
    };
  }, [offers, filters]);

  const OPTIONS = [
    { value: '',       label: 'All Orders', count: counts.all },
    { value: 'open',   label: 'Open',       count: counts.open },
    { value: 'closed', label: 'Closed',     count: counts.closed },
  ];
  const selected = OPTIONS.find(o => o.value === value) ?? OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`${inputCls} flex items-center gap-1.5 w-full`}
      >
        <span className="text-[0.8rem]">{selected.label}</span>
        <span className="text-muted text-[0.75rem]">{selected.count}</span>
        <span className="ml-auto text-muted text-[0.65rem]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md overflow-hidden min-w-full shadow-lg">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors flex items-center justify-between gap-3 ${value === opt.value ? 'text-accent' : 'text-text'}`}
            >
              <span className="text-[0.8rem]">{opt.label}</span>
              <span className="text-muted text-[0.75rem]">{opt.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ExchangeDropdownProps {
  value: string;
  onChange: (v: string) => void;
  stats: Stats;
  inputCls: string;
}

function ExchangeDropdown({ value, onChange, stats, inputCls }: ExchangeDropdownProps) {
  const { offers, filters } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const countMap = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.payment)   f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open')   f = f.filter(o => isOfferLive(o));
    if (filters.status === 'closed') f = f.filter(o => !isOfferLive(o));
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
    f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);

    const map: Record<string, number> = {};
    f.forEach(o => { map[o.exchange] = (map[o.exchange] || 0) + 1; });
    return map;
  }, [offers, filters]);

  const totalOffers = Object.values(countMap).reduce((s, n) => s + n, 0);
  const selectedCount = value ? (countMap[value] ?? 0) : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`${inputCls} flex items-center gap-1.5 w-full`}
      >
        {value ? (
          <>
            <ExchangeTag exchange={value} />
            <span className="text-muted text-[0.75rem]">{selectedCount}</span>
          </>
        ) : (
          <span className="text-[0.8rem]">All Exchanges</span>
        )}
        <span className="ml-auto text-muted text-[0.65rem]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md overflow-hidden min-w-full shadow-lg">
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors flex items-center justify-between ${!value ? 'text-accent' : 'text-text'}`}
          >
            <span className="text-[0.8rem]">All Exchanges</span>
            <span className="text-muted text-[0.75rem]">{totalOffers}</span>
          </button>
          {stats.offer_counts.map(e => (
            <button
              key={e.exchange}
              onClick={() => { onChange(e.exchange); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors flex items-center justify-between gap-3 ${value === e.exchange ? 'bg-bg' : ''}`}
            >
              <ExchangeTag exchange={e.exchange} />
              <span className="text-muted text-[0.75rem]">{countMap[e.exchange] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TIMEFRAME_OPTIONS = [
  { value: '1',   label: 'Last 1h' },
  { value: '6',   label: 'Last 6h' },
  { value: '24',  label: 'Last 24h' },
  { value: '48',  label: 'Last 48h' },
  { value: '168', label: 'Last 7d' },
];

interface TimeframeDropdownProps {
  value: string;
  onChange: (v: string) => void;
  inputCls: string;
}

function TimeframeDropdown({ value, onChange, inputCls }: TimeframeDropdownProps) {
  const { offers, filters } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const counts = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment)   f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open')   f = f.filter(o => isOfferLive(o));
    if (filters.status === 'closed') f = f.filter(o => !isOfferLive(o));
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
    f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);

    const now = Date.now();
    const result: Record<string, number> = {};
    for (const opt of TIMEFRAME_OPTIONS) {
      // Normalize to DB timestamp format ("2024-01-15 13:00:00") so string
      // comparison works correctly — DB uses space, not T.
      const cutoff = new Date(now - parseInt(opt.value) * 3600 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
      result[opt.value] = f.filter(o => getLastSeen(o) != null && getLastSeen(o)! >= cutoff).length;
    }
    return result;
  }, [offers, filters]);

  const selected = TIMEFRAME_OPTIONS.find(o => o.value === value) ?? TIMEFRAME_OPTIONS[2];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`${inputCls} flex items-center gap-1.5 w-full`}
      >
        <span className="text-[0.8rem]">{selected.label}</span>
        <span className="text-muted text-[0.75rem]">{counts[value]}</span>
        <span className="ml-auto text-muted text-[0.65rem]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md overflow-hidden min-w-full shadow-lg">
          {TIMEFRAME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors flex items-center justify-between gap-3 ${value === opt.value ? 'text-accent' : 'text-text'}`}
            >
              <span className="text-[0.8rem]">{opt.label}</span>
              <span className="text-muted text-[0.75rem]">{counts[opt.value]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ControlPanel({ onRefresh, lastUpdatedAt, stats }: Props) {
  const { filters, setFilters, resetFilters } = useFilters();
  const { timezone } = useTimezone();
  const panelRef = useRef<HTMLDivElement>(null);

  const inputCls = "bg-bg text-text border border-border rounded-md px-2 py-0.5 text-[0.8rem] cursor-pointer outline-none focus:border-accent transition-colors";
  const disabledInputCls = `${inputCls} opacity-45 cursor-not-allowed`;
  const lastUpdated = lastUpdatedAt ? `Updated ${formatTimeOnly(lastUpdatedAt, timezone)}` : '';

  return (
    <div ref={panelRef} className="relative flex flex-col gap-1">
      {/* Row 1: market config + timeframe + actions */}
      <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Currency</span>
          <select className={disabledInputCls} disabled defaultValue="EUR">
            <option value="EUR">EUR — Euro</option>
            <option value="USD">USD — US Dollar</option>
            <option value="GBP">GBP — British Pound</option>
            <option value="CHF">CHF — Swiss Franc</option>
            <option value="CZK">CZK — Czech Koruna</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Ref Price</span>
          <select
            className={inputCls}
            value={filters.cex}
            onChange={e => setFilters({ cex: e.target.value })}
          >
            <option value="kraken">BTC/EUR — Kraken</option>
            <option value="binance">BTC/EUR — Binance</option>
            <option value="bitstamp">BTC/EUR — Bitstamp</option>
            <option value="coinbase">BTC/EUR — Coinbase</option>
          </select>
        </div>
        <div className="w-px h-5 bg-border self-end mb-0.5 mx-1" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Timeframe</span>
          <TimeframeDropdown
            value={filters.hours}
            onChange={v => setFilters({ hours: v })}
            inputCls={inputCls}
          />
        </div>
        <div className="flex items-end gap-1.5">
          <span className="text-[0.75rem] text-muted pb-0.5">{lastUpdated}</span>
          <button onClick={resetFilters} className="bg-red text-black border-none rounded-md px-2.5 py-0.5 text-[0.78rem] font-semibold cursor-pointer whitespace-nowrap hover:opacity-85 transition-opacity">
            ↺ Reset
          </button>
          <button onClick={onRefresh} className="bg-accent text-black border-none rounded-md px-2.5 py-0.5 text-[0.78rem] font-semibold cursor-pointer whitespace-nowrap hover:opacity-85 transition-opacity">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Row 2: filters */}
      <div className="border-t border-border pt-1 grid grid-cols-2 sm:grid-cols-3 items-end gap-x-2 gap-y-0.5 w-full sm:w-fit">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Side</span>
          <DirectionDropdown
            value={filters.direction}
            onChange={v => setFilters({ direction: v })}
            inputCls={inputCls}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Exchange</span>
          <ExchangeDropdown
            value={filters.exchange}
            onChange={v => setFilters({ exchange: v })}
            stats={stats ?? { offer_counts: [], price_stats: [] }}
            inputCls={inputCls}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Payment</span>
          <PaymentDropdown
            value={filters.payment}
            onChange={v => setFilters({ payment: v })}
            inputCls={inputCls}
            containerRef={panelRef}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Status</span>
          <StatusDropdown
            value={filters.status}
            onChange={v => setFilters({ status: v })}
            inputCls={inputCls}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Premium Type</span>
          <PremiumModeDropdown
            value={filters.premiumMode}
            onChange={v => setFilters({ premiumMode: v })}
            inputCls={inputCls}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Premium %</span>
          <div className="flex gap-1 items-center">
            <input type="number" className={`${inputCls} w-14`} placeholder="Min" step="0.1"
              value={filters.premiumMin} onChange={e => setFilters({ premiumMin: e.target.value })} />
            <span className="text-muted text-[0.8rem]">–</span>
            <input type="number" className={`${inputCls} w-14`} placeholder="Max" step="0.1"
              value={filters.premiumMax} onChange={e => setFilters({ premiumMax: e.target.value })} />
          </div>
        </div>
      </div>
    </div>
  );
}
