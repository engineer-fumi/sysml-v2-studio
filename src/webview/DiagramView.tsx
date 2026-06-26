import { useEffect, useMemo, useRef, useState } from "react";
import {
  DiagramEdge,
  DiagramKind,
  DiagramNode,
  DiagramPort,
  EdgeStyle,
  LayoutOffsets,
  PortSide,
  edgeRoutingBase,
  layoutDiagram,
  portOffsetKey,
} from "../core/layout";
import { SysMLElement } from "../core/ast";
import { distToSegment, pathFor, sideAxis } from "./diagramGeometry";
import { usePanZoom } from "./usePanZoom";
import { DragStart, LivePort, useDiagramDrag } from "./useDiagramDrag";

export type EditMode = "select" | "connect" | `add:${string}`;

interface Interaction {
  mode: EditMode;
  selected?: SysMLElement;
  marked?: SysMLElement;
  onClick: (el: SysMLElement) => void;
  onDoubleClick: (el: SysMLElement) => void;
  onBoxMouseDown: (node: DiagramNode, e: React.MouseEvent) => void;
  onResizeMouseDown: (node: DiagramNode, e: React.MouseEvent, fromTop: boolean) => void;
  onPortMouseDown: (node: DiagramNode, port: DiagramPort, e: React.MouseEvent) => void;
  portKey: (owner: SysMLElement, port: SysMLElement) => string;
  /** drag-in-progress port position (ghost) */
  livePort?: LivePort | null;
  /** start dragging an edge (optionally an existing waypoint) */
  onEdgeMouseDown: (edge: DiagramEdge, e: React.MouseEvent, waypointIndex?: number) => void;
  onWaypointRemove: (edge: DiagramEdge, index: number) => void;
  /** drag-in-progress edge routing */
  liveEdge?: { key: string; points: { x: number; y: number }[] } | null;
  /** open the context menu for an edge (optionally on a waypoint) */
  onEdgeContextMenu: (edge: DiagramEdge, e: React.MouseEvent, waypointIndex?: number) => void;
  /** start dragging an edge endpoint along its box border */
  onEndpointMouseDown: (edge: DiagramEdge, which: "a" | "b", e: React.MouseEvent) => void;
  /** drag-in-progress endpoint position (ghost) */
  liveAnchor?: { key: string; which: "a" | "b"; x: number; y: number } | null;
  /** open the context menu for a box / actor / port element */
  onNodeContextMenu: (el: SysMLElement, e: React.MouseEvent, named: boolean) => void;
}

interface MenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

interface Props {
  root: SysMLElement;
  /** diagram view kind (general / bdd / ibd / req / uc / state / action / seq) */
  kind: DiagramKind;
  selected?: SysMLElement;
  /** secondary highlight (connect souce) */
  marked?: SysMLElement;
  mode: EditMode;
  offsets: LayoutOffsets;
  keyOf: (el: SysMLElement) => string;
  onElementClick: (el: SysMLElement) => void;
  onElementDoubleClick: (el: SysMLElement) => void;
  /** commit a box move (delta in diagram coordinates) */
  onMoveBox: (key: string, ddx: number, ddy: number) => void;
  /** commit a box resize to an absolute minimum size, with the box's final
   *  position offset (dy moves up when resizing from the top edge) */
  onResizeBox: (key: string, mw: number, mh: number, dx: number, dy: number) => void;
  /** commit a port move to a border side at position t (0..1 along the side) */
  onMovePort: (key: string, side: PortSide, t: number) => void;
  /** commit manual edge routing (empty array clears the routing) */
  onRouteEdge: (key: string, points: { x: number; y: number }[]) => void;
  /** change the line style of an edge */
  onEdgeStyle: (key: string, style: EdgeStyle) => void;
  /** pin an edge endpoint to a border position; null side clears both pins */
  onAnchorEdge: (key: string, which: "a" | "b" | null, side?: PortSide, t?: number) => void;
  /** delete the model element behind a box / line */
  onDeleteElement: (el: SysMLElement) => void;
  /** enter connect mode with the given element as the source */
  onStartConnect: (el: SysMLElement) => void;
  /** click on empty canvas (used by the add modes) */
  onBackgroundClick?: () => void;
}

