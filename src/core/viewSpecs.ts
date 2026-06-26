/**
 * Per-diagram-kind view configuration: which element kinds become boxes,
 * which become text lines, which edges are shown, and the synthesized
 * relationships (composition / specialization / import / actor handling).
 * Adding a diagram kind is mostly adding an entry to VIEW_SPECS.
 */
import { SysMLElement } from "./ast";

/** Whether an element is drawn as an edge (connector) rather than a box. */
export function isEdgeElement(el: SysMLElement): boolean {
  return (
    el.kind === "connect" ||
    el.kind === "bind" ||
    el.kind === "flow" ||
    el.kind === "transition" ||
    ((el.kind === "connection" || el.kind === "interface" || el.kind === "allocation") &&
      (el.ends?.length ?? 0) >= 2)
  );
}

// ---- diagram kinds ------------------------------------------------------

/** Diagram view kinds selectable in the diagram panel. */
export type DiagramKind =
  | "general"
  | "bdd"
  | "ibd"
  | "req"
  | "uc"
  | "state"
  | "action"
  | "seq";

export const DIAGRAM_KINDS: { id: DiagramKind; label: string; description: string }[] = [
  { id: "general", label: "全体図", description: "モデル全体 (構造・振る舞いのすべて)" },
  { id: "bdd", label: "ブロック定義図", description: "構造定義 (part def 等) と特化・コンポジション関係" },
  { id: "ibd", label: "内部ブロック図", description: "ブロック内部の part 構成と接続 (connect / flow / port)" },
  { id: "req", label: "要求図", description: "要求と satisfy / verify 関係" },
  { id: "uc", label: "ユースケース図", description: "ユースケースと perform / include 関係" },
  { id: "state", label: "状態遷移図", description: "状態機械 (状態と transition)" },
  { id: "action", label: "アクティビティ図", description: "アクションと succession / flow" },
  { id: "seq", label: "シーケンス図", description: "part 間のメッセージ (flow / message) を時系列表示" },
];

