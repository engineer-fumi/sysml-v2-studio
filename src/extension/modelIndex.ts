import * as vscode from "vscode";
import { ParseResult, SysMLElement, createElement, walk } from "../core/ast";
import { parseSysML } from "../core/parser";
import { STDLIB_FILES } from "../core/stdlib";
import { isIgnoredModelPath } from "./indexFilter";

export const BUILTIN_SCHEME = "sysml-builtin";

export interface IndexedFile {
  uri: vscode.Uri;
  /** workspace-relative display name */
  name: string;
  fileId: number;
  source: string;
  result: ParseResult;
  /** part of the bundled standard library (not user code) */
  builtin: boolean;
}

/**
 * Parses every .sysml/.kerml file in the workspace and keeps the results in
 * sync with edits, so that completion / definition / diagram can resolve
 * references across files.
 */
export class ModelIndex implements vscode.Disposable {
  private files = new Map<string, IndexedFile>();
  private nextFileId = 1;
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** fires (debounced) whenever any model file is added / changed / removed */
  readonly onDidChangeModel = this.changeEmitter.event;

  async initialize(): Promise<void> {
    // bundled standard library (ScalarValues, ISQ, SI, base defs ...)
    for (const lib of STDLIB_FILES) {
      const uri = vscode.Uri.parse(`${BUILTIN_SCHEME}:/${lib.name}`);
      this.setEntry(uri, lib.source, /*builtin*/ true);
    }

    // exclude build outputs and *hidden* directories — `.claude/worktrees`
    // holds full repo copies on other branches; indexing them duplicates every
    // top-level element and can resolve names to a stale copy (see indexFilter)
    const uris = await vscode.workspace.findFiles(
      "**/*.{sysml,kerml}",
      "{**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/test-results/**,**/.*/**}"
    );
    for (const uri of uris) {
      await this.indexUri(uri);
    }

    // open documents take precedence over on-disk content
    for (const doc of vscode.workspace.textDocuments) {
      if (this.isSysML(doc)) this.indexDocument(doc);
    }

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.isSysML(e.document)) {
          this.indexDocument(e.document);
          this.fireChanged();
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.isSysML(doc)) {
          this.indexDocument(doc);
          this.fireChanged();
        }
      })
    );

    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{sysml,kerml}");
    watcher.onDidCreate(async (uri) => {
      await this.indexUri(uri);
      this.fireChanged();
    });
    watcher.onDidChange(async (uri) => {
      // skip if the file is open (handled by onDidChangeTextDocument)
      const open = vscode.workspace.textDocuments.some(
        (d) => d.uri.toString() === uri.toString()
      );
      if (!open) {
        await this.indexUri(uri);
        this.fireChanged();
      }
    });
    watcher.onDidDelete((uri) => {
      this.files.delete(uri.toString());
      this.fireChanged();
    });
    this.disposables.push(watcher);
  }

  private isSysML(doc: vscode.TextDocument): boolean {
    if (doc.uri.scheme === BUILTIN_SCHEME) return false; // read-only library
    return doc.languageId === "sysml" || /\.(sysml|kerml)$/i.test(doc.uri.path);
  }

  private displayName(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
  }

  private async indexUri(uri: vscode.Uri): Promise<void> {
    // the watcher glob has no exclude list — drop ignored paths before reading
    if (isIgnoredModelPath(this.displayName(uri))) return;
    let source: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      source = Buffer.from(bytes).toString("utf8");
    } catch {
      return;
    }
    this.setEntry(uri, source);
  }

  indexDocument(doc: vscode.TextDocument): IndexedFile {
    return this.setEntry(doc.uri, doc.getText());
  }

  private setEntry(uri: vscode.Uri, source: string, builtin = false): IndexedFile {
    const key = uri.toString();
    const prev = this.files.get(key);
    if (prev && prev.source === source) return prev;
    const name = builtin ? uri.path.replace(/^\//, "") : this.displayName(uri);
    const entry: IndexedFile = {
      uri,
      name,
      fileId: prev?.fileId ?? this.nextFileId++,
      source,
      result: parseSysML(source),
      builtin,
    };
    // tag elements with the file id for cross-file navigation
    walk(entry.result.root, (el) => {
      el.fileId = entry.fileId;
    });
    // an opened file inside an ignored directory (e.g. a `.claude/worktrees`
    // copy) still gets a parsed entry for its own language features, but never
    // joins the workspace-wide index (map) that resolution/diagnostics use
    if (builtin || !isIgnoredModelPath(name)) this.files.set(key, entry);
    return entry;
  }

  private fireChanged(): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.changeEmitter.fire(), 250);
  }

  get(uri: vscode.Uri): IndexedFile | undefined {
    return this.files.get(uri.toString());
  }

  getByFileId(fileId: number): IndexedFile | undefined {
    for (const f of this.files.values()) {
      if (f.fileId === fileId) return f;
    }
    return undefined;
  }

  all(includeBuiltin = false): IndexedFile[] {
    return [...this.files.values()]
      .filter((f) => includeBuiltin || !f.builtin)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Combined model: a synthetic root with one `file` node per indexed file. */
  combinedRoot(includeBuiltin = false): SysMLElement {
    const root = createElement("namespace");
    for (const f of this.all(includeBuiltin)) {
      const fileEl = f.result.root;
      fileEl.kind = "file";
      fileEl.name = f.name;
      fileEl.parent = root;
      root.children.push(fileEl);
    }
    return root;
  }

  /** All declared element names (for completion). */
  allNames(): Set<string> {
    const names = new Set<string>();
    for (const f of this.files.values()) {
      walk(f.result.root, (el) => {
        if (el.name && el.kind !== "file") names.add(el.name);
      });
    }
    return names;
  }

  /** Find named declarations across the workspace. */
  findDeclarations(name: string): { file: IndexedFile; el: SysMLElement }[] {
    const out: { file: IndexedFile; el: SysMLElement }[] = [];
    for (const f of this.files.values()) {
      walk(f.result.root, (el) => {
        if ((el.name === name || el.shortName === name) && el.kind !== "file") {
          out.push({ file: f, el });
        }
      });
    }
    return out;
  }

  dispose(): void {
    clearTimeout(this.debounceTimer);
    this.changeEmitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

/** deepest element whose range contains the offset */
export function elementAt(root: SysMLElement, offset: number): SysMLElement | undefined {
  let best: SysMLElement | undefined;
  walk(root, (el) => {
    if (el === root) return;
    if (el.start <= offset && offset <= el.end) {
      if (!best || el.end - el.start <= best.end - best.start) best = el;
    }
  });
  return best;
}
