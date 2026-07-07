/**
 * Grammar-coverage harness: runs parseSysML over the official OMG corpus
 * (cloned by scripts/clone-corpus.mjs) and reports, per group,
 *
 *   - parse errors      (result.errors)
 *   - opaque nodes      (kind === "unknown")
 *   - expression-AST coverage (valueExpr.kind !== "opaque" / all valueExpr)
 *
 * With --check it enforces the MAX_ERRORS regression thresholds and exits 1
 * when a group produces more parse errors than its recorded baseline — this
 * is the CI guard against grammar-coverage regressions. If the corpus is not
 * present (clone failed / offline) it prints SKIP and exits 0 so CI stays
 * green without network access.
 *
 * Run with: npm run coverage:grammar [-- --check]
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { parseSysML } from "../src/core/parser";
import { SysMLElement, walk } from "../src/core/ast";

const CORPUS = join("tmp", "omg-corpus");

/** file groups measured since the 2026-06-27 baseline (compare deltas, not absolutes) */
const GROUPS: { name: string; dirs: string[]; exts: string[] }[] = [
  { name: "sysml-examples", dirs: ["sysml/src/examples", "sysml/src/training"], exts: [".sysml"] },
  { name: "kerml-examples", dirs: ["kerml/src/examples"], exts: [".kerml"] },
  { name: "stdlib", dirs: ["sysml.library"], exts: [".sysml", ".kerml"] },
];

/**
 * Regression thresholds = parse errors measured on main at vendoring time
 * (v0.8.0, 2026-07-07). Lower them as coverage improves; raising one needs
 * an explicit decision in review.
 */
const MAX_ERRORS: Record<string, number> = {
  "sysml-examples": 10,
  "kerml-examples": 14,
  "stdlib": 22,
};

function listFiles(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, exts, out);
    else if (exts.includes(extname(name))) out.push(p);
  }
  return out;
}

if (!existsSync(CORPUS)) {
  console.log(`[coverage] SKIP: corpus not found at ${CORPUS} (run scripts/clone-corpus.mjs first)`);
  process.exit(0);
}

const check = process.argv.includes("--check");
let failed = false;

for (const group of GROUPS) {
  const files = group.dirs
    .map((d) => join(CORPUS, d))
    .filter((d) => existsSync(d))
    .flatMap((d) => listFiles(d, group.exts));

  let errors = 0;
  let opaque = 0;
  let exprTotal = 0;
  let exprAst = 0;

  for (const file of files) {
    const result = parseSysML(readFileSync(file, "utf8"));
    errors += result.errors.length;
    walk(result.root, (el: SysMLElement) => {
      if (el.kind === "unknown") opaque++;
      if (el.valueExpr) {
        exprTotal++;
        if (el.valueExpr.kind !== "opaque") exprAst++;
      }
    });
  }

  const pct = exprTotal ? ((100 * exprAst) / exprTotal).toFixed(1) : "—";
  const max = MAX_ERRORS[group.name];
  const verdict = !check ? "" : errors <= max ? `  OK (<= ${max})` : `  FAIL (> ${max})`;
  if (check && errors > max) failed = true;

  console.log(
    `[coverage] ${group.name}: ${files.length} files, ` +
      `${errors} parse errors, ${opaque} opaque nodes, ` +
      `expr AST ${exprAst}/${exprTotal} (${pct}%)${verdict}`
  );
}

if (failed) {
  console.error("[coverage] FAIL: parse errors exceeded the recorded baseline (grammar regression)");
  process.exit(1);
}
