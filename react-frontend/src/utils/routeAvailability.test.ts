import { describe, expect, it } from 'vitest';
import type { CEXPermissionExchange } from '../hooks/useCEXPermissions';
import type { CostBreakdown } from '../types';
import {
  explainMissingTradeRoute,
  hasEffectiveHedgeVenue,
  hasPricedTradeRoute,
  shouldExplainMissingRoute,
} from './routeAvailability';

function leg(overrides: Partial<CEXPermissionExchange['spot']> = {}): CEXPermissionExchange['spot'] {
  return {
    supported: true,
    policy_enabled: true,
    available: true,
    effective_enabled: true,
    blocking_permissions: [],
    blockers: [],
    ...overrides,
  };
}

function exchange(partial: Partial<CEXPermissionExchange> & Pick<CEXPermissionExchange, 'exchange'>): CEXPermissionExchange {
  return {
    account_id: 1,
    provider: partial.exchange,
    cost_supported: true,
    execution_supported: true,
    active_key_count: 1,
    policy: { spot_enabled: true, hedge_enabled: true },
    spot: leg(),
    hedge: leg(),
    ...partial,
  };
}

const emptyBreakdown = { route_cex: '', btc_amount: 0.01 } as CostBreakdown;
const pricedBreakdown = { route_cex: 'kraken', btc_amount: 0.01 } as CostBreakdown;

describe('routeAvailability', () => {
  it('detects when a positive-premium offer has no priced route', () => {
    expect(hasPricedTradeRoute(pricedBreakdown)).toBe(true);
    expect(hasPricedTradeRoute(emptyBreakdown)).toBe(false);
    expect(shouldExplainMissingRoute(2.5, emptyBreakdown)).toBe(true);
    expect(shouldExplainMissingRoute(0, emptyBreakdown)).toBe(false);
    expect(shouldExplainMissingRoute(2.5, pricedBreakdown)).toBe(false);
  });

  it('explains all spot venues disabled by policy', () => {
    const message = explainMissingTradeRoute([
      exchange({
        exchange: 'kraken',
        policy: { spot_enabled: false, hedge_enabled: false },
        spot: leg({ policy_enabled: false, effective_enabled: false }),
        hedge: leg({ policy_enabled: false, effective_enabled: false }),
      }),
    ]);
    expect(message.title).toMatch(/disabled/i);
    expect(message.detail).toMatch(/Settings → CEX Exchanges/);
  });

  it('explains missing spot API-key capability', () => {
    const message = explainMissingTradeRoute(
      [
        exchange({
          exchange: 'kraken',
          spot: leg({
            available: false,
            effective_enabled: false,
            blockers: [{ code: 'stale', message: 'API-key permissions have not been verified recently.' }],
          }),
          hedge: leg({ available: false, effective_enabled: false }),
        }),
      ],
      { status: 'blocked', code: 'no_eligible_spot_provider' },
    );
    expect(message.title).toMatch(/No spot CEX/i);
    expect(message.detail).toMatch(/API keys/i);
  });

  it('prefers authoritative fee-route failure over healthy API-key capability', () => {
    const message = explainMissingTradeRoute(
      [exchange({ exchange: 'kraken' })],
      {
        status: 'blocked',
        code: 'no_eligible_spot_provider',
        reason: 'No provider has an eligible spot leg for this snapshot.',
      },
    );
    expect(message.title).toMatch(/priced spot CEX route/i);
    expect(message.detail).toMatch(/fee snapshot/i);
    expect(message.detail).not.toMatch(/API keys may be missing/i);
  });

  it('explains missing hedge when spot remains available', () => {
    const exchanges = [
      exchange({
        exchange: 'kraken',
        hedge: leg({
          available: false,
          effective_enabled: false,
          blockers: [{ code: 'missing_permission', message: 'Required API-key permissions were not granted.' }],
        }),
      }),
    ];
    expect(hasEffectiveHedgeVenue(exchanges)).toBe(false);
    const message = explainMissingTradeRoute(exchanges);
    expect(message.title).toMatch(/Hedgefull routing unavailable/i);
    expect(message.detail).toMatch(/Hedgeless/i);
  });

  it('explains all hedge venues disabled by policy', () => {
    const message = explainMissingTradeRoute([
      exchange({
        exchange: 'kraken',
        policy: { spot_enabled: true, hedge_enabled: false },
        hedge: leg({ policy_enabled: false, effective_enabled: false }),
      }),
    ]);
    expect(message.title).toMatch(/Hedgefull routing unavailable/i);
    expect(message.detail).toMatch(/Hedgeless/i);
  });
});
