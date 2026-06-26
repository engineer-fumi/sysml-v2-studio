/**
 * Generate a standalone, publishable npm package for the SysML v2 Studio MCP
 * server (案1: a minimal package built from the bundled `dist/mcp.cjs`).
 *
 * The VS Code extension and the MCP npm package share one source tree but ship
 * separately: the extension goes to the Marketplace (vsce), this package goes to
 * npm so anyone can run it with `npx -y @engineer-fumi/sysml-v2-mcp <dir>`
 * without knowing where the extension is installed.
 *
 * Output: dist/npm/ — { package.json, mcp.cjs, README.md, LICENSE }
 * Version is synced from the root package.json so the two never drift.
 *
 * Usage: node scripts/build-mcp-package.mjs   (run `npm run build:mcp` first,
 *        or this script will rebuild the bundle itself)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "npm");

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const PKG_NAME = "@engineer-fumi/sysml-v2-mcp";

// 1. ensure the bundle exists and is fresh
const bundle = path.join(root, "dist", "mcp.cjs");
if (!fs.existsSync(bundle)) {
  console.log("[mcp-pkg] dist/mcp.cjs missing — running build:mcp");
  execFileSync("npm", ["run", "build:mcp"], { cwd: root, stdio: "inherit" });
}

// 2. (re)create the output directory
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 3. copy the bundled server (single, dependency-free file)
fs.copyFileSync(bundle, path.join(outDir, "mcp.cjs"));

// 4. write the standalone package.json (version synced from the extension)
const pkg = {
  name: PKG_NAME,
  version: rootPkg.version,
  description:
    "Standalone MCP (Model Context Protocol) server for SysML v2 (.sysml / .kerml) — parse, validate, outline, requirements and diagram structure over stdio. Companion to the SysML v2 Studio VS Code extension.",
  keywords: ["sysml", "sysml-v2", "kerml", "mbse", "mcp", "model-context-protocol", "claude"],
  homepage: "https://github.com/engineer-fumi/sysml-v2-studio#readme",
  repository: { type: "git", url: "git+https://github.com/engineer-fumi/sysml-v2-studio.git" },
  bugs: { url: "https://github.com/engineer-fumi/sysml-v2-studio/issues" },
  license: rootPkg.license,
  author: rootPkg.publisher,
  type: "commonjs",
  // bare filename (no "./"): npm's metadata normalizer drops a "./"-prefixed bin
  // from the registry packument with a warning, even though the tarball keeps it
  bin: { "sysml-v2-mcp": "mcp.cjs" },
  files: ["mcp.cjs", "README.md", "LICENSE"],
  engines: { node: ">=18" },
};
fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// 5. LICENSE (carry over the repo license)
fs.copyFileSync(path.join(root, "LICENSE"), path.join(outDir, "LICENSE"));

// 6. a focused README for the npm page
const readme = `# @engineer-fumi/sysml-v2-mcp

Standalone **MCP (Model Context Protocol) server** for **SysML v2** (\`.sysml\` /
\`.kerml\`) models. It exposes a workspace of SysML v2 files to MCP clients such as
Claude Desktop and Claude Code as resolved model structure — not just text —
covering parse, validate, outline, requirements and diagram structure.

This is the companion server to the
[SysML v2 Studio](https://github.com/engineer-fumi/sysml-v2-studio) VS Code
extension and reuses the same parser / name resolution / validation core, so its
diagnostics match what you see in the editor. It has **no runtime dependencies**
(a single bundled file, newline-delimited JSON-RPC 2.0 over stdio).

## Use it (no install)

### Claude Code

\`\`\`bash
claude mcp add sysml -- npx -y ${PKG_NAME} "$(pwd)"
\`\`\`

### Claude Desktop

\`\`\`jsonc
{
  "mcpServers": {
    "sysml": {
      "command": "npx",
      "args": ["-y", "${PKG_NAME}", "<ABS_PATH_TO_YOUR_MODEL_WORKSPACE>"]
    }
  }
}
\`\`\`

The first positional argument (or \`$SYSML_WORKSPACE\`, else the current directory)
is the workspace root scanned recursively for \`.sysml\` / \`.kerml\` files.

## Tools

\`list_files\`, \`outline\`, \`validate\`, \`find_element\`, \`list_requirements\`,
\`describe_diagram\`. See the
[MCP guide](https://github.com/engineer-fumi/sysml-v2-studio/blob/main/docs/mcp.md)
for details and usage examples.

## License

MIT — see [LICENSE](./LICENSE).
`;
fs.writeFileSync(path.join(outDir, "README.md"), readme);

console.log(`[mcp-pkg] built ${PKG_NAME}@${pkg.version} -> ${path.relative(root, outDir)}`);
console.log("[mcp-pkg] publish with:  npm publish ./dist/npm --access public");
