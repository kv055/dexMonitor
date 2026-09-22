export type ProviderOption = { value: string; label: string };
export type ChatExchange = 'robosats' | 'bisq2';

export type ProviderDefinition = ProviderOption & {
  category: string;
  creatable: boolean;
};

export const LND_WALLET_PROVIDER = 'LND wallet';

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  { value: 'PayPal', label: 'PayPal', category: 'Fiat Transmitter', creatable: true },
  { value: 'Revolut', label: 'Revolut', category: 'Fiat Transmitter', creatable: true },
  { value: 'WISE', label: 'WISE', category: 'Fiat Transmitter', creatable: true },
  { value: 'N26', label: 'N26', category: 'Fiat Transmitter', creatable: true },
  { value: 'HodlHodl', label: 'HodlHodl', category: 'DEX', creatable: true },
  { value: 'Bisq', label: 'Bisq', category: 'DEX', creatable: false },
  { value: 'Bisq2', label: 'Bisq2', category: 'DEX', creatable: false },
  { value: 'Robosats', label: 'RoboSats', category: 'DEX', creatable: true },
  { value: 'Peach', label: 'Peach Bitcoin', category: 'DEX', creatable: true },
  { value: 'mostro', label: 'Mostro', category: 'DEX', creatable: false },
  { value: 'Kraken', label: 'Kraken', category: 'CEX', creatable: true },
  { value: 'Coinbase', label: 'Coinbase', category: 'CEX', creatable: true },
  { value: 'Binance', label: 'Binance', category: 'CEX', creatable: true },
  { value: LND_WALLET_PROVIDER, label: 'LND wallet', category: 'Internal Infrastructure', creatable: false },
];

const CREATABLE_PROVIDER_CATEGORIES = ['Fiat Transmitter', 'DEX', 'CEX', 'Bank', 'Wallet addresses'] as const;
const PAYMENT_CATEGORIES = ['Fiat Transmitter', 'Bank', 'Wallet addresses'] as const;
const CATEGORY_ORDER = ['Fiat Transmitter', 'Bank', 'Wallet addresses', 'DEX', 'CEX', 'Internal Infrastructure', 'Uncategorized'];

export const TRADING_CATEGORIES = ['DEX', 'CEX', 'Internal Infrastructure', 'Uncategorized'] as const;

export function isPaymentCategory(category: string): boolean {
  return (PAYMENT_CATEGORIES as readonly string[]).includes(category);
}

export function providerDefinition(provider: string): ProviderDefinition | undefined {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_DEFINITIONS.find(option => option.value.toLowerCase() === normalized);
}

export function providerLabel(value: string): string {
  return providerDefinition(value)?.label ?? value;
}

export function providerCategoryFor(provider: string): string | null {
  return providerDefinition(provider)?.category ?? null;
}

export function groupedCreatableProviders(categoryFilter?: string) {
  return CREATABLE_PROVIDER_CATEGORIES
    .filter(category => !categoryFilter || category === categoryFilter)
    .map(category => ({
      category,
      providers: PROVIDER_DEFINITIONS.filter(provider => provider.creatable && provider.category === category),
    }))
    .filter(group => group.providers.length > 0);
}

export function providerOptionsForValue(value: string, category?: string): ProviderOption[] {
  const options: ProviderOption[] = [
    { value: '', label: 'Please select provider' },
    ...PROVIDER_DEFINITIONS
      .filter(provider => !category || provider.category === category)
      .map(provider => ({ value: provider.value, label: provider.label })),
  ];
  const normalized = value.trim().toLowerCase();
  if (!normalized || options.some(option => option.value.toLowerCase() === normalized)) return options;
  return [...options, { value: value.trim(), label: value }];
}

export function isRobosatsProvider(value: string): boolean {
  return value.trim().toLowerCase() === 'robosats';
}

export function isHodlHodlProvider(value: string): boolean {
  return value.trim().toLowerCase() === 'hodlhodl';
}

export function isLndWalletProvider(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'lnd wallet' || normalized === 'lnd' || normalized === 'lnd_wallet';
}

export function isLocalWalletProvider(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'bisq' || normalized === 'bisq2' || normalized === 'lnd wallet';
}

export function isBisqProvider(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'bisq' || normalized === 'bisq2';
}

export function isBisq1Provider(value: string): boolean {
  return value.trim().toLowerCase() === 'bisq';
}

export function isBisq2Provider(value: string): boolean {
  return value.trim().toLowerCase() === 'bisq2';
}

/**
 * Offer id the user can take into the local Bisq app, or null when copying
 * is not useful: only Bisq 1 / Bisq 2 offers qualify (web-based venues get a
 * View-on-DEX deep link instead), and an id must be present.
 */
export function copyableOfferId(exchange: string, offerId: string | null | undefined): string | null {
  const id = offerId?.trim();
  if (!id || !isBisqProvider(exchange)) return null;
  return id;
}

export function chatExchangeForProvider(value: string): ChatExchange | null {
  if (isRobosatsProvider(value)) return 'robosats';
  if (isBisq2Provider(value)) return 'bisq2';
  return null;
}

export function chatExchangeLabel(exchange: ChatExchange): string {
  return exchange === 'robosats' ? 'RoboSats' : 'Bisq2';
}

export function isFiatProvider(provider: string): boolean {
  return providerCategoryFor(provider) === 'Fiat Transmitter';
}

export function usesAPIKeysAtCreate(provider: string): boolean {
  const definition = providerDefinition(provider);
  if (!definition) return false;
  return definition.category === 'CEX' || (definition.category === 'DEX' && definition.creatable);
}

export function showContactFieldsForProvider(provider: string): boolean {
  return isFiatProvider(provider);
}

export function showDexIdentitySections(provider: string): boolean {
  return !isLocalWalletProvider(provider)
    && !isLndWalletProvider(provider)
    && providerCategoryFor(provider) !== 'CEX'
    && !isRobosatsProvider(provider)
    && !isHodlHodlProvider(provider);
}

export function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}
