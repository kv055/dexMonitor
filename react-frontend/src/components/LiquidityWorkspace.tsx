import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { closeLNDChannel, fetchCexBalances, fetchCexDepositAddresses, fetchCexHedgePositions, fetchLNDWalletStatus, fetchTradingAccounts, openLNDChannel } from '../utils/api';
import type { CexAssetBalance, CexDepositAddress, LNDWalletStatus, TradingAccount } from '../types';

type PoolAction = 'fill' | 'drain';
type TransferRoute = 'exchange' | 'manual';
type ManagementPanel = 'pool' | 'channels';

type CexLiquiditySource = {
  accountID: number;
  provider: string;
  spotBTC: number | null;
  fiat: CexAssetBalance[];
  activeHedgeCount: number;
  hedgeExposureBTC: number;
  error?: string;
};

function UnavailableCell() {
  return <span className="text-muted font-mono text-[0.7rem]">Not connected</span>;
}

function TargetCell() {
  return <span className="text-muted font-mono text-[0.7rem]">Not configured</span>;
}

function shortAddress(address: string) {
  return address.length <= 22 ? address : `${address.slice(0, 12)}…${address.slice(-8)}`;
}

function formatSats(value: number) {
  return `${new Intl.NumberFormat().format(value)} sats`;
}

