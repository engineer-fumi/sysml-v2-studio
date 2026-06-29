/**
 * Expression grammar for the SysML v2 / KerML textual notation.
 *
 * The element parser (`parser.ts`) captures the raw source text of a value /
 * body expression with `captureExpression()` and then hands it here to be
 * parsed into a structured AST. Keeping this independent of the element parser
 * means the delicate expression-boundary logic (lambda bodies, trailing
 * element bodies) stays in one place and expressions can be unit-tested on
 * their own.
 *
 * Precedence follows the KerML `OwnedExpression` hierarchy (loosest first):
 *
 *   conditional   if c ? a else b
 *   ??            null-coalescing
 *   implies
 *   or  |
 *   xor
 *   and  &
 *   ==  !=  ===  !==
 *   hastype istype @ as meta            (classification, RHS is a type)
 *   <  >  <=  >=
 *   ..                                  (range)
 *   +  -
 *   *  /  %
 *   **  ^                               (right associative)
 *   unary  + - not ~ all
 *   postfix  . -> .? ( ) [ ]            (navigation / invocation / indexing)
 *   primary  literal / name / ( ) / { }
 */

import { Token, tokenize } from "./lexer";

export type Expr =
  | { kind: "lit"; litKind: "number" | "string" | "bool" | "null"; value: string; start: number; end: number }
  | { kind: "name"; name: string; start: number; end: number }
  | { kind: "unary"; op: string; operand: Expr; start: number; end: number }
  | { kind: "binary"; op: string; left: Expr; right: Expr; start: number; end: number }
  | { kind: "cond"; cond: Expr; then: Expr; otherwise: Expr; start: number; end: number }
  | { kind: "classify"; op: string; operand: Expr; type: string; typeStart: number; typeEnd: number; start: number; end: number }
  | { kind: "nav"; op: "." | "->" | ".?"; target: Expr; member: string; memberStart: number; memberEnd: number; args?: Expr[]; body?: Expr; start: number; end: number }
  | { kind: "index"; target: Expr; args: Expr[]; start: number; end: number }
  | { kind: "invoke"; callee: Expr; args: Expr[]; start: number; end: number }
  | { kind: "seq"; items: Expr[]; start: number; end: number }
  | { kind: "body"; text: string; start: number; end: number }
  | { kind: "opaque"; text: string; start: number; end: number };

/** A name reference discovered inside an expression, with its source range. */
export interface ExprRef {
  name: string;
  start: number;
  end: number;
}

const NULL_KEYWORDS = new Set(["null"]);
const BOOL_KEYWORDS = new Set(["true", "false"]);
// classification operators: RHS is a type reference, not a sub-expression
const CLASSIFY_OPS = new Set(["hastype", "istype", "as", "meta", "@"]);

// binary operator -> precedence (higher binds tighter)
const BINARY_PREC: Record<string, number> = {
  implies: 1,
  or: 2, "|": 2,
  xor: 3,
  and: 4, "&": 4,
  "==": 5, "!=": 5, "===": 5, "!==": 5,
  hastype: 6, istype: 6, as: 6, meta: 6, "@": 6,
  "<": 7, ">": 7, "<=": 7, ">=": 7,
  "..": 8,
  "+": 9, "-": 9,
  "*": 10, "/": 10, "%": 10,
  "**": 11, "^": 11,
};
const RIGHT_ASSOC = new Set(["**", "^"]);

class ExprParser {
  private tokens: Token[];
  private pos = 0;
  /** offset added to every token range to rebase onto the original document */
  private base: number;
  /** set when a token could not be consumed -> caller treats result as opaque */
  ok = true;

  constructor(src: string, base: number) {
    this.base = base;
    this.tokens = tokenize(src).filter((t) => t.type !== "comment" && t.type !== "doc-comment");
  }

  private peek(o = 0): Token {
    return this.tokens[Math.min(this.pos + o, this.tokens.length - 1)];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }
  private at(text: string): boolean {
    return this.peek().text === text;
  }
  private eat(text: string): boolean {
    if (this.at(text)) {
      this.next();
      return true;
    }
    return false;
  }
  private atEof(): boolean {
    return this.peek().type === "eof";
  }
  private s(t: Token): number {
    return t.start + this.base;
  }
  private e(t: Token): number {
    return t.end + this.base;
  }

