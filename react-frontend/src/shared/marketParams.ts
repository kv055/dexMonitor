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
