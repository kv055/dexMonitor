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
  transaction_complete?: boolean;
  [key: string]: unknown;
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
  const [details, setDetails] = useState<Record<number, MmTransaction>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);

  async function toggleEntry(entry: MmTransaction) {
    if (expanded === entry.id) {
      setExpanded(null);
      return;
    }
    setExpanded(entry.id);
    if (details[entry.id]) return;

    setDetailLoading(entry.id);
    try {
      const detail = await apiFetch<MmTransaction>(`/api/mm-controller/transactions/${entry.id}`);
      if (detail?.id === entry.id && typeof detail.status === 'string') {
        setDetails(current => ({ ...current, [entry.id]: detail }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load transaction detail';
      setError(message);
    } finally {
      setDetailLoading(current => current === entry.id ? null : current);
    }
  }

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
              onClick={() => void toggleEntry(entry)}
              className="w-full flex items-center gap-2 text-[0.75rem] py-1.5 bg-transparent border-none cursor-pointer text-left hover:bg-white/5 rounded px-1 transition-colors"
            >
              <span className="text-muted shrink-0 w-26">{created.day} {created.time}</span>
              <span className="text-text shrink-0 w-12 font-medium">#{entry.id}</span>
              <span className="text-text shrink-0 hidden sm:inline w-22">{entry.cex} → {entry.dex}</span>
              <span className="text-text shrink-0 hidden 2xl:inline">
                {Number.isFinite(entry.fiat_amount) ? entry.fiat_amount.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : 'n/a'} {entry.fiat_currency}
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.65rem] ${statusTone(entry.status)}`}>
                {statusLabel}
              </span>
              <span className="ml-auto text-muted">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <TransactionDetail
                entry={details[entry.id] ?? entry}
                loading={detailLoading === entry.id}
                premium={premium}
                pnl={pnl}
                updated={`${updated.day} ${updated.time}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const SUMMARY_KEYS = new Set([
  'id', 'direction', 'fiat_amount', 'fiat_currency', 'cex', 'dex', 'status',
  'status_reason', 'premium_over_cex_price_to_break_even_prediction',
  'total_transaction_pnl', 'updated_at',
]);

function fieldLabel(key: string) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function fieldValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function TransactionDetail({ entry, loading, premium, pnl, updated }: {
  entry: MmTransaction;
  loading: boolean;
  premium: string;
  pnl: string;
  updated: string;
}) {
  const remainingFields = Object.entries(entry).filter(([key]) => !SUMMARY_KEYS.has(key));
  return (
    <div className="px-2 pb-2 pt-0.5 text-[0.7rem]">
      <div className="grid grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1">
        <span className="text-muted">Route</span><span className="text-text">{entry.direction || 'n/a'} · {entry.cex} → {entry.dex}</span>
        <span className="text-muted">Fiat amount</span><span className="text-text">{Number.isFinite(entry.fiat_amount) ? entry.fiat_amount.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : 'n/a'} {entry.fiat_currency}</span>
        <span className="text-muted">Break-even premium</span><span className={premium.startsWith('+') ? 'text-green' : 'text-text'}>{premium}</span>
        <span className="text-muted">Recorded PnL</span><span className={entry.total_transaction_pnl > 0 ? 'text-green' : entry.total_transaction_pnl < 0 ? 'text-red' : 'text-text'}>{pnl}</span>
        <span className="text-muted">Updated</span><span className="text-text">{updated}</span>
        {entry.status_reason && <><span className="text-muted">Status reason</span><span className="text-red break-words">{entry.status_reason}</span></>}
        {loading && <span className="col-span-2 text-muted py-1">Loading full transaction…</span>}
        {!loading && remainingFields.map(([key, value]) => (
          <div key={key} className="contents">
            <span className="text-muted break-words">{fieldLabel(key)}</span>
            <span className="text-text whitespace-pre-wrap break-all font-mono text-[0.65rem]">{fieldValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
