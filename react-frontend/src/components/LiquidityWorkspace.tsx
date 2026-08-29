import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { closeLNDChannel, createMagmaLSPOrder, fetchCexBalances, fetchCexDepositAddresses, fetchCexHedgePositions, fetchDexPendingLiquidity, fetchLNDChannelPresets, fetchLNDWalletStatus, fetchLSPChannel, fetchLSPChannelStatus, fetchMagmaLSPInfo, fetchMagmaLSPOrder, fetchMagmaOffers, fetchSubmarineSwaps, fetchTradingAccounts, fetchTransactionalLiquiditySettings, openLNDChannel, payMagmaLSPOrder, updateLSPChannel, updateTransactionalLiquiditySettings } from '../utils/api';
import type { CexAssetBalance, CexDepositAddress, CexHedgePosition, LNDChannelPreset, LNDWalletChannelSummary, LNDWalletStatus, LSPChannelConfig, LSPChannelStatus, MagmaLSPInfo, MagmaLSPOrder, MagmaOffer, SubmarineSwapRecord, TradeMode, TradingAccount, TransactionalLiquidityAmountSource, TransactionalLiquiditySettings, TransactionalLiquiditySource, TransactionalLiquidityTargetDirection, TransactionalRoutingProfile } from '../types';
import { useFilters } from '../hooks/useFilters';
import { usePreferences } from '../hooks/usePreferences';
import { useCEXPermissions } from '../hooks/useCEXPermissions';
import { LocalQrCode } from './LocalQrCode';

type PoolAction = 'fill' | 'drain';
type TransferRoute = 'exchange' | 'manual';
type CexInventoryPane = 'balances' | 'positions' | 'trades' | 'withdrawals';

type CexLiquiditySource = {
  accountID: number;
  provider: string;
  spotAssets: CexAssetBalance[];
  activeHedges: CexHedgePosition[];
  error?: string;
};

function TargetCell({ value, unavailable = false }: { value?: string; unavailable?: boolean }) {
  if (unavailable) return <span className="text-muted font-mono text-[0.7rem]">Not required</span>;
  if (!value) return <span className="text-muted font-mono text-[0.7rem]">Not configured</span>;
  return <span className="font-mono text-[0.7rem] text-text">{value}</span>;
}

function LiquidityTargetIndicator({ atOrAbove }: { atOrAbove: boolean }) {
  return <div className={`liquidity-target-indicator ${atOrAbove ? 'is-at-target' : 'is-below-target'}`}>
    {atOrAbove ? 'Liquidity at or above target' : 'Liquidity below target'}
  </div>;
}

const FIAT_OPTIONS = ['EUR', 'USD', 'GBP', 'AUD', 'CHF', 'SEK', 'NOK', 'CAD'];
const TRADE_MODE_OPTIONS: Array<{ value: TradeMode; label: string }> = [
  { value: 'hedgefull_single_collateral', label: 'Hedgefull' },
  { value: 'hedgeless_double_collateral', label: 'Hedgeless' },
];

const ROUTING_PROFILE_OPTIONS: Array<{ value: TransactionalRoutingProfile; label: string }> = [
  { value: 'Direct_main2main', label: 'Direct' },
  { value: 'Hub_main2main', label: 'Hub' },
  { value: 'Swap_main2lightning', label: 'Swap' },
];

const HEDGEFULL_ROUTING_MATRIX_PROFILES: Record<TransactionalRoutingProfile, { route: string; requirement: string }> = {
  Direct_main2main: { route: 'CEX → DEX wallet/contract', requirement: 'Direct mainnet settlement' },
  Hub_main2main: { route: 'CEX → Mainnet Hub → DEX wallet/contract', requirement: 'Mainnet hub reserve available' },
  Swap_main2lightning: { route: 'CEX → Lightning → DEX wallet/contract', requirement: 'Lightning routing reserve available' },
};

const HEDGELESS_ROUTING_MATRIX_PROFILES: Partial<Record<TransactionalRoutingProfile, { route: string; requirement: string }>> = {
  Hub_main2main: { route: 'Pool → DEX wallet/contract → Pool refill', requirement: 'Mainnet hub reserve available' },
  Swap_main2lightning: { route: 'Pool Lightning swap → DEX wallet/contract → Pool refill', requirement: 'Lightning routing reserve available' },
};

const DEFAULT_ROUTING_PROFILES: TransactionalRoutingProfile[] = ROUTING_PROFILE_OPTIONS.map(option => option.value);

function routingProfileOptions(tradeMode: TradeMode) {
  return tradeMode === 'hedgeless_double_collateral'
    ? ROUTING_PROFILE_OPTIONS.filter(option => option.value !== 'Direct_main2main')
    : ROUTING_PROFILE_OPTIONS;
}

function normalizeSupportedRoutingProfiles(profiles: string[] | null | undefined, tradeMode: TradeMode): TransactionalRoutingProfile[] {
  const availableProfiles = routingProfileOptions(tradeMode).map(option => option.value);
  const selected = availableProfiles.filter(profile => (profiles ?? []).includes(profile));
  return selected.length > 0 ? selected : availableProfiles;
}

function routingMatrixDetails(profile: TransactionalRoutingProfile, tradeMode: TradeMode): { route: string; requirement: string } {
  return tradeMode === 'hedgeless_double_collateral'
    ? HEDGELESS_ROUTING_MATRIX_PROFILES[profile] ?? HEDGEFULL_ROUTING_MATRIX_PROFILES[profile]
    : HEDGEFULL_ROUTING_MATRIX_PROFILES[profile];
}

function swapRoutingEnabled(profiles: readonly string[]) {
  return profiles.includes('Swap_main2lightning');
}

function formatRoutingProfiles(profiles: readonly string[]) {
  return ROUTING_PROFILE_OPTIONS.filter(option => profiles.includes(option.value)).map(option => option.label).join(' · ');
}

const CEX_INVENTORY_PANES: Array<{ id: CexInventoryPane; label: string; soon: string }> = [
  { id: 'balances', label: 'Balances', soon: '' },
  { id: 'positions', label: 'Open positions', soon: 'Open spot and futures positions for this exchange will appear here.' },
  { id: 'trades', label: 'Trade history', soon: 'Spot and futures fills for this exchange will appear here.' },
  { id: 'withdrawals', label: 'Withdraw history', soon: 'Withdrawal history for this exchange will appear here.' },
];

function CexInventoryComingSoon({ detail }: { detail: string }) {
  return (
    <div className="liquidity-cex-inventory__soon">
      <strong>Coming soon</strong>
      <p>{detail}</p>
    </div>
  );
}

const emptyLSPConfig: LSPChannelConfig = {
  channel_point: '',
  remote_pubkey: '',
  provider_label: '',
  enabled: false,
  headroom_sat: 0,
  max_swap_fee_sat: 0,
  max_swap_fee_ppm: 0,
};

const DEFAULT_MAGMA_EXPIRY_BLOCKS = 4320;

function formatFiat(value: number, currency: string) {
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatFiatValue(value: number, currency: string) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function shortAddress(address: string) {
  return address.length <= 22 ? address : `${address.slice(0, 12)}…${address.slice(-8)}`;
}

function bitcoinAddressExplorerUrl(address: string) {
  return `https://mempool.space/address/${encodeURIComponent(address)}`;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="liquidity-hub-inventory__icon">
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.5 15.5h-1a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="liquidity-hub-inventory__icon">
      <path d="M14 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 14 19 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M19 14v5H5V5h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HubAddressCopyButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      className="liquidity-hub-inventory__action"
      aria-label={copied ? 'Address copied' : 'Copy address'}
      title={copied ? 'Copied' : 'Copy address'}
      onClick={() => void copyAddress()}
    >
      {copied ? '✓' : <CopyIcon />}
    </button>
  );
}

