import {
  ConnectionEnd,
  ElementKind,
  ParseError,
  ParseResult,
  Ref,
  SysMLElement,
  createElement,
} from "./ast";
import { Token, tokenize, unquoteName } from "./lexer";
import { parseExpression, parseBodyExpression } from "./expr";

/** Keywords that can be followed by `def` to form a definition kind. */
const DEF_KINDS = new Set([
  "part", "attribute", "port", "item", "action", "state", "requirement",
  "constraint", "interface", "connection", "allocation", "analysis",
  "verification", "concern", "view", "viewpoint", "rendering", "enum",
  "occurrence", "metadata", "calc", "case", "flow",
]);

/**
 * KerML foundation definition kinds. Unlike SysML `DEF_KINDS`, the keyword *is*
 * the kind (there is no trailing `def`), e.g. `classifier C`, `feature f`,
 * `function '=='`. `assoc` is normalized to `association`.
 */
const KERML_KINDS = new Set([
  "classifier", "feature", "function", "predicate", "datatype", "struct",
  "class", "metaclass", "behavior", "connector", "interaction", "expr",
  "step", "multiplicity", "type", "association",
]);

/** Prefix modifiers that may precede an element declaration. */
const PREFIX_MODIFIERS = new Set([
  "public", "private", "protected", "abstract", "variation", "readonly",
  "derived", "end", "individual", "snapshot", "timeslice", "variant",
  "standard", "default", "ordered", "non-unique", "nonunique", "parallel",
  "ref", "subject", "actor", "stakeholder", "frame",
  // KerML feature/definition modifiers
  "composite", "portion", "const", "constant", "var", "member",
]);

const COMPOUND_USE_CASE = "use"; // "use case [def]"

/**
 * Keywords that must never be read as a name in a reference position — they are
 * clause separators (`a to b`, `first x then y`, `of T`). Every *other* keyword
 * may legitimately be a referenced element name: the OMG standard library names
 * features `decide`, `merge`, `step`, `member`, `type`, … and references them by
 * that bare word.
 */
const NON_NAME_KEYWORDS = new Set([
  "to", "then", "from", "by", "of", "via", "if", "else", "first",
]);

/**
 * Keywords that, in a declaration *name* position, always introduce a tail
 * clause (typing / specialization / relationship / value / body) rather than
 * naming the element. A feature named with one of these can't be told apart
 * from the clause, so they are never treated as a declared name. Keywords NOT
 * listed here (e.g. `entry`, `do`, `type`, `merge`, `while`) may legally be a
 * feature's name — the standard/example models declare features called exactly
 * that — and `atDeclName` accepts them when they aren't followed by another
 * name (a real name is never immediately followed by another name).
 */
const DECL_CLAUSE_KEYWORDS = new Set([
  "defined", "typed", "by", "conjugates", "conjugate", "chains", "crosses",
  "featured", "inverse", "disjoint", "unions", "intersects", "differences",
  "of", "specializes", "subsets", "redefines", "references", "ordered",
  "nonunique", "non-unique", "parallel", "about", "from", "to", "connect",
  "allocate", "default", "all",
]);

class Parser {
  private tokens: Token[];
  private pos = 0;
  private errors: ParseError[] = [];
  private src: string;
  /** doc-comment text waiting to be attached to the next element */
  private pendingDoc?: string;
  /** #metadata prefixes waiting to be attached to the next element */
  private pendingMeta: Ref[] = [];
  /** end offset of the most recently parsed qualified name */
  private qnameEnd = 0;

  constructor(src: string) {
    this.src = src;
    // keep doc-comments in the stream; drop line comments
    this.tokens = tokenize(src).filter((t) => t.type !== "comment");
  }

  parse(): ParseResult {
    const root = createElement("namespace", 0);
    root.name = undefined;
    root.end = this.src.length;
    this.parseMembers(root, /*topLevel*/ true);
    return { root, errors: this.errors };
  }

