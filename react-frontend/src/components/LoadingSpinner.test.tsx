import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferencesProvider } from '../context/PreferencesContext';
import { LoadingSpinner } from './LoadingSpinner';

describe('LoadingSpinner', () => {
  beforeEach(() => localStorage.clear());

  it('uses the active theme asset and exposes its status text', () => {
    localStorage.setItem('dex-theme', 'light');
    render(
      <PreferencesProvider>
        <LoadingSpinner label="Loading offers" />
      </PreferencesProvider>,
    );

    expect(screen.getByText('Loading offers')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/brand/spinner-light.svg');
  });
});
