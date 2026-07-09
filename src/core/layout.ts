import { SysMLElement, createElement, walk } from "./ast";
import { Resolver } from "./resolve";
import {
  DiagramKind,
  PACKAGE_KINDS,
  PORT_KINDS,
  VIEW_SPECS,
  ViewSpec,
  isEdgeElement,
} from "./viewSpecs";

// re-exported so existing importers keep using `../core/layout`
export { DIAGRAM_KINDS, diagramKindLabel } from "./viewSpecs";
export type { DiagramKind } from "./viewSpecs";


export type PortSide = "left" | "right" | "top" | "bottom";

/** line rendering styles: straight (waypoints make it a polyline), right-angle
 *  routing, or smoothed curve */
export type EdgeStyle = "straight" | "ortho" | "curve";

export interface DiagramPort {
  el: SysMLElement;
  name: string;
  /** absolute centre position */
  x: number;
  y: number;
  side: PortSide;
}

/** offsets key for a manually placed port (unique per owning usage) */
export function portOffsetKey(
  keyOf: (el: SysMLElement) => string,
  owner: SysMLElement,
  port: SysMLElement
): string {
  return `${keyOf(owner)}~port~${port.name ?? ""}`;
}

export interface DiagramNode {
  el: SysMLElement;
  label: string;
  kindLabel: string;
  typeLabel?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rounded: boolean;
  /** render as ellipse (use cases) */
  ellipse?: boolean;
  /** render as a stick figure (use case actors) */
  actor?: boolean;
  /** sequence diagram: y where the dashed lifeline ends */
  lifelineEnd?: number;
  attributes: string[];
  ports: DiagramPort[];
  children: DiagramNode[];
  depth: number;
  /** true when this box has child boxes that can be collapsed / expanded */
  collapsible?: boolean;
  /** true when the child boxes are currently hidden (collapsed) */
  collapsed?: boolean;
  /** pseudo-nodes used as edge anchors for the ports (kept in sync on shift) */
  portBoxes?: DiagramNode[];
}

export interface DiagramEdge {
  el: SysMLElement;
  kind:
    | "connect" | "flow" | "bind" | "transition" | "interface" | "connection"
    | "allocation" | "specialize" | "compose" | "satisfy" | "perform" | "assoc"
    | "import";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** manual routing waypoints between the endpoints (saved layout) */
  points?: { x: number; y: number }[];
  /** endpoints pinned to a fixed border position (saved layout) */
  pinnedA?: boolean;
  pinnedB?: boolean;
  /** line rendering style (saved layout; default "straight") */
  style?: EdgeStyle;
  /** stable key for saved manual routing */
  key?: string;
  /** endpoint boxes (set when both are available; enables manual routing) */
  a?: DiagramNode;
  b?: DiagramNode;
  label?: string;
  arrow: boolean;
  dashed: boolean;
}

export interface DiagramLayout {
  nodes: DiagramNode[]; // roots (children nested inside)
  edges: DiagramEdge[];
  width: number;
  height: number;
}

// ---- measurement constants ------------------------------------------

const CHAR_W = 7.2;
const HEADER_H = 26;
const KIND_H = 14;
const LINE_H = 16;
const PAD = 14;
const GAP = 22;
const PORT_SIZE = 10;
const MIN_W = 110;

/** full-width (CJK / fullwidth-form) characters render about twice as wide */
function isWideChar(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi, punctuation
      (code >= 0x3041 && code <= 0x33ff) || // Hiragana, Katakana, CJK symbols
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0xa000 && code <= 0xa4cf) || // Yi
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK compat
      (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
      (code >= 0xffe0 && code <= 0xffe6))
  );
}

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += isWideChar(code) ? CHAR_W * 1.85 : CHAR_W;
  }
  return w;
}


function kindLabel(el: SysMLElement): string {
  if (el.modifiers.includes("actor")) return "actor";
  if (el.kind === "exhibit") return "state";
  if (el.kind === "perform") return "action";
  return el.kind;
}

function nodeLabel(el: SysMLElement): string {
  return el.name ?? el.shortName ?? el.target ?? "";
}

function typeLabel(el: SysMLElement): string | undefined {
  const t = [...el.typedBy, ...el.specializes];
  if (!t.length) return undefined;
  return ": " + t.join(", ");
}

function attributeLine(el: SysMLElement): string {
  let s = el.name ?? el.target ?? "";
  if (!s && el.redefines.length) s = ":>> " + el.redefines.join(", ");
  if (el.kind === "import" || el.kind === "alias") s = `${el.kind} ${el.target ?? ""}`;
  if (el.typedBy.length) s += " : " + el.typedBy.join(", ");
  if (el.multiplicity) s += " " + el.multiplicity;
  if (el.value !== undefined && el.value.length <= 24) s += " = " + el.value;
  return s;
}

/** wrap documentation text into short lines for in-box display */
function wrapDoc(s: string, width = 34): string[] {
  const out: string[] = [];
  for (const para of s.split(/\n+/)) {
    let line = "";
    for (const ch of para.trim()) {
      line += ch;
      if (line.length >= width && (/[\s、。,.;)]/.test(ch) || line.length >= width + 10)) {
        out.push(line.trim());
        line = "";
      }
    }
    if (line.trim()) out.push(line.trim());
  }
  return out.slice(0, 6);
}

// ---- view filtering ------------------------------------------------------

interface ViewContext {
  spec: ViewSpec;
  /** elements forced to render as boxes (edge endpoints of ref edges) */
  forced: Set<SysMLElement>;
  asBox: (el: SysMLElement) => boolean;
  opts: LayoutOptions;
}

