import React, { useEffect, useRef, useState } from 'react';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, formatBtc, premiumClass } from '../utils/formatters';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';
import type { CostBreakdown, BTCNetworkFeeDetail as BTCDetail } from '../types';

const TH_BASE = "sticky top-0 z-10 bg-surface px-2 py-1 border-b border-border text-muted text-[0.65rem] uppercase text-left whitespace-nowrap";
const TD = "px-2 py-1 whitespace-nowrap";

function fmt8(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
}

function fmtPct(n: number): string {
  return n.toFixed(4).replace(/\.?0+$/, '') + '%';
}

function fmtSignedBtc(n: number): string {
  const abs = fmt8(Math.abs(n));
  if (n > 0) return '+' + abs;
  if (n < 0) return '-' + abs;
  return abs;
}

function fmtFiatAmount(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Number(Math.abs(n)).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n > 0) return '+€' + abs;
  if (n < 0) return '-€' + abs;
  return '€' + abs;
}

const TIER_COLOR: Record<string, string> = {
  economic:  'text-green',
  standard:  'text-accent',
  fast:      'text-red',
  express:   'text-red',
  lightning: 'text-[#bc8cff]',
};

const CONGESTION_COLOR: Record<string, string> = {
  low:        'text-green',
  low_medium: 'text-green',
  medium:     'text-accent',
  high:       'text-red',
};

function Badge({ label, colorCls }: { label: string; colorCls?: string }) {
  return (
    <span className={`text-[0.6rem] px-1.5 py-px rounded-full border border-border bg-bg capitalize ${colorCls ?? 'text-muted'}`}>
      {label}
    </span>
  );
}