/** edge kinds whose underlying statement can be safely deleted from the menu
 *  (synthesized edges like compose / specialize map to declarations) */
const DELETABLE_EDGE_KINDS = new Set([
  "connect", "flow", "bind", "transition", "interface", "connection",
  "allocation", "satisfy", "perform", "import",
]);

const KIND_FILL: Record<string, string> = {
  package: "#2a2a3e",
  "library package": "#2a2a3e",
  "part def": "#1e2a40",
  part: "#22304a",
  "item def": "#1c3331",
  item: "#1c3331",
  "action def": "#2a2340",
  action: "#2f284a",
  "state def": "#3a2438",
  state: "#42293f",
  "requirement def": "#3a2229",
  requirement: "#42262e",
  exhibit: "#42293f",
  perform: "#2f284a",
};

const EDGE_COLOR: Record<string, string> = {
  connect: "#74c7ec",
  connection: "#74c7ec",
  interface: "#fab387",
  bind: "#9399b2",
  flow: "#a6e3a1",
  transition: "#f5c2e7",
  allocation: "#f9e2af",
  specialize: "#cba6f7",
  compose: "#89b4fa",
  satisfy: "#f38ba8",
  perform: "#b4befe",
  assoc: "#9399b2",
  import: "#7f849c",
};

/** kinds whose end marker is custom (hollow triangle / diamond), not the generic arrow */
const CUSTOM_MARKER_KINDS = new Set(["specialize", "compose"]);

function fillFor(node: DiagramNode): string {
  return KIND_FILL[node.el.kind] ?? "#252536";
}

function strokeFor(node: DiagramNode, it: Interaction): { stroke: string; width: number } {
  if (it.selected === node.el) return { stroke: "#f9e2af", width: 2.5 };
  if (it.marked === node.el) return { stroke: "#a6e3a1", width: 2.5 };
  return { stroke: "#585b70", width: 1.2 };
}

/** use case actor: stick figure with the name below */
function ActorFigure({ node, it }: { node: DiagramNode; it: Interaction }) {
  const { stroke } = strokeFor(node, it);
  const color = it.selected === node.el ? stroke : "#fab387";
  const cx = node.x + node.w / 2;
  const top = node.y + 4;
  const draggable = it.mode === "select" && !!node.el.name;
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        it.onClick(node.el);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        it.onDoubleClick(node.el);
      }}
      onMouseDown={(e) => {
        if (draggable) {
          e.stopPropagation();
          it.onBoxMouseDown(node, e);
        }
      }}
      onContextMenu={(e) => it.onNodeContextMenu(node.el, e, !!node.el.name)}
      style={{ cursor: draggable ? "move" : "pointer" }}
    >
      <rect x={node.x} y={node.y} width={node.w} height={node.h} fill="transparent" />
      <circle cx={cx} cy={top + 9} r={8} fill="none" stroke={color} strokeWidth={1.6} />
      <line x1={cx} y1={top + 17} x2={cx} y2={top + 40} stroke={color} strokeWidth={1.6} />
      <line x1={cx - 14} y1={top + 25} x2={cx + 14} y2={top + 25} stroke={color} strokeWidth={1.6} />
      <line x1={cx} y1={top + 40} x2={cx - 12} y2={top + 58} stroke={color} strokeWidth={1.6} />
      <line x1={cx} y1={top + 40} x2={cx + 12} y2={top + 58} stroke={color} strokeWidth={1.6} />
      <text
        x={cx}
        y={top + 74}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill="#cdd6f4"
        pointerEvents="none"
      >
        {node.label}
      </text>
    </g>
  );
}

