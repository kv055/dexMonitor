import { useFilters } from '../context/FiltersContext';

interface Props {
  onRefresh: () => void;
  lastUpdated: string;
}

export function ControlPanel({ onRefresh, lastUpdated }: Props) {
  const { filters, setFilters, resetFilters, paymentMethods } = useFilters();

  const inputCls = "bg-bg text-text border border-border rounded-md px-2 py-1 text-[0.8rem] cursor-pointer outline-none focus:border-accent transition-colors";
  const disabledInputCls = `${inputCls} opacity-45 cursor-not-allowed`;

  return (
    <div className="flex flex-col gap-0">
      {/* Market section */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5 py-2">
        <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted opacity-60 w-full mb-0.5">Market</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Fiat Currency</span>
          <select className={disabledInputCls} disabled defaultValue="EUR">
            <option value="EUR">EUR — Euro</option>
            <option value="USD">USD — US Dollar</option>
            <option value="GBP">GBP — British Pound</option>
            <option value="CHF">CHF — Swiss Franc</option>
            <option value="CZK">CZK — Czech Koruna</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Reference Price</span>
          <select className={disabledInputCls} disabled defaultValue="kraken_eur">
            <option value="kraken_eur">BTC/EUR — Kraken</option>
          </select>
        </div>
      </div>

      {/* Filters section */}
      <div className="border-t border-border grid grid-cols-3 items-end gap-x-3 gap-y-1.5 py-2 w-fit">
        <span className="col-span-3 text-[0.6rem] font-semibold uppercase tracking-widest text-muted opacity-60 w-full mb-0.5">Filters</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Side</span>
          <select className={inputCls} value={filters.direction} onChange={e => setFilters({ direction: e.target.value })}>
            <option value="">All</option>
            <option value="sell">Asks (Sell)</option>
            <option value="buy">Bids (Buy)</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Exchange</span>
          <select className={inputCls} value={filters.exchange} onChange={e => setFilters({ exchange: e.target.value })}>
            <option value="">All Exchanges</option>
            <option value="hodlhodl">HodlHodl</option>
            <option value="robosats">Robosats</option>
            <option value="bisq">Bisq</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Payment</span>
          <select className={inputCls} value={filters.payment} onChange={e => setFilters({ payment: e.target.value })}>
            <option value="">All Payments</option>
            {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Status</span>
          <select className={inputCls} value={filters.status} onChange={e => setFilters({ status: e.target.value })}>
            <option value="">All Orders</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Premium %</span>
          <div className="flex gap-1 items-center">
            <input type="number" className={`${inputCls} w-[3.8rem]`} placeholder="Min" step="0.1"
              value={filters.premiumMin} onChange={e => setFilters({ premiumMin: e.target.value })} />
            <span className="text-muted text-[0.8rem]">–</span>
            <input type="number" className={`${inputCls} w-[3.8rem]`} placeholder="Max" step="0.1"
              value={filters.premiumMax} onChange={e => setFilters({ premiumMax: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-col gap-0.5 justify-end">
          <button
            onClick={() => setFilters({ premiumOnly: !filters.premiumOnly })}
            className={`inline-flex items-center gap-1.5 border rounded-full px-3 py-1 text-[0.78rem] cursor-pointer whitespace-nowrap transition-all before:content-[''] before:w-[7px] before:h-[7px] before:rounded-full before:transition-colors
              ${filters.premiumOnly
                ? 'bg-[rgba(247,147,26,0.1)] text-accent border-accent before:bg-accent'
                : 'bg-bg text-muted border-border before:bg-border'
              }`}
          >
            Premium Only
          </button>
        </div>
      </div>

      {/* View section */}
      <div className="border-t border-border flex flex-wrap items-end gap-x-3 gap-y-1.5 py-2">
        <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted opacity-60 w-full mb-0.5">View</span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide">Timeframe</span>
          <select className={inputCls} value={filters.hours} onChange={e => setFilters({ hours: e.target.value })}>
            <option value="1">Last 1h</option>
            <option value="6">Last 6h</option>
            <option value="24">Last 24h</option>
            <option value="48">Last 48h</option>
            <option value="168">Last 7d</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.8rem] text-muted">{lastUpdated}</span>
          <button onClick={resetFilters} className="bg-red text-black border-none rounded-md px-3 py-1 text-[0.8rem] font-semibold cursor-pointer whitespace-nowrap hover:opacity-85 transition-opacity">
            ↺ Reset
          </button>
          <button onClick={onRefresh} className="bg-accent text-black border-none rounded-md px-3 py-1 text-[0.8rem] font-semibold cursor-pointer whitespace-nowrap hover:opacity-85 transition-opacity">
            ↻ Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
