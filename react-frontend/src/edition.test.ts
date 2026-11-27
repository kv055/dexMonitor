import { afterEach, describe, expect, it } from 'vitest';
import { EDITION_META_NAME, isPublicEdition } from './edition';
import { clearEditionMeta, setPublicEditionMeta } from './test/edition';

describe('isPublicEdition', () => {
  afterEach(clearEditionMeta);

  it('is false without the meta tag (trading deployment)', () => {
    expect(isPublicEdition()).toBe(false);
  });

  it('is true when dexMonitor marks the page as public', () => {
    setPublicEditionMeta();
    expect(isPublicEdition()).toBe(true);
  });

  it('ignores other edition values', () => {
    const meta = document.createElement('meta');
    meta.name = EDITION_META_NAME;
    meta.content = 'trading';
    document.head.appendChild(meta);
    expect(isPublicEdition()).toBe(false);
  });
});
