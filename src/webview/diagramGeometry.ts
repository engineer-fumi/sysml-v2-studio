/**
 * Pure geometry helpers for the diagram webview: edge path generation and
 * border math. Kept free of React / DOM so they can be unit-tested directly
 * (see test/geometry.ts).
 */
import { EdgeStyle, PortSide } from "../core/layout";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** axis perpendicular to the box border the anchor point sits on */
export type Axis = "h" | "v";

export function sideAxis(box: Rect, p: Pt): Axis {
  const eps = 1.5;
  if (Math.abs(p.x - box.x) < eps || Math.abs(p.x - (box.x + box.w)) < eps) return "h";
  if (Math.abs(p.y - box.y) < eps || Math.abs(p.y - (box.y + box.h)) < eps) return "v";
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return Math.abs(p.x - cx) * box.h > Math.abs(p.y - cy) * box.w ? "h" : "v";
}

/** one right-angle segment: leaves `prev` along `leave`, optionally arrives
 *  at `cur` along `arrive` (so arrows hit box borders perpendicular) */
export function orthoSegment(prev: Pt, cur: Pt, leave: Axis, arrive?: Axis): string {
  if (Math.abs(prev.x - cur.x) < 0.5 || Math.abs(prev.y - cur.y) < 0.5) {
    return ` L ${cur.x} ${cur.y}`;
  }
  if (arrive === "h") {
    if (leave === "h") {
      const mx = (prev.x + cur.x) / 2;
      return ` L ${mx} ${prev.y} L ${mx} ${cur.y} L ${cur.x} ${cur.y}`;
    }
    return ` L ${prev.x} ${cur.y} L ${cur.x} ${cur.y}`;
  }
  if (arrive === "v") {
    if (leave === "v") {
      const my = (prev.y + cur.y) / 2;
      return ` L ${prev.x} ${my} L ${cur.x} ${my} L ${cur.x} ${cur.y}`;
    }
    return ` L ${cur.x} ${prev.y} L ${cur.x} ${cur.y}`;
  }
  return leave === "v"
    ? ` L ${prev.x} ${cur.y} L ${cur.x} ${cur.y}`
    : ` L ${cur.x} ${prev.y} L ${cur.x} ${cur.y}`;
}

/** SVG path for the given style: straight polyline, right-angle, or curve */
export function pathFor(pts: Pt[], style: EdgeStyle, startAxis?: Axis, endAxis?: Axis): string {
  if (pts.length < 2) return "";
  if (style === "ortho") {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const leave = i === 1 ? startAxis ?? "h" : "h";
      const arrive = i === pts.length - 1 ? endAxis : undefined;
      d += orthoSegment(prev, cur, leave, arrive);
    }
    return d;
  }
  if (style === "curve") {
    if (pts.length === 2) {
      const [p0, p1] = pts;
      const dx = (p1.x - p0.x) / 2;
      return `M ${p0.x} ${p0.y} C ${p0.x + dx} ${p0.y}, ${p1.x - dx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x} ${pts[i].y}, ${mx} ${my}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }
  return pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
}

/** shortest distance from point `p` to segment `a`–`b` */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** nearest point on the box border to (mx,my), as a side + 0..1 position */
export function clampToBorder(
  box: Rect,
  mx: number,
  my: number
): { x: number; y: number; side: PortSide; t: number } {
  const dLeft = Math.abs(mx - box.x);
  const dRight = Math.abs(mx - (box.x + box.w));
  const dTop = Math.abs(my - box.y);
  const dBottom = Math.abs(my - (box.y + box.h));
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft || min === dRight) {
    const side: PortSide = min === dLeft ? "left" : "right";
    const t = Math.min(0.95, Math.max(0.05, (my - box.y) / box.h));
    return { x: side === "left" ? box.x : box.x + box.w, y: box.y + t * box.h, side, t };
  }
  const side: PortSide = min === dTop ? "top" : "bottom";
  const t = Math.min(0.95, Math.max(0.05, (mx - box.x) / box.w));
  return { x: box.x + t * box.w, y: side === "top" ? box.y : box.y + box.h, side, t };
}
