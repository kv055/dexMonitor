import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { closeLNDChannel, fetchCexBalances, fetchCexDepositAddresses, fetchCexHedgePositions, fetchDexPendingLiquidity, fetchLNDChannelPresets, fetchLNDWalletStatus, fetchLSPChannel, fetchLSPChannelStatus, fetchSubmarineSwaps, fetchTradingAccounts, fetchTransactionalLiquiditySettings, openLNDChannel, updateLSPChannel, updateTransactionalLiquiditySettings } from '../utils/api';
import type { CexAssetBalance, CexDepositAddress, CexHedgePosition, LNDChannelPreset, LNDWalletStatus, LSPChannelConfig, LSPChannelStatus, SubmarineSwapRecord, TradeMode, TradingAccount, TransactionalLiquidityAmountSource, TransactionalLiquiditySettings, TransactionalLiquiditySource, TransactionalLiquidityTargetDirection } from '../types';
import { useFilters } from '../hooks/useFilters';
import { usePreferences } from '../hooks/usePreferences';
import { useCEXPermissions } from '../hooks/useCEXPermissions';
import { LocalQrCode } from './LocalQrCode';

type PoolAction = 'fill' | 'drain';
type TransferRoute = 'exchange' | 'manual';

type CexLiquiditySource = {
  accountID: number;
  provider: string;
  spotAssets: CexAssetBalance[];
  activeHedges: CexHedgePosition[];
  error?: string;
};

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

const emptyLSPConfig: LSPChannelConfig = {
  channel_point: '',
  remote_pubkey: '',
  provider_label: '',
  enabled: false,
  headroom_sat: 0,
  max_swap_fee_sat: 0,
  max_swap_fee_ppm: 0,
};

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

function formatAssetAmount(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

/** Renders existing, stateful controls inside their matching liquidity card. */
function CardPortal({ targetRef, children }: { targetRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(targetRef.current); }, [targetRef]);
  return target ? createPortal(children, target) : null;
}

