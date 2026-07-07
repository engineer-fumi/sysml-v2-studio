/**
 * Which workspace paths belong to the workspace model?
 *
 * Hidden directories (`.git`, `.claude/worktrees` — full repo copies on other
 * branches, `.vscode-test`, …), build outputs, and scratch dirs must never be
 * indexed: a worktree copy makes every top-level element a false "duplicate"
 * and, worse, can win name resolution with a *stale* version of a package
 * (false "unresolved" on members that only exist in the current branch).
 * `tmp/` holds the vendored grammar-coverage corpus (scripts/clone-corpus.mjs) —
 * indexing its ~400 files buries the real workspace in thousands of diagnostics
 * and collides with the curated samples/omg twins.
 * Mirrors the walker in src/mcp/modelStore.ts, which already skips these.
 *
 * Pure (no vscode import) so the unit suite can cover it.
 */
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "out", "test-results", "tmp"]);

/** true if a workspace-relative path lies inside a hidden or build directory */
export function isIgnoredModelPath(relPath: string): boolean {
  return relPath
    .split(/[\\/]/)
    .some((seg) => (seg.startsWith(".") && seg !== "." && seg !== "..") || IGNORED_DIRS.has(seg));
}
