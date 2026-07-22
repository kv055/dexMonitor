export function normalizeCurrency(currency: string | null | undefined): string {
  return (currency || 'EUR').trim().toUpperCase() || 'EUR';
}

export function formatFiat(
  amount: number | null | undefined,
  currency: string | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: normalizeCurrency(currency),
    maximumFractionDigits: 2,
    ...options,
  }).format(amount);
}

export function formatSignedFiat(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const prefix = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return prefix + formatFiat(Math.abs(amount), currency);
}

export function fiatSymbol(currency: string | null | undefined): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: normalizeCurrency(currency),
  }).formatToParts(0).find(part => part.type === 'currency')?.value ?? normalizeCurrency(currency);
}
