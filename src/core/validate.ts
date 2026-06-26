import { SysMLElement, walk } from "./ast";
import { Resolver } from "./resolve";

export type SemanticRule =
  | "unresolved"
  | "duplicate"
  | "conformance"
  | "shadowing"
  | "importVisibility";

export interface SemanticDiagnostic {
  message: string;
  start: number;
  end: number;
  rule: SemanticRule;
}

/** usage kind -> def kinds it may be typed by */
const TYPE_CONFORMANCE: Record<string, string[]> = {
  part: ["part def", "occurrence def"],
  item: ["item def", "part def", "occurrence def"],
  attribute: ["attribute def", "enum def"],
  port: ["port def"],
  action: ["action def", "calc def"],
  state: ["state def"],
  connection: ["connection def", "interface def", "allocation def", "flow def"],
  interface: ["interface def"],
  allocation: ["allocation def"],
  requirement: ["requirement def"],
  constraint: ["constraint def"],
  calc: ["calc def"],
  enum: ["enum def", "attribute def"],
  "use case": ["use case def"],
  analysis: ["analysis def"],
  verification: ["verification def"],
  view: ["view def"],
  viewpoint: ["viewpoint def"],
  rendering: ["rendering def"],
  concern: ["concern def"],
  // `flow of X` types the payload, so item-ish defs are fine too
  flow: ["flow def", "item def", "part def", "attribute def", "enum def"],
  metadata: ["metadata def"],
  exhibit: ["state def"],
  perform: ["action def"],
  occurrence: ["occurrence def", "part def", "item def", "action def"],
};

/** def kind -> family for specialization compatibility */
const KIND_GROUP: Record<string, string> = {
  "part def": "structure",
  "item def": "structure",
  "occurrence def": "structure",
  "connection def": "structure",
  "interface def": "structure",
  "allocation def": "structure",
  "flow def": "structure",
  "attribute def": "attribute",
  "enum def": "attribute",
  "port def": "port",
  "action def": "behavior",
  "state def": "behavior",
  "calc def": "behavior",
  "case def": "behavior",
  "analysis def": "behavior",
  "verification def": "behavior",
  "use case def": "behavior",
  "requirement def": "requirement",
  "constraint def": "requirement",
  "concern def": "requirement",
  "viewpoint def": "requirement",
  "view def": "view",
  "rendering def": "view",
  "metadata def": "metadata",
};

/** kinds that count as declarations for the duplicate-name check */
const DECLARATION_KINDS = new Set([
  "package", "library package", "namespace",
  "part def", "part", "attribute def", "attribute", "port def", "port",
  "item def", "item", "action def", "action", "state def", "state",
  "requirement def", "requirement", "constraint def", "constraint",
  "interface def", "interface", "connection def", "connection",
  "enum def", "enum", "use case def", "use case", "occurrence def", "occurrence",
  "analysis def", "analysis", "verification def", "verification",
  "view def", "view", "viewpoint def", "viewpoint", "rendering def", "rendering",
  "concern def", "concern", "calc def", "calc", "case def", "case",
  "allocation def", "metadata def", "flow def", "alias", "ref",
]);

export interface ValidateOptions {
  unresolved: boolean;
  duplicates: boolean;
  conformance: boolean;
  shadowing: boolean;
  importVisibility: boolean;
}

const DEFAULT_OPTIONS: ValidateOptions = {
  unresolved: true,
  duplicates: true,
  conformance: true,
  shadowing: true,
  importVisibility: true,
};

/** feature-like kinds that can shadow / redefine inherited members */
const FEATURE_KINDS = new Set([
  "part", "attribute", "port", "item", "action", "state", "requirement",
  "constraint", "calc", "enum", "ref", "occurrence",
]);

