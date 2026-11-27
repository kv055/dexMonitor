import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsOverlay } from './SettingsOverlay';
import { clearEditionMeta, setPublicEditionMeta } from '../test/edition';

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({
    preferredTimezone: 'UTC',
    setPreferredTimezone: vi.fn(),
    maxFiatLimit: 1000,
    setMaxFiatLimit: vi.fn(),
    hideZeroTrustScore: false,
    setHideZeroTrustScore: vi.fn(),
  }),
}));

vi.mock('../hooks/useFilters', () => ({
  useFilters: () => ({ zeroTrustHiddenCount: 0, filters: { fiat: 'EUR' } }),
}));

vi.mock('../hooks/useCEXPermissions', () => ({
  useCEXPermissions: () => ({
    exchanges: [],
    loading: false,
    error: null,
    updating: null,
    updatePolicy: vi.fn(),
    reload: vi.fn(),
  }),
}));

describe('SettingsOverlay editions', () => {
  afterEach(() => {
    cleanup();
    clearEditionMeta();
  });

  it('offers the shared CEX exchange switches in the trading edition', () => {
    render(<SettingsOverlay open onClose={vi.fn()} />);
    expect(screen.getByText('CEX Exchanges')).toBeTruthy();
    expect(screen.getByText('Preferred Timezone')).toBeTruthy();
  });

  it('keeps only per-viewer preferences in the public edition', () => {
    setPublicEditionMeta();
    render(<SettingsOverlay open onClose={vi.fn()} />);
    expect(screen.queryByText('CEX Exchanges')).toBeNull();
    expect(screen.getByText('Preferred Timezone')).toBeTruthy();
    expect(screen.getByText('Seller Trust Score')).toBeTruthy();
    expect(screen.getByText('Max Position Size (Fiat)')).toBeTruthy();
  });
});
