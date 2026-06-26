/**
 * Simplified AST for the SysML v2 textual notation.
 *
 * The parser handles a pragmatic subset of the KerML/SysML v2 grammar that
 * covers the constructs most commonly used for system architecture modelling
 * (packages, part/attribute/port/action/state/requirement definitions and
 * usages, connections, flows, imports, specialization relationships ...).
 */

export type ElementKind =
  | "namespace"
  | "file"
  | "package"
  | "library package"
  | "part def"
  | "part"
  | "attribute def"
  | "attribute"
  | "port def"
  | "port"
  | "item def"
  | "item"
  | "action def"
  | "action"
  | "state def"
  | "state"
  | "transition"
  | "requirement def"
  | "requirement"
  | "constraint def"
  | "constraint"
  | "interface def"
  | "interface"
  | "connection def"
  | "connection"
  | "connect"
  | "bind"
  | "flow"
  | "allocation def"
  | "allocation"
  | "analysis def"
  | "analysis"
  | "verification def"
  | "verification"
  | "use case def"
  | "use case"
  | "concern def"
  | "concern"
  | "view def"
  | "view"
  | "viewpoint def"
  | "viewpoint"
  | "rendering def"
  | "rendering"
  | "enum def"
  | "enum"
  | "occurrence def"
  | "occurrence"
  | "metadata def"
  | "metadata"
  | "calc def"
  | "calc"
  | "case def"
  | "case"
  | "import"
  | "alias"
  | "comment"
  | "doc"
  | "perform"
  | "exhibit"
  | "satisfy"
  | "ref"
  | "event"
  | "unknown";

export interface ConnectionEnd {
  /** Qualified feature chain, e.g. "engine.fuelPort" */
  path: string;
}

/** A reference to another element, with its source range (for diagnostics). */
export interface Ref {
  kind: "type" | "specialize" | "redefine" | "end" | "target" | "import" | "metadata";
  name: string;
  start: number;
  end: number;
}

export interface SysMLElement {
  kind: ElementKind;
  /** Declared name (unquoted). */
  name?: string;
  /** Short name declared with <shortName>. */
  shortName?: string;
  /** Feature typings introduced with `:` or `defined by`. */
  typedBy: string[];
  /** Specializations `:>` / `specializes` / `subsets`. */
  specializes: string[];
  /** Redefinitions `:>>` / `redefines`. */
  redefines: string[];
  /** Multiplicity text, e.g. "[1..*]". */
  multiplicity?: string;
  /** Initial / bound value expression text after `=` or `:=`. */
  value?: string;
  /** Direction prefix for features: in / out / inout. */
  direction?: "in" | "out" | "inout";
  /** Other modifier prefixes: abstract, variation, ref, readonly, derived ... */
  modifiers: string[];
  /** documentation comment body, if any */
  doc?: string;
  /** For connect/bind/flow usages. */
  ends?: ConnectionEnd[];
  /** For import / alias: target qualified name. */
  target?: string;
  /** For transitions: trigger / guard / effect text. */
  transition?: { source?: string; target?: string; trigger?: string; guard?: string };
  /** References to other elements with source ranges (for validation). */
  refs: Ref[];
  children: SysMLElement[];
  parent?: SysMLElement;
  /** id of the workspace file this element belongs to */
  fileId?: number;
  /** Character offsets into the source document. */
  start: number;
  end: number;
  /** Offset range of just the name token (for selection). */
  nameStart?: number;
  nameEnd?: number;
}

export interface ParseError {
  message: string;
  start: number;
  end: number;
}

export interface ParseResult {
  root: SysMLElement;
  errors: ParseError[];
}

export function createElement(kind: ElementKind, start = 0): SysMLElement {
  return {
    kind,
    typedBy: [],
    specializes: [],
    redefines: [],
    modifiers: [],
    refs: [],
    children: [],
    start,
    end: start,
  };
}

/** Human readable label for an element. */
export function elementLabel(el: SysMLElement): string {
  if (el.kind === "import" || el.kind === "alias") return `${el.kind} ${el.target ?? ""}`;
  if (el.kind === "connect" || el.kind === "bind" || el.kind === "flow") {
    const ends = (el.ends ?? []).map((e) => e.path).join(el.kind === "bind" ? " = " : " to ");
    return el.name ? `${el.name}: ${ends}` : ends;
  }
  if (el.kind === "transition") {
    const t = el.transition;
    const arrow = t?.source || t?.target ? `${t?.source ?? "?"} → ${t?.target ?? "?"}` : "";
    return el.name ? (arrow ? `${el.name}: ${arrow}` : el.name) : arrow || "(transition)";
  }
  return el.name ?? el.shortName ?? el.target ?? `(${el.kind})`;
}

/** Walk the tree depth-first. */
export function walk(el: SysMLElement, fn: (el: SysMLElement) => void): void {
  fn(el);
  for (const c of el.children) walk(c, fn);
}

/** Qualified name from root (ignoring unnamed ancestors and file nodes). */
export function qualifiedName(el: SysMLElement): string {
  const parts: string[] = [];
  let cur: SysMLElement | undefined = el;
  while (cur) {
    if (cur.name && cur.kind !== "file") parts.unshift(cur.name);
    cur = cur.parent;
  }
  return parts.join("::");
}
