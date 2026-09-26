import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { isChunkLoadError, shouldReloadForChunkError } from '../utils/chunkErrors';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('isChunkLoadError', () => {
  it('matches the dynamic-import failures browsers report for stale chunks', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://dash/assets/StatisticsView-abc.js'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module: https://dash/assets/StatisticsView-abc.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);
  });

  it('rejects ordinary render errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of null'))).toBe(false);
    expect(isChunkLoadError(new Error(''))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('shouldReloadForChunkError', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('allows one reload per tab session, then refuses', () => {
    expect(shouldReloadForChunkError()).toBe(true);
    expect(sessionStorage.getItem('dex-view-chunk-reloaded')).toBe('1');
    expect(shouldReloadForChunkError()).toBe(false);
  });

  it('refuses when session storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(shouldReloadForChunkError()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('ErrorBoundary', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary viewName="statistics">
        <span>stats content</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText('stats content')).toBeTruthy();
  });

  it('shows the update card for a chunk failure after the one reload was used', () => {
    // Flag preset: the auto-reload already happened, so rendering must not
    // attempt navigation (jsdom cannot navigate) and falls through to the card.
    sessionStorage.setItem('dex-view-chunk-reloaded', '1');
    render(
      <ErrorBoundary viewName="statistics">
        <Boom message="Failed to fetch dynamically imported module: https://dash/assets/StatisticsView-abc.js" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('A new version was deployed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('shows a retry card for ordinary errors and recovers on retry', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('boom');
      return <span>recovered</span>;
    }

    render(
      <ErrorBoundary viewName="statistics">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Couldn't load the statistics view")).toBeTruthy();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
