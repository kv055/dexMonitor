import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResizableColumns } from './ResizableColumns';

const STORAGE_KEY = 'test-split';

// 1012px container = 1000px of panes + the 12px gutter.
function renderColumns() {
  const view = render(
    <ResizableColumns storageKey={STORAGE_KEY} label="Resize panels" minLeftPx={200} minRightPx={300} left={<div>Left pane</div>} right={<div>Right pane</div>} />,
  );
  const container = view.container.firstElementChild as HTMLElement;
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1012, bottom: 600, width: 1012, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  return { container, handle: screen.getByRole('separator', { name: 'Resize panels' }) };
}

function drag(handle: HTMLElement, clientX: number) {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 506 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX });
}

beforeEach(() => window.localStorage.removeItem(STORAGE_KEY));
afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
});

describe('ResizableColumns', () => {
  it('starts at an even split and renders both panes', () => {
    const { container, handle } = renderColumns();
    expect(screen.getByText('Left pane')).toBeTruthy();
    expect(screen.getByText('Right pane')).toBeTruthy();
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    expect(container.style.getPropertyValue('--split-ratio')).toBe('0.5');
  });

  it('follows the pointer and remembers the ratio', () => {
    const { handle } = renderColumns();
    drag(handle, 306); // 300px into the 1000px of panes
    expect(handle.getAttribute('aria-valuenow')).toBe('30');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0.3');
  });

  it('keeps both panes above their minimum widths', () => {
    const { handle } = renderColumns();
    drag(handle, 0);
    expect(handle.getAttribute('aria-valuenow')).toBe('20'); // 200px minimum on the left
    drag(handle, 1012);
    expect(handle.getAttribute('aria-valuenow')).toBe('70'); // 300px minimum on the right
  });

  it('moves with the arrow keys and jumps to the limits with Home and End', () => {
    const { handle } = renderColumns();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('52');
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(handle.getAttribute('aria-valuenow')).toBe('42');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle.getAttribute('aria-valuenow')).toBe('20');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle.getAttribute('aria-valuenow')).toBe('70');
  });

  it('restores a saved ratio and resets to even on double-click', () => {
    window.localStorage.setItem(STORAGE_KEY, '0.35');
    const { handle } = renderColumns();
    expect(handle.getAttribute('aria-valuenow')).toBe('35');
    fireEvent.doubleClick(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0.5');
  });

  it('ignores a saved ratio outside 0..1', () => {
    window.localStorage.setItem(STORAGE_KEY, '4');
    const { handle } = renderColumns();
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
  });
});
