import type { OHLCCandle } from '../types';
import { parseUtcTimestamp } from './formatters';

export interface ShiftedOhlcCandles {
  candles: OHLCCandle[];
  utcByShiftedSec: Map<number, number>;
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = new Map(parts.map(part => [part.type, part.value]));
  const year = Number(values.get('year'));
  const month = Number(values.get('month'));
  const day = Number(values.get('day'));
  const hour = Number(values.get('hour'));
  const minute = Number(values.get('minute'));
  const second = Number(values.get('second'));

  return Date.UTC(year, month - 1, day, hour, minute, second) - date.getTime();
}

function shiftUtcDate(date: Date, timezone: string): Date {
  return new Date(date.getTime() + timezoneOffsetMs(date, timezone));
}

export function shiftUtcSecForTimezone(utcSec: number, timezone: string): number {
  const utcDate = new Date(utcSec * 1000);
  const shiftedDate = shiftUtcDate(utcDate, timezone);
  return Math.floor(shiftedDate.getTime() / 1000);
}

export function shiftOhlcCandlesForTimezone(candles: OHLCCandle[], timezone: string): ShiftedOhlcCandles {
  const utcByShiftedSec = new Map<number, number>();

  const shiftedCandles = candles.map(candle => {
    const utcDate = parseUtcTimestamp(candle.time);
    if (!utcDate) return { ...candle };

    const utcSec = Math.floor(utcDate.getTime() / 1000);
    const shiftedSec = shiftUtcSecForTimezone(utcSec, timezone);
    utcByShiftedSec.set(shiftedSec, utcSec);

    return {
      ...candle,
      time: new Date(shiftedSec * 1000).toISOString().replace('.000Z', 'Z'),
    };
  });

  return { candles: shiftedCandles, utcByShiftedSec };
}