export function diagramKindLabel(kind: DiagramKind): string {
  return DIAGRAM_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

/** Kinds rendered as nested boxes in the diagram. */
export const BOX_KINDS = new Set([
  "namespace", "package", "library package",
  "part def", "part",
  "item def", "item",
  "action def", "action",
  "state def", "state",
  "interface def", "connection def",
  "requirement def", "requirement",
  "use case def", "use case",
  "occurrence def", "occurrence",
  "analysis def", "analysis",
  "verification def", "verification",
  "view def", "view",
  "enum def",
  "port def",
  "constraint def",
  "concern def", "concern",
  "calc def",
  "allocation def",
  "metadata def",
  "flow def",
  "case def", "case",
  "exhibit", "perform",
]);

/** Kinds listed as text lines inside their parent box. */
export const TEXT_KINDS = new Set([
  "attribute", "attribute def", "ref", "enum", "constraint", "calc",
  "satisfy", "event", "import", "alias", "comment",
]);

export const PORT_KINDS = new Set(["port"]);

export const PACKAGE_KINDS = ["namespace", "package", "library package"];

/** structural definitions shown in the block definition diagram */
export const STRUCTURAL_DEF_KINDS = [
  "part def", "item def", "port def", "attribute def", "interface def",
  "connection def", "enum def", "occurrence def", "flow def",
  "constraint def", "allocation def",
];

export const ALL_EDGE_KINDS = [
  "connect", "bind", "flow", "transition", "interface", "connection", "allocation",
];

// ---- per-kind view specification ----------------------------------------

export interface ViewSpec {
  /** kinds always rendered as boxes */
  primary: Set<string>;
  /** additional box predicate (e.g. actor-modified features) */
  extraPrimary?: (el: SysMLElement) => boolean;
  /** kinds rendered as boxes only when their subtree contains primary content */
  containers: Set<string>;
  /**
   * extra condition for top-level boxes. Elements that fail it are dropped
   * from the diagram top level (IBD: only composite parts), but still render
   * normally when nested inside another box.
   */
  topFilter?: (el: SysMLElement) => boolean;
  /** kinds rendered as text lines inside parent boxes */
  text: Set<string>;
  /** parsed edge kinds shown */
  edges: Set<string>;
  /** show port squares on box borders */
  ports: boolean;
  /** kinds rendered as ellipses (use cases) */
  ellipse?: Set<string>;
  /** include doc comments as body lines */
  doc?: boolean;
  /** synthesize specialization edges between rendered boxes */
  specializeEdges?: boolean;
  /** synthesize composition edges def -> type-of-member-usage (BDD) */
  composeEdges?: boolean;
  /** synthesize «import» dependency edges between package boxes */
  importEdges?: boolean;
  /** when false, package boxes show no member text lines (BDD) */
  packageText?: boolean;
  /** reference usages (satisfy / perform) drawn as edges */
  refEdges?: Set<string>;
  /**
   * pull actor members out of their use case box and connect them with an
   * association line instead (classic use case diagram rendering)
   */
  hoistActors?: boolean;
}

export const VIEW_SPECS: Record<Exclude<DiagramKind, "seq">, ViewSpec> = {
  general: {
    primary: BOX_KINDS,
    containers: new Set(),
    text: TEXT_KINDS,
    edges: new Set(ALL_EDGE_KINDS),
    ports: true,
  },
  bdd: {
    primary: new Set(STRUCTURAL_DEF_KINDS),
    containers: new Set(PACKAGE_KINDS),
    text: new Set([
      ...TEXT_KINDS,
      "part", "item", "port", "action", "state", "requirement", "use case",
      "occurrence", "connection", "interface", "allocation", "case", "concern",
      "view", "viewpoint", "analysis", "verification", "metadata", "perform", "exhibit",
    ]),
    edges: new Set(),
    ports: false,
    specializeEdges: true,
    composeEdges: true,
    importEdges: true,
    packageText: false,
  },
  // no package containers: composite parts are hoisted to the diagram top
  // level so the view shows block internals, not the package hierarchy
  ibd: {
    primary: new Set(["part", "item"]),
    containers: new Set(["part def", "item def"]),
    topFilter: (el) =>
      el.children.some(
        (c) =>
          c.kind === "part" || c.kind === "item" || c.kind === "port" || isEdgeElement(c)
      ),
    text: TEXT_KINDS,
    edges: new Set(["connect", "connection", "interface", "bind", "flow", "allocation"]),
    ports: true,
  },
  req: {
    primary: new Set([
      "requirement def", "requirement", "concern def", "concern",
      "verification def", "verification",
    ]),
    containers: new Set(),
    text: TEXT_KINDS,
    edges: new Set(),
    ports: false,
    doc: true,
    specializeEdges: true,
    refEdges: new Set(["satisfy"]),
  },
  uc: {
    primary: new Set(["use case def", "use case", "case def", "case"]),
    extraPrimary: (el) => el.modifiers.includes("actor"),
    containers: new Set(),
    text: TEXT_KINDS,
    edges: new Set(),
    ports: false,
    ellipse: new Set(["use case def", "use case", "case def", "case"]),
    specializeEdges: true,
    refEdges: new Set(["perform"]),
    hoistActors: true,
  },
  state: {
    primary: new Set(["state def", "state", "exhibit"]),
    containers: new Set(),
    text: new Set([...TEXT_KINDS, "action"]),
    edges: new Set(["transition"]),
    ports: false,
  },
  action: {
    primary: new Set(["action def", "action", "perform"]),
    containers: new Set(),
    // hide leaf actions at the top level (entry/exit actions of states,
    // bare performs): the view focuses on flows, which need sub-steps
    topFilter: (el) => el.kind === "action def" || el.children.length > 0,
    text: new Set([...TEXT_KINDS, "item"]),
    edges: new Set(["transition", "flow", "bind"]),
    ports: false,
  },
};
