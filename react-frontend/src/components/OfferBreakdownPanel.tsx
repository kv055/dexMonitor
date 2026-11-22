import React, { useState } from 'react';
import { formatDuration, formatTime, premiumClass } from '../utils/formatters';
import { stripTrailingZeros } from '../utils/numberFormat';
import type { AbortCostBreakdown, BTCNetworkFeeDetail as BTCDetail, CapitalRequirement, CostBreakdown, Offer } from '../types';
import { formatFiat, formatSignedFiat } from '../utils/currency';
import { useFilters } from '../hooks/useFilters';
import { asJsonObject, getCounterpartyStakePct, getSellerRatingScore } from '../utils/offerAccess';
import { SellerRatingBadge } from './SellerRatingBadge';
import { formatBisq2ReputationDetail, readBisq2ReputationRaw, shouldShowBondChip } from './sellerRating';

function fmt8(n: number): string {
  return stripTrailingZeros(n.toFixed(8));
}

function fmtPct(n: number): string {
  return stripTrailingZeros(n.toFixed(4)) + '%';
}

/** Two-decimal percentage for headline figures, where 4 decimals is noise. */
function fmtPctShort(n: number): string {
  return stripTrailingZeros(n.toFixed(2)) + '%';
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

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

const TIER_COLOR: Record<string, string> = {
  economic: 'text-green',
  standard: 'text-accent',
  fast: 'text-red',
  express: 'text-red',
  lightning: 'text-purple',
};

const CONGESTION_COLOR: Record<string, string> = {
  low: 'text-green',
  low_medium: 'text-green',
  medium: 'text-accent',
  high: 'text-red',
};

function formatVenueName(name?: string | null): string {
  const venue = (name ?? '').trim().replaceAll('_', ' ');
  return !venue || venue === '—' ? '' : venue;
}

type AmountUnit = 'btc' | 'fiat';

/** Formats BTC-denominated amounts in whichever unit the panel is showing. */
interface Money {
  /** Amount with its unit, e.g. "12,30 €" or "0.00015 BTC". */
  plain: (btc: number | null | undefined) => string;
  /** Same as plain, with an explicit +/- sign. */
  signed: (btc: number | null | undefined) => string;
  /** The amount in the other unit, for secondary lines. */
  alt: (btc: number | null | undefined) => string;
  /** Table cell value: the column header already names the unit for BTC. */
  cell: (btc: number | null | undefined) => string;
  /** Signed table cell value. */
  cellSigned: (btc: number | null | undefined) => string;
}

function makeMoney(unit: AmountUnit, refPrice: number | null, fiat: string): Money {
  const toFiat = (btc: number | null | undefined) => (btc != null && refPrice != null ? btc * refPrice : null);
  const btcText = (btc: number | null | undefined) => (btc != null ? `${fmt8(btc)} BTC` : '—');
  return {
    plain: btc => (unit === 'btc' ? btcText(btc) : formatFiat(toFiat(btc), fiat)),
    signed: btc => (unit === 'btc'
      ? (btc != null ? `${fmtSignedBtc(btc)} BTC` : '—')
      : fmtFiatAmount(toFiat(btc), fiat)),
    alt: btc => (unit === 'btc' ? formatFiat(toFiat(btc), fiat) : btcText(btc)),
    cell: btc => (unit === 'btc' ? (btc != null ? fmt8(btc) : '—') : formatFiat(toFiat(btc), fiat)),
    cellSigned: btc => (unit === 'btc' ? (btc != null ? fmtSignedBtc(btc) : '—') : fmtFiatAmount(toFiat(btc), fiat)),
  };
}

// ── Presentation primitives ─────────────────────────────────────────────────

const SECTION_TITLE = 'text-[0.64rem] font-semibold uppercase tracking-wider text-muted';

function Badge({ label, colorCls }: { label: string; colorCls?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border border-border bg-bg px-1.5 py-px text-[0.6rem] capitalize ${colorCls ?? 'text-muted'}`}>
      {label}
    </span>
  );
}

/**
 * Responsive grid of label-above-value facts. Columns follow the width of the
 * nearest `@container` (the breakdown panel), not the viewport, because the
 * panel is sometimes full-width and sometimes shares the row with Trade tracing.
 */
export function DetailFacts({ children, dense = false, className = '' }: {
  children: React.ReactNode;
  dense?: boolean;
  className?: string;
}) {
  const columns = dense
    ? 'grid-cols-2 gap-x-5 gap-y-2.5 @xl:grid-cols-3 @4xl:grid-cols-4'
    : 'grid-cols-1 gap-x-6 gap-y-3 @md:grid-cols-2 @4xl:grid-cols-4';
  return <dl className={`grid ${columns} ${className}`}>{children}</dl>;
}

export function DetailFact({ label, value, detail, hint, valueClassName = 'text-text', mono = true, dense = false }: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  hint?: string;
  valueClassName?: string;
  mono?: boolean;
  dense?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className={`${dense ? 'text-[0.62rem]' : 'text-[0.66rem]'} font-medium text-muted`}>{label}</dt>
      <dd
        className={`mt-0.5 break-words font-medium leading-snug ${dense ? 'text-[0.7rem]' : 'text-[0.78rem]'} ${mono ? 'mono-nums' : ''} ${valueClassName}`}
        title={hint ?? (typeof value === 'string' ? value : undefined)}
      >
        {value}
        {detail != null && detail !== '' && (
          <div className={`mt-0.5 font-normal text-muted ${dense ? 'text-[0.62rem]' : 'text-[0.68rem]'}`}>{detail}</div>
        )}
      </dd>
    </div>
  );
}

function Kpi({ label, value, detail, tone = 'text-text', emphasis = false }: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-bg/60 px-3 py-2.5">
      <div className="text-[0.66rem] font-medium text-muted">{label}</div>
      <div className={`mt-1 truncate mono-nums font-semibold leading-tight ${emphasis ? 'text-[1.2rem]' : 'text-[1.05rem]'} ${tone}`}>
        {value}
      </div>
      {detail && <div className="mt-1 truncate text-[0.66rem] text-muted mono-nums">{detail}</div>}
    </div>
  );
}

function Segmented<T extends string>({ ariaLabel, value, options, onChange, className = '' }: {
  ariaLabel: string;
  value: T;
  options: Array<{ value: T; label: React.ReactNode; disabled?: boolean; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <span role="group" aria-label={ariaLabel} className={`inline-flex items-center rounded-md border border-border bg-bg p-0.5 ${className}`}>
      {options.map(option => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`whitespace-nowrap rounded px-2 py-0.5 text-[0.66rem] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? 'bg-accent/15 font-semibold text-accent' : 'font-medium text-muted hover:text-text'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

function ShareBar({ share, colorCls = 'bg-red/50' }: { share: number; colorCls?: string }) {
  const width = Math.max(0, Math.min(1, share)) * 100;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-border/50" aria-hidden>
      <span className={`block h-full rounded-full ${colorCls}`} style={{ width: `${width}%` }} />
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={`h-2.5 w-2.5 shrink-0 text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Trade economics detail rows ─────────────────────────────────────────────

const ROUTE_EXPLANATIONS: Record<string, string> = {
  onchain_direct: 'CEX withdraw → DEX wallet (direct)',
  onchain_hub: 'CEX withdraw → LND hub wallet → trade destination',
  onchain_swap: 'CEX withdraw → LND wallet → submarine swap into Lightning',
};

function OnchainFeeDetail({ d, conf, bd, money }: { d: BTCDetail; conf: number; bd: CostBreakdown; money: Money }) {
  const tierCls = TIER_COLOR[d.congestion_level] ?? 'text-muted';
  const congCls = CONGESTION_COLOR[d.congestion_level] ?? 'text-muted';
  const confPct = conf > 0 ? Math.round(conf * 100) + '%' : null;
  const method = bd.route_method || bd.network_fee_method || '';
  const conv = bd.conversion;
  const hasConversion = conv && conv.fee_sum_btc > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge label="on-chain" />
        <Badge label={d.congestion_level.replace('_', ' ') + ' congestion'} colorCls={congCls} />
        {confPct && <span className="text-[0.62rem] text-muted">{confPct} confidence</span>}
        {ROUTE_EXPLANATIONS[method] && <span className="text-[0.62rem] text-muted">· {ROUTE_EXPLANATIONS[method]}</span>}
      </div>
      <DetailFacts dense>
        <DetailFact
          dense
          label="Transaction"
          value={`${d.tx_inputs} in · ${d.tx_outputs} out · ${d.tx_type}`}
          detail={<>{d.tx_vbytes} vB{d.num_txs > 1 && <span className="text-accent"> · × {d.num_txs} txs</span>}</>}
        />
        <DetailFact
          dense
          label="Selected fee rate"
          value={`${d.selected_sat_vb} sat/vB`}
          valueClassName={tierCls}
          detail={`${d.required_confirmations} conf · ${fmtEtaMinutes(d.selected_full_confirmation_minutes)}`}
        />
        <DetailFact
          dense
          label="Fee tiers (sat/vB)"
          value={(
            <span className="inline-flex flex-wrap gap-x-2">
              <span><span className="text-green">eco</span> {d.economic_sat_vb}</span>
              <span><span className="text-accent">std</span> {d.standard_sat_vb}</span>
              <span><span className="text-red">fast</span> {d.fast_sat_vb}</span>
              <span><span className="text-red">exp</span> {d.express_sat_vb}</span>
            </span>
          )}
          detail={[
            fmtEtaMinutes(d.economic_full_confirmation_minutes),
            fmtEtaMinutes(d.standard_full_confirmation_minutes),
            fmtEtaMinutes(d.fast_full_confirmation_minutes),
            fmtEtaMinutes(d.express_full_confirmation_minutes),
          ].join(' · ')}
        />
        <DetailFact
          dense
          label="Mempool"
          value={`${d.mempool_size_mb} MB`}
          detail={`${d.unconfirmed_tx_count.toLocaleString()} txs · data ${d.data_age_minutes}m old`}
        />
      </DetailFacts>

      {hasConversion && (
        <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge label="submarine swap" colorCls="text-purple" />
            {conv.strategy && <Badge label={conv.strategy.replace('_', ' ')} colorCls="text-purple" />}
          </div>
          <DetailFacts dense>
            <DetailFact dense label="Service fee" value={money.plain(conv.service_fee_btc)} detail={`${conv.service_fee_pct.toFixed(2)}%`} />
            <DetailFact dense label="Provider miner fee" value={money.plain(conv.provider_miner_btc)} />
            {conv.routing_fee_btc > 0 && <DetailFact dense label="LN routing fee" value={money.plain(conv.routing_fee_btc)} />}
            <DetailFact dense label="Swap total" value={money.plain(conv.fee_sum_btc)} detail={`${conv.fee_sum_pct.toFixed(2)}%`} />
            {conv.crossover_amount_btc > 0 && (
              <DetailFact dense label="Crossover amount" value={`${fmt8(conv.crossover_amount_btc)} BTC`} />
            )}
          </DetailFacts>
        </div>
      )}
    </div>
  );
}

function HedgeFeeDetail({ bd, money }: { bd: CostBreakdown; money: Money }) {
  const { filters } = useFilters();
  const position = bd.hedge.position;
  const fee = (btc: number, pct: number) => ({ value: money.plain(btc), detail: fmtPct(pct) });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge label="hedge" colorCls="text-accent" />
        {bd.hedge.venue && <Badge label={bd.hedge.venue.replaceAll('_', ' ')} colorCls="text-accent" />}
        {bd.hedge.side && <Badge label={bd.hedge.side} />}
      </div>
      <DetailFacts dense>
        <DetailFact dense label="Instrument" value={bd.hedge.instrument || '—'} />
        <DetailFact dense label="Transfer window" value={fmtEtaMinutes(bd.hedge.transfer_minutes)} />
        <DetailFact dense label="Open fee" {...fee(bd.hedge.open_fee_btc, bd.hedge.open_fee_pct)} />
        <DetailFact dense label="Close fee" {...fee(bd.hedge.close_fee_btc, bd.hedge.close_fee_pct)} />
        <DetailFact dense label="Funding" {...fee(bd.hedge.funding_fee_btc, bd.hedge.funding_fee_pct)} />
      </DetailFacts>
      {position && (
        <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge label="position" colorCls="text-blue" />
            <span className="text-[0.62rem] text-muted">
              {position.historical ? 'historical avg — measured while live' : 'live hedge sizing'}
            </span>
          </div>
          <DetailFacts dense>
            <DetailFact dense label="Hedge ratio" value={fmtRatioPct(position.hedge_ratio)} />
            <DetailFact dense label="Leverage" value={fmtLeverage(position.leverage_used)} />
            <DetailFact dense label="BTC ref price" value={formatFiat(position.btc_price, filters.fiat)} />
            <DetailFact dense label="Hedge notional" value={formatFiat(position.hedge_notional_eur, filters.fiat)} />
            <DetailFact dense label="Recommended collateral" value={formatFiat(position.recommended_collateral, filters.fiat)} />
            {/* The remaining fields were never persisted historically — only show
                them for a freshly-simulated live position, not a reconstructed one. */}
            {!position.historical && (
              <>
                <DetailFact dense label="Initial margin" value={formatFiat(position.initial_margin_eur, filters.fiat)} />
                <DetailFact dense label="Stress move" value={fmtRatioPct(position.stress_move_pct)} />
                <DetailFact dense label="Stress loss" value={formatFiat(position.stress_loss_eur, filters.fiat)} />
                <DetailFact dense label="Maintenance requirement" value={formatFiat(position.maintenance_requirement_eur, filters.fiat)} />
                <DetailFact
                  dense
                  label="Free collateral after stress"
                  value={formatFiat(position.free_collateral_after_stress_eur, filters.fiat)}
                  valueClassName={position.free_collateral_after_stress_eur < 0 ? 'text-red' : 'text-text'}
                />
                <DetailFact dense label="Liquidation move" value={fmtRatioPct(position.liquidation_move_pct)} />
              </>
            )}
          </DetailFacts>
        </div>
      )}
    </div>
  );
}

// ── Size scenario toggle (shared with Trade tracing) ────────────────────────

export type SizeMode = 'full' | 'capped' | 'min';

export function SizeToggle({ mode, onModeChange, fullBtc, cappedBtc, minBtc, refPrice }: {
  mode: SizeMode;
  onModeChange: (v: SizeMode) => void;
  fullBtc?: number | null;
  cappedBtc: number | null | undefined;
  minBtc?: number | null;
  refPrice: number | null;
}) {
  const { filters } = useFilters();
  const roundedFiat = (btc: number | null | undefined) => (btc != null && refPrice != null
    ? formatFiat(Math.round(btc * refPrice), filters.fiat, { maximumFractionDigits: 0 })
    : null);
  const fullEur = roundedFiat(fullBtc);
  const cappedEur = roundedFiat(cappedBtc);
  const minEur = roundedFiat(minBtc);
  const cappedAvailable = cappedBtc != null && (minBtc == null || minBtc <= cappedBtc);
  const options: Array<{ value: SizeMode; label: string }> = [
    { value: 'full', label: fullEur != null ? `Max ${fullEur}` : 'Max' },
    ...(cappedAvailable ? [{ value: 'capped' as const, label: cappedEur != null ? `${cappedEur} cap` : 'Capped' }] : []),
    ...(minBtc != null ? [{ value: 'min' as const, label: minEur != null ? `${minEur} min` : 'Min amount' }] : []),
  ];
  return <Segmented ariaLabel="Trade size scenario" value={mode} options={options} onChange={onModeChange} className="self-start" />;
}

// ── Capital allocation ──────────────────────────────────────────────────────

interface CapitalPart {
  key: string;
  label: string;
  fiat: number;
  btc?: number;
  /** "Seller · 15%" style qualifier for deposits. */
  note?: string;
  estimated?: boolean;
  color: string;
}

/**
 * Splits a capital requirement into the parts that add up to total_fiat. In
 * hedgeless mode the security deposit is already inside the BTC liquidity pool,
 * so it is returned separately as `included` rather than as an additive part.
 */
function capitalParts(capital: CapitalRequirement): { hedgeless: boolean; parts: CapitalPart[]; included: CapitalPart | null } {
  const hedgeless = capital.trade_mode === 'hedgeless_double_collateral';
  const depositSide = capitalize(capital.security_deposit_side ?? '');
  const deposit: CapitalPart | null = capital.security_deposit_btc > 0
    ? {
      key: 'deposit',
      label: hedgeless ? 'incl. security deposit' : 'Security deposit',
      fiat: capital.security_deposit_fiat,
      btc: capital.security_deposit_btc,
      note: depositSide ? `${depositSide} · ${fmtRatioPct(capital.security_deposit_pct)}` : undefined,
      estimated: capital.deposit_estimated,
      color: 'bg-accent',
    }
    : null;

  if (hedgeless) {
    const btcLiquidity = capital.btc_liquidity_btc ?? (capital.btc_amount + capital.security_deposit_btc);
    return {
      hedgeless,
      parts: [
        { key: 'pool', label: 'BTC liquidity pool', fiat: btcLiquidity * (capital.btc_price || 0), btc: btcLiquidity, color: 'bg-accent' },
        { key: 'collateral', label: 'Fiat collateral (CEX)', fiat: capital.fiat_collateral ?? capital.spot_notional, color: 'bg-blue' },
      ],
      included: deposit,
    };
  }
  return {
    hedgeless,
    parts: [
      { key: 'spot', label: 'Spot notional (CEX buy)', fiat: capital.spot_notional, color: 'bg-blue' },
      { key: 'hedge', label: 'Hedge collateral', fiat: capital.hedge_collateral, color: 'bg-purple' },
      ...(deposit ? [deposit] : []),
    ],
    included: null,
  };
}

function CapitalPartLabel({ part }: { part: CapitalPart }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span>{part.label}</span>
      {part.note && <span className="text-[0.62rem] text-muted">({part.note})</span>}
      {part.estimated && <Badge label="est." />}
    </span>
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

export function CapitalRequiredSection({ capital, flat = false, heading = 'Capital required', showTotal = true }: {
  capital: CapitalRequirement | null | undefined;
  flat?: boolean;
  heading?: string;
  showTotal?: boolean;
}) {
  const { filters } = useFilters();
  if (!capital || capital.total_fiat <= 0) return null;

  const { hedgeless, parts, included } = capitalParts(capital);
  const rows = included ? [...parts, included] : parts;

  return (
    <div className={`${flat ? '' : 'rounded-lg border border-blue/30 bg-blue/5 px-3 py-2.5'} flex flex-col gap-1.5 text-[0.72rem]`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted uppercase text-[0.62rem] tracking-widest font-semibold">
          {heading}{hedgeless ? ' · hedgeless' : ''}
        </span>
        {showTotal && <span className="mono-nums font-bold text-[0.95rem] text-text">{formatFiat(capital.total_fiat, filters.fiat)}</span>}
      </div>
      {rows.map(part => (
        <div key={part.key} className="flex items-start justify-between gap-3">
          <span className="text-muted"><CapitalPartLabel part={part} /></span>
          <span className="text-right">
            <div className="text-text mono-nums">{formatFiat(part.fiat, filters.fiat)}</div>
            {part.btc != null && <div className="text-[0.64rem] text-muted mono-nums">{fmt8(part.btc)} BTC</div>}
          </span>
        </div>
      ))}
    </div>
  );
}

function CapitalAllocationCard({ capital }: { capital: CapitalRequirement }) {
  const { filters } = useFilters();
  const { hedgeless, parts, included } = capitalParts(capital);
  const partsTotal = parts.reduce((sum, part) => sum + Math.max(0, part.fiat), 0);
  const share = (fiat: number) => (partsTotal > 0 ? Math.max(0, fiat) / partsTotal : 0);

  return (
    <section aria-label="Capital required" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-bg/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[0.66rem] font-medium text-muted">Capital required</div>
          <div className="mt-0.5 mono-nums text-[1.2rem] font-semibold leading-tight text-text">
            {formatFiat(capital.total_fiat, filters.fiat)}
          </div>
        </div>
        <Badge label={hedgeless ? 'hedgeless · double collateral' : 'hedged · single collateral'} />
      </div>

      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map(part => (
          <span key={part.key} className={`h-full ${part.color}`} style={{ width: `${share(part.fiat) * 100}%` }} />
        ))}
      </div>

      <ul className="flex flex-col divide-y divide-border/60 text-[0.74rem]">
        {parts.map(part => (
          <li key={part.key} className="flex flex-col">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-start gap-x-3 py-1.5">
              <span className="flex min-w-0 items-start gap-2 text-text">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${part.color}`} aria-hidden />
                <CapitalPartLabel part={part} />
              </span>
              <span className="text-right">
                <span className="block mono-nums text-text">{formatFiat(part.fiat, filters.fiat)}</span>
                {part.btc != null && <span className="block text-[0.64rem] text-muted mono-nums">{fmt8(part.btc)} BTC</span>}
              </span>
              <span className="text-right text-[0.66rem] text-muted mono-nums">{fmtPctShort(share(part.fiat) * 100)}</span>
            </div>
            {included && part.key === 'pool' && (
              <div className="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-start gap-x-3 pb-1.5 pl-4 text-[0.68rem] text-muted">
                <CapitalPartLabel part={included} />
                <span className="text-right">
                  <span className="block mono-nums">{formatFiat(included.fiat, filters.fiat)}</span>
                  {included.btc != null && <span className="block text-[0.62rem] mono-nums">{fmt8(included.btc)} BTC</span>}
                </span>
                <span />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AbortCostCard({ abortCost, money }: { abortCost: AbortCostBreakdown; money: Money }) {
  const components = [
    { label: 'CEX buy taker', btc: abortCost.cex_buy_taker?.btc ?? 0 },
    { label: 'CEX sell taker', btc: abortCost.cex_sell_taker?.btc ?? 0 },
    { label: 'CEX withdrawal', btc: abortCost.withdrawal?.btc ?? 0 },
    { label: `Network${abortCost.num_network_txs > 1 ? ` ×${abortCost.num_network_txs} txs` : ''}`, btc: abortCost.network?.btc ?? 0 },
    { label: 'Hedge', btc: abortCost.hedge?.fee_sum_btc ?? 0 },
  ].filter(component => component.btc > 0);
  const totalBTC = abortCost.total?.btc ?? 0;

  return (
    <section aria-label="Abort cost" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-bg/40 p-3">
      <div>
        <div className="text-[0.66rem] font-medium text-muted">Abort cost</div>
        <div className="mt-0.5 mono-nums text-[1.05rem] font-semibold leading-tight text-red">{money.plain(totalBTC)}</div>
        <div className="mt-0.5 text-[0.66rem] text-muted mono-nums">
          {fmtPct(abortCost.total?.pct ?? 0)} of trade · {money.alt(totalBTC)}
        </div>
      </div>
      <p className="text-[0.66rem] leading-snug text-muted">
        Fees lost if the DEX leg falls through and the position is unwound.
      </p>
      {components.length > 0 && (
        <ul className="flex flex-col divide-y divide-border/60 text-[0.7rem]">
          {components.map(component => (
            <li key={component.label} className="flex items-center justify-between gap-3 py-1">
              <span className="text-muted">{component.label}</span>
              <span className="mono-nums text-text">{money.plain(component.btc)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Risk ────────────────────────────────────────────────────────────────────

function formatJsonBlob(value: unknown): { text: string; fields: number } | null {
  const parsed = asJsonObject(value);
  if (!parsed || Object.keys(parsed).length === 0) return null;
  return { text: JSON.stringify(parsed, null, 2), fields: Object.keys(parsed).length };
}

function RiskCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-bg/40 px-3 py-2.5">
      <span className="text-[0.66rem] font-medium text-muted">{title}</span>
      {children}
    </div>
  );
}

function RawJsonBlock({ label, blob }: { label: string; blob: { text: string; fields: number } | null }) {
  if (!blob) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-[0.7rem]">
        <span className="text-muted">{label}</span>
        <span className="text-[0.66rem] text-muted">none reported</span>
      </div>
    );
  }
  return (
    <details className="group px-3 py-2 text-[0.7rem]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-text">
          <svg viewBox="0 0 12 12" aria-hidden className="h-2.5 w-2.5 text-muted transition-transform duration-150 group-open:rotate-90">
            <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{label}</span>
        </span>
        <span className="text-[0.66rem] text-muted">{blob.fields} {blob.fields === 1 ? 'field' : 'fields'}</span>
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-[0.64rem] leading-snug text-text whitespace-pre">{blob.text}</pre>
    </details>
  );
}

function RiskSection({ offer, capital, amountUnit }: { offer?: Offer | null; capital?: CostBreakdown['capital']; amountUnit: AmountUnit }) {
  const { filters } = useFilters();
  const score = offer ? getSellerRatingScore(offer) : null;
  const stakePct = offer ? getCounterpartyStakePct(offer) : null;
  const stakeBtc = offer?.counterparty_stake_btc;
  const hasStakeBtc = typeof stakeBtc === 'number' && Number.isFinite(stakeBtc) && stakeBtc > 0;
  const hasDeposit = !!capital && capital.security_deposit_btc > 0;
  const depositSide = capitalize(capital?.security_deposit_side ?? '');
  const rawJson = formatJsonBlob(offer?.seller_rating_raw);
  const signalsJson = formatJsonBlob(offer?.seller_rating_signals);
  const bisq2 = readBisq2ReputationRaw(offer?.seller_rating_raw);

  const stakeValue = (() => {
    if (!shouldShowBondChip(stakePct) && !hasStakeBtc) return null;
    const parts: string[] = [];
    if (shouldShowBondChip(stakePct) && stakePct != null) parts.push(fmtRatioPct(stakePct));
    if (hasStakeBtc && stakeBtc != null) parts.push(`${fmt8(stakeBtc)} BTC`);
    return parts.join(' · ');
  })();

  const depositFiat = capital ? formatFiat(capital.security_deposit_fiat, filters.fiat) : '—';
  const depositBtc = capital ? `${fmt8(capital.security_deposit_btc)} BTC` : '—';
  const depositDetail = (() => {
    if (!hasDeposit || !capital) return null;
    const parts: string[] = [];
    if (depositSide) parts.push(depositSide);
    if (capital.security_deposit_pct > 0) parts.push(fmtRatioPct(capital.security_deposit_pct));
    parts.push(amountUnit === 'btc' ? depositFiat : depositBtc);
    return parts.join(' · ');
  })();

  const empty = <span className="text-[0.78rem] text-muted">—</span>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
        <RiskCard title="Reputation">
          <span className="flex flex-wrap items-center gap-1.5">
            <SellerRatingBadge
              score={score}
              confidence={offer?.seller_rating_confidence}
              raw={offer?.seller_rating_raw}
              withLabel
            />
          </span>
          {bisq2 != null && (
            <span className="text-[0.66rem] text-muted">
              <span>Bisq 2 book</span>{' '}
              <span className="mono-nums text-text">{formatBisq2ReputationDetail(bisq2)}</span>
            </span>
          )}
        </RiskCard>
        <RiskCard title="Maker stake">
          {stakeValue ? <span className="mono-nums text-[0.78rem] font-medium text-text">{stakeValue}</span> : empty}
        </RiskCard>
        <RiskCard title="Security deposit">
          {hasDeposit && capital ? (
            <>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="mono-nums text-[0.78rem] font-medium text-text">
                  {amountUnit === 'btc' ? depositBtc : depositFiat}
                </span>
                {capital.deposit_estimated && <Badge label="est." />}
              </span>
              <span className="mono-nums text-[0.66rem] text-muted">{depositDetail}</span>
            </>
          ) : empty}
        </RiskCard>
      </div>

      <section aria-label="Raw venue data" className="flex flex-col gap-1.5">
        <span className={SECTION_TITLE}>Raw venue data</span>
        <div className="flex flex-col divide-y divide-border/70 rounded-lg border border-border">
          <RawJsonBlock label="Rating inputs" blob={rawJson} />
          <RawJsonBlock label="Venue signals" blob={signalsJson} />
        </div>
      </section>
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

type BreakdownTabId = 'summary' | 'economics' | 'capital' | 'route' | 'risk';

function BreakdownTabBar({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: Array<{ id: BreakdownTabId; label: string }>;
  activeId: BreakdownTabId;
  onSelect: (id: BreakdownTabId) => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex(tab => tab.id === activeId);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    event.preventDefault();
    onSelect(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`#breakdown-tab-${next.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Offer breakdown sections"
      data-testid="offer-breakdown-tabs"
      onKeyDown={onKeyDown}
      className="flex min-w-0 items-center overflow-x-auto"
    >
      {tabs.map(tab => {
        const selected = activeId === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`breakdown-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`breakdown-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={`relative -mb-px flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[0.72rem] transition-colors ${
              selected ? 'border-accent font-semibold text-text' : 'border-transparent font-medium text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function CostBreakdownPanel({
  bd,
  abortCost,
  priceDiffPct,
  netPremiumPct,
  refPrice,
  offerPrice,
  overview,
  contextLabel,
  contextDetail,
  contextId,
  toolbar,
  tradeModeToggle,
  routeControls,
  routeNotice,
  showCapitalAndAbort = true,
  amountUnit: controlledAmountUnit,
  onAmountUnitChange,
  costsUnavailable = false,
  offer,
}: {
  bd: CostBreakdown;
  abortCost: AbortCostBreakdown | null;
  priceDiffPct: number | null;
  netPremiumPct: number | null;
  refPrice: number | null;
  offerPrice?: number | null;
  /** Compact offer metadata displayed in the Offer tab. */
  overview?: React.ReactNode;
  contextLabel?: string;
  contextDetail?: string | null;
  contextId?: string | number | null;
  /** Size-scenario controls rendered in the offer header. */
  toolbar?: React.ReactNode;
  /** Hedgefull/Hedgeless switch rendered at the top of the Trade economics tab. */
  tradeModeToggle?: React.ReactNode;
  /** Live-only controls that override the effective route used by the estimate. */
  routeControls?: React.ReactNode;
  /** Warning shown when no CEX route could be priced. */
  routeNotice?: React.ReactNode;
  // Live offers show these in the Trade Tracing panel's Preview tab instead
  // (where the trader is actually about to act on them); past offers have no
  // Trade Tracing panel, so they keep showing both here.
  showCapitalAndAbort?: boolean;
  amountUnit?: AmountUnit;
  onAmountUnitChange?: (unit: AmountUnit) => void;
  /** When no CEX route could be priced, hide misleading 0% net/profit figures. */
  costsUnavailable?: boolean;
  /** Live or reconstructed offer used by the Risk tab (reputation, maker stake, raw JSON). */
  offer?: Offer | null;
}) {
  const { filters } = useFilters();
  type BreakdownRow = { label: string; venue?: string; btc: number; pct: number; expandable?: 'network' | 'hedge' };
  const [networkFeeOpen, setNetworkFeeOpen] = useState(false);
  const [hedgeFeeOpen, setHedgeFeeOpen] = useState(false);
  const [internalAmountUnit, setInternalAmountUnit] = useState<AmountUnit>('fiat');
  const [selectedTab, setSelectedTab] = useState<BreakdownTabId>('summary');
  // One unit for the whole panel: the overview, KPIs, and every tab follow it.
  const amountUnit = controlledAmountUnit ?? internalAmountUnit;
  const changeAmountUnit = onAmountUnitChange ?? setInternalAmountUnit;
  const money = makeMoney(amountUnit, refPrice, filters.fiat);
  const hasNetworkFeeDetail = !!bd.network_fee_detail;

  const isAsk = bd.trade_direction === 'ask';
  const numTxs = bd.num_network_txs ?? (isAsk ? 1 : 2);
  const networkFeeLabel = `Network routing cost${numTxs > 1 ? ` ×${numTxs} txs` : ''}`;
  const routeCex = formatVenueName(bd.route_cex);
  const routeDex = formatVenueName(bd.route_dex);
  const routeMethodLabels: Record<string, string> = {
    onchain_direct: 'direct on-chain',
    onchain_hub: 'on-chain via hub wallet',
    onchain_swap: 'submarine swap',
    Direct_main2main: 'direct main→main',
    Hub_main2main: 'hub main→main',
    Swap_main2lightning: 'swap main→lightning',
  };
  const rawMethod = bd.routing_profile || bd.route_method || bd.network_fee_method || '';
  const routeMethod = formatVenueName(routeMethodLabels[rawMethod] || rawMethod);

  const withdrawalRows: BreakdownRow[] = !isAsk
    ? [{ label: 'CEX withdrawal', venue: routeCex, btc: bd.withdrawal_fee_btc, pct: bd.withdrawal_fee_pct }]
    : [];
  const hedgeRows: BreakdownRow[] = bd.hedge.fee_sum_btc > 0
    ? [{
      label: 'Hedge cost',
      venue: formatVenueName(bd.hedge.venue),
      btc: bd.hedge.fee_sum_btc,
      pct: bd.hedge.fee_sum_pct,
      expandable: 'hedge',
    }]
    : [];

  const conversionBTC = bd.conversion?.fee_sum_btc ?? 0;
  const conversionPct = bd.conversion?.fee_sum_pct ?? 0;
  const routingTotalBTC = bd.routing_fee_sum_btc ?? (bd.network_fee_btc + conversionBTC);
  const routingTotalPct = bd.routing_fee_sum_pct ?? (bd.network_fee_pct + conversionPct);

  const rows: BreakdownRow[] = [
    { label: 'CEX taker fee', venue: routeCex, btc: bd.cex_taker_fee_btc, pct: bd.cex_taker_fee_pct },
    ...withdrawalRows,
    { label: networkFeeLabel, venue: routeMethod, btc: routingTotalBTC, pct: routingTotalPct, ...(hasNetworkFeeDetail ? { expandable: 'network' as const } : {}) },
    ...hedgeRows,
    { label: 'DEX platform fee', venue: routeDex, btc: bd.dex_fee_btc, pct: bd.dex_fee_pct },
  ];
  const costRowsTotalBtc = rows.reduce((sum, row) => sum + Math.max(0, row.btc), 0);
  const profitPct = costsUnavailable ? null : (bd.estimated_profit_pct ?? netPremiumPct);
  const profitBtc = costsUnavailable
    ? null
    : (bd.estimated_profit_btc ?? (profitPct != null ? bd.btc_amount * (profitPct / 100) : null));
  const displayNetPremiumPct = costsUnavailable ? null : netPremiumPct;
  const grossPremiumBtc = priceDiffPct != null ? bd.btc_amount * (priceDiffPct / 100) : null;
  const profitCls = profitPct != null && profitPct < 0 ? 'text-red' : profitPct != null && profitPct > 0 ? 'text-green' : 'text-muted';
  const netCls = displayNetPremiumPct != null
    ? displayNetPremiumPct <= 0 ? 'text-red' : displayNetPremiumPct <= 2 ? 'text-green' : 'text-accent'
    : 'text-muted';
  // Row tint follows the same thresholds as the net figure's text colour.
  const netRowCls = displayNetPremiumPct == null
    ? 'bg-bg/60'
    : displayNetPremiumPct <= 0 ? 'bg-red/10' : displayNetPremiumPct <= 2 ? 'bg-green/10' : 'bg-accent/10';
  const costShareOfPremium = !costsUnavailable && priceDiffPct != null && priceDiffPct > 0 && bd.total_cost_pct > 0
    ? (bd.total_cost_pct / priceDiffPct) * 100
    : null;

  const tradeValueFiat = offerPrice != null ? bd.btc_amount * offerPrice : (refPrice != null ? bd.btc_amount * refPrice : null);
  const capitalTotal = costsUnavailable ? null : bd.capital?.total_fiat;
  const hasCapital = showCapitalAndAbort && !!bd.capital && bd.capital.total_fiat > 0;
  const hasAbortCost = showCapitalAndAbort && !!abortCost && abortCost.btc_amount > 0;
  const hasSupportingColumn = hasCapital || hasAbortCost;
  const tabs: Array<{ id: BreakdownTabId; label: string }> = [
    { id: 'summary', label: 'Offer' },
    { id: 'economics', label: 'Trade economics' },
    ...(hasSupportingColumn ? [{ id: 'capital' as const, label: 'Capital allocation' }] : []),
    { id: 'risk', label: 'Risk' },
    ...(routeControls ? [{ id: 'route' as const, label: 'Route analysis' }] : []),
  ];
  const activeTab = tabs.some(tab => tab.id === selectedTab) ? selectedTab : tabs[0].id;
  const tradeMode = bd.capital?.trade_mode === 'hedgeless_double_collateral' ? 'Hedgeless' : bd.capital ? 'Hedged' : null;

  return (
    <div className="flex flex-col gap-3 text-[0.72rem]">
      {routeNotice}

      <div className="@container overflow-hidden rounded-lg border border-border bg-surface">
        {/* pr-11 keeps the controls clear of the panel's absolute close button. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-border pl-1 pr-11">
          <BreakdownTabBar tabs={tabs} activeId={activeTab} onSelect={setSelectedTab} />
          <Segmented
            ariaLabel="Amount unit"
            value={amountUnit}
            options={[{ value: 'fiat', label: filters.fiat }, { value: 'btc', label: 'BTC' }]}
            onChange={changeAmountUnit}
            className="my-1.5"
          />
        </div>
        <div className="p-3 @xl:p-4">
          {activeTab === 'summary' && (
            <section
              role="tabpanel"
              id="breakdown-panel-summary"
              aria-labelledby="breakdown-tab-summary"
              className="flex flex-col gap-4"
            >
              <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 text-[0.66rem] font-semibold text-text">
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${isAsk ? 'bg-red' : 'bg-green'}`} />
                    {isAsk ? 'Ask side' : 'Bid side'}
                  </span>
                  {contextLabel && (
                    <span
                      className={`text-[0.72rem] font-medium text-text ${contextDetail ? 'cursor-help underline decoration-border decoration-dotted underline-offset-4' : ''}`}
                      title={contextDetail ?? undefined}
                    >
                      {contextLabel}
                    </span>
                  )}
                  {contextId != null && <span className="mono-nums text-[0.68rem] text-muted">ID {contextId}</span>}
                </div>
                {toolbar && (
                  <div className="flex items-center gap-2">
                    <span className="text-[0.66rem] font-medium text-muted">Trade size</span>
                    {toolbar}
                  </div>
                )}
              </header>

              <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
                <Kpi
                  label="Estimated profit"
                  value={profitBtc == null ? '—' : money.signed(profitBtc)}
                  detail={profitBtc == null ? undefined : money.alt(profitBtc)}
                  tone={profitCls}
                  emphasis
                />
                <Kpi
                  label="Return"
                  value={profitPct != null ? fmtPctShort(profitPct) : '—'}
                  detail={priceDiffPct != null ? `gross premium ${fmtPctShort(priceDiffPct)}` : undefined}
                  tone={profitCls}
                  emphasis
                />
                <Kpi
                  label="Trade value"
                  value={amountUnit === 'btc' ? `${fmt8(bd.btc_amount)} BTC` : formatFiat(tradeValueFiat, filters.fiat)}
                  detail={amountUnit === 'btc' ? formatFiat(tradeValueFiat, filters.fiat) : `${fmt8(bd.btc_amount)} BTC`}
                />
                <Kpi
                  label="Capital required"
                  value={capitalTotal != null && capitalTotal > 0 ? formatFiat(capitalTotal, filters.fiat) : '—'}
                  detail={capitalTotal != null && capitalTotal > 0 && tradeMode ? tradeMode : undefined}
                />
              </div>

              {overview && (
                <section aria-label="Offer details" className="flex flex-col gap-2 border-t border-border/70 pt-3">
                  <span className={SECTION_TITLE}>Offer details</span>
                  {overview}
                </section>
              )}
            </section>
          )}

          {activeTab === 'economics' && (
            <section
              role="tabpanel"
              id="breakdown-panel-economics"
              aria-labelledby="breakdown-tab-economics"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[0.68rem] text-muted">
                  Gross premium minus execution costs for a{' '}
                  <span className="mono-nums font-medium text-text">{fmt8(bd.btc_amount)} BTC</span> trade.
                </p>
                {tradeModeToggle}
              </div>

              <table className="w-full border-collapse text-[0.72rem]">
                <thead>
                  <tr className="text-[0.64rem] text-muted">
                    <th scope="col" className="whitespace-nowrap pb-1.5 text-left font-medium">Component</th>
                    {/* w-full lets the bar column absorb spare width, so labels sit next to their bars. */}
                    <th scope="col" className="hidden w-full pb-1.5 pl-6 pr-3 text-left font-medium @2xl:table-cell">Share of costs</th>
                    <th scope="col" className="w-32 whitespace-nowrap pb-1.5 pl-3 text-right font-medium">Amount{amountUnit === 'btc' ? ' (BTC)' : ''}</th>
                    <th scope="col" className="w-24 whitespace-nowrap pb-1.5 pl-3 text-right font-medium">% of trade</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <th scope="row" className="py-2 text-left font-semibold text-text">Gross DEX premium</th>
                    <td className="hidden @2xl:table-cell" />
                    <td className={`py-2 pl-3 text-right font-semibold mono-nums ${premiumClass(priceDiffPct)}`}>
                      {money.cellSigned(grossPremiumBtc)}
                    </td>
                    <td className={`py-2 pl-3 text-right font-semibold mono-nums ${premiumClass(priceDiffPct)}`}>
                      {priceDiffPct != null ? fmtPct(priceDiffPct) : '—'}
                    </td>
                  </tr>
                  {rows.map(r => {
                    const isNetworkFee = r.expandable === 'network';
                    const isHedgeFee = r.expandable === 'hedge';
                    const isOpen = isNetworkFee ? networkFeeOpen : isHedgeFee ? hedgeFeeOpen : false;
                    const detailId = `breakdown-detail-${r.expandable ?? ''}`;
                    const toggle = isNetworkFee
                      ? () => setNetworkFeeOpen(open => !open)
                      : isHedgeFee
                        ? () => setHedgeFeeOpen(open => !open)
                        : undefined;
                    return (
                      <React.Fragment key={r.label}>
                        <tr
                          className={`border-t border-border/50 ${toggle ? 'cursor-pointer hover:bg-bg/70' : ''}`}
                          onClick={toggle}
                        >
                          <th scope="row" className="py-1.5 pl-3 text-left font-normal text-text @2xl:whitespace-nowrap">
                            <span className="flex flex-wrap items-center gap-x-1.5 @2xl:flex-nowrap">
                              {toggle ? (
                                // No onClick: keyboard/mouse clicks bubble to the row handler.
                                <button
                                  type="button"
                                  aria-expanded={isOpen}
                                  aria-controls={detailId}
                                  className="inline-flex items-center gap-1.5 text-left hover:text-accent"
                                >
                                  <Chevron open={isOpen} />
                                  {r.label}
                                </button>
                              ) : r.label}
                              {r.venue && <span className="text-muted">{r.venue}</span>}
                            </span>
                          </th>
                          <td className="hidden py-1.5 pl-6 pr-3 @2xl:table-cell">
                            <ShareBar share={costRowsTotalBtc > 0 ? r.btc / costRowsTotalBtc : 0} />
                          </td>
                          <td className="py-1.5 pl-3 text-right text-text mono-nums">{money.cell(r.btc)}</td>
                          <td className="py-1.5 pl-3 text-right text-muted mono-nums">{fmtPct(r.pct)}</td>
                        </tr>
                        {isOpen && (
                          <tr id={detailId}>
                            <td colSpan={4} className="pb-3 pl-3 pt-1">
                              <div className="rounded-lg border border-border bg-bg/60 p-3">
                                {isNetworkFee && bd.network_fee_detail && (
                                  <OnchainFeeDetail d={bd.network_fee_detail} conf={bd.network_fee_confidence} bd={bd} money={money} />
                                )}
                                {isHedgeFee && <HedgeFeeDetail bd={bd} money={money} />}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  <tr className="border-t border-border">
                    <th scope="row" className="py-2 text-left font-semibold text-text">Total costs</th>
                    <td className="hidden @2xl:table-cell" />
                    <td className="py-2 pl-3 text-right font-semibold text-red mono-nums">
                      {costsUnavailable ? '—' : `−${money.cell(bd.total_cost_btc)}`}
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold text-red mono-nums">{costsUnavailable ? '—' : fmtPct(bd.total_cost_pct)}</td>
                  </tr>
                  <tr className={`border-t-2 border-border ${netRowCls}`}>
                    <th scope="row" className="py-2.5 pl-2 text-left text-[0.78rem] font-bold text-text">Net profit</th>
                    <td className="hidden @2xl:table-cell" />
                    <td className={`py-2.5 pl-3 text-right text-[0.85rem] font-bold mono-nums ${netCls}`}>
                      {costsUnavailable ? '—' : money.cellSigned(profitBtc)}
                    </td>
                    <td className={`py-2.5 pl-3 pr-2 text-right font-bold mono-nums ${netCls}`}>
                      {displayNetPremiumPct != null ? fmtPct(displayNetPremiumPct) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
              {costShareOfPremium != null && (
                <p className="text-[0.66rem] text-muted">
                  {costShareOfPremium <= 100 ? (
                    <>Costs absorb <span className="mono-nums font-medium text-text">{fmtPctShort(costShareOfPremium)}</span> of the gross premium.</>
                  ) : (
                    <>Costs exceed the gross premium by <span className="mono-nums font-medium text-red">{fmtPctShort(bd.total_cost_pct - (priceDiffPct ?? 0))}</span> of the trade.</>
                  )}
                </p>
              )}
            </section>
          )}

          {activeTab === 'capital' && hasSupportingColumn && (
            <section
              role="tabpanel"
              id="breakdown-panel-capital"
              aria-labelledby="breakdown-tab-capital"
              className="grid gap-3 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
            >
              {hasCapital && bd.capital && <CapitalAllocationCard capital={bd.capital} />}
              {hasAbortCost && abortCost && <AbortCostCard abortCost={abortCost} money={money} />}
            </section>
          )}

          {activeTab === 'risk' && (
            <section
              role="tabpanel"
              id="breakdown-panel-risk"
              aria-labelledby="breakdown-tab-risk"
            >
              <RiskSection offer={offer} capital={bd.capital} amountUnit={amountUnit} />
            </section>
          )}

          {activeTab === 'route' && routeControls && (
            <section
              role="tabpanel"
              id="breakdown-panel-route"
              aria-labelledby="breakdown-tab-route"
            >
              {routeControls}
            </section>
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
