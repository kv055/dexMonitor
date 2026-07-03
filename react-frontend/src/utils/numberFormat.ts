/** Strip trailing zeros from a fixed-decimal string (input is always from toFixed, not user data). */
export function stripTrailingZeros(value: string): string { // NOSONAR typescript:S5852
  return value.replace(/\.?0+$/, '') || '0';
}
