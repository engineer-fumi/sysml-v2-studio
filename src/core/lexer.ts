/** Tokenizer for the SysML v2 textual notation (pragmatic subset). */

export type TokenType =
  | "identifier"
  | "keyword"
  | "number"
  | "string"
  | "punct"
  | "doc-comment"
  | "comment"
  | "eof";

export interface Token {
  type: TokenType;
  text: string;
  start: number;
  end: number;
}

export const KEYWORDS = new Set([
  "about", "abstract", "accept", "action", "actor", "after", "alias", "all",
  "allocate", "allocation", "analysis", "and", "as", "assert", "assign",
  "assume", "at", "attribute", "bind", "binding", "by", "calc", "case",
  "comment", "concern", "connect", "connection", "constraint", "decide",
  "def", "default", "defined", "dependency", "derived", "do", "doc", "else",
  "end", "entry", "enum", "event", "exhibit", "exit", "expose", "filter",
  "first", "flow", "for", "fork", "frame", "from", "hastype", "if", "implies",
  "import", "in", "include", "individual", "inout", "interface", "istype",
  "item", "join", "language", "library", "loop", "merge", "message",
  "metadata", "namespace", "non-unique", "nonunique", "not", "null", "objective",
  "occurrence", "of", "or", "ordered", "out", "package", "parallel", "part",
  "perform", "port", "private", "protected", "public", "readonly", "redefines",
  "ref", "references", "render", "rendering", "rep", "require", "requirement",
  "return", "satisfy", "send", "snapshot", "specializes", "stakeholder",
  "standard", "state", "subject", "subsets", "succession", "terminate", "then",
  "timeslice", "to", "transition", "until", "use", "variant", "variation",
  "verification", "verify", "via", "view", "viewpoint", "when", "while", "xor",
  "true", "false",
]);

const PUNCT2 = [":>>", "::>", "..", "::", ":>", ":=", "==", "!=", "<=", ">=", "->", "=>", "**"];

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    // whitespace
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }

    // line comment
    if (c === "/" && src[i + 1] === "/") {
      const start = i;
      while (i < n && src[i] !== "\n") i++;
      tokens.push({ type: "comment", text: src.slice(start, i), start, end: i });
      continue;
    }

    // block comment (KerML notes /* ... */ are also comments in the model;
    // we surface them as doc-comment so the parser can attach them)
    if (c === "/" && src[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      tokens.push({ type: "doc-comment", text: src.slice(start, i), start, end: i });
      continue;
    }

    // string literal
    if (c === '"') {
      const start = i;
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\") i++;
        i++;
      }
      i = Math.min(n, i + 1);
      tokens.push({ type: "string", text: src.slice(start, i), start, end: i });
      continue;
    }

    // quoted (unrestricted) name: 'some name'
    if (c === "'") {
      const start = i;
      i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === "\\") i++;
        i++;
      }
      i = Math.min(n, i + 1);
      tokens.push({ type: "identifier", text: src.slice(start, i), start, end: i });
      continue;
    }

    // number
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9_.eE+-]/.test(src[i])) {
        // stop ".." range operator from being eaten by a number
        if (src[i] === "." && src[i + 1] === ".") break;
        if ((src[i] === "+" || src[i] === "-") && !/[eE]/.test(src[i - 1])) break;
        i++;
      }
      tokens.push({ type: "number", text: src.slice(start, i), start, end: i });
      continue;
    }

    // identifier / keyword
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_-]/.test(src[i])) {
        // allow "non-unique" but don't eat "a-b" arithmetic; SysML names
        // can't contain '-' except via keywords, so only continue over '-'
        // when it forms "non-unique"
        if (src[i] === "-" && src.slice(start, i) !== "non") break;
        i++;
      }
      const text = src.slice(start, i);
      tokens.push({
        type: KEYWORDS.has(text) ? "keyword" : "identifier",
        text,
        start,
        end: i,
      });
      continue;
    }

    // multi-char punctuation
    const two = src.slice(i, i + 3);
    const matched = PUNCT2.find((p) => two.startsWith(p));
    if (matched) {
      tokens.push({ type: "punct", text: matched, start: i, end: i + matched.length });
      i += matched.length;
      continue;
    }

    // single char punct
    tokens.push({ type: "punct", text: c, start: i, end: i + 1 });
    i++;
  }

  tokens.push({ type: "eof", text: "", start: n, end: n });
  return tokens;
}

/** Strip quotes from a quoted name. */
export function unquoteName(text: string): string {
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1);
  }
  return text;
}
