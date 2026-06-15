import { useMemo, useState } from 'react';
import type { Offer, CexSpotBuyResult, CexHedgeOpenResult } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { premiumClass } from '../utils/formatters';
import { cexSpotBuy, cexHedgeOpen } from '../utils/api';
import {
  getBtcMax,
  getBtcMin,
  getDisplayCostBreakdown,
  getNetPremiumPercent,
  getRefPrice,
} from '../utils/offerAccess';

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
  error?: string;
}

function fmtBtc(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
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

function HeaderFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.58rem] uppercase tracking-wide text-muted">{label}</span>
      <span className="text-[0.74rem] text-text font-medium">{children}</span>
    </div>
  );
}

export function TradeTracingPanel({ offer }: { offer: Offer }) {
  const bd = getDisplayCostBreakdown(offer);
  const refPrice = getRefPrice(offer);
  const fiatCurrency = offer.pricing?.fiat_currency ?? 'EUR';
  const isAsk = offer.direction === 'sell';
  const routeCex = bd?.route_cex ?? '';
  const cexLabel = routeCex ? routeCex.charAt(0).toUpperCase() + routeCex.slice(1) : '—';
  const netPremium = getNetPremiumPercent(offer, false);
  const btcMin = getBtcMin(offer);
  const btcMax = getBtcMax(offer);

  const defaultBtc = bd?.btc_amount ?? btcMax ?? btcMin ?? 0;
  const canUseFiat = refPrice != null && refPrice > 0;

  const [unit, setUnit] = useState<Unit>('btc');
  const [draft, setDraft] = useState<string>(() => fmtBtc(defaultBtc));
  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle' });
  const [hedgeSubmit, setHedgeSubmit] = useState<HedgeState>({ phase: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('preview');

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

  const canTrade = !!routeCex && clampedBtc > 0 && submit.phase !== 'submitting';

  async function runTrade() {
    setConfirmOpen(false);
    setSubmit({ phase: 'submitting' });
    setHedgeSubmit({ phase: 'idle' });
    setActiveTab('spot');

    let spotResult: CexSpotBuyResult;
    try {
      spotResult = await cexSpotBuy({
        provider: routeCex,
        btc_amount: clampedBtc,
        fiat_currency: fiatCurrency,
      });
      setSubmit({ phase: 'done', result: spotResult });
    } catch (err) {
      setSubmit({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Spot succeeded — auto-trigger the hedge leg if the offer has a hedge breakdown.
    const hedgeVenue = bd?.hedge?.venue;
    if (!hedgeVenue) return;

    const hedgeRatio = bd?.hedge?.position?.hedge_ratio ?? 1.0;
    const leverage  = bd?.hedge?.position?.leverage_used ?? 1.0;
    const side      = bd?.hedge?.side ?? (isAsk ? 'long' : 'short');
    const btcNotional = clampedBtc * hedgeRatio;

    setHedgeSubmit({ phase: 'submitting' });
    setActiveTab('hedge');
    try {
      const hedgeResult = await cexHedgeOpen({
        venue:        hedgeVenue,
        side,
        btc_notional: btcNotional,
        leverage,
      });
      setHedgeSubmit({ phase: 'done', result: hedgeResult });
    } catch (err) {
      setHedgeSubmit({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
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
            { id: 'spot'    as Tab, label: 'Spot',    dot: submit.phase },
            { id: 'hedge'   as Tab, label: 'Hedge',   dot: hedgeSubmit.phase },
            { id: 'wallet'  as Tab, label: 'Wallet',  dot: 'idle' as const },
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
                <HeaderFact label="Best CEX">{cexLabel}</HeaderFact>
                <HeaderFact label="Payment">{offer.payment_method ?? '—'}</HeaderFact>
                <HeaderFact label="Net premium">
                  <span className={premiumClass(netPremium)}>{netPremium != null ? `${netPremium.toFixed(2)}%` : '—'}</span>
                </HeaderFact>
                <HeaderFact label="Ref price">{refPrice != null ? fmtFiat(refPrice, fiatCurrency) : '—'}</HeaderFact>
              </div>

              <div className="border-t border-border" />

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
                  onClick={() => setConfirmOpen(true)}
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
            </div>
          )}
          {activeTab === 'spot' && (
            <>
              {submit.phase === 'idle' && <span className="text-muted">Submit a trade to begin.</span>}
              {submit.phase === 'submitting' && <span className="text-accent">Placing market buy on {cexLabel}…</span>}
              {submit.phase === 'error' && <span className="text-red wrap-break-word">{submit.error}</span>}
              {submit.phase === 'done' && submit.result && (
                <div className="flex flex-col gap-1.5 text-text">
                  <div className="flex justify-between gap-2"><span className="text-muted">Status</span><span className="text-green font-medium">{submit.result.status || 'submitted'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">Pair</span><span className="mono-nums">{submit.result.pair}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted">BTC</span><span className="mono-nums">{fmtBtc(submit.result.requested_btc)}</span></div>
                  {submit.result.order_id && (
                    <div className="flex justify-between gap-2"><span className="text-muted">Order</span><span className="mono-nums truncate max-w-40" title={submit.result.order_id}>{submit.result.order_id}</span></div>
                  )}
                </div>
              )}
            </>
          )}
          {activeTab === 'hedge' && (
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
            </>
          )}
          {activeTab === 'wallet' && (
            <span className="text-muted">Pending — not yet wired.</span>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-surface border border-border rounded-lg p-4 w-full max-w-sm flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-[0.8rem] font-semibold text-text">Confirm market buy</h3>
            <p className="text-[0.72rem] text-muted">
              This places a real market <span className="text-green font-medium">BUY</span> order. Funds will be spent immediately.
            </p>
            <div className="bg-bg border border-border rounded-md p-2.5 flex flex-col gap-1.5 text-[0.74rem]">
              <div className="flex justify-between gap-2"><span className="text-muted">CEX</span><span className="text-text font-medium">{cexLabel}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted">Amount</span><span className="text-text mono-nums">{fmtBtc(clampedBtc)} BTC</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted">Est. cost</span><span className="text-text mono-nums">{estFiat != null ? fmtFiat(estFiat, fiatCurrency) : '—'}</span></div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="text-[0.72rem] px-3 py-1.5 rounded-md border border-border text-muted hover:border-muted/60">Cancel</button>
              <button type="button" onClick={runTrade} className="text-[0.72rem] px-3 py-1.5 rounded-md border border-green/50 bg-green/15 text-green font-semibold hover:bg-green/25">Confirm buy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
