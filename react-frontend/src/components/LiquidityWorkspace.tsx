import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { closeLNDChannel, fetchCexBalances, fetchCexDepositAddresses, fetchCexHedgePositions, fetchLNDWalletStatus, fetchTradingAccounts, fetchTransactionalLiquiditySettings, openLNDChannel, updateTransactionalLiquiditySettings } from '../utils/api';
import type { CexAssetBalance, CexDepositAddress, LNDWalletStatus, TradeMode, TradingAccount, TransactionalLiquidityAmountSource, TransactionalLiquiditySettings, TransactionalLiquidityTargetDirection } from '../types';
import { useFilters } from '../hooks/useFilters';
import { usePreferences } from '../hooks/usePreferences';

type PoolAction = 'fill' | 'drain';
type TransferRoute = 'exchange' | 'manual';

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

function TargetCell({ value, detail, unavailable = false }: { value?: string; detail?: string; unavailable?: boolean }) {
  if (unavailable) return <span className="text-muted font-mono text-[0.7rem]">Not required</span>;
  if (!value) return <span className="text-muted font-mono text-[0.7rem]">Not configured</span>;
  return <span className="font-mono text-[0.7rem] text-text">{value}{detail && <span className="block text-muted font-sans text-[0.58rem]">{detail}</span>}</span>;
}

const FIAT_OPTIONS = ['EUR', 'USD', 'GBP', 'AUD', 'CHF', 'SEK', 'NOK', 'CAD'];
const TRADE_MODE_OPTIONS: Array<{ value: TradeMode; label: string }> = [
  { value: 'hedgefull_single_collateral', label: 'Hedgefull · single collateral' },
  { value: 'hedgeless_double_collateral', label: 'Hedgeless · double collateral' },
];

