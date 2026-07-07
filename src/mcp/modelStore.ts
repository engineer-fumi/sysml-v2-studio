/**
 * Filesystem-backed model index for the MCP server — the editor-independent
 * counterpart of the extension's ModelIndex. It scans a workspace directory for
 * `.sysml` / `.kerml` files, parses them with the shared core parser and exposes
 * a combined model (plus the bundled standard library) for resolution, querying
 * and diagram layout. No VS Code, no MCP SDK — just `src/core` + node fs, so it
 * is unit-testable in isolation.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ParseResult, SysMLElement, createElement, walk } from "../core/ast";
import { parseSysML } from "../core/parser";
import { Resolver } from "../core/resolve";
import { STDLIB_FILES } from "../core/stdlib";

export interface StoredFile {
  /** workspace-relative path (POSIX separators), or `lib/<name>` for stdlib */
  path: string;
  /** absolute path on disk (undefined for the bundled standard library) */
  absPath?: string;
  source: string;
  result: ParseResult;
  fileId: number;
  builtin: boolean;
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".git", ".test-extensions",
  "test-resources", "playwright-report", "test-results", "tmp",
]);

/** convert a 0-based character offset into a 1-based line/column. */
export function positionAt(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const end = Math.max(0, Math.min(offset, source.length));
  for (let i = 0; i < end; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export class ModelStore {
  private filesByPath = new Map<string, StoredFile>();
  private nextFileId = 1;

  constructor(private rootDir: string) {}

  /** (re-)scan the workspace from disk; call before each query so edits show. */
  refresh(): void {
    this.filesByPath.clear();
    this.nextFileId = 1;

    for (const lib of STDLIB_FILES) {
      this.add(`lib/${lib.name}`, undefined, lib.source, /*builtin*/ true);
    }
    for (const abs of this.scanDir(this.rootDir)) {
      let source: string;
      try {
        source = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const rel = path.relative(this.rootDir, abs).split(path.sep).join("/");
      this.add(rel, abs, source, /*builtin*/ false);
    }
  }

  private scanDir(dir: string): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        out.push(...this.scanDir(full));
      } else if (/\.(sysml|kerml)$/i.test(e.name)) {
        out.push(full);
      }
    }
    return out;
  }

  private add(rel: string, absPath: string | undefined, source: string, builtin: boolean): void {
    const result = parseSysML(source);
    const fileId = this.nextFileId++;
    walk(result.root, (el) => {
      el.fileId = fileId;
    });
    this.filesByPath.set(rel, { path: rel, absPath, source, result, fileId, builtin });
  }

  /** user files (no stdlib), sorted by path. */
  files(): StoredFile[] {
    return [...this.filesByPath.values()]
      .filter((f) => !f.builtin)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** look up a user file by its workspace-relative path (lenient on separators). */
  file(relPath: string): StoredFile | undefined {
    const norm = relPath.split(path.sep).join("/");
    return (
      this.filesByPath.get(norm) ??
      this.files().find((f) => f.path === norm || f.path.endsWith(`/${norm}`))
    );
  }

  /** synthetic root with one `file` node per indexed file (stdlib optional). */
  combinedRoot(includeBuiltin = true): SysMLElement {
    const root = createElement("namespace");
    for (const f of this.filesByPath.values()) {
      if (!includeBuiltin && f.builtin) continue;
      const fileEl = f.result.root;
      fileEl.kind = "file";
      fileEl.name = f.path;
      fileEl.parent = root;
      root.children.push(fileEl);
    }
    return root;
  }

  resolver(): Resolver {
    return new Resolver(this.combinedRoot(true));
  }
}
