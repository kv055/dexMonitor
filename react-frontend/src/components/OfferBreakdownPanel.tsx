import React, { useState } from 'react';
import { formatDuration, formatTime, premiumClass } from '../utils/formatters';
import { stripTrailingZeros } from '../utils/numberFormat';
import { formatFiat, formatSignedFiat } from '../utils/currency';
import { useFilters } from '../hooks/useFilters';
import type { AbortCostBreakdown, BTCNetworkFeeDetail as BTCDetail, CapitalRequirement, CostBreakdown } from '../types';

function fmt8(n: number): string {
  return stripTrailingZeros(n.toFixed(8));
}

function fmtPct(n: number): string {
  return stripTrailingZeros(n.toFixed(4)) + '%';
}

function fmtRatioPct(n: number): string {
  return stripTrailingZeros((n * 100).toFixed(2)) + '%';
}

function fmtLeverage(n: number): string {
  return stripTrailingZeros(n.toFixed(2)) + 'x';
}

function fmtSignedBtc(n: number): string {
  const abs = fmt8(Math.abs(n));
  if (n > 0) return '+' + abs;
  if (n < 0) return '-' + abs;
  return abs;
}

function fmtFiatAmount(n: number | null | undefined, currency: string): string {
  return formatSignedFiat(n, currency);
}

function fmtEtaMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) return '—';
  if (totalMinutes < 60) return `~${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `~${hours}h`;
  return `~${hours}h ${minutes}m`;
}

const TIER_COLOR: Record<string, string> = {
  economic: 'text-green',
  standard: 'text-accent',
  fast: 'text-red',
  express: 'text-red',
  lightning: 'text-[#bc8cff]',
};

const CONGESTION_COLOR: Record<string, string> = {
  low: 'text-green',
  low_medium: 'text-green',
  medium: 'text-accent',
  high: 'text-red',
};

function Badge({ label, colorCls }: { label: string; colorCls?: string }) {
  return (
    <span className={`text-[0.6rem] px-1.5 py-px rounded-full border border-border bg-bg capitalize ${colorCls ?? 'text-muted'}`}>
      {label}
    </span>
  );
}

const ROUTE_EXPLANATIONS: Record<string, string> = {
  onchain_direct: 'CEX withdraw → DEX wallet (direct)',
  onchain_hub: 'CEX withdraw → LND hub wallet → trade destination',
  onchain_swap: 'CEX withdraw → LND wallet → submarine swap into Lightning',
};

function OnchainFeeDetail({ d, conf, bd }: { d: BTCDetail; conf: number; bd: CostBreakdown }) {
  const tierCls = TIER_COLOR[d.congestion_level] ?? 'text-muted';
  const congCls = CONGESTION_COLOR[d.congestion_level] ?? 'text-muted';
  const confPct = conf > 0 ? Math.round(conf * 100) + '%' : null;
  const method = bd.route_method || bd.network_fee_method || '';
  const conv = bd.conversion;
  const hasConversion = conv && conv.fee_sum_btc > 0;

  return (
    <>
      <div className="flex items-center gap-1.5 mb-1.5 pl-0.5">
        <Badge label="onchain" />
        <Badge label={d.congestion_level.replace('_', ' ') + ' congestion'} colorCls={congCls} />
        {confPct && <span className="text-[0.6rem] text-muted">{confPct} conf.</span>}
      </div>
      <div className="bg-bg rounded-md border border-border px-2.5 py-2 flex flex-col gap-1.5 text-[0.68rem]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">On-chain tx</span>
          <span className="text-text font-mono">
            {d.tx_inputs}in · {d.tx_outputs}out · {d.tx_type} · {d.tx_vbytes} vB
            {d.num_txs > 1 && <span className="text-orange-400 ml-1.5">× {d.num_txs} txs</span>}
          </span>
        </div>
        {ROUTE_EXPLANATIONS[method] && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Route</span>
            <span className="text-muted text-right">{ROUTE_EXPLANATIONS[method]}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">Selected rate</span>
          <span className={`font-medium ${tierCls}`}>{d.selected_sat_vb} sat/vB</span>
        </div>
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
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">Mempool</span>
          <span className="text-text">{d.mempool_size_mb} MB · {d.unconfirmed_tx_count.toLocaleString()} txs</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted">Prediction</span>
          <div className="text-right">
            <div className="text-text">
              {d.required_confirmations} conf
              <span className="text-muted"> · </span>
              selected {fmtEtaMinutes(d.selected_full_confirmation_minutes)}
            </div>
            <div className="text-[0.64rem] text-muted">
              eco {fmtEtaMinutes(d.economic_full_confirmation_minutes)}
              <span className="text-border"> · </span>
              std {fmtEtaMinutes(d.standard_full_confirmation_minutes)}
              <span className="text-border"> · </span>
              fast {fmtEtaMinutes(d.fast_full_confirmation_minutes)}
              <span className="text-border"> · </span>
              exp {fmtEtaMinutes(d.express_full_confirmation_minutes)}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">Data age</span>
          <span className="text-muted">{d.data_age_minutes}m ago</span>
        </div>
      </div>

      {hasConversion && (
        <>
          <div className="flex items-center gap-1.5 mt-2 mb-1.5 pl-0.5">
            <Badge label="submarine swap" colorCls="text-[#bc8cff]" />
            {conv.strategy && <Badge label={conv.strategy.replace('_', ' ')} colorCls="text-[#bc8cff]" />}
          </div>
          <div className="bg-bg rounded-md border border-border px-2.5 py-2 flex flex-col gap-1.5 text-[0.68rem]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Service fee</span>
              <span className="text-text font-mono">{fmt8(conv.service_fee_btc)} BTC <span className="text-muted">({(conv.service_fee_pct).toFixed(2)}%)</span></span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Provider miner fee</span>
              <span className="text-text font-mono">{fmt8(conv.provider_miner_btc)} BTC</span>
            </div>
            {conv.routing_fee_btc > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">LN routing fee</span>
                <span className="text-text font-mono">{fmt8(conv.routing_fee_btc)} BTC</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
              <span className="text-muted font-medium">Swap total</span>
              <span className="text-text font-mono font-medium">{fmt8(conv.fee_sum_btc)} BTC <span className="text-muted">({(conv.fee_sum_pct).toFixed(2)}%)</span></span>
            </div>
            {conv.crossover_amount_btc > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Crossover amount</span>
                <span className="text-muted font-mono">{fmt8(conv.crossover_amount_btc)} BTC</span>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function HedgeFeeDetail({ bd }: { bd: CostBreakdown }) {
	const { filters } = useFilters();
  if (bd.hedge.fee_sum_btc <= 0) return null;
  const position = bd.hedge.position;

  return (
    <div className="bg-bg rounded-md border border-border px-2.5 py-2 flex flex-col gap-1.5 text-[0.68rem]">
      <div className="flex items-center gap-1.5 mb-0.5 pl-0.5">
        <Badge label="hedge" colorCls="text-accent" />
        {bd.hedge.venue && <Badge label={bd.hedge.venue.replaceAll('_', ' ')} colorCls="text-accent" />}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Instrument</span>
        <span className="text-text font-mono">{bd.hedge.instrument || '—'}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Transfer window</span>
        <span className="text-text">{fmtEtaMinutes(bd.hedge.transfer_minutes)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Hedge cost</span>
        <div className="text-right">
          <div className="text-text mono-nums">{fmt8(bd.hedge.fee_sum_btc)} BTC</div>
          <div className="text-[0.64rem] text-muted mono-nums">{fmtPct(bd.hedge.fee_sum_pct)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Open fee</span>
        <div className="text-right">
          <div className="text-text mono-nums">{fmt8(bd.hedge.open_fee_btc)} BTC</div>
          <div className="text-[0.64rem] text-muted mono-nums">{fmtPct(bd.hedge.open_fee_pct)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Close fee</span>
        <div className="text-right">
          <div className="text-text mono-nums">{fmt8(bd.hedge.close_fee_btc)} BTC</div>
          <div className="text-[0.64rem] text-muted mono-nums">{fmtPct(bd.hedge.close_fee_pct)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Funding</span>
        <div className="text-right">
          <div className="text-text mono-nums">{fmt8(bd.hedge.funding_fee_btc)} BTC</div>
          <div className="text-[0.64rem] text-muted mono-nums">{fmtPct(bd.hedge.funding_fee_pct)}</div>
        </div>
      </div>
      {position && (
        <>
          <div className="mt-1 pt-1.5 border-t border-border/80 flex items-center gap-1.5 mb-0.5 pl-0.5">
            <Badge label="position" colorCls="text-blue" />
            <span className="text-[0.6rem] text-muted">
              {position.historical ? 'historical avg — measured while live' : 'live hedge sizing'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Hedge ratio</span>
            <span className="text-text mono-nums">{fmtRatioPct(position.hedge_ratio)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Leverage</span>
            <span className="text-text mono-nums">{fmtLeverage(position.leverage_used)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">BTC ref price</span>
			<span className="text-text mono-nums">{formatFiat(position.btc_price_eur, filters.fiat)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Hedge notional</span>
			<span className="text-text mono-nums">{formatFiat(position.hedge_notional_eur, filters.fiat)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Recommended collateral</span>
			<span className="text-text mono-nums">{formatFiat(position.recommended_collateral_eur, filters.fiat)}</span>
          </div>
          {/* The remaining fields were never persisted historically — only show
              them for a freshly-simulated live position, not a reconstructed one. */}
          {!position.historical && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Initial margin</span>
				<span className="text-text mono-nums">{formatFiat(position.initial_margin_eur, filters.fiat)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Stress move</span>
                <span className="text-text mono-nums">{fmtRatioPct(position.stress_move_pct)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Stress loss</span>
				<span className="text-text mono-nums">{formatFiat(position.stress_loss_eur, filters.fiat)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Maintenance requirement</span>
				<span className="text-text mono-nums">{formatFiat(position.maintenance_requirement_eur, filters.fiat)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Free collateral after stress</span>
                <span className={`mono-nums ${position.free_collateral_after_stress_eur < 0 ? 'text-red' : 'text-text'}`}>
				  {formatFiat(position.free_collateral_after_stress_eur, filters.fiat)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Liquidation move</span>
                <span className="text-text mono-nums">{fmtRatioPct(position.liquidation_move_pct)}</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function NetworkFeeDetail({ bd }: { bd: CostBreakdown }) {
  if (bd.network_fee_detail) {
    return (
      <tr>
        <td colSpan={3} className="pt-0 pb-2">
          <OnchainFeeDetail d={bd.network_fee_detail} conf={bd.network_fee_confidence} bd={bd} />
        </td>
      </tr>
    );
  }
  return null;
}

function HedgeDetailRow({ bd }: { bd: CostBreakdown }) {
  if (bd.hedge.fee_sum_btc <= 0) return null;
  return (
    <tr>
      <td colSpan={3} className="pt-0 pb-2">
        <HedgeFeeDetail bd={bd} />
      </td>
    </tr>
  );
}

export type SizeMode = 'full' | 'capped' | 'min';

function SizeModeButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[0.63rem] px-2 py-0.5 rounded-md border font-medium transition-colors ${
        active
          ? 'border-accent/60 text-accent bg-accent/10'
          : 'border-border text-muted hover:border-muted/60'
      }`}
    >
      {children}
    </button>
  );
}

