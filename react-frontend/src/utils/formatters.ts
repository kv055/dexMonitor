export function formatBtc(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

export function formatNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function parseUtcTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const direct = new Date(ts);
  if (!isNaN(direct.getTime())) return direct;
  const utc = new Date(ts.replace(' ', 'T') + 'Z');
  if (!isNaN(utc.getTime())) return utc;
  const unix = Number(ts);
  if (!isNaN(unix) && unix > 0) return new Date(unix * 1000);
  return null;
}

export function formatTime(ts: string | null | undefined, timezone?: string): string {
  if (!ts) return '—';
  const date = parseUtcTimestamp(ts);
  if (!date) return '—';
  if (!timezone) {
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDateTimeParts(ts: string | null | undefined, timezone: string): { day: string; time: string } {
  const date = parseUtcTimestamp(ts);
  if (!date) return { day: '???', time: '??:??' };

  return {
    day: date.toLocaleDateString('en-GB', { timeZone: timezone, month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

export function formatTimeOnly(ts: string | Date | number, timezone: string): string {
  const date = ts instanceof Date ? ts : typeof ts === 'number' ? new Date(ts * 1000) : parseUtcTimestamp(ts);
  if (!date) return '—';
  return date.toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDateTimeLabel(ts: string | Date | number, timezone: string): string {
  const date = ts instanceof Date ? ts : typeof ts === 'number' ? new Date(ts * 1000) : parseUtcTimestamp(ts);
  if (!date) return '—';
  return date.toLocaleString('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function durationMinutes(first: string | null, last: string | null): number {
  const a = parseUtcTimestamp(first);
  const b = parseUtcTimestamp(last);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export function formatDuration(first: string | null, last: string | null): string {
  const mins = durationMinutes(first, last);
  if (mins < 1) return 'new';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function premiumClass(pct: number | null | undefined): string {
  if (pct == null) return '';
  if (pct <= 2) return 'text-green';
  if (pct <= 4) return 'text-accent';
  return 'text-red';
}

export function toUtcSec(ts: string): number {
  const date = parseUtcTimestamp(ts);
  return date ? Math.floor(date.getTime() / 1000) : 0;
}
