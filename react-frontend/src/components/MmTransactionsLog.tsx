import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTimeParts } from '../utils/formatters';
import { LoadingSpinner } from './LoadingSpinner';

interface MmTransaction {
  id: number;
  direction: string;
  fiat_amount: number;
  fiat_currency: string;
  cex: string;
  dex: string;
  status: string;
  status_reason?: string | null;
  total_transaction_pnl: number;
  premium_over_cex_price_to_break_even_prediction: number;
  created_at: string;
  updated_at: string;
}

interface MmTransactionListResponse {
  transactions: MmTransaction[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_LABELS: Record<string, string> = {
  TransactionNeedsReview: 'Transaction review',
  CexTradeflowStarted: 'CEX trade started',
  HedgeFailedNeedsReview: 'Hedge review',
  CexTradeflowNeedsReview: 'CEX trade review',
  HedgelessTradeStarted: 'Hedgeless started',
  HedgelessPreparationFailed: 'Preparation failed',
  LiquidityPreparationNeedsReview: 'Liquidity review',
  HedgelessFundingInitiated: 'DEX funding started',
  HedgelessFundingNeedsReview: 'DEX funding review',
  DexTakenFundingNeedsReview: 'Taken funding review',
  CexTradeSuccessful: 'CEX trade',
  CexCryptoWithdrawalInitiated: 'Withdrawal started',
  CexCryptoWithdrawalArrived: 'Withdrawal arrived',
  DexPositionTaken: 'DEX taken',
  DexFiatHasArrived: 'Fiat arrived',
  DexPositionReleased: 'Released',
};

function statusTone(status: string) {
  if (status === 'DexPositionReleased') return 'text-green border-green/30 bg-green/8';
  if (status === 'DexPositionTaken' || status === 'DexFiatHasArrived') return 'text-blue border-blue/30 bg-blue/8';
  if (status.endsWith('NeedsReview') || status.endsWith('Failed')) return 'text-red border-red/30 bg-red/8';
  if (status === 'CexTradeSuccessful' || status === 'CexCryptoWithdrawalArrived') return 'text-accent border-accent/30 bg-[rgba(247,147,26,0.08)]';
  return 'text-muted border-border bg-bg/30';
}

function formatSignedPct(value: number) {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatSignedCurrency(value: number, currency: string) {
  if (!Number.isFinite(value)) return 'n/a';
  const formatted = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
}

export function MmTransactionsLog() {
  const { timezone } = useTimezone();
  const [entries, setEntries] = useState<MmTransaction[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await apiFetch<MmTransactionListResponse>('/api/mm-controller/transactions?limit=20');
        if (!active) return;
        setEntries(data.transactions);
        setError(null);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : 'Failed to load MM transactions';
        setError(message);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto flex flex-col gap-0.5">
      {loading && <LoadingSpinner size={88} label="Loading MM logs" />}
      {!loading && error && (
        <span className="text-red text-[0.75rem] px-1">{error}</span>
      )}
      {!loading && !error && entries.length === 0 && (
        <span className="text-muted text-[0.75rem] px-1">No MM controller transactions yet.</span>
      )}

      {entries.map(entry => {
        const created = formatDateTimeParts(entry.created_at, timezone);
        const updated = formatDateTimeParts(entry.updated_at, timezone);
        const isOpen = expanded === entry.id;
        const statusLabel = STATUS_LABELS[entry.status] ?? entry.status;
        const premium = formatSignedPct(entry.premium_over_cex_price_to_break_even_prediction ?? 0);
        const pnl = formatSignedCurrency(entry.total_transaction_pnl ?? 0, entry.fiat_currency || 'EUR');

        return (
          <div key={entry.id} className="border-b border-border last:border-0">
            <button
              onClick={() => setExpanded(isOpen ? null : entry.id)}
              className="w-full flex items-center gap-2 text-[0.75rem] py-1.5 bg-transparent border-none cursor-pointer text-left hover:bg-white/5 rounded px-1 transition-colors"
            >
              <span className="text-muted shrink-0 w-26">{created.day} {created.time}</span>
              <span className="text-text shrink-0 w-12 font-medium">#{entry.id}</span>
              <span className="text-text shrink-0 w-22">{entry.cex} → {entry.dex}</span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.65rem] ${statusTone(entry.status)}`}>
                {statusLabel}
              </span>
              <span className="ml-auto text-muted">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-2 pb-2 pt-0.5 text-[0.7rem]">
                <span className="text-muted">Direction</span>
                <span className="text-text">{entry.direction || 'n/a'}</span>
                <span className="text-muted">Fiat amount</span>
                <span className="text-text">
                  {Number.isFinite(entry.fiat_amount)
                    ? `${entry.fiat_amount.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${entry.fiat_currency || ''}`.trim()
                    : 'n/a'}
                </span>
                <span className="text-muted">Break-even premium</span>
                <span className={premium.startsWith('+') ? 'text-green' : 'text-text'}>{premium}</span>
                <span className="text-muted">Recorded PnL</span>
                <span className={entry.total_transaction_pnl > 0 ? 'text-green' : entry.total_transaction_pnl < 0 ? 'text-red' : 'text-text'}>
                  {pnl}
                </span>
                <span className="text-muted">Updated</span>
                <span className="text-text">{updated.day} {updated.time}</span>
                {entry.status_reason && (
                  <>
                    <span className="text-muted">Status reason</span>
                    <span className="text-red break-words">{entry.status_reason}</span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
