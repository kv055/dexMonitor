import type { OHLCCandle } from '../../types';
import { toUtcSec } from '../../utils/formatters';

const GAP_CADENCE_FACTOR = 2.5;
const MIN_GAP_SECONDS = 90;
export const TARGET_VISIBLE_CANDLES = 120;

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split('').map(character => character + character).join('')
    : match[1];
  const value = Number.parseInt(hex, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function weakenColor(color: string): string {
  const rgb = parseHexColor(color);
  if (!rgb) return 'rgba(139, 148, 158, 0.7)';
  const grey = 145;
  const mix = 0.62;
  const r = Math.round(rgb.r + (grey - rgb.r) * mix);
  const g = Math.round(rgb.g + (grey - rgb.g) * mix);
  const b = Math.round(rgb.b + (grey - rgb.b) * mix);
  return `rgba(${r}, ${g}, ${b}, 0.85)`;
}

export function gapThresholdSeconds(points: { utcSec?: number }[]): number {
  const deltas: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].utcSec;
    const current = points[index].utcSec;
    if (previous != null && current != null) deltas.push(current - previous);
  }
  if (deltas.length === 0) return Number.POSITIVE_INFINITY;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.max(median * GAP_CADENCE_FACTOR, MIN_GAP_SECONDS);
}

export function aggregateOHLC(candles: OHLCCandle[], targetMinutes: number, sourceMinutes: number): OHLCCandle[] {
  if (targetMinutes <= sourceMinutes || candles.length === 0) return candles;
  const bucketSeconds = targetMinutes * 60;
  const buckets = new Map<number, OHLCCandle>();
  for (const candle of candles) {
    const bucketStart = Math.floor(toUtcSec(candle.time) / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      const time = new Date(bucketStart * 1000).toISOString().replace('.000Z', 'Z');
      buckets.set(bucketStart, { time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
    }
  }
  return [...buckets.values()].sort((a, b) => toUtcSec(a.time) - toUtcSec(b.time));
}

export function requiredHoursForCandleSize(candleMinutes: number): number {
  return Math.ceil((candleMinutes * TARGET_VISIBLE_CANDLES) / 60);
}