function makeViewContext(root: SysMLElement, spec: ViewSpec, opts: LayoutOptions): ViewContext {
  // resolve ref-edge endpoints up-front so they are kept as boxes even when
  // the view would otherwise prune them (e.g. `satisfy R by vehicle`)
  const forced = new Set<SysMLElement>();
  if (spec.refEdges) {
    walk(root, (el) => {
      if (!spec.refEdges!.has(el.kind) || !el.parent) return;
      if (el.target) {
        const t = resolvePath(el.parent, el.target, el);
        if (t) forced.add(t);
      }
      if ((el.ends?.length ?? 0) >= 2) {
        const s = resolvePath(el.parent, el.ends![1].path, el);
        if (s) forced.add(s);
      } else {
        // no `by` clause: the enclosing named element is the edge source
        // (e.g. the part performing a use case). Packages stay hidden.
        let p: SysMLElement | undefined = el.parent;
        while (p && !p.name) p = p.parent;
        if (p && p.kind !== "file" && !PACKAGE_KINDS.includes(p.kind)) forced.add(p);
      }
    });
  }

  const isPrimary = (el: SysMLElement) =>
    spec.primary.has(el.kind) ||
    (spec.extraPrimary?.(el) ?? false) ||
    (spec.refEdges?.has(el.kind) ?? false) ||
    forced.has(el);

  const memo = new Map<SysMLElement, boolean>();
  const hasPrimary = (el: SysMLElement): boolean => {
    const cached = memo.get(el);
    if (cached !== undefined) return cached;
    let v = false;
    for (const c of el.children) {
      if (isPrimary(c) || hasPrimary(c)) {
        v = true;
        break;
      }
    }
    memo.set(el, v);
    return v;
  };

  const asBox = (el: SysMLElement): boolean => {
    if (isEdgeElement(el) || (spec.refEdges?.has(el.kind) ?? false)) return false;
    if (spec.primary.has(el.kind) || (spec.extraPrimary?.(el) ?? false) || forced.has(el)) {
      return true;
    }
    if (spec.containers.has(el.kind)) return hasPrimary(el);
    return false;
  };

  return { spec, forced, asBox, opts };
}

// ---- layout ----------------------------------------------------------

interface Size {
  w: number;
  h: number;
}

/** Pre-computed relative layout for a node before absolute placement. */
interface RelNode {
  el: SysMLElement;
  size: Size;
  attributes: string[];
  ports: SysMLElement[];
  children: RelNode[];
  childPos: { x: number; y: number }[];
  headerH: number;
  collapsible?: boolean;
  collapsed?: boolean;
}

/** arrange child boxes in rows (wrapping for a pleasant aspect ratio) and
 *  apply manual offsets from the saved diagram layout */
function arrangeChildren(
  children: RelNode[],
  opts: LayoutOptions
): { childPos: { x: number; y: number }[]; innerW: number; innerH: number } {
  const childPos: { x: number; y: number }[] = [];
  let innerW = 0;
  let innerH = 0;
  if (children.length) {
    const totalArea = children.reduce((s, c) => s + (c.size.w + GAP) * (c.size.h + GAP), 0);
    const targetW = Math.max(Math.sqrt(totalArea * 1.9), ...children.map((c) => c.size.w));
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const c of children) {
      if (x > 0 && x + c.size.w > targetW) {
        x = 0;
        y += rowH + GAP;
        rowH = 0;
      }
      childPos.push({ x, y });
      x += c.size.w + GAP;
      rowH = Math.max(rowH, c.size.h);
    }

    // manual offsets (saved diagram layout) – each child moves independently
    // and is clamped at the box's top/left inner edge. A child dragged past
    // that edge stops there instead of shifting all its siblings (which made
    // the whole content jump on drag); the parent grows right/down as needed.
    if (opts.offsets && opts.keyOf) {
      children.forEach((c, i) => {
        const o = opts.offsets![opts.keyOf!(c.el)];
        if (o) {
          childPos[i].x = Math.max(0, childPos[i].x + o.dx);
          childPos[i].y = Math.max(0, childPos[i].y + o.dy);
        }
      });
    }
    children.forEach((c, i) => {
      innerW = Math.max(innerW, childPos[i].x + c.size.w);
      innerH = Math.max(innerH, childPos[i].y + c.size.h);
    });
  }
  return { childPos, innerW, innerH };
}

/** ports declared on the element's type defs (following specializations) */
function inheritedPorts(el: SysMLElement): SysMLElement[] {
  const out: SysMLElement[] = [];
  const visited = new Set<SysMLElement>();
  const visitType = (def: SysMLElement | undefined, depth: number) => {
    if (!def || visited.has(def) || depth > 5) return;
    visited.add(def);
    for (const c of def.children) {
      if (PORT_KINDS.has(c.kind)) out.push(c);
    }
    for (const s of def.specializes) {
      visitType(def.parent ? resolvePath(def.parent, s, def) : undefined, depth + 1);
    }
  };
  for (const tn of el.typedBy) {
    visitType(el.parent ? resolvePath(el.parent, tn, el) : undefined, 0);
  }
  return out;
}