function formatBTC(value: number) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })} BTC`;
}

function isConnectedCex(account: TradingAccount) {
  return account.category === 'CEX'
    && account.is_active
    && account.is_healthy
    && account.api_keys.some(key => key.is_active);
}

export function LiquidityWorkspace() {
  const [action, setAction] = useState<PoolAction>('fill');
  const [activeManagementPanel, setActiveManagementPanel] = useState<ManagementPanel>('pool');
  const [transferRoute, setTransferRoute] = useState<TransferRoute>('exchange');
  const [amount, setAmount] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [lndWallet, setLndWallet] = useState<LNDWalletStatus | null>(null);
  const [cexLiquidity, setCexLiquidity] = useState<CexLiquiditySource[]>([]);
  const [liquidityLoading, setLiquidityLoading] = useState(true);
  const [cexLiquidityError, setCexLiquidityError] = useState<string | null>(null);
  const [lndLiquidityError, setLndLiquidityError] = useState<string | null>(null);
  const [liquidityRefresh, setLiquidityRefresh] = useState(0);
  const [liquidityUpdatedAt, setLiquidityUpdatedAt] = useState<Date | null>(null);
  const [selectedExchangeID, setSelectedExchangeID] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');
  const [depositAddresses, setDepositAddresses] = useState<CexDepositAddress[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingDestination, setLoadingDestination] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState({ nodePubkey: '', peerHost: '', fundingSats: '', pushSats: '', feeRate: '2', private: false });
  const [channelNotice, setChannelNotice] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [openingChannel, setOpeningChannel] = useState(false);
  const [closingChannelPoint, setClosingChannelPoint] = useState<string | null>(null);

  const connectedExchanges = useMemo(() => accounts.filter(isConnectedCex), [accounts]);
  const lndAddresses = useMemo(() => lndWallet?.addresses.filter(address => address.kind === 'onchain') ?? [], [lndWallet]);
  const selectedExchange = connectedExchanges.find(account => String(account.id) === selectedExchangeID) ?? null;
  const channels = lndWallet?.channels ?? [];
  const lndOnChainSats = lndAddresses.reduce((sum, address) => sum + (address.balance_sat ?? 0), 0);
  const lightningLocalSats = channels.reduce((sum, channel) => sum + channel.local_balance_sat, 0);
  const lightningRemoteSats = channels.reduce((sum, channel) => sum + channel.remote_balance_sat, 0);
  const activeChannelCount = channels.filter(channel => channel.active).length;
  const totalCexSpotBTC = cexLiquidity.reduce((sum, source) => sum + (source.spotBTC ?? 0), 0);
  const totalHedgeExposureBTC = cexLiquidity.reduce((sum, source) => sum + source.hedgeExposureBTC, 0);
  const totalHedgeCount = cexLiquidity.reduce((sum, source) => sum + source.activeHedgeCount, 0);
  const totalFiat = useMemo(() => {
    const values = new Map<string, number>();
    for (const source of cexLiquidity) {
      for (const balance of source.fiat) values.set(balance.asset, (values.get(balance.asset) ?? 0) + balance.available);
    }
    return [...values.entries()];
  }, [cexLiquidity]);
  const destinationOptions = action === 'fill'
    ? lndAddresses.map(address => ({ address: address.address, label: address.label || 'LND on-chain address', network: 'Bitcoin' }))
    : depositAddresses.map(address => ({ address: address.address, label: 'CEX BTC deposit address', network: address.network || 'Bitcoin' }));
  const sourceLabel = action === 'fill'
    ? (transferRoute === 'exchange' ? `${selectedExchange?.provider ?? 'Selected exchange'} BTC wallet` : 'External BTC wallet')
    : 'LND on-chain wallet';
  const destinationLabel = action === 'fill'
    ? 'LND on-chain wallet'
    : (transferRoute === 'exchange' ? `${selectedExchange?.provider ?? 'Selected exchange'} BTC wallet` : 'External BTC address');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLiquidityLoading(true);
      setLoadingAccounts(true);
      const [accountsResult, lndResult] = await Promise.allSettled([fetchTradingAccounts(), fetchLNDWalletStatus()]);
      if (!active) return;

      if (accountsResult.status === 'fulfilled') {
        const nextAccounts = accountsResult.value;
        const nextCexAccounts = nextAccounts.filter(isConnectedCex);
        setAccounts(nextAccounts);
        const snapshots = await Promise.all(nextCexAccounts.map(async account => {
          const [balances, hedges] = await Promise.allSettled([fetchCexBalances(account.id), fetchCexHedgePositions(account.id)]);
          if (balances.status !== 'fulfilled' && hedges.status !== 'fulfilled') {
            const reason = balances.status === 'rejected' ? balances.reason : hedges.status === 'rejected' ? hedges.reason : null;
            return { accountID: account.id, provider: account.provider, spotBTC: null, fiat: [], activeHedgeCount: 0, hedgeExposureBTC: 0, error: reason instanceof Error ? reason.message : 'Source unavailable' };
          }
          const active = hedges.status === 'fulfilled' ? hedges.value.active : [];
          return {
            accountID: account.id,
            provider: account.provider,
            spotBTC: balances.status === 'fulfilled' ? balances.value.bitcoin?.available ?? 0 : null,
            fiat: balances.status === 'fulfilled' ? balances.value.fiat : [],
            activeHedgeCount: active.length,
            hedgeExposureBTC: active.reduce((sum, position) => sum + Math.abs(position.size_btc ?? 0), 0),
            error: balances.status === 'rejected' || hedges.status === 'rejected' ? 'Partial source unavailable' : undefined,
          };
        }));
        if (!active) return;
        setCexLiquidity(previous => snapshots.map(snapshot => {
          if (!snapshot.error) return snapshot;
          const prior = previous.find(item => item.accountID === snapshot.accountID);
          return prior ? { ...prior, error: snapshot.error } : snapshot;
        }));
        setCexLiquidityError(null);
        setLoadError(null);
      } else {
        const message = accountsResult.reason instanceof Error ? accountsResult.reason.message : 'Could not load CEX connections.';
        setCexLiquidityError(message);
        setLoadError(message);
      }

      if (lndResult.status === 'fulfilled') {
        setLndWallet(lndResult.value);
        setLndLiquidityError(null);
      } else {
        setLndLiquidityError(lndResult.reason instanceof Error ? lndResult.reason.message : 'Could not load LND liquidity.');
      }
      setLiquidityUpdatedAt(new Date());
      setLiquidityLoading(false);
      setLoadingAccounts(false);
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [liquidityRefresh]);

  useEffect(() => {
    if (connectedExchanges.length === 0) {
      setSelectedExchangeID('');
      return;
    }
    if (!connectedExchanges.some(account => String(account.id) === selectedExchangeID)) {
      setSelectedExchangeID(String(connectedExchanges[0].id));
    }
  }, [connectedExchanges, selectedExchangeID]);

  useEffect(() => {
    if (action === 'fill') {
      setSelectedDestination(current => lndAddresses.some(address => address.address === current) ? current : (lndAddresses[0]?.address ?? ''));
      setDepositAddresses([]);
      return;
    }
    if (transferRoute === 'manual') {
      setDepositAddresses([]);
      setSelectedDestination('');
      return;
    }
    if (!selectedExchangeID) {
      setDepositAddresses([]);
      setSelectedDestination('');
      return;
    }

    let active = true;
    setLoadingDestination(true);
    void fetchCexDepositAddresses(Number(selectedExchangeID))
      .then(addresses => {
        if (!active) return;
        const bitcoinAddresses = addresses.filter(address => address.asset.trim().toUpperCase() === 'BTC');
        setDepositAddresses(bitcoinAddresses);
        setSelectedDestination(current => bitcoinAddresses.some(address => address.address === current) ? current : (bitcoinAddresses[0]?.address ?? ''));
      })
      .catch(error => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load the CEX BTC deposit address.');
        setDepositAddresses([]);
        setSelectedDestination('');
      })
      .finally(() => { if (active) setLoadingDestination(false); });
    return () => { active = false; };
  }, [action, selectedExchangeID, transferRoute, lndAddresses]);

  const selectAction = (next: PoolAction) => {
    setAction(next);
    setFeedback(null);
  };

  const selectRoute = (next: TransferRoute) => {
    setTransferRoute(next);
    setFeedback(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFeedback('Enter an amount greater than zero.');
      return;
    }
    const destination = transferRoute === 'manual' && action === 'drain' ? manualAddress.trim() : selectedDestination;
    const source = transferRoute === 'manual' && action === 'fill' ? manualAddress.trim() : 'connected exchange';
    if ((transferRoute === 'exchange' && !selectedExchange) || !destination || !source) {
      setFeedback('Choose a connected exchange and a destination address before creating a transfer request.');
      return;
    }
    setFeedback('A dedicated wallet-transfer API is not connected yet. No transfer was sent.');
  };

  const refreshLndWallet = async () => {
    const nextWallet = await fetchLNDWalletStatus();
    setLndWallet(nextWallet);
  };

  const submitOpenChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fundingSats = Number(channelForm.fundingSats);
    const pushSats = Number(channelForm.pushSats || 0);
    const feeRate = Number(channelForm.feeRate || 2);
    if (!channelForm.nodePubkey.trim() || !Number.isFinite(fundingSats) || fundingSats <= 0 || !Number.isFinite(pushSats) || pushSats < 0 || !Number.isFinite(feeRate) || feeRate <= 0) {
      setChannelError('Enter a node pubkey, a positive local funding amount, and valid optional amounts.');
      return;
    }
    if (!window.confirm(`Open a channel with ${formatSats(fundingSats)} of local funding?`)) return;

    setOpeningChannel(true);
    setChannelError(null);
    setChannelNotice(null);
    try {
      const result = await openLNDChannel({
        node_pubkey: channelForm.nodePubkey.trim(),
        peer_host: channelForm.peerHost.trim() || undefined,
        local_funding_amount_sat: fundingSats,
        push_sat: pushSats,
        sat_per_vbyte: feeRate,
        private: channelForm.private,
      });
      setChannelForm({ nodePubkey: '', peerHost: '', fundingSats: '', pushSats: '', feeRate: '2', private: false });
      await refreshLndWallet();
      setChannelNotice(`Channel opening submitted. Funding transaction: ${result.funding_txid || 'pending'}.`);
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : 'Failed to open the channel.');
    } finally {
      setOpeningChannel(false);
    }
  };

  const submitCloseChannel = async (channelPoint: string, force: boolean) => {
    const message = force ? 'Force-close this channel? This can be slower and more expensive.' : 'Cooperatively close this channel?';
    if (!window.confirm(message)) return;

    setClosingChannelPoint(channelPoint);
    setChannelError(null);
    setChannelNotice(null);
    try {
      const result = await closeLNDChannel({ channel_point: channelPoint, force, sat_per_vbyte: 2 });
      await refreshLndWallet();
      setChannelNotice(`Channel close submitted. Closing transaction: ${result.closing_txid || 'pending'}.`);
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : 'Failed to close the channel.');
    } finally {
      setClosingChannelPoint(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-0.5 flex flex-col gap-4">
      <section aria-labelledby="liquidity-state-heading">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
          <div>
            <h3 id="liquidity-state-heading" className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Liquidity State</h3>
            <p className="text-[0.7rem] text-muted mt-0.5">Current collateral compared with the intended allocation.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {liquidityUpdatedAt && <span className="text-[0.6rem] text-muted">Updated {liquidityUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            <button type="button" onClick={() => setLiquidityRefresh(current => current + 1)} disabled={liquidityLoading} className="rounded-md border border-border px-2 py-0.5 text-[0.62rem] text-muted hover:bg-bg disabled:opacity-60">{liquidityLoading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-1.5" role="list" aria-label="Liquidity state">
          <div role="listitem" className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md border border-border bg-bg/25 px-2.5 py-2">
            <div className="min-w-0"><div className="text-[0.75rem] font-medium text-text">CEX Spot & Hedge</div><div className="text-[0.65rem] text-muted mt-0.5">Available spot inventory and active hedge exposure</div></div>
            <div className="min-w-32"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Current</div>{liquidityLoading && cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">Loading…</span> : cexLiquidityError && cexLiquidity.length === 0 ? <span className="text-red text-[0.7rem]">Unavailable</span> : cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">No connected CEX</span> : <div className="text-[0.68rem] leading-5"><div className="mono-nums text-text">{formatBTC(totalCexSpotBTC)} spot</div><div className="text-muted">{totalHedgeCount} hedge{totalHedgeCount === 1 ? '' : 's'} · {formatBTC(totalHedgeExposureBTC)} exposure</div>{totalFiat.length > 0 && <div className="text-muted">{totalFiat.map(([asset, amount]) => `${asset} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' · ')}</div>}{cexLiquidityError && <div className="text-peach">Refresh failed; showing last value</div>}</div>}</div>
            <div className="min-w-19 border-l border-border pl-3"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Target</div><TargetCell /></div>
            {cexLiquidity.length > 0 && <div className="col-span-3 mt-1 border-t border-border/60 pt-1 text-[0.62rem] text-muted">{cexLiquidity.map(source => <span key={source.accountID} className="mr-2 inline-block">{source.provider}: {source.spotBTC === null ? 'unavailable' : `${formatBTC(source.spotBTC)} spot`} · {source.activeHedgeCount} hedge{source.activeHedgeCount === 1 ? '' : 's'}{source.error ? ` · ${source.error}` : ''}</span>)}</div>}
          </div>

          <div role="listitem" className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md border border-border bg-bg/25 px-2.5 py-2">
            <div className="min-w-0"><div className="text-[0.75rem] font-medium text-text">LND Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">On-chain BTC held by the LND wallet</div></div>
            <div className="min-w-32"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Current</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <div className="text-[0.68rem] leading-5"><div className="mono-nums text-text">{formatBTC(lndOnChainSats / 1e8)}</div><div className="text-muted">{lndAddresses.length} on-chain address{lndAddresses.length === 1 ? '' : 'es'}</div>{lndLiquidityError && <div className="text-peach">Refresh failed; showing last value</div>}</div>}</div>
            <div className="min-w-19 border-l border-border pl-3"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Target</div><TargetCell /></div>
          </div>

          <div role="listitem" className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md border border-border bg-bg/25 px-2.5 py-2">
            <div className="min-w-0"><div className="text-[0.75rem] font-medium text-text">Lightning Channel Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">Outbound and inbound liquidity across LND channels</div></div>
            <div className="min-w-32"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Current</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <div className="text-[0.68rem] leading-5"><div className="mono-nums text-text">{formatBTC(lightningLocalSats / 1e8)} outbound</div><div className="mono-nums text-text">{formatBTC(lightningRemoteSats / 1e8)} inbound</div><div className="text-muted">{channels.length} channel{channels.length === 1 ? '' : 's'} · {activeChannelCount} active</div>{lndLiquidityError && <div className="text-peach">Refresh failed; showing last value</div>}</div>}</div>
            <div className="min-w-19 border-l border-border pl-3"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Target</div><TargetCell /></div>
          </div>

          <div role="listitem" className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-md border border-border bg-bg/25 px-2.5 py-2">
            <div className="min-w-0"><div className="text-[0.75rem] font-medium text-text">DEX Wallet / Pending Contracts</div><div className="text-[0.65rem] text-muted mt-0.5">Bisq wallet and active order collateral</div></div>
            <div className="min-w-19"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Current</div><UnavailableCell /></div>
            <div className="min-w-19 border-l border-border pl-3"><div className="text-[0.58rem] uppercase tracking-wider text-muted mb-0.5">Target</div><TargetCell /></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="liquidity-management-heading" className="border-t border-border pt-3">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id="liquidity-management-heading" className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Liquidity Management</h3>
          <p className="text-[0.65rem] text-muted">Pool transfers and Lightning channels</p>
        </div>

        <div className="grid grid-cols-2 gap-1 mb-2" role="tablist" aria-label="Liquidity management panel">
          <button type="button" role="tab" aria-selected={activeManagementPanel === 'pool'} onClick={() => setActiveManagementPanel('pool')} className={`rounded-md border px-2 py-1.5 text-left text-[0.72rem] font-semibold transition-colors ${activeManagementPanel === 'pool' ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted hover:bg-bg'}`}>Pool transfer</button>
          <button type="button" role="tab" aria-selected={activeManagementPanel === 'channels'} onClick={() => setActiveManagementPanel('channels')} className={`rounded-md border px-2 py-1.5 text-left text-[0.72rem] font-semibold transition-colors ${activeManagementPanel === 'channels' ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted hover:bg-bg'}`}>Lightning channels <span className="ml-1 font-normal opacity-70">{channels.length}</span></button>
        </div>

        {activeManagementPanel === 'pool' && (
        <section aria-labelledby="pool-transfer-heading" className="rounded-lg border border-border bg-bg/20 p-2.5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 id="pool-transfer-heading" className="text-[0.7rem] font-semibold text-text">Pool transfer</h4>
            <span className="text-[0.6rem] text-muted">BTC on-chain</span>
          </div>
          <div className="grid grid-cols-2 gap-1 mb-2" role="tablist" aria-label="Pool transfer direction">
          <button type="button" role="tab" aria-selected={action === 'fill'} onClick={() => selectAction('fill')} className={`rounded-md border px-2 py-1.5 text-left transition-colors ${action === 'fill' ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted hover:bg-bg'}`}>
            <span className="block text-[0.72rem] font-semibold">Fill LND pool</span>
            <span className="block text-[0.62rem] mt-0.5 opacity-80">CEX BTC wallet → LND wallet</span>
          </button>
          <button type="button" role="tab" aria-selected={action === 'drain'} onClick={() => selectAction('drain')} className={`rounded-md border px-2 py-1.5 text-left transition-colors ${action === 'drain' ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted hover:bg-bg'}`}>
            <span className="block text-[0.72rem] font-semibold">Drain LND pool</span>
            <span className="block text-[0.62rem] mt-0.5 opacity-80">LND wallet → CEX BTC wallet</span>
          </button>
          </div>

        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" noValidate>
          <fieldset className="sm:col-span-2 border-0 p-0 m-0">
            <legend className="text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Transfer route</legend>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" aria-pressed={transferRoute === 'exchange'} onClick={() => selectRoute('exchange')} className={`rounded-md border px-2 py-1.5 text-[0.72rem] font-medium ${transferRoute === 'exchange' ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted hover:bg-bg'}`}>Connected exchange</button>
              <button type="button" aria-pressed={transferRoute === 'manual'} onClick={() => selectRoute('manual')} className={`rounded-md border px-2 py-1.5 text-[0.72rem] font-medium ${transferRoute === 'manual' ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted hover:bg-bg'}`}>Manual address</button>
            </div>
          </fieldset>

          {transferRoute === 'exchange' ? (
            <label className="block">
              <span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Connected exchange</span>
              <select
                value={selectedExchangeID}
                onChange={event => { setSelectedExchangeID(event.target.value); setFeedback(null); }}
                disabled={loadingAccounts || connectedExchanges.length === 0}
                className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent disabled:opacity-60"
              >
                {loadingAccounts && <option>Loading connections…</option>}
                {!loadingAccounts && connectedExchanges.length === 0 && <option>No connected exchange available</option>}
                {connectedExchanges.map(account => <option key={account.id} value={account.id}>{account.provider}</option>)}
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">{action === 'fill' ? 'Source BTC address' : 'Destination BTC address'}</span>
              <input type="text" value={manualAddress} onChange={event => { setManualAddress(event.target.value); setFeedback(null); }} placeholder="Paste a Bitcoin address" className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" />
            </label>
          )}

          <label className="block">
            <span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Amount (BTC)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={amount}
              onChange={event => { setAmount(event.target.value); setFeedback(null); }}
              placeholder="0.00000000"
              className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent"
            />
          </label>

          <div className="sm:col-span-2 rounded-md border border-border bg-surface/50 px-2 py-1.5 text-[0.7rem]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center">
              <div className="min-w-0"><span className="block text-[0.58rem] uppercase tracking-wider text-muted">From</span><span className="block truncate text-text mt-0.5">{sourceLabel}</span></div>
              <span className="text-accent text-base" aria-hidden>→</span>
              <div className="min-w-0"><span className="block text-[0.58rem] uppercase tracking-wider text-muted">To</span><span className="block truncate text-text mt-0.5">{destinationLabel}</span></div>
            </div>
          </div>

          {!(transferRoute === 'manual' && action === 'drain') && (
            <label className="block sm:col-span-2">
              <span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Destination BTC address</span>
              <select value={selectedDestination} onChange={event => { setSelectedDestination(event.target.value); setFeedback(null); }} disabled={loadingDestination || destinationOptions.length === 0} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent disabled:opacity-60">
                {loadingDestination && <option>Loading BTC addresses…</option>}
                {!loadingDestination && destinationOptions.length === 0 && <option>No BTC destination address available</option>}
                {destinationOptions.map(option => <option key={option.address} value={option.address}>{option.label} · {option.network} · {shortAddress(option.address)}</option>)}
              </select>
            </label>
          )}

          <div className="sm:col-span-2 flex flex-wrap items-center gap-2 pt-0.5">
            <button type="submit" className="rounded-md border border-accent bg-accent/10 px-2.5 py-1 text-[0.72rem] font-semibold text-accent hover:bg-accent/20">
              Create transfer request
            </button>
            <span className="text-[0.63rem] text-muted">Execution waits for a dedicated wallet-transfer API.</span>
          </div>
          {loadError && <p className="sm:col-span-2 rounded-md border border-red/40 bg-error px-2 py-1.5 text-[0.72rem] text-red" role="alert">{loadError}</p>}
          {feedback && (
            <p className="sm:col-span-2 rounded-md border border-peach/40 bg-peach/10 px-2 py-1.5 text-[0.72rem] text-peach" role="status">{feedback}</p>
          )}
        </form>
        </section>
        )}

        {activeManagementPanel === 'channels' && (
        <section aria-labelledby="lightning-management-heading" className="rounded-lg border border-border bg-bg/20 p-2.5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 id="lightning-management-heading" className="text-[0.7rem] font-semibold text-text">Lightning channels</h4>
            <span className="text-[0.6rem] text-muted">{channels.length} open</span>
          </div>

          <details className="group rounded-md border border-border bg-surface/40 mb-2">
            <summary className="cursor-pointer list-none px-2 py-1.5 text-[0.72rem] font-medium text-text flex items-center justify-between">Open a new channel <span className="text-muted transition-transform group-open:rotate-180">⌄</span></summary>
          <form onSubmit={event => void submitOpenChannel(event)} className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 border-t border-border px-2 pb-2 pt-1.5" noValidate>
            <label className="block"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Node pubkey</span><input value={channelForm.nodePubkey} onChange={event => setChannelForm(current => ({ ...current, nodePubkey: event.target.value }))} placeholder="Remote node public key" className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" /></label>
            <label className="block"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Peer host <span className="normal-case tracking-normal">(optional)</span></span><input value={channelForm.peerHost} onChange={event => setChannelForm(current => ({ ...current, peerHost: event.target.value }))} placeholder="node.example:9735" className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" /></label>
            <label className="block"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Local funding (sats)</span><input type="number" min="1" step="1" value={channelForm.fundingSats} onChange={event => setChannelForm(current => ({ ...current, fundingSats: event.target.value }))} placeholder="1000000" className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Push sats</span><input type="number" min="0" step="1" value={channelForm.pushSats} onChange={event => setChannelForm(current => ({ ...current, pushSats: event.target.value }))} placeholder="0" className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" /></label>
              <label className="block"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Fee (sat/vB)</span><input type="number" min="1" step="1" value={channelForm.feeRate} onChange={event => setChannelForm(current => ({ ...current, feeRate: event.target.value }))} className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" /></label>
            </div>
            <label className="sm:col-span-2 flex items-center gap-2 text-[0.72rem] text-muted"><input type="checkbox" checked={channelForm.private} onChange={event => setChannelForm(current => ({ ...current, private: event.target.checked }))} /> Private channel</label>
            <div className="sm:col-span-2 flex items-center gap-2"><button type="submit" disabled={openingChannel} className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-[0.75rem] font-semibold text-accent hover:bg-accent/20 disabled:opacity-60">{openingChannel ? 'Opening channel…' : 'Open channel'}</button><span className="text-[0.63rem] text-muted">A confirmation is required before LND receives the request.</span></div>
          </form>
          </details>

          {channelError && <p className="mt-2 rounded-md border border-red/40 bg-error px-2 py-1.5 text-[0.72rem] text-red" role="alert">{channelError}</p>}
          {channelNotice && <p className="mt-2 rounded-md border border-green/40 bg-green/8 px-2 py-1.5 text-[0.72rem] text-green" role="status">{channelNotice}</p>}

          <div className="grid gap-1">
            {channels.length === 0 ? <p className="px-0.5 text-[0.7rem] text-muted">No open channels reported by LND.</p> : channels.map(channel => (
              <div key={channel.channel_point} className="rounded-md border border-border bg-surface/40 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[0.75rem] font-medium text-text">{channel.remote_alias || shortAddress(channel.remote_pubkey)}</span><span className={`rounded-full border px-1.5 py-0.5 text-[0.6rem] ${channel.active ? 'border-green/40 text-green' : 'border-red/40 text-red'}`}>{channel.active ? 'Active' : 'Inactive'}</span>{channel.private && <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.6rem] text-muted">Private</span>}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1.5 text-[0.68rem] text-muted"><span>Capacity <b className="font-medium text-text">{formatSats(channel.capacity_sat)}</b></span><span>Local <b className="font-medium text-text">{formatSats(channel.local_balance_sat)}</b></span><span>Remote <b className="font-medium text-text">{formatSats(channel.remote_balance_sat)}</b></span><span className="truncate" title={channel.channel_point}>ID {shortAddress(channel.channel_point)}</span></div>
                <div className="flex flex-wrap gap-1 mt-1.5"><button type="button" disabled={closingChannelPoint === channel.channel_point} onClick={() => void submitCloseChannel(channel.channel_point, false)} className="rounded border border-border px-2 py-0.5 text-[0.65rem] text-text hover:bg-surface disabled:opacity-60">{closingChannelPoint === channel.channel_point ? 'Closing…' : 'Close'}</button><button type="button" disabled={closingChannelPoint === channel.channel_point} onClick={() => void submitCloseChannel(channel.channel_point, true)} className="rounded border border-red/40 px-2 py-0.5 text-[0.65rem] text-red hover:bg-error disabled:opacity-60">Force close</button></div>
              </div>
            ))}
          </div>
        </section>
        )}
      </section>
    </div>
  );
}
