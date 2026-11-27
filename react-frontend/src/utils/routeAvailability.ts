import type { CostBreakdown } from '../types';
import type { CEXPermissionExchange } from '../hooks/useCEXPermissions';

export interface MissingRouteExplanation {
  title: string;
  detail: string;
}

/**
 * The public monitor's version of explainMissingTradeRoute: the operator
 * explanations point at settings and fee snapshots public viewers cannot see.
 */
export const PUBLIC_MISSING_ROUTE: MissingRouteExplanation = {
  title: 'No priced route for this offer',
  detail: "Trade costs and net premium can't be estimated for this offer right now.",
};

interface RouteResolution {
  status: 'resolved' | 'blocked' | 'out_of_scope';
  code?: string;
  reason?: string;
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

/** True when at least one cost-supported CEX has an effectively enabled hedge leg. */
export function hasEffectiveHedgeVenue(exchanges: readonly CEXPermissionExchange[]): boolean {
  return costSupported(exchanges).some(exchange => exchange.hedge.effective_enabled);
}

/** True when at least one cost-supported CEX has an effectively enabled spot leg. */
export function hasEffectiveSpotVenue(exchanges: readonly CEXPermissionExchange[]): boolean {
  return costSupported(exchanges).some(exchange => exchange.spot.effective_enabled);
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
  resolution?: RouteResolution | null,
): MissingRouteExplanation {
  const venues = costSupported(exchanges);
  const spotEnabled = venues.filter(exchange => exchange.spot.effective_enabled);
  const hedgeEnabled = venues.filter(exchange => exchange.hedge.effective_enabled);
  const hedgeSupported = venues.filter(exchange => exchange.hedge.supported);

  if (spotEnabled.length > 0 && resolution?.status === 'blocked' && resolution.code === 'no_eligible_spot_provider') {
    return {
      title: 'No priced spot CEX route is available',
      detail:
        `${resolution.reason ?? 'No provider has the required spot pricing inputs.'} ` +
        'Check CEX fee snapshot status; API-key permissions alone do not provide the fee inputs used by route calculation.',
    };
  }
  if (hedgeEnabled.length > 0 && resolution?.status === 'blocked' && resolution.code === 'no_eligible_hedge_provider') {
    return {
      title: 'Hedgefull routing unavailable',
      detail:
        `${resolution.reason ?? 'No provider has the required futures pricing inputs.'} ` +
        'Check the futures fee snapshot or switch to Hedgeless mode.',
    };
  }
  if (venues.length === 0) {
    return {
      title: 'No CEX route available',
      detail:
        'Trade costs and net premium cannot be estimated because no cost-supported CEX venues are loaded. Open Settings → CEX Exchanges and retry if permissions failed to load.',
    };
  }

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
        title: 'Hedgefull routing unavailable',
        detail:
          'All hedge (futures) venues are disabled. Switch to Hedgeless trade mode to price this offer with spot only, or re-enable a hedge leg under Settings → CEX Exchanges.',
      };
    }
    const capabilityLocked = hedgeSupported.some(exchange => legLockedByCapability(exchange, 'hedge'));
    if (capabilityLocked) {
      return {
        title: 'Hedgefull routing unavailable',
        detail:
          'No hedge (futures) API-key permissions are available. Switch to Hedgeless trade mode to price this offer with spot only, or update keys in Trading Accounts.',
      };
    }
    return {
      title: 'Hedgefull routing unavailable',
      detail:
        'No hedge (futures) venue is available. Switch to Hedgeless trade mode to price this offer with spot only.',
    };
  }

  return {
    title: 'No CEX trade route could be selected',
    detail:
      'Trade costs and net premium cannot be estimated for this offer. Check Settings → CEX Exchanges for disabled venues or missing API key permissions.',
  };
}
