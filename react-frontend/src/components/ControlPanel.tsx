import { useState, useRef, useEffect, useMemo } from 'react';
import { useFilters } from '../context/FiltersContext';
import type { Stats } from '../types';
import { ExchangeTag } from './ExchangeTag';

const PAYMENT_PALETTE = [
  '#f7931a', '#3fb950', '#bc8cff', '#58a6ff', '#f85149',
  '#d29922', '#39d353', '#db61a2', '#79c0ff', '#e3b341', '#4a4f58',
];

interface Props {
  onRefresh: () => void;
  lastUpdated: string;
  stats: Stats | null;
}

interface PaymentDropdownProps {
  value: string;
  onChange: (v: string) => void;
  inputCls: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function PaymentDropdown({ value, onChange, inputCls, containerRef }: PaymentDropdownProps) {
  const { offers, filters } = useFilters();
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

  const sorted = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (filters.status === 'open')   f = f.filter(o => o.is_live);
    if (filters.status === 'closed') f = f.filter(o => !o.is_live);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o =>
      o.direction === 'buy'
        ? (o.price_diff_percent ?? 0) > 0
        : (o.price_diff_percent ?? 0) < 0
    );

    const counts: Record<string, number> = {};
    f.forEach(o => {
      const pm = o.payment_method || 'Unknown';
      counts[pm] = (counts[pm] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [offers, filters]);

  const maxCount = sorted[0]?.[1] ?? 1;
  const total = sorted.reduce((s, [, c]) => s + c, 0);
  const selectedIdx = value ? sorted.findIndex(([m]) => m === value) : -1;
  const selectedColor = selectedIdx >= 0 ? PAYMENT_PALETTE[selectedIdx % PAYMENT_PALETTE.length] : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className={`${inputCls} flex items-center gap-1.5 w-full`}
      >
        {value && selectedColor ? (
          <>
            <span className="w-1.75 h-1.75 rounded-full shrink-0" style={{ backgroundColor: selectedColor }} />
            <span className="text-[0.8rem] truncate">{value}</span>
          </>
        ) : (
          <span className="text-[0.8rem]">All Payments</span>
        )}
        <span className="ml-auto text-muted text-[0.65rem]">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface border border-border rounded-md overflow-hidden shadow-lg min-w-45" style={{ maxWidth: menuMaxWidth }}>
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 hover:bg-bg transition-colors flex items-center justify-between ${!value ? 'text-accent' : 'text-text'}`}
          >
            <span className="text-[0.8rem]">All Payments</span>
            <span className="text-muted text-[0.75rem]">{total}</span>
          </button>
          <div className="max-h-65 overflow-y-auto">
            {sorted.map(([method, count], i) => {
              const pct = (count / maxCount) * 100;
              const color = PAYMENT_PALETTE[i % PAYMENT_PALETTE.length];
              const isSelected = value === method;
              return (
                <button
                  key={method}
                  onClick={() => { onChange(method); setOpen(false); }}
                  className={`w-full text-left px-3 py-1.25 flex items-center gap-2 relative overflow-hidden transition-colors ${isSelected ? 'bg-bg' : 'hover:bg-bg'}`}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 pointer-events-none rounded-r-sm"
                    style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.55 }}
                  />
                  <span className="relative w-1.75 h-1.75 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="relative text-[0.78rem] text-text flex-1 truncate">{method}</span>
                  <span className="relative text-[0.72rem] text-muted">{count}</span>
                </button>
              );
            })}
          </div>
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
    if (filters.status === 'open')   f = f.filter(o => o.is_live);
    if (filters.status === 'closed') f = f.filter(o => !o.is_live);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o =>
      o.direction === 'buy'
        ? (o.price_diff_percent ?? 0) > 0
        : (o.price_diff_percent ?? 0) < 0
    );

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
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o =>
      o.direction === 'buy'
        ? (o.price_diff_percent ?? 0) > 0
        : (o.price_diff_percent ?? 0) < 0
    );

    return {
      all:    f.length,
      open:   f.filter(o => o.is_live).length,
      closed: f.filter(o => !o.is_live).length,
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
    if (filters.status === 'open')   f = f.filter(o => o.is_live);
    if (filters.status === 'closed') f = f.filter(o => !o.is_live);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o =>
      o.direction === 'buy'
        ? (o.price_diff_percent ?? 0) > 0
        : (o.price_diff_percent ?? 0) < 0
    );

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
    if (filters.status === 'open')   f = f.filter(o => o.is_live);
    if (filters.status === 'closed') f = f.filter(o => !o.is_live);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o =>
      o.direction === 'buy'
        ? (o.price_diff_percent ?? 0) > 0
        : (o.price_diff_percent ?? 0) < 0
    );

    const now = Date.now();
    const result: Record<string, number> = {};
    for (const opt of TIMEFRAME_OPTIONS) {
      // Normalize to DB timestamp format ("2024-01-15 13:00:00") so string
      // comparison works correctly — DB uses space, not T.
      const cutoff = new Date(now - parseInt(opt.value) * 3600 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
      result[opt.value] = f.filter(o => o.last_seen != null && o.last_seen >= cutoff).length;
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

export function ControlPanel({ onRefresh, lastUpdated, stats }: Props) {
  const { filters, setFilters, resetFilters } = useFilters();
  const panelRef = useRef<HTMLDivElement>(null);

  const inputCls = "bg-bg text-text border border-border rounded-md px-2 py-0.5 text-[0.8rem] cursor-pointer outline-none focus:border-accent transition-colors";
  const disabledInputCls = `${inputCls} opacity-45 cursor-not-allowed`;

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
          <select className={disabledInputCls} disabled defaultValue="kraken_eur">
            <option value="kraken_eur">BTC/EUR — Kraken</option>
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
      <div className="border-t border-border pt-1 grid grid-cols-3 items-end gap-x-2 gap-y-0.5 w-fit">
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
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Premium %</span>
          <div className="flex gap-1 items-center">
            <input type="number" className={`${inputCls} w-14`} placeholder="Min" step="0.1"
              value={filters.premiumMin} onChange={e => setFilters({ premiumMin: e.target.value })} />
            <span className="text-muted text-[0.8rem]">–</span>
            <input type="number" className={`${inputCls} w-14`} placeholder="Max" step="0.1"
              value={filters.premiumMax} onChange={e => setFilters({ premiumMax: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-col gap-0.5 justify-end">
          <button
            onClick={() => setFilters({ premiumOnly: !filters.premiumOnly })}
            className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-0.5 text-[0.75rem] cursor-pointer whitespace-nowrap transition-all before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:transition-colors
              ${filters.premiumOnly
                ? 'bg-[rgba(247,147,26,0.1)] text-accent border-accent before:bg-accent'
                : 'bg-bg text-muted border-border before:bg-border'
              }`}
          >
            Premium Only
          </button>
        </div>
      </div>
    </div>
  );
}
