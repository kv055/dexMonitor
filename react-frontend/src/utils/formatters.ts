export function formatBtc(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

export function formatNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  // normalise both "YYYY-MM-DD HH:MM:SS" and "YYYY-MM-DDTHH:MM:SSZ"
  const normalized = ts.replace('T', ' ').replace('Z', '');
  const [datePart, timePart] = normalized.split(' ');
  const [, mm, dd] = datePart.split('-');
  const [hh, min] = timePart.split(':');
  return `${parseInt(dd)} ${MONTHS[parseInt(mm) - 1]}, ${hh}:${min}`;
}

export function durationMinutes(first: string | null, last: string | null): number {
  if (!first || !last) return 0;
  const a = new Date(first.replace(' ', 'T') + 'Z');
  const b = new Date(last.replace(' ', 'T') + 'Z');
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
