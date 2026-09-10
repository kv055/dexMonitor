import type { OfferLifecyclePremiumPoint } from '../types';

export interface AxisWindow {
  min: number;
  max: number;
}

export type PremiumScatterDimension = 'lifecycle' | 'volume' | 'depositBtc' | 'depositPct';

export function isZoomedWindow(window: AxisWindow, bounds: AxisWindow): boolean {
  return window.max - window.min < (bounds.max - bounds.min) * 0.995;
}

export function isDefaultWindow(window: AxisWindow, bounds: AxisWindow): boolean {
  const span = Math.max(bounds.max - bounds.min, Number.EPSILON);
  const epsilon = span * 0.005;
  return Math.abs(window.min - bounds.min) <= epsilon && Math.abs(window.max - bounds.max) <= epsilon;
}

export function expandPanBounds(data: AxisWindow): AxisWindow {
  const span = Math.max(data.max - data.min, Number.EPSILON);
  const overscroll = Math.max(span, Math.abs(data.max), Math.abs(data.min));
  return {
    min: Math.min(data.min, 0) - overscroll,
    max: Math.max(data.max, 0) + overscroll,
  };
}

export function translateWindow(
  source: AxisWindow,
  bounds: AxisWindow,
  valueShift: number,
): AxisWindow {
  let nextMin = source.min + valueShift;
  let nextMax = source.max + valueShift;
  if (nextMin < bounds.min) {
    nextMax += bounds.min - nextMin;
    nextMin = bounds.min;
  }
  if (nextMax > bounds.max) {
    nextMin -= nextMax - bounds.max;
    nextMax = bounds.max;
  }
  return {
    min: Math.max(bounds.min, nextMin),
    max: Math.min(bounds.max, nextMax),
  };
}

export function depositBtcValue(point: OfferLifecyclePremiumPoint): number {
  const stake = point.counterparty_stake_btc;
  return typeof stake === 'number' && Number.isFinite(stake) && stake > 0 ? stake : Number.NaN;
}

export function depositPctValue(point: OfferLifecyclePremiumPoint): number {
  const stake = point.counterparty_stake_pct;
  if (typeof stake !== 'number' || !Number.isFinite(stake) || stake <= 0) return Number.NaN;
  return stake <= 1 ? stake * 100 : stake;
}

export function scatterXValue(
  point: OfferLifecyclePremiumPoint,
  dimension: PremiumScatterDimension,
): number {
  switch (dimension) {
    case 'lifecycle':
      return point.lifecycle_hours;
    case 'volume':
      return point.volume_btc;
    case 'depositBtc':
      return depositBtcValue(point);
    case 'depositPct':
      return depositPctValue(point);
  }
}

export function selectPremiumScatterPoints(
  points: OfferLifecyclePremiumPoint[],
  dimensionKey: PremiumScatterDimension,
): OfferLifecyclePremiumPoint[] {
  return points.filter(point => (
    point.premium_rate_pct > 0 && Number.isFinite(scatterXValue(point, dimensionKey))
  ));
}