function HubInventoryAddress({
  label,
  address,
  balanceSat,
  balanceUnit,
  whitelistedBy,
}: {
  label: string;
  address: string;
  balanceSat: number;
  balanceUnit: HubBalanceUnit;
  whitelistedBy?: string[];
}) {
  return (
    <div className="liquidity-hub-inventory__address">
      <div className="liquidity-hub-inventory__address-row">
        <div className="liquidity-hub-inventory__address-main">
          <strong title={label}>{label}</strong>
          <code>{address}</code>
        </div>
        <div className="liquidity-hub-inventory__address-actions">
          <HubAddressCopyButton address={address} />
          <a
            href={bitcoinAddressExplorerUrl(address)}
            target="_blank"
            rel="noreferrer"
            className="liquidity-hub-inventory__action"
            aria-label="View address on mempool.space"
            title="View on mempool.space"
          >
            <ExternalLinkIcon />
          </a>
        </div>
        <span className="liquidity-hub-inventory__address-balance mono-nums">{formatHubBalance(balanceSat, balanceUnit)}</span>
      </div>
      {whitelistedBy && whitelistedBy.length > 0 && (
        <div className="liquidity-hub-inventory__whitelist">
          <span>Whitelisted on</span>
          {whitelistedBy.map(provider => (
            <span className="liquidity-hub-inventory__pill" key={provider}>{provider}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSats(value: number) {
  return `${new Intl.NumberFormat().format(value)} sats`;
}

function formatBTC(value: number) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })} BTC`;
}

type HubBalanceUnit = 'btc' | 'sats';

const HUB_BALANCE_UNIT_STORAGE_KEY = 'dex-hub-balance-unit';

function formatHubBalance(balanceSat: number, unit: HubBalanceUnit) {
  return unit === 'sats' ? formatSats(balanceSat) : formatBTC(balanceSat / 1e8);
}

function HubBalanceUnitToggle({ unit, onChange }: { unit: HubBalanceUnit; onChange: (unit: HubBalanceUnit) => void }) {
  return (
    <div className="liquidity-hub-unit-toggle" role="group" aria-label="Balance unit">
      <button type="button" aria-pressed={unit === 'btc'} className={unit === 'btc' ? 'is-selected' : ''} onClick={() => onChange('btc')}>BTC</button>
      <button type="button" aria-pressed={unit === 'sats'} className={unit === 'sats' ? 'is-selected' : ''} onClick={() => onChange('sats')}>sats</button>
    </div>
  );
}

function LightningSplit({ outboundSat, inboundSat }: { outboundSat: number; inboundSat: number }) {
  const total = outboundSat + inboundSat;
  const outboundPct = total > 0 ? Math.max(4, (outboundSat / total) * 100) : 50;
  return (
    <div className="lightning-split">
      <div className="lightning-split__bar" aria-hidden="true"><span style={{ width: `${outboundPct}%` }} /></div>
      <div className="lightning-split__legend"><span>Outbound {formatSats(outboundSat)}</span><span>Inbound {formatSats(inboundSat)}</span></div>
    </div>
  );
}

function LightningChannelRow({
  channel,
  closing,
  onClose,
  onForceClose,
}: {
  channel: LNDWalletChannelSummary;
  closing: boolean;
  onClose: () => void;
  onForceClose: () => void;
}) {
  return (
    <article className="lightning-channel">
      <header>
        <div>
          <strong>{channel.remote_alias || shortAddress(channel.remote_pubkey)}</strong>
          <span>{channel.active ? 'Active' : 'Inactive'}{channel.private ? ' · Private' : ''}</span>
        </div>
        <code title={channel.channel_point}>{shortAddress(channel.channel_point)}</code>
      </header>
      <LightningSplit outboundSat={channel.local_balance_sat} inboundSat={channel.remote_balance_sat} />
      <dl>
        <div><dt>Capacity</dt><dd>{formatSats(channel.capacity_sat)}</dd></div>
        <div><dt>Outbound</dt><dd>{formatSats(channel.local_balance_sat)}</dd></div>
        <div><dt>Inbound</dt><dd>{formatSats(channel.remote_balance_sat)}</dd></div>
      </dl>
      <div className="lightning-channel__actions">
        <button type="button" disabled={closing} onClick={onClose}>{closing ? 'Closing…' : 'Close'}</button>
        <button type="button" disabled={closing} onClick={onForceClose}>Force close</button>
      </div>
    </article>
  );
}

function formatAssetAmount(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}


export function LiquidityWorkspace() {
  const { filters, refPrice } = useFilters();
  const { maxFiatLimit } = usePreferences();
  const { exchanges: cexPolicies, ready: cexPoliciesReady } = useCEXPermissions();
  const [action, setAction] = useState<PoolAction>('fill');
  const [poolExpanded, setPoolExpanded] = useState(true);
  const [openChannelFormExpanded, setOpenChannelFormExpanded] = useState(false);
  const [lightningInventoryExpanded, setLightningInventoryExpanded] = useState(false);
  const [lightningPath, setLightningPath] = useState<TransactionalLiquiditySource>('own_channels');
  const [hubInventoryExpanded, setHubInventoryExpanded] = useState(false);
  const [hubBalanceUnit, setHubBalanceUnit] = useState<HubBalanceUnit>(() => {
    const stored = window.localStorage.getItem(HUB_BALANCE_UNIT_STORAGE_KEY);
    return stored === 'sats' ? 'sats' : 'btc';
  });
  const [transferRoute, setTransferRoute] = useState<TransferRoute>('exchange');
  const [amount, setAmount] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [lndWallet, setLndWallet] = useState<LNDWalletStatus | null>(null);
  const [cexLiquidity, setCexLiquidity] = useState<CexLiquiditySource[]>([]);
  const [selectedCexInventoryAccountID, setSelectedCexInventoryAccountID] = useState<number | null>(null);
  const [cexInventoryPane, setCexInventoryPane] = useState<CexInventoryPane>('balances');
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
  const [, setLspLoading] = useState(true);
  const [savingLsp, setSavingLsp] = useState(false);
  const [lspNotice, setLspNotice] = useState<string | null>(null);
  const [lspError, setLspError] = useState<string | null>(null);
  const [magmaInfo, setMagmaInfo] = useState<MagmaLSPInfo | null>(null);
  const [magmaInfoLoading, setMagmaInfoLoading] = useState(false);
  const [magmaInfoError, setMagmaInfoError] = useState<string | null>(null);
  const [magmaForm, setMagmaForm] = useState({ pool: 'recommended', inboundSats: '', privateChannel: true, expiryBlocks: String(DEFAULT_MAGMA_EXPIRY_BLOCKS) });
  const [magmaOrder, setMagmaOrder] = useState<MagmaLSPOrder | null>(null);
  const [creatingMagmaOrder, setCreatingMagmaOrder] = useState(false);
  const [payingMagmaOrder, setPayingMagmaOrder] = useState(false);
  const [magmaNotice, setMagmaNotice] = useState<string | null>(null);
  const [magmaOffers, setMagmaOffers] = useState<MagmaOffer[]>([]);
  const [magmaOffersLoading, setMagmaOffersLoading] = useState(false);
  const [magmaOffersError, setMagmaOffersError] = useState<string | null>(null);
  const [magmaOffersReload, setMagmaOffersReload] = useState(0);
  const [transactionalSettings, setTransactionalSettings] = useState<TransactionalLiquiditySettings | null>(null);
  const [transactionalForm, setTransactionalForm] = useState({ fiat_currency: 'EUR', amount_source: 'custom' as TransactionalLiquidityAmountSource, amount_fiat: '', trade_mode: 'hedgefull_single_collateral' as TradeMode, target_direction: 'bid' as TransactionalLiquidityTargetDirection, lightning_liquidity_source: 'own_channels' as TransactionalLiquiditySource, supported_routing_profiles: [...DEFAULT_ROUTING_PROFILES], fee_tier: 'economic' as const, coupled_hedge: false });
  const [transactionalLoading, setTransactionalLoading] = useState(true);
  const [transactionalEditing, setTransactionalEditing] = useState(false);
  const [transactionalSaving, setTransactionalSaving] = useState(false);
  const [savingLightningRoute, setSavingLightningRoute] = useState(false);
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
  const pendingChannels = lndWallet?.pending_channels ?? [];
  const selectedChannelPreset = channelPresets.find(preset => preset.id === selectedChannelPresetID);
  const lndOnChainSats = lndAddresses.reduce((sum, address) => sum + (address.balance_sat ?? 0), 0);
  const lspChannelPoint = lspStatus?.configured ? lspStatus.channel_point : lspConfig.channel_point;
  const lspLiquidityChannel = channels.find(channel => channel.channel_point === lspChannelPoint);
  const ownLiquidityChannels = channels.filter(channel => channel.channel_point !== lspChannelPoint);
  const ownCapacitySats = ownLiquidityChannels.reduce((sum, channel) => sum + channel.capacity_sat, 0);
  const ownOutboundSats = ownLiquidityChannels.reduce((sum, channel) => sum + channel.local_balance_sat, 0);
  const ownInboundSats = ownLiquidityChannels.reduce((sum, channel) => sum + channel.remote_balance_sat, 0);
  const lightningRoutingSource = transactionalSettings?.lightning_liquidity_source ?? 'own_channels';
  const routingCapacitySats = lightningRoutingSource === 'lsp_channel'
    ? (lspLiquidityChannel?.capacity_sat ?? 0)
    : ownCapacitySats;
  const incompleteSwaps = submarineSwaps.filter(item => !['settled', 'refunded'].includes(item.state));
  const magmaChainReady = magmaInfo?.chain_ready ?? lndWallet?.node?.synced_to_chain ?? false;
  const magmaBlockHeight = magmaInfo?.block_height ?? lndWallet?.node?.block_height;
  const lightningOutboundSat = channels.filter(channel => channel.active).reduce((sum, channel) => sum + (channel.local_balance_sat || 0), 0);
  const magmaOutboundSat = magmaInfo?.outbound_sat ?? lightningOutboundSat;
  const magmaConfirmedSat = magmaInfo?.confirmed_balance_sat ?? lndOnChainSats;
  const magmaWalletReady = magmaInfo != null ? magmaInfo.wallet_ready !== false && magmaOutboundSat > 0 : magmaOutboundSat > 0;
  const magmaCanCreate = magmaChainReady && magmaWalletReady;
  const totalCexFiatValue = useMemo(() => cexLiquidity.reduce((sum, source) => sum + source.spotAssets.reduce((assetSum, balance) => {
    if (balance.asset === filters.fiat) return assetSum + balance.available;
    if (balance.asset === 'BTC' && refPrice != null) return assetSum + balance.available * refPrice;
    return assetSum;
  }, 0), 0), [cexLiquidity, filters.fiat, refPrice]);
  const selectedCexInventory = cexLiquidity.find(source => source.accountID === selectedCexInventoryAccountID) ?? cexLiquidity[0] ?? null;
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
  const routingProfiles = transactionalSettings
    ? normalizeSupportedRoutingProfiles(transactionalSettings.supported_routing_profiles, transactionalSettings.trade_mode)
    : [];
  // Matches the four target cards: CEX fiat, Mainnet Hub BTC, Lightning BTC,
  // and DEX wallet BTC (currently zero).
  const requiredFiat = transactionalAmount;
  const requiredBitcoin = transactionalSettings?.trade_mode === 'hedgeless_double_collateral'
    ? btcTarget == null ? null : btcTarget * 2
    : 0;
  const requiredCapital = requiredFiat != null && requiredBitcoin != null && refPrice != null && transactionalSettings?.fiat_currency === filters.fiat
    ? requiredFiat + requiredBitcoin * refPrice
    : null;
  const hubRequiredBitcoin = transactionalSettings?.trade_mode === 'hedgeless_double_collateral' ? btcTarget : 0;
  const swapRequiredBitcoin = transactionalSettings?.trade_mode === 'hedgeless_double_collateral' ? btcTarget : 0;
  const selectedRoutingOutboundSat = lightningRoutingSource === 'lsp_channel'
    ? (lspLiquidityChannel?.local_balance_sat ?? 0)
    : ownOutboundSats;
  const hasFreshCexInventory = !liquidityLoading && !cexLiquidityError && cexLiquidity.length > 0;
  const hasFreshLndInventory = !liquidityLoading && !lndLiquidityError && lndWallet != null;
  const cexAtTarget = transactionalAmount != null && hasFreshCexInventory && totalCexFiatValue >= transactionalAmount;
  const hubAtTarget = transactionalSettings != null && hubRequiredBitcoin != null && hasFreshLndInventory && lndOnChainSats / 1e8 >= hubRequiredBitcoin;
  const lightningAtTarget = transactionalSettings != null && swapRequiredBitcoin != null && hasFreshLndInventory && selectedRoutingOutboundSat / 1e8 >= swapRequiredBitcoin;
  const dexAtTarget = !liquidityLoading && !dexLiquidityError && dexPendingLiquidity != null && dexPendingLiquidity.btc_value >= 0;
  const routingProfileStatus: Record<TransactionalRoutingProfile, { ready: boolean; detail: string }> = {
    Direct_main2main: {
      ready: requiredCapital != null && hasFreshCexInventory && totalCexFiatValue >= requiredCapital,
      detail: requiredCapital == null
        ? 'Waiting for matching CEX price'
        : !hasFreshCexInventory
          ? 'CEX inventory unavailable'
          : `${formatFiatValue(totalCexFiatValue, transactionalSettings?.fiat_currency ?? filters.fiat)} available`,
    },
    Hub_main2main: {
      ready: hasFreshLndInventory && hubRequiredBitcoin != null && lndOnChainSats / 1e8 >= hubRequiredBitcoin,
      detail: hubRequiredBitcoin == null
        ? 'Waiting for matching CEX price'
        : !hasFreshLndInventory
          ? 'Mainnet Hub inventory unavailable'
          : `${formatBTC(lndOnChainSats / 1e8)} available`,
    },
    Swap_main2lightning: {
      ready: hasFreshLndInventory && swapRequiredBitcoin != null && selectedRoutingOutboundSat / 1e8 >= swapRequiredBitcoin,
      detail: swapRequiredBitcoin == null
        ? 'Waiting for matching CEX price'
        : !hasFreshLndInventory
          ? 'Lightning inventory unavailable'
          : `${formatBTC(selectedRoutingOutboundSat / 1e8)} available`,
    },
  };

  useEffect(() => {
    window.localStorage.setItem(HUB_BALANCE_UNIT_STORAGE_KEY, hubBalanceUnit);
  }, [hubBalanceUnit]);

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
          supported_routing_profiles: normalizeSupportedRoutingProfiles(settings.supported_routing_profiles, settings.trade_mode),
          fee_tier: settings.fee_tier ?? 'economic',
          coupled_hedge: settings.coupled_hedge ?? false,
        });
        setLightningPath(settings.lightning_liquidity_source ?? 'own_channels');
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
      if (statusResult.status === 'fulfilled') {
        setLspStatus(statusResult.value);
        if (statusResult.value.configured) {
          setLspConfig({
            channel_point: statusResult.value.channel_point,
            remote_pubkey: statusResult.value.remote_pubkey,
            provider_label: statusResult.value.provider_label,
            enabled: statusResult.value.enabled,
            headroom_sat: statusResult.value.headroom_sat,
            max_swap_fee_sat: statusResult.value.max_swap_fee_sat,
            max_swap_fee_ppm: statusResult.value.max_swap_fee_ppm,
            updated_at: statusResult.value.updated_at,
          });
        }
      }
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
    if (lightningPath !== 'lsp_channel') return;
    let active = true;
    setMagmaInfoLoading(true);
    setMagmaInfoError(null);
    void fetchMagmaLSPInfo(magmaForm.pool)
      .then(info => {
        if (!active) return;
        setMagmaInfo(info);
        const minInbound = Number(info.info.min_initial_lsp_balance_sat || 0);
        setMagmaForm(current => ({
          ...current,
          inboundSats: current.inboundSats || (minInbound > 0 ? String(minInbound) : ''),
          expiryBlocks: current.expiryBlocks || String(Math.min(DEFAULT_MAGMA_EXPIRY_BLOCKS, info.info.max_channel_expiry_blocks || DEFAULT_MAGMA_EXPIRY_BLOCKS)),
        }));
      })
      .catch(error => {
        if (!active) return;
        setMagmaInfoError(error instanceof Error ? error.message : 'Could not load Amboss Magma quote info.');
      })
      .finally(() => { if (active) setMagmaInfoLoading(false); });
    return () => { active = false; };
  }, [lightningPath, magmaForm.pool]);

  useEffect(() => {
    if (lightningPath !== 'lsp_channel') return;
    let active = true;
    setMagmaOffersLoading(true);
    setMagmaOffersError(null);
    void fetchMagmaOffers()
      .then(offers => {
        if (active) setMagmaOffers(offers);
      })
      .catch(error => {
        if (!active) return;
        setMagmaOffersError(error instanceof Error ? error.message : 'Could not load the Amboss Magma offer book.');
      })
      .finally(() => { if (active) setMagmaOffersLoading(false); });
    return () => { active = false; };
  }, [lightningPath, magmaOffersReload]);

  useEffect(() => {
    if (!magmaOrder || ['COMPLETED', 'FAILED'].includes(magmaOrder.order_state)) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await fetchMagmaLSPOrder(magmaOrder.id);
        if (!active || !next?.id) return;
        setMagmaOrder(next);
        if (next.order_state === 'COMPLETED') {
          setMagmaNotice(next.auto_registered ? 'Magma channel opened and registered as the LSP channel.' : 'Magma channel opened.');
          setLspStatus(await fetchLSPChannelStatus());
          await refreshLndWallet();
        }
        if (next.order_state === 'FAILED') {
          setMagmaNotice(next.failure_reason || 'Magma order failed.');
        }
      } catch {
        // Keep polling; transient proxy errors should not stop the UI.
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, [magmaOrder?.id, magmaOrder?.order_state]);

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
        lightning_liquidity_source: transactionalForm.lightning_liquidity_source || 'own_channels',
        supported_routing_profiles: normalizeSupportedRoutingProfiles(transactionalForm.supported_routing_profiles, transactionalForm.trade_mode),
        fee_tier: transactionalForm.fee_tier,
        coupled_hedge: transactionalForm.trade_mode === 'hedgefull_single_collateral' && transactionalForm.coupled_hedge,
      });
      setTransactionalSettings(updated);
      setTransactionalForm(current => ({ ...current, amount_fiat: updated.amount_fiat == null ? '' : String(updated.amount_fiat), target_direction: updated.target_direction ?? 'bid', lightning_liquidity_source: updated.lightning_liquidity_source ?? 'own_channels', supported_routing_profiles: normalizeSupportedRoutingProfiles(updated.supported_routing_profiles, updated.trade_mode), fee_tier: updated.fee_tier ?? 'economic', coupled_hedge: updated.coupled_hedge ?? false }));
      setLightningPath(updated.lightning_liquidity_source ?? 'own_channels');
      setTransactionalNotice('Transactional liquidity targets saved.');
      setTransactionalEditing(false);
    } catch (error) {
      setTransactionalError(error instanceof Error ? error.message : 'Could not save transactional liquidity settings.');
    } finally {
      setTransactionalSaving(false);
    }
  };

  const persistLightningRoutingSource = async (source: TransactionalLiquiditySource) => {
    const amountFiat = transactionalSettings?.amount_fiat;
    if (!transactionalSettings || amountFiat == null || amountFiat <= 0) {
      setChannelError('Save a transactional liquidity target before choosing which Lightning path trades should use.');
      setChannelNotice(null);
      return;
    }
    setSavingLightningRoute(true);
    setChannelError(null);
    setChannelNotice(null);
    try {
      const updated = await updateTransactionalLiquiditySettings({
        fiat_currency: transactionalSettings.fiat_currency,
        amount_source: transactionalSettings.amount_source,
        amount_fiat: amountFiat,
        trade_mode: transactionalSettings.trade_mode,
        target_direction: transactionalSettings.target_direction ?? 'bid',
        lightning_liquidity_source: source,
        supported_routing_profiles: normalizeSupportedRoutingProfiles(transactionalSettings.supported_routing_profiles, transactionalSettings.trade_mode),
        fee_tier: transactionalSettings.fee_tier ?? 'economic',
        coupled_hedge: transactionalSettings.coupled_hedge ?? false,
      });
      setTransactionalSettings(updated);
      setTransactionalForm(current => ({
        ...current,
        lightning_liquidity_source: updated.lightning_liquidity_source ?? source,
        supported_routing_profiles: normalizeSupportedRoutingProfiles(updated.supported_routing_profiles, updated.trade_mode),
        target_direction: updated.target_direction ?? 'bid',
        fee_tier: updated.fee_tier ?? 'economic',
        coupled_hedge: updated.coupled_hedge ?? false,
      }));
      setLightningPath(source);
      setChannelNotice(source === 'lsp_channel'
        ? 'Trades will route through the registered LSP channel.'
        : 'Trades will route through your own Lightning channels.');
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : 'Could not save the Lightning routing source.');
    } finally {
      setSavingLightningRoute(false);
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
        supported_routing_profiles: normalizeSupportedRoutingProfiles(transactionalSettings.supported_routing_profiles, transactionalSettings.trade_mode),
        fee_tier: transactionalSettings.fee_tier ?? 'economic',
        coupled_hedge: transactionalSettings.coupled_hedge ?? false,
      });
    }
    setTransactionalEditing(false);
    setTransactionalNotice(null);
    setTransactionalError(null);
  };

  const toggleRoutingProfile = (profile: TransactionalRoutingProfile) => {
    setTransactionalForm(current => {
      const enabled = current.supported_routing_profiles.includes(profile);
      const next = enabled
        ? current.supported_routing_profiles.filter(item => item !== profile)
        : normalizeSupportedRoutingProfiles([...current.supported_routing_profiles, profile], current.trade_mode);
      if (next.length === 0) return current;
      return { ...current, supported_routing_profiles: next };
    });
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
        setSelectedCexInventoryAccountID(current => {
          if (current != null && snapshots.some(source => source.accountID === current)) return current;
          return snapshots[0]?.accountID ?? null;
        });
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

  const selectLspCandidate = (channelPoint: string) => {
    const channel = channels.find(item => item.channel_point === channelPoint);
    setLspConfig(previous => ({
      ...previous,
      channel_point: channel?.channel_point || '',
      remote_pubkey: channel?.remote_pubkey || '',
      provider_label: channel?.remote_alias || previous.provider_label,
      enabled: Boolean(channel),
    }));
  };

  const clearLspChannel = async () => {
    setSavingLsp(true);
    setLspError(null);
    setLspNotice(null);
    try {
      const saved = await updateLSPChannel({ ...emptyLSPConfig });
      setLspConfig(saved);
      setLspStatus(await fetchLSPChannelStatus());
      setLspNotice('LSP channel registration cleared.');
    } catch (error) {
      setLspError(error instanceof Error ? error.message : 'Failed to clear the LSP channel.');
    } finally {
      setSavingLsp(false);
    }
  };

  const createMagmaOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const inboundSats = Number(magmaForm.inboundSats);
    const expiryBlocks = Number(magmaForm.expiryBlocks);
    if (!Number.isFinite(inboundSats) || inboundSats <= 0) {
      setMagmaNotice(null);
      setLspError('Enter a positive inbound capacity in sats.');
      return;
    }
    if (!Number.isFinite(expiryBlocks) || expiryBlocks <= 0) {
      setMagmaNotice(null);
      setLspError('Enter a positive channel expiry in blocks.');
      return;
    }
    if (!magmaChainReady) {
      setMagmaNotice(null);
      setLspError('LND must finish syncing to chain before creating a Magma order.');
      return;
    }
    if (!magmaWalletReady) {
      setMagmaNotice(null);
      setLspError(`LND Lightning outbound is too low to pay a Magma invoice (outbound ${formatSats(magmaOutboundSat)}, confirmed wallet ${formatSats(magmaConfirmedSat)}).`);
      return;
    }
    setCreatingMagmaOrder(true);
    setLspError(null);
    setMagmaNotice(null);
    try {
      const order = await createMagmaLSPOrder({
        pool: magmaForm.pool,
        lsp_balance_sat: inboundSats,
        announce_channel: !magmaForm.privateChannel,
        channel_expiry_blocks: expiryBlocks,
      });
      setMagmaOrder(order);
      setMagmaNotice('Magma order created. Pay the invoice from LND or copy it for manual payment.');
    } catch (error) {
      setLspError(error instanceof Error ? error.message : 'Could not create the Magma order.');
    } finally {
      setCreatingMagmaOrder(false);
    }
  };

  const payMagmaOrderFromLnd = async () => {
    if (!magmaOrder) return;
    if (!magmaWalletReady || magmaOutboundSat < (magmaOrder.order_total_sat || 0)) {
      setMagmaNotice(null);
      setLspError(`LND Lightning outbound is too low to pay this Magma invoice (outbound ${formatSats(magmaOutboundSat)}, invoice ${formatSats(magmaOrder.order_total_sat || 0)}).`);
      return;
    }
    setPayingMagmaOrder(true);
    setLspError(null);
    setMagmaNotice(null);
    try {
      const order = await payMagmaLSPOrder(magmaOrder.id);
      setMagmaOrder(order);
      setMagmaNotice('Invoice payment submitted from LND. Waiting for Magma to open the channel.');
    } catch (error) {
      setLspError(error instanceof Error ? error.message : 'Could not pay the Magma invoice from LND.');
    } finally {
      setPayingMagmaOrder(false);
    }
  };

  const copyMagmaInvoice = async () => {
    if (!magmaOrder?.bolt11_invoice) return;
    try {
      await navigator.clipboard.writeText(magmaOrder.bolt11_invoice);
      setMagmaNotice('Invoice copied to clipboard.');
    } catch {
      setLspError('Could not copy the invoice to the clipboard.');
    }
  };

  const applyMagmaOffer = (offer: MagmaOffer) => {
    const maxExpiry = Number(magmaInfo?.info.max_channel_expiry_blocks || 0);
    setMagmaForm(current => {
      const requested = Number(current.inboundSats);
      const maxSize = Math.max(offer.max_size_sat, offer.min_size_sat);
      const inbound = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : offer.min_size_sat, offer.min_size_sat), maxSize);
      const minExpiry = Math.max(offer.min_block_length || 1, 1);
      const currentExpiry = Number(current.expiryBlocks);
      let expiryBlocks = Number.isFinite(currentExpiry) && currentExpiry > 0 ? Math.max(currentExpiry, minExpiry) : minExpiry;
      if (maxExpiry > 0) expiryBlocks = Math.min(expiryBlocks, maxExpiry);
      return { ...current, inboundSats: String(inbound), expiryBlocks: String(expiryBlocks) };
    });
    setLspError(null);
    setMagmaNotice(`Prefilled from offer ${shortAddress(offer.id)}: inbound clamped to ${formatSats(offer.min_size_sat)}–${formatSats(offer.max_size_sat)}, expiry at least ${offer.min_block_length} blocks. Magma matches orders automatically; the closer the conditions the likelier this seller is picked.`);
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
            <div className="liquidity-allocation-card__figures"><button type="button" className="liquidity-allocation-card__current liquidity-cex-summary" aria-expanded={cexInventoryExpanded} aria-controls="cex-inventory-details" onClick={() => setCexInventoryExpanded(current => !current)}><div className="liquidity-value-label">Current inventory</div>{liquidityLoading && cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">Loading…</span> : cexLiquidityError && cexLiquidity.length === 0 ? <span className="text-red text-[0.7rem]">Unavailable</span> : cexLiquidity.length === 0 ? <span className="text-muted text-[0.7rem]">No connected CEX</span> : <strong className="liquidity-cex-summary__value">{formatFiatValue(totalCexFiatValue, filters.fiat)}</strong>}</button><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={targetFiat} /></div><LiquidityTargetIndicator atOrAbove={cexAtTarget} /></div>
            {cexInventoryExpanded && <div id="cex-inventory-details" className="liquidity-cex-inventory" aria-label="CEX inventory details">
              {cexLiquidity.length > 0 && selectedCexInventory
                ? <section className="liquidity-cex-inventory__exchange">
                  <div className="liquidity-cex-inventory__exchange-header">
                    <label>
                      <span>Exchange</span>
                      <select aria-label="CEX inventory exchange" value={selectedCexInventory.accountID} onChange={event => setSelectedCexInventoryAccountID(Number(event.target.value))}>
                        {cexLiquidity.map(source => {
                          const duplicateName = cexLiquidity.filter(item => item.provider === source.provider).length > 1;
                          return <option key={source.accountID} value={source.accountID}>{duplicateName ? `${source.provider} · ${source.accountID}` : source.provider}</option>;
                        })}
                      </select>
                    </label>
                    <span>{selectedCexInventory.error ? selectedCexInventory.error : 'Connected'}</span>
                  </div>
                  <div className="liquidity-cex-inventory__tabs" role="tablist" aria-label="CEX inventory sections">
                    {CEX_INVENTORY_PANES.map(pane => (
                      <button
                        key={pane.id}
                        type="button"
                        role="tab"
                        id={`cex-inventory-tab-${pane.id}`}
                        aria-controls={`cex-inventory-panel-${pane.id}`}
                        aria-selected={cexInventoryPane === pane.id}
                        className={cexInventoryPane === pane.id ? 'is-selected' : ''}
                        onClick={() => setCexInventoryPane(pane.id)}
                      >
                        {pane.label}
                      </button>
                    ))}
                  </div>
                  {cexInventoryPane === 'balances'
                    ? <div id="cex-inventory-panel-balances" role="tabpanel" aria-labelledby="cex-inventory-tab-balances">
                      <div className="liquidity-cex-inventory__location"><div className="liquidity-cex-inventory__location-title"><span>Spot</span><small>{selectedCexInventory.spotAssets.length} asset{selectedCexInventory.spotAssets.length === 1 ? '' : 's'}</small></div>{selectedCexInventory.spotAssets.length > 0 ? <div className="liquidity-cex-inventory__assets">{selectedCexInventory.spotAssets.map(balance => <div key={`${balance.asset}-${balance.total}`}><span>{balance.asset}</span><span className="mono-nums">{formatAssetAmount(balance.available)} available</span><span className="mono-nums text-muted">{formatAssetAmount(balance.total)} total</span></div>)}</div> : <p>No spot balances returned.</p>}</div>
                      <div className="liquidity-cex-inventory__location"><div className="liquidity-cex-inventory__location-title"><span>Futures</span><small>{selectedCexInventory.activeHedges.length} active hedge{selectedCexInventory.activeHedges.length === 1 ? '' : 's'}</small></div>{selectedCexInventory.activeHedges.length > 0 ? <div className="liquidity-cex-inventory__assets">{selectedCexInventory.activeHedges.map((hedge, index) => <div key={`${hedge.transaction_id ?? index}-${hedge.instrument ?? hedge.venue ?? 'hedge'}`}><span>{hedge.instrument || hedge.venue || 'BTC perpetual'}</span><span>{hedge.direction || 'Hedge'}</span><span className="mono-nums text-muted">{formatBTC(Math.abs(hedge.size_btc ?? 0))}</span></div>)}</div> : <p>No active futures positions.</p>}</div>
                    </div>
                    : <div id={`cex-inventory-panel-${cexInventoryPane}`} role="tabpanel" aria-labelledby={`cex-inventory-tab-${cexInventoryPane}`}>
                      <CexInventoryComingSoon detail={CEX_INVENTORY_PANES.find(pane => pane.id === cexInventoryPane)?.soon ?? ''} />
                    </div>}
                </section>
                : <p className="liquidity-cex-inventory__empty">No connected CEX.</p>}
            </div>}
          </div>

          <div role="listitem" className={`liquidity-allocation-card liquidity-allocation-card--lnd ${hubInventoryExpanded ? 'is-expanded' : ''}`}>
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">02</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">Mainnet Hub Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">On-chain wallet reserve</div></div><div className="liquidity-hub-heading__controls"><HubBalanceUnitToggle unit={hubBalanceUnit} onChange={setHubBalanceUnit} /><button type="button" className="liquidity-hub-summary__toggle" aria-label={hubInventoryExpanded ? 'Collapse Mainnet Hub liquidity' : 'Expand Mainnet Hub liquidity'} aria-expanded={hubInventoryExpanded} aria-controls="hub-workspace" onClick={() => setHubInventoryExpanded(current => !current)}>{hubInventoryExpanded ? '⌃' : '⌄'}</button></div></div>
            <div className="liquidity-allocation-card__figures"><button type="button" className="liquidity-allocation-card__current liquidity-hub-summary" aria-expanded={hubInventoryExpanded} aria-controls="hub-workspace" onClick={() => setHubInventoryExpanded(current => !current)}><div className="liquidity-value-label">Current balance</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <strong className="liquidity-hub-summary__value">{formatHubBalance(lndOnChainSats, hubBalanceUnit)}</strong>}</button><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={lndTargetBTC} /></div><LiquidityTargetIndicator atOrAbove={hubAtTarget} /></div>
            {hubInventoryExpanded && (
              <div id="hub-workspace" className="hub-workspace">
                <div id="hub-inventory-details" className={`liquidity-hub-inventory ${hubBalanceUnit === 'sats' ? 'is-sats' : 'is-btc'}`} aria-label="Mainnet Hub address details">
                  {lndAddresses.length > 0
                    ? lndAddresses.map(address => (
                      <HubInventoryAddress
                        key={address.address}
                        label={address.label || 'Mainnet address'}
                        address={address.address}
                        balanceSat={address.balance_sat ?? 0}
                        balanceUnit={hubBalanceUnit}
                        whitelistedBy={address.whitelisted_by}
                      />
                    ))
                    : <p>No on-chain addresses returned by the Mainnet Hub.</p>}
                </div>

                <section className="hub-move" aria-labelledby="pool-transfer-heading">
                  <div className="hub-move__toolbar">
                    <div>
                      <h4 id="pool-transfer-heading">Move funds</h4>
                      <p>Fill the on-chain wallet from an exchange or external address, or drain BTC out of LND.</p>
                    </div>
                    <div className="hub-move__toolbar-aside">
                      <div className="hub-move__available">
                        <span>Available</span>
                        <strong className="mono-nums">{formatHubBalance(lndOnChainSats, hubBalanceUnit)}</strong>
                      </div>
                      <button
                        type="button"
                        className="hub-move__toggle"
                        aria-expanded={poolExpanded}
                        aria-controls="wallet-pool-controls"
                        onClick={() => setPoolExpanded(current => !current)}
                      >
                        <span>{poolExpanded ? 'Hide form' : 'Set up transfer'}</span>
                        <span className="hub-move__toggle-icon" aria-hidden="true">{poolExpanded ? '⌃' : '⌄'}</span>
                      </button>
                    </div>
                  </div>

                  {poolExpanded && (
                    <form id="wallet-pool-controls" onSubmit={submit} className="hub-move__form" noValidate>
                      <div className="hub-move__chooser" role="group" aria-label="Pool transfer direction">
                        <button type="button" aria-pressed={action === 'fill'} className={action === 'fill' ? 'is-selected' : ''} onClick={() => selectAction('fill')}>
                          <strong>Fill LND pool</strong>
                          <span>Send BTC into the hub wallet.</span>
                        </button>
                        <button type="button" aria-pressed={action === 'drain'} className={action === 'drain' ? 'is-selected' : ''} onClick={() => selectAction('drain')}>
                          <strong>Drain LND pool</strong>
                          <span>Send on-chain BTC out of LND.</span>
                        </button>
                      </div>

                      <div className="hub-move__route" role="group" aria-label="Transfer route">
                        <button type="button" aria-pressed={transferRoute === 'exchange'} className={transferRoute === 'exchange' ? 'is-selected' : ''} onClick={() => selectRoute('exchange')}>Connected exchange</button>
                        <button type="button" aria-pressed={transferRoute === 'manual'} className={transferRoute === 'manual' ? 'is-selected' : ''} onClick={() => selectRoute('manual')}>Manual address</button>
                      </div>

                      {action === 'fill' && transferRoute === 'manual' ? (
                        <div className="hub-move__deposit">
                          <span className="hub-move__label">LND deposit address</span>
                          {selectedDestination ? (
                            <div className="hub-move__deposit-body">
                              <LocalQrCode
                                value={`bitcoin:${selectedDestination}`}
                                alt="QR code for the LND Bitcoin deposit address"
                                size={148}
                                fallback="Could not generate QR code."
                              />
                              <div className="hub-move__deposit-address">
                                <span className="hub-move__label">Send Bitcoin to this address</span>
                                <div className="hub-move__deposit-value">
                                  <code>{selectedDestination}</code>
                                  <div className="liquidity-hub-inventory__address-actions">
                                    <HubAddressCopyButton address={selectedDestination} />
                                    <a
                                      href={bitcoinAddressExplorerUrl(selectedDestination)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="liquidity-hub-inventory__action"
                                      aria-label="View address on mempool.space"
                                      title="View on mempool.space"
                                    >
                                      <ExternalLinkIcon />
                                    </a>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="hub-move__empty">No LND on-chain address available.</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="hub-move__fields">
                            {transferRoute === 'exchange' ? (
                              <label>
                                <span>Exchange account</span>
                                <select value={selectedExchangeID} onChange={event => { setSelectedExchangeID(event.target.value); setFeedback(null); }} disabled={loadingAccounts || connectedExchanges.length === 0}>
                                  {loadingAccounts && <option>Loading connections…</option>}
                                  {!loadingAccounts && connectedExchanges.length === 0 && <option>No connected exchange available</option>}
                                  {connectedExchanges.map(account => <option key={account.id} value={account.id}>{account.provider}</option>)}
                                </select>
                              </label>
                            ) : (
                              <label>
                                <span>{action === 'fill' ? 'Source BTC address' : 'Destination BTC address'}</span>
                                <input type="text" value={manualAddress} onChange={event => { setManualAddress(event.target.value); setFeedback(null); }} placeholder="Paste a Bitcoin address" />
                              </label>
                            )}
                            <label>
                              <span>Amount to move</span>
                              <div className="hub-move__amount">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  step="any"
                                  value={amount}
                                  onChange={event => { setAmount(event.target.value); setFeedback(null); }}
                                  placeholder={hubBalanceUnit === 'sats' ? '0' : '0.00000000'}
                                  className="mono-nums"
                                  aria-label="Amount to move"
                                />
                                <span>{hubBalanceUnit === 'sats' ? 'sats' : 'BTC'}</span>
                              </div>
                            </label>
                            {!(transferRoute === 'manual' && action === 'drain') && (
                              <label className="hub-move__destination">
                                <span>Destination BTC address</span>
                                <select value={selectedDestination} onChange={event => { setSelectedDestination(event.target.value); setFeedback(null); }} disabled={loadingDestination || destinationOptions.length === 0}>
                                  {loadingDestination && <option>Loading BTC addresses…</option>}
                                  {!loadingDestination && destinationOptions.length === 0 && <option>No BTC destination address available</option>}
                                  {destinationOptions.map(option => <option key={option.address} value={option.address}>{option.label} · {option.network} · {shortAddress(option.address)}</option>)}
                                </select>
                              </label>
                            )}
                          </div>

                          <div className="hub-move__review">
                            <div className="hub-move__path">
                              <div><span>From</span><strong>{sourceLabel}</strong></div>
                              <i aria-hidden="true">→</i>
                              <div><span>To</span><strong>{destinationLabel}</strong></div>
                            </div>
                            <div className="hub-move__submit">
                              <p>Creates a request only; funds are not sent yet.</p>
                              <button type="submit">Create transfer request</button>
                            </div>
                          </div>
                        </>
                      )}

                      {loadError && <p className="hub-move__alert" role="alert">{loadError}</p>}
                      {feedback && <p className="hub-move__notice" role="status">{feedback}</p>}
                    </form>
                  )}
                </section>
              </div>
            )}
          </div>

          <div role="listitem" className={`liquidity-allocation-card liquidity-allocation-card--lightning ${lightningInventoryExpanded ? 'is-expanded' : ''}`}>
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">03</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">Lightning Channel Liquidity</div><div className="text-[0.65rem] text-muted mt-0.5">Ready-to-route capacity</div></div><button type="button" className="liquidity-lightning-summary__toggle" aria-label={lightningInventoryExpanded ? 'Collapse Lightning liquidity' : 'Expand Lightning liquidity'} aria-expanded={lightningInventoryExpanded} aria-controls="lightning-inventory-details" onClick={() => setLightningInventoryExpanded(current => !current)}>{lightningInventoryExpanded ? '⌃' : '⌄'}</button></div>
            <div className="liquidity-allocation-card__figures"><button type="button" className="liquidity-allocation-card__current liquidity-lightning-summary" aria-expanded={lightningInventoryExpanded} aria-controls="lightning-inventory-details" onClick={() => setLightningInventoryExpanded(current => !current)}><div className="liquidity-value-label">Current channel balance</div>{liquidityLoading && !lndWallet ? <span className="text-muted text-[0.7rem]">Loading…</span> : lndLiquidityError && !lndWallet ? <span className="text-red text-[0.7rem]">Unavailable</span> : <strong className="liquidity-lightning-summary__value">{formatBTC(routingCapacitySats / 1e8)}</strong>}</button><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={lndTargetBTC} /></div><LiquidityTargetIndicator atOrAbove={lightningAtTarget} /></div>
            {lightningInventoryExpanded && <div id="lightning-inventory-details" className="lightning-workspace" aria-label="Lightning channel workspace">
              <div className="lightning-workspace__chooser" role="tablist" aria-label="Lightning liquidity path">
                <button type="button" role="tab" id="lightning-path-own" aria-controls="lightning-pane-own" aria-selected={lightningPath === 'own_channels'} className={lightningPath === 'own_channels' ? 'is-selected' : ''} onClick={() => setLightningPath('own_channels')}>
                  <strong>Own liquidity</strong>
                  <span>Open channels funded from your LND on-chain wallet.</span>
                  {lightningRoutingSource === 'own_channels' && <em>Used for routing</em>}
                </button>
                <button type="button" role="tab" id="lightning-path-lsp" aria-controls="lightning-pane-lsp" aria-selected={lightningPath === 'lsp_channel'} className={lightningPath === 'lsp_channel' ? 'is-selected' : ''} onClick={() => setLightningPath('lsp_channel')}>
                  <strong>LSP channel</strong>
                  <span>Buy inbound capacity from Amboss Magma or register an existing LSP channel.</span>
                  {lightningRoutingSource === 'lsp_channel' && <em>Used for routing</em>}
                </button>
              </div>

              {lightningPath === 'own_channels' && <div id="lightning-pane-own" role="tabpanel" aria-labelledby="lightning-path-own" className="lightning-workspace__pane">
                <div className="lightning-workspace__toolbar">
                  <div>
                    <h4>Own Lightning channels</h4>
                    <p>These channels spend your own on-chain BTC. Close unused peers here, or open a new channel below.</p>
                  </div>
                  {lightningRoutingSource === 'own_channels'
                    ? <span className="lightning-workspace__badge">Used for routing</span>
                    : <button type="button" disabled={savingLightningRoute} onClick={() => void persistLightningRoutingSource('own_channels')}>{savingLightningRoute ? 'Saving…' : 'Use own channels for routing'}</button>}
                </div>
                {ownLiquidityChannels.length > 0 && <LightningSplit outboundSat={ownOutboundSats} inboundSat={ownInboundSats} />}
                {ownLiquidityChannels.length > 0
                  ? ownLiquidityChannels.map(channel => (
                    <LightningChannelRow
                      key={channel.channel_point}
                      channel={channel}
                      closing={closingChannelPoint === channel.channel_point}
                      onClose={() => void submitCloseChannel(channel.channel_point, false)}
                      onForceClose={() => void submitCloseChannel(channel.channel_point, true)}
                    />
                  ))
                  : <p className="lightning-workspace__empty">No own-liquidity channels yet. Open one below with funds from the Mainnet Hub wallet.</p>}
                {pendingChannels.length > 0 && <section className="lightning-pending" aria-label="Pending channels">
                  <h5>Pending confirmation</h5>
                  {pendingChannels.map(channel => (
                    <div key={`${channel.remote_pubkey}-${channel.state}`} className="lightning-pending__row">
                      <strong>{channel.remote_alias || shortAddress(channel.remote_pubkey)}</strong>
                      <span>{channel.state || 'pending'}</span>
                      <span>{formatSats(channel.capacity_sat)}</span>
                    </div>
                  ))}
                </section>}
                <form onSubmit={event => void submitOpenChannel(event)} className="lightning-open-form" noValidate>
                  <div className="lightning-open-form__intro">
                    <div className="lightning-open-form__intro-copy">
                      <h5>Open a channel</h5>
                      <p>Funds come from the LND on-chain wallet. The channel stays pending until the funding transaction confirms.</p>
                    </div>
                    <button type="button" className="lightning-open-form__toggle" aria-expanded={openChannelFormExpanded} aria-controls="open-channel-form-details" onClick={() => setOpenChannelFormExpanded(current => !current)}>
                      <span>{openChannelFormExpanded ? 'Hide form' : 'Configure'}</span>
                      <span className="lightning-open-form__toggle-icon" aria-hidden="true">{openChannelFormExpanded ? '⌃' : '⌄'}</span>
                    </button>
                  </div>
                  {openChannelFormExpanded && <div id="open-channel-form-details" className="lightning-open-form__details">
                    <label><span>Public node (optional)</span><select value={selectedChannelPresetID} onChange={event => setSelectedChannelPresetID(event.target.value)}><option value="">Manual connection details</option>{channelPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
                    {selectedChannelPreset && <div className="lightning-open-form__preset"><div><span>{selectedChannelPreset.name}</span> · {selectedChannelPreset.peer_host}</div><div>Minimum funding: {formatSats(selectedChannelPreset.min_funding_amount_sat)}</div>{selectedChannelPreset.warning && <div className="text-peach">{selectedChannelPreset.warning}</div>}<a href={selectedChannelPreset.source_url} target="_blank" rel="noreferrer">Source · verified {selectedChannelPreset.verified_at}</a></div>}
                    <label><span>Node pubkey</span><input disabled={!!selectedChannelPreset} value={channelForm.nodePubkey} onChange={event => setChannelForm(current => ({ ...current, nodePubkey: event.target.value }))} placeholder="Remote node public key" /></label>
                    <label><span>Peer host (optional)</span><input disabled={!!selectedChannelPreset} value={channelForm.peerHost} onChange={event => setChannelForm(current => ({ ...current, peerHost: event.target.value }))} placeholder="node.example:9735" /></label>
                    <label><span>Local funding (sats)</span><input type="number" min="1" step="1" value={channelForm.fundingSats} onChange={event => setChannelForm(current => ({ ...current, fundingSats: event.target.value }))} placeholder="1000000" /></label>
                    <div className="lightning-open-form__pair">
                      <label><span>Push sats</span><input type="number" min="0" step="1" value={channelForm.pushSats} onChange={event => setChannelForm(current => ({ ...current, pushSats: event.target.value }))} placeholder="0" /></label>
                      <label><span>Fee (sat/vB)</span><input type="number" min="1" step="1" value={channelForm.feeRate} onChange={event => setChannelForm(current => ({ ...current, feeRate: event.target.value }))} /></label>
                    </div>
                    <label className="lightning-open-form__check"><input type="checkbox" checked={channelForm.private} onChange={event => setChannelForm(current => ({ ...current, private: event.target.checked }))} /> Private channel</label>
                    <div className="lightning-open-form__submit"><button type="submit" disabled={openingChannel}>{openingChannel ? 'Opening channel…' : 'Open channel'}</button><span>A confirmation is required before LND receives the request.</span></div>
                  </div>}
                </form>
                {(channelError || channelNotice) && <p className={channelError ? 'lightning-workspace__alert' : 'lightning-workspace__notice'} role={channelError ? 'alert' : 'status'}>{channelError || channelNotice}</p>}
              </div>}

              {lightningPath === 'lsp_channel' && <div id="lightning-pane-lsp" role="tabpanel" aria-labelledby="lightning-path-lsp" className="lightning-workspace__pane">
                <section className="lightning-lsp-form" aria-labelledby="magma-lsp-heading">
                  <div className="lightning-workspace__toolbar">
                    <div>
                      <h4 id="magma-lsp-heading">Open via Amboss Magma</h4>
                      <p>Buy inbound capacity through Magma&apos;s BLIP-0051 API, then pay the returned invoice from LND or manually.</p>
                    </div>
                  </div>
                  {magmaInfoLoading && <p className="text-muted text-[0.7rem]">Loading Magma quote info…</p>}
                  {magmaInfoError && <p className="lightning-workspace__alert" role="alert">{magmaInfoError}</p>}
                  {!magmaChainReady && !magmaInfoLoading && (
                    <p className="lightning-workspace__alert" role="alert">
                      LND is still syncing to chain{magmaBlockHeight ? ` (block ${magmaBlockHeight.toLocaleString()})` : ''}. Magma orders stay disabled until sync completes so invoices can be paid and new channels are recognized.
                    </p>
                  )}
                  {magmaChainReady && !magmaWalletReady && !magmaInfoLoading && (
                    <p className="lightning-workspace__alert" role="alert">
                      LND has no spendable Lightning balance to pay a Magma invoice (outbound {formatSats(magmaOutboundSat)}, confirmed wallet {formatSats(magmaConfirmedSat)}). Magma orders stay disabled until outbound channel liquidity is available.
                    </p>
                  )}
                  {magmaInfo && !magmaInfoLoading && (
                    <p className="text-[0.65rem] text-muted">
                      Inbound range {formatSats(Number(magmaInfo.info.min_initial_lsp_balance_sat || 0))} – {formatSats(Number(magmaInfo.info.max_initial_lsp_balance_sat || 0))}
                      {' · '}
                      Node {shortAddress(magmaInfo.public_key)}
                      {' · '}
                      Chain {magmaChainReady ? 'synced' : 'syncing'}
                    </p>
                  )}
                  <form onSubmit={event => { event.preventDefault(); void createMagmaOrder(event); }}>
                    <div className="lightning-lsp-form__fees">
                      <label><span>Seller pool</span>
                        <select aria-label="Magma seller pool" value={magmaForm.pool} onChange={event => setMagmaForm(current => ({ ...current, pool: event.target.value }))}>
                          <option value="recommended">Recommended</option>
                          <option value="cheapest">Cheapest</option>
                        </select>
                      </label>
                      <label><span>Inbound capacity (sats)</span>
                        <input type="number" min="1" aria-label="Inbound capacity (sats)" value={magmaForm.inboundSats} onChange={event => setMagmaForm(current => ({ ...current, inboundSats: event.target.value }))} />
                      </label>
                      <label><span>Channel expiry (blocks)</span>
                        <input type="number" min="1" aria-label="Channel expiry (blocks)" value={magmaForm.expiryBlocks} onChange={event => setMagmaForm(current => ({ ...current, expiryBlocks: event.target.value }))} />
                      </label>
                    </div>
                    <label className="lightning-open-form__check"><input type="checkbox" checked={magmaForm.privateChannel} onChange={event => setMagmaForm(current => ({ ...current, privateChannel: event.target.checked }))} /> Private channel</label>
                    <div className="lightning-lsp-form__actions">
                      <button type="submit" disabled={creatingMagmaOrder || magmaInfoLoading || !magmaCanCreate}>{creatingMagmaOrder ? 'Creating order…' : 'Create Magma order'}</button>
                    </div>
                  </form>
                  <div className="lightning-workspace__toolbar">
                    <div>
                      <h4>Marketplace offers</h4>
                      <p>Live sell offers from the Magma book. Pick one to prefill the order form within that seller&apos;s conditions.</p>
                    </div>
                    <button type="button" disabled={magmaOffersLoading} onClick={() => setMagmaOffersReload(count => count + 1)}>{magmaOffersLoading ? 'Refreshing…' : 'Refresh offers'}</button>
                  </div>
                  {magmaOffersError && <p className="lightning-workspace__alert" role="alert">{magmaOffersError}</p>}
                  {!magmaOffersLoading && !magmaOffersError && magmaOffers.length === 0 && (
                    <p className="text-muted text-[0.7rem]">No enabled sell offers on the Magma book right now.</p>
                  )}
                  {magmaOffers.length > 0 && (
                    <table className="w-full text-[0.65rem]">
                      <thead>
                        <tr className="text-left text-muted">
                          <th className="py-1 pr-2 font-normal">Seller</th>
                          <th className="py-1 pr-2 font-normal">Score</th>
                          <th className="py-1 pr-2 font-normal">Base fee</th>
                          <th className="py-1 pr-2 font-normal">Fee rate (ppm)</th>
                          <th className="py-1 pr-2 font-normal">Size range</th>
                          <th className="py-1 pr-2 font-normal">Min expiry (blocks)</th>
                          <th className="py-1 font-normal"><span className="sr-only">Use offer</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {magmaOffers.map(offer => (
                          <tr key={offer.id} className="border-t border-white/10">
                            <td className="py-1 pr-2"><code title={offer.seller_pubkey}>{shortAddress(offer.seller_pubkey)}</code></td>
                            <td className="py-1 pr-2">{offer.seller_score}</td>
                            <td className="py-1 pr-2">{offer.base_fee} sat{offer.base_fee_cap != null ? ` (cap ${offer.base_fee_cap})` : ''}</td>
                            <td className="py-1 pr-2">{offer.fee_rate}{offer.fee_rate_cap != null ? ` (cap ${offer.fee_rate_cap})` : ''}</td>
                            <td className="py-1 pr-2">{formatSats(offer.min_size_sat)} – {formatSats(offer.max_size_sat)}</td>
                            <td className="py-1 pr-2">{offer.min_block_length}</td>
                            <td className="py-1"><button type="button" onClick={() => applyMagmaOffer(offer)}>Use</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {magmaOrder && (
                    <article className="lightning-channel">
                      <header>
                        <div>
                          <strong>Magma order {shortAddress(magmaOrder.order_id)}</strong>
                          <span>{magmaOrder.order_state}{magmaOrder.payment_state ? ` · ${magmaOrder.payment_state}` : ''}</span>
                        </div>
                      </header>
                      <dl>
                        <div><dt>Total cost</dt><dd>{formatSats(magmaOrder.order_total_sat)}</dd></div>
                        <div><dt>Service fee</dt><dd>{formatSats(magmaOrder.fee_total_sat)}</dd></div>
                        <div><dt>Inbound</dt><dd>{formatSats(magmaOrder.lsp_balance_sat)}</dd></div>
                        {magmaOrder.funding_outpoint && <div><dt>Funding outpoint</dt><dd><code>{magmaOrder.funding_outpoint}</code></dd></div>}
                      </dl>
                      {magmaOrder.bolt11_invoice && !['COMPLETED', 'FAILED'].includes(magmaOrder.order_state) && (
                        <div className="lightning-lsp-form__actions">
                          <button type="button" disabled={payingMagmaOrder || !magmaWalletReady || magmaOutboundSat < (magmaOrder.order_total_sat || 0) || ['HOLD', 'PAID'].includes(magmaOrder.payment_state)} onClick={() => void payMagmaOrderFromLnd()}>{payingMagmaOrder ? 'Paying…' : 'Pay from LND'}</button>
                          <button type="button" onClick={() => void copyMagmaInvoice()}>Copy invoice</button>
                        </div>
                      )}
                      {magmaOrder.auto_registered && <p className="lightning-workspace__notice" role="status">Registered as the active LSP channel.</p>}
                    </article>
                  )}
                  {magmaNotice && <p className="lightning-workspace__notice" role="status">{magmaNotice}</p>}
                </section>
                <div className="lightning-workspace__toolbar">
                  <div>
                    <h4>Registered LSP channel</h4>
                    <p>Pick a live LND channel that an LSP already opened. The monitor uses it for inbound liquidity and submarine-swap fee limits.</p>
                  </div>
                  {lightningRoutingSource === 'lsp_channel'
                    ? <span className="lightning-workspace__badge">Used for routing</span>
                    : <button type="button" disabled={savingLightningRoute || !lspStatus?.configured} onClick={() => void persistLightningRoutingSource('lsp_channel')}>{savingLightningRoute ? 'Saving…' : 'Use LSP channel for routing'}</button>}
                </div>
                {lspStatus?.lsp_healthy && <div className="lightning-lsp-status is-healthy">LSP channel active</div>}
                {lspStatus?.configured && lspStatus.enabled && !lspStatus.lsp_healthy && lspStatus.reason && (
                  <div className="lightning-lsp-status">{lspStatus.reason}</div>
                )}
                {lspLiquidityChannel && <article className="lightning-channel">
                  <header>
                    <div>
                      <strong>{lspConfig.provider_label || lspLiquidityChannel.remote_alias || shortAddress(lspLiquidityChannel.remote_pubkey)}</strong>
                      <span>{lspLiquidityChannel.active ? 'Active' : 'Inactive'}{lspLiquidityChannel.private ? ' · Private' : ''}</span>
                    </div>
                    <code title={lspLiquidityChannel.channel_point}>{shortAddress(lspLiquidityChannel.channel_point)}</code>
                  </header>
                  <LightningSplit outboundSat={lspStatus?.usable_outbound_sat ?? lspLiquidityChannel.local_balance_sat} inboundSat={lspStatus?.usable_inbound_sat ?? lspLiquidityChannel.remote_balance_sat} />
                  <dl>
                    <div><dt>Capacity</dt><dd>{formatSats(lspLiquidityChannel.capacity_sat)}</dd></div>
                    <div><dt>Usable outbound</dt><dd>{formatSats(lspStatus?.usable_outbound_sat ?? lspLiquidityChannel.local_balance_sat)}</dd></div>
                    <div><dt>Usable inbound</dt><dd>{formatSats(lspStatus?.usable_inbound_sat ?? lspLiquidityChannel.remote_balance_sat)}</dd></div>
                  </dl>
                </article>}
                <form className="lightning-lsp-form" onSubmit={event => { event.preventDefault(); void saveLspChannel(); }}>
                  <h5>Register or update</h5>
                  <label><span>LND channel</span><select aria-label="LND channel" value={lspConfig.channel_point} onChange={event => selectLspCandidate(event.target.value)}>
                    <option value="">Choose a live LND channel…</option>
                    {channels.map(channel => <option key={channel.channel_point} value={channel.channel_point}>{channel.remote_alias || shortAddress(channel.remote_pubkey)} · {formatSats(channel.capacity_sat)} · {channel.active ? 'active' : 'inactive'}</option>)}
                  </select></label>
                  <div className="lightning-lsp-form__fees">
                    <label><span>Headroom (sats)</span><input type="number" min="0" aria-label="Headroom (sats)" value={lspConfig.headroom_sat} onChange={event => setLspConfig(previous => ({ ...previous, headroom_sat: Number(event.target.value) }))} /></label>
                    <label><span>Maximum fee (sats)</span><input type="number" min="1" aria-label="Maximum fee (sats)" value={lspConfig.max_swap_fee_sat} onChange={event => setLspConfig(previous => ({ ...previous, max_swap_fee_sat: Number(event.target.value) }))} /></label>
                    <label><span>Maximum fee (ppm)</span><input type="number" min="1" aria-label="Maximum fee (ppm)" value={lspConfig.max_swap_fee_ppm} onChange={event => setLspConfig(previous => ({ ...previous, max_swap_fee_ppm: Number(event.target.value) }))} /></label>
                  </div>
                  {lspStatus?.configured && <div className="lightning-lsp-form__stats"><span>LSP outbound {formatSats(lspStatus.lsp_outbound_sat)}</span><span>LSP inbound {formatSats(lspStatus.lsp_inbound_sat)}</span></div>}
                  {incompleteSwaps.length > 0 && <p className="lightning-workspace__warn">{incompleteSwaps.length} incomplete or refund-pending submarine swap(s) require attention.</p>}
                  <div className="lightning-lsp-form__actions">
                    <button type="submit" disabled={savingLsp || !lspConfig.channel_point}>{savingLsp ? 'Saving…' : 'Save LSP selection'}</button>
                    {lspStatus?.configured && <button type="button" disabled={savingLsp} onClick={() => void clearLspChannel()}>Clear registration</button>}
                  </div>
                </form>
                {(lspError || lspNotice || channelError || channelNotice) && <p className={lspError || channelError ? 'lightning-workspace__alert' : 'lightning-workspace__notice'} role={lspError || channelError ? 'alert' : 'status'}>{lspError || channelError || lspNotice || channelNotice}</p>}
              </div>}
            </div>}
          </div>

          <div role="listitem" className="liquidity-allocation-card liquidity-allocation-card--dex">
            <div className="liquidity-allocation-card__heading"><span className="liquidity-allocation-card__marker">04</span><div className="min-w-0"><div className="text-[0.75rem] font-semibold text-text">DEX Wallet / Pending Contracts</div><div className="text-[0.65rem] text-muted mt-0.5">Settlement collateral</div></div></div>
            <div className="liquidity-allocation-card__figures"><div className="liquidity-allocation-card__current"><div className="liquidity-value-label">Current</div>{liquidityLoading && !dexPendingLiquidity ? <span className="text-muted text-[0.7rem]">Loading…</span> : dexLiquidityError && !dexPendingLiquidity ? <span className="text-red text-[0.7rem]">Unavailable</span> : dexPendingLiquidity ? <strong className="liquidity-allocation-card__value">{formatBTC(dexPendingLiquidity.btc_value)}</strong> : <span className="text-red text-[0.7rem]">Unavailable</span>}</div><div className="liquidity-allocation-card__target"><div className="liquidity-value-label">Target</div><TargetCell value={formatBTC(0)} /></div><LiquidityTargetIndicator atOrAbove={dexAtTarget} /></div>
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
            {!transactionalLoading && transactionalSettings && !transactionalEditing && <div className={`liquidity-target-summary${transactionalSettings.amount_source === 'custom' || !swapRoutingEnabled(routingProfiles) ? ' is-compact' : ''}`}>
              <div><span>Target</span><strong>{transactionalAmount != null ? formatFiatValue(transactionalAmount, transactionalSettings.fiat_currency) : 'Not configured'}</strong></div>
              {transactionalSettings.amount_source !== 'custom' && <div><span>Source</span><strong>Capped volume</strong></div>}
              <div><span>Mode</span><strong>{transactionalSettings.trade_mode === 'hedgeless_double_collateral' ? 'Hedgeless' : 'Hedgefull'}</strong></div>
              <div><span>Direction</span><strong className="capitalize">{transactionalSettings.target_direction ?? 'bid'}</strong></div>
              {swapRoutingEnabled(routingProfiles) && <div><span>Lightning</span><strong>{transactionalSettings.lightning_liquidity_source === 'lsp_channel' ? 'LSP Collateral' : 'Own Collateral'}</strong></div>}
              <div><span>Routing</span><strong>{formatRoutingProfiles(routingProfiles)}</strong></div>
              <div><span>Fees</span><strong>{transactionalSettings.trade_mode === 'hedgefull_single_collateral' ? `Economic · ${transactionalSettings.coupled_hedge ? 'coupled hedge' : 'independent hedge'}` : 'Economic'}</strong></div>
              <button type="button" onClick={() => { setTransactionalEditing(true); setTransactionalNotice(null); }}>Edit</button>
            </div>}
          </div>
          {(!transactionalSettings || transactionalEditing || transactionalLoading) && <form onSubmit={saveTransactionalSettings} className="liquidity-target-form" noValidate>
            <label>
              <span>Fiat</span>
              <select aria-label="Preferred fiat" value={transactionalForm.fiat_currency} onChange={event => setTransactionalForm(current => ({ ...current, fiat_currency: event.target.value }))}>
                {FIAT_OPTIONS.map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </label>
            <label>
              <span>Mode</span>
              <select aria-label="Trade mode" value={transactionalForm.trade_mode} onChange={event => setTransactionalForm(current => {
                const tradeMode = event.target.value as TradeMode;
                return {
                  ...current,
                  trade_mode: tradeMode,
                  coupled_hedge: tradeMode === 'hedgefull_single_collateral' ? current.coupled_hedge : false,
                  supported_routing_profiles: normalizeSupportedRoutingProfiles(current.supported_routing_profiles, tradeMode),
                };
              })}>
                {TRADE_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>Direction</span>
              <select aria-label="Target direction" value={transactionalForm.target_direction} onChange={event => setTransactionalForm(current => ({ ...current, target_direction: event.target.value as TransactionalLiquidityTargetDirection }))}>
                <option value="bid">Bid</option>
                <option value="ask">Ask</option>
              </select>
            </label>
            {swapRoutingEnabled(transactionalForm.supported_routing_profiles) && <label>
              <span>Lightning</span>
              <select aria-label="Lightning liquidity source" required value={transactionalForm.lightning_liquidity_source} onChange={event => setTransactionalForm(current => ({ ...current, lightning_liquidity_source: event.target.value as TransactionalLiquiditySource }))}>
                <option value="own_channels">Own Collateral</option>
                <option value="lsp_channel">LSP Collateral</option>
              </select>
            </label>}
            <div className="liquidity-target-routing">
              <span>Routing</span>
              <div className="liquidity-target-routing__toggles" role="group" aria-label="Supported routing profiles">
                {routingProfileOptions(transactionalForm.trade_mode).map(option => {
                  const selected = transactionalForm.supported_routing_profiles.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${option.label} routing`}
                      className={selected ? 'is-selected' : ''}
                      onClick={() => toggleRoutingProfile(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="liquidity-target-amount">
              <span>Amount</span>
              <div className="liquidity-target-amount__controls">
                <select aria-label="Amount source" value={transactionalForm.amount_source} onChange={event => setTransactionalForm(current => ({ ...current, amount_source: event.target.value as TransactionalLiquidityAmountSource }))}>
                  <option value="custom">Custom</option>
                  <option value="capped_volume">Capped</option>
                </select>
                <label>
                  <span className="sr-only">Transactional liquidity ({transactionalForm.fiat_currency})</span>
                  <input
                    type="number"
                    min={0}
                    max={999999}
                    step={50}
                    inputMode="numeric"
                    readOnly={transactionalForm.amount_source === 'capped_volume'}
                    value={transactionalForm.amount_source === 'capped_volume' ? (maxFiatLimit != null && maxFiatLimit > 0 ? String(maxFiatLimit) : '') : transactionalForm.amount_fiat}
                    onChange={event => setTransactionalForm(current => ({ ...current, amount_fiat: event.target.value.slice(0, 6) }))}
                    placeholder={transactionalForm.fiat_currency}
                    className="mono-nums"
                  />
                </label>
              </div>
              {transactionalForm.amount_source === 'capped_volume' && <p>Uses the Max Position Size (Fiat) from Settings.</p>}
            </div>
            <label>
              <span>Fees</span>
              <select aria-label="Miner fee tier" value={transactionalForm.fee_tier} disabled><option value="economic">Economic</option></select>
            </label>
            {transactionalForm.trade_mode === 'hedgefull_single_collateral' && (
              <label className="liquidity-target-coupled">
                <input type="checkbox" checked={transactionalForm.coupled_hedge} onChange={event => setTransactionalForm(current => ({ ...current, coupled_hedge: event.target.checked }))} />
                Coupled hedge
              </label>
            )}
            <div className="liquidity-target-save">
              <button type="submit" disabled={transactionalSaving || transactionalLoading}>{transactionalSaving ? 'Saving…' : 'Save'}</button>
              {transactionalSettings && <button type="button" onClick={cancelTransactionalEditing} disabled={transactionalSaving}>Cancel</button>}
            </div>
            {(transactionalNotice || transactionalError) && <div className="liquidity-target-feedback" aria-live="polite">{transactionalNotice && <span className="text-green">{transactionalNotice}</span>}{transactionalError && <span className="text-red">{transactionalError}</span>}</div>}
          </form>}
          {(transactionalNotice || transactionalError) && !transactionalEditing && <div className="liquidity-target-feedback text-[0.62rem] mt-2" aria-live="polite">{transactionalNotice && <span className="text-green">{transactionalNotice}</span>}{transactionalError && <span className="text-red">{transactionalError}</span>}</div>}
        </section>
      </section>

      <section aria-labelledby="routing-matrix-heading" className="routing-matrix">
        <div className="routing-matrix__header">
          <div>
            <h4 id="routing-matrix-heading">Routing matrix</h4>
            <p>Capital required across all four liquidity targets and the routing profiles currently available.</p>
          </div>
        </div>
        {!transactionalSettings ? (
          <p className="routing-matrix__empty">Save a transactional liquidity target to calculate routing requirements.</p>
        ) : (
          <>
            <div className="routing-matrix__totals" aria-label="Routing capital requirements">
              <div><span>Total required capital</span><strong>{requiredCapital == null ? 'Waiting for price' : formatFiatValue(requiredCapital, transactionalSettings.fiat_currency)}</strong></div>
              <div><span>Total required fiat</span><strong>{requiredFiat == null ? 'Not configured' : formatFiatValue(requiredFiat, transactionalSettings.fiat_currency)}</strong></div>
              <div><span>Total required bitcoin</span><strong>{requiredBitcoin == null ? 'Waiting for price' : formatBTC(requiredBitcoin)}</strong></div>
            </div>
            <div className="routing-matrix__profiles" aria-label="Available routing profiles">
              {routingProfiles.map(profile => {
                const option = ROUTING_PROFILE_OPTIONS.find(item => item.value === profile);
                const details = routingMatrixDetails(profile, transactionalSettings.trade_mode);
                const status = routingProfileStatus[profile];
                return <article key={profile} className={`routing-matrix__profile ${status.ready ? 'is-ready' : 'is-blocked'}`}>
                  <span className="routing-matrix__profile-status" role="img" aria-label={status.ready ? `${option?.label ?? profile} requirements met` : `${option?.label ?? profile} requirements not met`} title={status.ready ? 'Requirements met' : 'Requirements not met'}>{status.ready ? '✓' : '×'}</span>
                  <strong>{option?.label ?? profile}</strong>
                  <span>{details.route}</span>
                  <small>{details.requirement}</small>
                  <em>{status.detail}</em>
                </article>;
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