export function LiquidityWorkspace() {
  const { filters, refPrice } = useFilters();
  const { maxFiatLimit } = usePreferences();
  const { exchanges: cexPolicies, ready: cexPoliciesReady } = useCEXPermissions();
  const [action, setAction] = useState<PoolAction>('fill');
  const [poolExpanded, setPoolExpanded] = useState(false);
  const [channelsExpanded, setChannelsExpanded] = useState(false);
  const [lightningInventoryExpanded, setLightningInventoryExpanded] = useState(false);
  const [hubInventoryExpanded, setHubInventoryExpanded] = useState(false);
  const hubOperationsRef = useRef<HTMLDivElement>(null);
  const lightningOperationsRef = useRef<HTMLDivElement>(null);
  const [transferRoute, setTransferRoute] = useState<TransferRoute>('exchange');
  const [amount, setAmount] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [lndWallet, setLndWallet] = useState<LNDWalletStatus | null>(null);
  const [cexLiquidity, setCexLiquidity] = useState<CexLiquiditySource[]>([]);
  const [cexInventoryExpanded, setCexInventoryExpanded] = useState(false);
  const [liquidityLoading, setLiquidityLoading] = useState(true);
  const [cexLiquidityError, setCexLiquidityError] = useState<string | null>(null);
  const [lndLiquidityError, setLndLiquidityError] = useState<string | null>(null);
  const [dexPendingLiquidity, setDexPendingLiquidity] = useState<{ btc_value: number; transaction_count: number } | null>(null);
  const [dexLiquidityError, setDexLiquidityError] = useState<string | null>(null);
  const [selectedExchangeID, setSelectedExchangeID] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');
  const [depositAddresses, setDepositAddresses] = useState<CexDepositAddress[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingDestination, setLoadingDestination] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState({ nodePubkey: '', peerHost: '', fundingSats: '', pushSats: '', feeRate: '2', private: false });
  const [channelPresets, setChannelPresets] = useState<LNDChannelPreset[]>([]);
  const [selectedChannelPresetID, setSelectedChannelPresetID] = useState('');
  const [channelNotice, setChannelNotice] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [openingChannel, setOpeningChannel] = useState(false);
  const [closingChannelPoint, setClosingChannelPoint] = useState<string | null>(null);
  const [lspConfig, setLspConfig] = useState<LSPChannelConfig>(emptyLSPConfig);
  const [lspStatus, setLspStatus] = useState<LSPChannelStatus | null>(null);
  const [submarineSwaps, setSubmarineSwaps] = useState<SubmarineSwapRecord[]>([]);
  const [lspLoading, setLspLoading] = useState(true);
  const [savingLsp, setSavingLsp] = useState(false);
  const [lspNotice, setLspNotice] = useState<string | null>(null);
  const [lspError, setLspError] = useState<string | null>(null);
  const [transactionalSettings, setTransactionalSettings] = useState<TransactionalLiquiditySettings | null>(null);
  const [transactionalForm, setTransactionalForm] = useState({ fiat_currency: 'EUR', amount_source: 'custom' as TransactionalLiquidityAmountSource, amount_fiat: '', trade_mode: 'hedgefull_single_collateral' as TradeMode, target_direction: 'bid' as TransactionalLiquidityTargetDirection, lightning_liquidity_source: 'own_channels' as TransactionalLiquiditySource, fee_tier: 'economic' as const, coupled_hedge: false });
  const [transactionalLoading, setTransactionalLoading] = useState(true);
  const [transactionalEditing, setTransactionalEditing] = useState(false);
  const [transactionalSaving, setTransactionalSaving] = useState(false);
  const [transactionalNotice, setTransactionalNotice] = useState<string | null>(null);
  const [transactionalError, setTransactionalError] = useState<string | null>(null);

  // The CEX policy table is authoritative: an effective spot capability means
  // the account has verified spot-trading and withdrawal permissions and the
  // operator has enabled it. Account-health alone is intentionally not used.
  const connectedExchanges = useMemo(() => {
    if (!cexPoliciesReady) return [];
    const eligibleAccountIDs = new Set(
      cexPolicies
        .filter(policy => policy.execution_supported && policy.spot.effective_enabled)
        .map(policy => policy.account_id),
    );
    return accounts.filter(account => account.category === 'CEX' && eligibleAccountIDs.has(account.id));
  }, [accounts, cexPolicies, cexPoliciesReady]);
  const lndAddresses = useMemo(() => lndWallet?.addresses.filter(address => address.kind === 'onchain') ?? [], [lndWallet]);
  const selectedExchange = connectedExchanges.find(account => String(account.id) === selectedExchangeID) ?? null;
  const channels = lndWallet?.channels ?? [];
  const selectedChannelPreset = channelPresets.find(preset => preset.id === selectedChannelPresetID);
  const lndOnChainSats = lndAddresses.reduce((sum, address) => sum + (address.balance_sat ?? 0), 0);
  const lightningCapacitySats = channels.reduce((sum, channel) => sum + channel.capacity_sat, 0);
  const activeChannelCount = channels.filter(channel => channel.active).length;
  const lspChannelPoint = lspStatus?.configured ? lspStatus.channel_point : lspConfig.channel_point;
  const lspLiquidityChannel = channels.find(channel => channel.channel_point === lspChannelPoint);
  const ownLiquidityChannels = channels.filter(channel => channel.channel_point !== lspChannelPoint);
  const totalCexFiatValue = useMemo(() => cexLiquidity.reduce((sum, source) => sum + source.spotAssets.reduce((assetSum, balance) => {
    if (balance.asset === filters.fiat) return assetSum + balance.available;
    if (balance.asset === 'BTC' && refPrice != null) return assetSum + balance.available * refPrice;
    return assetSum;
  }, 0), 0), [cexLiquidity, filters.fiat, refPrice]);
  const hasUnvaluedCexAssets = useMemo(() => cexLiquidity.some(source => source.spotAssets.some(balance => balance.asset !== filters.fiat && balance.asset !== 'BTC' && !balance.usd_value)), [cexLiquidity, filters.fiat]);
  const liquidityPanelExpanded = cexInventoryExpanded || hubInventoryExpanded || lightningInventoryExpanded;
  const destinationOptions = action === 'fill'
    ? lndAddresses.map(address => ({ address: address.address, label: address.label || 'LND on-chain address', network: 'Bitcoin' }))
    : depositAddresses.map(address => ({ address: address.address, label: 'CEX BTC deposit address', network: address.network || 'Bitcoin' }));
  const sourceLabel = action === 'fill'
    ? (transferRoute === 'exchange' ? `${selectedExchange?.provider ?? 'Selected exchange'} BTC wallet` : 'External BTC wallet')
    : 'LND on-chain wallet';
  const destinationLabel = action === 'fill'
    ? 'LND on-chain wallet'
    : (transferRoute === 'exchange' ? `${selectedExchange?.provider ?? 'Selected exchange'} BTC wallet` : 'External BTC address');

  const transactionalAmount = transactionalSettings?.amount_fiat ?? null;
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
          amount_fiat: settings.amount_fiat == null ? '' : String(settings.amount_fiat),
          trade_mode: settings.trade_mode,
          target_direction: settings.target_direction ?? 'bid',
          lightning_liquidity_source: settings.lightning_liquidity_source ?? 'own_channels',
          fee_tier: settings.fee_tier ?? 'economic',
          coupled_hedge: settings.coupled_hedge ?? false,
        });
      })
      .catch(error => { if (active) { setTransactionalError(error instanceof Error ? error.message : 'Could not load transactional liquidity settings.'); setTransactionalEditing(true); } })
      .finally(() => { if (active) setTransactionalLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [configResult, statusResult, swapsResult] = await Promise.allSettled([
        fetchLSPChannel(),
        fetchLSPChannelStatus(),
        fetchSubmarineSwaps(),
      ]);
      if (!active) return;

      if (configResult.status === 'fulfilled') setLspConfig(configResult.value);
      if (statusResult.status === 'fulfilled') setLspStatus(statusResult.value);
      if (swapsResult.status === 'fulfilled') setSubmarineSwaps(swapsResult.value ?? []);

      const failure = [configResult, statusResult, swapsResult].find(result => result.status === 'rejected');
      setLspError(failure?.status === 'rejected'
        ? (failure.reason instanceof Error ? failure.reason.message : 'Could not load LSP channel status.')
        : null);
      setLspLoading(false);
    };
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchLNDChannelPresets()
      .then(response => { if (active) setChannelPresets(response.presets ?? []); })
      .catch(() => { if (active) setChannelPresets([]); });
    return () => { active = false; };
  }, []);

  const saveTransactionalSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cappedAmount = transactionalForm.amount_source === 'capped_volume' ? maxFiatLimit : null;
    const amount = transactionalForm.amount_source === 'capped_volume'
      ? Number(cappedAmount)
      : Number(transactionalForm.amount_fiat);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTransactionalError(transactionalForm.amount_source === 'capped_volume'
        ? 'Set a positive Max Position Size (Fiat) in Settings before saving capped volume.'
        : 'Enter a persisted fiat amount greater than zero.');
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
        amount_fiat: amount,
        trade_mode: transactionalForm.trade_mode,
        target_direction: transactionalForm.target_direction,
        lightning_liquidity_source: transactionalForm.lightning_liquidity_source,
        fee_tier: transactionalForm.fee_tier,
        coupled_hedge: transactionalForm.coupled_hedge,
      });
      setTransactionalSettings(updated);
      setTransactionalForm(current => ({ ...current, amount_fiat: updated.amount_fiat == null ? '' : String(updated.amount_fiat), target_direction: updated.target_direction ?? 'bid', lightning_liquidity_source: updated.lightning_liquidity_source ?? 'own_channels', fee_tier: updated.fee_tier ?? 'economic', coupled_hedge: updated.coupled_hedge ?? false }));
      setTransactionalNotice('Transactional liquidity targets saved.');
      setTransactionalEditing(false);
    } catch (error) {
      setTransactionalError(error instanceof Error ? error.message : 'Could not save transactional liquidity settings.');
    } finally {
      setTransactionalSaving(false);
    }
  };

  const cancelTransactionalEditing = () => {
    if (transactionalSettings) {
      setTransactionalForm({
        fiat_currency: transactionalSettings.fiat_currency,
        amount_source: transactionalSettings.amount_source,
        amount_fiat: transactionalSettings.amount_fiat == null ? '' : String(transactionalSettings.amount_fiat),
        trade_mode: transactionalSettings.trade_mode,
        target_direction: transactionalSettings.target_direction ?? 'bid',
        lightning_liquidity_source: transactionalSettings.lightning_liquidity_source ?? 'own_channels',
        fee_tier: transactionalSettings.fee_tier ?? 'economic',
        coupled_hedge: transactionalSettings.coupled_hedge ?? false,
      });
    }
    setTransactionalEditing(false);
    setTransactionalNotice(null);
    setTransactionalError(null);
  };

  useEffect(() => {
    if (!transactionalNotice) return;
    const timeout = window.setTimeout(() => setTransactionalNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [transactionalNotice]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLiquidityLoading(true);
      setLoadingAccounts(true);
      const [accountsResult, lndResult, dexResult] = await Promise.allSettled([fetchTradingAccounts(), fetchLNDWalletStatus(), fetchDexPendingLiquidity()]);
      if (!active) return;

      if (accountsResult.status === 'fulfilled') {
        const nextAccounts = accountsResult.value;
        // Fetch balances for all active CEX accounts. The exchange selector is
        // separately restricted by the authoritative capability policy above.
        const nextCexAccounts = nextAccounts.filter(account => account.category === 'CEX' && account.is_active && account.api_keys.some(key => key.is_active));
        setAccounts(nextAccounts);
        const snapshots = await Promise.all(nextCexAccounts.map(async account => {
          const [balances, hedges] = await Promise.allSettled([fetchCexBalances(account.id), fetchCexHedgePositions(account.id)]);
          if (balances.status !== 'fulfilled' && hedges.status !== 'fulfilled') {
            const reason = balances.status === 'rejected' ? balances.reason : hedges.status === 'rejected' ? hedges.reason : null;
            return { accountID: account.id, provider: account.provider, spotAssets: [], activeHedges: [], error: reason instanceof Error ? reason.message : 'Source unavailable' };
          }
          const activeHedges = hedges.status === 'fulfilled' ? hedges.value.active : [];
          const response = balances.status === 'fulfilled' ? balances.value : null;
          return {
            accountID: account.id,
            provider: account.provider,
            spotAssets: response?.assets ?? [response?.bitcoin, ...(response?.fiat ?? [])].filter((balance): balance is CexAssetBalance => Boolean(balance)),
            activeHedges,
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
      if (dexResult.status === 'fulfilled') {
        setDexPendingLiquidity(dexResult.value);
        setDexLiquidityError(null);
      } else {
        setDexLiquidityError(dexResult.reason instanceof Error ? dexResult.reason.message : 'Could not load DEX liquidity.');
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

  const saveLspChannel = async () => {
    setSavingLsp(true);
    setLspError(null);
    setLspNotice(null);
    try {
      const saved = await updateLSPChannel(lspConfig);
      setLspConfig(saved);
      setLspStatus(await fetchLSPChannelStatus());
      setLspNotice('LSP channel monitoring configuration saved.');
    } catch (error) {
      setLspError(error instanceof Error ? error.message : 'Failed to save the LSP channel.');
    } finally {
      setSavingLsp(false);
    }
  };

  const submitOpenChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fundingSats = Number(channelForm.fundingSats);
    const pushSats = Number(channelForm.pushSats || 0);
    const feeRate = Number(channelForm.feeRate || 2);
    if ((!selectedChannelPreset && !channelForm.nodePubkey.trim()) || !Number.isFinite(fundingSats) || fundingSats <= 0 || !Number.isFinite(pushSats) || pushSats < 0 || pushSats >= fundingSats || !Number.isFinite(feeRate) || feeRate <= 0) {
      setChannelError('Enter a node pubkey or choose a public node, then provide valid funding, push, and fee amounts.');
      return;
    }
    const hasExistingChannel = !!selectedChannelPreset && [
      ...channels.map(channel => channel.remote_pubkey),
      ...(lndWallet?.pending_channels ?? []).map(channel => channel.remote_pubkey),
    ].some(pubkey => pubkey.toLowerCase() === selectedChannelPreset.node_pubkey.toLowerCase());
    const peerLabel = selectedChannelPreset?.name ?? channelForm.nodePubkey.trim();
    const confirmation = [
      `Open a channel with ${peerLabel}?`,
      `Local funding: ${formatSats(fundingSats)}`,
      `Push amount: ${formatSats(pushSats)}`,
      `Fee: ${feeRate} sat/vB · ${channelForm.private ? 'Private' : 'Public'} channel`,
      'The channel will remain pending until its funding transaction confirms.',
      hasExistingChannel ? 'An open or pending channel already exists for this peer.' : '',
    ].filter(Boolean).join('\n');
    if (!window.confirm(confirmation)) return;

    setOpeningChannel(true);
    setChannelError(null);
    setChannelNotice(null);
    try {
      const result = await openLNDChannel({
        preset_id: selectedChannelPreset?.id,
        node_pubkey: selectedChannelPreset ? undefined : channelForm.nodePubkey.trim(),
        peer_host: selectedChannelPreset ? undefined : channelForm.peerHost.trim() || undefined,
        local_funding_amount_sat: fundingSats,
        push_sat: pushSats,
        sat_per_vbyte: feeRate,
        private: channelForm.private,
        allow_additional_channel: hasExistingChannel,
      });
      setChannelForm({ nodePubkey: '', peerHost: '', fundingSats: '', pushSats: '', feeRate: '2', private: false });
      setSelectedChannelPresetID('');
      await refreshLndWallet();
      setChannelNotice(`Channel opening submitted and is pending confirmation. Funding transaction: ${result.funding_txid || 'pending'}.`);
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
    <div className={`liquidity-workspace h-full min-h-0 overflow-y-auto pr-0.5 flex flex-col gap-1 ${liquidityPanelExpanded ? 'has-expanded-liquidity-panel' : ''}`}>
      <section aria-label="Liquidity allocation" className="liquidity-overview">
        <div className="liquidity-allocation-board" role="list" aria-label="Liquidity state">
          <div role="listitem" className={`liquidity-allocation-card liquidity-allocation-card--cex ${cexInventoryExpanded ? 'is-expanded' : ''}`}>
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">01</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">CEX Spot & Hedge</div><div className="text-[0.65rem] text-muted mt-0.5">Exchange inventory</div></div><button type="button" className="liquidity-cex-summary__toggle" aria-label={cexInventoryExpanded ? 'Collapse CEX inventory' : 'Expand CEX inventory'} aria-expanded={cexInventoryExpanded} aria-controls="cex-inventory-details" onClick={() => setCexInventoryExpanded(current => !current)}>{cexInventoryExpanded ? '⌃' : '⌄'}</button></div>
            <div className="liquidity-allocation-card__figures"><button type="button" className="liquidity-allocation-card__current liquidity-cex-summary" aria-expanded={cexInventoryExpanded} aria-controls="cex-inventory-details" onClick={() => setCexInventoryExpanded(current => !current)}><div className="liquidity-value-label">Current inventory</div>{liquidityLoading && cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">Loading…</span> : cexLiquidityError && cexLiquidity.length === 0 ? <span className="text-red text-[0.7rem]">Unavailable</span> : cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">No connected CEX</span> : <><strong className="liquidity-cex-summary__value">{formatFiatValue(totalCexFiatValue, filters.fiat)}</strong><span className="liquidity-cex-summary__hint">{cexInventoryExpanded ? 'Hide exchange details' : `View ${cexLiquidity.length} connected exchange${cexLiquidity.length === 1 ? '' : 's'}`}</span>{hasUnvaluedCexAssets && <span className="liquidity-cex-summary__note">Some assets are shown in detail only</span>}{cexLiquidityError && <span className="text-peach text-[0.6rem]">Refresh failed; showing last value</span>}</>}</button><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={targetFiat} detail={transactionalSettings ? transactionalSettings.trade_mode === 'hedgeless_double_collateral' ? 'exchange fiat' : 'exchange + hedge capital' : undefined} /></div></div>
            {cexInventoryExpanded && <div id="cex-inventory-details" className="liquidity-cex-inventory" aria-label="CEX inventory details">
              {cexLiquidity.map(source => <section key={source.accountID} className="liquidity-cex-inventory__exchange">
                <div className="liquidity-cex-inventory__exchange-header"><strong>{source.provider}</strong><span>{source.error ? source.error : 'Connected'}</span></div>
                <div className="liquidity-cex-inventory__location"><div className="liquidity-cex-inventory__location-title"><span>Spot</span><small>{source.spotAssets.length} asset{source.spotAssets.length === 1 ? '' : 's'}</small></div>{source.spotAssets.length > 0 ? <div className="liquidity-cex-inventory__assets">{source.spotAssets.map(balance => <div key={`${balance.asset}-${balance.total}`}><span>{balance.asset}</span><span className="mono-nums">{formatAssetAmount(balance.available)} available</span><span className="mono-nums text-muted">{formatAssetAmount(balance.total)} total</span></div>)}</div> : <p>No spot balances returned.</p>}</div>
                <div className="liquidity-cex-inventory__location"><div className="liquidity-cex-inventory__location-title"><span>Futures</span><small>{source.activeHedges.length} active hedge{source.activeHedges.length === 1 ? '' : 's'}</small></div>{source.activeHedges.length > 0 ? <div className="liquidity-cex-inventory__assets">{source.activeHedges.map((hedge, index) => <div key={`${hedge.transaction_id ?? index}-${hedge.instrument ?? hedge.venue ?? 'hedge'}`}><span>{hedge.instrument || hedge.venue || 'BTC perpetual'}</span><span>{hedge.direction || 'Hedge'}</span><span className="mono-nums text-muted">{formatBTC(Math.abs(hedge.size_btc ?? 0))}</span></div>)}</div> : <p>No active futures positions.</p>}</div>
              </section>)}
            </div>}
          </div>

          <div role="listitem" className={`liquidity-allocation-card liquidity-allocation-card--lnd ${hubInventoryExpanded ? 'is-expanded' : ''}`}>
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">02</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">Mainnet Hub Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">On-chain wallet reserve</div></div><button type="button" className="liquidity-hub-summary__toggle" aria-label={hubInventoryExpanded ? 'Collapse Mainnet Hub liquidity' : 'Expand Mainnet Hub liquidity'} aria-expanded={hubInventoryExpanded} aria-controls="hub-inventory-details" onClick={() => setHubInventoryExpanded(current => !current)}>{hubInventoryExpanded ? '⌃' : '⌄'}</button></div>
            <div className="liquidity-allocation-card__figures"><button type="button" className="liquidity-allocation-card__current liquidity-hub-summary" aria-expanded={hubInventoryExpanded} aria-controls="hub-inventory-details" onClick={() => setHubInventoryExpanded(current => !current)}><div className="liquidity-value-label">Current balance</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <><strong className="liquidity-hub-summary__value">{formatBTC(lndOnChainSats / 1e8)}</strong><span className="liquidity-hub-summary__hint">{hubInventoryExpanded ? 'Hide address details' : `View ${lndAddresses.length} on-chain address${lndAddresses.length === 1 ? '' : 'es'}`}</span>{lndLiquidityError && <span className="text-peach text-[0.6rem]">Refresh failed; showing last value</span>}</>}</button><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={lndTargetBTC} detail={lndTargetDetail} /></div></div>
            {hubInventoryExpanded && <div id="hub-inventory-details" className="liquidity-hub-inventory" aria-label="Mainnet Hub address details">{lndAddresses.length > 0 ? lndAddresses.map(address => <div key={address.address} className="liquidity-hub-inventory__address"><div className="liquidity-hub-inventory__address-heading"><div><strong>{address.label || 'Mainnet address'}</strong><code title={address.address}>{shortAddress(address.address)}</code></div><span className="mono-nums">{formatSats(address.balance_sat ?? 0)}</span></div>{address.whitelisted_by && address.whitelisted_by.length > 0 && <div className="liquidity-hub-inventory__whitelist"><span>Whitelisted on</span>{address.whitelisted_by.map(provider => <span className="liquidity-hub-inventory__pill" key={provider}>{provider}</span>)}</div>}</div>) : <p>No on-chain addresses returned by the Mainnet Hub.</p>}<section className="liquidity-hub-management" aria-hidden="true" /></div>}
            <div ref={hubOperationsRef} className="liquidity-card-operations-host" />
          </div>

          <div role="listitem" className={`liquidity-allocation-card liquidity-allocation-card--lightning ${lightningInventoryExpanded ? 'is-expanded' : ''}`}>
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">03</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">Lightning Channel Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">Ready-to-route capacity</div></div><button type="button" className="liquidity-lightning-summary__toggle" aria-label={lightningInventoryExpanded ? 'Collapse Lightning liquidity' : 'Expand Lightning liquidity'} aria-expanded={lightningInventoryExpanded} aria-controls="lightning-inventory-details" onClick={() => setLightningInventoryExpanded(current => !current)}>{lightningInventoryExpanded ? '⌃' : '⌄'}</button></div>
            <div className="liquidity-allocation-card__figures"><button type="button" className="liquidity-allocation-card__current liquidity-lightning-summary" aria-expanded={lightningInventoryExpanded} aria-controls="lightning-inventory-details" onClick={() => setLightningInventoryExpanded(current => !current)}><div className="liquidity-value-label">Current channel balance</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <><strong className="liquidity-lightning-summary__value">{formatBTC(lightningCapacitySats / 1e8)}</strong><span className="liquidity-lightning-summary__hint">{lightningInventoryExpanded ? 'Hide channel details' : `View ${channels.length} channel${channels.length === 1 ? '' : 's'} · ${activeChannelCount} active`}</span>{lndLiquidityError && <span className="text-peach text-[0.6rem]">Refresh failed; showing last value</span>}</>}</button><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={lndTargetBTC} detail={lndTargetDetail} /></div></div>
            {lightningInventoryExpanded && <div id="lightning-inventory-details" className="liquidity-lightning-inventory" aria-label="Lightning channel liquidity details">
              <section className="liquidity-lightning-inventory__group"><div className="liquidity-lightning-inventory__group-heading"><strong>Own liquidity</strong><span>{ownLiquidityChannels.length} channel{ownLiquidityChannels.length === 1 ? '' : 's'}</span></div>{ownLiquidityChannels.length > 0 ? ownLiquidityChannels.map(channel => <div key={channel.channel_point} className="liquidity-lightning-inventory__channel"><div><strong>{channel.remote_alias || shortAddress(channel.remote_pubkey)}</strong><span>{channel.active ? 'Active' : 'Inactive'}{channel.private ? ' · Private' : ''}</span></div><dl><div><dt>Capacity</dt><dd>{formatSats(channel.capacity_sat)}</dd></div><div><dt>Outbound</dt><dd>{formatSats(channel.local_balance_sat)}</dd></div><div><dt>Inbound</dt><dd>{formatSats(channel.remote_balance_sat)}</dd></div></dl><div className="liquidity-lightning-inventory__channel-actions"><button type="button" disabled={closingChannelPoint === channel.channel_point} onClick={() => void submitCloseChannel(channel.channel_point, false)}>Close</button><button type="button" disabled={closingChannelPoint === channel.channel_point} onClick={() => void submitCloseChannel(channel.channel_point, true)}>Force close</button></div></div>) : <p>No own-liquidity channels.</p>}</section>
              <section className="liquidity-lightning-inventory__group"><div className="liquidity-lightning-inventory__group-heading"><strong>LSP channel</strong><span>{lspLiquidityChannel ? (lspStatus?.lsp_healthy ? 'Active' : 'Needs attention') : 'Not configured'}</span></div>{lspLiquidityChannel ? <><div className="liquidity-lightning-inventory__channel"><div><strong>{lspConfig.provider_label || lspLiquidityChannel.remote_alias || shortAddress(lspLiquidityChannel.remote_pubkey)}</strong><span>{lspLiquidityChannel.active ? 'Active' : 'Inactive'}{lspLiquidityChannel.private ? ' · Private' : ''}</span></div><dl><div><dt>Capacity</dt><dd>{formatSats(lspLiquidityChannel.capacity_sat)}</dd></div><div><dt>Outbound</dt><dd>{formatSats(lspStatus?.usable_outbound_sat ?? lspLiquidityChannel.local_balance_sat)}</dd></div><div><dt>Inbound</dt><dd>{formatSats(lspStatus?.usable_inbound_sat ?? lspLiquidityChannel.remote_balance_sat)}</dd></div></dl></div><div className="liquidity-lightning-inventory__fees"><span>Headroom <b>{formatSats(lspConfig.headroom_sat)}</b></span><span>Max swap fee <b>{formatSats(lspConfig.max_swap_fee_sat)}</b></span><span>Max fee rate <b>{lspConfig.max_swap_fee_ppm.toLocaleString()} ppm</b></span></div></> : <p>Select an LSP channel below to show its capacity and fees.</p>}</section>
              <section className="liquidity-lightning-management" aria-labelledby="lightning-controls-heading"><div><span className="liquidity-section-kicker">Lightning channels</span><h4 id="lightning-controls-heading">Manage channels</h4><p>{!lspLoading && (lspStatus?.lsp_healthy ? 'LSP channel active' : 'LSP channel needs attention')}</p></div><label><span>LSP channel</span><select value={lspConfig.channel_point} onChange={event => { const channel = channels.find(item => item.channel_point === event.target.value); setLspConfig(previous => ({ ...previous, channel_point: channel?.channel_point || '', remote_pubkey: channel?.remote_pubkey || '', provider_label: channel?.remote_alias || '', enabled: Boolean(channel) })); }}><option value="">Choose a live LND channel…</option>{channels.map(channel => <option key={channel.channel_point} value={channel.channel_point}>{channel.remote_alias || shortAddress(channel.remote_pubkey)}</option>)}</select></label><div className="liquidity-lightning-management__fees"><label><span>Headroom (sats)</span><input type="number" min="0" value={lspConfig.headroom_sat} onChange={event => setLspConfig(previous => ({ ...previous, headroom_sat: Number(event.target.value) }))} /></label><label><span>Max fee (sats)</span><input type="number" min="1" value={lspConfig.max_swap_fee_sat} onChange={event => setLspConfig(previous => ({ ...previous, max_swap_fee_sat: Number(event.target.value) }))} /></label><label><span>Max fee (ppm)</span><input type="number" min="1" value={lspConfig.max_swap_fee_ppm} onChange={event => setLspConfig(previous => ({ ...previous, max_swap_fee_ppm: Number(event.target.value) }))} /></label></div><button type="button" disabled={savingLsp || !lspConfig.channel_point} onClick={() => void saveLspChannel()}>{savingLsp ? 'Saving…' : 'Save LSP selection'}</button><details><summary>Open a new channel</summary><form onSubmit={event => void submitOpenChannel(event)}><input value={channelForm.nodePubkey} onChange={event => setChannelForm(current => ({ ...current, nodePubkey: event.target.value }))} placeholder="Node public key" /><input value={channelForm.peerHost} onChange={event => setChannelForm(current => ({ ...current, peerHost: event.target.value }))} placeholder="Peer host (optional)" /><input type="number" min="1" value={channelForm.fundingSats} onChange={event => setChannelForm(current => ({ ...current, fundingSats: event.target.value }))} placeholder="Funding sats" /><button type="submit" disabled={openingChannel}>{openingChannel ? 'Opening…' : 'Open channel'}</button></form></details>{(lspError || lspNotice || channelError || channelNotice) && <p className="liquidity-lightning-management__feedback">{lspError || lspNotice || channelError || channelNotice}</p>}</section>
            </div>}
            <div ref={lightningOperationsRef} className="liquidity-card-operations-host" />
          </div>

          <div role="listitem" className="liquidity-allocation-card liquidity-allocation-card--dex">
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">04</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">DEX Wallet / Pending Contracts</div><div className="text-[0.65rem] text-muted mt-0.5">Settlement collateral</div></div></div>
            <div className="liquidity-allocation-card__figures"><div className="liquidity-allocation-card__current"><div className="liquidity-value-label">Current</div>{liquidityLoading && !dexPendingLiquidity ? <span className="text-muted text-[0.7rem]">Loading…</span> : dexLiquidityError && !dexPendingLiquidity ? <span className="text-red text-[0.7rem]">Unavailable</span> : dexPendingLiquidity ? <div className="text-[0.68rem] leading-5"><div className="mono-nums text-text">{formatBTC(dexPendingLiquidity.btc_value)}</div><div className="text-muted">{dexPendingLiquidity.transaction_count} pending contract{dexPendingLiquidity.transaction_count === 1 ? '' : 's'}</div>{dexLiquidityError && <div className="text-peach">Refresh failed; showing last value</div>}</div> : <span className="text-red text-[0.7rem]">Unavailable</span>}</div><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={formatBTC(0)} /></div></div>
            <div className="liquidity-allocation-card__sources liquidity-allocation-card__sources--empty" aria-hidden="true" />
          </div>
        </div>
      </section>

      <section aria-label="Liquidity settings" className="liquidity-management">

        <section aria-labelledby="transactional-liquidity-heading" className="liquidity-settings-card">
          <div className="liquidity-settings-card__header flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 id="transactional-liquidity-heading" className="text-[0.7rem] font-semibold text-text">Transactional liquidity target</h4>
              <p className="text-[0.62rem] text-muted mt-0.5">One fiat target translated into the required liquidity brackets.</p>
            </div>
            {transactionalLoading && <span className="text-[0.6rem] text-muted">Loading…</span>}
            {!transactionalLoading && transactionalSettings && !transactionalEditing && <div className="liquidity-target-summary">
              <div><span>Target</span><strong>{transactionalAmount != null ? formatFiatValue(transactionalAmount, transactionalSettings.fiat_currency) : 'Not configured'}</strong></div>
              <div><span>Source</span><strong>{transactionalSettings.amount_source === 'custom' ? 'Custom amount' : 'Capped volume'}</strong></div>
              <div><span>Mode</span><strong>{transactionalSettings.trade_mode === 'hedgeless_double_collateral' ? 'Hedgeless' : 'Hedgefull'}</strong></div>
              <div><span>Direction</span><strong className="capitalize">{transactionalSettings.target_direction ?? 'bid'}</strong></div>
              <div><span>Lightning</span><strong>{transactionalSettings.lightning_liquidity_source === 'lsp_channel' ? 'LSP channel' : 'Own Lightning channels'}</strong></div>
              <div><span>Fees</span><strong>Economic · {transactionalSettings.coupled_hedge ? 'coupled hedge' : 'independent hedge'}</strong></div>
              <button type="button" onClick={() => { setTransactionalEditing(true); setTransactionalNotice(null); }}>Edit</button>
            </div>}
          </div>
          {(!transactionalSettings || transactionalEditing || transactionalLoading) && <form onSubmit={saveTransactionalSettings} className="liquidity-target-form" noValidate>
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
            <label className="block">
              <span className="block text-[0.62rem] uppercase tracking-wider font-medium text-muted mb-1">Lightning liquidity source</span>
              <select aria-label="Lightning liquidity source" required value={transactionalForm.lightning_liquidity_source} onChange={event => setTransactionalForm(current => ({ ...current, lightning_liquidity_source: event.target.value as TransactionalLiquiditySource }))} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent">
                <option value="own_channels">Own Lightning channels</option>
                <option value="lsp_channel">LSP channel</option>
              </select>
            </label>
            <div className="liquidity-target-amount">
              <span className="block text-[0.62rem] uppercase tracking-wider font-medium text-muted mb-1">Target amount</span>
              <div className="liquidity-target-amount__controls">
                <select aria-label="Amount source" value={transactionalForm.amount_source} onChange={event => setTransactionalForm(current => ({ ...current, amount_source: event.target.value as TransactionalLiquidityAmountSource }))} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent">
                  <option value="custom">Custom amount</option>
                  <option value="capped_volume">Capped volume</option>
                </select>
                <label className="block">
                  <span className="sr-only">Transactional liquidity ({transactionalForm.fiat_currency})</span>
                  <input type="number" min={0} step={50} readOnly={transactionalForm.amount_source === 'capped_volume'} value={transactionalForm.amount_source === 'capped_volume' ? (maxFiatLimit != null && maxFiatLimit > 0 ? String(maxFiatLimit) : '') : transactionalForm.amount_fiat} onChange={event => setTransactionalForm(current => ({ ...current, amount_fiat: event.target.value }))} placeholder={`Amount in ${transactionalForm.fiat_currency}`} className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text outline-none focus:border-accent mono-nums read-only:opacity-70" />
                </label>
              </div>
              {transactionalForm.amount_source === 'capped_volume' && <p className="mt-1 text-[0.6rem] text-muted">Uses the Max Position Size (Fiat) from Settings.</p>}
            </div>
            <label className="block">
              <span className="block text-[0.62rem] uppercase tracking-wider font-medium text-muted mb-1">Miner fee tier</span>
              <select value={transactionalForm.fee_tier} disabled className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[0.72rem] text-text opacity-80"><option value="economic">Economic</option></select>
            </label>
            <label className="flex items-center gap-2 text-[0.68rem] text-text">
              <input type="checkbox" checked={transactionalForm.coupled_hedge} onChange={event => setTransactionalForm(current => ({ ...current, coupled_hedge: event.target.checked }))} />
              Require spot and hedge on the same provider
            </label>
            <div className="liquidity-target-save">
              <div className="flex items-center gap-1.5">
                <button type="submit" disabled={transactionalSaving || transactionalLoading} className="rounded-md border border-accent bg-accent/10 px-2.5 py-1.5 text-[0.7rem] font-semibold text-text hover:bg-accent/20 disabled:opacity-60">{transactionalSaving ? 'Saving…' : 'Save target'}</button>
                {transactionalSettings && <button type="button" onClick={cancelTransactionalEditing} disabled={transactionalSaving} className="rounded-md border border-border px-2.5 py-1.5 text-[0.7rem] font-semibold text-muted hover:bg-bg disabled:opacity-60">Cancel</button>}
              </div>
            </div>
            {(transactionalNotice || transactionalError) && <div className="liquidity-target-feedback text-[0.62rem]" aria-live="polite">{transactionalNotice && <span className="text-green">{transactionalNotice}</span>}{transactionalError && <span className="text-red">{transactionalError}</span>}</div>}
          </form>}
          {(transactionalNotice || transactionalError) && !transactionalEditing && <div className="liquidity-target-feedback text-[0.62rem] mt-2" aria-live="polite">{transactionalNotice && <span className="text-green">{transactionalNotice}</span>}{transactionalError && <span className="text-red">{transactionalError}</span>}</div>}
        </section>

        <CardPortal targetRef={hubOperationsRef}><section aria-labelledby="pool-transfer-heading" className="liquidity-action-card">
          <div className="pool-transfer__intro">
            <div className="pool-transfer__intro-copy">
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

            {action === 'fill' && transferRoute === 'manual' ? (
              <div className="pool-transfer__manual-deposit">
                <span className="pool-transfer__step-label">2. Fund from</span>
                <div className="pool-transfer__route-choice" role="group" aria-label="Transfer route">
                  <button type="button" aria-pressed={false} onClick={() => selectRoute('exchange')}>Connected exchange</button>
                  <button type="button" aria-pressed={true} onClick={() => selectRoute('manual')} className="is-selected">Manual address</button>
                </div>
                <span className="pool-transfer__step-label">LND deposit address</span>
                {selectedDestination ? (
                  <div className="pool-transfer__manual-deposit-content">
                    <LocalQrCode
                      value={`bitcoin:${selectedDestination}`}
                      alt="QR code for the LND Bitcoin deposit address"
                      size={164}
                      fallback="Could not generate QR code."
                    />
                    <div className="pool-transfer__manual-deposit-address">
                      <span className="pool-transfer__field-label">Send Bitcoin to this address</span>
                      <code>{selectedDestination}</code>
                    </div>
                  </div>
                ) : (
                  <p className="pool-transfer__empty">No LND on-chain address available.</p>
                )}
              </div>
            ) : (
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
            )}

            {!(action === 'fill' && transferRoute === 'manual') && <div className="pool-transfer__review">
              <div className="pool-transfer__route"><div><span>From</span><strong>{sourceLabel}</strong></div><i aria-hidden>→</i><div><span>To</span><strong>{destinationLabel}</strong></div></div>
              <div className="pool-transfer__submit"><p>Review creates a request only; transfers are not sent yet.</p><button type="submit">Create transfer request</button></div>
            </div>}
          {loadError && <p className="sm:col-span-2 rounded-md border border-red/40 bg-error px-2 py-1.5 text-[0.72rem] text-red" role="alert">{loadError}</p>}
          {feedback && (
            <p className="sm:col-span-2 rounded-md border border-peach/40 bg-peach/10 px-2 py-1.5 text-[0.72rem] text-peach" role="status">{feedback}</p>
          )}
          </form>}
        </section></CardPortal>

        <CardPortal targetRef={lightningOperationsRef}><section aria-labelledby="lightning-management-heading" className="liquidity-action-card">
          <div className="liquidity-channel-disclosure">
            <div><h4 id="lightning-management-heading">Lightning channels <span>{channels.length} open</span></h4><p>Open, inspect, close, or register LSP capacity.</p>{!lspLoading && <p className={lspStatus?.lsp_healthy ? 'text-green' : 'text-peach'}>{lspStatus?.lsp_healthy ? 'LSP channel active' : 'LSP channel needs attention'}</p>}</div>
            <button type="button" aria-expanded={channelsExpanded} aria-controls="lightning-channel-controls" onClick={() => setChannelsExpanded(current => !current)}>{channelsExpanded ? 'Hide controls' : 'Manage channels'}</button>
          </div>

          {channelsExpanded && <div id="lightning-channel-controls" className="liquidity-channel-controls">
          <section aria-labelledby="lsp-channel-heading" className="mb-2 rounded-md border border-border bg-surface/40 p-2">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div><h5 id="lsp-channel-heading" className="text-[0.75rem] font-medium text-text">Long-lived LSP channel</h5><p className="text-[0.65rem] text-muted">Select and monitor inbound capacity opened outside the application.</p></div>
              <span className={`rounded border px-2 py-1 text-[0.65rem] ${lspStatus?.lsp_healthy ? 'border-green/40 text-green' : 'border-peach/40 text-peach'}`}>
                {lspLoading ? 'Loading LSP status…' : lspStatus?.lsp_healthy ? 'Active' : (lspStatus?.reason || 'Not configured')}
              </span>
            </div>
            <div className="grid gap-2 text-[0.7rem]">
              <label className="grid gap-1 text-muted"><span>LND channel</span><select className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" value={lspConfig.channel_point} onChange={event => { const channel = channels.find(item => item.channel_point === event.target.value); setLspConfig(previous => ({ ...previous, channel_point: channel?.channel_point || '', remote_pubkey: channel?.remote_pubkey || '', provider_label: channel?.remote_alias || '', enabled: Boolean(channel) })); }}>
                <option value="">Choose a live LND channel…</option>
                {channels.map(channel => <option key={channel.channel_point} value={channel.channel_point}>{channel.remote_alias || shortAddress(channel.remote_pubkey)} · {formatSats(channel.capacity_sat)} · {channel.active ? 'active' : 'inactive'}</option>)}
              </select></label>
              <div className="grid gap-1.5 sm:grid-cols-3">
                <label className="grid gap-1 text-muted"><span>Headroom (sats)</span><input className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" type="number" min="0" value={lspConfig.headroom_sat} onChange={event => setLspConfig(previous => ({ ...previous, headroom_sat: Number(event.target.value) }))} /></label>
                <label className="grid gap-1 text-muted"><span>Maximum fee (sats)</span><input className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" type="number" min="1" value={lspConfig.max_swap_fee_sat} onChange={event => setLspConfig(previous => ({ ...previous, max_swap_fee_sat: Number(event.target.value) }))} /></label>
                <label className="grid gap-1 text-muted"><span>Maximum fee (ppm)</span><input className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent" type="number" min="1" value={lspConfig.max_swap_fee_ppm} onChange={event => setLspConfig(previous => ({ ...previous, max_swap_fee_ppm: Number(event.target.value) }))} /></label>
              </div>
              {lspStatus && <div className="grid gap-1 text-muted sm:grid-cols-2"><div>Usable outbound: <span className="text-text">{formatSats(lspStatus.usable_outbound_sat)}</span></div><div>Usable inbound: <span className="text-text">{formatSats(lspStatus.usable_inbound_sat)}</span></div><div>LSP outbound: <span className="text-text">{formatSats(lspStatus.lsp_outbound_sat)}</span></div><div>LSP inbound: <span className="text-text">{formatSats(lspStatus.lsp_inbound_sat)}</span></div></div>}
              {submarineSwaps.some(item => !['settled', 'refunded'].includes(item.state)) && <div className="rounded border border-yellow px-2 py-1.5 text-yellow">{submarineSwaps.filter(item => !['settled', 'refunded'].includes(item.state)).length} incomplete or refund-pending submarine swap(s) require attention.</div>}
              {lspError && <p className="rounded-md border border-red/40 bg-error px-2 py-1.5 text-red" role="alert">{lspError}</p>}
              {lspNotice && <p className="rounded-md border border-green/40 bg-green/8 px-2 py-1.5 text-green" role="status">{lspNotice}</p>}
              <div className="flex justify-end"><button type="button" disabled={savingLsp || !lspConfig.channel_point} onClick={() => void saveLspChannel()} className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-[0.75rem] font-semibold text-accent hover:bg-accent/20 disabled:opacity-60">{savingLsp ? 'Saving…' : 'Save LSP selection'}</button></div>
            </div>
          </section>
          <details className="group rounded-md border border-border bg-surface/40 mb-2">
            <summary className="cursor-pointer list-none px-2 py-1.5 text-[0.72rem] font-medium text-text flex items-center justify-between">Open a new channel <span className="text-muted transition-transform group-open:rotate-180">⌄</span></summary>
          <form onSubmit={event => void submitOpenChannel(event)} className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 border-t border-border px-2 pb-2 pt-1.5" noValidate>
            <label className="block sm:col-span-2"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Public node <span className="normal-case tracking-normal">(optional)</span></span><select value={selectedChannelPresetID} onChange={event => setSelectedChannelPresetID(event.target.value)} className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent"><option value="">Manual connection details</option>{channelPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
            {selectedChannelPreset && <div className="sm:col-span-2 rounded-md border border-border bg-bg px-2 py-1.5 text-[0.7rem] text-muted"><div><span className="text-text">{selectedChannelPreset.name}</span> · {selectedChannelPreset.peer_host}</div><div>Minimum funding: {formatSats(selectedChannelPreset.min_funding_amount_sat)}</div>{selectedChannelPreset.warning && <div className="mt-1 text-peach">{selectedChannelPreset.warning}</div>}<a className="mt-1 inline-block text-accent underline" href={selectedChannelPreset.source_url} target="_blank" rel="noreferrer">Source · verified {selectedChannelPreset.verified_at}</a></div>}
            <label className="block"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Node pubkey</span><input disabled={!!selectedChannelPreset} value={channelForm.nodePubkey} onChange={event => setChannelForm(current => ({ ...current, nodePubkey: event.target.value }))} placeholder="Remote node public key" className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent disabled:opacity-50" /></label>
            <label className="block"><span className="block text-[0.65rem] uppercase tracking-wider font-medium text-muted mb-1">Peer host <span className="normal-case tracking-normal">(optional)</span></span><input disabled={!!selectedChannelPreset} value={channelForm.peerHost} onChange={event => setChannelForm(current => ({ ...current, peerHost: event.target.value }))} placeholder="node.example:9735" className="w-full box-border rounded-md border border-border bg-bg px-2 py-1.5 text-[0.75rem] text-text outline-none focus:border-accent disabled:opacity-50" /></label>
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
        </section></CardPortal>
      </section>
    </div>
  );
}
