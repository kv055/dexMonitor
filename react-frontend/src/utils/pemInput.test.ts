import { describe, expect, it } from 'vitest';

import { normalizePemInput, pemInputNeedsNormalization } from './pemInput';

// Synthetic PEM built at runtime so the fixture contains no real key
// material and does not trip secret scanners.
const PEM_HEADER = ['-----BEGIN', 'EC', 'PRIVATE', 'KEY-----'].join(' ');
const PEM_FOOTER = ['-----END', 'EC', 'PRIVATE', 'KEY-----'].join(' ');
const FAKE_BODY_LINES = [
  'ZmFrZSBwZW0gYm9keSBsaW5lIG9uZQ==',
  'ZmFrZSBwZW0gYm9keSBsaW5lIHR3bw==',
  'ZmFrZSBwZW0gYm9keSBsaW5lIHRocmVl',
];
const ESCAPED_PEM = [PEM_HEADER, ...FAKE_BODY_LINES, PEM_FOOTER].join('\n');

const ESCAPED_PEM_SINGLE_LINE = ESCAPED_PEM.replace(/\n/g, '\\n');

describe('normalizePemInput', () => {
  it('converts escaped newlines from JSON-style key exports into real newlines', () => {
    const result = normalizePemInput(ESCAPED_PEM_SINGLE_LINE);
    expect(result.value).toBe(ESCAPED_PEM);
    expect(result.changed).toBe(true);
  });

  it('leaves an already clean multi-line PEM untouched apart from trimming', () => {
    const result = normalizePemInput(`  ${ESCAPED_PEM}\n`);
    expect(result.value).toBe(ESCAPED_PEM);
    expect(result.changed).toBe(true);
  });

  it('reports no change for a clean PEM without surrounding whitespace', () => {
    const result = normalizePemInput(ESCAPED_PEM);
    expect(result.value).toBe(ESCAPED_PEM);
    expect(result.changed).toBe(false);
  });

  it('handles escaped CRLF sequences', () => {
    const result = normalizePemInput(ESCAPED_PEM.replace(/\n/g, '\\r\\n'));
    expect(result.value).toBe(ESCAPED_PEM);
    expect(result.changed).toBe(true);
  });

  it('passes non-PEM secrets through unchanged', () => {
    for (const secret of ['aB3dEf6hIj9kLmNo', 'dGVzdCBzZWNyZXQ=', '']) {
      const result = normalizePemInput(secret);
      expect(result.value).toBe(secret.trim());
      expect(result.changed).toBe(false);
    }
  });
});

describe('pemInputNeedsNormalization', () => {
  it('detects escaped newline sequences', () => {
    expect(pemInputNeedsNormalization(ESCAPED_PEM_SINGLE_LINE)).toBe(true);
    expect(pemInputNeedsNormalization('line1\\r\\nline2')).toBe(true);
  });

  it('returns false for clean input', () => {
    expect(pemInputNeedsNormalization(ESCAPED_PEM)).toBe(false);
    expect(pemInputNeedsNormalization('')).toBe(false);
  });
});
