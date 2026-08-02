export function readStoredString(key: string, fallback = ''): string {
  return localStorage.getItem(key) ?? fallback;
}

export function readStoredStringArray(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = localStorage.getItem(key);
  return stored == null ? fallback : stored === 'true';
}

export function readStoredNullableNumber(key: string): number | null {
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  const value = Number(stored);
  return Number.isFinite(value) ? value : null;
}

export function writeStoredValue(key: string, value: string | string[] | boolean | number | null): void {
  if (Array.isArray(value)) {
    localStorage.setItem(key, JSON.stringify(value));
  } else {
    localStorage.setItem(key, value == null ? '' : String(value));
  }
}