function NodeBox({ node, it }: { node: DiagramNode; it: Interaction }) {
  if (node.actor) return <ActorFigure node={node} it={it} />;
  const { stroke, width } = strokeFor(node, it);
  const headerY = node.y + 14;
  // any named box can be moved in select mode (children re-anchor the parent)
  const draggable = it.mode === "select" && !!node.el.name;
  const shapeProps = {
    fill: fillFor(node),
    stroke,
    strokeWidth: width,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      it.onClick(node.el);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      it.onDoubleClick(node.el);
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (draggable) {
        e.stopPropagation();
        it.onBoxMouseDown(node, e);
      }
    },
    onContextMenu: (e: React.MouseEvent) => it.onNodeContextMenu(node.el, e, !!node.el.name),
    style: { cursor: draggable ? "move" : "pointer" } as React.CSSProperties,
  };
  return (
    <g>
      {node.lifelineEnd !== undefined && (
        <line
          x1={node.x + node.w / 2}
          y1={node.y + node.h}
          x2={node.x + node.w / 2}
          y2={node.lifelineEnd}
          stroke="#585b70"
          strokeWidth={1}
          strokeDasharray="5 5"
        />
      )}
      {node.ellipse ? (
        <ellipse
          cx={node.x + node.w / 2}
          cy={node.y + node.h / 2}
          rx={node.w / 2 + 10}
          ry={node.h / 2 + 8}
          {...shapeProps}
        />
      ) : (
        <rect
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={node.rounded ? 14 : 4}
          {...shapeProps}
        />
      )}
      <text
        x={node.x + node.w / 2}
        y={headerY}
        textAnchor="middle"
        fontSize={10}
        fill="#9399b2"
        pointerEvents="none"
      >
        {`«${node.kindLabel}»`}
      </text>
      <text
        x={node.x + node.w / 2}
        y={headerY + 15}
        textAnchor="middle"
        fontSize={12.5}
        fontWeight={600}
        fill="#cdd6f4"
        pointerEvents="none"
      >
        {node.label}
        {node.typeLabel && (
          <tspan fontWeight={400} fill="#89b4fa">
            {" " + node.typeLabel}
          </tspan>
        )}
      </text>
      {node.attributes.length > 0 && (
        <>
          <line
            x1={node.x}
            x2={node.x + node.w}
            y1={node.y + 36}
            y2={node.y + 36}
            stroke="#585b70"
            strokeWidth={0.8}
          />
          {node.attributes.map((a, i) => (
            <text
              key={i}
              x={node.x + 10}
              y={node.y + 50 + i * 16}
              fontSize={11}
              fill="#a6adc8"
              pointerEvents="none"
            >
              {a}
            </text>
          ))}
        </>
      )}
      {node.ports.map((p, i) => {
        const pk = it.portKey(node.el, p.el);
        const lp = it.livePort && it.livePort.key === pk ? it.livePort : undefined;
        const px = lp?.x ?? p.x;
        const py = lp?.y ?? p.y;
        const side = lp?.side ?? p.side;
        // labels sit just outside the box boundary (top→above, bottom→below) so
        // they never collide with the box header or inner content
        const labelPos =
          side === "left"
            ? { x: px + 9, y: py + 4, anchor: "start" as const }
            : side === "right"
              ? { x: px - 9, y: py + 4, anchor: "end" as const }
              : side === "top"
                ? { x: px, y: py - 10, anchor: "middle" as const }
                : { x: px, y: py + 18, anchor: "middle" as const };
        return (
          <g
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              it.onClick(p.el);
            }}
            onMouseDown={(e) => {
              if (it.mode === "select") {
                e.stopPropagation();
                it.onPortMouseDown(node, p, e);
              }
            }}
            onContextMenu={(e) => it.onNodeContextMenu(p.el, e, false)}
            style={{ cursor: it.mode === "select" ? "move" : "pointer" }}
          >
            <rect
              x={px - 5}
              y={py - 5}
              width={10}
              height={10}
              fill={it.selected === p.el ? "#f9e2af" : it.marked === p.el ? "#a6e3a1" : "#fab387"}
              stroke="#1e1e2e"
              strokeWidth={1}
            />
            <text
              x={labelPos.x}
              y={labelPos.y}
              fontSize={10}
              fill="#fab387"
              textAnchor={labelPos.anchor}
              pointerEvents="none"
            >
              {p.name}
            </text>
          </g>
        );
      })}
      {node.children.map((c, i) => (
        <NodeBox key={i} node={c} it={it} />
      ))}
      {/* resize handles: bottom-right grows down/right, top-right grows up/right */}
      {draggable && !node.ellipse && node.lifelineEnd === undefined && (
        <>
          <path
            d={`M ${node.x + node.w} ${node.y + node.h - 12} L ${node.x + node.w} ${node.y + node.h} L ${node.x + node.w - 12} ${node.y + node.h} z`}
            fill="#585b70"
            onMouseDown={(e) => {
              e.stopPropagation();
              it.onResizeMouseDown(node, e, false);
            }}
            style={{ cursor: "nwse-resize" }}
          />
          <path
            d={`M ${node.x + node.w - 12} ${node.y} L ${node.x + node.w} ${node.y} L ${node.x + node.w} ${node.y + 12} z`}
            fill="#585b70"
            onMouseDown={(e) => {
              e.stopPropagation();
              it.onResizeMouseDown(node, e, true);
            }}
            style={{ cursor: "nesw-resize" }}
          />
        </>
      )}
    </g>
  );
}