export function SizeToggle({ mode, onModeChange, fullBtc, cappedBtc, minBtc, refPrice }: {
  mode: SizeMode;
  onModeChange: (v: SizeMode) => void;
  fullBtc?: number | null;
  cappedBtc: number | null | undefined;
  minBtc?: number | null;
  refPrice: number | null;
}) {
	const { filters } = useFilters();
  const fullEur = fullBtc != null && refPrice != null ? Math.round(fullBtc * refPrice) : null;
  const cappedEur = cappedBtc != null && refPrice != null ? Math.round(cappedBtc * refPrice) : null;
  const minEur = minBtc != null && refPrice != null ? Math.round(minBtc * refPrice) : null;
  const cappedAvailable = cappedBtc != null && (minBtc == null || minBtc <= cappedBtc);
  return (
    <div className="flex items-center gap-1 self-start">
      <SizeModeButton active={mode === 'full'} onClick={() => onModeChange('full')}>
		{fullEur != null ? `Max ${formatFiat(fullEur, filters.fiat, { maximumFractionDigits: 0 })}` : 'Max'}
      </SizeModeButton>
      {cappedAvailable && (
        <SizeModeButton active={mode === 'capped'} onClick={() => onModeChange('capped')}>
		  {cappedEur != null ? `${formatFiat(cappedEur, filters.fiat, { maximumFractionDigits: 0 })} cap` : 'Capped'}
        </SizeModeButton>
      )}
      {minBtc != null && (
        <SizeModeButton active={mode === 'min'} onClick={() => onModeChange('min')}>
		  {minEur != null ? `${formatFiat(minEur, filters.fiat, { maximumFractionDigits: 0 })} min` : 'Min amount'}
        </SizeModeButton>
      )}
    </div>
  );
}