function measure(el: SysMLElement, depth: number, ctx: ViewContext): RelNode {
  const { spec, opts } = ctx;
  const attributes: string[] = [];
  const ports: SysMLElement[] = [];
  const children: RelNode[] = [];

  // actors are drawn as fixed-size stick figures with the name below
  if (spec.hoistActors && (spec.extraPrimary?.(el) ?? false)) {
    const label = nodeLabel(el);
    return {
      el,
      size: { w: Math.max(64, textWidth(label) + 8), h: 84 },
      attributes: [],
      ports: [],
      children: [],
      childPos: [],
      headerH: 0,
    };
  }

  if (spec.doc && el.doc) attributes.push(...wrapDoc(el.doc));

  // BDD: package boxes are pure containers — member text lines (imports,
  // package-level usages) would read as diagram content, so they are hidden
  const suppressText = spec.packageText === false && PACKAGE_KINDS.includes(el.kind);

  // saved layout entry for this box (also used for manual size below)
  const o = opts.offsets && opts.keyOf ? opts.offsets[opts.keyOf(el)] : undefined;
  // collapsed boxes hide their child boxes; attribute/text lines stay
  const collapsed = !!o?.collapsed;
  let collapsible = false;

  for (const c of el.children) {
    if (isEdgeElement(c) || (spec.refEdges?.has(c.kind) ?? false)) continue;
    // actor members are hoisted to the top level (rendered by layoutDiagram)
    if (spec.hoistActors && (spec.extraPrimary?.(c) ?? false)) continue;
    if (PORT_KINDS.has(c.kind)) {
      if (spec.ports) ports.push(c);
      else if (!suppressText) {
        const line = attributeLine(c);
        if (line.trim()) attributes.push(line);
      }
    } else if (ctx.asBox(c) && depth < 6) {
      collapsible = true;
      if (!collapsed) children.push(measure(c, depth + 1, ctx));
    } else if (!suppressText && (spec.text.has(c.kind) || c.kind === "unknown")) {
      const line = attributeLine(c);
      if (line.trim()) attributes.push(line);
    }
  }

  // ports declared on the type definition render on the usage box too
  // (e.g. `part engine : Engine` shows the ports of `part def Engine`)
  if (spec.ports && !el.kind.endsWith("def")) {
    const have = new Set(ports.map((p) => p.name));
    for (const p of inheritedPorts(el)) {
      if (!have.has(p.name)) {
        have.add(p.name);
        ports.push(p);
      }
    }
  }

  const label = nodeLabel(el);
  const tLabel = typeLabel(el) ?? "";
  const headerW = Math.max(textWidth(label + " " + tLabel) + PAD * 2, textWidth(`«${kindLabel(el)}»`) + PAD * 2);
  const headerH = HEADER_H + KIND_H;
  const attrW = attributes.reduce((m, a) => Math.max(m, textWidth(a) + PAD * 2), 0);
  const attrH = attributes.length ? attributes.length * LINE_H + 6 : 0;

  // arrange children in rows, wrapping to keep a pleasant aspect ratio
  const { childPos, innerW, innerH } = arrangeChildren(children, opts);

  // room for port labels sticking out
  const portLabelW = ports.reduce((m, p) => Math.max(m, textWidth(p.name ?? "")), 0);

  let w = Math.max(MIN_W, headerW, attrW, innerW + PAD * 2, portLabelW + MIN_W);
  let h = headerH + attrH + (children.length ? innerH + PAD * 2 : PAD);

  const minPortH = headerH + Math.ceil(ports.length / 2) * (PORT_SIZE + 16) + PAD;
  h = Math.max(h, minPortH);

  // manual resize (saved layout): the stored size is a MINIMUM — the box keeps
  // it while the content fits and only grows on overflow, so moving children
  // inside an enlarged box does not inflate it further
  if (o?.mw !== undefined || o?.mh !== undefined) {
    w = Math.max(w, o.mw ?? 0);
    h = Math.max(h, o.mh ?? 0);
  } else {
    // legacy additive deltas
    w += Math.max(0, o?.dw ?? 0);
    h += Math.max(0, o?.dh ?? 0);
  }

  return {
    el,
    size: { w, h },
    attributes,
    ports,
    children,
    childPos,
    headerH: headerH + attrH,
    collapsible: collapsible || undefined,
    collapsed: collapsed || undefined,
  };
}

/** port pseudo-boxes per owning box element, keyed by port name */
type PortsByOwner = Map<SysMLElement, Map<string, DiagramNode>>;

function place(
  rel: RelNode,
  x: number,
  y: number,
  depth: number,
  boxByEl: Map<SysMLElement, DiagramNode>,
  spec: ViewSpec,
  portsByOwner: PortsByOwner,
  opts: LayoutOptions
): DiagramNode {
  const node: DiagramNode = {
    el: rel.el,
    label: nodeLabel(rel.el),
    kindLabel: kindLabel(rel.el),
    typeLabel: typeLabel(rel.el),
    x,
    y,
    w: rel.size.w,
    h: rel.size.h,
    rounded: rel.el.kind.startsWith("state") || rel.el.kind === "exhibit",
    ellipse: spec.ellipse?.has(rel.el.kind) ?? false,
    actor: (spec.hoistActors && (spec.extraPrimary?.(rel.el) ?? false)) || undefined,
    attributes: rel.attributes,
    ports: [],
    children: [],
    depth,
    collapsible: rel.collapsible,
    collapsed: rel.collapsed,
  };
  boxByEl.set(rel.el, node);

  // ports: alternate left / right by default; manual placement (saved layout)
  // may pin a port to any side at a 0..1 position along it
  rel.ports.forEach((p, i) => {
    let side: PortSide = i % 2 === 0 ? "left" : "right";
    const row = Math.floor(i / 2);
    let px = side === "left" ? x : x + rel.size.w;
    let py = Math.min(
      y + HEADER_H + KIND_H + 10 + row * (PORT_SIZE + 16),
      y + rel.size.h - 10
    );
    const pk = opts.keyOf ? portOffsetKey(opts.keyOf, rel.el, p) : undefined;
    const o = pk ? opts.offsets?.[pk] : undefined;
    if (o?.side && o.t !== undefined) {
      side = o.side;
      const t = Math.min(0.95, Math.max(0.05, o.t));
      if (side === "left" || side === "right") {
        px = side === "left" ? x : x + rel.size.w;
        py = y + t * rel.size.h;
      } else {
        px = x + t * rel.size.w;
        py = side === "top" ? y : y + rel.size.h;
      }
    }
    const port: DiagramPort = {
      el: p,
      name: p.name ?? "",
      side,
      x: px,
      y: py,
    };
    node.ports.push(port);
    const pseudo: DiagramNode = {
      ...node,
      el: p,
      x: port.x - 5,
      y: port.y - 5,
      w: 10,
      h: 10,
      children: [],
      ports: [],
      portBoxes: undefined,
    };
    (node.portBoxes ??= []).push(pseudo);
    // inherited ports may render on several usages of the same def: keep the
    // first registration for direct element lookups, and the per-owner map
    // for path-based lookups (`engine.fuelIn`)
    if (!boxByEl.has(p)) boxByEl.set(p, pseudo);
    let owner = portsByOwner.get(rel.el);
    if (!owner) portsByOwner.set(rel.el, (owner = new Map()));
    owner.set(p.name ?? "", pseudo);
  });

  rel.children.forEach((c, i) => {
    const pos = rel.childPos[i];
    node.children.push(
      place(c, x + PAD + pos.x, y + rel.headerH + PAD + pos.y, depth + 1, boxByEl, spec, portsByOwner, opts)
    );
  });
  return node;
}

// ---- edge resolution --------------------------------------------------

function findByName(
  scope: SysMLElement,
  name: string,
  exclude?: SysMLElement
): SysMLElement | undefined {
  // breadth-first so the nearest declaration wins
  const queue: SysMLElement[] = [...scope.children];
  while (queue.length) {
    const el = queue.shift()!;
    if (el !== exclude && (el.name === name || el.shortName === name)) return el;
    queue.push(...el.children);
  }
  return undefined;
}

/**
 * Scope-aware resolver for the current layout pass. Set by layoutDiagram /
 * layoutSequence; layout is synchronous, so a module-level slot is safe.
 * Falls back to the naive search when unset (defensive).
 */
