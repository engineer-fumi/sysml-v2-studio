import * as vscode from "vscode";
import { SysMLElement, elementLabel, qualifiedName } from "../core/ast";
import { KEYWORDS } from "../core/lexer";
import { Resolver } from "../core/resolve";
import { SemanticRule, validateFile } from "../core/validate";
import { ModelIndex, elementAt } from "./modelIndex";

const SELECTOR: vscode.DocumentSelector = { language: "sysml" };

// ---- diagnostics (syntax + semantic validation) --------------------------

/** offset -> Position without opening a TextDocument */
class LineMap {
  private starts: number[] = [0];
  constructor(source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") this.starts.push(i + 1);
    }
  }
  positionAt(offset: number): vscode.Position {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return new vscode.Position(lo, offset - this.starts[lo]);
  }
}

type SeveritySetting = "error" | "warning" | "information" | "off";

function severityOf(setting: SeveritySetting): vscode.DiagnosticSeverity | undefined {
  switch (setting) {
    case "error": return vscode.DiagnosticSeverity.Error;
    case "warning": return vscode.DiagnosticSeverity.Warning;
    case "information": return vscode.DiagnosticSeverity.Information;
    default: return undefined;
  }
}

export function registerDiagnostics(
  context: vscode.ExtensionContext,
  index: ModelIndex
): void {
  const collection = vscode.languages.createDiagnosticCollection("sysml");
  context.subscriptions.push(collection);

  const runAll = () => {
    const cfg = vscode.workspace.getConfiguration("sysml.validation");
    const sevByRule: Record<SemanticRule, vscode.DiagnosticSeverity | undefined> = {
      unresolved: severityOf(cfg.get<SeveritySetting>("unresolvedReferences", "warning")),
      duplicate: severityOf(cfg.get<SeveritySetting>("duplicateNames", "error")),
      conformance: severityOf(cfg.get<SeveritySetting>("typeConformance", "warning")),
      shadowing: severityOf(cfg.get<SeveritySetting>("shadowing", "warning")),
      importVisibility: severityOf(cfg.get<SeveritySetting>("importVisibility", "warning")),
    };

    const resolver = new Resolver(index.combinedRoot(/*includeBuiltin*/ true));

    // global scope: top-level names per file (incl. the bundled library)
    const topLevelOwners = new Map<string, string[]>();
    for (const f of index.all(true)) {
      for (const c of f.result.root.children) {
        if (!c.name) continue;
        const owners = topLevelOwners.get(c.name) ?? [];
        owners.push(f.builtin ? "標準ライブラリ" : f.name);
        topLevelOwners.set(c.name, owners);
      }
    }

    for (const file of index.all(false)) {
      const lines = new LineMap(file.source);
      const diagnostics: vscode.Diagnostic[] = [];

      const push = (
        start: number,
        end: number,
        message: string,
        severity: vscode.DiagnosticSeverity,
        code?: string
      ) => {
        const d = new vscode.Diagnostic(
          new vscode.Range(lines.positionAt(start), lines.positionAt(end)),
          message,
          severity
        );
        d.source = "sysml";
        if (code) d.code = code;
        diagnostics.push(d);
      };

      for (const e of file.result.errors) {
        push(e.start, e.end, e.message, vscode.DiagnosticSeverity.Error);
      }

      const semantic = validateFile(file.result.root, resolver, {
        unresolved: !!sevByRule.unresolved,
        duplicates: !!sevByRule.duplicate,
        conformance: !!sevByRule.conformance,
        shadowing: !!sevByRule.shadowing,
        importVisibility: !!sevByRule.importVisibility,
      });
      for (const s of semantic) {
        const severity = sevByRule[s.rule];
        if (severity === undefined) continue;
        push(s.start, s.end, s.message, severity, s.rule);
      }

      // top-level names shadowing the global scope (other files / stdlib)
      if (sevByRule.duplicate !== undefined) {
        for (const c of file.result.root.children) {
          if (!c.name || c.nameStart === undefined) continue;
          const owners = topLevelOwners.get(c.name) ?? [];
          if (owners.length > 1) {
            const others = owners.filter((o) => o !== file.name);
            push(
              c.nameStart,
              c.nameEnd ?? c.nameStart + c.name.length,
              `トップレベル要素 '${c.name}' はグローバルスコープで衝突しています (${[...new Set(others)].join(", ")})`,
              sevByRule.duplicate,
              "duplicate"
            );
          }
        }
      }

      collection.set(file.uri, diagnostics);
    }
  };

  runAll();
  context.subscriptions.push(
    index.onDidChangeModel(runAll),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("sysml.validation")) runAll();
    })
  );
}

// ---- completion --------------------------------------------------------

interface Snippet {
  label: string;
  insert: string;
  detail: string;
}