function EdgeLine({ edge, it }: { edge: DiagramEdge; it: Interaction }) {
  const color = EDGE_COLOR[edge.kind] ?? "#74c7ec";
  const isSelected = it.selected === edge.el;
  // full path: source anchor, manual waypoints (live ones while dragging), target anchor
  const live = it.liveEdge && edge.key && it.liveEdge.key === edge.key ? it.liveEdge.points : undefined;
  const waypoints = live ?? edge.points ?? [];
  const la = it.liveAnchor && edge.key && it.liveAnchor.key === edge.key ? it.liveAnchor : undefined;
  const start = la?.which === "a" ? { x: la.x, y: la.y } : { x: edge.x1, y: edge.y1 };
  const end = la?.which === "b" ? { x: la.x, y: la.y } : { x: edge.x2, y: edge.y2 };
  const pts = [start, ...waypoints, end];
  const midA = pts[Math.floor((pts.length - 1) / 2)];
  const midB = pts[Math.floor((pts.length - 1) / 2) + 1] ?? midA;
  const mx = (midA.x + midB.x) / 2;
  const my = (midA.y + midB.y) / 2;
  const startAxis = edge.a ? sideAxis(edge.a, pts[0]) : undefined;
  const endAxis = edge.b ? sideAxis(edge.b, pts[pts.length - 1]) : undefined;
  const d = pathFor(pts, edge.style ?? "straight", startAxis, endAxis);
  const routable = it.mode === "select" && !!edge.key && !!edge.a && !!edge.b;
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        it.onClick(edge.el);
      }}
      onContextMenu={(e) => it.onEdgeContextMenu(edge, e)}
      style={{ cursor: routable ? "move" : "pointer" }}
    >
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={10}
        onMouseDown={(e) => {
          if (routable) {
            e.stopPropagation();
            it.onEdgeMouseDown(edge, e);
          }
        }}
      />
      <path
        d={d}
        fill="none"
        stroke={isSelected ? "#f9e2af" : color}
        strokeWidth={isSelected ? 2.5 : 1.5}
        strokeDasharray={edge.dashed ? "6 4" : undefined}
        markerEnd={
          edge.kind === "specialize"
            ? "url(#tri-specialize)"
            : edge.arrow
              ? `url(#arrow-${edge.kind})`
              : undefined
        }
        markerStart={edge.kind === "compose" ? "url(#diamond-compose)" : undefined}
        pointerEvents="none"
      />
      {/* waypoint handles: drag to move, double-click to remove */}
      {waypoints.map((p, i) => (
        <g
          key={i}
          onMouseDown={(e) => {
            if (routable) {
              e.stopPropagation();
              it.onEdgeMouseDown(edge, e, i);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            it.onWaypointRemove(edge, i);
          }}
          onContextMenu={(e) => it.onEdgeContextMenu(edge, e, i)}
          style={{ cursor: "move" }}
        >
          <circle cx={p.x} cy={p.y} r={9} fill="transparent" />
          <circle cx={p.x} cy={p.y} r={4} fill={color} stroke="#1e1e2e" strokeWidth={1} />
        </g>
      ))}
      {isSelected && routable && (
        <>
          {(["a", "b"] as const).map((which) => {
            const p = which === "a" ? pts[0] : pts[pts.length - 1];
            return (
              <rect
                key={which}
                x={p.x - 5}
                y={p.y - 5}
                width={10}
                height={10}
                fill="#f9e2af"
                stroke="#1e1e2e"
                strokeWidth={1}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  it.onEndpointMouseDown(edge, which, e);
                }}
                style={{ cursor: "move" }}
              />
            );
          })}
        </>
      )}
      {edge.label && (
        <text
          x={mx}
          y={my - 6}
          fontSize={10}
          fill={color}
          textAnchor="middle"
          style={{ paintOrder: "stroke", stroke: "#1e1e2e", strokeWidth: 3 }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

export function DiagramView({
  root,
  kind,
  selected,
  marked,
  mode,
  offsets,
  keyOf,
  onElementClick,
  onElementDoubleClick,
  onMoveBox,
  onResizeBox,
  onMovePort,
  onRouteEdge,
  onEdgeStyle,
  onAnchorEdge,
  onDeleteElement,
  onStartConnect,
  onBackgroundClick,
}: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const { view, onWheel: zoomWheel, beginPan, movePan, endPan, reset: resetView, fit: fitView } =
    usePanZoom();
  const svgRef = useRef<SVGSVGElement>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  /** swallow the click that the browser fires right after a drag/resize */
  const suppressClickRef = useRef(false);

  /** client coordinates -> diagram coordinates */
  const toDiagram = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  };

  const drag = useDiagramDrag({
    toDiagram,
    scale: view.scale,
    commit: {
      moveBox: onMoveBox,
      resizeBox: onResizeBox,
      movePort: onMovePort,
      anchorEdge: onAnchorEdge,
      routeEdge: onRouteEdge,
    },
  });

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const effectiveOffsets = useMemo(() => {
    const liveDrag = drag.live.drag;
    const liveResize = drag.live.resize;
    if (!liveDrag && !liveResize) return offsets;
    const next = { ...offsets };
    if (liveDrag) {
      const cur = next[liveDrag.key] ?? { dx: 0, dy: 0 };
      next[liveDrag.key] = { ...cur, dx: cur.dx + liveDrag.dx, dy: cur.dy + liveDrag.dy };
    }
    if (liveResize) {
      const cur = next[liveResize.key] ?? { dx: 0, dy: 0 };
      next[liveResize.key] = {
        ...cur,
        dx: liveResize.dx,
        dy: liveResize.dy,
        mw: liveResize.mw,
        mh: liveResize.mh,
        dw: 0,
        dh: 0,
      };
    }
    return next;
  }, [offsets, drag.live.drag, drag.live.resize]);

  const layout = useMemo(
    () => layoutDiagram(root, { offsets: effectiveOffsets, keyOf, kind }),
    [root, effectiveOffsets, keyOf, kind]
  );

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomWheel(e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
  };

  const onBoxMouseDown = (node: DiagramNode, e: React.MouseEvent) => {
    drag.start({ type: "box", key: keyOf(node.el), sx: e.clientX, sy: e.clientY });
  };

  const onResizeMouseDown = (node: DiagramNode, e: React.MouseEvent, fromTop: boolean) => {
    const key = keyOf(node.el);
    const cur = offsets[key];
    drag.start({
      type: "resize",
      key,
      sx: e.clientX,
      sy: e.clientY,
      fromTop,
      startW: node.w,
      startH: node.h,
      startDx: cur?.dx ?? 0,
      startDy: cur?.dy ?? 0,
    });
  };

  const onPortMouseDown = (node: DiagramNode, port: DiagramPort) => {
    drag.start({
      type: "port",
      key: portOffsetKey(keyOf, node.el, port.el),
      box: { x: node.x, y: node.y, w: node.w, h: node.h },
    });
  };

  /** start dragging an edge endpoint along the border of its box */
  const onEndpointMouseDown = (edge: DiagramEdge, which: "a" | "b", _e: React.MouseEvent) => {
    if (!edge.key) return;
    const box = which === "a" ? edge.a : edge.b;
    if (!box) return;
    drag.start({
      type: "anchor",
      key: edge.key,
      which,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
    });
  };

  /** start routing an edge: grab an existing waypoint, or drag the whole
   *  route. Waypoints are only ADDED via the context menu, never by drag. */
  const onEdgeMouseDown = (edge: DiagramEdge, e: React.MouseEvent, waypointIndex?: number) => {
    if (!edge.key) return;
    const base = edgeRoutingBase(edge);
    if (!base) return;
    const points = (edge.points ?? []).map((p) => ({ ...p }));
    const m = toDiagram(e.clientX, e.clientY);
    let dragIndex: number;
    if (waypointIndex !== undefined) {
      dragIndex = waypointIndex;
    } else {
      const grabRadius = 10 / view.scale;
      // near an endpoint: move the endpoint along its box border instead
      const endpointR = 14 / view.scale;
      const dA = Math.hypot(edge.x1 - m.x, edge.y1 - m.y);
      const dB = Math.hypot(edge.x2 - m.x, edge.y2 - m.y);
      if (Math.min(dA, dB) <= endpointR) {
        onEndpointMouseDown(edge, dA <= dB ? "a" : "b", e);
        return;
      }
      // near an existing waypoint: grab it; otherwise translate the route
      let nearest = -1;
      let nearestD = grabRadius;
      points.forEach((p, i) => {
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d <= nearestD) {
          nearestD = d;
          nearest = i;
        }
      });
      if (nearest >= 0) {
        dragIndex = nearest;
      } else if (points.length) {
        dragIndex = -1; // move all waypoints together
      } else {
        // straight line: dragging creates the FIRST bend (further waypoints
        // are added via the context menu only, so they cannot pile up)
        points.push(m);
        dragIndex = 0;
      }
    }
    const startState: DragStart = {
      type: "edge",
      key: edge.key,
      points,
      dragIndex,
      orig: points.map((p) => ({ ...p })),
      start: m,
      base,
    };
    drag.start(startState);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    downPosRef.current = { x: e.clientX, y: e.clientY };
    beginPan(e.clientX, e.clientY);
  };

  const onSvgClick = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const d = downPosRef.current;
    const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : 0;
    if (moved < 4) onBackgroundClick?.();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (drag.onMove(e.clientX, e.clientY)) return;
    movePan(e.clientX, e.clientY);
  };

  const endDrag = () => {
    if (drag.onEnd()) suppressClickRef.current = true;
    endPan();
  };

  const fit = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) fitView(layout.width, layout.height, rect.width, rect.height);
  };

  const exportSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    clone.setAttribute("width", String(layout.width));
    clone.setAttribute("height", String(layout.height));
    const g = clone.querySelector("g[data-viewport]");
    g?.setAttribute("transform", "");
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)],
      { type: "image/svg+xml" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- context menus -------------------------------------------------------

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = viewRef.current?.getBoundingClientRect();
    setMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), items });
  };

  /** commit edge waypoints, converting to box-relative coordinates */
  const commitRoute = (edge: DiagramEdge, absPoints: { x: number; y: number }[]) => {
    if (!edge.key) return;
    const base = edgeRoutingBase(edge);
    if (!base) return;
    onRouteEdge(edge.key, absPoints.map((p) => ({ x: p.x - base.x, y: p.y - base.y })));
  };

  const onEdgeContextMenu = (edge: DiagramEdge, e: React.MouseEvent, waypointIndex?: number) => {
    if (!edge.key) return;
    const m = toDiagram(e.clientX, e.clientY);
    const points = (edge.points ?? []).map((p) => ({ ...p }));
    // a waypoint near the click can be removed directly
    let nearIndex = waypointIndex ?? -1;
    if (nearIndex < 0) {
      const grabRadius = 12 / view.scale;
      points.forEach((p, i) => {
        if (Math.hypot(p.x - m.x, p.y - m.y) <= grabRadius) nearIndex = i;
      });
    }
    const routable = !!edge.a && !!edge.b;
    const style = edge.style ?? "straight";
    const items: MenuItem[] = [
      {
        label: "中継点を追加",
        disabled: !routable,
        action: () => {
          const pts = [{ x: edge.x1, y: edge.y1 }, ...points, { x: edge.x2, y: edge.y2 }];
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < pts.length - 1; i++) {
            const d = distToSegment(m, pts[i], pts[i + 1]);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          const next = [...points];
          next.splice(best, 0, m);
          commitRoute(edge, next);
        },
      },
      {
        label: "中継点を削除",
        disabled: nearIndex < 0,
        action: () => commitRoute(edge, points.filter((_, i) => i !== nearIndex)),
      },
      {
        label: "経由点をすべてクリア",
        disabled: points.length === 0,
        action: () => onRouteEdge(edge.key!, []),
      },
      {
        label: "端点の固定を解除",
        disabled: !edge.pinnedA && !edge.pinnedB,
        action: () => onAnchorEdge(edge.key!, null),
      },
      { label: "", separator: true },
      ...EDGE_STYLES.map((st) => ({
        label: `線種: ${st.label}`,
        checked: style === st.value,
        action: () => onEdgeStyle(edge.key!, st.value),
      })),
    ];
    if (DELETABLE_EDGE_KINDS.has(edge.kind) && edge.el.fileId !== undefined) {
      items.push(
        { label: "", separator: true },
        { label: "接続を削除 (モデルから)", action: () => onDeleteElement(edge.el) }
      );
    }
    openMenu(e, items);
  };

  const onNodeContextMenu = (el: SysMLElement, e: React.MouseEvent, named: boolean) => {
    const items: MenuItem[] = [
      { label: "ここから接続 (connect)", action: () => onStartConnect(el) },
    ];
    if (named && el.fileId !== undefined) {
      items.push({ label: "リネーム", action: () => onElementDoubleClick(el) });
    }
    if (el.fileId !== undefined && el.kind !== "file") {
      items.push(
        { label: "", separator: true },
        { label: "削除 (モデルから)", action: () => onDeleteElement(el) }
      );
    }
    openMenu(e, items);
  };

  const interaction: Interaction = {
    mode,
    selected,
    marked,
    onClick: (el) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onElementClick(el);
    },
    onDoubleClick: onElementDoubleClick,
    onBoxMouseDown,
    onResizeMouseDown,
    onPortMouseDown,
    portKey: (owner, port) => portOffsetKey(keyOf, owner, port),
    livePort: drag.live.port,
    onEdgeMouseDown,
    onEndpointMouseDown,
    liveAnchor: drag.live.anchor,
    onEdgeContextMenu,
    onNodeContextMenu,
    onWaypointRemove: (edge, index) => {
      if (!edge.key) return;
      const base = edgeRoutingBase(edge);
      if (!base) return;
      const points = (edge.points ?? [])
        .filter((_, i) => i !== index)
        .map((p) => ({ x: p.x - base.x, y: p.y - base.y }));
      onRouteEdge(edge.key, points);
    },
    liveEdge: drag.live.edge,
  };

  // edges of the currently selected element (line-style controls)
  const selectedEdges = layout.edges.filter((e) => e.el === selected && e.key);
  const EDGE_STYLES: { value: EdgeStyle; label: string }[] = [
    { value: "straight", label: "直線" },
    { value: "ortho", label: "折れ線" },
    { value: "curve", label: "曲線" },
  ];

  return (
    <div className="diagram-view" ref={viewRef}>
      <div className="diagram-toolbar">
        <button onClick={fit} title="全体表示">⤢ Fit</button>
        <button onClick={resetView} title="リセット">100%</button>
        <button onClick={exportSvg} title="SVG として保存">⭳ SVG</button>
        <span className="diagram-zoom">{Math.round(view.scale * 100)}%</span>
        {mode === "select" && selectedEdges.length > 0 && (
          <>
            <span className="diagram-zoom">線種:</span>
            {EDGE_STYLES.map((s) => (
              <button
                key={s.value}
                className={(selectedEdges[0].style ?? "straight") === s.value ? "active" : undefined}
                onClick={() => selectedEdges.forEach((e) => onEdgeStyle(e.key!, s.value))}
                title={`選択中の線を${s.label}で描画`}
              >
                {s.label}
              </button>
            ))}
            {selectedEdges.some((e) => e.points?.length) && (
              <button
                onClick={() => selectedEdges.forEach((e) => onRouteEdge(e.key!, []))}
                title="選択中の線の中継点をすべて削除"
              >
                ⟲ 経由点クリア
              </button>
            )}
          </>
        )}
      </div>
      <svg
        ref={svgRef}
        className="diagram-svg"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onDoubleClick={fit}
        onClick={onSvgClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          {Object.entries(EDGE_COLOR)
            .filter(([k]) => !CUSTOM_MARKER_KINDS.has(k))
            .map(([kind, color]) => (
              <marker
                key={kind}
                id={`arrow-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            ))}
          {/* generalization: hollow triangle */}
          <marker
            id="tri-specialize"
            viewBox="0 0 12 12"
            refX="11"
            refY="6"
            markerWidth="11"
            markerHeight="11"
            orient="auto-start-reverse"
          >
            <path
              d="M 1 1 L 11 6 L 1 11 z"
              fill="#14141f"
              stroke={EDGE_COLOR.specialize}
              strokeWidth="1.2"
            />
          </marker>
          {/* composition: filled diamond at the owner end */}
          <marker
            id="diamond-compose"
            viewBox="0 0 14 8"
            refX="1"
            refY="4"
            markerWidth="14"
            markerHeight="8"
            orient="auto"
          >
            <path d="M 1 4 L 7 1 L 13 4 L 7 7 z" fill={EDGE_COLOR.compose} />
          </marker>
        </defs>
        <g data-viewport="true" transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
          {layout.nodes.map((n, i) => (
            <NodeBox key={i} node={n} it={interaction} />
          ))}
          {layout.edges.map((e, i) => (
            <EdgeLine key={i} edge={e} it={interaction} />
          ))}
        </g>
      </svg>
      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.items.map((item, i) =>
            item.separator ? (
              <div key={i} className="ctx-menu-sep" />
            ) : (
              <button
                key={i}
                className="ctx-menu-item"
                disabled={item.disabled}
                onClick={() => {
                  setMenu(null);
                  item.action?.();
                }}
              >
                <span className="ctx-menu-check">{item.checked ? "✓" : ""}</span>
                {item.label}
              </button>
            )
          )}
        </div>
      )}
      {layout.nodes.length === 0 && (
        <div className="diagram-empty">
          この図の種類に表示できる要素がありません。<br />
          図の種類を切り替えるか、対応する要素 (part / requirement / state など) を
          .sysml ファイルに記述してください。
        </div>
      )}
    </div>
  );
}