export function AbortCostSection({ abortCost, refPrice }: {
  abortCost: AbortCostBreakdown | null;
  refPrice: number | null;
}) {
	const { filters } = useFilters();
  if (!abortCost || abortCost.btc_amount <= 0) return null;

  const fiatValue = (btc: number | null | undefined) => (btc != null && refPrice != null ? btc * refPrice : null);
  const totalBTC = abortCost.total?.btc ?? 0;
  const totalPct = abortCost.total?.pct ?? 0;

  return (
    <div className="flex items-center justify-between gap-3 text-[0.64rem] text-muted">
      <span className="uppercase tracking-wide font-semibold">Abort cost</span>
      <span className="mono-nums text-right whitespace-nowrap">
		{fmt8(totalBTC)} BTC · {fmtFiatAmount(fiatValue(totalBTC), filters.fiat)} · {fmtPct(totalPct)}
      </span>
    </div>
  );
}

export function CapitalRequiredSection({ capital, flat = false }: { capital: CapitalRequirement | null | undefined; flat?: boolean }) {
	const { filters } = useFilters();
  if (!capital || capital.total_eur <= 0) return null;

  const hasDeposit = capital.security_deposit_btc > 0;
  const depositSide = capital.security_deposit_side
    ? capital.security_deposit_side.charAt(0).toUpperCase() + capital.security_deposit_side.slice(1)
    : '';

  return (
    <div className={`${flat ? 'border-t border-border pt-2.5' : 'rounded-lg border border-blue/30 bg-blue/5 px-3 py-2.5'} flex flex-col gap-1.5 text-[0.72rem]`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted uppercase text-[0.62rem] tracking-widest font-semibold">Capital required</span>
		<span className="mono-nums font-bold text-[0.95rem] text-text">{formatFiat(capital.total_eur, filters.fiat)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Spot notional (CEX buy)</span>
		<span className="text-text mono-nums">{formatFiat(capital.spot_notional_eur, filters.fiat)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">Hedge collateral</span>
		<span className="text-text mono-nums">{formatFiat(capital.hedge_collateral_eur, filters.fiat)}</span>
      </div>
      {hasDeposit && (
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted flex items-center gap-1.5">
            Security deposit
            {depositSide && <span className="text-[0.6rem] text-muted">({depositSide} · {fmtRatioPct(capital.security_deposit_pct)})</span>}
            {capital.deposit_estimated && <Badge label="est." colorCls="text-muted" />}
          </span>
          <span className="text-right">
			<div className="text-text mono-nums">{formatFiat(capital.security_deposit_eur, filters.fiat)}</div>
            <div className="text-[0.64rem] text-muted mono-nums">{fmt8(capital.security_deposit_btc)} BTC</div>
          </span>
        </div>
      )}
    </div>
  );
}

export function CostBreakdownPanel({ bd, abortCost, priceDiffPct, netPremiumPct, refPrice, offerPrice, basicInformation, showCapitalAndAbort = true, wideLayout = false, amountUnit: controlledAmountUnit }: {
  bd: CostBreakdown;
  abortCost: AbortCostBreakdown | null;
  priceDiffPct: number | null;
  netPremiumPct: number | null;
  refPrice: number | null;
  offerPrice?: number | null;
  /** Offer metadata displayed as the first column of the wide detail layout. */
  basicInformation?: React.ReactNode;
  // Live offers show these in the Trade Tracing panel's Preview tab instead
  // (where the trader is actually about to act on them); past offers have no
  // Trade Tracing panel, so they keep showing both here.
  showCapitalAndAbort?: boolean;
  /** Use a summary rail beside the cost table when the parent panel has enough width. */
  wideLayout?: boolean;
  amountUnit?: 'btc' | 'fiat';
  onAmountUnitChange?: (unit: 'btc' | 'fiat') => void;
}) {
	const { filters } = useFilters();
	type BreakdownRow = { label: string; btc: number; pct: number; expandable?: 'network' | 'hedge' };
  const [networkFeeOpen, setNetworkFeeOpen] = useState(false);
  const [hedgeFeeOpen, setHedgeFeeOpen] = useState(false);
  const [internalAmountUnit] = useState<'btc' | 'fiat'>('fiat');
  const [tableUnit, setTableUnit] = useState<'btc' | 'fiat' | 'pct'>(controlledAmountUnit ?? 'fiat');
  const amountUnit = controlledAmountUnit ?? internalAmountUnit;
  const hasNetworkFeeDetail = !!bd.network_fee_detail;

  const isAsk = bd.trade_direction === 'ask';
  const numTxs = bd.num_network_txs ?? (isAsk ? 1 : 2);
  const networkFeeLabel = `Network routing cost${numTxs > 1 ? ` ×${numTxs} txs` : ''}`;

  const withdrawalRows: BreakdownRow[] = !isAsk
    ? [{ label: 'CEX withdrawal', btc: bd.withdrawal_fee_btc, pct: bd.withdrawal_fee_pct }]
    : [];
  const hedgeRows: BreakdownRow[] = bd.hedge.fee_sum_btc > 0
    ? [{
      label: `Hedge cost${bd.hedge.venue ? ` (${bd.hedge.venue.replace('_', ' ')})` : ''}`,
      btc: bd.hedge.fee_sum_btc,
      pct: bd.hedge.fee_sum_pct,
      expandable: 'hedge',
    }]
    : [];

  const conversionBTC = bd.conversion?.fee_sum_btc ?? 0;
  const conversionPct = bd.conversion?.fee_sum_pct ?? 0;
  const routingTotalBTC = bd.network_fee_btc + conversionBTC;
  const routingTotalPct = bd.network_fee_pct + conversionPct;

  const rows: BreakdownRow[] = [
    { label: 'CEX taker fee', btc: bd.cex_taker_fee_btc, pct: bd.cex_taker_fee_pct },
    ...withdrawalRows,
    { label: networkFeeLabel, btc: routingTotalBTC, pct: routingTotalPct, ...(hasNetworkFeeDetail ? { expandable: 'network' as const } : {}) },
    ...hedgeRows,
    { label: 'DEX platform fee', btc: bd.dex_fee_btc, pct: bd.dex_fee_pct },
  ];
  const routeCex = bd.route_cex || '—';
  const routeDex = bd.route_dex || '—';
  const routeMethodLabels: Record<string, string> = {
    onchain_direct: 'direct on-chain',
    onchain_hub: 'on-chain via hub wallet',
    onchain_swap: 'submarine swap',
  };
  const rawMethod = bd.route_method || bd.network_fee_method || '';
  const routeMethod = routeMethodLabels[rawMethod] || rawMethod || '—';
  const profitPct = bd.estimated_profit_pct ?? netPremiumPct;
  const profitBtc = bd.estimated_profit_btc ?? (profitPct != null ? bd.btc_amount * (profitPct / 100) : null);
  const grossPremiumBtc = priceDiffPct != null ? bd.btc_amount * (priceDiffPct / 100) : null;
  const profitCls = profitPct != null && profitPct < 0 ? 'text-red' : profitPct != null && profitPct > 0 ? 'text-green' : 'text-muted';
  const netCls = netPremiumPct != null
    ? netPremiumPct <= 0 ? 'text-red' : netPremiumPct <= 2 ? 'text-green' : 'text-accent'
    : 'text-muted';
  const fiatValue = (btc: number | null | undefined) => (btc != null && refPrice != null ? btc * refPrice : null);
  const tableValue = (btc: number | null | undefined, pct: number | null | undefined, signed = false) => {
    if (tableUnit === 'pct') return pct != null ? fmtPct(pct) : '—';
    if (tableUnit === 'btc') return btc != null ? (signed ? fmtSignedBtc(btc) : fmt8(btc)) : '—';
    return signed ? fmtFiatAmount(fiatValue(btc), filters.fiat) : formatFiat(fiatValue(btc), filters.fiat);
  };

  const profitCardBorder = profitPct == null || profitPct === 0
    ? 'border-border'
    : profitPct > 0 ? 'border-green/30' : 'border-red/30';
  const profitCardBg = profitPct == null || profitPct === 0
    ? 'bg-surface'
    : profitPct > 0 ? 'bg-green/5' : 'bg-red/5';

  const breakdownHeader = (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
      <div className="flex items-center gap-2">
        <span className="text-muted uppercase text-[0.62rem] tracking-widest font-semibold">Trade cost breakdown</span>
        <span className={`text-[0.6rem] font-semibold px-1.5 py-0.5 rounded ${isAsk ? 'bg-orange-900/30 text-orange-400' : 'bg-blue-900/30 text-blue-400'}`}>
          {isAsk ? 'Ask side' : 'Bid side'}
        </span>
      </div>
      {wideLayout && (
        <div className="hidden min-w-0 items-center gap-1.5 text-[0.68rem] xl:flex">
          <span className="shrink-0 text-muted">Route</span>
          <span className="truncate font-medium text-text">{routeCex} → {routeDex}</span>
          <span className="truncate text-accent">· {routeMethod}</span>
        </div>
      )}
      <span className="shrink-0 text-[0.86rem] font-semibold text-text mono-nums">
        {amountUnit === 'btc' ? `${fmt8(bd.btc_amount)} BTC` : fmtFiatAmount(fiatValue(bd.btc_amount), filters.fiat)}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 text-[0.72rem]">
      {!wideLayout && breakdownHeader}

      <div className={wideLayout ? 'grid items-start gap-4 lg:grid-cols-[minmax(11rem,0.7fr)_minmax(0,1fr)_17rem] xl:grid-cols-[minmax(13rem,0.75fr)_minmax(0,1fr)_19rem]' : 'contents'}>
        {wideLayout && basicInformation && (
          <section aria-label="Basic information" className="min-w-0">
            <div className="border-b border-border/70 pb-2 text-muted uppercase text-[0.62rem] tracking-widest font-semibold">Basic information</div>
            <div className="pt-3">{basicInformation}</div>
          </section>
        )}
        <div className={wideLayout ? 'flex min-w-0 flex-col gap-3' : 'contents'}>
          {wideLayout && breakdownHeader}
          {!wideLayout && <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-2.5 py-2">
            <span className="text-muted shrink-0">Best route</span>
            <span className="text-right font-medium text-[0.72rem]">
              <span className="text-text">{routeCex}</span>
              <span className="text-muted mx-1.5">→</span>
              <span className="text-text">{routeDex}</span>
              <span className="text-muted mx-1.5">via</span>
              <span className="text-accent">{routeMethod}</span>
            </span>
          </div>}

          <div className="min-w-0">
          <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-muted font-normal pb-1.5 pr-3 text-[0.63rem] uppercase tracking-wide">Component</th>
            <th className="text-right font-normal pb-1.5 text-[0.63rem]">
              <span className="inline-flex items-center rounded border border-border bg-bg/70 p-0.5">
                <button type="button" aria-pressed={tableUnit === 'fiat'} onClick={() => setTableUnit('fiat')}
                  className={`rounded-sm px-1.5 py-0.5 transition-colors ${tableUnit === 'fiat' ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-text'}`}>{filters.fiat}</button>
                <button type="button" aria-pressed={tableUnit === 'btc'} onClick={() => setTableUnit('btc')}
                  className={`rounded-sm px-1.5 py-0.5 transition-colors ${tableUnit === 'btc' ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-text'}`}>BTC</button>
                <button type="button" aria-pressed={tableUnit === 'pct'} onClick={() => setTableUnit('pct')}
                  className={`rounded-sm px-1.5 py-0.5 transition-colors ${tableUnit === 'pct' ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-text'}`}>% trade</button>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-grid/40">
            <td className="pr-3 py-1 text-text font-medium rounded-l">Asset bought</td>
            <td className="py-1 text-right text-text mono-nums rounded-r">{tableValue(bd.btc_amount, 100)}</td>
          </tr>
          {rows.map((r, i) => {
            const isNetworkFee = r.expandable === 'network';
            const isHedgeFee = r.expandable === 'hedge';
            const isExpandable = !!r.expandable;
            return (
              <React.Fragment key={r.label}>
                <tr
                  className={`${i % 2 !== 0 ? 'bg-grid/40' : ''} ${isExpandable ? 'cursor-pointer hover:brightness-110' : ''}`}
                  onClick={
                    isNetworkFee
                      ? () => setNetworkFeeOpen(o => !o)
                      : isHedgeFee
                        ? () => setHedgeFeeOpen(o => !o)
                        : undefined
                  }
                >
                  <td className="pr-3 py-1 text-muted rounded-l">
                    {isExpandable ? (
                      <span className="flex items-center gap-1.5">
                        {r.label}
                        <span className={`text-[0.6rem] text-muted transition-transform duration-150 inline-block ${(isNetworkFee ? networkFeeOpen : hedgeFeeOpen) ? 'rotate-180' : ''}`}>▾</span>
                      </span>
                    ) : r.label}
                  </td>
                  <td className="py-1 text-right text-text mono-nums rounded-r">{tableValue(r.btc, r.pct)}</td>
                </tr>
                {isNetworkFee && networkFeeOpen && <NetworkFeeDetail bd={bd} />}
                {isHedgeFee && hedgeFeeOpen && <HedgeDetailRow bd={bd} />}
              </React.Fragment>
            );
          })}
          <tr className="border-t border-border">
            <td className="pr-3 pt-2.5 pb-1 font-semibold text-text">Total cost</td>
            <td className="pt-2.5 pb-1 text-right font-semibold text-red mono-nums">{tableValue(bd.total_cost_btc, bd.total_cost_pct)}</td>
          </tr>
          <tr>
            <td className="pr-3 py-1 text-muted">DEX premium</td>
            <td className={`py-1 text-right font-medium mono-nums rounded-r ${premiumClass(priceDiffPct)}`}>
              {tableValue(grossPremiumBtc, priceDiffPct, true)}
            </td>
          </tr>
          <tr className="border-t border-border">
            <td className="pr-3 pt-2.5 font-bold text-text text-[0.75rem]">Net premium</td>
            <td className={`pt-2.5 text-right font-bold text-[0.82rem] mono-nums rounded-r ${netCls}`}>
              {tableValue(profitBtc, netPremiumPct, true)}
            </td>
          </tr>
        </tbody>
          </table>
          </div>

        </div>

        <div className={wideLayout ? 'flex min-w-0 flex-col gap-3 lg:sticky lg:top-0' : 'contents'}>
          <div className={wideLayout
            ? `border-t-2 ${profitCardBorder} pt-2.5`
            : `rounded-lg border ${profitCardBorder} ${profitCardBg} px-3 py-2.5`
          }>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted uppercase text-[0.62rem] tracking-widest font-semibold">Estimated profit</span>
          <span className={`mono-nums font-bold text-[0.95rem] ${profitCls}`}>
            {profitBtc == null
              ? '—'
              : amountUnit === 'btc'
                ? `${fmtSignedBtc(profitBtc)} BTC`
                : fmtFiatAmount(fiatValue(profitBtc), filters.fiat)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-end gap-3">
          <span className={`mono-nums text-[0.75rem] font-medium ${profitCls}`}>
            {profitPct != null ? fmtPct(profitPct) : '—'}
          </span>
        </div>
        {offerPrice != null && (
          <div className="mt-2 pt-2 border-t border-border/60 text-[0.64rem] text-muted mono-nums flex flex-col gap-0.5">
            <div>
			  {fmt8(bd.btc_amount)} BTC @ {formatFiat(offerPrice, filters.fiat)} = {formatFiat(bd.btc_amount * offerPrice, filters.fiat)}
            </div>
            <div>
			  <span>{formatFiat(bd.btc_amount * offerPrice, filters.fiat)}</span>
              <span className="mx-1">−</span>
			  <span>{formatFiat(fiatValue(bd.btc_amount + bd.total_cost_btc), filters.fiat)}</span>
              <span className="mx-1">=</span>
              <span className={`font-semibold ${profitCls}`}>
				{fmtFiatAmount(bd.btc_amount * offerPrice - (fiatValue(bd.btc_amount + bd.total_cost_btc) ?? 0), filters.fiat)}
              </span>
            </div>
          </div>
        )}
          </div>

          {showCapitalAndAbort && (
            <>
              <CapitalRequiredSection capital={bd.capital} flat={wideLayout} />
              <AbortCostSection abortCost={abortCost} refPrice={refPrice} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function OfferTimeMeta({ firstSeen, lastSeen, isLive, timezone, priceType }: {
  firstSeen: string | null;
  lastSeen: string | null;
  isLive: boolean;
  timezone: string;
  priceType?: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] text-muted">
      <span>
        <span className="uppercase tracking-wide text-[0.6rem] mr-1">First seen</span>
        <span className="text-text">{formatTime(firstSeen, timezone)}</span>
      </span>
      {!isLive && (
        <>
          <span>
            <span className="uppercase tracking-wide text-[0.6rem] mr-1">Last seen</span>
            <span className="text-text">{formatTime(lastSeen, timezone)}</span>
          </span>
          <span>
            <span className="uppercase tracking-wide text-[0.6rem] mr-1">Duration</span>
            <span className="text-text">{formatDuration(firstSeen, lastSeen)}</span>
          </span>
        </>
      )}
      {priceType && (
        <Badge
          label={priceType === 'floating' ? 'floating price' : 'fixed price'}
          colorCls={priceType === 'floating' ? 'text-accent' : 'text-muted'}
        />
      )}
    </div>
  );
}
