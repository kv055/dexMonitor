export interface AxisWindow {
  min: number;
  max: number;
}

export function isZoomedWindow(window: AxisWindow, bounds: AxisWindow): boolean {
  return window.max - window.min < (bounds.max - bounds.min) * 0.995;
}

export function isDefaultWindow(window: AxisWindow, bounds: AxisWindow): boolean {
  const span = Math.max(bounds.max - bounds.min, Number.EPSILON);
  const epsilon = span * 0.005;
  return Math.abs(window.min - bounds.min) <= epsilon && Math.abs(window.max - bounds.max) <= epsilon;
}

export function expandPanBounds(data: AxisWindow): AxisWindow {
  const span = Math.max(data.max - data.min, Number.EPSILON);
  const overscroll = Math.max(span, Math.abs(data.max), Math.abs(data.min));
  return {
    min: Math.min(data.min, 0) - overscroll,
    max: Math.max(data.max, 0) + overscroll,
  };
}

export function translateWindow(
  source: AxisWindow,
  bounds: AxisWindow,
  valueShift: number,
): AxisWindow {
  let nextMin = source.min + valueShift;
  let nextMax = source.max + valueShift;
  if (nextMin < bounds.min) {
    nextMax += bounds.min - nextMin;
    nextMin = bounds.min;
  }
  if (nextMax > bounds.max) {
    nextMin -= nextMax - bounds.max;
    nextMax = bounds.max;
  }
  return {
    min: Math.max(bounds.min, nextMin),
    max: Math.min(bounds.max, nextMax),
  };
}