const SNIPPETS: Snippet[] = [
  { label: "package", insert: "package ${1:Name} {\n\t$0\n}", detail: "package 定義" },
  { label: "part def", insert: "part def ${1:Name} {\n\t$0\n}", detail: "part 定義" },
  { label: "part", insert: "part ${1:name} : ${2:Type};", detail: "part 使用" },
  { label: "attribute", insert: "attribute ${1:name} : ${2:Real};", detail: "属性" },
  { label: "port def", insert: "port def ${1:Name} {\n\t$0\n}", detail: "port 定義" },
  { label: "port", insert: "port ${1:name} : ${2:PortType};", detail: "port 使用" },
  { label: "item def", insert: "item def ${1:Name};", detail: "item 定義" },
  { label: "action def", insert: "action def ${1:Name} {\n\t$0\n}", detail: "action 定義" },
  { label: "state def", insert: "state def ${1:Name} {\n\t$0\n}", detail: "状態機械定義" },
  { label: "state", insert: "state ${1:name};", detail: "状態" },
  {
    label: "transition",
    insert: "transition ${1:name} first ${2:source} accept ${3:trigger} then ${4:target};",
    detail: "状態遷移",
  },
  {
    label: "requirement def",
    insert: "requirement def ${1:Name} {\n\tdoc /* ${2:説明} */\n\t$0\n}",
    detail: "要求定義",
  },
  { label: "connect", insert: "connect ${1:a.port} to ${2:b.port};", detail: "接続" },
  { label: "bind", insert: "bind ${1:a} = ${2:b};", detail: "束縛" },
  { label: "flow", insert: "flow of ${1:Item} from ${2:a.out} to ${3:b.in};", detail: "フロー" },
  { label: "import", insert: "import ${1:Package}::*;", detail: "インポート" },
  { label: "doc", insert: "doc /* ${1:説明} */", detail: "ドキュメント" },
  { label: "perform action", insert: "perform action ${1:name};", detail: "アクション実行" },
  { label: "exhibit state", insert: "exhibit state ${1:name} : ${2:Behavior};", detail: "状態の表出" },
  { label: "satisfy requirement", insert: "satisfy requirement ${1:req} by ${2:element};", detail: "要求の充足" },
  { label: "use case def", insert: "use case def ${1:Name} {\n\t$0\n}", detail: "ユースケース定義" },
];

export function registerCompletion(
  context: vscode.ExtensionContext,
  index: ModelIndex
): void {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems() {
      const items: vscode.CompletionItem[] = [];

      for (const s of SNIPPETS) {
        const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Snippet);
        item.insertText = new vscode.SnippetString(s.insert);
        item.detail = s.detail;
        item.sortText = "0" + s.label;
        items.push(item);
      }

      for (const kw of KEYWORDS) {
        const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
        item.sortText = "2" + kw;
        items.push(item);
      }

      for (const name of index.allNames()) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Reference);
        item.sortText = "1" + name;
        items.push(item);
      }

      return items;
    },
  };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, provider)
  );
}

// ---- document symbols (outline) -----------------------------------------

const SYMBOL_KINDS: Record<string, vscode.SymbolKind> = {
  "package": vscode.SymbolKind.Package,
  "library package": vscode.SymbolKind.Package,
  "namespace": vscode.SymbolKind.Namespace,
  "part def": vscode.SymbolKind.Class,
  "part": vscode.SymbolKind.Object,
  "attribute def": vscode.SymbolKind.Class,
  "attribute": vscode.SymbolKind.Property,
  "port def": vscode.SymbolKind.Interface,
  "port": vscode.SymbolKind.Property,
  "item def": vscode.SymbolKind.Class,
  "item": vscode.SymbolKind.Variable,
  "action def": vscode.SymbolKind.Class,
  "action": vscode.SymbolKind.Method,
  "state def": vscode.SymbolKind.Class,
  "state": vscode.SymbolKind.Enum,
  "transition": vscode.SymbolKind.Event,
  "requirement def": vscode.SymbolKind.Class,
  "requirement": vscode.SymbolKind.Object,
  "constraint def": vscode.SymbolKind.Class,
  "constraint": vscode.SymbolKind.Operator,
  "interface def": vscode.SymbolKind.Interface,
  "interface": vscode.SymbolKind.Object,
  "connection def": vscode.SymbolKind.Class,
  "connection": vscode.SymbolKind.Object,
  "connect": vscode.SymbolKind.Event,
  "bind": vscode.SymbolKind.Event,
  "flow": vscode.SymbolKind.Event,
  "enum def": vscode.SymbolKind.Enum,
  "use case def": vscode.SymbolKind.Class,
  "use case": vscode.SymbolKind.Object,
  "import": vscode.SymbolKind.Module,
  "alias": vscode.SymbolKind.Module,
};

