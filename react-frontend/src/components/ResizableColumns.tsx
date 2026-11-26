import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { readStoredNullableNumber, writeStoredValue } from '../shared/storage';

const DEFAULT_RATIO = 0.5;
const KEYBOARD_STEP = 0.02;
const KEYBOARD_STEP_LARGE = 0.1;
/** Width of the drag handle between the panes; it doubles as the gap. Keep in sync with --split-gutter. */
const GUTTER_PX = 12;

function clampRatio(ratio: number, availableWidth: number, minLeftPx: number, minRightPx: number) {
  if (availableWidth <= 0) return ratio;
  const min = Math.min(0.5, minLeftPx / availableWidth);
  const max = Math.max(0.5, 1 - minRightPx / availableWidth);
  return Math.min(max, Math.max(min, ratio));
}

function readStoredRatio(storageKey: string) {
  const stored = readStoredNullableNumber(storageKey);
  return stored != null && stored > 0 && stored < 1 ? stored : DEFAULT_RATIO;
}

/**
 * Two side-by-side panes with a draggable divider. Above the xl breakpoint the
 * panes sit in a row and the split ratio is adjustable and remembered; below it
 * they stack and the divider is hidden. Minimum widths are also enforced in CSS,
 * so a saved ratio cannot squeeze a pane after the window shrinks.
 */
export function ResizableColumns({
  left,
  right,
  storageKey,
  label,
  minLeftPx = 256,
  minRightPx = 512,
  className = '',
}: {
  left: ReactNode;
  right: ReactNode;
  storageKey: string;
  label: string;
  minLeftPx?: number;
  minRightPx?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const [ratio, setRatio] = useState(() => readStoredRatio(storageKey));
  const [dragging, setDragging] = useState(false);

  const availableWidth = () => Math.max(0, (containerRef.current?.getBoundingClientRect().width ?? 0) - GUTTER_PX);

  const commit = useCallback((next: number) => {
    setRatio(next);
    writeStoredValue(storageKey, Number(next.toFixed(4)));
  }, [storageKey]);

  const ratioFromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return ratio;
    const width = Math.max(0, rect.width - GUTTER_PX);
    return clampRatio((clientX - rect.left - GUTTER_PX / 2) / width, width, minLeftPx, minRightPx);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add('is-resizing-columns');
    setDragging(true);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    setRatio(ratioFromPointer(event.clientX));
    event.preventDefault();
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.documentElement.classList.remove('is-resizing-columns');
    setDragging(false);
    commit(ratioFromPointer(event.clientX));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const width = availableWidth();
    const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = ratio - step;
    else if (event.key === 'ArrowRight') next = ratio + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    if (next == null) return;
    event.preventDefault();
    commit(clampRatio(next, width, minLeftPx, minRightPx));
  };

  const style = {
    '--split-ratio': ratio,
    '--split-gutter': `${GUTTER_PX}px`,
    '--split-min-left': `${minLeftPx}px`,
    '--split-min-right': `${minRightPx}px`,
  } as CSSProperties;

  return (
    <div ref={containerRef} className={`split-columns${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`} style={style}>
      <div className="split-columns__pane split-columns__pane--left">{left}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        title="Drag to resize · double-click to reset"
        className="split-columns__handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => commit(DEFAULT_RATIO)}
        onKeyDown={handleKeyDown}
      >
        <span aria-hidden="true" />
      </div>
      <div className="split-columns__pane split-columns__pane--right">{right}</div>
    </div>
  );
}