export function validateFile(
  fileRoot: SysMLElement,
  resolver: Resolver,
  options: ValidateOptions = DEFAULT_OPTIONS
): SemanticDiagnostic[] {
  const out: SemanticDiagnostic[] = [];

  walk(fileRoot, (el) => {
    if (el === fileRoot) return;
    const scope = el.parent ?? fileRoot;

    // ---- imports should declare explicit visibility (SysIDE 互換) ----
    if (
      options.importVisibility &&
      el.kind === "import" &&
      !el.modifiers.some((m) => m === "public" || m === "private" || m === "protected")
    ) {
      out.push({
        rule: "importVisibility",
        message: "import には可視性 (public / private) を明示してください",
        start: el.start,
        end: el.end,
      });
    }

    // ---- flow ends should use dot notation (端は要素内のフィーチャ) ----
    if (options.conformance && el.kind === "flow" && el.ends) {
      for (const ref of el.refs) {
        if (ref.kind === "end" && !ref.name.includes(".") && !ref.name.includes("::")) {
          out.push({
            rule: "conformance",
            message: `フローの端 '${ref.name}' は dot 記法で要素内のフィーチャを指定してください (例: ${ref.name}.item)`,
            start: ref.start,
            end: ref.end,
          });
        }
      }
    }

    // ---- reference resolution + typing conformance ----
    for (const ref of el.refs) {
      const base = ref.name.replace(/(::)?\*\*?$/, "");
      if (!base) continue;
      const target = resolver.resolve(scope, base);

      if (!target) {
        if (options.unresolved) {
          out.push({
            rule: "unresolved",
            message: `'${ref.name}' を解決できません`,
            start: ref.start,
            end: ref.end,
          });
        }
        continue;
      }

      if (!options.conformance) continue;

      if (ref.kind === "type") {
        const allowed = TYPE_CONFORMANCE[el.kind];
        if (allowed && target.kind.endsWith(" def") && !allowed.includes(target.kind)) {
          out.push({
            rule: "conformance",
            message: `${el.kind} は ${allowed.join(" / ")} で型付けする必要があります ('${ref.name}' は ${target.kind})`,
            start: ref.start,
            end: ref.end,
          });
        }
      } else if (ref.kind === "specialize" && el.kind.endsWith(" def")) {
        const g1 = KIND_GROUP[el.kind];
        const g2 = KIND_GROUP[target.kind];
        if (g1 && g2 && g1 !== g2) {
          out.push({
            rule: "conformance",
            message: `${el.kind} が ${target.kind} ('${ref.name}') を特化しています — 種類が一致しません`,
            start: ref.start,
            end: ref.end,
          });
        }
      } else if (ref.kind === "metadata") {
        if (target.kind.endsWith(" def") && target.kind !== "metadata def") {
          out.push({
            rule: "conformance",
            message: `メタデータ注釈 '${ref.name}' は metadata def を参照する必要があります (実際は ${target.kind})`,
            start: ref.start,
            end: ref.end,
          });
        }
      }
    }

    // ---- declarations shadowing inherited members ----
    if (
      options.shadowing &&
      (el.typedBy.length > 0 || el.specializes.length > 0) &&
      el.children.length > 0
    ) {
      for (const c of el.children) {
        if (!c.name || c.nameStart === undefined) continue;
        if (!FEATURE_KINDS.has(c.kind)) continue;
        // redefining / subsetting children are explicitly related – fine
        if (c.redefines.length || c.specializes.length) continue;
        // subject / objective / actor ... implicitly redefine per the spec
        if (c.modifiers.some((m) =>
          m === "subject" || m === "objective" || m === "actor" ||
          m === "stakeholder" || m === "frame"
        )) continue;
        for (const g of resolver.generalsOf(el, new Set([el]))) {
          const inherited = resolver.lookupMember(g, c.name, new Set([el]));
          if (inherited && inherited !== c) {
            out.push({
              rule: "shadowing",
              message: `'${c.name}' は継承メンバーを隠しています — 再定義するには ':>> ${c.name}' を使ってください`,
              start: c.nameStart,
              end: c.nameEnd ?? c.nameStart + c.name.length,
            });
            break;
          }
        }
      }
    }

    // ---- duplicate sibling names ----
    if (options.duplicates && el.children.length > 1) {
      const seen = new Map<string, SysMLElement>();
      for (const c of el.children) {
        if (!c.name || c.nameStart === undefined) continue;
        if (!DECLARATION_KINDS.has(c.kind)) continue;
        // perform/exhibit etc. without typing are references, already excluded
        const prev = seen.get(c.name);
        if (prev) {
          out.push({
            rule: "duplicate",
            message: `'${c.name}' は同じスコープ内で重複しています`,
            start: c.nameStart,
            end: c.nameEnd ?? c.nameStart + c.name.length,
          });
        } else {
          seen.set(c.name, c);
        }
      }
    }
  });

  return out;
}