export function registerDocumentSymbols(
  context: vscode.ExtensionContext,
  index: ModelIndex
): void {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(doc) {
      const entry = index.get(doc.uri) ?? index.indexDocument(doc);

      const toSymbol = (el: SysMLElement): vscode.DocumentSymbol | undefined => {
        const label = elementLabel(el);
        if (!label || el.kind === "doc" || el.kind === "comment") return undefined;
        const start = Math.min(el.start, doc.getText().length);
        const end = Math.min(el.end, doc.getText().length);
        const range = new vscode.Range(doc.positionAt(start), doc.positionAt(end));
        const selStart = el.nameStart !== undefined ? el.nameStart : start;
        const selEnd = el.nameEnd !== undefined ? el.nameEnd : Math.min(start + 1, end);
        const selection = new vscode.Range(doc.positionAt(selStart), doc.positionAt(selEnd));
        const sym = new vscode.DocumentSymbol(
          label,
          el.typedBy.length ? ": " + el.typedBy.join(", ") : el.kind,
          SYMBOL_KINDS[el.kind] ?? vscode.SymbolKind.Field,
          range,
          selection
        );
        sym.children = el.children
          .map(toSymbol)
          .filter((s): s is vscode.DocumentSymbol => !!s);
        return sym;
      };

      return entry.result.root.children
        .map(toSymbol)
        .filter((s): s is vscode.DocumentSymbol => !!s);
    },
  };
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, provider)
  );
}

// ---- definition ----------------------------------------------------------

function wordAt(doc: vscode.TextDocument, position: vscode.Position): string | undefined {
  const range = doc.getWordRangeAtPosition(position, /'[^']*'|[A-Za-z_][A-Za-z0-9_]*/);
  if (!range) return undefined;
  let word = doc.getText(range);
  if (word.startsWith("'") && word.endsWith("'")) word = word.slice(1, -1);
  return word;
}

export function registerDefinition(
  context: vscode.ExtensionContext,
  index: ModelIndex
): void {
  const provider: vscode.DefinitionProvider = {
    async provideDefinition(doc, position) {
      const word = wordAt(doc, position);
      if (!word) return undefined;
      const offsetAtCursor = doc.offsetAt(position);

      // scope-aware resolution first: the same name may be declared in
      // several packages, so resolve from the element under the cursor
      const entry = index.get(doc.uri) ?? index.indexDocument(doc);
      const scope = elementAt(entry.result.root, offsetAtCursor);
      if (scope) {
        const resolver = new Resolver(index.combinedRoot(true));
        const resolved = resolver.resolve(scope, word);
        if (resolved?.fileId !== undefined && resolved.nameStart !== undefined) {
          const file = index.getByFileId(resolved.fileId);
          const onOwnDecl =
            file?.uri.toString() === doc.uri.toString() &&
            resolved.nameStart <= offsetAtCursor &&
            offsetAtCursor <= (resolved.nameEnd ?? resolved.nameStart);
          if (file && !onOwnDecl) {
            const target = await vscode.workspace.openTextDocument(file.uri);
            return new vscode.Location(
              file.uri,
              new vscode.Range(
                target.positionAt(resolved.nameStart),
                target.positionAt(resolved.nameEnd ?? resolved.nameStart + 1)
              )
            );
          }
        }
      }

      // fallback: all declarations with that name across the workspace
      const decls = index.findDeclarations(word);
      const locations: vscode.Location[] = [];
      for (const { file, el } of decls) {
        // skip the declaration the cursor is already on
        const offset = doc.offsetAt(position);
        if (
          file.uri.toString() === doc.uri.toString() &&
          el.nameStart !== undefined &&
          el.nameStart <= offset &&
          offset <= (el.nameEnd ?? el.nameStart)
        ) {
          continue;
        }
        const target = await vscode.workspace.openTextDocument(file.uri);
        const start = el.nameStart ?? el.start;
        const end = el.nameEnd ?? el.start + 1;
        locations.push(
          new vscode.Location(
            file.uri,
            new vscode.Range(target.positionAt(start), target.positionAt(end))
          )
        );
      }
      return locations;
    },
  };
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(SELECTOR, provider)
  );
}

// ---- hover ----------------------------------------------------------------

export function registerHover(
  context: vscode.ExtensionContext,
  index: ModelIndex
): void {
  const provider: vscode.HoverProvider = {
    provideHover(doc, position) {
      const entry = index.get(doc.uri) ?? index.indexDocument(doc);
      const offset = doc.offsetAt(position);
      const el = elementAt(entry.result.root, offset);
      if (!el) return undefined;

      const md = new vscode.MarkdownString();
      md.appendCodeblock(
        `${el.kind} ${qualifiedName(el)}` +
          (el.typedBy.length ? ` : ${el.typedBy.join(", ")}` : "") +
          (el.specializes.length ? ` :> ${el.specializes.join(", ")}` : "") +
          (el.multiplicity ? ` ${el.multiplicity}` : ""),
        "sysml"
      );
      if (el.doc) md.appendMarkdown("\n" + el.doc);

      // also show the doc of the referenced type
      const word = wordAt(doc, position);
      if (word && word !== el.name) {
        const decl = index.findDeclarations(word)[0];
        if (decl?.el.doc) {
          md.appendMarkdown(`\n\n---\n**${word}** (${decl.el.kind}): ${decl.el.doc}`);
        }
      }
      return new vscode.Hover(md);
    },
  };
  context.subscriptions.push(vscode.languages.registerHoverProvider(SELECTOR, provider));
}
