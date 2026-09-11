export interface MarketRequestParams {
  hours: string;
  cex: string;
  fiat: string;
  capabilityRevision: number;
  maxFiatLimit: number | null;
}

export interface AnalyticsRequestBody {
  hours: number;
  cex: string;
  fiat: string;
  max_fiat_limit: number;
  sections?: string[];
  past_start_date?: string;
  past_end_date?: string;
  timezone?: string;
}

export interface AnalyticsPastRange {
  startDate: string;
  endDate: string;
  timezone: string;
}

export function marketRequestKey(params: MarketRequestParams): string {
  return JSON.stringify(params);
}

export function appendTradeCostParams(search: URLSearchParams, params: MarketRequestParams): URLSearchParams {
  if (params.maxFiatLimit != null && params.maxFiatLimit > 0) {
    search.set('max_fiat_limit', String(params.maxFiatLimit));
  }
  return search;
}

export function buildLiveOffersSearch(params: MarketRequestParams): string {
  const search = new URLSearchParams({ cex: params.cex, fiat: params.fiat });
  return search.toString();
}

export function buildPastOffersSearch(params: MarketRequestParams): string {
  const search = new URLSearchParams({
    hours: params.hours,
    limit: '1000',
    compact: 'true',
    cex: params.cex,
    fiat: params.fiat,
  });
  return appendTradeCostParams(search, params).toString();
}

export function buildAnalyticsBody(params: MarketRequestParams, sections?: string[], pastRange?: AnalyticsPastRange | null): AnalyticsRequestBody {
  return {
    hours: Number(params.hours),
    cex: params.cex,
    fiat: params.fiat,
    max_fiat_limit: params.maxFiatLimit ?? 0,
    ...(sections ? { sections } : {}),
    ...(pastRange ? {
      past_start_date: pastRange.startDate,
      past_end_date: pastRange.endDate,
      timezone: pastRange.timezone,
    } : {}),
  };
}

export interface StatisticsOfferFilters {
  direction?: string;
  excludedExchanges?: string[];
  includePaymentMethods?: string[];
  paymentScope?: 'all' | 'linked';
  premiumMode?: string;
  premiumOnly?: boolean;
  rangeMetric?: string;
  profitMin?: number;
  profitMax?: number;
  premiumMin?: number;
  premiumMax?: number;
  pastRange?: AnalyticsPastRange;
  refresh?: boolean;
}

export interface StatisticsRequestBody extends AnalyticsRequestBody {
  direction?: string;
  excluded_exchanges?: string[];
  include_payment_methods?: string[];
  payment_scope?: string;
  premium_mode?: string;
  premium_only?: boolean;
  range_metric?: string;
  profit_min?: number;
  profit_max?: number;
  premium_min?: number;
  premium_max?: number;
  refresh?: boolean;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildStatisticsBody(
  params: MarketRequestParams,
  filters: StatisticsOfferFilters,
): StatisticsRequestBody {
  return {
    ...buildAnalyticsBody(params, undefined, filters.pastRange),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.excludedExchanges && filters.excludedExchanges.length > 0
      ? { excluded_exchanges: filters.excludedExchanges }
      : {}),
    ...(filters.includePaymentMethods
      ? { include_payment_methods: filters.includePaymentMethods }
      : {}),
    ...(filters.paymentScope === 'linked' ? { payment_scope: 'linked' } : {}),
    ...(filters.premiumMode ? { premium_mode: filters.premiumMode } : {}),
    ...(filters.premiumOnly != null ? { premium_only: filters.premiumOnly } : {}),
    ...(filters.rangeMetric ? { range_metric: filters.rangeMetric } : {}),
    ...(filters.profitMin != null ? { profit_min: filters.profitMin } : {}),
    ...(filters.profitMax != null ? { profit_max: filters.profitMax } : {}),
    ...(filters.premiumMin != null ? { premium_min: filters.premiumMin } : {}),
    ...(filters.premiumMax != null ? { premium_max: filters.premiumMax } : {}),
    ...(filters.refresh ? { refresh: true } : {}),
  };
}

export function parseFilterNumber(value: string): number | undefined {
  return optionalNumber(value);
}