  /** Parse the whole token stream as a single expression. */
  parseAll(): Expr | undefined {
    if (this.atEof()) return undefined;
    const expr = this.parseConditional();
    if (!this.atEof()) this.ok = false;
    return expr;
  }

  private parseConditional(): Expr {
    if (this.at("if")) {
      const start = this.s(this.peek());
      this.next();
      const cond = this.parseNullCoalescing();
      // `if c ? a else b` — the `?` is required by the grammar; tolerate absence
      this.eat("?");
      const then = this.parseNullCoalescing();
      let otherwise: Expr;
      if (this.eat("else")) otherwise = this.parseConditional();
      else otherwise = { kind: "opaque", text: "", start: then.end, end: then.end };
      return { kind: "cond", cond, then, otherwise, start, end: otherwise.end };
    }
    return this.parseNullCoalescing();
  }

  private parseNullCoalescing(): Expr {
    let left = this.parseBinary(1);
    while (this.at("??")) {
      this.next();
      const right = this.parseBinary(1);
      left = { kind: "binary", op: "??", left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const op = this.peek().text;
      const prec = BINARY_PREC[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      if (CLASSIFY_OPS.has(op)) {
        const t0 = this.peek();
        const typeName = this.parseQualifiedName();
        left = {
          kind: "classify",
          op,
          operand: left,
          type: typeName,
          typeStart: this.s(t0),
          typeEnd: this.lastEnd,
          start: left.start,
          end: this.lastEnd,
        };
        continue;
      }
      const nextMin = RIGHT_ASSOC.has(op) ? prec : prec + 1;
      const right = this.parseBinary(nextMin);
      left = { kind: "binary", op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (
      t.text === "+" || t.text === "-" || t.text === "not" || t.text === "~" ||
      t.text === "all" || t.text === "new"
    ) {
      this.next();
      const operand = this.parseUnary();
      return { kind: "unary", op: t.text, operand, start: this.s(t), end: operand.end };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.text === "." || t.text === "->" || t.text === ".?") {
        const op = t.text as "." | "->" | ".?";
        this.next();
        // `.{ ... }` / `->{ ... }` body, or `x.?{ ... }`
        if (this.at("{")) {
          const body = this.parseBody();
          expr = { kind: "nav", op, target: expr, member: "", memberStart: body.start, memberEnd: body.start, body, start: expr.start, end: body.end };
          continue;
        }
        const m = this.peek();
        // numeric tuple/sequence member access: `x.1`
        let member: string;
        if (m.type === "number") {
          member = this.next().text;
          this.lastEnd = this.e(m);
        } else {
          member = this.parseQualifiedName();
        }
        let args: Expr[] | undefined;
        let body: Expr | undefined;
        if (this.at("(")) args = this.parseArgs(")");
        else if (this.at("[")) args = this.parseArgs("]");
        if (this.at("{")) body = this.parseBody();
        const end = body ? body.end : args && args.length ? args[args.length - 1].end : this.lastEnd;
        expr = { kind: "nav", op, target: expr, member, memberStart: this.s(m), memberEnd: this.s(m) + member.length, args, body, start: expr.start, end };
        continue;
      }
      if (t.text === "(") {
        const args = this.parseArgs(")");
        expr = { kind: "invoke", callee: expr, args, start: expr.start, end: this.lastEnd };
        continue;
      }
      if (t.text === "[") {
        const args = this.parseArgs("]");
        expr = { kind: "index", target: expr, args, start: expr.start, end: this.lastEnd };
        continue;
      }
      // KerML sequence indexing: `seq#(i)` / `seq#(i, j)`
      if (t.text === "#" && this.peek(1).text === "(") {
        this.next(); // #
        const args = this.parseArgs(")");
        expr = { kind: "index", target: expr, args, start: expr.start, end: this.lastEnd };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      return { kind: "lit", litKind: "number", value: t.text, start: this.s(t), end: this.e(t) };
    }
    if (t.type === "string") {
      this.next();
      return { kind: "lit", litKind: "string", value: t.text, start: this.s(t), end: this.e(t) };
    }
    if (BOOL_KEYWORDS.has(t.text)) {
      this.next();
      return { kind: "lit", litKind: "bool", value: t.text, start: this.s(t), end: this.e(t) };
    }
    if (NULL_KEYWORDS.has(t.text)) {
      this.next();
      return { kind: "lit", litKind: "null", value: t.text, start: this.s(t), end: this.e(t) };
    }
    if (t.text === "(") {
      return this.parseParenOrSeq();
    }
    if (t.text === "{") {
      return this.parseBody();
    }
    // metadata access prefix: `@Annotation` used as a primary
    if (t.text === "@" || t.text === "#") {
      this.next();
      const m = this.peek();
      const name = this.parseQualifiedName();
      return { kind: "name", name: t.text + name, start: this.s(t), end: this.s(m) + name.length };
    }
    if (t.type === "identifier" || t.type === "keyword") {
      const start = this.s(t);
      const name = this.parseQualifiedName();
      return { kind: "name", name, start, end: this.lastEnd };
    }
    // unparseable — surface as opaque so the caller can fall back
    this.ok = false;
    this.next();
    return { kind: "opaque", text: t.text, start: this.s(t), end: this.e(t) };
  }

  private parseParenOrSeq(): Expr {
    const open = this.peek();
    this.next(); // (
    const items: Expr[] = [];
    if (!this.at(")")) {
      items.push(this.parseConditional());
      while (this.eat(",")) {
        if (this.at(")")) break;
        items.push(this.parseConditional());
      }
    }
    const close = this.peek();
    this.eat(")");
    const end = this.e(close);
    if (items.length === 1) {
      // a plain parenthesised expression keeps its inner node but spans the parens
      return { ...items[0], start: this.s(open), end };
    }
    return { kind: "seq", items, start: this.s(open), end };
  }

  /** Parse a `( … )` / `[ … ]` argument list; supports `name = expr` named args. */
  private parseArgs(close: string): Expr[] {
    this.next(); // open bracket
    const args: Expr[] = [];
    if (!this.at(close)) {
      args.push(this.parseArg());
      while (this.eat(",")) {
        if (this.at(close)) break;
        args.push(this.parseArg());
      }
    }
    const c = this.peek();
    this.eat(close);
    this.lastEnd = this.e(c);
    return args;
  }

  private parseArg(): Expr {
    // named argument `name = value` (invocation) — keep just the value expression
    if ((this.peek().type === "identifier" || this.peek().type === "keyword") && this.peek(1).text === "=") {
      this.next(); // name
      this.next(); // =
    }
    return this.parseConditional();
  }

  /** Brace body `{ … }` — kept opaque (lambda / expression body). */
  private parseBody(): Expr {
    const start = this.s(this.peek());
    let depth = 0;
    let end = start;
    while (!this.atEof()) {
      const t = this.next();
      if (t.text === "{") depth++;
      else if (t.text === "}") {
        depth--;
        if (depth === 0) {
          end = this.e(t);
          break;
        }
      }
    }
    return { kind: "body", text: "", start, end };
  }

  private lastEnd = 0;

  /** A::B::C qualified name (the leftmost reference root of a feature chain). */
  private parseQualifiedName(): string {
    const parts: string[] = [];
    if (this.peek().type === "identifier" || this.peek().type === "keyword") {
      parts.push(unq(this.next().text));
      this.lastEnd = this.e(this.tokens[this.pos - 1]);
      while (this.at("::") && (this.peek(1).type === "identifier" || this.peek(1).type === "keyword")) {
        this.next(); // ::
        parts.push(unq(this.next().text));
        this.lastEnd = this.e(this.tokens[this.pos - 1]);
      }
    }
    return parts.join("::");
  }
}

function unq(text: string): string {
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1);
  return text;
}

/**
 * Parse a value-expression text span into an AST. `base` is the offset of the
 * span within the source document, so resulting node ranges are absolute.
 * Returns an `opaque` node if the text cannot be fully parsed.
 */
export function parseExpression(text: string, base = 0): Expr {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "opaque", text, start: base, end: base + text.length };
  // realign base to the first non-whitespace character
  const lead = text.length - text.trimStart().length;
  const p = new ExprParser(trimmed, base + lead);
  const expr = p.parseAll();
  if (!expr || !p.ok) {
    return { kind: "opaque", text: trimmed, start: base + lead, end: base + lead + trimmed.length };
  }
  return expr;
}

/**
 * Parse a braced body `{ … }` (constraint / calc / expr) as a single expression.
 * Strips the outer braces; falls back to opaque if the body is not a lone
 * expression (e.g. several statements).
 */
export function parseBodyExpression(text: string, base = 0): Expr {
  const t = text.trim();
  const lead = text.length - text.trimStart().length;
  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = t.slice(1, -1);
    return parseExpression(inner, base + lead + 1);
  }
  return parseExpression(text, base);
}

/** Reconstruct the dotted feature path of a name / `.`-navigation node. */
function pathOf(expr: Expr): string | undefined {
  if (expr.kind === "name") return expr.name;
  if (expr.kind === "nav" && expr.op === "." && expr.member) {
    const base = pathOf(expr.target);
    return base ? `${base}.${expr.member}` : undefined;
  }
  // an invocation keeps the callee's path (`f(x)` navigates to `f`)
  if (expr.kind === "invoke") return pathOf(expr.callee);
  if (expr.kind === "index") return pathOf(expr.target);
  return undefined;
}

/**
 * The feature path that the source `offset` lands on, reconstructed from the
 * expression AST. Clicking `flowRate` in `engine.fuelPort.flowRate` returns
 * `engine.fuelPort.flowRate` so the resolver can follow the chain through each
 * member's type. Returns undefined when the offset is not on a resolvable
 * name / member / type reference.
 */
export function pathAtOffset(expr: Expr, offset: number): string | undefined {
  const within = (s: number, e: number) => offset >= s && offset <= e;
  switch (expr.kind) {
    case "name":
      return within(expr.start, expr.end) ? expr.name : undefined;
    case "classify": {
      if (within(expr.typeStart, expr.typeEnd)) return expr.type;
      return pathAtOffset(expr.operand, offset);
    }
    case "nav": {
      // `.`-navigation: clicking the member resolves the whole chain up to it
      if (expr.op === "." && expr.member && within(expr.memberStart, expr.memberEnd)) {
        const base = pathOf(expr.target);
        return base ? `${base}.${expr.member}` : expr.member;
      }
      const t = pathAtOffset(expr.target, offset);
      if (t) return t;
      if (expr.args) for (const a of expr.args) {
        const r = pathAtOffset(a, offset);
        if (r) return r;
      }
      return undefined;
    }
    case "index":
      return pathAtOffset(expr.target, offset) ?? firstHit(expr.args, offset);
    case "invoke":
      return pathAtOffset(expr.callee, offset) ?? firstHit(expr.args, offset);
    case "unary":
      return pathAtOffset(expr.operand, offset);
    case "binary":
      return pathAtOffset(expr.left, offset) ?? pathAtOffset(expr.right, offset);
    case "cond":
      return pathAtOffset(expr.cond, offset) ?? pathAtOffset(expr.then, offset) ?? pathAtOffset(expr.otherwise, offset);
    case "seq":
      return firstHit(expr.items, offset);
    default:
      return undefined;
  }
}

function firstHit(items: Expr[], offset: number): string | undefined {
  for (const it of items) {
    const r = pathAtOffset(it, offset);
    if (r) return r;
  }
  return undefined;
}

/** Collect leftmost name references (for navigation / resolution). */
export function collectExprRefs(expr: Expr, out: ExprRef[] = []): ExprRef[] {
  switch (expr.kind) {
    case "name":
      if (expr.name && !expr.name.startsWith("@") && !expr.name.startsWith("#")) {
        out.push({ name: expr.name, start: expr.start, end: expr.end });
      }
      break;
    case "unary":
      collectExprRefs(expr.operand, out);
      break;
    case "binary":
      collectExprRefs(expr.left, out);
      collectExprRefs(expr.right, out);
      break;
    case "cond":
      collectExprRefs(expr.cond, out);
      collectExprRefs(expr.then, out);
      collectExprRefs(expr.otherwise, out);
      break;
    case "classify":
      collectExprRefs(expr.operand, out);
      if (expr.type) out.push({ name: expr.type, start: expr.typeStart, end: expr.typeEnd });
      break;
    case "nav":
      collectExprRefs(expr.target, out);
      if (expr.args) for (const a of expr.args) collectExprRefs(a, out);
      break;
    case "index":
      collectExprRefs(expr.target, out);
      for (const a of expr.args) collectExprRefs(a, out);
      break;
    case "invoke":
      collectExprRefs(expr.callee, out);
      for (const a of expr.args) collectExprRefs(a, out);
      break;
    case "seq":
      for (const it of expr.items) collectExprRefs(it, out);
      break;
  }
  return out;
}
