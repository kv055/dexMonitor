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

export function shiftOhlcCandlesForTimezone(candles: OHLCCandle[], timezone: string): ShiftedOhlcCandles {
  const utcByShiftedSec = new Map<number, number>();

  const shiftedCandles = candles.map(candle => {
    const utcDate = parseUtcTimestamp(candle.time);
    if (!utcDate) return { ...candle };

    const shiftedDate = shiftUtcDate(utcDate, timezone);
    const shiftedSec = Math.floor(shiftedDate.getTime() / 1000);
    const utcSec = Math.floor(utcDate.getTime() / 1000);
    utcByShiftedSec.set(shiftedSec, utcSec);

    return {
      ...candle,
      time: shiftedDate.toISOString().replace('.000Z', 'Z'),
    };
  });

  return { candles: shiftedCandles, utcByShiftedSec };
}
