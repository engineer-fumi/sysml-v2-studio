import { useRef, useState } from "react";
import { View, zoomAt } from "./diagramInteractions";

const INITIAL: View = { tx: 20, ty: 20, scale: 1 };

/**
 * Owns the diagram viewport (translation + zoom) and the panning gesture.
 * Coordinates are in container pixels: callers pass the cursor position
 * relative to the SVG's top-left corner (clientX - rect.left, ...).
 */
export function usePanZoom() {
  const [view, setView] = useState<View>(INITIAL);
  const panRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);

  /** wheel zoom toward the cursor (px,py relative to the container) */
  const onWheel = (px: number, py: number, deltaY: number): void => {
    setView((v) => zoomAt(v, px, py, deltaY));
  };

  /** begin a pan gesture at the given client position */
  const beginPan = (clientX: number, clientY: number): void => {
    panRef.current = { px: clientX, py: clientY, tx: view.tx, ty: view.ty };
  };

  /** continue a pan; returns true if a pan is in progress */
  const movePan = (clientX: number, clientY: number): boolean => {
    const p = panRef.current;
    if (!p) return false;
    setView((v) => ({ ...v, tx: p.tx + clientX - p.px, ty: p.ty + clientY - p.py }));
    return true;
  };

  const endPan = (): void => {
    panRef.current = null;
  };

  const reset = (): void => setView(INITIAL);

  const fit = (contentW: number, contentH: number, rectW: number, rectH: number): void => {
    if (!contentW || !contentH) return;
    const scale = Math.min((rectW - 40) / contentW, (rectH - 40) / contentH, 1.5);
    setView({
      scale,
      tx: (rectW - contentW * scale) / 2,
      ty: (rectH - contentH * scale) / 2,
    });
  };

  return { view, setView, onWheel, beginPan, movePan, endPan, reset, fit };
}
