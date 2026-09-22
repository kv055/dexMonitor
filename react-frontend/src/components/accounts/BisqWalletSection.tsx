import { useCallback, useEffect, useState } from 'react';
import {
  fetchBisqWalletAddresses,
  fetchBisqWalletBalances,
  fetchBisqWalletTransactions,
  fetchBisqFundingDestination,
  setBisqFundingDestination,
  withdrawBisqWallet,
} from '../../utils/api';
import type {
  BisqWalletAddress,
  BisqWalletBalances,
  BisqWalletTransaction,
} from '../../types';
import { CollapsibleSection, SectionState } from './AccountDetailPrimitives';

const inputCls =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent';
const labelCls = 'text-[0.65rem] text-muted';
const buttonCls =
  'rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-text transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonCls =
  'rounded-md border border-accent bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonCls =
  'rounded-md border border-red bg-red/10 px-2 py-1 text-xs font-medium text-red transition hover:bg-red/20 disabled:cursor-not-allowed disabled:opacity-50';

function formatSats(sats: number): string {
  const btc = sats / 100_000_000;
  return `${btc.toFixed(8)} BTC`;
}

function shortenTxID(txID: string): string {
  if (txID.length <= 16) return txID;
  return `${txID.slice(0, 8)}…${txID.slice(-6)}`;
}

