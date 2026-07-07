/**
 * Shallow-clones the official OMG SysML-v2-Release repository into
 * tmp/omg-corpus (gitignored) so the grammar-coverage harness can measure
 * parse coverage against the real corpus (examples, training, full standard
 * library).
 *
 * Network access is required; in CI the coverage job treats a missing corpus
 * as "skip", so a failed clone must not break the build — this script still
 * exits non-zero so the failure is visible in the step log.
 *
 * Usage: node scripts/clone-corpus.mjs [--force]
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const REPO = "https://github.com/Systems-Modeling/SysML-v2-Release.git";
const DEST = join("tmp", "omg-corpus");

const force = process.argv.includes("--force");
if (existsSync(DEST)) {
  if (!force) {
    console.log(`[corpus] already present at ${DEST} (use --force to re-clone)`);
    process.exit(0);
  }
  rmSync(DEST, { recursive: true, force: true });
}

console.log(`[corpus] cloning ${REPO} (shallow) -> ${DEST}`);
execFileSync("git", ["clone", "--depth", "1", REPO, DEST], { stdio: "inherit" });
console.log("[corpus] done");
