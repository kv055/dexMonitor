import type { CostBreakdown } from '../types';
import type { CEXPermissionExchange } from '../hooks/useCEXPermissions';

export interface MissingRouteExplanation {
  title: string;
  detail: string;
}

/** True when the cost engine selected a CEX route for this breakdown. */
export function hasPricedTradeRoute(bd: CostBreakdown | null | undefined): boolean {
  return Boolean(bd?.route_cex?.trim());
}

/**
 * Positive DEX premium normally triggers cost routing. An empty route_cex then
 * means every usable spot/hedge combo was excluded (policy or API-key capability).
 */
export function shouldExplainMissingRoute(
  rawPremiumPct: number | null | undefined,
  bd: CostBreakdown | null | undefined,
): boolean {
  return (rawPremiumPct ?? 0) > 0 && !!bd && !hasPricedTradeRoute(bd);
}

function costSupported(exchanges: readonly CEXPermissionExchange[]): CEXPermissionExchange[] {
  return exchanges.filter(exchange => exchange.cost_supported);
}

function legLockedByCapability(exchange: CEXPermissionExchange, leg: 'spot' | 'hedge'): boolean {
  const state = exchange[leg];
  return state.supported && !state.available;
}

/**
 * Builds a short operator-facing explanation for why live net premium / costs
 * are zero despite a positive DEX premium.
 */
export function explainMissingTradeRoute(
  exchanges: readonly CEXPermissionExchange[],
): MissingRouteExplanation {
  const venues = costSupported(exchanges);
  if (venues.length === 0) {
    return {
      title: 'No CEX route available',
      detail:
        'Trade costs and net premium cannot be estimated because no cost-supported CEX venues are loaded. Open Settings → CEX Exchanges and retry if permissions failed to load.',
    };
  }

  const spotEnabled = venues.filter(exchange => exchange.spot.effective_enabled);
  const hedgeEnabled = venues.filter(exchange => exchange.hedge.effective_enabled);
  const hedgeSupported = venues.filter(exchange => exchange.hedge.supported);

  if (spotEnabled.length === 0) {
    const allSpotPolicyOff = venues.every(exchange => !exchange.policy.spot_enabled);
    if (allSpotPolicyOff) {
      return {
        title: 'All spot CEX venues are disabled',
        detail:
          'Enable at least one spot exchange under Settings → CEX Exchanges to estimate trade costs and net premium.',
      };
    }
    const capabilityLocked = venues.some(exchange => legLockedByCapability(exchange, 'spot'));
    if (capabilityLocked) {
      return {
        title: 'No spot CEX is available for routing',
        detail:
          'API keys may be missing, stale, or lack required permissions. Check Trading Accounts and Settings → CEX Exchanges, then refresh permissions.',
      };
    }
    return {
      title: 'No spot CEX is available for routing',
      detail:
        'Trade costs and net premium cannot be estimated until a spot venue is enabled. Open Settings → CEX Exchanges to review disabled exchanges.',
    };
  }

  if (hedgeSupported.length > 0 && hedgeEnabled.length === 0) {
    const allHedgePolicyOff = hedgeSupported.every(exchange => !exchange.policy.hedge_enabled);
    if (allHedgePolicyOff) {
      return {
        title: 'All hedge venues are disabled',
        detail:
          'Net premium needs a usable hedge (futures) route. Re-enable at least one hedge leg under Settings → CEX Exchanges.',
      };
    }
    const capabilityLocked = hedgeSupported.some(exchange => legLockedByCapability(exchange, 'hedge'));
    if (capabilityLocked) {
      return {
        title: 'No hedge venue is available for routing',
        detail:
          'Spot venues are available, but hedge (futures) permissions are missing, stale, or incomplete. Update API keys in Trading Accounts or review Settings → CEX Exchanges.',
      };
    }
    return {
      title: 'No hedge venue is available for routing',
      detail:
        'Trade cost routing needs a usable hedge leg. Open Settings → CEX Exchanges to enable a futures venue.',
    };
  }

  return {
    title: 'No CEX trade route could be selected',
    detail:
      'Trade costs and net premium cannot be estimated for this offer. Check Settings → CEX Exchanges for disabled venues or missing API key permissions.',
  };
}