function CopyButton({ value, title }: { value: string; title: string }) {
  return (
    <button
      type="button"
      className="rounded-md border border-transparent px-1 text-muted transition hover:border-border hover:text-text"
      title={title}
      aria-label={title}
      onClick={() => void navigator.clipboard?.writeText(value)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  );
}

type WalletData = {
  balances: BisqWalletBalances | null;
  addresses: BisqWalletAddress[];
  transactions: BisqWalletTransaction[];
};

function BisqWalletPanel() {
  const [data, setData] = useState<WalletData>({ balances: null, addresses: [], transactions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [designated, setDesignated] = useState<string | null>(null);
  const [designating, setDesignating] = useState<string | null>(null);

  // Withdrawal form state: edit → review → done.
  const [step, setStep] = useState<'edit' | 'review' | 'done'>('edit');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [sentTx, setSentTx] = useState<BisqWalletTransaction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const next: WalletData = { balances: null, addresses: [], transactions: [] };
    const [balances, addresses, transactions, destination] = await Promise.allSettled([
      fetchBisqWalletBalances(),
      fetchBisqWalletAddresses(),
      fetchBisqWalletTransactions(),
      fetchBisqFundingDestination(),
    ] as const);
    let firstError: string | null = null;
    if (balances.status === 'fulfilled') {
      next.balances = balances.value;
    } else {
      firstError = balances.reason instanceof Error ? balances.reason.message : String(balances.reason);
    }
    if (addresses.status === 'fulfilled') {
      next.addresses = addresses.value.addresses;
    } else if (!firstError) {
      firstError = addresses.reason instanceof Error ? addresses.reason.message : String(addresses.reason);
    }
    if (transactions.status === 'fulfilled') {
      next.transactions = transactions.value.transactions;
    } else if (!firstError) {
      firstError = transactions.reason instanceof Error ? transactions.reason.message : String(transactions.reason);
    }
    if (destination.status === 'fulfilled') {
      setDesignated(destination.value.destination?.address ?? null);
    }
    setData(next);
    setError(firstError);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const amountValid = /^\d*(\.\d{1,8})?$/.test(amount.trim()) && Number(amount) > 0;
  const addressValid = address.trim().length >= 20;
  const canReview = addressValid && amountValid;

  const submitWithdrawal = async () => {
    setSubmitting(true);
    setWithdrawError(null);
    try {
      const response = await withdrawBisqWallet({
        address: address.trim(),
        amount_btc: amount.trim(),
        tx_fee_rate: feeRate.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      setSentTx(response.transaction);
      setStep('done');
      void load();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep('edit');
    setAddress('');
    setAmount('');
    setFeeRate('');
    setMemo('');
    setWithdrawError(null);
    setSentTx(null);
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[0.65rem] uppercase tracking-wider text-muted">Balances</span>
        <button type="button" className={buttonCls} onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <SectionState loading={loading} error={error} emptyMessage="No wallet data." hasData={!!(data.balances?.btc || data.balances?.bsq || data.addresses.length)} onRetry={() => void load()} />
      {data.balances?.btc ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Available', formatSats(data.balances.btc.available_sats)],
            ['Reserved (offers)', formatSats(data.balances.btc.reserved_sats)],
            ['Locked (trades)', formatSats(data.balances.btc.locked_sats)],
            ['Total', formatSats(data.balances.btc.total_available_sats)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-bg px-2.5 py-2">
              <div className="text-[0.6rem] font-medium uppercase tracking-wider text-muted">{label}</div>
              <div className="mt-1 break-all font-mono text-xs font-semibold text-text">{value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {data.balances?.bsq ? (
        <p className="text-[0.65rem] text-muted">
          BSQ: {(data.balances.bsq.available_confirmed_sats / 100_000_000).toFixed(4)} available ·{' '}
          {(data.balances.bsq.locked_for_voting_sats / 100_000_000).toFixed(4)} voting ·{' '}
          {(data.balances.bsq.unlocking_bonds_sats / 100_000_000).toFixed(4)} unlocking
        </p>
      ) : null}

      {/* --- Addresses --- */}
      <span className="mt-1 text-[0.65rem] uppercase tracking-wider text-muted">Funding addresses</span>
      <div className="grid gap-1">
        {data.addresses.map(a => (
          <div key={a.address} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg px-2 py-1.5">
            <span className="min-w-0 truncate font-mono text-xs text-text">{a.address}</span>
            <span className="flex shrink-0 items-center gap-2">
              {designated === a.address ? (
                <span className="rounded-full border border-green/40 px-1.5 py-0 text-[0.6rem] text-green">designated</span>
              ) : (
                <button
                  type="button"
                  className={buttonCls}
                  disabled={designating === a.address}
                  onClick={() => {
                    setDesignating(a.address);
                    void setBisqFundingDestination(a.address)
                      .then(() => setDesignated(a.address))
                      .catch(err => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setDesignating(null));
                  }}
                >
                  {designating === a.address ? 'Saving…' : 'Use for CEX funding'}
                </button>
              )}
              {!a.is_address_unused ? (
                a.balance_sats > 0 ? (
                  <span className="font-mono text-[0.65rem] text-text">{formatSats(a.balance_sats)}</span>
                ) : (
                  <span className="text-[0.65rem] text-muted">{a.num_confirmations} conf</span>
                )
              ) : (
                <span className="rounded-full border border-border px-1.5 py-0 text-[0.6rem] text-muted">unused</span>
              )}
              <CopyButton value={a.address} title="Copy address" />
            </span>
          </div>
        ))}
      </div>

      {/* --- Withdrawal --- */}
      <span className="mt-1 text-[0.65rem] uppercase tracking-wider text-muted">Withdraw</span>
      {step === 'edit' ? (
        <div className="grid gap-2 rounded-lg border border-border bg-bg p-2">
          <label className={`grid gap-1 ${labelCls}`}>
            Destination BTC address
            <input className={inputCls} value={address} onChange={e => setAddress(e.target.value)} placeholder="bc1…" spellCheck={false} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={`grid gap-1 ${labelCls}`}>
              Amount (BTC)
              <input className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00500000" inputMode="decimal" />
            </label>
            <label className={`grid gap-1 ${labelCls}`}>
              Fee rate (sats/vbyte, optional)
              <input className={inputCls} value={feeRate} onChange={e => setFeeRate(e.target.value)} placeholder="auto" inputMode="decimal" />
            </label>
          </div>
          <label className={`grid gap-1 ${labelCls}`}>
            Memo (optional)
            <input className={inputCls} value={memo} onChange={e => setMemo(e.target.value)} maxLength={512} />
          </label>
          {withdrawError ? <span className="break-words text-xs text-red">{withdrawError}</span> : null}
          <div className="flex justify-end">
            <button type="button" className={primaryButtonCls} disabled={!canReview} onClick={() => setStep('review')}>
              Review withdrawal
            </button>
          </div>
        </div>
      ) : step === 'review' ? (
        <div className="grid gap-2 rounded-lg border border-border bg-bg p-2">
          <p className="text-xs text-text">Send <span className="font-mono font-semibold">{amount.trim()} BTC</span> to</p>
          <p className="break-all font-mono text-xs text-text">{address.trim()}</p>
          {feeRate.trim() ? <p className={labelCls}>Fee rate: {feeRate.trim()} sats/vbyte</p> : <p className={labelCls}>Fee rate: daemon default</p>}
          {memo.trim() ? <p className={labelCls}>Memo: {memo.trim()}</p> : null}
          <p className="text-[0.65rem] text-red">On-chain Bitcoin transfers cannot be reversed.</p>
          {withdrawError ? <span className="break-words text-xs text-red">{withdrawError}</span> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonCls} onClick={resetForm} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className={dangerButtonCls} onClick={() => void submitWithdrawal()} disabled={submitting}>
              {submitting ? 'Sending…' : 'Send now'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 rounded-lg border border-green/40 bg-green/5 p-2">
          <p className="text-xs text-text">Withdrawal broadcast.</p>
          {sentTx ? (
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 break-all font-mono text-xs text-text">{sentTx.tx_id}</span>
              <CopyButton value={sentTx.tx_id} title="Copy transaction id" />
            </span>
          ) : null}
          <button type="button" className={`${buttonCls} justify-self-start`} onClick={resetForm}>
            New withdrawal
          </button>
        </div>
      )}

      {/* --- Transaction history --- */}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[0.65rem] uppercase tracking-wider text-muted">Transaction history</span>
        <span className="text-[0.65rem] text-muted">{data.transactions.length} txs</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        {data.transactions.map((tx, index) => (
          <div key={tx.tx_id || index} className="flex items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0">
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-xs text-text" title={tx.tx_id}>{shortenTxID(tx.tx_id)}</span>
              <CopyButton value={tx.tx_id} title="Copy transaction id" />
            </span>
            <span className="flex shrink-0 items-center gap-3 text-right text-[0.65rem]">
              <span className={`rounded-full px-1.5 py-0 ${tx.is_pending ? 'bg-yellow/15 text-yellow' : 'bg-green/15 text-green'}`}>
                {tx.is_pending ? 'pending' : 'confirmed'}
              </span>
              <span className="hidden font-mono sm:inline">{formatSats(tx.output_sum_sats)}</span>
              <span className="font-mono text-muted">{tx.fee_sats} sat fee</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// BisqWalletSection is the bisq1 wallet management entry in the account detail's
// Wallet tab: balances, funding addresses, transaction history and withdrawals.
export function BisqWalletSection() {
  const [open, setOpen] = useState(false);
  return (
    <CollapsibleSection title="Daemon wallet" summary="Balance, addresses, withdrawals" open={open} onToggle={() => setOpen(o => !o)}>
      {open ? <BisqWalletPanel /> : null}
    </CollapsibleSection>
  );
}
