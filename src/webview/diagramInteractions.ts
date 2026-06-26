/**
 * Pure state-transition helpers for the diagram drag interactions. Keeping
 * these out of the React component lets the bug-prone math (resize anchoring,
 * route translation) be unit-tested directly (see test/geometry.ts).
 */

/** minimum box dimensions a manual resize may shrink to */
export const MIN_BOX_W = 40;
export const MIN_BOX_H = 30;

export interface ResizeStart {
  /** box size at drag start (diagram units) */
  startW: number;
  startH: number;
  /** box position offset at drag start */
  startDx: number;
  startDy: number;
  /** true when dragging the top-right handle (grows the upper edge) */
  fromTop: boolean;
}

export interface ResizeResult {
  /** absolute minimum size to store */
  mw: number;
  mh: number;
  /** resulting position offset */
  dx: number;
  dy: number;
}

/**
 * Resolve a resize drag (delta ddw/ddh in diagram units) to the final box
 * size + position offset. Invariants:
 *  - bottom-right handle: the top-left corner stays put, the box grows.
 *  - top-right handle: the BOTTOM edge stays put (dy + mh is invariant), so
 *    the box grows upward without the content jumping.
 * The same result is used for both the live preview and the committed value,
 * so what you see while dragging is exactly what gets saved.
 */
export function computeResize(start: ResizeStart, ddw: number, ddh: number): ResizeResult {
  const mw = Math.max(MIN_BOX_W, start.startW + ddw);
  if (start.fromTop) {
    const mh = Math.max(MIN_BOX_H, start.startH - ddh);
    return { mw, mh, dx: start.startDx, dy: start.startDy - (mh - start.startH) };
  }
  return { mw, mh: Math.max(MIN_BOX_H, start.startH + ddh), dx: start.startDx, dy: start.startDy };
}

/** translate a set of points by a delta (used to move a whole edge route) */
export function translatePoints<T extends { x: number; y: number }>(
  points: T[],
  dx: number,
  dy: number
): { x: number; y: number }[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

// ---- pan / zoom ----------------------------------------------------------

export interface View {
  tx: number;
  ty: number;
  scale: number;
}

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 4;
const ZOOM_STEP = 1.12;

/**
 * Zoom toward a point (mx,my given in container pixels) by one wheel notch.
 * The diagram point under the cursor stays fixed on screen.
 */
export function zoomAt(v: View, mx: number, my: number, deltaY: number): View {
  const factor = deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const k = scale / v.scale;
  return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
}

/** container pixel coordinates → diagram coordinates under the given view */
export function toDiagramCoords(v: View, px: number, py: number): { x: number; y: number } {
  return { x: (px - v.tx) / v.scale, y: (py - v.ty) / v.scale };
}
