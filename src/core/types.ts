/**
 * Lightweight type evaluation for SysML v2 / KerML expressions.
 *
 * The goal is *positive* type inference: a result type is only reported when it
 * can be derived with confidence (from an operator, a literal, or a resolved
 * feature's declared type). Anything uncertain — an unresolved name, a library
 * function call, a lambda body — is `unknown`. Type-checking diagnostics fire
 * only on positive knowledge, never on `unknown`, so the minimal bundled
 * standard library never produces false positives.
 */

import { SysMLElement } from "./ast";
import { Expr } from "./expr";
import { Resolver } from "./resolve";

export type Primitive = "boolean" | "number" | "string";

export type InferredType =
  | { kind: Primitive }
  | { kind: "named"; name: string; def?: SysMLElement }
  | { kind: "unknown" };

const UNKNOWN: InferredType = { kind: "unknown" };

/** Last segment of a qualified name maps to a scalar primitive family. */
const PRIMITIVE: Record<string, Primitive> = {
  Boolean: "boolean",
  String: "string",
  Integer: "number",
  Natural: "number",
  Real: "number",
  Rational: "number",
  Number: "number",
  Numerical: "number",
};

const LOGICAL = new Set([
  "and", "or", "xor", "implies", "==", "!=", "===", "!==", "<", ">", "<=", ">=",
]);
const ARITHMETIC = new Set(["+", "-", "*", "/", "%", "**", "^"]);

function primitiveOf(typeName: string): Primitive | undefined {
  const last = typeName.replace(/^~/, "").split(/::|\./).pop();
  return last ? PRIMITIVE[last] : undefined;
}

/** Human-readable label for a type (for hover). */
export function typeLabel(t: InferredType): string {
  switch (t.kind) {
    case "named": return t.name;
    case "unknown": return "?";
    default: return t.kind[0].toUpperCase() + t.kind.slice(1);
  }
}

/** The declared type of a feature / definition element. */
export function typeOfElement(el: SysMLElement, scope: SysMLElement, resolver: Resolver): InferredType {
  const typeName = el.typedBy[0] ?? el.specializes[0] ?? el.redefines[0];
  if (typeName) {
    const prim = primitiveOf(typeName);
    if (prim) return { kind: prim };
    const def = resolver.resolve(el.parent ?? scope, typeName);
    const last = typeName.split(/::|\./).pop() ?? typeName;
    return { kind: "named", name: last, def };
  }
  // a feature typed by nothing but itself a primitive-named def
  const prim = el.name ? PRIMITIVE[el.name] : undefined;
  if (prim) return { kind: prim };
  return UNKNOWN;
}

/** Infer the result type of an expression evaluated in `scope`. */
export function inferType(expr: Expr, scope: SysMLElement, resolver: Resolver): InferredType {
  switch (expr.kind) {
    case "lit":
      if (expr.litKind === "bool") return { kind: "boolean" };
      if (expr.litKind === "string") return { kind: "string" };
      if (expr.litKind === "number") return { kind: "number" };
      return UNKNOWN; // null conforms to anything

    case "unary":
      if (expr.op === "not") return { kind: "boolean" };
      if (expr.op === "+" || expr.op === "-") return { kind: "number" };
      if (expr.op === "new") return inferType(expr.operand, scope, resolver);
      return UNKNOWN;

    case "binary":
      if (LOGICAL.has(expr.op)) return { kind: "boolean" };
      if (ARITHMETIC.has(expr.op) || expr.op === "..") return { kind: "number" };
      if (expr.op === "??") {
        const l = inferType(expr.left, scope, resolver);
        return l.kind !== "unknown" ? l : inferType(expr.right, scope, resolver);
      }
      return UNKNOWN;

    case "classify":
      if (expr.op === "istype" || expr.op === "hastype") return { kind: "boolean" };
      return { kind: "named", name: expr.type.split(/::|\./).pop() ?? expr.type };

    case "cond": {
      const t = inferType(expr.then, scope, resolver);
      return t.kind !== "unknown" ? t : inferType(expr.otherwise, scope, resolver);
    }

    case "name": {
      const el = resolver.resolve(scope, expr.name);
      if (!el) return UNKNOWN;
      const own = el.name ? PRIMITIVE[el.name] : undefined;
      if (own) return { kind: own };
      return typeOfElement(el, scope, resolver);
    }

    case "nav": {
      if (expr.op !== "." || !expr.member) return UNKNOWN;
      const target = inferType(expr.target, scope, resolver);
      if (target.kind === "named" && target.def) {
        const m = resolver.lookupMember(target.def, expr.member, new Set());
        if (m) return typeOfElement(m, scope, resolver);
      }
      return UNKNOWN;
    }

    default:
      return UNKNOWN;
  }
}

/** Two primitives conflict when they belong to different scalar families. */
export function conflicts(a: InferredType, b: InferredType): boolean {
  const prim = (t: InferredType) => (t.kind === "boolean" || t.kind === "number" || t.kind === "string" ? t.kind : undefined);
  const pa = prim(a), pb = prim(b);
  return pa !== undefined && pb !== undefined && pa !== pb;
}
