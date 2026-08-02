import { describe, expect, it } from 'vitest';
import {
  chatExchangeForProvider,
  groupedCreatableProviders,
  isLndWalletProvider,
  providerCategoryFor,
  providerLabel,
  showDexIdentitySections,
  usesAPIKeysAtCreate,
} from './providerRegistry';

describe('trading provider registry', () => {
  it('normalizes labels and categories from one registry', () => {
    expect(providerLabel('robosats')).toBe('RoboSats');
    expect(providerCategoryFor('kraken')).toBe('CEX');
    expect(groupedCreatableProviders('CEX')[0].providers.map(provider => provider.value)).toContain('Kraken');
  });

  it('derives provider capabilities consistently', () => {
    expect(usesAPIKeysAtCreate('Kraken')).toBe(true);
    expect(usesAPIKeysAtCreate('PayPal')).toBe(false);
    expect(showDexIdentitySections('HodlHodl')).toBe(false);
    expect(showDexIdentitySections('Peach')).toBe(true);
    expect(chatExchangeForProvider('Bisq2')).toBe('Bisq2');
  });

  it('accepts historic LND provider aliases', () => {
    expect(isLndWalletProvider('LND wallet')).toBe(true);
    expect(isLndWalletProvider('lnd_wallet')).toBe(true);
  });
});
