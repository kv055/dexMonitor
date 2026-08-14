import { useEffect, useMemo, useState } from 'react';
import type { Offer, CexSpotBuyResult, CexHedgeOpenResult, CexTradeflowResult, HedgePositionUpdate, PreTradeCheckReport, PreTradeCheckResult, TradeMode, WithdrawalTrackResult } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { stripTrailingZeros } from '../utils/numberFormat';
import { premiumClass } from '../utils/formatters';
import { cexTradeflow, cexPreTradeCheck, fetchMMTransaction } from '../api/execution';
import { useFilters } from '../hooks/useFilters';
import { useHedgeStream } from '../hooks/useHedgeStream';
import { useWithdrawalTrack } from '../hooks/useWithdrawalTrack';
import { CapitalRequiredSection, AbortCostSection, SizeToggle } from './OfferBreakdownPanel';
import type { SizeMode } from './OfferBreakdownPanel';
import {
  getBtcMax,
  getBtcMin,
  getCappedTradeSizeBtc,
  getDisplayCostBreakdown,
  getRefPrice,
  getMinTradeSizeBtc,
  hasCappedScenario,
  hasMinScenario,
} from '../utils/offerAccess';
import {
  DEFAULT_MANUAL_ROUTE_SELECTION,
  resolveTradeBreakdown,
  type ManualRouteSelection,
} from '../utils/manualRoute';

type Unit = 'btc' | 'fiat';
type Tab = 'preview' | 'spot' | 'hedge' | 'wallet';

interface SubmitState {
  phase: 'idle' | 'submitting' | 'done' | 'error';
  result?: CexSpotBuyResult;
  error?: string;
}

interface HedgeState {
  phase: 'idle' | 'submitting' | 'done' | 'error';
  result?: CexHedgeOpenResult;
  funding?: CexTradeflowResult['dex_funding'];
  error?: string;
}

interface WalletState {
  phase: 'idle' | 'submitting' | 'done' | 'error';
  result?: CexTradeflowResult['withdrawal'];
  transactionId?: number;
  poolRefill?: CexTradeflowResult['pool_refill'];
  error?: string;
}

interface ChecksState {
  phase: 'idle' | 'running' | 'done' | 'error';
  report?: PreTradeCheckReport;
  error?: string;
}

function fmtBtc(n: number): string {
  return stripTrailingZeros(n.toFixed(8));
}