function formatFiat(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatFiatValue(value: number, currency: string) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
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
  const { filters, refPrice } = useFilters();
  const { maxFiatLimit } = usePreferences();
  const [action, setAction] = useState<PoolAction>('fill');
  const [poolExpanded, setPoolExpanded] = useState(false);
  const [channelsExpanded, setChannelsExpanded] = useState(false);
  const [transferRoute, setTransferRoute] = useState<TransferRoute>('exchange');
  const [amount, setAmount] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [lndWallet, setLndWallet] = useState<LNDWalletStatus | null>(null);
  const [cexLiquidity, setCexLiquidity] = useState<CexLiquiditySource[]>([]);
  const [liquidityLoading, setLiquidityLoading] = useState(true);
  const [cexLiquidityError, setCexLiquidityError] = useState<string | null>(null);
  const [lndLiquidityError, setLndLiquidityError] = useState<string | null>(null);
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
  const [transactionalSettings, setTransactionalSettings] = useState<TransactionalLiquiditySettings | null>(null);
  const [transactionalForm, setTransactionalForm] = useState({ fiat_currency: 'EUR', amount_source: 'custom' as TransactionalLiquidityAmountSource, custom_amount: '', trade_mode: 'hedgefull_single_collateral' as TradeMode, target_direction: 'bid' as TransactionalLiquidityTargetDirection });
  const [transactionalLoading, setTransactionalLoading] = useState(true);
  const [transactionalEditing, setTransactionalEditing] = useState(false);
  const [transactionalSaving, setTransactionalSaving] = useState(false);
  const [transactionalNotice, setTransactionalNotice] = useState<string | null>(null);
  const [transactionalError, setTransactionalError] = useState<string | null>(null);

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

  const transactionalAmount = transactionalSettings?.amount_source === 'capped_volume'
    ? (transactionalSettings.fiat_currency === filters.fiat ? maxFiatLimit : null)
    : transactionalSettings?.custom_amount ?? null;
  const btcTarget = transactionalAmount != null && refPrice != null && transactionalSettings?.fiat_currency === filters.fiat && refPrice > 0
    ? transactionalAmount / refPrice
    : null;
  const targetFiat = transactionalSettings && transactionalAmount != null
    ? formatFiat(transactionalAmount, transactionalSettings.fiat_currency)
    : undefined;
  const targetBTC = btcTarget != null ? formatBTC(btcTarget) : undefined;
  const lndTargetBTC = transactionalSettings?.trade_mode === 'hedgefull_single_collateral' ? formatBTC(0) : targetBTC;
  const lndTargetDetail = transactionalSettings?.trade_mode === 'hedgefull_single_collateral'
    ? 'no LND pool required'
    : 'fiat target in BTC';

  useEffect(() => {
    let active = true;
    void fetchTransactionalLiquiditySettings()
      .then(settings => {
        if (!active) return;
        setTransactionalSettings(settings);
        setTransactionalForm({
          fiat_currency: settings.fiat_currency,
          amount_source: settings.amount_source,
          custom_amount: settings.custom_amount == null ? '' : String(settings.custom_amount),
          trade_mode: settings.trade_mode,
          target_direction: settings.target_direction ?? 'bid',
        });
      })
      .catch(error => { if (active) { setTransactionalError(error instanceof Error ? error.message : 'Could not load transactional liquidity settings.'); setTransactionalEditing(true); } })
      .finally(() => { if (active) setTransactionalLoading(false); });
    return () => { active = false; };
  }, []);

  const saveTransactionalSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = transactionalForm.amount_source === 'custom' ? Number(transactionalForm.custom_amount) : maxFiatLimit;
    if (amount == null || !Number.isFinite(amount) || amount <= 0 || (transactionalForm.amount_source === 'capped_volume' && filters.fiat !== transactionalForm.fiat_currency)) {
      setTransactionalError(transactionalForm.amount_source === 'custom' ? 'Enter a custom amount greater than zero.' : 'Set a positive capped volume before adopting it.');
      setTransactionalNotice(null);
      return;
    }
    setTransactionalSaving(true);
    setTransactionalError(null);
    setTransactionalNotice(null);
    try {
      const updated = await updateTransactionalLiquiditySettings({
        fiat_currency: transactionalForm.fiat_currency,
        amount_source: transactionalForm.amount_source,
        custom_amount: transactionalForm.amount_source === 'custom' ? amount : null,
        trade_mode: transactionalForm.trade_mode,
        target_direction: transactionalForm.target_direction,
      });
      setTransactionalSettings(updated);
      setTransactionalForm(current => ({ ...current, custom_amount: updated.custom_amount == null ? '' : String(updated.custom_amount), target_direction: updated.target_direction ?? 'bid' }));
      setTransactionalNotice('Transactional liquidity targets saved.');
      setTransactionalEditing(false);
    } catch (error) {
      setTransactionalError(error instanceof Error ? error.message : 'Could not save transactional liquidity settings.');
    } finally {
      setTransactionalSaving(false);
    }
  };

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
      setLiquidityLoading(false);
      setLoadingAccounts(false);
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

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
    <div className="liquidity-workspace h-full min-h-0 overflow-y-auto pr-0.5 flex flex-col gap-3">
      <section aria-labelledby="liquidity-state-heading" className="liquidity-overview">
        <div className="liquidity-overview__header flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="liquidity-section-kicker">Live overview</div>
            <h3 id="liquidity-state-heading" className="liquidity-overview__title">Liquidity allocation</h3>
          </div>
        </div>

        <div className="liquidity-allocation-board" role="list" aria-label="Liquidity state">
          <div role="listitem" className="liquidity-allocation-card liquidity-allocation-card--cex">
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">01</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">CEX Spot & Hedge</div><div className="text-[0.65rem] text-muted mt-0.5">Exchange inventory</div></div></div>
            <div className="liquidity-allocation-card__figures"><div className="liquidity-allocation-card__current"><div className="liquidity-value-label">Current</div>{liquidityLoading && cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">Loading…</span> : cexLiquidityError && cexLiquidity.length === 0 ? <span className="text-red text-[0.7rem]">Unavailable</span> : cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">No connected CEX</span> : <div className="text-[0.68rem] leading-5"><div className="mono-nums text-text">{formatBTC(totalCexSpotBTC)} spot</div><div className="text-muted">{totalHedgeCount} hedge{totalHedgeCount === 1 ? '' : 's'} · {formatBTC(totalHedgeExposureBTC)} exposure</div>{totalFiat.length > 0 && <div className="text-muted">{totalFiat.map(([asset, amount]) => `${asset} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' · ')}</div>}{cexLiquidityError && <div className="text-peach">Refresh failed; showing last value</div>}</div>}</div><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={targetFiat} detail={transactionalSettings ? transactionalSettings.trade_mode === 'hedgeless_double_collateral' ? 'exchange fiat' : 'exchange + hedge capital' : undefined} /></div></div>
            {cexLiquidity.length > 0 && <div className="liquidity-allocation-card__sources">{cexLiquidity.map(source => <span key={source.accountID}>{source.provider}: {source.spotBTC === null ? 'unavailable' : `${formatBTC(source.spotBTC)} spot`} · {source.activeHedgeCount} hedge{source.activeHedgeCount === 1 ? '' : 's'}{source.error ? ` · ${source.error}` : ''}</span>)}</div>}
          </div>

          <div role="listitem" className="liquidity-allocation-card liquidity-allocation-card--lnd">
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">02</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">LND Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">On-chain wallet reserve</div></div></div>
            <div className="liquidity-allocation-card__figures"><div className="liquidity-allocation-card__current"><div className="liquidity-value-label">Current</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <div className="text-[0.68rem] leading-5"><div className="mono-nums text-text">{formatBTC(lndOnChainSats / 1e8)}</div><div className="text-muted">{lndAddresses.length} on-chain address{lndAddresses.length === 1 ? '' : 'es'}</div>{lndLiquidityError && <div className="text-peach">Refresh failed; showing last value</div>}</div>}</div><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={lndTargetBTC} detail={lndTargetDetail} /></div></div>
          </div>

          <div role="listitem" className="liquidity-allocation-card liquidity-allocation-card--lightning">
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">03</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">Lightning Channel Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">Ready-to-route capacity</div></div></div>
            <div className="liquidity-allocation-card__figures"><div className="liquidity-allocation-card__current"><div className="liquidity-value-label">Current</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <div className="text-[0.68rem] leading-5"><div className="mono-nums text-text">{formatBTC(lightningLocalSats / 1e8)} outbound</div><div className="mono-nums text-text">{formatBTC(lightningRemoteSats / 1e8)} inbound</div><div className="text-muted">{channels.length} channel{channels.length === 1 ? '' : 's'} · {activeChannelCount} active</div>{lndLiquidityError && <div className="text-peach">Refresh failed; showing last value</div>}</div>}</div><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={lndTargetBTC} detail={lndTargetDetail} /></div></div>
          </div>

          <div role="listitem" className="liquidity-allocation-card liquidity-allocation-card--dex">
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">04</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">DEX Wallet / Pending Contracts</div><div className="text-[0.65rem] text-muted mt-0.5">Settlement collateral</div></div></div>
            <div className="liquidity-allocation-card__figures"><div className="liquidity-allocation-card__current"><div className="liquidity-value-label">Current</div><UnavailableCell /></div><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell unavailable /></div></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="liquidity-management-heading" className="liquidity-management">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id="liquidity-management-heading" className="liquidity-section-kicker">Management</h3>
        </div>

        <section aria-labelledby="transactional-liquidity-heading" className="liquidity-settings-card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <h4 id="transactional-liquidity-heading" className="text-[0.7rem] font-semibold text-text">Transactional liquidity target</h4>
              <p className="text-[0.62rem] text-muted mt-0.5">One fiat target translated into the required liquidity brackets.</p>
            </div>
            {transactionalLoading && <span className="text-[0.6rem] text-muted">Loading…</span>}
          </div>
          {!transactionalLoading && transactionalSettings && !transactionalEditing ? (
            <div className="liquidity-target-summary">
              <div><span>Target</span><strong>{transactionalAmount != null ? formatFiatValue(transactionalAmount, transactionalSettings.fiat_currency) : 'Not configured'}</strong></div>
              <div><span>Source</span><strong>{transactionalSettings.amount_source === 'custom' ? 'Custom amount' : 'Capped volume'}</strong></div>
              <div><span>Mode</span><strong>{transactionalSettings.trade_mode === 'hedgeless_double_collateral' ? 'Hedgeless' : 'Hedgefull'}</strong></div>
              <div><span>Direction</span><strong className="capitalize">{transactionalSettings.target_direction ?? 'bid'}</strong></div>
              <button type="button" onClick={() => { setTransactionalEditing(true); setTransactionalNotice(null); }}>Edit</button>
            </div>
          ) : <form onSubmit={saveTransactionalSettings} className="liquidity-target-form" noValidate>
            <label className="block">
              <span className="block text-[0.62rem] uppercase tracking-wider font-medium text-muted mb-1">Preferred fiat</span>
              <select value={transactionalForm.fiat_currency} onChange={event => setTransactionalForm(current => ({ ...current, fiat_currency: event.target.value }))} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent">
                {FIAT_OPTIONS.map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[0.62rem] uppercase tracking-wider font-medium text-muted mb-1">Trade mode</span>
              <select value={transactionalForm.trade_mode} onChange={event => setTransactionalForm(current => ({ ...current, trade_mode: event.target.value as TradeMode }))} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent">
                {TRADE_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[0.62rem] uppercase tracking-wider font-medium text-muted mb-1">Target direction</span>
              <select value={transactionalForm.target_direction} onChange={event => setTransactionalForm(current => ({ ...current, target_direction: event.target.value as TransactionalLiquidityTargetDirection }))} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent">
                <option value="bid">Bid</option>
                <option value="ask">Ask</option>
              </select>
            </label>
            <div className="liquidity-target-amount">
              <span className="block text-[0.62rem] uppercase tracking-wider font-medium text-muted mb-1">Target amount</span>
              <div className="liquidity-target-amount__controls">
                <select aria-label="Amount source" value={transactionalForm.amount_source} onChange={event => setTransactionalForm(current => ({ ...current, amount_source: event.target.value as TransactionalLiquidityAmountSource }))} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent">
                  <option value="custom">Custom amount</option>
                  <option value="capped_volume">Capped volume</option>
                </select>
                {transactionalForm.amount_source === 'custom' ? (
                  <label className="block">
                    <span className="sr-only">Transactional liquidity ({transactionalForm.fiat_currency})</span>
                    <input type="number" min={0} step={50} value={transactionalForm.custom_amount} onChange={event => setTransactionalForm(current => ({ ...current, custom_amount: event.target.value }))} placeholder={`Amount in ${transactionalForm.fiat_currency}`} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent mono-nums" />
                  </label>
                ) : (
                  <div className="liquidity-target-capped rounded-md border border-border/60 bg-bg/30 px-2 py-1.5 text-[0.68rem] text-muted">Capped: <span className="text-text mono-nums">{maxFiatLimit != null && maxFiatLimit > 0 ? formatFiat(maxFiatLimit, filters.fiat) : 'not configured'}</span></div>
                )}
              </div>
              {transactionalForm.amount_source === 'capped_volume' && filters.fiat !== transactionalForm.fiat_currency && <span className="sr-only">Select {transactionalForm.fiat_currency} in the market filter to match the live capped volume.</span>}
            </div>
            <div className="liquidity-target-save">
              <button type="submit" disabled={transactionalSaving || transactionalLoading} className="rounded-md border border-accent bg-accent/10 px-2.5 py-1.5 text-[0.7rem] font-semibold text-text hover:bg-accent/20 disabled:opacity-60">{transactionalSaving ? 'Saving…' : 'Save target'}</button>
            </div>
            {(transactionalNotice || transactionalError) && <div className="liquidity-target-feedback text-[0.62rem]" aria-live="polite">{transactionalNotice && <span className="text-green">{transactionalNotice}</span>}{transactionalError && <span className="text-red">{transactionalError}</span>}</div>}
          </form>}
          {(transactionalNotice || transactionalError) && !transactionalEditing && <div className="liquidity-target-feedback text-[0.62rem] mt-2" aria-live="polite">{transactionalNotice && <span className="text-green">{transactionalNotice}</span>}{transactionalError && <span className="text-red">{transactionalError}</span>}</div>}
        </section>

        <section aria-labelledby="pool-transfer-heading" className="liquidity-action-card">
          <div className="pool-transfer__intro">
            <div>
              <span className="liquidity-section-kicker">On-chain BTC</span>
              <h4 id="pool-transfer-heading" className="pool-transfer__title">Move funds</h4>
              <p className="pool-transfer__description">Rebalance the LND wallet without leaving the liquidity workspace.</p>
            </div>
            <div className="pool-transfer__intro-actions"><div className="pool-transfer__balance"><span>Available in LND</span><strong>{formatSats(lndOnChainSats)}</strong></div><button type="button" aria-expanded={poolExpanded} aria-controls="wallet-pool-controls" onClick={() => setPoolExpanded(current => !current)}>{poolExpanded ? 'Hide controls' : 'Manage wallet pool'}</button></div>
          </div>

          {poolExpanded && <form id="wallet-pool-controls" onSubmit={submit} className="pool-transfer__form" noValidate>
            <fieldset className="pool-transfer__step pool-transfer__step--direction">
              <legend>1. Choose movement</legend>
              <div className="pool-transfer__directions" role="group" aria-label="Pool transfer direction">
                <button type="button" aria-pressed={action === 'fill'} onClick={() => selectAction('fill')} className={action === 'fill' ? 'pool-transfer__direction--active' : ''}>Fill LND pool <span>into LND</span></button>
                <button type="button" aria-pressed={action === 'drain'} onClick={() => selectAction('drain')} className={action === 'drain' ? 'pool-transfer__direction--active' : ''}>Drain LND pool <span>out of LND</span></button>
              </div>
            </fieldset>

            <div className="pool-transfer__details">
              <div className="pool-transfer__step">
                <span className="pool-transfer__step-label">2. {action === 'fill' ? 'Fund from' : 'Send to'}</span>
                <div className="pool-transfer__route-choice" role="group" aria-label="Transfer route">
                  <button type="button" aria-pressed={transferRoute === 'exchange'} onClick={() => selectRoute('exchange')} className={transferRoute === 'exchange' ? 'is-selected' : ''}>Connected exchange</button>
                  <button type="button" aria-pressed={transferRoute === 'manual'} onClick={() => selectRoute('manual')} className={transferRoute === 'manual' ? 'is-selected' : ''}>Manual address</button>
                </div>
                {transferRoute === 'exchange' ? (
                  <label className="block">
                    <span className="pool-transfer__field-label">Exchange account</span>
                    <select value={selectedExchangeID} onChange={event => { setSelectedExchangeID(event.target.value); setFeedback(null); }} disabled={loadingAccounts || connectedExchanges.length === 0} className="pool-transfer__input">
                      {loadingAccounts && <option>Loading connections…</option>}
                      {!loadingAccounts && connectedExchanges.length === 0 && <option>No connected exchange available</option>}
                      {connectedExchanges.map(account => <option key={account.id} value={account.id}>{account.provider}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="block">
                    <span className="pool-transfer__field-label">{action === 'fill' ? 'Source BTC address' : 'Destination BTC address'}</span>
                    <input type="text" value={manualAddress} onChange={event => { setManualAddress(event.target.value); setFeedback(null); }} placeholder="Paste a Bitcoin address" className="pool-transfer__input" />
                  </label>
                )}
              </div>

              <div className="pool-transfer__step">
                <label className="block">
                  <span className="pool-transfer__step-label">3. Amount to move</span>
                  <div className="pool-transfer__amount-field"><input type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={event => { setAmount(event.target.value); setFeedback(null); }} placeholder="0.00000000" className="pool-transfer__input mono-nums" /><span>BTC</span></div>
                </label>
                {!(transferRoute === 'manual' && action === 'drain') && (
                  <label className="block pool-transfer__destination">
                    <span className="pool-transfer__field-label">Destination BTC address</span>
                    <select value={selectedDestination} onChange={event => { setSelectedDestination(event.target.value); setFeedback(null); }} disabled={loadingDestination || destinationOptions.length === 0} className="pool-transfer__input">
                      {loadingDestination && <option>Loading BTC addresses…</option>}
                      {!loadingDestination && destinationOptions.length === 0 && <option>No BTC destination address available</option>}
                      {destinationOptions.map(option => <option key={option.address} value={option.address}>{option.label} · {option.network} · {shortAddress(option.address)}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>

            <div className="pool-transfer__review">
              <div className="pool-transfer__route"><div><span>From</span><strong>{sourceLabel}</strong></div><i aria-hidden>→</i><div><span>To</span><strong>{destinationLabel}</strong></div></div>
              <div className="pool-transfer__submit"><p>Review creates a request only; transfers are not sent yet.</p><button type="submit">Create transfer request</button></div>
            </div>
          {loadError && <p className="sm:col-span-2 rounded-md border border-red/40 bg-error px-2 py-1.5 text-[0.72rem] text-red" role="alert">{loadError}</p>}
          {feedback && (
            <p className="sm:col-span-2 rounded-md border border-peach/40 bg-peach/10 px-2 py-1.5 text-[0.72rem] text-peach" role="status">{feedback}</p>
          )}
          </form>}
        </section>

        <section aria-labelledby="lightning-management-heading" className="liquidity-action-card">
          <div className="liquidity-channel-disclosure">
            <div><h4 id="lightning-management-heading">Lightning channels <span>{channels.length} open</span></h4><p>Open, inspect, or close channel capacity.</p></div>
            <button type="button" aria-expanded={channelsExpanded} aria-controls="lightning-channel-controls" onClick={() => setChannelsExpanded(current => !current)}>{channelsExpanded ? 'Hide controls' : 'Manage channels'}</button>
          </div>

          {channelsExpanded && <div id="lightning-channel-controls" className="liquidity-channel-controls">
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
          </div>}
        </section>
      </section>
    </div>
  );
}
