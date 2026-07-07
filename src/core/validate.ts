import { SysMLElement, walk } from "./ast";
import { Resolver } from "./resolve";
import { inferType, typeOfElement, conflicts, typeLabel } from "./types";

export type SemanticRule =
  | "unresolved"
  | "duplicate"
  | "conformance"
  | "shadowing"
  | "importVisibility"
  | "type";

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
  typeChecking: boolean;
}

const DEFAULT_OPTIONS: ValidateOptions = {
  unresolved: true,
  duplicates: true,
  conformance: true,
  shadowing: true,
  importVisibility: true,
  typeChecking: true,
};

/** kinds whose body expression must evaluate to Boolean */
const BOOLEAN_BODY_KINDS = new Set(["constraint", "constraint def"]);

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

    // ---- imports should declare explicit visibility (SysIDE compatible) ----
    if (
      options.importVisibility &&
      el.kind === "import" &&
      !el.modifiers.some((m) => m === "public" || m === "private" || m === "protected")
    ) {
      out.push({
        rule: "importVisibility",
        message: "import must declare visibility (public / private)",
        start: el.start,
        end: el.end,
      });
    }

    // ---- flow ends should use dot notation (ends are features inside elements) ----
    if (options.conformance && el.kind === "flow" && el.ends) {
      for (const ref of el.refs) {
        if (ref.kind === "end" && !ref.name.includes(".") && !ref.name.includes("::")) {
          out.push({
            rule: "conformance",
            message: `flow end '${ref.name}' must use dot notation to refer to a feature inside an element (e.g. ${ref.name}.item)`,
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
        // implicit action end points: every action/state body may reference
        // the standard `start` / `done` nodes (Actions::Action) in
        // successions (`first start; … then done;`) without declaring them.
        if (ref.kind === "end" && (ref.name === "start" || ref.name === "done")) continue;
        if (options.unresolved) {
          out.push({
            rule: "unresolved",
            message: `Cannot resolve '${ref.name}'`,
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
            message: `${el.kind} must be typed by ${allowed.join(" / ")} ('${ref.name}' is ${target.kind})`,
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
            message: `${el.kind} specializes ${target.kind} ('${ref.name}') — kinds do not match`,
            start: ref.start,
            end: ref.end,
          });
        }
      } else if (ref.kind === "metadata") {
        if (target.kind.endsWith(" def") && target.kind !== "metadata def") {
          out.push({
            rule: "conformance",
            message: `metadata annotation '${ref.name}' must refer to a metadata def (got ${target.kind})`,
            start: ref.start,
            end: ref.end,
          });
        }
      }
    }

    // ---- expression type checking (positive knowledge only) ----
    if (options.typeChecking && el.valueExpr && el.valueExpr.kind !== "opaque") {
      // a constraint body must evaluate to Boolean
      if (BOOLEAN_BODY_KINDS.has(el.kind)) {
        const t = inferType(el.valueExpr, el, resolver);
        if (t.kind === "number" || t.kind === "string") {
          out.push({
            rule: "type",
            message: `制約本体は Boolean に評価される必要があります (推論結果: ${typeLabel(t)})`,
            start: el.valueExpr.start,
            end: el.valueExpr.end,
          });
        }
      } else if (el.typedBy.length) {
        // a value must conform to the feature's declared (scalar) type
        const declared = typeOfElement(el, scope, resolver);
        const valueType = inferType(el.valueExpr, el, resolver);
        if (conflicts(declared, valueType)) {
          out.push({
            rule: "type",
            message: `${el.name ?? "値"} の型 ${typeLabel(declared)} に ${typeLabel(valueType)} の値は適合しません`,
            start: el.valueExpr.start,
            end: el.valueExpr.end,
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
              message: `'${c.name}' hides an inherited member — use ':>> ${c.name}' to redefine`,
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
            message: `'${c.name}' is duplicated in the same scope`,
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
