const ESCAPED_NEWLINE_PATTERN = /\\r\\n|\\n/;

export function pemInputNeedsNormalization(value: string): boolean {
  return ESCAPED_NEWLINE_PATTERN.test(value);
}

export function normalizePemInput(value: string): { value: string; changed: boolean } {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\\r\\n|\\n/g, '\n');
  return { value: normalized, changed: normalized !== value };
}