function OnchainFeeDetail({ d, conf }: { d: BTCDetail; conf: number }) {
  const tierCls = TIER_COLOR[d.congestion_level] ?? 'text-muted';
  const congCls = CONGESTION_COLOR[d.congestion_level] ?? 'text-muted';
  const confPct = conf > 0 ? Math.round(conf * 100) + '%' : null;

  return (
    <tr>
      <td colSpan={4} className="pt-0 pb-2">
        {/* Badge row */}
        <div className="flex items-center gap-1.5 mb-1.5 pl-0.5">
          <Badge label="onchain" />
          <Badge label={d.congestion_level.replace('_', ' ') + ' congestion'} colorCls={congCls} />
          {confPct && <span className="text-[0.6rem] text-muted">{confPct} conf.</span>}
        </div>
        {/* Detail grid */}
        <div className="bg-bg rounded-md border border-border px-2.5 py-2 flex flex-col gap-1.5 text-[0.68rem]">
          {/* Tx structure */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Tx structure</span>
            <span className="text-text font-mono">
              {d.tx_inputs}in · {d.tx_outputs}out · {d.tx_type} · {d.tx_vbytes} vB
            </span>
          </div>
          {/* Selected rate */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Selected rate</span>
            <span className={`font-medium ${tierCls}`}>{d.selected_sat_vb} sat/vB</span>
          </div>
          {/* All tiers */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted shrink-0">All tiers</span>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span><span className="text-green">eco</span> <span className="text-text">{d.economic_sat_vb}</span></span>
              <span className="text-border">·</span>
              <span><span className="text-accent">std</span> <span className="text-text">{d.standard_sat_vb}</span></span>
              <span className="text-border">·</span>
              <span><span className="text-red">fast</span> <span className="text-text">{d.fast_sat_vb}</span></span>
              <span className="text-border">·</span>
              <span><span className="text-red">exp</span> <span className="text-text">{d.express_sat_vb}</span></span>
              <span className="text-muted">sat/vB</span>
            </div>
          </div>
          {/* Mempool */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Mempool</span>
            <span className="text-text">{d.mempool_size_mb} MB · {d.unconfirmed_tx_count.toLocaleString()} txs</span>
          </div>
          {/* Data age */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Data age</span>
            <span className="text-muted">{d.data_age_minutes}m ago</span>
          </div>
        </div>
      </td>
    </tr>
  );
}

function LightningFeeDetail({ conf }: { conf: number }) {
  const confPct = conf > 0 ? Math.round(conf * 100) + '%' : null;
  return (
    <tr>
      <td colSpan={4} className="pb-1 pt-0">
        <div className="flex items-center gap-1.5 pl-0.5">
          <Badge label="lightning" colorCls="text-[#bc8cff]" />
          {confPct && <span className="text-[0.6rem] text-muted">{confPct} conf.</span>}
          <span className="text-[0.6rem] text-muted">amount-proportional estimate</span>
        </div>
      </td>
    </tr>
  );
}

function NetworkFeeDetail({ bd }: { bd: CostBreakdown }) {
  if (bd.network_fee_method === 'onchain' && bd.network_fee_detail) {
    return <OnchainFeeDetail d={bd.network_fee_detail} conf={bd.network_fee_confidence} />;
  }
  if (bd.network_fee_method === 'lightning') {
    return <LightningFeeDetail conf={bd.network_fee_confidence} />;
  }
  return null;
}

function CostBreakdownPanel({ bd, priceDiffPct, netPremiumPct, refPrice }: {
  bd: CostBreakdown;
  priceDiffPct: number | null;
  netPremiumPct: number | null;
  refPrice: number | null;
}) {
  const [networkFeeOpen, setNetworkFeeOpen] = useState(false);
  const hasNetworkFeeDetail = bd.network_fee_method === 'onchain'
    ? !!bd.network_fee_detail
    : bd.network_fee_method === 'lightning';

  const rows: { label: string; btc: number; pct: number; expandable?: boolean }[] = [
    { label: 'CEX taker fee',    btc: bd.cex_taker_fee_btc,  pct: bd.cex_taker_fee_pct  },
    { label: 'CEX withdrawal',   btc: bd.withdrawal_fee_btc,  pct: bd.withdrawal_fee_pct  },
    { label: 'BTC network fee',  btc: bd.network_fee_btc,     pct: bd.network_fee_pct,    expandable: hasNetworkFeeDetail },
    { label: 'DEX platform fee', btc: bd.dex_fee_btc,         pct: bd.dex_fee_pct         },
  ];
  const routeCex = bd.route_cex || '—';
  const routeDex = bd.route_dex || '—';
  const routeMethod = bd.route_method || bd.network_fee_method || '—';
  const profitPct = bd.estimated_profit_pct ?? netPremiumPct;
  const profitBtc = bd.estimated_profit_btc ?? (profitPct != null ? bd.btc_amount * (profitPct / 100) : null);
  const profitCls = profitPct < 0 ? 'text-red' : profitPct > 0 ? 'text-green' : 'text-muted';
  const netCls = netPremiumPct != null
    ? netPremiumPct <= 0 ? 'text-red' : netPremiumPct <= 2 ? 'text-green' : 'text-accent'
    : 'text-muted';
  const fiatValue = (btc: number | null | undefined) => (btc != null && refPrice != null ? btc * refPrice : null);

  const profitCardBorder = profitPct == null || profitPct === 0
    ? 'border-border'
    : profitPct > 0 ? 'border-green/30' : 'border-red/30';
  const profitCardBg = profitPct == null || profitPct === 0
    ? 'bg-surface'
    : profitPct > 0 ? 'bg-green/5' : 'bg-red/5';

  return (
    <div className="flex flex-col gap-3 text-[0.72rem]">
      {/* Section header */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-muted uppercase text-[0.62rem] tracking-widest font-semibold">Trade cost breakdown</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-text text-[0.9rem] font-semibold mono-nums">{fmt8(bd.btc_amount)} BTC</span>
          <span className="text-muted text-[0.75rem] mono-nums">{fmtFiatAmount(fiatValue(bd.btc_amount))}</span>
        </div>
      </div>

      {/* Best route row */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-2.5 py-2">
        <span className="text-muted shrink-0">Best route</span>
        <span className="text-right font-medium text-[0.72rem]">
          <span className="text-text">{routeCex}</span>
          <span className="text-muted mx-1.5">→</span>
          <span className="text-text">{routeDex}</span>
          <span className="text-muted mx-1.5">via</span>
          <span className="text-accent">{routeMethod}</span>
        </span>
      </div>

      {/* Cost table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-muted font-normal pb-1.5 pr-3 text-[0.63rem] uppercase tracking-wide">Component</th>
            <th className="text-right text-muted font-normal pb-1.5 pr-3 text-[0.63rem] uppercase tracking-wide">BTC</th>
            <th className="text-right text-muted font-normal pb-1.5 pr-3 text-[0.63rem] uppercase tracking-wide">Fiat</th>
            <th className="text-right text-muted font-normal pb-1.5 text-[0.63rem] uppercase tracking-wide">% of trade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isNetworkFee = r.expandable;
            return (
              <React.Fragment key={r.label}>
                <tr
                  className={`${i % 2 === 0 ? 'bg-grid/40' : ''} ${isNetworkFee ? 'cursor-pointer hover:brightness-110' : ''}`}
                  onClick={isNetworkFee ? () => setNetworkFeeOpen(o => !o) : undefined}
                >
                  <td className="pr-3 py-1 text-muted rounded-l">
                    {isNetworkFee ? (
                      <span className="flex items-center gap-1.5">
                        {r.label}
                        <span className={`text-[0.6rem] text-muted transition-transform duration-150 inline-block ${networkFeeOpen ? 'rotate-180' : ''}`}>▾</span>
                      </span>
                    ) : r.label}
                  </td>
                  <td className="pr-3 py-1 text-right text-text mono-nums">{fmt8(r.btc)}</td>
                  <td className="pr-3 py-1 text-right text-text mono-nums">{fmtFiatAmount(fiatValue(r.btc))}</td>
                  <td className="py-1 text-right text-text mono-nums rounded-r">{fmtPct(r.pct)}</td>
                </tr>
                {isNetworkFee && networkFeeOpen && <NetworkFeeDetail bd={bd} />}
              </React.Fragment>
            );
          })}
          <tr className="border-t border-border">
            <td className="pr-3 pt-2.5 pb-1 font-semibold text-text">Total cost</td>
            <td className="pr-3 pt-2.5 pb-1 text-right font-semibold text-text mono-nums">{fmt8(bd.total_cost_btc)}</td>
            <td className="pr-3 pt-2.5 pb-1 text-right font-semibold text-text mono-nums">{fmtFiatAmount(fiatValue(bd.total_cost_btc))}</td>
            <td className="pt-2.5 pb-1 text-right font-semibold text-red mono-nums">{fmtPct(bd.total_cost_pct)}</td>
          </tr>
          <tr>
            <td className="pr-3 py-1 text-muted">DEX premium</td>
            <td className="pr-3 py-1 text-right text-muted">—</td>
            <td className="pr-3 py-1 text-right text-muted">—</td>
            <td className={`py-1 text-right font-medium mono-nums ${premiumClass(priceDiffPct)}`}>
              {priceDiffPct != null ? fmtPct(priceDiffPct) : '—'}
            </td>
          </tr>
          <tr className="border-t border-border">
            <td className="pr-3 pt-2.5 font-bold text-text text-[0.75rem]">Net premium</td>
            <td className="pr-3 pt-2.5 text-right text-muted">—</td>
            <td className="pr-3 pt-2.5 text-right text-muted">—</td>
            <td className={`pt-2.5 text-right font-bold text-[0.82rem] mono-nums ${netCls}`}>
              {netPremiumPct != null ? fmtPct(netPremiumPct) : '—'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Estimated profit summary card */}
      <div className={`rounded-lg border ${profitCardBorder} ${profitCardBg} px-3 py-2.5`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted uppercase text-[0.62rem] tracking-widest font-semibold">Estimated profit</span>
          <span className={`mono-nums font-bold text-[0.95rem] ${profitCls}`}>
            {profitBtc != null ? fmtSignedBtc(profitBtc) + ' BTC' : '—'}
          </span>
        </div>
        <div className="flex items-center justify-end gap-3 mt-0.5">
          <span className={`mono-nums text-[0.75rem] font-medium ${profitCls}`}>
            {fmtFiatAmount(fiatValue(profitBtc))}
          </span>
          <span className={`mono-nums text-[0.75rem] font-medium ${profitCls}`}>
            {profitPct != null ? fmtPct(profitPct) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function OffersPreviewTable() {
  const { filteredOffers: offers, selectedOfferId, setSelectedOfferId, loading } = useFilters();
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const selectedOffer = offers.find(o => o.id === selectedOfferId) ?? null;
  const hasSelection = selectedOffer !== null;

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedOfferId]);

  // ── Mobile layout: vertical stack ─────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden">

        {/* Table — fills remaining height, scrolls vertically */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && offers.length === 0 && <LoadingSpinner label="Loading offers" />}
          <table className="w-full border-collapse text-[0.72rem]">
            <thead>
              <tr>
                <th className={TH_BASE}>Exch</th>
                <th className={TH_BASE}>Side</th>
                <th className={`${TH_BASE} text-right`}>Prem.</th>
                <th className={`${TH_BASE} text-right`}>Price</th>
                <th className={TH_BASE}>Payment</th>
              </tr>
            </thead>
            <tbody>
              {offers.length === 0 ? (
                !loading && <tr><td colSpan={5} className="p-4 text-center text-muted">No offers</td></tr>
              ) : offers.map((o) => {
                const isSelected = o.id === selectedOfferId;
                return (
                  <tr
                    key={o.id}
                    ref={isSelected ? selectedRowRef : null}
                    onClick={() => setSelectedOfferId(isSelected ? null : o.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'offer-row-selected' : 'offer-row-hover'
                    }`}
                  >
                    <td className={`${TD} overflow-hidden`}>
                      <ExchangeTag exchange={o.exchange} />
                    </td>
                    <td className={`${TD} ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                      {o.direction === 'buy' ? 'Bid' : 'Ask'}
                    </td>
                    <td className={`${TD} text-right ${premiumClass(o.price_diff_percent)}`}>
                      {o.price_diff_percent != null ? o.price_diff_percent.toFixed(1) + '%' : '—'}
                    </td>
                    <td className={`${TD} text-right`}>€{formatNum(o.price)}</td>
                    <td className={`${TD} overflow-hidden max-w-32`}>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                        {o.payment_method || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Breakdown panel — slides up from bottom when offer is selected */}
        <div
          className="shrink-0 border-t border-border overflow-y-auto transition-all duration-300 ease-in-out"
          style={{
            maxHeight: hasSelection ? '55%' : '0%',
            opacity: hasSelection ? 1 : 0,
          }}
        >
          {selectedOffer && (
            <div className="relative pt-10 px-4 pb-4">
              <button
                onClick={() => setSelectedOfferId(null)}
                className="absolute top-3 right-3 z-20 w-7 h-7 flex items-center justify-center text-red hover:text-red/70 bg-transparent border-none cursor-pointer text-xl leading-none rounded transition-colors"
                title="Close"
              >
                ×
              </button>
              {selectedOffer.cost_breakdown ? (
                <CostBreakdownPanel
                  bd={selectedOffer.cost_breakdown}
                  priceDiffPct={selectedOffer.price_diff_percent}
                  netPremiumPct={selectedOffer.net_premium_percent}
                  refPrice={selectedOffer.ref_price}
                />
              ) : (
                <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
              )}
            </div>
          )}
        </div>

      </div>
    );
  }

  // ── Desktop layout: horizontal split ──────────────────────────────────────
  return (
    <div className="absolute inset-0 flex overflow-hidden">

      {/* Left: offers table */}
      <div
        className="overflow-y-auto shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: hasSelection ? '54%' : '100%' }}
      >
        {loading && offers.length === 0 && <LoadingSpinner label="Loading offers" />}
        <table className={`w-full border-collapse ${hasSelection ? 'text-[0.68rem]' : 'text-[0.72rem]'}`}>
          <thead>
            <tr>
              <th className={`${TH_BASE} ${hasSelection ? 'w-[1%]' : ''}`}>Exch</th>
              <th className={`${TH_BASE} ${hasSelection ? 'w-[1%]' : ''}`}>Side</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Prem.</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Price</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Min BTC</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Max BTC</th>
              {!hasSelection && <th className={`${TH_BASE} text-right`}>Fiat Min</th>}
              {!hasSelection && <th className={`${TH_BASE} text-right`}>Fiat Max</th>}
              <th className={TH_BASE}>Payment</th>
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 ? (
              !loading && <tr><td colSpan={hasSelection ? 7 : 9} className="p-4 text-center text-muted">No offers</td></tr>
            ) : offers.map((o) => {
              const isSelected = o.id === selectedOfferId;
              return (
                <tr
                  key={o.id}
                  ref={isSelected ? selectedRowRef : null}
                  onClick={() => setSelectedOfferId(isSelected ? null : o.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'offer-row-selected' : 'offer-row-hover'
                  }`}
                >
                  <td className={`${TD} overflow-hidden`}>
                    <ExchangeTag exchange={o.exchange} />
                  </td>
                  <td className={`${TD} ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                    {o.direction === 'buy' ? 'Bid' : 'Ask'}
                  </td>
                  <td className={`${TD} text-right ${premiumClass(o.price_diff_percent)}`}>
                    {o.price_diff_percent != null ? o.price_diff_percent.toFixed(1) + '%' : '—'}
                  </td>
                  <td className={`${TD} text-right`}>€{formatNum(o.price)}</td>
                  <td className={`${TD} text-right`}>{formatBtc(o.btc_min)}</td>
                  <td className={`${TD} text-right`}>{formatBtc(o.btc_max)}</td>
                  {!hasSelection && (
                    <td className={`${TD} text-right`}>
                      {o.btc_min != null ? `€${formatNum(o.btc_min * o.price)}` : '—'}
                    </td>
                  )}
                  {!hasSelection && (
                    <td className={`${TD} text-right`}>
                      {o.btc_max != null ? `€${formatNum(o.btc_max * o.price)}` : '—'}
                    </td>
                  )}
                  <td className={`${TD} overflow-hidden`}>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                      {o.payment_method || '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Right: cost breakdown panel */}
      <div
        className="border-l border-border overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          width: hasSelection ? '46%' : '0%',
          opacity: hasSelection ? 1 : 0,
          transform: hasSelection ? 'translateX(0)' : 'translateX(16px)',
        }}
      >
        {selectedOffer && (
          <div className="relative pt-10 px-4 pb-4 h-full overflow-y-auto">
            <button
              onClick={() => setSelectedOfferId(null)}
              className="absolute top-3 right-3 z-20 w-7 h-7 flex items-center justify-center text-red hover:text-red/70 bg-transparent border-none cursor-pointer text-xl leading-none rounded transition-colors"
              title="Close"
            >
              ×
            </button>

            {selectedOffer.cost_breakdown ? (
              <CostBreakdownPanel
                bd={selectedOffer.cost_breakdown}
                priceDiffPct={selectedOffer.price_diff_percent}
                netPremiumPct={selectedOffer.net_premium_percent}
                refPrice={selectedOffer.ref_price}
              />
            ) : (
              <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
