// Client-side format checks for the Trading Accounts panel. These mirror
// commons/paymentmethods (iban.go / email.go) so the two agree, but only
// cover what's checkable without a network round-trip: structure + checksum
// for IBAN, and address syntax for email. Domain/MX deliverability can only
// be verified server-side (browsers have no DNS resolver) and surfaces via
// the create/update request's error response instead.

// IBAN lengths per ISO 3166-1 alpha-2 country code (IBAN registry).
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16,
  BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24,
  FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23,
  IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24,
  ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15,
  PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22,
  SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25,
  SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24,
  XK: 20,
};

const IBAN_STRUCTURE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/;

function normalizeIban(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

/** Returns a human-readable error, or null if `raw` is a well-formed IBAN. */
export function ibanFormatError(raw: string): string | null {
  const iban = normalizeIban(raw);
  if (!iban) return 'IBAN is required';
  if (!IBAN_STRUCTURE.test(iban)) return 'Invalid IBAN format';

  const country = iban.slice(0, 2);
  const wantLen = IBAN_LENGTH[country];
  if (!wantLen) return `Unknown country code "${country}"`;
  if (iban.length !== wantLen) {
    return `Wrong length for ${country} (expected ${wantLen}, got ${iban.length})`;
  }
  if (!ibanChecksumValid(iban)) return 'Invalid IBAN checksum';
  return null;
}

// ISO 7064 MOD 97-10: move the first four characters to the end, expand
// letters to two-digit numbers (A=10..Z=35), and check the result is
// congruent to 1 mod 97.
function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') {
      numeric += ch;
    } else if (ch >= 'A' && ch <= 'Z') {
      numeric += String(ch.charCodeAt(0) - 'A'.charCodeAt(0) + 10);
    } else {
      return false;
    }
  }
  return BigInt(numeric) % 97n === 1n;
}

const EMAIL_STRUCTURE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Returns a human-readable error, or null if `raw` is a well-formed bare
 * email address. An empty string is not an error here — presence isn't
 * enforced client-side, only format of whatever was entered.
 */
export function emailFormatError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[<>"]/.test(trimmed)) return 'Enter a bare email address';
  if (!EMAIL_STRUCTURE.test(trimmed)) return 'Invalid email format';
  return null;
}
