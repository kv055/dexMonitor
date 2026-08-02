export interface MarketRequestParams {
  hours: string;
  cex: string;
  fiat: string;
  capabilityRevision: number;
  excludedPaymentMethods: string[];
  feeTier: string;
  coupledHedge: boolean;
  maxFiatLimit: number | null;
}

export interface AnalyticsRequestBody {
  hours: number;
  cex: string;
  fiat: string;
  exclude_payment_methods: string[];
  fee_tier: string;
  coupled_hedge: boolean;
  max_fiat_limit: number;
  sections?: string[];
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function marketRequestKey(params: MarketRequestParams): string {
  return JSON.stringify({
    ...params,
    excludedPaymentMethods: sorted(params.excludedPaymentMethods),
  });
}

export function appendTradeCostParams(search: URLSearchParams, params: MarketRequestParams): URLSearchParams {
  if (params.feeTier) search.set('fee_tier', params.feeTier);
  if (!params.coupledHedge) search.set('coupled_hedge', 'false');
  if (params.maxFiatLimit != null && params.maxFiatLimit > 0) {
    search.set('max_fiat_limit', String(params.maxFiatLimit));
  }
  return search;
}

export function buildLiveOffersSearch(params: MarketRequestParams): string {
  const search = new URLSearchParams({ cex: params.cex, fiat: params.fiat });
  return appendTradeCostParams(search, params).toString();
}

export function buildPastOffersSearch(params: MarketRequestParams): string {
  const search = new URLSearchParams({
    hours: params.hours,
    limit: '1000',
    compact: 'true',
    cex: params.cex,
    fiat: params.fiat,
  });
  if (params.excludedPaymentMethods.length > 0) {
    search.set('exclude_payment_methods', params.excludedPaymentMethods.join(','));
  }
  return appendTradeCostParams(search, params).toString();
}

export function buildAnalyticsBody(params: MarketRequestParams, sections?: string[]): AnalyticsRequestBody {
  return {
    hours: Number(params.hours),
    cex: params.cex,
    fiat: params.fiat,
    exclude_payment_methods: params.excludedPaymentMethods,
    fee_tier: params.feeTier,
    coupled_hedge: params.coupledHedge,
    max_fiat_limit: params.maxFiatLimit ?? 0,
    ...(sections ? { sections } : {}),
  };
}
