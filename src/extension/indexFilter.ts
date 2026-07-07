/**
 * Which workspace paths belong to the workspace model?
 *
 * Hidden directories (`.git`, `.claude/worktrees` — full repo copies on other
 * branches, `.vscode-test`, …) and build outputs must never be indexed:
 * a worktree copy makes every top-level element a false "duplicate" and, worse,
 * can win name resolution with a *stale* version of a package (false
 * "unresolved" on members that only exist in the current branch).
 * Mirrors the walker in src/mcp/modelStore.ts, which already skips these.
 *
 * Pure (no vscode import) so the unit suite can cover it.
 */
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "out", "test-results"]);

/** true if a workspace-relative path lies inside a hidden or build directory */
export function isIgnoredModelPath(relPath: string): boolean {
  return relPath
    .split(/[\\/]/)
    .some((seg) => (seg.startsWith(".") && seg !== "." && seg !== "..") || IGNORED_DIRS.has(seg));
}