  // ---- token helpers -------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private at(text: string): boolean {
    const t = this.peek();
    return (t.type === "keyword" || t.type === "punct") && t.text === text;
  }

  private atIdentifier(): boolean {
    return this.peek().type === "identifier";
  }

  private eat(text: string): boolean {
    if (this.at(text)) {
      this.next();
      return true;
    }
    return false;
  }

  private expect(text: string, context: string): boolean {
    if (this.eat(text)) return true;
    const t = this.peek();
    this.error(`'${text}' expected (${context})`, t.start, t.end);
    return false;
  }

  private error(message: string, start: number, end: number): void {
    this.errors.push({ message, start, end: Math.max(end, start + 1) });
  }

  /** Skip tokens until a statement boundary for error recovery. */
  private recover(): void {
    let depth = 0;
    while (this.peek().type !== "eof") {
      const t = this.peek();
      if (t.text === "{") depth++;
      if (t.text === "}") {
        if (depth === 0) return; // let caller close its body
        depth--;
      }
      this.next();
      if (t.text === ";" && depth === 0) return;
      if (t.text === "}" && depth === 0) return;
    }
  }

  // ---- grammar -------------------------------------------------------

  private parseMembers(parent: SysMLElement, topLevel = false): void {
    for (;;) {
      const t = this.peek();
      if (t.type === "eof") {
        if (!topLevel) this.error("'}' expected", t.start, t.end);
        return;
      }
      if (t.text === "}") {
        if (topLevel) {
          this.error("'}' without matching '{'", t.start, t.end);
          this.next();
          continue;
        }
        return;
      }
      if (t.type === "doc-comment") {
        // standalone note – remember as doc for the next element
        this.pendingDoc = stripCommentBody(t.text);
        this.next();
        continue;
      }
      if (t.text === ";") {
        this.next();
        continue;
      }
      const before = this.pos;
      const el = this.parseElement(parent);
      if (el) {
        el.parent = parent;
        parent.children.push(el);
      }
      if (this.pos === before) {
        // no progress – skip a token to avoid an endless loop
        this.error(`unexpected token '${t.text}'`, t.start, t.end);
        this.next();
      }
    }
  }

  private parseElement(parent: SysMLElement): SysMLElement | undefined {
    const startTok = this.peek();
    const modifiers: string[] = [];
    let direction: SysMLElement["direction"];

    // prefix modifiers (including #metadata prefixes)
    for (;;) {
      const t = this.peek();
      // KerML allows a connector/feature multiplicity before the kind keyword,
      // e.g. `end [0..1] feature cart : …`. Consume it so the declaration parses
      // (the value is carried by the feature's own trailing multiplicity).
      if (t.type === "punct" && t.text === "[" && modifiers.length) {
        this.parseMultiplicity();
        continue;
      }
      if (t.type === "punct" && t.text === "#") {
        this.next();
        const s = this.peek().start;
        const name = this.parseQualifiedName();
        if (name) {
          this.pendingMeta.push({ kind: "metadata", name, start: s, end: this.qnameEnd });
          modifiers.push("#" + name);
        }
        continue;
      }
      if (t.type !== "keyword") break;
      if (t.text === "in" || t.text === "out" || t.text === "inout") {
        // direction only applies when followed by a declaration keyword/name,
        // e.g. "in attribute x" / "in x : T"
        direction = t.text;
        this.next();
        continue;
      }
      if (PREFIX_MODIFIERS.has(t.text)) {
        modifiers.push(t.text);
        this.next();
        continue;
      }
      break;
    }

    const t = this.peek();

    // ---- @Metadata annotation usage ----
    if (t.type === "punct" && t.text === "@") {
      this.next();
      const el = createElement("metadata", startTok.start);
      el.modifiers = modifiers;
      this.takePendingDoc(el);
      this.qnameRef(el, "metadata");
      el.typedBy.push(el.refs[el.refs.length - 1]?.name ?? "");
      if (this.eat("about")) {
        do {
          this.qnameRef(el, "target", false, true);
        } while (this.eat(","));
      }
      this.parseBodyOrSemi(el);
      return el;
    }

    // ---- structural keywords ----
    if (t.type === "keyword") {
      switch (t.text) {
        case "package":
        case "namespace":
          return this.parseNamed(t.text === "package" ? "package" : "namespace", modifiers, startTok);
        case "library":
          this.next();
          if (this.at("package")) {
            return this.parseNamed("library package", modifiers, startTok);
          }
          this.error("'package' expected after 'library'", t.start, t.end);
          this.recover();
          return undefined;
        case "import":
          return this.parseImport(startTok, modifiers);
        case "alias":
          return this.parseAlias(startTok, modifiers);
        case "doc":
          return this.parseDoc(parent, startTok);
        case "comment":
          return this.parseComment(startTok);
        case "connect":
          this.next();
          return this.parseConnectBody("connect", startTok, modifiers, undefined);
        case "bind":
        case "binding":
          return this.parseBind(startTok, modifiers);
        case "flow":
        case "message":
          return this.parseFlow(startTok, modifiers);
        case "perform":
        case "exhibit":
        case "satisfy":
        case "include":
        case "verify":
        case "allocate":
        case "expose":
          return this.parseReferenceUsage(t.text, startTok, modifiers);
        case "transition":
        case "succession":
        case "first":
          // `succession flow x from a to b;` is an item flow with ordering
          if (t.text === "succession" && this.peek(1).text === "flow") {
            this.next();
            return this.parseFlow(startTok, [...modifiers, "succession"]);
          }
          return this.parseTransition(startTok, modifiers);
        case "entry":
        case "exit":
        case "do":
          return this.parseStateAction(t.text, startTok, modifiers);
        case "then": {
          // target-only succession: `entry; then off;` (initial state) or a
          // succession whose source is the preceding member. `then` followed
          // by a control keyword (`then merge m;`) stays opaque
          if (this.peek(1).type !== "identifier") return this.parseOpaqueStatement(startTok);
          this.next();
          const el = createElement("transition", startTok.start);
          el.modifiers = [...modifiers, "then"];
          this.takePendingDoc(el);
          el.transition = { target: this.qnameRef(el, "end", false, true) };
          this.parseBodyOrSemi(el);
          return el;
        }
        case "accept":
        case "send":
        case "assign":
        case "if":
        case "while":
        case "loop":
        case "for":
          return this.parseOpaqueStatement(startTok);
        case "merge":
        case "decide":
        case "fork":
        case "join": {
          // control node declaration: `fork forkPoint;` — parse as a named
          // member (kind "action" + modifier) so successions like
          // `then forkPoint;` can resolve it. Other forms stay opaque.
          if (this.peek(1).type === "identifier") {
            this.next();
            const el = createElement("action", startTok.start);
            el.modifiers = [...modifiers, t.text];
            this.takePendingDoc(el);
            const nt = this.next();
            el.name = unquoteName(nt.text);
            el.nameStart = nt.start;
            el.nameEnd = nt.end;
            this.parseBodyOrSemi(el);
            return el;
          }
          return this.parseOpaqueStatement(startTok);
        }
        case "return":
        case "else":
        case "until":
        case "terminate":
        case "assert":
        case "assume":
        case "require":
          return this.parseOpaqueStatement(startTok);
        case "event":
          return this.parseReferenceUsage("event", startTok, modifiers);
        case "dependency":
        case "filter":
        case "rep":
        case "render":
        case "language":
        case "locale":
        case "not": // negated usage, e.g. `not satisfy r by p;`
          return this.parseOpaqueStatement(startTok);
        case "inv": {
          // KerML invariant: `inv [name] { boolean-expression }` — the body is
          // an expression, modeled like a constraint with opaque text.
          this.next();
          const el = createElement("constraint", startTok.start);
          el.modifiers = [...modifiers, "inv"];
          this.takePendingDoc(el);
          if (this.atNameToken() && this.peek(1).text !== "(") this.parseIdentification(el);
          if (this.at("{")) el.value = this.captureBracedBody();
          this.eat(";");
          el.end = this.prevEnd();
          return el;
        }
        // Standalone KerML relationship elements (`subtype A specializes B;`,
        // `specialization Gen subtype X :> Y;`, `disjoining D disjoint a from b;`,
        // …). Captured as opaque so they parse without error; their semantics are
        // already carried by the participating features' own specializations.
        case "specialization":
        case "subtype":
        case "subset":
        case "subclassifier":
        case "redefinition":
        case "conjugation":
        case "disjoining":
        case "disjoint":
        case "featuring":
        case "typing":
        case "inverting":
        case "inverse":
        case "unioning":
        case "unions":
        case "intersecting":
        case "intersects":
        case "differencing":
        case "differences":
          return this.parseOpaqueStatement(startTok);
        case "def": {
          // `individual def X` – def preceded only by prefix modifiers
          this.next();
          return this.parseDeclaration("occurrence def", modifiers, direction, startTok);
        }
        case "objective": {
          // `objective [name] [: Type] { ... }` (anonymous allowed)
          this.next();
          const el = createElement("requirement", startTok.start);
          el.modifiers = [...modifiers, "objective"];
          el.direction = direction;
          return this.parseDeclarationTail(el, "requirement", startTok);
        }
        case COMPOUND_USE_CASE: {
          this.next();
          if (this.eat("case")) {
            const isDef = this.eat("def");
            return this.parseDeclaration(isDef ? "use case def" : "use case", modifiers, direction, startTok);
          }
          this.error("'case' expected after 'use'", t.start, t.end);
          this.recover();
          return undefined;
        }
        case "assoc": {
          // KerML association: `assoc [struct] [all] Name ...`
          this.next();
          this.eat("struct"); // `assoc struct` variant — modeled as an association
          return this.parseDeclaration("association", modifiers, direction, startTok);
        }
        case "bool": {
          // KerML scalar-feature abbreviation `bool f [clauses] { … }` — a
          // Boolean-valued feature. Parse as an attribute (scalar feature);
          // the implicit Boolean typing is not attached (parse-only, avoids
          // false "unresolved" in kernel files that don't import ScalarValues).
          this.next();
          return this.parseDeclaration("attribute", modifiers, direction, startTok);
        }
        default:
          if (DEF_KINDS.has(t.text)) {
            this.next();
            const isDef = this.eat("def");
            const kind = (isDef ? `${t.text} def` : t.text) as ElementKind;
            // anonymous path connection: `interface a.b to c.d;` (no name, the
            // identifier is the first end's path)
            if (
              !isDef &&
              (kind === "interface" || kind === "connection" || kind === "allocation") &&
              this.atIdentifier() &&
              (this.peek(1).text === "." || this.peek(1).text === "to")
            ) {
              return this.parseConnectBody(kind, startTok, modifiers, undefined);
            }
            // `connection x connect a to b;` and plain `connection def`
            return this.parseDeclaration(kind, modifiers, direction, startTok);
          }
          if (KERML_KINDS.has(t.text)) {
            // KerML definition: the keyword itself is the kind (no `def`).
            this.next();
            // anonymous connector ends: `connector eng to tanks.main1;`
            if (
              t.text === "connector" &&
              this.atIdentifier() &&
              (this.peek(1).text === "to" || this.peek(1).text === ".")
            ) {
              return this.parseConnectBody("connector" as ElementKind, startTok, modifiers, undefined);
            }
            return this.parseDeclaration(t.text as ElementKind, modifiers, direction, startTok);
          }
          break;
      }
    }

    // ---- feature without keyword: `x : T;` (enum literal, value, or an
    // action parameter like `out xrsl : Exposure`) — kind "ref" so the
    // attribute typing rules don't apply to implicit features
    if (this.atIdentifier() || this.at("<")) {
      return this.parseDeclaration("ref", modifiers, direction, startTok, /*implicitKind*/ true);
    }

    // ---- anonymous feature starting with a relationship token or value:
    // `redefines mass = 1000 [kg];` / `ref :>> system;` / `subject = v;`
    if (
      t.text === ":>>" || t.text === "redefines" ||
      t.text === ":>" || t.text === "specializes" || t.text === "subsets" ||
      t.text === "::>" || t.text === "references" || t.text === "=" ||
      // anonymous typed feature after a modifier: `subject : Engine[1..*] = …`
      (t.text === ":" && modifiers.length > 0)
    ) {
      return this.parseDeclaration("ref", modifiers, direction, startTok, /*implicitKind*/ true);
    }

    // bare re-declaration: `subject;`
    if (t.text === ";" && modifiers.length) {
      this.next();
      const el = createElement("ref", startTok.start);
      el.modifiers = modifiers;
      el.end = t.end;
      return el;
    }

    this.error(`unexpected token '${t.text}'`, t.start, t.end);
    this.recover();
    return undefined;
  }

  /** package / namespace */
  private parseNamed(kind: ElementKind, modifiers: string[], startTok: Token): SysMLElement {
    this.next(); // consume keyword
    const el = createElement(kind, startTok.start);
    el.modifiers = modifiers;
    this.takePendingDoc(el);
    this.parseIdentification(el);
    this.parseBodyOrSemi(el);
    return el;
  }

  private parseImport(startTok: Token, modifiers: string[]): SysMLElement {
    this.next();
    const el = createElement("import", startTok.start);
    el.modifiers = modifiers;
    if (this.eat("all")) el.modifiers.push("all");
    el.target = this.qnameRef(el, "import", true);
    // OMG import filter, e.g. `import P::**[@Safety];` — a metadata condition
    // restricting which members are imported. Parse-only: consume the balanced
    // `[ … ]` so it is accepted; the filter semantics are not applied.
    while (this.at("[")) this.parseMultiplicity();
    this.parseBodyOrSemi(el);
    return el;
  }

  private parseAlias(startTok: Token, modifiers: string[]): SysMLElement {
    this.next();
    const el = createElement("alias", startTok.start);
    el.modifiers = modifiers;
    // the alias name may be a keyword (`alias multiplicity for degeneracy`);
    // it is always followed by `for`, so accept any name token but not `for`
    if (this.atNameToken() && !this.at("for")) {
      const t = this.next();
      el.name = unquoteName(t.text);
      el.nameStart = t.start;
      el.nameEnd = t.end;
    }
    if (this.eat("for")) el.target = this.qnameRef(el, "target");
    this.parseBodyOrSemi(el);
    return el;
  }

  private parseDoc(parent: SysMLElement, startTok: Token): undefined {
    this.next(); // 'doc'
    // optional `<short>` and/or name: `doc <a> /* … */`, `doc Name /* … */`
    if (this.eat("<")) {
      if (this.atNameToken()) this.next();
      this.eat(">");
    }
    if (this.atNameToken()) this.next();
    const t = this.peek();
    if (t.type === "doc-comment") {
      this.next();
      parent.doc = stripCommentBody(t.text);
    } else {
      this.error("comment /* ... */ expected after doc", startTok.start, startTok.end);
      this.recover();
    }
    this.eat(";");
    return undefined;
  }

  private parseComment(startTok: Token): SysMLElement {
    this.next(); // 'comment'
    const el = createElement("comment", startTok.start);
    this.parseIdentification(el);
    if (this.eat("about")) {
      el.target = this.parseQualifiedName();
      while (this.eat(",")) this.parseQualifiedName();
    }
    const t = this.peek();
    if (t.type === "doc-comment") {
      this.next();
      el.doc = stripCommentBody(t.text);
    }
    this.eat(";");
    el.end = this.prevEnd();
    return el;
  }

  /** connect a.b to c.d  |  connect (a, b, c) */
  private parseConnectBody(
    kind: ElementKind,
    startTok: Token,
    modifiers: string[],
    existing?: SysMLElement
  ): SysMLElement {
    const el = existing ?? createElement(kind, startTok.start);
    el.modifiers = modifiers;
    this.takePendingDoc(el);
    const ends: ConnectionEnd[] = [];
    if (this.eat("(")) {
      do {
        ends.push({ path: this.parseConnectEnd(el) });
      } while (this.eat(","));
      this.expect(")", "connect");
    } else {
      ends.push({ path: this.parseConnectEnd(el) });
      if (this.expect("to", "connect")) {
        ends.push({ path: this.parseConnectEnd(el) });
      }
    }
    el.ends = ends;
    this.parseBodyOrSemi(el);
    return el;
  }

  /** connection end: `[mult] path` or a named end `endName ::> path` */
  private parseConnectEnd(el: SysMLElement): string {
    if (this.at("[")) this.parseMultiplicity();
    if (
      this.atIdentifier() &&
      (this.peek(1).text === "::>" || this.peek(1).text === "references")
    ) {
      this.next(); // end name (a declaration, not a reference to resolve)
      this.next(); // ::> | references
    }
    return this.qnameRef(el, "end", false, true);
  }

  private parseBind(startTok: Token, modifiers: string[]): SysMLElement {
    this.next(); // bind | binding
    const el = createElement("bind", startTok.start);
    el.modifiers = modifiers;
    // KerML allows a multiplicity on the binding connector itself: `binding [1] bind …`
    if (this.at("[")) el.multiplicity = this.parseMultiplicity();
    // optional name part for `binding b bind x = y` / `binding b : AB bind …`
    if (
      this.atIdentifier() &&
      !["=", ".", "[", "::"].includes(this.peek(1).text)
    ) {
      const t = this.next();
      el.name = unquoteName(t.text);
      el.nameStart = t.start;
      el.nameEnd = t.end;
      if (this.eat(":")) {
        el.typedBy.push(this.qnameRef(el, "type", false, true));
        while (this.eat(",")) el.typedBy.push(this.qnameRef(el, "type", false, true));
      }
    }
    this.eat("bind");
    this.eat("of"); // `binding ab of a = b`
    if (this.at("[")) this.parseMultiplicity(); // `bind [0..*] x = …`
    const a = this.qnameRef(el, "end", false, true);
    const ends: ConnectionEnd[] = [{ path: a }];
    if (this.eat("=")) {
      if (this.at("[")) this.parseMultiplicity();
      ends.push({ path: this.qnameRef(el, "end", false, true) });
    }
    el.ends = ends;
    this.parseBodyOrSemi(el);
    return el;
  }

  /** flow [name] [of Item] from a.b to c.d; */
  private parseFlow(startTok: Token, modifiers: string[]): SysMLElement {
    this.next(); // flow
    const el = createElement("flow", startTok.start);
    el.modifiers = modifiers;
    this.takePendingDoc(el);
    if (this.at("def")) {
      // `flow def X { ... }`
      this.next();
      return this.parseDeclarationTail(el, "flow def" as ElementKind, startTok);
    }
    // optional name: `flow fuelFlow from …` / `flow f : FuelFlow from …`
    if (
      this.atNameToken() &&
      ["from", "of", ":", ":>", ":>>", "subsets", "redefines", "[", "{", ";"].includes(this.peek(1).text)
    ) {
      const t = this.next();
      el.name = unquoteName(t.text);
      el.nameStart = t.start;
      el.nameEnd = t.end;
    }
    // relationship clauses — a flow may be a feature usage: `flow :>> pm : MT { … }`
    for (;;) {
      if (this.eat(":>>") || this.eat("redefines")) {
        el.redefines.push(this.qnameRef(el, "redefine", false, true));
        continue;
      }
      if (this.eat(":>") || this.eat("specializes") || this.eat("subsets")) {
        el.specializes.push(this.qnameRef(el, "specialize", false, true));
        while (this.eat(",")) el.specializes.push(this.qnameRef(el, "specialize", false, true));
        continue;
      }
      if (this.eat(":")) {
        el.typedBy.push(this.qnameRef(el, "type", false, true));
        while (this.eat(",")) el.typedBy.push(this.qnameRef(el, "type", false, true));
        continue;
      }
      if (this.at("[")) {
        el.multiplicity = this.parseMultiplicity();
        continue;
      }
      if (this.at("ordered") || this.at("nonunique") || this.at("non-unique") || this.at("parallel")) {
        el.modifiers.push(this.next().text);
        continue;
      }
      break;
    }
    if (this.eat("of")) {
      // payload may be declared as `name : Type`
      if (this.atIdentifier() && this.peek(1).text === ":") {
        this.next(); // payload name
        this.next(); // ':'
      }
      el.typedBy.push(this.qnameRef(el, "type", false, true));
      if (this.at("[")) el.multiplicity = this.parseMultiplicity();
    }
    const ends: ConnectionEnd[] = [];
    if (this.eat("from")) {
      ends.push({ path: this.qnameRef(el, "end", false, true) });
      if (this.expect("to", "flow")) ends.push({ path: this.qnameRef(el, "end", false, true) });
    } else if (this.atIdentifier()) {
      // shorthand: `flow tank.out to engine.in;`
      ends.push({ path: this.qnameRef(el, "end", false, true) });
      if (this.eat("to")) ends.push({ path: this.qnameRef(el, "end", false, true) });
    }
    el.ends = ends;
    // bound value: `message :>> setSpeedMessage = a.b.c;`
    if (this.at("=") || this.at(":=")) {
      this.next();
      this.captureValue(el);
    }
    this.parseBodyOrSemi(el);
    return el;
  }

  /** perform action x / exhibit state s / satisfy requirement r / event occurrence ... */
  private parseReferenceUsage(kw: string, startTok: Token, modifiers: string[]): SysMLElement {
    this.next(); // keyword
    const kindMap: Record<string, ElementKind> = {
      perform: "perform",
      exhibit: "exhibit",
      satisfy: "satisfy",
      include: "perform",
      verify: "satisfy",
      allocate: "allocation",
      expose: "import",
      event: "event",
    };
    const el = createElement(kindMap[kw] ?? "unknown", startTok.start);
    el.modifiers = [...modifiers, kw];
    this.takePendingDoc(el);
    // optional sub-keyword: action / state / requirement / use case ...
    const t = this.peek();
    if (t.type === "keyword" && DEF_KINDS.has(t.text)) this.next();
    else if (this.at("use")) {
      this.next();
      this.eat("case");
    }
    if (kw === "allocate") {
      const ends: ConnectionEnd[] = [{ path: this.qnameRef(el, "end", false, true) }];
      if (this.eat("to")) ends.push({ path: this.qnameRef(el, "end", false, true) });
      el.ends = ends;
      this.parseBodyOrSemi(el);
      return el;
    }
    const t2 = this.peek();
    let targetEnd = this.qnameEnd;
    // anonymous reference usage: `event occurrence :>> x = …` has no target name
    if (this.atNameToken()) {
      el.target = this.parseQualifiedName(/*allowStar*/ kw === "expose", /*allowDots*/ true);
      targetEnd = this.qnameEnd;
      el.name = el.target;
      el.nameStart = t2.start;
      el.nameEnd = t2.end;
    }
    // optional typing: `exhibit state b : Behavior;` – then it's a declaration
    let typed = false;
    if (this.eat(":")) {
      typed = true;
      el.typedBy.push(this.qnameRef(el, "type", false, true));
      while (this.eat(",")) el.typedBy.push(this.qnameRef(el, "type", false, true));
    }
    // optional multiplicity / specializations:
    // `perform action takePicture[*] :> PictureTaking::takePicture;`
    for (;;) {
      if (this.at("[")) {
        el.multiplicity = this.parseMultiplicity();
        continue;
      }
      if (this.at("parallel") || this.at("ordered") || this.at("nonunique")) {
        el.modifiers.push(this.next().text);
        continue;
      }
      if (
        this.eat(":>") || this.eat("specializes") || this.eat("subsets") ||
        this.eat("::>") || this.eat("references")
      ) {
        el.specializes.push(this.qnameRef(el, "specialize", false, true));
        while (this.eat(",")) el.specializes.push(this.qnameRef(el, "specialize", false, true));
        continue;
      }
      if (this.eat(":>>") || this.eat("redefines")) {
        el.redefines.push(this.qnameRef(el, "redefine", false, true));
        while (this.eat(",")) el.redefines.push(this.qnameRef(el, "redefine", false, true));
        continue;
      }
      break;
    }
    // optional bound value: `event occurrence x = port.received;`
    // or default value: `event occurrence e [1] default thisConnection.start { … }`
    if (this.at("=") || this.at(":=") || this.at("default")) {
      this.next();
      this.eat("=");
      this.captureValue(el);
    }
    // without typing / specialization, the name references an existing element
    if (!typed && !el.specializes.length && !el.redefines.length && kw !== "event" && el.target) {
      el.refs.push({ kind: "target", name: el.target, start: t2.start, end: targetEnd });
    }
    // optional `by` clause for satisfy
    if (this.eat("by")) {
      el.ends = [{ path: el.target ?? "" }, { path: this.qnameRef(el, "end", false, true) }];
    }
    this.parseBodyOrSemi(el);
    return el;
  }

  /** transition / succession: `transition t first a accept e if g then b;` */
  private parseTransition(startTok: Token, modifiers: string[]): SysMLElement {
    const kw = this.next(); // transition | succession | first
    const el = createElement("transition", startTok.start);
    el.modifiers = modifiers;
    this.takePendingDoc(el);
    el.transition = {};
    if (this.at("all")) el.modifiers.push(this.next().text); // `succession all [*] …`
    if (kw.text !== "first" && this.atIdentifier() && this.peek(1).text !== ".") {
      const lookahead = this.peek(1).text;
      if (["first", "then", "accept", "if"].includes(lookahead) || this.peek(1).type === "punct") {
        const t = this.next();
        el.name = unquoteName(t.text);
        el.nameStart = t.start;
        el.nameEnd = t.end;
      }
    }
    // optional typing: `succession : HappensJustBefore first a then b;`
    if (this.eat(":")) {
      el.typedBy.push(this.qnameRef(el, "type", false, true));
      while (this.eat(",")) el.typedBy.push(this.qnameRef(el, "type", false, true));
    }
    // KerML relationship clauses before `first`: `succession redefines p : T [1] first …`
    for (;;) {
      if (this.eat(":>>") || this.eat("redefines")) {
        el.redefines.push(this.qnameRef(el, "redefine", false, true));
        continue;
      }
      if (this.eat(":>") || this.eat("specializes") || this.eat("subsets")) {
        el.specializes.push(this.qnameRef(el, "specialize", false, true));
        continue;
      }
      if (this.eat(":") || this.eat("typed")) {
        this.eat("by");
        el.typedBy.push(this.qnameRef(el, "type", false, true));
        continue;
      }
      if (this.at("[")) {
        el.multiplicity = this.parseMultiplicity();
        continue;
      }
      break;
    }
    if (kw.text === "first" || this.eat("first")) {
      if (this.at("[")) this.parseMultiplicity(); // `first [n] source`
      el.transition.source = this.qnameRef(el, "end", false, true);
    } else if (this.atNameToken() && !this.at("then")) {
      // implicit first: `succession [n] source then [n] target`
      el.transition.source = this.qnameRef(el, "end", false, true);
    }
    if (this.eat("accept")) {
      // `accept sig : Signal` declares a payload typed Signal;
      // `accept Signal` references the signal type directly
      const trigStart = this.peek().start;
      if (this.atIdentifier()) {
        const nameTok = this.peek();
        const name = this.parseQualifiedName(false, true);
        if (this.eat(":")) {
          this.qnameRef(el, "type", false, true);
        } else {
          el.refs.push({ kind: "target", name, start: nameTok.start, end: this.qnameEnd });
        }
        // optional `via port`
        if (this.eat("via")) this.qnameRef(el, "end", false, true);
        el.transition.trigger = this.src.slice(trigStart, this.prevEnd()).trim();
      } else {
        el.transition.trigger = this.captureUntil(["if", "then", ";", "{"]);
      }
    }
    if (this.eat("if")) {
      el.transition.guard = this.captureUntil(["then", ";", "{"]);
    }
    if (this.eat("do")) {
      // effect action (e.g. `do send Cmd via port`), kept as opaque text
      this.captureUntil(["then", ";", "{"]);
    }
    if (this.eat("then")) {
      if (this.at("[")) this.parseMultiplicity(); // `then [n] target`
      el.transition.target = this.qnameRef(el, "end", false, true);
    }
    this.parseBodyOrSemi(el);
    return el;
  }

  /** entry/exit/do inside states */
  private parseStateAction(kw: string, startTok: Token, modifiers: string[]): SysMLElement {
    this.next();
    const el = createElement("action", startTok.start);
    el.modifiers = [...modifiers, kw];
    // e.g. `entry action initialize { ... }` or `entry; ` or `do action x;`
    if (this.at("action")) {
      this.next();
      return this.parseDeclarationTail(el, "action", startTok);
    }
    if (this.at("send") || this.at("accept") || this.at("assign")) {
      // `do send X via port;` / `entry assign x := 0;` – opaque effect text
      this.captureUntil([";", "{"]);
    } else if (this.atIdentifier()) {
      el.target = this.parseFeatureChain();
    } else if (this.peek().type === "keyword" && !this.at(";") && !this.at("{")) {
      // any other control keyword used as an entry/exit/do effect — keep opaque
      this.captureUntil([";", "{"]);
    }
    this.parseBodyOrSemi(el);
    return el;
  }

  /** statements we don't model in detail – capture as unknown, opaque body */
  private parseOpaqueStatement(startTok: Token): SysMLElement | undefined {
    const el = createElement("unknown", startTok.start);
    // Capture the whole statement, including expressions that mix balanced
    // bodies with trailing operators (`return a + (xs->reduce { … } ?? 0);`,
    // `accept Sig { … }`). captureExpression() balances and absorbs lambda
    // bodies; a remaining non-lambda `{ … }` is the statement's own body.
    let text = this.captureExpression();
    while (this.at("{")) {
      el.value = this.captureBracedBody();
      text += " " + this.captureExpression();
    }
    el.name = text.trim().slice(0, 60);
    this.eat(";");
    el.end = this.prevEnd();
    return el.name || el.value ? el : undefined;
  }

  /** Consume `{ ... }` keeping the raw text (for expression bodies). */
  private captureBracedBody(): string {
    const open = this.next(); // '{'
    let depth = 1;
    let end = open.end;
    while (depth > 0 && this.peek().type !== "eof") {
      const t = this.next();
      if (t.text === "{") depth++;
      if (t.text === "}") depth--;
      end = t.end;
    }
    return this.src.slice(open.end, Math.max(open.end, end - 1)).trim();
  }

  /** Standard declaration: kind already consumed. */
  private parseDeclaration(
    kind: ElementKind,
    modifiers: string[],
    direction: SysMLElement["direction"],
    startTok: Token,
    implicitKind = false
  ): SysMLElement {
    const el = createElement(kind, startTok.start);
    el.modifiers = modifiers;
    el.direction = direction;
    if (implicitKind) {
      // identifier-only feature, e.g. enum literal `red;` or `x : Real;`
    }
    return this.parseDeclarationTail(el, kind, startTok);
  }

  private parseDeclarationTail(el: SysMLElement, kind: ElementKind, _startTok: Token): SysMLElement {
    el.kind = kind;
    this.takePendingDoc(el);
    // KerML `[kind] all Name ...` — `all` quantifies the declared classifier/feature
    if (this.at("all")) el.modifiers.push(this.next().text);
    this.parseIdentification(el);

    // relationships
    for (;;) {
      if (this.eat(":") || this.eat("defined") || this.eat("typed")) {
        this.eat("by");
        el.typedBy.push(this.qnameRef(el, "type", false, true));
        while (this.eat(",")) el.typedBy.push(this.qnameRef(el, "type", false, true));
        continue;
      }
      // KerML `conjugates B` — conjugation specializes its target
      if (this.eat("conjugates") || this.eat("conjugate")) {
        el.specializes.push(this.qnameRef(el, "specialize", false, true));
        continue;
      }
      // KerML conjugation operator `feature g ~ B::f;` (parse-only)
      if (this.eat("~")) {
        this.parseQualifiedName(false, true);
        continue;
      }
      // connector tuple ends: `connector c : ProductSelection (a, b, c)`
      if (this.at("(")) {
        let depth = 0;
        do {
          const t = this.next();
          if (t.text === "(") depth++;
          else if (t.text === ")") depth--;
        } while (depth > 0 && this.peek().type !== "eof");
        continue;
      }
      // KerML feature relationships kept as parse-only (consumed, not resolved)
      // so the standard library parses without spurious "unresolved" noise.
      if (
        this.eat("chains") || this.eat("crosses") || this.eat("featured") ||
        this.eat("inverse") || this.eat("disjoint") || this.eat("unions") ||
        this.eat("intersects") || this.eat("differences")
      ) {
        this.eat("by");   // `featured by`
        this.eat("of");   // `inverse of`
        this.eat("from"); // `disjoint from`
        this.parseQualifiedName(false, true);
        while (this.eat(",")) this.parseQualifiedName(false, true);
        continue;
      }
      if (this.eat(":>") || this.eat("specializes") || this.eat("subsets")) {
        el.specializes.push(this.qnameRef(el, "specialize", false, true));
        while (this.eat(",")) el.specializes.push(this.qnameRef(el, "specialize", false, true));
        continue;
      }
      if (this.eat(":>>") || this.eat("redefines")) {
        el.redefines.push(this.qnameRef(el, "redefine", false, true));
        while (this.eat(",")) el.redefines.push(this.qnameRef(el, "redefine", false, true));
        continue;
      }
      if (this.eat("::>") || this.eat("references")) {
        el.specializes.push(this.qnameRef(el, "specialize", false, true));
        continue;
      }
      if (this.at("[")) {
        el.multiplicity = this.parseMultiplicity();
        continue;
      }
      // collection modifiers after the multiplicity: [4] ordered nonunique
      if (this.at("ordered") || this.at("nonunique") || this.at("non-unique") || this.at("parallel")) {
        el.modifiers.push(this.next().text);
        continue;
      }
      // `end <endName> [mult] item <feature> : T` — a connection end that is
      // itself a typed feature; absorb the inner kind + name into this element.
      if (
        el.name &&
        this.peek().type === "keyword" &&
        (DEF_KINDS.has(this.peek().text) || KERML_KINDS.has(this.peek().text))
      ) {
        el.kind = this.next().text as ElementKind;
        if (this.atNameToken()) {
          const t = this.next();
          el.name = unquoteName(t.text);
          el.nameStart = t.start;
          el.nameEnd = t.end;
        }
        continue;
      }
      break;
    }

    // metadata usage `about` targets: `metadata X : Issue about a, b { … }`
    if (this.eat("about")) {
      do {
        this.qnameRef(el, "target", false, true);
      } while (this.eat(","));
    }

    // KerML connector ends: `connector c from a to b;` / `… from [1] self to [*] x`
    // / `from [1] src references tgt`
    if (this.at("from")) {
      this.next();
      if (this.at("[")) this.parseMultiplicity();
      const ends: ConnectionEnd[] = [{ path: this.qnameRef(el, "end", false, true) }];
      while (this.eat("to") || this.eat("references") || this.eat(",")) {
        if (this.at("[")) this.parseMultiplicity();
        ends.push({ path: this.qnameRef(el, "end", false, true) });
      }
      el.ends = ends;
    }

    // `connection c : Type connect a to b` (after name / typing / multiplicity)
    if ((kind === "connection" || kind === "interface" || kind === "allocation") && this.at("connect")) {
      this.next();
      return this.parseConnectBody(kind, { start: el.start } as Token, el.modifiers, el);
    }
    // `allocation a : T allocate x to y { ... }`
    if (kind === "allocation" && this.at("allocate")) {
      this.next();
      return this.parseConnectBody(kind, { start: el.start } as Token, el.modifiers, el);
    }
    // accept / send action shorthand: `action trigger accept cmd : Cmd via port;`
    // (kept as opaque text)
    if ((kind === "action" || kind === "action def") && (this.at("accept") || this.at("send"))) {
      this.captureUntil([";", "{"]);
    }

    // value part
    if (this.at("=") || this.at(":=") || this.at("default")) {
      this.next();
      this.eat("="); // `default =`
      this.captureValue(el);
    }

    this.parseBodyOrSemi(el);
    return el;
  }

  /** <short> name */
  private parseIdentification(el: SysMLElement): void {
    if (this.eat("<")) {
      // a short name may itself be a keyword (`<var>`, `<nat>`) or a quoted
      // name (`<'nat/s'>`), not only a plain identifier
      if (this.atNameToken()) el.shortName = unquoteName(this.next().text);
      this.eat(">");
    }
    if (this.atDeclName()) {
      const t = this.next();
      el.name = unquoteName(t.text);
      el.nameStart = t.start;
      el.nameEnd = t.end;
    }
  }

  private parseMultiplicity(): string {
    const start = this.peek().start;
    this.eat("[");
    let depth = 1;
    while (depth > 0 && this.peek().type !== "eof") {
      const t = this.next();
      if (t.text === "[") depth++;
      if (t.text === "]") depth--;
    }
    const end = this.prevEnd();
    return this.src.slice(start, end);
  }

  /** body `{ ... }` or `;` */
  private parseBodyOrSemi(el: SysMLElement): void {
    // constraint / calc / KerML expression bodies contain expressions, not
    // member elements — keep them as opaque text.
    if (
      this.at("{") &&
      (el.kind === "constraint" || el.kind === "constraint def" ||
        el.kind === "calc" || el.kind === "calc def" ||
        el.kind === "expr" || el.kind === "predicate")
    ) {
      if (el.value === undefined) {
        const start = this.peek().start;
        el.value = this.captureBracedBody();
        el.valueExpr = parseBodyExpression(el.value, start);
      }
      el.end = this.prevEnd();
      return;
    }
    if (this.eat("{")) {
      this.parseMembers(el);
      this.expect("}", `body of ${el.kind} ${el.name ?? ""}`);
    } else if (!this.eat(";")) {
      const t = this.peek();
      this.error(`';' or '{' expected`, t.start, t.end);
      this.recover();
    }
    el.end = this.prevEnd();
  }

  /**
   * In a name/reference position a KerML keyword may actually be the *name* of a
   * referenced feature (the standard library has features literally called
   * `step`, `feature`, `type`, …). Treat those keywords as identifiers here so
   * references like `subsets step` resolve instead of erroring.
   */
  private atNameToken(offset = 0): boolean {
    const t = this.peek(offset);
    if (t.type === "identifier") return true;
    return t.type === "keyword" && !NON_NAME_KEYWORDS.has(t.text);
  }

  /**
   * Are we at a token that can be the *declared name* of an element? Plain
   * identifiers always qualify. A keyword qualifies only if it never
   * introduces a tail clause (`DECL_CLAUSE_KEYWORDS`) *and* is not immediately
   * followed by another name — if it is, the keyword is acting as a kind or
   * clause (`accept cmd`, `subsets Foo`) rather than as the name. This lets
   * features literally called `entry` / `do` / `type` / `merge` / `while`
   * (as in the OMG models) parse, without swallowing clause keywords.
   */
  private atDeclName(): boolean {
    if (this.atIdentifier()) return true;
    const t = this.peek();
    if (t.type !== "keyword") return false;
    if (NON_NAME_KEYWORDS.has(t.text) || DECL_CLAUSE_KEYWORDS.has(t.text)) return false;
    return !this.atNameToken(1);
  }

  /** A::B::C  (optionally ending with ::* for imports, optionally with dots) */
  private parseQualifiedName(allowStar = false, allowDots = false): string {
    // conjugated type reference: ~PortType
    let prefix = "";
    if (this.at("~")) {
      this.next();
      prefix = "~";
    }
    const parts: string[] = [];
    // KerML root-namespace qualifier: `$::Objects::Object` starts at the global
    // root `$`, then continues with `::`-separated segments
    if (this.at("$")) {
      this.next();
      parts.push("$");
    } else {
      if (!this.atNameToken()) {
        const t = this.peek();
        this.error("name expected", t.start, t.end);
        return "";
      }
      parts.push(unquoteName(this.next().text));
    }
    for (;;) {
      if (this.at("::")) {
        const save = this.pos;
        this.next();
        if (allowStar && (this.at("*") || this.at("**"))) {
          parts.push(this.next().text);
          // allow ::** recursive import
          continue;
        }
        if (this.atNameToken()) {
          parts.push(unquoteName(this.next().text));
          continue;
        }
        this.pos = save;
        break;
      }
      if (allowDots && this.at(".") && this.atNameToken(1)) {
        this.next();
        parts.push("." + unquoteName(this.next().text));
        continue;
      }
      break;
    }
    this.qnameEnd = this.prevEnd();
    return prefix + parts.join("::").replace(/::\./g, ".");
  }

  /** Parse a qualified name and record it as a reference on the element. */
  private qnameRef(
    el: SysMLElement,
    kind: Ref["kind"],
    allowStar = false,
    allowDots = false
  ): string {
    const start = this.peek().start;
    const name = this.parseQualifiedName(allowStar, allowDots);
    if (name) {
      el.refs.push({ kind, name, start, end: Math.max(this.qnameEnd, start + 1) });
    }
    return name;
  }

  /** a.b.c style feature chain (also accepts :: qualified prefixes) */
  private parseFeatureChain(): string {
    return this.parseQualifiedName(false, true);
  }

  /**
   * Capture a value / expression up to `;` (or the enclosing `}`) at depth 0,
   * balancing `()` and `[]`. A `{` at depth 0 is absorbed only when it is a
   * lambda body — i.e. the value begins with it or the expression already used a
   * higher-order call `->` (`x->reduce { in s; in t; s + t }`). Otherwise the
   * `{` opens the element's own body, so capture stops before it. Expressions
   * stay opaque text — this only fixes where a value ends.
   */
  /** Capture a value expression's raw text and parse it into an AST. */
  private captureValue(el: SysMLElement): void {
    const start = this.peek().start;
    el.value = this.captureExpression();
    el.valueExpr = parseExpression(el.value, start);
  }

  private captureExpression(): string {
    const startTok = this.peek();
    let depth = 0;
    let endOffset = startTok.start;
    let sawArrow = false;
    let prev = "";
    while (this.peek().type !== "eof") {
      const t = this.peek();
      if (depth === 0) {
        if (t.text === ";" || t.text === "}") break;
        // a `{` opens the element body unless it is a lambda — the value starts
        // with it, or follows a higher-order call (`->reduce { … }`, `x.{ … }`)
        if (t.text === "{" && !sawArrow && prev !== "." && endOffset !== startTok.start) break;
      }
      if (t.text === "->") sawArrow = true;
      if (t.text === "(" || t.text === "[" || t.text === "{") depth++;
      else if (t.text === ")" || t.text === "]" || t.text === "}") depth--;
      this.next();
      prev = t.text;
      endOffset = t.end;
    }
    return this.src.slice(startTok.start, endOffset).trim();
  }

  /** Capture raw source text until one of the stop tokens (at depth 0). */
  private captureUntil(stops: string[]): string {
    const startTok = this.peek();
    let depth = 0;
    let endOffset = startTok.start;
    while (this.peek().type !== "eof") {
      const t = this.peek();
      if (depth === 0 && stops.includes(t.text)) break;
      if (t.text === "(" || t.text === "[") depth++;
      if (t.text === ")" || t.text === "]") {
        if (depth === 0) break;
        depth--;
      }
      this.next();
      endOffset = t.end;
    }
    return this.src.slice(startTok.start, endOffset).trim();
  }

  private prevEnd(): number {
    return this.pos > 0 ? this.tokens[this.pos - 1].end : 0;
  }

  private takePendingDoc(el: SysMLElement): void {
    if (this.pendingDoc && !el.doc) {
      el.doc = this.pendingDoc;
      this.pendingDoc = undefined;
    }
    if (this.pendingMeta.length) {
      el.refs.push(...this.pendingMeta);
      this.pendingMeta = [];
    }
  }
}

function stripCommentBody(text: string): string {
  return text
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .join("\n")
    .trim();
}

export function parseSysML(src: string): ParseResult {
  return new Parser(src).parse();
}
