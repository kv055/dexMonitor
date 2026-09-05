import { describe, expectTypeOf, it } from 'vitest';
import type { CexDepositAddress, CexSpotTrade, CexWithdrawalAddress } from '../types';
import type { components } from '../generated/monitor-api';
import type { ApiJson } from './openapi';

describe('generated CEX list types', () => {
  it('derives deposit, withdrawal, and spot-trade fetches from the OpenAPI array schemas', () => {
    expectTypeOf<ApiJson<'getApiTradingAccountsIdCexDepositAddresses'>>()
      .toEqualTypeOf<components['schemas']['CexDepositAddress'][]>();
    expectTypeOf<ApiJson<'getApiTradingAccountsIdCexWithdrawalAddresses'>>()
      .toEqualTypeOf<components['schemas']['CexWithdrawalAddress'][]>();
    expectTypeOf<ApiJson<'getApiTradingAccountsIdCexSpotTrades'>>()
      .toEqualTypeOf<components['schemas']['CexSpotTrade'][]>();
    expectTypeOf<CexDepositAddress>().toEqualTypeOf<components['schemas']['CexDepositAddress']>();
    expectTypeOf<CexWithdrawalAddress>().toEqualTypeOf<components['schemas']['CexWithdrawalAddress']>();
    expectTypeOf<CexSpotTrade>().toEqualTypeOf<components['schemas']['CexSpotTrade']>();
    expectTypeOf<ApiJson<'getApiTradingAccountsIdCexDepositAddresses'>>()
      .not.toEqualTypeOf<Record<string, unknown>>();
  });
});
