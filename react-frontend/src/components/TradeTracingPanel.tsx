import { useMemo, useState } from 'react';
import type { Offer, CexSpotBuyResult } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { premiumClass } from '../utils/formatters';
import { cexSpotBuy } from '../utils/api';
import {
  getBtcMax,
  getBtcMin,
  getDisplayCostBreakdown,
  getNetPremiumPercent,
  getRefPrice,
} from '../utils/offerAccess';

type Unit = 'btc' | 'fiat';

interface SubmitState {
  phase: 'idle' | 'submitting' | 'done' | 'error';
  result?: CexSpotBuyResult;
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

function StatusBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0 bg-bg border border-border rounded-md p-2.5 flex flex-col gap-1.5">
      <h4 className="text-[0.6rem] uppercase tracking-widest font-semibold text-muted">{title}</h4>
      <div className="flex-1 min-h-0 text-[0.72rem]">{children}</div>
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
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    try {
      const result = await cexSpotBuy({
        provider: routeCex,
        btc_amount: clampedBtc,
        fiat_currency: fiatCurrency,
      });
      setSubmit({ phase: 'done', result });
    } catch (err) {
      setSubmit({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
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

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
        {/* Trade facts */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-bg border border-border rounded-md p-2.5">
          <HeaderFact label="Direction">{isAsk ? 'Sell on DEX' : 'Buy on DEX'}</HeaderFact>
          <HeaderFact label="DEX"><ExchangeTag exchange={offer.exchange} /></HeaderFact>
          <HeaderFact label="Best CEX">{cexLabel}</HeaderFact>
          <HeaderFact label="Payment">{offer.payment_method ?? '—'}</HeaderFact>
          <HeaderFact label="Net premium">
            <span className={premiumClass(netPremium)}>{netPremium != null ? `${netPremium.toFixed(2)}%` : '—'}</span>
          </HeaderFact>
          <HeaderFact label="Ref price">{refPrice != null ? fmtFiat(refPrice, fiatCurrency) : '—'}</HeaderFact>
        </div>

        {/* Volume selector */}
        <div className="bg-bg border border-border rounded-md p-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.6rem] uppercase tracking-widest font-semibold text-muted">Trade volume</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleUnit('btc')}
                className={`text-[0.63rem] px-2 py-0.5 rounded-md border font-medium transition-colors ${unit === 'btc' ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-muted hover:border-muted/60'}`}
              >
                BTC
              </button>
              <button
                type="button"
                onClick={() => toggleUnit('fiat')}
                disabled={!canUseFiat}
                className={`text-[0.63rem] px-2 py-0.5 rounded-md border font-medium transition-colors ${unit === 'fiat' ? 'border-accent/60 text-accent bg-accent/10' : 'border-border text-muted hover:border-muted/60'} ${!canUseFiat ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {fiatCurrency}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="flex-1 min-w-0 bg-surface border border-border rounded-md px-2.5 py-1.5 text-[0.85rem] text-text mono-nums focus:outline-none focus:border-accent/60"
              placeholder={unit === 'btc' ? '0.0' : '0'}
            />
            <span className="text-[0.7rem] text-muted shrink-0">{unit === 'btc' ? 'BTC' : fiatCurrency}</span>
          </div>

          <div className="flex items-center justify-between text-[0.62rem] text-muted">
            <span>
              {unit === 'btc'
                ? (estFiat != null ? `≈ ${fmtFiat(estFiat, fiatCurrency)}` : '—')
                : `≈ ${fmtBtc(clampedBtc)} BTC`}
            </span>
            <span>
              {btcMin != null || btcMax != null
                ? `Limits ${btcMin != null ? fmtBtc(btcMin) : '0'}–${btcMax != null ? fmtBtc(btcMax) : '∞'} BTC`
                : ''}
            </span>
          </div>
          {outOfBounds && (
            <span className="text-[0.62rem] text-accent">Amount clamped to offer limits ({fmtBtc(clampedBtc)} BTC).</span>
          )}

          <button
            type="button"
            disabled={!canTrade}
            onClick={() => setConfirmOpen(true)}
            className={`mt-0.5 w-full rounded-md py-2 text-[0.78rem] font-semibold transition-colors ${canTrade ? 'bg-green/15 border border-green/50 text-green hover:bg-green/25' : 'bg-surface border border-border text-muted cursor-not-allowed'}`}
          >
            {submit.phase === 'submitting' ? 'Submitting…' : `Start trade${routeCex ? ` on ${cexLabel}` : ''}`}
          </button>
        </div>

        {/* Trade-tracing boxes */}
        <div className="flex flex-col sm:flex-row gap-2">
          <StatusBox title="Spot Trade CEX">
            {submit.phase === 'idle' && <span className="text-muted">Idle — submit a trade to begin.</span>}
            {submit.phase === 'submitting' && <span className="text-accent">Placing market buy on {cexLabel}…</span>}
            {submit.phase === 'error' && <span className="text-red break-words">{submit.error}</span>}
            {submit.phase === 'done' && submit.result && (
              <div className="flex flex-col gap-1 text-text">
                <div className="flex justify-between gap-2"><span className="text-muted">Status</span><span className="text-green font-medium">{submit.result.status || 'submitted'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted">Pair</span><span className="mono-nums">{submit.result.pair}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted">BTC</span><span className="mono-nums">{fmtBtc(submit.result.requested_btc)}</span></div>
                {submit.result.order_id && (
                  <div className="flex justify-between gap-2"><span className="text-muted">Order</span><span className="mono-nums truncate max-w-[10rem]" title={submit.result.order_id}>{submit.result.order_id}</span></div>
                )}
              </div>
            )}
          </StatusBox>
          <StatusBox title="Hedge Trade CEX">
            <span className="text-muted">Pending — not yet wired.</span>
          </StatusBox>
          <StatusBox title="Wallet">
            <span className="text-muted">Pending — not yet wired.</span>
          </StatusBox>
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
