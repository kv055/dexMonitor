import { useLayoutEffect, useRef } from 'react';

interface VisibilityApi {
  isVisible: (key: string) => boolean;
  setVisible: (keys: string[], visible: boolean) => void;
}

/**
 * Makes a selected offer visible on its chart, then restores the exact
 * pre-selection checkbox state when that selection closes or changes.
 */
export function useTemporaryChartVisibility(
  selectionKey: string | number | null,
  chartKey: string | null,
  isVisible: VisibilityApi['isVisible'],
  setVisible: VisibilityApi['setVisible'],
) {
  const apiRef = useRef<VisibilityApi>({ isVisible, setVisible });

  useLayoutEffect(() => {
    apiRef.current = { isVisible, setVisible };
  }, [isVisible, setVisible]);

  useLayoutEffect(() => {
    if (selectionKey == null || chartKey == null) return;

    const wasVisible = apiRef.current.isVisible(chartKey);
    apiRef.current.setVisible([chartKey], true);

    return () => {
      apiRef.current.setVisible([chartKey], wasVisible);
    };
  }, [selectionKey, chartKey]);
}