let currentResolver: Resolver | undefined;

function topRootOf(el: SysMLElement): SysMLElement {
  let r = el;
  while (r.parent) r = r.parent;
  return r;
}

/**
 * `exclude` skips the referencing element itself: reference usages such as
 * `perform OperateRobot` carry the target as their own name, so a naive
 * search would resolve to the reference instead of the declaration.
 */
function resolvePath(
  scope: SysMLElement,
  path: string,
  exclude?: SysMLElement
): SysMLElement | undefined {
  // scope-aware resolution (imports / inheritance / nearest scope first);
  // names may exist in several packages, so plain BFS picks wrong targets
  if (currentResolver) {
    const r = currentResolver.resolve(scope, path, exclude);
    if (r) return r;
  }

  const segments = path.split(/::|\./).filter(Boolean);
  if (!segments.length) return undefined;

  // first segment: look in scope, then walk up ancestors
  let cur: SysMLElement | undefined;
  let s: SysMLElement | undefined = scope;
  while (s && !cur) {
    cur = findByName(s, segments[0], exclude);
    s = s.parent;
  }
  if (!cur) return undefined;
  for (let i = 1; i < segments.length; i++) {
    const nextEl: SysMLElement | undefined = findByName(cur, segments[i], exclude);
    if (!nextEl) return cur; // partial resolution: keep deepest found
    cur = nextEl;
  }
  return cur;
}

/** anchor on the border of a towards an arbitrary point */
function anchorTowards(a: DiagramNode, pt: { x: number; y: number }): { x: number; y: number } {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const dx = pt.x - acx;
  const dy = pt.y - acy;
  if (dx === 0 && dy === 0) return { x: acx, y: acy };
  const sx = dx !== 0 ? (a.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (a.h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy, 1);
  return { x: acx + dx * t, y: acy + dy * t };
}

function rectAnchor(a: DiagramNode, b: DiagramNode): { x: number; y: number } {
  return anchorTowards(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
}

/**
 * Assign stable keys to edges and apply saved manual routing (waypoints).
 * The key is keyOf(el) + edge kind + a per-element sequence number.
 */
/**
 * Reference point for an edge's relative waypoints: the midpoint of the two
 * endpoint box centres. Waypoints stored relative to it follow the boxes
 * when they are moved.
 */
export function edgeRoutingBase(e: DiagramEdge): { x: number; y: number } | undefined {
  if (!e.a || !e.b) return undefined;
  return {
    x: (e.a.x + e.a.w / 2 + e.b.x + e.b.w / 2) / 2,
    y: (e.a.y + e.a.h / 2 + e.b.y + e.b.h / 2) / 2,
  };
}

/** point on a box border given side + 0..1 position along it */
export function borderPoint(
  box: { x: number; y: number; w: number; h: number },
  side: PortSide,
  t: number
): { x: number; y: number } {
  const tt = Math.min(0.97, Math.max(0.03, t));
  if (side === "left") return { x: box.x, y: box.y + tt * box.h };
  if (side === "right") return { x: box.x + box.w, y: box.y + tt * box.h };
  if (side === "top") return { x: box.x + tt * box.w, y: box.y };
  return { x: box.x + tt * box.w, y: box.y + box.h };
}

function applyEdgeRouting(edges: DiagramEdge[], options: LayoutOptions): void {
  const counters = new Map<string, number>();
  for (const e of edges) {
    const base = `${options.keyOf ? options.keyOf(e.el) : ""}~edge~${e.kind}`;
    const i = counters.get(base) ?? 0;
    counters.set(base, i + 1);
    e.key = `${base}~${i}`;
    const entry = options.offsets?.[e.key];
    if (entry?.style) e.style = entry.style;
    const wp = entry?.wp;
    const origin = edgeRoutingBase(e);
    if (wp?.length && origin) {
      // `rel` waypoints follow the endpoint boxes; absolute ones are legacy
      e.points = entry!.rel
        ? wp.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y }))
        : wp.map((p) => ({ x: p.x, y: p.y }));
      // re-anchor the endpoints towards the first / last waypoint
      const p1 = anchorTowards(e.a!, e.points[0]);
      const p2 = anchorTowards(e.b!, e.points[e.points.length - 1]);
      e.x1 = p1.x;
      e.y1 = p1.y;
      e.x2 = p2.x;
      e.y2 = p2.y;
    }
    // manually pinned endpoints override the automatic anchors
    if (entry?.anchorA && e.a) {
      const p = borderPoint(e.a, entry.anchorA.side, entry.anchorA.t);
      e.x1 = p.x;
      e.y1 = p.y;
      e.pinnedA = true;
    }
    if (entry?.anchorB && e.b) {
      const p = borderPoint(e.b, entry.anchorB.side, entry.anchorB.t);
      e.x2 = p.x;
      e.y2 = p.y;
      e.pinnedB = true;
    }
  }
}

/**
 * Subject type name of a use case: its own `subject x : T` member, or one
 * found via its typing / specialization chain.
 */
function subjectTypeOf(el: SysMLElement): string | undefined {
  const visited = new Set<SysMLElement>();
  const queue: SysMLElement[] = [el];
  let guard = 0;
  while (queue.length && guard++ < 32) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const subj = cur.children.find((c) => c.modifiers.includes("subject"));
    if (subj?.typedBy.length) return subj.typedBy[0];
    for (const name of [...cur.typedBy, ...cur.specializes]) {
      const t = cur.parent ? resolvePath(cur.parent, name, cur) : undefined;
      if (t) queue.push(t);
    }
  }
  return undefined;
}

/**
 * Whether one box's element contains the other's. Synthesized relationship
 * edges (import / specialize / compose / assoc) are suppressed for nested
 * pairs: containment is already shown by the box nesting, and a line from a
 * parent box into its own child renders as a stray arrow.
 */
function isNestedPair(a: DiagramNode, b: DiagramNode): boolean {
  for (let cur: SysMLElement | undefined = b.el.parent; cur; cur = cur.parent) {
    if (cur === a.el) return true;
  }
  for (let cur: SysMLElement | undefined = a.el.parent; cur; cur = cur.parent) {
    if (cur === b.el) return true;
  }
  return false;
}

