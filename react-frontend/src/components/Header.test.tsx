import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { clearEditionMeta, setPublicEditionMeta } from '../test/edition';

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ username: 'alice', logout: vi.fn() }),
}));

function renderHeader() {
  render(
    <Header
      activeTab="insights"
      onTabChange={vi.fn()}
      onOpenSettings={vi.fn()}
      wssConnected
      pollError={null}
    />,
  );
}

function tabLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Dashboard sections' });
  return Array.from(nav.querySelectorAll('button')).map(button => button.textContent ?? '');
}

describe('Header editions', () => {
  beforeEach(() => {
    vi.stubGlobal('__COMMIT_HASH__', 'abc1234');
    vi.stubGlobal('__COMMIT_DATE__', '');
  });
  afterEach(() => {
    cleanup();
    clearEditionMeta();
    vi.unstubAllGlobals();
  });

  it('shows every tab, the Metrics link and logout in the trading edition', () => {
    renderHeader();
    expect(tabLabels()).toEqual(['dex Monitor', 'Statistics', 'Trading Accounts', 'dex Taker Controller', 'Settings']);
    expect(screen.getByText('Metrics')).toBeTruthy();
    expect(screen.getByTitle('Log out (alice)')).toBeTruthy();
  });

  it('shows only the dex Monitor and Statistics tabs in the public edition', () => {
    setPublicEditionMeta();
    renderHeader();
    expect(tabLabels()).toEqual(['dex Monitor', 'Statistics']);
    expect(screen.queryByText('Metrics')).toBeNull();
    expect(screen.queryByTitle(/Log out/)).toBeNull();
    // The gear menu stays: it holds the viewer's own timezone and size preferences.
    expect(screen.getByTitle('Settings')).toBeTruthy();
  });
});
