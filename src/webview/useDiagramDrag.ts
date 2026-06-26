import { useRef, useState } from "react";
import { PortSide } from "../core/layout";
import { Pt, Rect, clampToBorder } from "./diagramGeometry";
import { computeResize, translatePoints } from "./diagramInteractions";

export interface LivePort {
  key: string;
  x: number;
  y: number;
  side: PortSide;
}

/** an in-progress drag, discriminated by `type` (only one is ever active) */
export type DragStart =
  | { type: "box"; key: string; sx: number; sy: number }
  | {
      type: "resize";
      key: string;
      sx: number;
      sy: number;
      fromTop: boolean;
      startW: number;
      startH: number;
      startDx: number;
      startDy: number;
    }
  | { type: "port"; key: string; box: Rect }
  | { type: "anchor"; key: string; which: "a" | "b"; box: Rect }
  | {
      type: "edge";
      key: string;
      points: Pt[];
      /** waypoint index being dragged; -1 = translate the whole route */
      dragIndex: number;
      orig: Pt[];
      start: Pt;
      base: Pt;
    };

export interface DragLive {
  drag: { key: string; dx: number; dy: number } | null;
  resize: { key: string; mw: number; mh: number; dx: number; dy: number } | null;
  port: LivePort | null;
  anchor: { key: string; which: "a" | "b"; x: number; y: number } | null;
  edge: { key: string; points: Pt[] } | null;
}

export interface DragCommit {
  moveBox(key: string, dx: number, dy: number): void;
  resizeBox(key: string, mw: number, mh: number, dx: number, dy: number): void;
  movePort(key: string, side: PortSide, t: number): void;
  anchorEdge(key: string, which: "a" | "b", side: PortSide, t: number): void;
  routeEdge(key: string, points: Pt[]): void;
}

export interface DragDeps {
  /** client pixel coordinates → diagram coordinates */
  toDiagram: (clientX: number, clientY: number) => Pt;
  /** current zoom factor (for pixel-delta drags) */
  scale: number;
  commit: DragCommit;
}

/**
 * Centralizes every box/port/edge drag interaction: one active gesture, its
 * live preview state, and the move/end dispatch. The component supplies the
 * coordinate transform, the zoom and the commit callbacks; element mousedown
 * handlers build a {@link DragStart} and call `start()`.
 */
export function useDiagramDrag(deps: DragDeps) {
  const activeRef = useRef<DragStart | null>(null);
  const [drag, setDrag] = useState<DragLive["drag"]>(null);
  const [resize, setResize] = useState<DragLive["resize"]>(null);
  const [port, setPort] = useState<DragLive["port"]>(null);
  const [anchor, setAnchor] = useState<DragLive["anchor"]>(null);
  const [edge, setEdge] = useState<DragLive["edge"]>(null);

  const start = (d: DragStart): void => {
    activeRef.current = d;
    // the edge ghost shows immediately (e.g. the first bend), others on move
    if (d.type === "edge") setEdge({ key: d.key, points: d.points });
  };

  /** returns true when a drag consumed the move (so the caller skips panning) */
  const onMove = (clientX: number, clientY: number): boolean => {
    const a = activeRef.current;
    if (!a) return false;
    if (a.type === "anchor") {
      const m = deps.toDiagram(clientX, clientY);
      const c = clampToBorder(a.box, m.x, m.y);
      setAnchor({ key: a.key, which: a.which, x: c.x, y: c.y });
    } else if (a.type === "edge") {
      const m = deps.toDiagram(clientX, clientY);
      const points =
        a.dragIndex >= 0
          ? a.points.map((p, i) => (i === a.dragIndex ? m : p))
          : translatePoints(a.orig, m.x - a.start.x, m.y - a.start.y);
      a.points = points;
      setEdge({ key: a.key, points });
    } else if (a.type === "port") {
      const m = deps.toDiagram(clientX, clientY);
      const c = clampToBorder(a.box, m.x, m.y);
      setPort({ key: a.key, x: c.x, y: c.y, side: c.side });
    } else if (a.type === "resize") {
      const r = computeResize(a, (clientX - a.sx) / deps.scale, (clientY - a.sy) / deps.scale);
      setResize({ key: a.key, ...r });
    } else {
      setDrag({ key: a.key, dx: (clientX - a.sx) / deps.scale, dy: (clientY - a.sy) / deps.scale });
    }
    return true;
  };

  /** commit the active gesture; returns true if anything was committed
   *  (so the caller can suppress the trailing click) */
  const onEnd = (): boolean => {
    const a = activeRef.current;
    let committed = false;
    if (a?.type === "box" && drag && (Math.abs(drag.dx) > 1 || Math.abs(drag.dy) > 1)) {
      deps.commit.moveBox(drag.key, drag.dx, drag.dy);
      committed = true;
    } else if (
      a?.type === "resize" &&
      resize &&
      (Math.abs(resize.mw - a.startW) > 1 || Math.abs(resize.mh - a.startH) > 1)
    ) {
      deps.commit.resizeBox(resize.key, resize.mw, resize.mh, resize.dx, resize.dy);
      committed = true;
    } else if (a?.type === "port" && port) {
      const c = clampToBorder(a.box, port.x, port.y);
      deps.commit.movePort(port.key, c.side, c.t);
      committed = true;
    } else if (a?.type === "anchor" && anchor) {
      const c = clampToBorder(a.box, anchor.x, anchor.y);
      deps.commit.anchorEdge(anchor.key, anchor.which, c.side, c.t);
      committed = true;
    } else if (a?.type === "edge" && edge) {
      // waypoints are persisted relative to the endpoint boxes so they follow
      // when the boxes are moved later
      deps.commit.routeEdge(
        edge.key,
        edge.points.map((p) => ({ x: p.x - a.base.x, y: p.y - a.base.y }))
      );
      committed = true;
    }
    activeRef.current = null;
    setDrag(null);
    setResize(null);
    setPort(null);
    setAnchor(null);
    setEdge(null);
    return committed;
  };

  const live: DragLive = { drag, resize, port, anchor, edge };
  return { live, start, onMove, onEnd, isActive: () => activeRef.current !== null };
}