function fmtFiat(n: number, currency: string): string {
  try {
    return n.toLocaleString('de-DE', { style: 'currency', currency, maximumFractionDigits: 2 });
  } catch {
    return `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function clamp(value: number, min: number | null, max: number | null): number {
  let v = value;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

function cexStatusLabel(status: string | undefined): string {
  if (!status) return '—';
  return status.replace(/_/g, ' ');
}

/** Logical display groups for pre-trade checks — order matches backend Run(). */
const PRE_TRADE_CHECK_GROUPS: { id: string; title: string; names: string[] }[] = [
  { id: 'capital', title: 'Capital', names: ['capital', 'liquidity_pool', 'lightning_liquidity', 'lsp_channel'] },
  { id: 'exchange', title: 'Exchange', names: ['permissions', 'lnd_wallet', 'whitelist'] },
  { id: 'payment', title: 'Payment', names: ['payment_setup', 'message_template'] },
  { id: 'ops', title: 'Operations', names: ['communication_gateway', 'fiat_controller_service', 'fiat_controller'] },
];

function groupPreTradeChecks(checks: PreTradeCheckResult[], isHedgeless: boolean, isLightningRoute: boolean) {
  const byName = new Map(checks.map(c => [c.name, c]));

  // Hedgeless must surface the BTC pool check for every DEX (including Swap).
  // Swap routes additionally require lightning_liquidity (channel capacity).
  if (isHedgeless && !byName.has('liquidity_pool')) {
    byName.set('liquidity_pool', {
      name: 'liquidity_pool',
      label: 'BTC liquidity pool',
      passed: false,
      message: 'BTC liquidity pool check was not returned by the server; rebuild mm-controller.',
    });
  }
  if (isLightningRoute && !byName.has('lightning_liquidity') && !byName.has('lsp_channel')) {
    byName.set('lightning_liquidity', {
      name: 'lightning_liquidity',
      label: 'LND Lightning liquidity',
      passed: false,
      message: 'Lightning liquidity check was not returned by the server; rebuild mm-controller.',
    });
  }
  if (isHedgeless && byName.has('capital') && byName.get('capital')!.label === 'Sufficient capital') {
    byName.set('capital', { ...byName.get('capital')!, label: 'Exchange fiat' });
  }

  const grouped = PRE_TRADE_CHECK_GROUPS
    .map(g => ({
      ...g,
      checks: g.names
        .filter(n => {
          if (n === 'liquidity_pool' && !isHedgeless && !byName.has(n)) return false;
          if (n === 'lightning_liquidity' && !isLightningRoute && !byName.has(n)) return false;
          return true;
        })
        .map(n => byName.get(n))
        .filter((c): c is PreTradeCheckResult => !!c),
    }))
    .filter(g => g.checks.length > 0);
  const known = new Set(PRE_TRADE_CHECK_GROUPS.flatMap(g => g.names));
  const leftover = checks.filter(c => !known.has(c.name));
  if (leftover.length > 0) {
    grouped.push({ id: 'other', title: 'Other', names: leftover.map(c => c.name), checks: leftover });
  }
  return grouped;
}

function PreTradeChecksPanel({
  phase,
  report,
  error,
  isHedgeless = false,
  isLightningRoute = false,
}: {
  phase: ChecksState['phase'];
  report?: PreTradeCheckReport;
  error?: string;
  isHedgeless?: boolean;
  isLightningRoute?: boolean;
}) {
  const groups = report ? groupPreTradeChecks(report.checks, isHedgeless, isLightningRoute) : [];
  const flatChecks = groups.flatMap(g => g.checks);
  const passedCount = flatChecks.filter(c => c.passed).length;
  const totalCount = flatChecks.length;
  const allPassed = totalCount > 0 && passedCount === totalCount && !!report?.ok
    && !(isHedgeless && !report.checks.some(c => c.name === 'liquidity_pool'))
    && !(isLightningRoute && !report.checks.some(c => c.name === 'lightning_liquidity' || c.name === 'lsp_channel'));

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/80 bg-surface/40 shrink-0">
        <span className="text-[0.62rem] uppercase tracking-widest font-semibold text-muted">Pre-trade checks</span>
        {phase === 'running' && (
          <span className="text-[0.62rem] text-accent animate-pulse">Running…</span>
        )}
        {phase === 'done' && report && (
          <span className={`text-[0.62rem] font-medium mono-nums ${allPassed ? 'text-green' : 'text-red'}`}>
            {passedCount}/{totalCount} passed
          </span>
        )}
      </div>

      <div className="p-2.5 min-h-0 overflow-y-auto">
        {phase === 'running' && (
          <div className="flex items-center gap-2 text-[0.72rem] text-muted py-1">
            <span className="inline-block size-1.5 rounded-full bg-accent animate-pulse" />
            Verifying capital, exchange, payment, and operations…
          </div>
        )}
        {phase === 'error' && (
          <span className="text-red text-[0.72rem] wrap-break-word">{error}</span>
        )}
        {phase === 'done' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {groups.map(group => {
              const groupOk = group.checks.every(c => c.passed);
              return (
                <div key={group.id} className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-1.5 px-0.5">
                    <span className={`size-1.5 rounded-full shrink-0 ${groupOk ? 'bg-green/70' : 'bg-red/70'}`} />
                    <span className="text-[0.58rem] uppercase tracking-widest font-semibold text-muted/90">
                      {group.title}
                    </span>
                  </div>
                  <div className="rounded-md border border-border/70 bg-surface/30 divide-y divide-border/50 overflow-hidden flex-1">
                    {group.checks.map(c => (
                      <div key={c.name} className="px-2.5 py-1.5 flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-2 text-[0.74rem]">
                          <span className="text-text/90 min-w-0 truncate" title={c.label}>{c.label}</span>
                          <span
                            className={`shrink-0 inline-flex items-center gap-1 text-[0.64rem] font-semibold uppercase tracking-wide ${
                              c.passed ? 'text-green' : 'text-red'
                            }`}
                          >
                            <span
                              className={`inline-flex items-center justify-center size-3.5 rounded-full text-[0.55rem] leading-none ${
                                c.passed ? 'bg-green/15 text-green' : 'bg-red/15 text-red'
                              }`}
                              aria-hidden
                            >
                              {c.passed ? '✓' : '✗'}
                            </span>
                            {c.passed ? 'Pass' : 'Fail'}
                          </span>
                        </div>
                        {!c.passed && c.message && (
                          <span className="text-red/90 text-[0.66rem] leading-snug wrap-break-word pl-0.5">
                            {c.message}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// LiveWithdrawalStatus renders polled CEX withdrawal + mempool confirmation state.
function LiveWithdrawalStatus({
  track,
  loading,
  error,
}: {
  track: WithdrawalTrackResult | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1.5 text-text">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6rem] uppercase tracking-wide text-muted">Live withdrawal</span>
        <span className="text-[0.62rem] text-muted">{loading ? 'updating…' : track ? 'live' : 'waiting…'}</span>
      </div>
      {error && <span className="text-red text-[0.68rem] wrap-break-word">{error}</span>}
      {!track && !error && <span className="text-muted">Awaiting first status update…</span>}
      {track && (
        <>
          <div className="flex justify-between gap-2"><span className="text-muted">CEX status</span><span className="mono-nums">{cexStatusLabel(track.cex_status)}</span></div>
          {track.tx_hash && (
            <div className="flex justify-between gap-2">
              <span className="text-muted">Tx hash</span>
              <a
                className="mono-nums truncate max-w-40 text-accent hover:underline"
                href={`https://mempool.space/tx/${track.tx_hash}`}
                target="_blank"
                rel="noreferrer"
                title={track.tx_hash}
              >
                {track.tx_hash}
              </a>
            </div>
          )}
          {track.mempool && (
            <>
              <div className="flex justify-between gap-2"><span className="text-muted">On-chain</span><span className="mono-nums">{track.mempool.status_label}</span></div>
              {track.mempool.confirmed && (
                <div className="flex justify-between gap-2"><span className="text-muted">Confirmations</span><span className="mono-nums">{track.mempool.confirmations}</span></div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function HeaderFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.58rem] uppercase tracking-wide text-muted">{label}</span>
      <span className="text-[0.74rem] text-text font-medium">{children}</span>
    </div>
  );
}

// LiveHedgePosition renders the streamed risk view of the open hedge. `position`
// comes from useHedgeStream; `socketConnected` is the browser↔server link, while
// `position.connected` is the upstream exchange feed health.
function LiveHedgePosition({ position, socketConnected }: { position: HedgePositionUpdate | null; socketConnected: boolean }) {
  const upstreamUp = position?.connected ?? false;
  const dotClass = upstreamUp ? 'bg-green' : socketConnected ? 'bg-amber-400' : 'bg-red';
  const statusText = upstreamUp ? 'live' : socketConnected ? 'connecting…' : 'disconnected';
  const cur = position?.currency || 'USD';

  return (
    <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1.5 text-text">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6rem] uppercase tracking-wide text-muted">Live position</span>
        <span className="flex items-center gap-1.5 text-[0.62rem] text-muted">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
          {statusText}
          {position?.error && <span className="text-red truncate max-w-32" title={position.error}>· {position.error}</span>}
        </span>
      </div>
      {!position ? (
        <span className="text-muted">Awaiting first update…</span>
      ) : (
        <>
          <div className="flex justify-between gap-2"><span className="text-muted">Side</span><span className="mono-nums">{position.side}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted">Size</span><span className="mono-nums">{fmtBtc(position.size_btc)} BTC</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted">Entry</span><span className="mono-nums">{fmtFiat(position.entry_price, cur)}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted">Mark</span><span className="mono-nums">{fmtFiat(position.mark_price, cur)}</span></div>
          {position.liquidation_price != null && position.liquidation_price > 0 && (
            <div className="flex justify-between gap-2"><span className="text-muted">Liquidation</span><span className="mono-nums">{fmtFiat(position.liquidation_price, cur)}</span></div>
          )}
          <div className="flex justify-between gap-2"><span className="text-muted">Unrealized PnL</span><span className={`mono-nums ${position.unrealized_pnl >= 0 ? 'text-green' : 'text-red'}`}>{fmtFiat(position.unrealized_pnl, cur)}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted">Margin</span><span className="mono-nums">{fmtFiat(position.margin, cur)}</span></div>
          {position.funding_rate != null && position.funding_rate !== 0 && (
            <div className="flex justify-between gap-2"><span className="text-muted">Funding</span><span className="mono-nums">{(position.funding_rate * 100).toFixed(4)}%</span></div>
          )}
        </>
      )}
    </div>
  );
}

export function TradeTracingPanel({
  offer,
  tradeMode = 'hedgefull_single_collateral',
  manualSelection = DEFAULT_MANUAL_ROUTE_SELECTION,
  sizeMode: controlledSizeMode,
  onSizeModeChange,
}: {
  offer: Offer;
  tradeMode?: TradeMode;
  manualSelection?: ManualRouteSelection;
  sizeMode?: SizeMode;
  onSizeModeChange?: (mode: SizeMode) => void;
}) {
  const { filters } = useFilters();
  const hasCapped = hasCappedScenario(offer);
  const hasMin = hasMinScenario(offer);
  const cappedBtc = getCappedTradeSizeBtc(offer);
  const minBtc = getMinTradeSizeBtc(offer) ?? getBtcMin(offer);
  const cappedAvailable = hasCapped && (minBtc == null || (cappedBtc != null && minBtc <= cappedBtc));
  // Uncontrolled default: capped when it applies; otherwise max position size.
  // When the parent drives sizeMode (Insights live + manual route), stay in sync.
  const [uncontrolledSizeMode, setUncontrolledSizeMode] = useState<SizeMode>(() => (cappedAvailable ? 'capped' : 'full'));
  const sizeMode = controlledSizeMode ?? uncontrolledSizeMode;
  const setSizeMode = onSizeModeChange ?? setUncontrolledSizeMode;
  const isHedgeless = tradeMode === 'hedgeless_double_collateral';

  const { breakdown: bd, abortCost, effectiveMode } = useMemo(
    () => resolveTradeBreakdown(offer, sizeMode, tradeMode, manualSelection),
    [offer, sizeMode, tradeMode, manualSelection],
  );
  const tradeCapital = bd?.capital ?? null;
  const refPrice = getRefPrice(offer);
  const fiatCurrency = offer.pricing?.fiat_currency ?? 'EUR';
  const isAsk = offer.direction === 'sell';
  const marketSide: 'bid' | 'ask' = isAsk ? 'ask' : 'bid';
  const isLightningRoute = bd?.routing_profile === 'Swap_main2lightning'
    || bd?.route_method === 'onchain_swap'
    || offer.analysis?.full_volume?.route?.settlement === 'Swap_main2lightning'
    || offer.exchange?.toLowerCase() === 'robosats';
  const routeCex = bd?.route_cex ?? '';
  const hedgeVenue = bd?.hedge?.venue ?? '';
  // This immutable snapshot is the Unified API's execution decision. Display
  // breakdowns (including manual what-if route choices) are deliberately not
  // a source for settlement or execution fees.
  const resolvedRoute = offer.metadata?.resolved_route;
  const hasResolvedExecutionRoute = !!resolvedRoute?.settlement;
  const routeUnavailableMessage = 'This offer has no resolved execution route. Refresh or recompute it in the Unified API before trading.';
  const cexLabel = routeCex ? routeCex.charAt(0).toUpperCase() + routeCex.slice(1) : '—';
  const netPremium = bd?.estimated_profit_pct ?? null;
  const btcMin = getBtcMin(offer);
  const btcMax = getBtcMax(offer);

  const defaultBtc = bd?.btc_amount ?? btcMax ?? btcMin ?? 0;
  const canUseFiat = refPrice != null && refPrice > 0;

  // Explicit client-side preference: a single-method offer or an active
  // dashboard payment filter names the method outright. Otherwise the method
  // is left empty and the backend picks the highest-priority linked+active
  // catalog entry from the offer's accepted list (payment_methods).
  const resolvedPaymentMethod = useMemo(() => {
    const methods = offer.payment_methods ?? [];
    if (methods.length === 1) return methods[0];
    if (filters.payment && methods.includes(filters.payment)) return filters.payment;
    return '';
  }, [offer.payment_methods, filters.payment]);

  const [unit, setUnit] = useState<Unit>('btc');
  const [draft, setDraft] = useState<string>(() => fmtBtc(defaultBtc));
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });
  const [hedgeSubmit, setHedgeSubmit] = useState<HedgeState>({ phase: 'idle' });
  const [walletSubmit, setWalletSubmit] = useState<WalletState>({ phase: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checks, setChecks] = useState<ChecksState>({ phase: 'idle' });
  const [expectedLndAddress, setExpectedLndAddress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('preview');

  // Only stream the live hedge position while the Hedge tab is open, so merely
  // previewing an offer doesn't spin up the upstream exchange feeds. Prefer the
  // venue from an opened hedge, falling back to the offer's breakdown venue.
  const liveHedgeVenue = activeTab === 'hedge'
    ? (hedgeSubmit.result?.venue ?? bd?.hedge?.venue ?? null)
    : null;
  const { position: livePosition, connected: liveSocketConnected } = useHedgeStream(liveHedgeVenue);

  const walletTrackActive = activeTab === 'wallet' && walletSubmit.phase === 'done' && !!walletSubmit.result?.withdrawal_id;
  const walletProvider = walletSubmit.result?.provider ?? routeCex;
  const { track: withdrawalTrack, loading: withdrawalTrackLoading, error: withdrawalTrackError } = useWithdrawalTrack(
    walletTrackActive,
    walletProvider,
    walletSubmit.result?.withdrawal_id ?? null,
    walletSubmit.result?.client_request_id ?? null,
  );

  const receivingAddress =
    walletSubmit.result?.wallet_address
    ?? expectedLndAddress
    ?? checks.report?.lnd_withdraw_address
    ?? null;

  // The execution response only proves that the replacement withdrawal was
  // submitted. Pool restoration is a separate backend lifecycle, so poll the
  // persisted transaction until it reaches either terminal state. A transient
  // read error is safe to retry because this endpoint has no side effects.
  useEffect(() => {
    const transactionId = walletSubmit.transactionId;
    if (!isHedgeless || !transactionId || walletSubmit.phase !== 'done') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const tx = await fetchMMTransaction(transactionId);
        if (cancelled) return;
        setWalletSubmit(previous => ({
          ...previous,
          poolRefill: previous.poolRefill
            ? { ...previous.poolRefill, target_btc: tx.btc_pool_target_btc ?? previous.poolRefill.target_btc, status: tx.btc_pool_refill_status ?? previous.poolRefill.status }
            : undefined,
        }));
        if (tx.btc_pool_refill_status === 'restored' || tx.btc_pool_refill_status === 'needs_review') return;
      } catch {
        // The live withdrawal card still reports progress; retry transient transaction fetch failures.
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isHedgeless, walletSubmit.phase, walletSubmit.transactionId]);

  // Canonical BTC amount derived from the current input + unit.
  const amountBtc = useMemo(() => {
    const parsed = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    if (unit === 'fiat') return canUseFiat ? parsed / refPrice! : 0;
    return parsed;
  }, [draft, unit, canUseFiat, refPrice]);

  const clampedBtc = clamp(amountBtc, btcMin, btcMax);
  const outOfBounds = amountBtc > 0 && clampedBtc !== amountBtc;
  const estFiat = canUseFiat ? clampedBtc * refPrice! : null;

  function toggleUnit(next: Unit) {
    if (next === unit) return;
    if (next === 'fiat' && !canUseFiat) return;
    // Convert the current canonical BTC amount into the new unit's display string.
    if (next === 'fiat') {
      setDraft(amountBtc > 0 && canUseFiat ? (amountBtc * refPrice!).toFixed(2) : '');
    } else {
      setDraft(amountBtc > 0 ? fmtBtc(amountBtc) : '');
    }
    setUnit(next);
  }

  // Switches which precomputed scenario (max position size, the fiat-capped
  // size, or the offer's minimum amount) is previewed, and resets the volume
  // box to that scenario's size — same convention as toggleUnit above.
  function toggleSize(mode: SizeMode) {
    if (mode === sizeMode) return;
    setSizeMode(mode);
    const sizeBd = resolveTradeBreakdown(offer, mode, tradeMode, manualSelection).breakdown;
    const nextBtc = sizeBd?.btc_amount ?? btcMax ?? btcMin ?? 0;
    if (unit === 'fiat' && canUseFiat) {
      setDraft(nextBtc > 0 ? (nextBtc * refPrice!).toFixed(2) : '');
    } else {
      setDraft(nextBtc > 0 ? fmtBtc(nextBtc) : '');
    }
  }

  // Keep the volume draft aligned when the parent changes size scenario (e.g. Size
  // toggle in the expanded live offer) without going through toggleSize.
  useEffect(() => {
    if (controlledSizeMode == null) return;
    const nextBtc = bd?.btc_amount ?? btcMax ?? btcMin ?? 0;
    if (unit === 'fiat' && canUseFiat) {
      setDraft(nextBtc > 0 ? (nextBtc * refPrice!).toFixed(2) : '');
    } else {
      setDraft(nextBtc > 0 ? fmtBtc(nextBtc) : '');
    }
    // Only re-sync when the controlled scenario or resolved trade size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSizeMode, effectiveMode, bd?.btc_amount]);

  const canTrade = !!routeCex
    && clampedBtc > 0
    && !!tradeCapital
    && (isHedgeless || !!hedgeVenue)
    && hasResolvedExecutionRoute
    && submit.phase !== 'submitting';
  const checksPassed = checks.phase === 'done'
    && !!checks.report?.ok
    && (!isHedgeless || !!checks.report.checks.some(c => c.name === 'liquidity_pool' && c.passed))
    && (!isLightningRoute || !!checks.report.checks.some(c => c.name === 'lightning_liquidity' && c.passed));

  // Opening the confirm dialog immediately kicks off the (read-only) pre-trade checks
  // so their results are shown in the same card before the operator confirms.
  function openConfirm() {
    if (!hasResolvedExecutionRoute) return;
    setConfirmOpen(true);
  }

  function closeConfirm() {
    setConfirmOpen(false);
    setChecks({ phase: 'idle' });
  }

  useEffect(() => {
    if (!confirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen]);

  async function runPreTradeChecks() {
    if (!resolvedRoute?.settlement) {
      setChecks({ phase: 'error', error: routeUnavailableMessage });
      return;
    }
    setChecks({ phase: 'running' });
    try {
      // Hedgeless: exchange fiat check uses fiat collateral only; BTC pool is a
      // separate LND wallet check. Hedgefull: total_fiat covers spot+hedge+deposit.
      // Swap_main2lightning also needs position+deposit for LN channel capacity.
      const requiredCapital = isHedgeless
        ? (tradeCapital?.fiat_collateral ?? tradeCapital?.spot_notional ?? 0)
        : (tradeCapital?.total_fiat ?? 0);
      const requiredBtcLiquidity = (isHedgeless || isLightningRoute)
        ? (tradeCapital?.btc_liquidity_btc
          ?? ((tradeCapital?.btc_amount ?? 0) + (tradeCapital?.security_deposit_btc ?? 0)))
        : undefined;
      const report = await cexPreTradeCheck({
        provider: routeCex,
        fiat_currency: fiatCurrency,
        required_capital: requiredCapital,
        payment_method: resolvedPaymentMethod || undefined,
        payment_methods: offer.payment_methods ?? undefined,
        dex: offer.exchange,
        market_side: marketSide,
        settlement: resolvedRoute.settlement,
        routing_fee_allowance_sat: resolvedRoute.routing_fee_allowance_sat,
        trade_mode: tradeMode,
        hedge_venue: isHedgeless ? undefined : hedgeVenue || undefined,
        required_btc_liquidity: requiredBtcLiquidity,
      });
      setChecks({ phase: 'done', report });
      if (report.lnd_withdraw_address) {
        setExpectedLndAddress(report.lnd_withdraw_address);
      }
    } catch (err) {
      setChecks({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Re-run when confirm opens or the effective execution route / capital inputs change.
  useEffect(() => {
    if (!confirmOpen || !routeCex || !hasResolvedExecutionRoute) return;
    void runPreTradeChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    confirmOpen,
    routeCex,
    hedgeVenue,
    tradeMode,
    isHedgeless,
    isLightningRoute,
    marketSide,
    tradeCapital?.total_fiat,
    tradeCapital?.fiat_collateral,
    tradeCapital?.spot_notional,
    tradeCapital?.btc_liquidity_btc,
    tradeCapital?.btc_amount,
    tradeCapital?.security_deposit_btc,
    resolvedPaymentMethod,
    fiatCurrency,
    offer.exchange,
    hasResolvedExecutionRoute,
    resolvedRoute,
  ]);

  async function runTrade() {
    if (!resolvedRoute?.settlement || (!isHedgeless && !hedgeVenue)) return;

    setConfirmOpen(false);
    setChecks({ phase: 'idle' });
    setSubmit({ phase: 'submitting' });
    setHedgeSubmit({ phase: 'submitting' });
    setWalletSubmit({ phase: 'submitting' });
    setActiveTab('spot');

    const hedgeRatio = bd?.hedge?.position?.hedge_ratio ?? 1.0;
    const leverage = bd?.hedge?.position?.leverage_used ?? 1.0;
    const rawHedgeSide = bd?.hedge?.side;
    const side: 'long' | 'short' = rawHedgeSide === 'long' || rawHedgeSide === 'short'
      ? rawHedgeSide
      : isAsk ? 'long' : 'short';
    const btcNotional = clampedBtc * hedgeRatio;
    // Hedgeless spends both the position amount and seller security deposit
    // from LND. Keep that BTC requirement separate from the fiat collateral
    // used for the replacement spot buy.
    const requiredBtcLiquidity = tradeCapital?.btc_liquidity_btc
      ?? ((tradeCapital?.btc_amount ?? 0) + (tradeCapital?.security_deposit_btc ?? 0));

    const fiatAmount = estFiat ?? (refPrice != null ? refPrice * clampedBtc : 0);
    // Pay with the method the pre-trade checks validated: the explicit choice
    // when there is one, else the backend's priority pick echoed in the report.
    const tradePaymentMethod = resolvedPaymentMethod || (checks.phase === 'done' ? checks.report?.resolved_payment_method ?? '' : '');

    try {
      const result = await cexTradeflow({
        provider: routeCex,
        market_side: 'bid',
        btc_amount: clampedBtc,
        fiat_currency: fiatCurrency,
        required_capital: isHedgeless
          ? (tradeCapital?.fiat_collateral ?? tradeCapital?.spot_notional ?? 0)
          : (tradeCapital?.total_fiat ?? 0),
        required_btc_liquidity: (isHedgeless || isLightningRoute) ? requiredBtcLiquidity : undefined,
        security_deposit_btc: (isHedgeless || isLightningRoute) ? tradeCapital?.security_deposit_btc : undefined,
        hedge_venue: isHedgeless ? undefined : hedgeVenue,
        hedge_side: isHedgeless ? undefined : side,
        hedge_notional_btc: isHedgeless ? undefined : btcNotional,
        leverage: isHedgeless ? undefined : leverage,
        offer_id: offer.offer_id ?? undefined,
        dex: offer.exchange,
        fiat_amount: fiatAmount > 0 ? fiatAmount : undefined,
        payment_method: tradePaymentMethod || undefined,
        payment_methods: tradePaymentMethod ? undefined : offer.payment_methods ?? undefined,
        trade_mode: tradeMode,
        resolved_route: resolvedRoute,
        routing_fee_allowance_sat: resolvedRoute.routing_fee_allowance_sat,
        cex_withdrawal_fee_btc: resolvedRoute.cex_withdrawal_fee_btc,
        swap_safety_headroom_btc: resolvedRoute.swap_safety_headroom_btc,
        selected_offer: {
          offer_id: offer.offer_id,
          exchange: offer.exchange,
          direction: offer.direction,
          price: offer.price,
          btc_min: offer.btc_min,
          btc_max: offer.btc_max,
		  metadata: offer.metadata,
        },
      });
      setSubmit({ phase: 'done', result: result.spot_buy });
      setHedgeSubmit({ phase: 'done', result: result.hedge, funding: result.dex_funding });
      setWalletSubmit({
        phase: 'done',
        result: result.withdrawal,
        transactionId: result.transaction_id,
        poolRefill: result.pool_refill,
      });
      setActiveTab('spot');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSubmit({ phase: 'error', error: message });
      setHedgeSubmit({ phase: 'error', error: message });
      setWalletSubmit({ phase: 'error', error: message });
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Trade Tracing</h3>
        <span className={`text-[0.6rem] font-semibold px-1.5 py-0.5 rounded ${isAsk ? 'bg-orange-900/30 text-orange-400' : 'bg-blue-900/30 text-blue-400'}`}>
          {isAsk ? 'Ask side' : 'Bid side'}
        </span>
      </div>

      {/* Single tabbed card filling all remaining space */}
      <div className="flex-1 min-h-0 bg-bg border border-border rounded-md flex flex-col">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-border shrink-0">
          {([
            { id: 'preview' as Tab, label: 'Preview', dot: 'idle' as const },
            { id: 'spot'    as Tab, label: isHedgeless ? 'Refill' : 'Spot', dot: submit.phase },
            { id: 'hedge'   as Tab, label: isHedgeless ? 'DEX funding' : 'Hedge', dot: hedgeSubmit.phase },
            { id: 'wallet'  as Tab, label: isHedgeless ? 'Pool' : 'Wallet', dot: walletSubmit.phase },
          ] satisfies { id: Tab; label: string; dot: string }[]).map(({ id, label, dot }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-[0.65rem] font-semibold tracking-wide transition-colors border-b-2 -mb-px ${activeTab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'}`}
            >
              {label}
              {dot === 'submitting' && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              )}
              {dot === 'done' && (
                <span className="w-1.5 h-1.5 rounded-full bg-green" />
              )}
              {dot === 'error' && (
                <span className="w-1.5 h-1.5 rounded-full bg-red" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 text-[0.72rem]">
          {activeTab === 'preview' && (
            <div className="flex flex-col gap-2">
              {/* Facts grid */}
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                <HeaderFact label="Direction">{isAsk ? 'Sell on DEX' : 'Buy on DEX'}</HeaderFact>
                <HeaderFact label="DEX"><ExchangeTag exchange={offer.exchange} /></HeaderFact>
                <HeaderFact label={manualSelection.spot === 'auto' ? 'Best CEX' : 'Spot CEX'}>{cexLabel}</HeaderFact>
                <HeaderFact label="Payment">{offer.payment_methods?.join(', ') ?? '—'}</HeaderFact>
                <HeaderFact label="Net premium">
                  <span className={premiumClass(netPremium)}>{netPremium != null ? `${netPremium.toFixed(2)}%` : '—'}</span>
                </HeaderFact>
                <HeaderFact label="Ref price">{refPrice != null ? fmtFiat(refPrice, fiatCurrency) : '—'}</HeaderFact>
              </div>

              <div className="border-t border-border" />

              {(hasCapped || hasMin) && (
                <SizeToggle
                  mode={effectiveMode}
                  onModeChange={toggleSize}
                  fullBtc={getDisplayCostBreakdown(offer, 'full')?.btc_amount ?? btcMax}
                  cappedBtc={cappedBtc}
                  minBtc={minBtc}
                  refPrice={refPrice}
                />
              )}

              {/* Input row: unit toggles | number field | start button */}
              <div className="flex items-center gap-1.5">
                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleUnit('btc')}
                    className={`text-[0.63rem] px-1.5 py-0.5 rounded-l-md border-y border-l font-medium transition-colors ${unit === 'btc' ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-muted hover:border-muted/60'}`}
                  >
                    BTC
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleUnit('fiat')}
                    disabled={!canUseFiat}
                    className={`text-[0.63rem] px-1.5 py-0.5 rounded-r-md border font-medium transition-colors ${unit === 'fiat' ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-muted hover:border-muted/60'} ${!canUseFiat ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {fiatCurrency}
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  className="flex-1 min-w-0 bg-surface border border-border rounded-md px-2 py-1 text-[0.82rem] text-text mono-nums focus:outline-none focus:border-accent/60"
                  placeholder={unit === 'btc' ? '0.0' : '0'}
                />
                <button
                  type="button"
                  disabled={!canTrade}
                  onClick={openConfirm}
                  title={hasResolvedExecutionRoute ? undefined : routeUnavailableMessage}
                  className={`shrink-0 rounded-md px-3 py-1 text-[0.73rem] font-semibold transition-colors ${canTrade ? 'bg-green/15 border border-green/50 text-green hover:bg-green/25' : 'bg-surface border border-border text-muted cursor-not-allowed'}`}
                >
                  {submit.phase === 'submitting' ? 'Submitting…' : 'Start trade'}
                </button>
              </div>

              {/* Hint row */}
              <div className="flex items-center justify-between text-[0.61rem] text-muted -mt-1">
                <span>
                  {unit === 'btc'
                    ? (estFiat != null ? `≈ ${fmtFiat(estFiat, fiatCurrency)}` : '—')
                    : `≈ ${fmtBtc(clampedBtc)} BTC`}
                  {outOfBounds && <span className="text-accent ml-1">(clamped)</span>}
                </span>
                <span>
                  {btcMin != null || btcMax != null
                    ? `${btcMin != null ? fmtBtc(btcMin) : '0'}–${btcMax != null ? fmtBtc(btcMax) : '∞'} BTC`
                    : ''}
                </span>
              </div>

              {!hasResolvedExecutionRoute && (
                <div role="status" className="rounded-md border border-orange-400/35 bg-orange-400/10 px-2 py-1.5 text-[0.66rem] leading-snug text-orange-300">
                  {routeUnavailableMessage}
                </div>
              )}

              {bd && <CapitalRequiredSection capital={tradeCapital} />}
              <AbortCostSection abortCost={abortCost} refPrice={refPrice} />
            </div>
          )}
          {activeTab === 'spot' && (
            <>
              {submit.phase === 'idle' && <span className="text-muted">Submit a trade to begin.</span>}
              {submit.phase === 'submitting' && <span className="text-accent">{isHedgeless ? `Funding DEX, then buying replacement BTC on ${cexLabel}…` : `Placing market buy on ${cexLabel}…`}</span>}
              {submit.phase === 'error' && <span className="text-red wrap-break-word">{submit.error}</span>}
              {submit.phase === 'done' && submit.result && (
                <div className="flex flex-col gap-1.5 text-text">
                  <div className="flex justify-between gap-2"><span className="text-muted">Status</span><span className="text-green font-medium">{submit.result.status || 'submitted'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Pair</span><span className="mono-nums">{submit.result.pair}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">BTC</span><span className="mono-nums">{fmtBtc(submit.result.requested_btc)}</span></div>
                  {submit.result.order_id && (
                    <div className="flex justify-between gap-2"><span className="text-muted">Order</span><span className="mono-nums truncate max-w-40" title={submit.result.order_id}>{submit.result.order_id}</span></div>
                  )}
                  {submit.result.execution && (
                    <>
                      <div className="flex justify-between gap-2"><span className="text-muted">Avg. rate</span><span className="mono-nums">{fmtFiat(submit.result.execution.average_rate, fiatCurrency)}</span></div>
                      <div className="flex justify-between gap-2"><span className="text-muted">Filled BTC</span><span className="mono-nums">{fmtBtc(submit.result.execution.filled_btc)}</span></div>
                      <div className="flex justify-between gap-2"><span className="text-muted">Filled {fiatCurrency}</span><span className="mono-nums">{fmtFiat(submit.result.execution.filled_fiat, fiatCurrency)}</span></div>
                      {(submit.result.execution.fees ?? []).map(fee => (
                        <div key={fee.asset} className="flex justify-between gap-2"><span className="text-muted">Fee ({fee.asset})</span><span className="mono-nums">{fmtBtc(fee.amount)} {fee.asset}</span></div>
                      ))}
                      {submit.result.execution.poll_incomplete && (
                        <div className="flex justify-between gap-2"><span className="text-accent">Note</span><span className="text-accent text-[0.7rem] text-right">Fill details incomplete — order may still be settling</span></div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {activeTab === 'hedge' && (
            <>
              {isHedgeless && hedgeSubmit.phase === 'idle' && <span className="text-muted">Awaiting LND-funded DEX execution.</span>}
              {isHedgeless && hedgeSubmit.phase === 'submitting' && <span className="text-accent">Taking and funding the offer from the LND pool…</span>}
              {isHedgeless && hedgeSubmit.phase === 'done' && hedgeSubmit.funding && (
                <div className="flex flex-col gap-1.5 text-text">
                  <div className="flex justify-between gap-2"><span className="text-muted">Status</span><span className="text-green font-medium">{hedgeSubmit.funding.status}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">DEX</span><span className="mono-nums">{hedgeSubmit.funding.exchange}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Method</span><span className="mono-nums">{hedgeSubmit.funding.method}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">BTC committed</span><span className="mono-nums">{fmtBtc(hedgeSubmit.funding.amount_btc)}</span></div>
                  {(hedgeSubmit.funding.txid || hedgeSubmit.funding.payment_hash) && (
                    <div className="flex justify-between gap-2"><span className="text-muted">Receipt</span><span className="mono-nums truncate max-w-40" title={hedgeSubmit.funding.txid ?? hedgeSubmit.funding.payment_hash}>{hedgeSubmit.funding.txid ?? hedgeSubmit.funding.payment_hash}</span></div>
                  )}
                </div>
              )}
              {!isHedgeless && (
                <>
              {hedgeSubmit.phase === 'idle' && submit.phase === 'idle' && <span className="text-muted">Awaiting spot trade.</span>}
              {hedgeSubmit.phase === 'idle' && submit.phase !== 'idle' && !bd?.hedge?.venue && <span className="text-muted">No hedge venue in offer breakdown.</span>}
              {hedgeSubmit.phase === 'idle' && submit.phase === 'done' && !!bd?.hedge?.venue && <span className="text-muted">Hedge not triggered.</span>}
              {hedgeSubmit.phase === 'submitting' && <span className="text-accent">Opening {bd?.hedge?.side ?? ''} on {bd?.hedge?.venue ?? ''}…</span>}
              {hedgeSubmit.phase === 'error' && <span className="text-red wrap-break-word">{hedgeSubmit.error}</span>}
              {hedgeSubmit.phase === 'done' && hedgeSubmit.result && (
                <div className="flex flex-col gap-1.5 text-text">
                  <div className="flex justify-between gap-2"><span className="text-muted">Status</span><span className="text-green font-medium">{hedgeSubmit.result.status || 'submitted'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Venue</span><span className="mono-nums">{hedgeSubmit.result.venue}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Instrument</span><span className="mono-nums">{hedgeSubmit.result.instrument}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Side</span><span className="mono-nums">{hedgeSubmit.result.side}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">BTC</span><span className="mono-nums">{fmtBtc(hedgeSubmit.result.btc_notional)}</span></div>
                  {hedgeSubmit.result.order_id && (
                    <div className="flex justify-between gap-2"><span className="text-muted">Order</span><span className="mono-nums truncate max-w-40" title={hedgeSubmit.result.order_id}>{hedgeSubmit.result.order_id}</span></div>
                  )}
                </div>
              )}
              {liveHedgeVenue && (
                <LiveHedgePosition position={livePosition} socketConnected={liveSocketConnected} />
              )}
                </>
              )}
              {isHedgeless && hedgeSubmit.phase === 'error' && <span className="text-red wrap-break-word">{hedgeSubmit.error}</span>}
            </>
          )}
          {activeTab === 'wallet' && (
            <>
              {walletSubmit.phase === 'idle' && submit.phase === 'idle' && !receivingAddress && (
                <span className="text-muted">Submit a trade to begin.</span>
              )}
              {walletSubmit.phase === 'idle' && receivingAddress && (
                <div className="flex flex-col gap-1.5 text-text">
                  <div className="flex justify-between gap-2"><span className="text-muted">Receiving address</span><span className="mono-nums truncate max-w-40" title={receivingAddress}>{receivingAddress}</span></div>
                  {submit.phase === 'idle' && <span className="text-muted text-[0.68rem]">From pre-trade whitelist check.</span>}
                </div>
              )}
              {walletSubmit.phase === 'submitting' && (
                <div className="flex flex-col gap-1.5 text-text">
                  <span className="text-accent">Initiating CEX withdrawal to LND wallet…</span>
                  {receivingAddress && (
                    <div className="flex justify-between gap-2"><span className="text-muted">Receiving address</span><span className="mono-nums truncate max-w-40" title={receivingAddress}>{receivingAddress}</span></div>
                  )}
                </div>
              )}
              {walletSubmit.phase === 'error' && <span className="text-red wrap-break-word">{walletSubmit.error}</span>}
              {walletSubmit.phase === 'done' && walletSubmit.result && (
                <div className="flex flex-col gap-1.5 text-text">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Status</span>
                    <span className="text-green font-medium">{cexStatusLabel(withdrawalTrack?.cex_status ?? walletSubmit.result.cex_status ?? 'submitted')}</span>
                  </div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Amount</span><span className="mono-nums">{fmtBtc(walletSubmit.result.amount_btc)} BTC</span></div>
                  {walletSubmit.result.withdrawal_id && (
                    <div className="flex justify-between gap-2"><span className="text-muted">Withdrawal</span><span className="mono-nums truncate max-w-40" title={walletSubmit.result.withdrawal_id}>{walletSubmit.result.withdrawal_id}</span></div>
                  )}
                  {walletSubmit.transactionId != null && walletSubmit.transactionId > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Transaction</span>
                      <span className="mono-nums">#{walletSubmit.transactionId}</span>
                    </div>
                  )}
                  {walletSubmit.transactionId != null && walletSubmit.transactionId > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">{isHedgeless ? 'Pool target' : 'DEX relay'}</span>
                      <span className="text-muted text-[0.68rem]">{isHedgeless && walletSubmit.poolRefill ? `${fmtBtc(walletSubmit.poolRefill.target_btc)} BTC · ${cexStatusLabel(walletSubmit.poolRefill.status)}` : 'Pending ≥1 conf, then auto-relay'}</span>
                    </div>
                  )}
                  {receivingAddress && (
                    <div className="flex justify-between gap-2"><span className="text-muted">LND address</span><span className="mono-nums truncate max-w-40" title={receivingAddress}>{receivingAddress}</span></div>
                  )}
                </div>
              )}
              {walletTrackActive && (
                <LiveWithdrawalStatus track={withdrawalTrack} loading={withdrawalTrackLoading} error={withdrawalTrackError} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
          role="button"
          tabIndex={0}
          aria-label="Close confirmation dialog"
          onClick={event => {
            if (event.target === event.currentTarget) closeConfirm();
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              closeConfirm();
            }
          }}
        >
          <div
            className="bg-surface border border-border sm:rounded-xl rounded-t-xl p-3 sm:p-4 w-full max-w-2xl max-h-[100dvh] sm:max-h-[min(100dvh-2rem,52rem)] flex flex-col gap-2.5 sm:gap-3 shadow-xl shadow-black/40"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-confirm-title"
          >
            <div className="shrink-0 flex flex-col gap-1.5">
              <h3 id="trade-confirm-title" className="text-[0.85rem] font-semibold text-text tracking-tight">{isHedgeless ? 'Confirm hedgeless trade' : 'Confirm market buy'}</h3>
              <p className="text-[0.72rem] text-muted leading-relaxed">
                {isHedgeless
                  ? <>This takes the DEX offer and spends BTC from LND immediately. A replacement market <span className="text-green font-medium">BUY</span> and withdrawal will follow automatically.</>
                  : <>This places a real market <span className="text-green font-medium">BUY</span> order. Funds will be spent immediately.</>}
              </p>
            </div>

            <div className="shrink-0 rounded-lg border border-border bg-bg px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[0.74rem]">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[0.58rem] uppercase tracking-wide text-muted">CEX</span>
                <span className="text-text font-medium truncate">{cexLabel}</span>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[0.58rem] uppercase tracking-wide text-muted">Amount</span>
                <span className="text-text mono-nums truncate">{fmtBtc(clampedBtc)} BTC</span>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[0.58rem] uppercase tracking-wide text-muted">Est. cost</span>
                <span className="text-text mono-nums truncate">{estFiat != null ? fmtFiat(estFiat, fiatCurrency) : '—'}</span>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[0.58rem] uppercase tracking-wide text-muted">Payment</span>
                <span className="text-text font-medium truncate">{resolvedPaymentMethod || (checks.phase === 'done' ? checks.report?.resolved_payment_method : undefined) || '—'}</span>
              </div>
            </div>

            {!resolvedPaymentMethod && (offer.payment_methods?.length ?? 0) > 1 && (
              <p className="shrink-0 text-[0.68rem] text-muted">
                This offer accepts multiple payment methods — the highest-priority linked method from the Payments tab is used automatically.
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
              <PreTradeChecksPanel
                phase={checks.phase}
                report={checks.report}
                error={checks.error}
                isHedgeless={isHedgeless}
                isLightningRoute={isLightningRoute}
              />
            </div>

            {checks.phase === 'done' && checks.report && !checks.report.ok && (
              <div className="shrink-0 rounded-lg border border-red/35 bg-red/10 px-3 py-2 text-[0.7rem] text-red leading-snug">
                Resolve the failed check(s) above before trading.
              </div>
            )}

            <div className="shrink-0 flex items-center justify-end gap-2 pt-0.5 border-t border-border/60 sm:border-0">
              <button type="button" onClick={closeConfirm} className="text-[0.72rem] px-3 py-1.5 rounded-md border border-border text-muted hover:border-muted/60 hover:text-text transition-colors">Cancel</button>
              <button
                type="button"
                onClick={runTrade}
                disabled={!checksPassed}
                title={checksPassed ? undefined : 'All pre-trade checks must pass first'}
                className={`text-[0.72rem] px-3 py-1.5 rounded-md border font-semibold transition-colors ${checksPassed ? 'border-green/50 bg-green/15 text-green hover:bg-green/25' : 'border-border bg-surface text-muted cursor-not-allowed'}`}
              >
                {checks.phase === 'running' ? 'Checking…' : isHedgeless ? 'Take and refill' : 'Confirm buy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