/** box of el itself, or of its nearest boxed ancestor */
function nearestBox(
  el: SysMLElement | undefined,
  boxByEl: Map<SysMLElement, DiagramNode>
): DiagramNode | undefined {
  let cur = el;
  while (cur) {
    const b = boxByEl.get(cur);
    if (b) return b;
    cur = cur.parent;
  }
  return undefined;
}

// ---- main entry --------------------------------------------------------

/** manual box placement and size (keys = element qualified name). */
export interface BoxLayout {
  /** position shift from the auto-layout slot */
  dx: number;
  dy: number;
  /** legacy additive size enlargement (older sidecar files) */
  dw?: number;
  dh?: number;
  /** manual minimum size (absolute): the box keeps this size and only grows
   *  further when its content no longer fits */
  mw?: number;
  mh?: number;
  /** hide this box's child boxes (progressive disclosure); edges to hidden
   *  descendants re-anchor to this box via nearestBox() */
  collapsed?: boolean;
}

/** a port pinned to a border side at a 0..1 position (keys via portOffsetKey). */
export interface PortLayout {
  side?: PortSide;
  t?: number;
}

/** manual edge routing / styling (keys are the per-edge keys). */
export interface EdgeLayout {
  /** routing waypoints */
  wp?: { x: number; y: number }[];
  /** true when wp is relative to the endpoint-box midpoint (follows moves) */
  rel?: boolean;
  /** pinned endpoints: border side + 0..1 position */
  anchorA?: { side: PortSide; t: number };
  anchorB?: { side: PortSide; t: number };
  /** line style override */
  style?: EdgeStyle;
}

/**
 * One saved-layout entry. The three concerns (box / port / edge) share one
 * flat shape because the persistence key already discriminates the kind
 * (plain element key vs portOffsetKey vs edge key); only the relevant subset
 * of fields is set for any given entry.
 */
export type LayoutEntry = BoxLayout & PortLayout & EdgeLayout;

export interface LayoutOffsets {
  [elementKey: string]: LayoutEntry;
}

export interface LayoutOptions {
  /** manual position offsets for top-level boxes, keyed by keyOf(el) */
  offsets?: LayoutOffsets;
  keyOf?: (el: SysMLElement) => string;
  /** diagram view kind (default "general") */
  kind?: DiagramKind;
}

/** Shift a node, its ports and children by (dx, dy). */
function shiftNode(node: DiagramNode, dx: number, dy: number): void {
  node.x += dx;
  node.y += dy;
  for (const p of node.ports) {
    p.x += dx;
    p.y += dy;
  }
  for (const pb of node.portBoxes ?? []) {
    pb.x += dx;
    pb.y += dy;
  }
  for (const c of node.children) shiftNode(c, dx, dy);
}

