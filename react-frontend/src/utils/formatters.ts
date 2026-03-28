export function formatNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

export function formatTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('de-DE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