export function layoutDiagram(root: SysMLElement, options: LayoutOptions = {}): DiagramLayout {
  currentResolver = new Resolver(topRootOf(root));
  const kind = options.kind ?? "general";
  if (kind === "seq") return layoutSequence(root, options);

  const spec = VIEW_SPECS[kind];
  const ctx = makeViewContext(root, spec, options);
  const boxByEl = new Map<SysMLElement, DiagramNode>();
  const portsByOwner: PortsByOwner = new Map();

  // use case view: actors with the same name collapse into one figure, and a
  // part with a matching name (the performer) merges into that figure too
  const actorGroups = new Map<string, SysMLElement[]>();
  const actorAlias = new Map<SysMLElement, SysMLElement>();
  if (spec.hoistActors && spec.extraPrimary) {
    walk(root, (el) => {
      if (el === root || !spec.extraPrimary!(el)) return;
      const label = nodeLabel(el) || "(actor)";
      const g = actorGroups.get(label);
      if (g) {
        g.push(el);
        actorAlias.set(el, g[0]);
      } else {
        actorGroups.set(label, [el]);
      }
    });
    if (actorGroups.size) {
      walk(root, (el) => {
        if ((el.kind === "part" || el.kind === "item") && el.name && actorGroups.has(el.name)) {
          actorAlias.set(el, actorGroups.get(el.name)![0]);
        }
      });
    }
  }

  // collect top-level boxes. Non-box elements (files, packages pruned by the
  // view) are transparent: their box descendants are hoisted to the top level
  const rels: RelNode[] = [];
  const topEls = new Set<SysMLElement>();
  const topCandidates: SysMLElement[] = [];
  const addTop = (el: SysMLElement) => {
    if (actorAlias.has(el)) return; // merged into an actor figure
    if (ctx.asBox(el) && el.kind !== "file") {
      if (spec.topFilter && !spec.topFilter(el)) return;
      topEls.add(el);
      topCandidates.push(el);
    } else {
      el.children.forEach(addTop);
    }
  };
  root.children.forEach(addTop);

  // use case view: wrap use cases in a boundary box named after their subject
  // type (the system boundary of the classic diagram)
  const boundaryEls: SysMLElement[] = [];
  if (spec.ellipse) {
    const bGroups = new Map<string, { boundary?: SysMLElement; members: SysMLElement[] }>();
    const rest: SysMLElement[] = [];
    for (const el of topCandidates) {
      const subj = spec.ellipse.has(el.kind) ? subjectTypeOf(el) : undefined;
      if (subj) {
        let g = bGroups.get(subj);
        if (!g) {
          g = {
            boundary: el.parent ? resolvePath(el.parent, subj, el) : undefined,
            members: [],
          };
          bGroups.set(subj, g);
        }
        g.members.push(el);
      } else {
        rest.push(el);
      }
    }
    rels.push(...rest.map((e) => measure(e, 0, ctx)));
    for (const [name, g] of bGroups) {
      const inner = g.members.map((e) => measure(e, 1, ctx));
      const { childPos, innerW, innerH } = arrangeChildren(inner, options);
      const headerH = HEADER_H + KIND_H;
      let bEl = g.boundary;
      if (!bEl) {
        bEl = createElement("part def");
        bEl.name = name;
      }
      boundaryEls.push(bEl);
      let w = Math.max(MIN_W, innerW + PAD * 2, textWidth(name) + PAD * 2);
      let h = headerH + innerH + PAD * 2;
      const o = options.offsets && options.keyOf ? options.offsets[options.keyOf(bEl)] : undefined;
      if (o?.mw !== undefined || o?.mh !== undefined) {
        w = Math.max(w, o.mw ?? 0);
        h = Math.max(h, o.mh ?? 0);
      } else {
        w += Math.max(0, o?.dw ?? 0);
        h += Math.max(0, o?.dh ?? 0);
      }
      rels.push({ el: bEl, size: { w, h }, attributes: [], ports: [], children: inner, childPos, headerH });
    }
  } else {
    rels.push(...topCandidates.map((e) => measure(e, 0, ctx)));
  }

  // hoist one figure per actor name (members live inside use case boxes
  // where addTop never descends)
  for (const els of actorGroups.values()) {
    if (!topEls.has(els[0])) rels.push(measure(els[0], 0, ctx));
  }

  // if the root itself is a box-ish element with no box children at top level,
  // render the root itself
  if (!rels.length && ctx.asBox(root)) {
    rels.push(measure(root, 0, ctx));
  }

  const nodes: DiagramNode[] = [];
  let x = GAP;
  let y = GAP;
  let rowH = 0;
  const targetW = Math.max(
    900,
    ...rels.map((r) => r.size.w + GAP * 2)
  );
  for (const rel of rels) {
    if (x > GAP && x + rel.size.w > targetW) {
      x = GAP;
      y += rowH + GAP * 1.5;
      rowH = 0;
    }
    nodes.push(place(rel, x, y, 0, boxByEl, spec, portsByOwner, options));
    x += rel.size.w + GAP * 1.5;
    rowH = Math.max(rowH, rel.size.h);
  }

  // merged actors / performer parts anchor their edges at the shared figure
  for (const [el, rep] of actorAlias) {
    const fig = boxByEl.get(rep);
    if (fig) boxByEl.set(el, fig);
  }
  // subject boundary boxes show «subject» instead of the def kind
  for (const bEl of boundaryEls) {
    const n = boxByEl.get(bEl);
    if (n) n.kindLabel = "subject";
  }

  // apply manual offsets to top-level boxes (saved diagram layout)
  const { offsets, keyOf } = options;
  if (offsets && keyOf) {
    for (const n of nodes) {
      const o = offsets[keyOf(n.el)];
      if (o) shiftNode(n, o.dx, o.dy);
    }
    // normalize so everything stays in positive coordinates
    const minX = Math.min(GAP, ...nodes.map((n) => n.x));
    const minY = Math.min(GAP, ...nodes.map((n) => n.y));
    if (minX < GAP || minY < GAP) {
      for (const n of nodes) shiftNode(n, GAP - minX, GAP - minY);
    }
  }

  // collect edges anywhere under root (after offsets, so anchors are correct)
  const edges: DiagramEdge[] = [];
  const visit = (el: SysMLElement) => {
    for (const c of el.children) {
      if (isEdgeElement(c) && spec.edges.has(c.kind)) {
        const edge = buildEdge(c, boxByEl, portsByOwner);
        if (edge) edges.push(edge);
      } else if (spec.refEdges?.has(c.kind)) {
        const edge = buildRefEdge(c, boxByEl);
        if (edge) edges.push(edge);
      }
      visit(c);
    }
  };
  visit(root);

  if (spec.specializeEdges) edges.push(...specializeEdges(boxByEl));
  if (spec.composeEdges) edges.push(...composeEdges(root, boxByEl));
  if (spec.importEdges) edges.push(...importEdges(boxByEl));

  // every actor member keeps an association line from the merged figure to
  // its owning use case
  for (const els of actorGroups.values()) {
    const fig = boxByEl.get(els[0]);
    if (!fig) continue;
    const seen = new Set<string>();
    for (const a of els) {
      // no isNestedPair guard here: actor members are children of their use
      // case in the MODEL, but the figure is hoisted to the top level in the
      // diagram, so the association line is always meaningful
      const ub = nearestBox(a.parent, boxByEl);
      if (!ub || ub === fig) continue;
      const key = `${ub.x},${ub.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p1 = rectAnchor(fig, ub);
      const p2 = rectAnchor(ub, fig);
      edges.push({
        el: a,
        kind: "assoc",
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        a: fig,
        b: ub,
        arrow: false,
        dashed: false,
      });
    }
  }

  applyEdgeRouting(edges, options);

  const width = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0) + GAP;
  const height = nodes.reduce((m, n) => Math.max(m, n.y + n.h), 0) + GAP;
  return { nodes, edges, width, height };
}

/**
 * Resolve a connection end path to its anchor box. Walks the path segment by
 * segment; when a segment cannot be resolved as a child element, it may name
 * a port inherited from the owner's type (`engine.fuelIn` where fuelIn lives
 * on `part def Engine`) — anchor at that port's pseudo box.
 */
function resolveEndBox(
  scope: SysMLElement,
  path: string,
  boxByEl: Map<SysMLElement, DiagramNode>,
  portsByOwner: PortsByOwner
): DiagramNode | undefined {
  const segments = path.split(/::|\./).filter(Boolean);
  if (!segments.length) return undefined;

  let cur = resolvePath(scope, segments[0]);
  if (!cur) return undefined;
  for (let i = 1; i < segments.length; i++) {
    const next = findByName(cur, segments[i]);
    if (!next) {
      const port = portsByOwner.get(cur)?.get(segments[i]);
      if (port) return port;
      break; // partial resolution: anchor at the deepest box found
    }
    cur = next;
  }
  // the resolved element may not be boxed in this view (e.g. an action's
  // item parameter): anchor at its nearest boxed ancestor instead
  return boxByEl.get(cur) ?? nearestBox(cur, boxByEl);
}

function buildEdge(
  el: SysMLElement,
  boxByEl: Map<SysMLElement, DiagramNode>,
  portsByOwner: PortsByOwner
): DiagramEdge | undefined {
  const scope = el.parent;
  if (!scope) return undefined;

  let a: DiagramNode | undefined;
  let b: DiagramNode | undefined;

  if (el.kind === "transition") {
    const aEl = el.transition?.source ? resolvePath(scope, el.transition.source) : undefined;
    const bEl = el.transition?.target ? resolvePath(scope, el.transition.target) : undefined;
    a = aEl ? boxByEl.get(aEl) ?? nearestBox(aEl, boxByEl) : undefined;
    b = bEl ? boxByEl.get(bEl) ?? nearestBox(bEl, boxByEl) : undefined;
  } else {
    const ends = el.ends ?? [];
    if (ends.length >= 2) {
      a = resolveEndBox(scope, ends[0].path, boxByEl, portsByOwner);
      b = resolveEndBox(scope, ends[1].path, boxByEl, portsByOwner);
    }
  }
  if (!a || !b || a === b) return undefined;

  const p1 = rectAnchor(a, b);
  const p2 = rectAnchor(b, a);

  let label: string | undefined = el.name;
  if (el.kind === "flow" && el.typedBy.length) label = (label ? label + ": " : "") + el.typedBy.join(",");
  if (el.kind === "transition") {
    const parts = [el.transition?.trigger, el.transition?.guard ? `[${el.transition.guard}]` : undefined]
      .filter(Boolean);
    label = parts.join(" ") || el.name;
  }

  return {
    el,
    kind: el.kind as DiagramEdge["kind"],
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    a,
    b,
    label,
    arrow: el.kind === "flow" || el.kind === "transition" || el.kind === "allocation",
    dashed: el.kind === "flow" || el.kind === "allocation" || el.kind === "bind",
  };
}

/** satisfy / perform reference usages drawn as dashed dependency arrows */
function buildRefEdge(
  el: SysMLElement,
  boxByEl: Map<SysMLElement, DiagramNode>
): DiagramEdge | undefined {
  const scope = el.parent;
  if (!scope || !el.target) return undefined;

  const targetEl = resolvePath(scope, el.target, el);
  const target = nearestBox(targetEl, boxByEl);
  if (!target) return undefined;

  // `satisfy R by x` names the satisfying element; otherwise the enclosing box
  let source: DiagramNode | undefined;
  if ((el.ends?.length ?? 0) >= 2) {
    source = nearestBox(resolvePath(scope, el.ends![1].path, el), boxByEl);
  }
  source ??= nearestBox(scope, boxByEl);
  if (!source || source === target || isNestedPair(source, target)) return undefined;

  const stereo = el.modifiers.includes("verify")
    ? "verify"
    : el.modifiers.includes("include")
      ? "include"
      : el.kind;

  const p1 = rectAnchor(source, target);
  const p2 = rectAnchor(target, source);
  return {
    el,
    kind: el.kind as "satisfy" | "perform",
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    a: source,
    b: target,
    label: `«${stereo}»`,
    arrow: true,
    dashed: true,
  };
}

/** generalization edges (`:>` / specializes) between rendered boxes */
function specializeEdges(boxByEl: Map<SysMLElement, DiagramNode>): DiagramEdge[] {
  const edges: DiagramEdge[] = [];
  const seen = new Set<string>();
  for (const [el, box] of boxByEl) {
    if (PORT_KINDS.has(el.kind)) continue;
    for (const name of el.specializes) {
      const t = el.parent ? resolvePath(el.parent, name) : undefined;
      const tb = t ? boxByEl.get(t) : undefined;
      if (!tb || tb === box || isNestedPair(box, tb)) continue;
      const key = `${box.x},${box.y}->${tb.x},${tb.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p1 = rectAnchor(box, tb);
      const p2 = rectAnchor(tb, box);
      edges.push({
        el,
        kind: "specialize",
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        a: box,
        b: tb,
        arrow: true,
        dashed: false,
      });
    }
  }
  return edges;
}

/**
 * BDD composition edges: def --(member)--> def of the member's type.
 * Membership is taken from def bodies AND from the internal structure of
 * usages: `part vehicle : Vehicle { part engine : Engine; }` implies that
 * Vehicle composes Engine even when `part def Vehicle` declares no members.
 */
function composeEdges(
  root: SysMLElement,
  boxByEl: Map<SysMLElement, DiagramNode>
): DiagramEdge[] {
  const memberKinds = new Set([
    "part", "item", "port", "action", "state", "ref", "attribute",
    "connection", "occurrence", "requirement", "use case",
  ]);
  // merge parallel edges (several members of the same type) into one labelled edge
  const merged = new Map<string, { a: DiagramNode; b: DiagramNode; el: SysMLElement; labels: string[] }>();

  const boxOfType = (el: SysMLElement, names: string[]): DiagramNode | undefined => {
    for (const tn of names) {
      const t = el.parent ? resolvePath(el.parent, tn, el) : undefined;
      const b = t ? boxByEl.get(t) : undefined;
      if (b) return b;
    }
    return undefined;
  };

  walk(root, (el) => {
    // owner box: a rendered def, or the def a usage is typed by
    const owner = el.kind.endsWith("def")
      ? boxByEl.get(el)
      : el.typedBy.length
        ? boxOfType(el, el.typedBy)
        : undefined;
    if (!owner) return;
    for (const c of el.children) {
      if (!memberKinds.has(c.kind) || !c.typedBy.length) continue;
      const tb = boxOfType(c, c.typedBy);
      if (!tb || tb === owner || isNestedPair(owner, tb)) continue;
      const key = `${owner.x},${owner.y}->${tb.x},${tb.y}`;
      const label = (c.name ?? "") + (c.multiplicity ? " " + c.multiplicity : "");
      const entry = merged.get(key);
      if (entry) {
        if (label && !entry.labels.includes(label)) entry.labels.push(label);
      } else {
        merged.set(key, { a: owner, b: tb, el: c, labels: label ? [label] : [] });
      }
    }
  });

  const edges: DiagramEdge[] = [];
  for (const { a, b, el, labels } of merged.values()) {
    const p1 = rectAnchor(a, b);
    const p2 = rectAnchor(b, a);
    edges.push({
      el,
      kind: "compose",
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      a,
      b,
      label: labels.slice(0, 3).join(", ") + (labels.length > 3 ? " …" : ""),
      arrow: false,
      dashed: false,
    });
  }
  return edges;
}

/** «import» dependency edges between rendered package boxes */
function importEdges(boxByEl: Map<SysMLElement, DiagramNode>): DiagramEdge[] {
  const edges: DiagramEdge[] = [];
  const seen = new Set<string>();
  for (const [el, box] of boxByEl) {
    if (!PACKAGE_KINDS.includes(el.kind)) continue;
    for (const c of el.children) {
      if (c.kind !== "import" || !c.target) continue;
      const first = c.target.split(/::|\./).filter(Boolean)[0];
      if (!first) continue;
      const t = resolvePath(el, first, c);
      const tb = t ? boxByEl.get(t) : undefined;
      if (!tb || tb === box || isNestedPair(box, tb)) continue;
      const key = `${box.x},${box.y}->${tb.x},${tb.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p1 = rectAnchor(box, tb);
      const p2 = rectAnchor(tb, box);
      edges.push({
        el: c,
        kind: "import",
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        a: box,
        b: tb,
        label: "«import»",
        arrow: true,
        dashed: true,
      });
    }
  }
  return edges;
}

// ---- sequence diagram ----------------------------------------------------

const LIFELINE_KINDS = new Set(["part", "item", "occurrence"]);
const SEQ_HEAD_H = HEADER_H + KIND_H;
const SEQ_GAP_X = 40;
const SEQ_MSG_GAP = 36;

/** topmost usages under scope (not nested inside another lifeline candidate) */
function topUsages(scope: SysMLElement): SysMLElement[] {
  const out: SysMLElement[] = [];
  const rec = (el: SysMLElement) => {
    for (const c of el.children) {
      // direction-prefixed features are parameters, not lifelines
      if (LIFELINE_KINDS.has(c.kind) && !c.direction) out.push(c);
      else rec(c);
    }
  };
  rec(scope);
  return out;
}

function layoutSequence(root: SysMLElement, options: LayoutOptions): DiagramLayout {
  // pick the scope: descend while there is exactly one lifeline candidate
  let scope = root;
  let lifelineEls = topUsages(scope);
  for (let i = 0; i < 4 && lifelineEls.length === 1 && lifelineEls[0].children.length; i++) {
    scope = lifelineEls[0];
    lifelineEls = topUsages(scope);
  }
  interface Msg {
    el: SysMLElement;
    from: SysMLElement;
    to: SysMLElement;
    label?: string;
  }
  // resolve an end path while staying inside the usage tree: the first
  // segment is scope-resolved, later segments stop at the deepest local
  // element (full inheritance resolution would leave the lifeline's subtree)
  const resolveUsageChain = (scope: SysMLElement, path: string): SysMLElement | undefined => {
    const segments = path.split(/::|\./).filter(Boolean);
    if (!segments.length) return undefined;
    let cur = resolvePath(scope, segments[0]);
    if (!cur) return undefined;
    for (let i = 1; i < segments.length; i++) {
      const next = findByName(cur, segments[i]);
      if (!next) break;
      cur = next;
    }
    return cur;
  };

  // messages are item flows (`flow` / `message`) between parts; successions
  // and transitions are control flow and belong to the activity / state views
  const computeMsgs = (els: SysMLElement[]): Msg[] => {
    const set = new Set(els);
    const ownerLifeline = (el: SysMLElement | undefined): SysMLElement | undefined => {
      let cur = el;
      while (cur) {
        if (set.has(cur)) return cur;
        cur = cur.parent;
      }
      return undefined;
    };
    const out: Msg[] = [];
    walk(root, (el) => {
      if (!el.parent) return;
      if (el.kind !== "flow" || (el.ends?.length ?? 0) < 2) return;
      const a = resolveUsageChain(el.parent, el.ends![0].path);
      const b = resolveUsageChain(el.parent, el.ends![1].path);
      const label = el.typedBy.length ? el.typedBy.join(",") : el.name;
      const from = ownerLifeline(a);
      const to = ownerLifeline(b);
      if (from && to && from !== to) out.push({ el, from, to, label });
    });
    out.sort(
      (a, b) => (a.el.fileId ?? 0) - (b.el.fileId ?? 0) || a.el.start - b.el.start
    );
    return out;
  };

  let msgs = computeMsgs(lifelineEls);
  // all flows internal to a single lifeline? expand lifelines one level into
  // their child parts until messages become visible
  for (let round = 0; round < 3 && !msgs.length; round++) {
    const expanded = lifelineEls.flatMap((l) => {
      const inner = topUsages(l);
      return inner.length ? inner : [l];
    });
    if (expanded.length === lifelineEls.length) break;
    lifelineEls = expanded;
    msgs = computeMsgs(lifelineEls);
  }
  lifelineEls.sort((a, b) => (a.fileId ?? 0) - (b.fileId ?? 0) || a.start - b.start);

  // hide lifelines that exchange no messages (when any messages exist)
  if (msgs.length) {
    const participants = new Set<SysMLElement>();
    for (const m of msgs) {
      participants.add(m.from);
      participants.add(m.to);
    }
    lifelineEls = lifelineEls.filter((el) => participants.has(el));
  }

  const height = Math.max(
    SEQ_HEAD_H + 90,
    SEQ_HEAD_H + 40 + msgs.length * SEQ_MSG_GAP + 50
  );

  // lifeline head boxes
  const { offsets, keyOf } = options;
  const boxByLifeline = new Map<SysMLElement, DiagramNode>();
  const nodes: DiagramNode[] = [];
  let x = GAP;
  for (const el of lifelineEls) {
    const label = nodeLabel(el);
    const tLabel = typeLabel(el) ?? "";
    const w = Math.max(100, textWidth(label + " " + tLabel) + PAD * 2);
    // manual horizontal adjustment only (vertical position is fixed)
    const dx = offsets && keyOf ? offsets[keyOf(el)]?.dx ?? 0 : 0;
    const node: DiagramNode = {
      el,
      label,
      kindLabel: kindLabel(el),
      typeLabel: typeLabel(el),
      x: Math.max(GAP, x + dx),
      y: GAP,
      w,
      h: SEQ_HEAD_H,
      rounded: false,
      lifelineEnd: height,
      attributes: [],
      ports: [],
      children: [],
      depth: 0,
    };
    nodes.push(node);
    boxByLifeline.set(el, node);
    x += w + SEQ_GAP_X;
  }

  const edges: DiagramEdge[] = [];
  msgs.forEach((m, i) => {
    const a = boxByLifeline.get(m.from)!;
    const b = boxByLifeline.get(m.to)!;
    const y = GAP + SEQ_HEAD_H + 40 + i * SEQ_MSG_GAP;
    edges.push({
      el: m.el,
      kind: m.el.kind as DiagramEdge["kind"],
      x1: a.x + a.w / 2,
      y1: y,
      x2: b.x + b.w / 2,
      y2: y,
      label: m.label,
      arrow: true,
      dashed: m.el.kind === "flow",
    });
  });

  applyEdgeRouting(edges, options);

  const width = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0) + GAP;
  return { nodes, edges, width, height: height + GAP };
}
